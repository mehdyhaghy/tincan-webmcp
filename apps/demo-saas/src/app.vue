<script setup lang="ts">
import { createTinCan, type ReportSiteIssueInput } from "@tincan-webmcp/browser";
import { registerReportSiteIssue } from "@tincan-webmcp/webmcp";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

interface Subscription {
  plan: string;
  seatCount: number;
  status: string;
}

interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute(input: unknown): Promise<string>;
}

const subscription = ref<Subscription>({ plan: "Business", seatCount: 10, status: "active" });
const phase = ref<"ready" | "working" | "mismatch" | "reported">("ready");
const incidentId = ref("");
const webmcpAvailable = ref(false);

const recorder = createTinCan({
  application: { name: "acme-saas", version: "1.4.2", environment: "production" },
});
const registration = new AbortController();

const phaseCopy = computed(() => ({
  ready: "Ready to run the verification flow.",
  working: "Applying the change and reading it back…",
  mismatch: "The request succeeded, but verification found 19 seats.",
  reported: `Issue ${incidentId.value} was reported with private host evidence.`,
})[phase.value]);

async function loadSubscription(): Promise<Subscription> {
  const response = await fetch("/api/subscription");
  if (!response.ok) throw new Error("Unable to load subscription");
  subscription.value = await response.json() as Subscription;
  return subscription.value;
}

async function changeSeatCount(seats: number): Promise<{ status: string; requestedSeatCount: number }> {
  const response = await fetch("/api/subscription", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ seats }),
  });
  if (!response.ok) throw new Error("Unable to change seat count");
  return response.json() as Promise<{ status: string; requestedSeatCount: number }>;
}

async function runDemo(): Promise<void> {
  phase.value = "working";
  incidentId.value = "";
  await changeSeatCount(20);
  const verified = await loadSubscription();
  if (verified.seatCount !== 20) {
    console.warn("Seat reconciliation mismatch");
    phase.value = "mismatch";
  }
}

const issue: ReportSiteIssueInput = {
  category: "wrong_result",
  severity: "blocking",
  summary: "Subscription upgrade produced incorrect seat count",
  description: "The seat mutation returned success, but structured read-back did not match the requested value.",
  expected: "20 seats",
  observed: "19 seats",
  operation: "change_seat_count",
  confidence: 0.99,
};

async function reportMismatch(): Promise<void> {
  const result = await recorder.reportIssue(issue);
  incidentId.value = result.incidentId;
  phase.value = "reported";
}

async function resetDemo(): Promise<void> {
  await fetch("/api/reset", { method: "POST" });
  await loadSubscription();
  phase.value = "ready";
  incidentId.value = "";
}

async function registerBusinessTools(): Promise<void> {
  const model = (document as Document & {
    modelContext?: { registerTool(tool: ToolDefinition, options?: { signal?: AbortSignal }): Promise<void> };
  }).modelContext;
  if (!model) return;
  const tools: ToolDefinition[] = [
    {
      name: "change_seat_count",
      title: "Change seat count",
      description: "Change the number of seats on the current subscription.",
      inputSchema: {
        type: "object",
        properties: { seats: { type: "integer", minimum: 1, maximum: 500 } },
        required: ["seats"],
        additionalProperties: false,
      },
      execute: async (input) => JSON.stringify(await changeSeatCount(Number((input as { seats: number }).seats))),
    },
    {
      name: "get_subscription",
      title: "Get subscription",
      description: "Read the current subscription plan and persisted seat count.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      execute: async () => JSON.stringify(await loadSubscription()),
    },
  ];
  await Promise.all(tools.map((tool) => model.registerTool(tool, { signal: registration.signal })));
}

onMounted(async () => {
  recorder.start();
  await loadSubscription();
  const [reportRegistered] = await Promise.all([
    registerReportSiteIssue(recorder, registration.signal),
    registerBusinessTools().then(() => Boolean((document as Document & { modelContext?: unknown }).modelContext)),
  ]);
  webmcpAvailable.value = reportRegistered;
});

onBeforeUnmount(() => {
  registration.abort();
  recorder.stop();
});
</script>

<template>
  <div class="shell">
    <header class="topbar">
      <a class="brand" href="/" aria-label="Acme Cloud home">
        <span class="brand-mark">A</span>
        <span>Acme Cloud</span>
      </a>
      <div class="topbar-actions">
        <span class="environment"><i /> Production</span>
        <button class="quiet-button" type="button" @click="resetDemo">Reset demo</button>
      </div>
    </header>

    <aside class="sidebar" aria-label="Primary navigation">
      <p class="workspace-label">Workspace</p>
      <strong>Northstar Labs</strong>
      <nav>
        <a href="#">Overview</a>
        <a href="#">Usage</a>
        <a class="active" href="#">Billing</a>
        <a href="#">Members</a>
        <a href="#">API keys</a>
      </nav>
      <div class="agent-status">
        <span class="spark">✦</span>
        <div>
          <strong>Agent tools</strong>
          <small>{{ webmcpAvailable ? '3 tools available' : 'Browser UI mode' }}</small>
        </div>
      </div>
    </aside>

    <main>
      <div class="page-heading">
        <div>
          <p class="eyebrow">Settings / Billing</p>
          <h1>Subscription</h1>
          <p>Manage your plan and the seats available to your team.</p>
        </div>
        <a class="issues-link" href="http://127.0.0.1:5174">Open TinCan issues <span>↗</span></a>
      </div>

      <section class="plan-card">
        <div class="plan-copy">
          <span class="plan-chip">{{ subscription.plan }}</span>
          <h2>Your team is ready to grow.</h2>
          <p>Advanced controls, priority support, and flexible seats for every collaborator.</p>
          <div class="price"><strong>$24</strong><span>per seat / month</span></div>
        </div>
        <div class="seat-panel">
          <div class="seat-number">{{ subscription.seatCount }}</div>
          <div>
            <strong>Active seats</strong>
            <p>{{ subscription.status }}</p>
          </div>
        </div>
      </section>

      <section class="verification-card" :data-phase="phase">
        <div class="verification-title">
          <span class="step-icon">✦</span>
          <div>
            <p class="eyebrow">Judge demo</p>
            <h2>Semantic verification</h2>
          </div>
          <span class="signal-pill">HTTP 200 · 0 JS errors</span>
        </div>

        <div class="flow">
          <div><span>1</span><strong>Request</strong><small>Upgrade to 20 seats</small></div>
          <div class="connector" />
          <div><span>2</span><strong>Verify</strong><small>Read persisted state</small></div>
          <div class="connector" />
          <div><span>3</span><strong>Report</strong><small>Attach private signals</small></div>
        </div>

        <div class="result-row">
          <div>
            <strong>{{ phaseCopy }}</strong>
            <p v-if="phase === 'mismatch' || phase === 'reported'">
              Expected <b>20 seats</b> · Observed <b class="bad">{{ subscription.seatCount }} seats</b>
            </p>
          </div>
          <button v-if="phase === 'ready'" class="primary-button" type="button" @click="runDemo">Run 20 → 19 demo</button>
          <button v-else-if="phase === 'mismatch'" class="danger-button" type="button" @click="reportMismatch">Report site issue</button>
          <a v-else-if="phase === 'reported'" class="primary-button link-button" href="http://127.0.0.1:5174">Inspect {{ incidentId }}</a>
          <span v-else class="loader" aria-label="Working" />
        </div>
      </section>
    </main>
  </div>
</template>
