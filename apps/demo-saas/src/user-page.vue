<script setup lang="ts">
import { createTinCan } from "@tincan-webmcp/browser";
import { registerReportSiteIssue } from "@tincan-webmcp/webmcp";
import { onBeforeUnmount, onMounted, ref } from "vue";
import { sessionFetch } from "./session";

interface Subscription {
  plan: string;
  licenseCount: number;
  status: string;
}

interface Notification {
  id: number;
  title: string;
  message: string;
  tone: "warning" | "success" | "error";
}

interface AgentActivity {
  id: number;
  timestamp: string;
  title: string;
  detail: string;
  tone: "neutral" | "success" | "failure" | "report";
}

const subscription = ref<Subscription>({ plan: "Business", licenseCount: 10, status: "active" });
const licenseAction = ref<"add" | "remove" | null>(null);
const webmcpAvailable = ref(false);
const notifications = ref<Notification[]>([]);
const activity = ref<AgentActivity[]>([]);
const latestIncidentId = ref("");
const notificationTimers: number[] = [];
let nextNotificationId = 1;
let nextActivityId = 1;

const recorder = createTinCan({
  application: { name: "acme-saas", version: "1.4.2", environment: "production" },
  fetch: sessionFetch,
  // Browser agents may reload the page between tool calls; keep the evidence window.
  persistence: { key: "tincan:acme-saas:flight-recorder" },
});
const UI_STATE_KEY = "tincan:acme-saas:ui";
const registration = new AbortController();

function showNotification(title: string, message: string, tone: Notification["tone"]): void {
  const id = nextNotificationId++;
  notifications.value.push({ id, title, message, tone });
  notificationTimers.push(window.setTimeout(() => {
    notifications.value = notifications.value.filter((notification) => notification.id !== id);
  }, 6_000));
}

function clearNotifications(): void {
  notificationTimers.forEach((timer) => window.clearTimeout(timer));
  notificationTimers.length = 0;
  notifications.value = [];
}

function addActivity(title: string, detail: string, tone: AgentActivity["tone"]): void {
  activity.value.unshift({ id: nextActivityId++, timestamp: new Date().toISOString(), title, detail, tone });
  activity.value = activity.value.slice(0, 12);
  saveUiState();
}

interface PersistedUiState {
  activity: AgentActivity[];
  latestIncidentId: string;
  nextActivityId: number;
}

function saveUiState(): void {
  try {
    const state: PersistedUiState = { activity: activity.value, latestIncidentId: latestIncidentId.value, nextActivityId };
    localStorage.setItem(UI_STATE_KEY, JSON.stringify(state));
  } catch {
    // Storage unavailable: the page still works, it just starts blank after a reload.
  }
}

function restoreUiState(): void {
  try {
    const raw = localStorage.getItem(UI_STATE_KEY);
    if (!raw) return;
    const state = JSON.parse(raw) as Partial<PersistedUiState>;
    if (Array.isArray(state.activity)) activity.value = state.activity.slice(0, 12);
    if (typeof state.latestIncidentId === "string") latestIncidentId.value = state.latestIncidentId;
    if (typeof state.nextActivityId === "number") nextActivityId = state.nextActivityId;
  } catch {
    // Ignore corrupted state.
  }
}

function clearUiState(): void {
  try {
    localStorage.removeItem(UI_STATE_KEY);
  } catch {
    // Nothing to clear.
  }
}

function formatUtcTime(timestamp: string): string {
  return `${new Date(timestamp).toISOString().slice(11, 19)} UTC`;
}

async function loadSubscription(): Promise<Subscription> {
  const response = await sessionFetch("/api/subscription");
  if (!response.ok) throw new Error("Unable to load subscription");
  const result = await response.json() as Subscription;
  subscription.value = result;
  return result;
}

async function addLicenses(count: number): Promise<{
  status: string;
  requestedLicenseCount: number;
  previousLicenseCount: number;
  expectedLicenseCount: number;
}> {
  const response = await sessionFetch("/api/licenses", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ count }),
  });
  if (!response.ok) throw new Error("Unable to add licenses");
  return response.json() as Promise<{
    status: string;
    requestedLicenseCount: number;
    previousLicenseCount: number;
    expectedLicenseCount: number;
  }>;
}

interface FailedLicenseOperation {
  status: number;
  statusText: string;
  error: string;
  requestedLicenseCount: number;
}

async function removeLicenses(count: number): Promise<FailedLicenseOperation> {
  const response = await sessionFetch("/api/licenses/remove", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ count }),
  });
  const result = await response.json() as Omit<FailedLicenseOperation, "status" | "statusText">;
  return { ...result, status: response.status, statusText: response.statusText };
}

