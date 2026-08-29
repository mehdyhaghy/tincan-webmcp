<script setup lang="ts">
import type { IncidentPayload, OtelLogRecord, OtelMetric, OtelSpan } from "@tincan-webmcp/browser";
import { computed, onMounted, onUnmounted, ref } from "vue";

interface StoredIncident extends IncidentPayload {
  id: string;
  fingerprint: string;
  classification: { semanticOnly: boolean };
}

type SignalTab = "logs" | "metrics" | "traces";
type WorkspacePage = "home" | "issues" | "signal-health" | "settings";

const issues = ref<StoredIncident[]>([]);
const selectedId = ref("");
const activeTab = ref<SignalTab>("logs");
const loading = ref(true);
const currentPath = ref(window.location.pathname);

const page = computed<WorkspacePage>(() => {
  if (currentPath.value === "/admin" || currentPath.value.startsWith("/admin/overview")) return "home";
  if (currentPath.value.startsWith("/admin/signal-health")) return "signal-health";
  if (currentPath.value.startsWith("/admin/settings")) return "settings";
  return "issues";
});
const selected = computed(() => issues.value.find((issue) => issue.id === selectedId.value) ?? issues.value[0]);
const logs = computed<OtelLogRecord[]>(() => selected.value?.diagnostics.resourceLogs.flatMap((group) =>
  group.scopeLogs.flatMap((scope) => scope.logRecords),
) ?? []);
const metrics = computed<OtelMetric[]>(() => selected.value?.diagnostics.resourceMetrics.flatMap((group) =>
  group.scopeMetrics.flatMap((scope) => scope.metrics),
) ?? []);
const spans = computed<OtelSpan[]>(() => selected.value?.diagnostics.resourceSpans.flatMap((group) =>
  group.scopeSpans.flatMap((scope) => scope.spans),
) ?? []);

const appName = computed(() => String(selected.value?.resource.attributes["service.name"] ?? "unknown"));
const appVersion = computed(() => String(selected.value?.resource.attributes["service.version"] ?? ""));
const categoryLabels: Record<IncidentPayload["agentObservation"]["category"], string> = {
  wrong_result: "Wrong result",
  unexpected_behavior: "Unexpected behavior",
  action_failed: "Action failed",
  network_failure: "Network failure",
  performance: "Performance",
  ui_state_mismatch: "UI state mismatch",
  other: "Other",
};

const categoryLabel = computed(() => selected.value
  ? categoryLabels[selected.value.agentObservation.category]
  : "Issue");
const failedRequests = computed(() => spans.value.filter((span) => {
  const statusCode = Number(span.attributes["http.response.status_code"] ?? 0);
  return span.status.code === "ERROR" || statusCode >= 400;
}).length);
const jsErrors = computed(() => logs.value.filter((record) => record.eventName === "tincan.browser.error").length);
const averageSpanDuration = computed(() => {
  if (spans.value.length === 0) return undefined;
  const total = spans.value.reduce((sum, span) => sum + spanDuration(span), 0);
  return Math.round(total / spans.value.length);
});
const hasTechnicalFailures = computed(() => failedRequests.value > 0 || jsErrors.value > 0);
const submittedPayload = computed(() => {
  if (!selected.value) return "{}";
  return JSON.stringify({
    schemaVersion: selected.value.schemaVersion,
    agentObservation: selected.value.agentObservation,
    resource: selected.value.resource,
    instrumentationScope: selected.value.instrumentationScope,
    attributes: selected.value.attributes,
    diagnostics: selected.value.diagnostics,
    ...(selected.value.correlation ? { correlation: selected.value.correlation } : {}),
  }, null, 2);
});
const signalTotals = computed(() => issues.value.reduce((totals, issue) => {
  totals.logs += issue.diagnostics.resourceLogs.reduce((count, group) =>
    count + group.scopeLogs.reduce((scopeCount, scope) => scopeCount + scope.logRecords.length, 0), 0);
  totals.metrics += issue.diagnostics.resourceMetrics.reduce((count, group) =>
    count + group.scopeMetrics.reduce((scopeCount, scope) => scopeCount + scope.metrics.length, 0), 0);
  totals.spans += issue.diagnostics.resourceSpans.reduce((count, group) =>
    count + group.scopeSpans.reduce((scopeCount, scope) => scopeCount + scope.spans.length, 0), 0);
  return totals;
}, { logs: 0, metrics: 0, spans: 0 }));
const signalCoverage = computed(() => issues.value.reduce((coverage, issue) => {
  const diagnostics = issue.diagnostics;
  if (diagnostics.resourceLogs.some((group) => group.scopeLogs.some((scope) => scope.logRecords.length > 0))) coverage.logs += 1;
  if (diagnostics.resourceMetrics.some((group) => group.scopeMetrics.some((scope) => scope.metrics.length > 0))) coverage.metrics += 1;
  if (diagnostics.resourceSpans.some((group) => group.scopeSpans.some((scope) => scope.spans.length > 0))) coverage.spans += 1;
  return coverage;
}, { logs: 0, metrics: 0, spans: 0 }));

