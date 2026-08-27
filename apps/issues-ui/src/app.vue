<script setup lang="ts">
import type { IncidentPayload, OtelLogRecord, OtelMetric, OtelSpan } from "@tincan-webmcp/browser";
import { computed, onMounted, ref } from "vue";

interface StoredIncident extends IncidentPayload {
  id: string;
  fingerprint: string;
  classification: { semanticOnly: boolean };
}

type SignalTab = "logs" | "metrics" | "traces";

const issues = ref<StoredIncident[]>([]);
const selectedId = ref("");
const activeTab = ref<SignalTab>("logs");
const loading = ref(true);

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
  if (!selectedId.value && body.issues[0]) selectedId.value = body.issues[0].id;
  loading.value = false;
}

onMounted(loadIssues);
</script>

<template>
  <div class="app-shell">
    <header>
      <a class="brand" href="/"><span class="brand-mark">T</span><strong>TinCan</strong><i>signals</i></a>
      <div class="header-actions">
        <span class="live"><b /> Live</span>
        <button type="button" @click="loadIssues">Refresh</button>
      </div>
    </header>

    <aside>
      <p class="nav-label">Workspace</p>
      <nav><a class="active" href="#">Issues <span>{{ issues.length }}</span></a><a href="#">Signal health</a><a href="#">Settings</a></nav>
      <p class="nav-label issue-label">Recent issues</p>
      <button
        v-for="issue in issues"
        :key="issue.id"
        class="issue-item"
        :class="{ selected: issue.id === selected?.id }"
        type="button"
        @click="selectedId = issue.id"
      >
        <span>{{ issue.id }}</span>
        <strong>{{ issue.agentObservation.summary }}</strong>
        <small>{{ issue.agentObservation.severity }} · {{ issue.attributes['url.path'] }}</small>
      </button>
    </aside>

    <main v-if="selected">
      <div class="crumb">Issues / {{ selected.id }}</div>
      <section class="title-row">
        <div>
          <div class="title-meta"><span class="severity">{{ selected.agentObservation.severity }}</span><span>{{ selected.id }}</span></div>
          <h1>{{ selected.agentObservation.summary }}</h1>
          <p>Agent reported · {{ selected.resource.attributes['deployment.environment.name'] }} · {{ appName }} {{ appVersion }}</p>
        </div>
        <span class="semantic-badge">Semantic-only incident</span>
      </section>

      <section class="observation">
        <div class="observation-label"><span>✦</span><strong>Agent observation</strong><small>{{ Math.round((selected.agentObservation.confidence ?? 0) * 100) }}% confidence</small></div>
        <div class="comparison">
          <div><small>Expected</small><strong>{{ selected.agentObservation.expected }}</strong></div>
          <span>≠</span>
          <div><small>Observed</small><strong class="observed">{{ selected.agentObservation.observed }}</strong></div>
          <div class="operation"><small>Operation</small><code>{{ selected.agentObservation.operation }}</code></div>
        </div>
      </section>

      <section class="health">
        <div><span class="health-icon">✓</span><div><small>Technical status</small><strong>No technical failure detected</strong></div></div>
        <ul><li><b>✓</b> Requests succeeded</li><li><b>✓</b> 0 JS exceptions</li><li><b>✓</b> Performance healthy</li></ul>
      </section>

      <section class="signals">
        <div class="signals-heading">
          <div><p class="eyebrow">OpenTelemetry</p><h2>Correlated signals</h2></div>
          <div class="signal-counts"><span>{{ logs.length }} logs</span><span>{{ metrics.length }} metrics</span><span>{{ spans.length }} spans</span></div>
        </div>
        <div class="tabs" role="tablist" aria-label="Telemetry signals">
          <button v-for="tab in (['logs', 'metrics', 'traces'] as SignalTab[])" :key="tab" :class="{ active: activeTab === tab }" type="button" @click="activeTab = tab">{{ tab }}</button>
        </div>

        <div v-if="activeTab === 'logs'" class="log-list">
          <div v-for="record in logs" :key="record.timestamp + record.eventName" class="log-row">
            <time>{{ new Date(record.timestamp).toLocaleTimeString([], { hour12: false }) }}</time>
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
            <strong>{{ span.attributes['http.response.status_code'] }}</strong>
            <small>{{ span.attributes['http.request.duration_ms'] }} ms</small>
            <small class="trace-id">{{ span.traceId }}</small>
          </div>
        </div>
      </section>
    </main>

    <main v-else class="empty-state">
      <div class="empty-icon">✦</div>
      <h1>{{ loading ? 'Loading signals…' : 'No issues reported yet' }}</h1>
      <p>Run the canonical semantic failure from the Acme Cloud billing demo, then return here.</p>
      <a href="http://127.0.0.1:5173">Open demo</a>
    </main>
  </div>
</template>