async function addOneLicense(): Promise<void> {
  licenseAction.value = "add";
  try {
    await addLicenses(1);
    await loadSubscription();
    showNotification("License added", "One license was added to the subscription.", "success");
  } catch {
    showNotification("Could not add license", "The subscription could not be updated.", "error");
  } finally {
    licenseAction.value = null;
  }
}

async function removeOneLicense(): Promise<void> {
  licenseAction.value = "remove";
  try {
    const result = await removeLicenses(1);
    if (result.status >= 400) throw new Error(result.error);
    await loadSubscription();
    showNotification("License removed", "One license was removed from the subscription.", "success");
  } catch {
    showNotification("Remove license timed out", "The billing service did not respond. No license was removed.", "error");
  } finally {
    licenseAction.value = null;
  }
}

async function requestUsageExport(): Promise<{ status: number; statusText: string }> {
  const response = await sessionFetch("/api/usage-export", { method: "POST" });
  return { status: response.status, statusText: response.statusText };
}

async function resetDemo(): Promise<void> {
  clearNotifications();
  activity.value = [];
  latestIncidentId.value = "";
  clearUiState();
  await sessionFetch("/api/reset", { method: "POST" });
  await loadSubscription();
}

async function registerBusinessTools(): Promise<boolean> {
  const model = document.modelContext;
  if (!model) return false;

  const tools: ModelContextTool[] = [
    {
      name: "add_licenses",
      title: "Add licenses",
      description: "Add a requested number of new user licenses to the current subscription.",
      inputSchema: {
        type: "object",
        properties: { count: { type: "integer", minimum: 1, maximum: 100 } },
        required: ["count"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const count = Number((input as { count: number }).count);
        addActivity("add_licenses", `Agent requested ${count} new licenses.`, "neutral");
        const result = await addLicenses(count);
        await loadSubscription();
        addActivity("Business tool returned", `Mutation reported ${count} licenses added.`, "success");
        return result;
      },
    },
    {
      name: "get_subscription",
      title: "Get subscription",
      description: "Read the current subscription plan and persisted license count.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
      execute: async () => {
        addActivity("get_subscription", "Agent requested the persisted subscription state.", "neutral");
        const result = await loadSubscription();
        addActivity("Read-back returned", `Persisted license count is ${result.licenseCount}.`, "success");
        return result;
      },
    },
    {
      name: "remove_licenses",
      title: "Remove licenses",
      description: "Remove a requested number of user licenses from the current subscription.",
      inputSchema: {
        type: "object",
        properties: { count: { type: "integer", minimum: 1, maximum: 100 } },
        required: ["count"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const count = Number((input as { count: number }).count);
        addActivity("remove_licenses", `Agent requested removal of ${count} licenses.`, "neutral");
        const result = await removeLicenses(count);
        addActivity("Business tool returned", `Removal returned HTTP ${result.status} ${result.statusText}.`, "failure");
        return result;
      },
    },
    {
      name: "export_usage_report",
      title: "Export usage report",
      description: "Start a downloadable usage export for the current workspace.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      execute: async () => {
        addActivity("export_usage_report", "Agent requested a usage export.", "neutral");
        const result = await requestUsageExport();
        addActivity("Business tool returned", `Export returned HTTP ${result.status} ${result.statusText}.`, result.status >= 400 ? "failure" : "success");
        return result;
      },
    },
  ];
  await Promise.all(tools.map((tool) => model.registerTool(tool, { signal: registration.signal })));
  return true;
}

onMounted(async () => {
  recorder.start();
  restoreUiState();
  // Register tools before any network round-trip so an agent that reloads the page
  // between steps finds them the moment the document exists.
  const registrations = Promise.all([
    registerReportSiteIssue(recorder, registration.signal, {
      onStart: (input) => {
        addActivity("report_site_issue", input.summary, "report");
        showNotification("Agent detected an issue", input.summary, "warning");
      },
      onSuccess: (result) => {
        latestIncidentId.value = result.incidentId;
        addActivity("Issue reported", `${result.incidentId} was accepted by TinCan.`, "success");
        showNotification("Issue reported", `${result.incidentId} was sent with private diagnostic evidence.`, "success");
      },
      onError: () => {
        addActivity("Issue report failed", "TinCan did not accept the report.", "failure");
        showNotification("Report failed", "TinCan could not accept the agent's report.", "error");
      },
    }),
    registerBusinessTools(),
  ]);
  void loadSubscription().catch(() => undefined);
  const [reportRegistered, businessRegistered] = await registrations;
  webmcpAvailable.value = reportRegistered && businessRegistered;
});

onBeforeUnmount(() => {
  registration.abort();
  recorder.stop();
  clearNotifications();
});
</script>

<template>
  <div class="user-shell">
    <div class="notification-stack" aria-live="polite">
      <div v-for="notification in notifications" :key="notification.id" class="notification" :data-tone="notification.tone" role="status">
        <span>{{ notification.tone === 'success' ? '✓' : '!' }}</span>
        <div><strong>{{ notification.title }}</strong><p>{{ notification.message }}</p></div>
      </div>
    </div>

    <header class="topbar">
      <a class="brand" href="/" aria-label="Acme Cloud home"><span class="brand-mark">A</span><span>Acme Cloud</span></a>
      <div class="topbar-actions">
        <span class="environment"><i /> Production</span>
        <a class="agent-link" href="/agent">Open agent</a>
        <a class="site-switch" href="/admin/overview">Open admin <span>↗</span></a>
        <button class="quiet-button" type="button" @click="resetDemo">Reset demo</button>
      </div>
    </header>

    <aside class="sidebar" aria-label="Primary navigation">
      <p class="workspace-label">Workspace</p>
      <strong>Northstar Labs</strong>
      <nav><a href="#">Overview</a><a href="#">Usage</a><a class="active" href="#">Billing</a><a href="#">Members</a><a href="#">API keys</a></nav>
      <div class="agent-status"><span class="spark">✦</span><div><strong>Agent tools</strong><small>{{ webmcpAvailable ? '5 WebMCP tools ready' : 'WebMCP unavailable' }}</small></div></div>
    </aside>

    <main>
      <div class="page-heading"><div><p class="eyebrow">Settings / Billing</p><h1>Subscription</h1><p>Manage your plan and the licenses available to your team.</p></div></div>

      <section class="plan-card">
        <div class="plan-copy"><span class="plan-chip">{{ subscription.plan }}</span><h2>Your team is ready to grow.</h2><p>Advanced controls, priority support, and flexible licenses for every collaborator.</p><div class="price"><strong>$24</strong><span>per license / month</span></div></div>
        <div class="license-panel">
          <div class="license-summary"><div class="license-number">{{ subscription.licenseCount }}</div><div><strong>Active licenses</strong><p>{{ subscription.status }}</p></div></div>
          <div class="license-actions" aria-label="License actions">
            <button type="button" :disabled="licenseAction !== null" @click="addOneLicense">{{ licenseAction === 'add' ? 'Adding…' : 'Add license' }}</button>
            <button class="remove-license" type="button" :disabled="licenseAction !== null" @click="removeOneLicense">{{ licenseAction === 'remove' ? 'Removing…' : 'Remove license' }}</button>
          </div>
        </div>
      </section>

      <section class="agent-card">
        <div class="agent-card-title"><span class="step-icon">✦</span><div><p class="eyebrow">WebMCP</p><h2>Agent activity</h2></div><span class="tool-status" :data-ready="webmcpAvailable">{{ webmcpAvailable ? 'Tools ready' : 'Waiting for WebMCP' }}</span></div>
        <div class="tool-flow">
          <div><span>1</span><strong>Act</strong><small>Agent chooses a business tool</small></div><div class="connector" />
          <div><span>2</span><strong>Verify</strong><small>Agent checks the returned state</small></div><div class="connector" />
          <div><span>3</span><strong>Report if needed</strong><small>Agent calls report_site_issue</small></div>
        </div>
        <div class="tool-list" aria-label="Available WebMCP tools"><code>add_licenses</code><code>remove_licenses</code><code>get_subscription</code><code>export_usage_report</code><code>report_site_issue</code></div>
        <div class="activity-list">
          <div v-if="activity.length === 0" class="activity-empty"><strong>{{ webmcpAvailable ? 'Waiting for an agent to call a WebMCP tool.' : 'Open this page in a WebMCP-capable browser to let an agent act.' }}</strong><p>The website does not run or report a scripted failure on its own.</p></div>
          <template v-else>
            <article v-for="entry in activity" :key="entry.id" :data-tone="entry.tone"><time :datetime="entry.timestamp">{{ formatUtcTime(entry.timestamp) }}</time><div><code>{{ entry.title }}</code><p>{{ entry.detail }}</p></div></article>
          </template>
        </div>
        <div v-if="latestIncidentId" class="latest-issue"><span>The agent's latest report was accepted.</span><a :href="`/admin/issues/${latestIncidentId}`">Inspect {{ latestIncidentId }}</a></div>
      </section>
    </main>
  </div>
</template>

<style scoped src="./user-style.css"></style>