function issueIdFromPath(path: string): string | undefined {
  const match = path.match(/^\/admin\/issues\/([^/]+)$/);
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

function syncRoute(): void {
  currentPath.value = window.location.pathname;
  const routeIssueId = issueIdFromPath(currentPath.value);
  if (routeIssueId) selectedId.value = routeIssueId;
}

function navigate(path: string): void {
  if (window.location.pathname !== path) window.history.pushState({}, "", path);
  syncRoute();
  if (path.startsWith("/admin/issues/")) activeTab.value = "logs";
}

function spanDuration(span: OtelSpan): number {
  return Math.max(0, new Date(span.endTime).getTime() - new Date(span.startTime).getTime());
}

function formatUtcTimestamp(timestamp: string): string {
  return new Date(timestamp).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}

function formatUtcTime(timestamp: string): string {
  return `${new Date(timestamp).toISOString().slice(11, 23)} UTC`;
}

function metricValue(metric: OtelMetric): string {
  if ("gauge" in metric) return String(metric.gauge.dataPoints[0]?.value ?? 0);
  const point = metric.histogram.dataPoints[0];
  if (!point) return "0";
  return `${Math.round(point.sum / point.count)} ${metric.unit} avg`;
}

async function loadIssues(): Promise<void> {
  loading.value = true;
  const response = await fetch("/api/issues");
  const body = await response.json() as { issues: StoredIncident[] };
  issues.value = body.issues;
  const routeIssueId = issueIdFromPath(currentPath.value);
  if (routeIssueId) selectedId.value = routeIssueId;
  else if (!selectedId.value && body.issues[0]) selectedId.value = body.issues[0].id;
  loading.value = false;
}

onMounted(() => {
  window.addEventListener("popstate", syncRoute);
  void loadIssues();
});
onUnmounted(() => window.removeEventListener("popstate", syncRoute));
</script>

<template>
  <div class="app-shell">
    <header>
      <a class="brand" href="/admin/overview"><span class="brand-mark">T</span><strong>TinCan</strong><i>signals</i></a>
      <div class="header-actions">
        <span class="refresh-mode">Manual refresh</span>
        <a class="site-switch" href="/">Open site <span>↗</span></a>
        <button type="button" @click="loadIssues">Refresh</button>
      </div>
    </header>

    <aside>
      <p class="nav-label">Workspace</p>
      <nav>
        <a href="/admin/overview" :class="{ active: page === 'home' }" @click.prevent="navigate('/admin/overview')">Overview</a>
        <a href="/admin/issues" :class="{ active: page === 'issues' }" @click.prevent="navigate('/admin/issues')">Issues <span>{{ issues.length }}</span></a>
        <a href="/admin/signal-health" :class="{ active: page === 'signal-health' }" @click.prevent="navigate('/admin/signal-health')">Signal health</a>
        <a href="/admin/settings" :class="{ active: page === 'settings' }" @click.prevent="navigate('/admin/settings')">Settings</a>
      </nav>
      <p class="nav-label issue-label">Recent issues</p>
      <a
        v-for="issue in issues"
        :key="issue.id"
        class="issue-item"
        :class="{ selected: issue.id === selected?.id }"
        :href="`/admin/issues/${encodeURIComponent(issue.id)}`"
        @click.prevent="navigate(`/admin/issues/${encodeURIComponent(issue.id)}`)"
      >
        <span>{{ issue.id }}</span>
        <strong>{{ issue.agentObservation.summary }}</strong>
        <small>{{ categoryLabels[issue.agentObservation.category] }} · {{ formatUtcTimestamp(issue.agentObservation.timestamp) }}</small>
      </a>
    </aside>

    <main v-if="page === 'issues' && selected">
      <div class="crumb">Issues / {{ selected.id }}</div>
      <section class="title-row">
        <div>
          <div class="title-meta"><span class="severity">{{ selected.agentObservation.severity }}</span><span>{{ selected.id }}</span></div>
          <h1>{{ selected.agentObservation.summary }}</h1>
          <p><time :datetime="selected.agentObservation.timestamp">{{ formatUtcTimestamp(selected.agentObservation.timestamp) }}</time> · {{ selected.resource.attributes['deployment.environment.name'] }} · {{ appName }} {{ appVersion }}</p>
        </div>
        <span class="category-badge">{{ categoryLabel }}</span>
      </section>

      <section class="issue-report">
        <div class="section-label">
          <span>✦</span><strong>Issue report</strong>
        </div>
        <div class="report-body">
          <p v-if="selected.agentObservation.description" class="description">{{ selected.agentObservation.description }}</p>
          <div v-if="selected.agentObservation.expected || selected.agentObservation.observed" class="outcomes">
            <article v-if="selected.agentObservation.expected">
              <small>Expected outcome</small>
              <strong>{{ selected.agentObservation.expected }}</strong>
            </article>
            <article v-if="selected.agentObservation.observed">
              <small>Observed outcome</small>
              <strong>{{ selected.agentObservation.observed }}</strong>
            </article>
          </div>
          <dl class="issue-metadata">
            <div><dt>Category</dt><dd>{{ categoryLabel }}</dd></div>
            <div v-if="selected.agentObservation.operation"><dt>Operation</dt><dd><code>{{ selected.agentObservation.operation }}</code></dd></div>
            <div><dt>Page</dt><dd><code>{{ selected.attributes['url.path'] }}</code></dd></div>
            <div><dt>Visibility</dt><dd>{{ selected.attributes['browser.visibility_state'] }}</dd></div>
          </dl>
        </div>
      </section>

      <section class="evidence-summary">
        <div class="section-label">
          <span>◇</span><strong>Captured browser evidence</strong><small>Recent diagnostic window</small>
        </div>
        <div class="evidence-body">
          <div><strong>{{ hasTechnicalFailures ? 'Failures observed in the capture window' : 'No request or JavaScript failures in the capture window' }}</strong></div>
          <ul>
            <li><b>{{ failedRequests }}</b> failed requests</li>
            <li><b>{{ jsErrors }}</b> JavaScript errors</li>
            <li><b>{{ averageSpanDuration ?? '—' }}</b> ms avg span</li>
          </ul>
        </div>
      </section>

      <section class="signals">
        <div class="signals-heading">
          <div><p class="eyebrow">OpenTelemetry</p><h2>Captured signals</h2></div>
          <div class="signal-counts"><span>{{ logs.length }} logs</span><span>{{ metrics.length }} metrics</span><span>{{ spans.length }} spans</span></div>
        </div>
        <div class="tabs" role="tablist" aria-label="Telemetry signals">
          <button v-for="tab in (['logs', 'metrics', 'traces'] as SignalTab[])" :key="tab" :class="{ active: activeTab === tab }" type="button" @click="activeTab = tab">{{ tab }}</button>
        </div>

        <div v-if="activeTab === 'logs'" class="log-list">
          <div v-for="(record, index) in logs" :key="`${record.timestamp}-${record.eventName}-${index}`" class="log-row">
            <time :datetime="record.timestamp">{{ formatUtcTime(record.timestamp) }}</time>
            <span class="log-severity" :data-level="record.severityText">{{ record.severityText }}</span>
            <code>{{ record.eventName }}</code>
            <strong>{{ record.body }}</strong>
          </div>
        </div>
        <div v-else-if="activeTab === 'metrics'" class="metric-grid">
          <article v-for="metric in metrics" :key="metric.name">
            <code>{{ metric.name }}</code>
            <strong>{{ metricValue(metric) }}</strong>
            <p>{{ metric.description }}</p>
          </article>
        </div>
        <div v-else class="span-list">
          <div v-for="span in spans" :key="span.spanId" class="span-row">
            <span class="span-status" :data-status="span.status.code" />
            <code>{{ span.name }}</code>
            <strong>{{ span.kind }}</strong>
            <small>{{ span.status.code }}</small>
            <small>{{ spanDuration(span) }} ms</small>
            <small class="trace-id">{{ span.traceId }}</small>
          </div>
        </div>
      </section>

      <section class="raw-payload">
        <details>
          <summary>View full submitted payload</summary>
          <p>Complete server-sanitized incident payload, including the agent report and host-attached diagnostic snapshot. Server-generated issue fields are excluded.</p>
          <pre><code>{{ submittedPayload }}</code></pre>
        </details>
      </section>
    </main>

    <main v-else-if="page === 'issues'" class="empty-state">
      <div class="empty-icon">✦</div>
      <h1>{{ loading ? 'Loading signals…' : 'No issues reported yet' }}</h1>
      <p>Reported issues will appear here with their context and recently captured OpenTelemetry signals.</p>
      <a href="/">Open site</a>
    </main>

    <main v-else-if="page === 'home'" class="workspace-page">
      <div class="crumb">Workspace / Overview</div>
      <h1>Workspace overview</h1>
      <p class="page-intro">A summary of reported issues and their attached OpenTelemetry evidence.</p>
      <section class="summary-grid">
        <article><small>Issues</small><strong>{{ issues.length }}</strong></article>
        <article><small>Logs</small><strong>{{ signalTotals.logs }}</strong></article>
        <article><small>Metrics</small><strong>{{ signalTotals.metrics }}</strong></article>
        <article><small>Spans</small><strong>{{ signalTotals.spans }}</strong></article>
      </section>
      <section class="recent-panel">
        <div><h2>Recent issues</h2><a href="/admin/issues" @click.prevent="navigate('/admin/issues')">View all</a></div>
        <a v-for="issue in issues.slice(0, 5)" :key="issue.id" :href="`/admin/issues/${encodeURIComponent(issue.id)}`" @click.prevent="navigate(`/admin/issues/${encodeURIComponent(issue.id)}`)">
          <span>{{ issue.id }}</span><strong>{{ issue.agentObservation.summary }}</strong><small>{{ formatUtcTimestamp(issue.agentObservation.timestamp) }}</small>
        </a>
        <p v-if="!loading && issues.length === 0">No issues have been reported.</p>
      </section>
    </main>

    <main v-else-if="page === 'signal-health'" class="workspace-page">
      <div class="crumb">Workspace / Signal health</div>
      <h1>Signal health</h1>
      <p class="page-intro">Coverage of each OpenTelemetry signal family across reported issues.</p>
      <section class="summary-grid">
        <article><small>Reported issues</small><strong>{{ issues.length }}</strong></article>
        <article><small>Issues with logs</small><strong>{{ signalCoverage.logs }}</strong></article>
        <article><small>Issues with metrics</small><strong>{{ signalCoverage.metrics }}</strong></article>
        <article><small>Issues with traces</small><strong>{{ signalCoverage.spans }}</strong></article>
      </section>
    </main>

    <main v-else class="workspace-page">
      <div class="crumb">Workspace / Settings</div>
      <h1>Settings</h1>
      <p class="page-intro">This reference app uses privacy-safe defaults configured by the host application.</p>
      <section class="settings-card">
        <div><span>Telemetry format</span><strong>OpenTelemetry-compatible</strong></div>
        <div><span>Issue storage</span><strong>In-memory demo store</strong></div>
        <div><span>Sensitive values</span><strong>Sanitized in browser and server</strong></div>
      </section>
    </main>
  </div>
</template>

<style scoped src="./admin-style.css"></style>
