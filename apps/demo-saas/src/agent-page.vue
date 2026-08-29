<script setup lang="ts">
import { ref } from "vue";

type RegisteredTool = RegisteredModelContextTool;

interface AgentStep {
  id: number;
  title: string;
  detail: string;
  tone: "neutral" | "success" | "failure";
}

const goal = ref("Add 1 license to the subscription and verify the saved result.");
const iframeReady = ref(false);
const running = ref(false);
const steps = ref<AgentStep[]>([]);
const discoveredTools = ref<string[]>([]);
let nextStepId = 1;

function addStep(title: string, detail: string, tone: AgentStep["tone"] = "neutral"): void {
  steps.value.push({ id: nextStepId++, title, detail, tone });
}

function words(value: string): string[] {
  return value.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 2);
}

function scoreTool(tool: RegisteredTool, intent: string): number {
  const intentWords = new Set(words(intent));
  return words(`${tool.name} ${tool.title ?? ""} ${tool.description}`)
    .reduce((score, word) => score + (intentWords.has(word) ? 1 : 0), 0);
}

function parseSchema(tool: RegisteredTool): Record<string, unknown> {
  return typeof tool.inputSchema === "string"
    ? JSON.parse(tool.inputSchema) as Record<string, unknown>
    : tool.inputSchema;
}

function parseResult(raw: string): unknown {
  let value: unknown = JSON.parse(raw);
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { return value; }
  }
  return value;
}

function buildInput(tool: RegisteredTool, intent: string): Record<string, unknown> {
  const schema = parseSchema(tool);
  const properties = (schema.properties ?? {}) as Record<string, { type?: string }>;
  const required = Array.isArray(schema.required) ? schema.required as string[] : [];
  const number = Number(intent.match(/\b\d+\b/)?.[0]);
  const input: Record<string, unknown> = {};
  for (const name of required) {
    const type = properties[name]?.type;
    if ((type === "integer" || type === "number") && Number.isFinite(number)) input[name] = number;
  }
  return input;
}

function numericField(value: unknown, stem: string): [string, number] | undefined {
  if (!value || typeof value !== "object") return undefined;
  return Object.entries(value as Record<string, unknown>)
    .find(([key, candidate]) => typeof candidate === "number" && key.toLowerCase().includes(stem)) as [string, number] | undefined;
}

function failureStatus(value: unknown): number | undefined {
  if (!value || typeof value !== "object") return undefined;
  const status = Number((value as Record<string, unknown>).status);
  return Number.isFinite(status) && status >= 400 ? status : undefined;
}

async function runAgent(): Promise<void> {
  running.value = true;
  steps.value = [];
  discoveredTools.value = [];
  try {
    const model = document.modelContext;
    if (!model) throw new Error("This browser does not expose WebMCP. Enable Chrome's WebMCP testing flag and reload.");

    addStep("Read goal", goal.value);
    const tools = await model.getTools();
    discoveredTools.value = tools.map((tool) => tool.name);
    addStep("Discover WebMCP tools", `Found ${discoveredTools.value.join(", ")}.`);

    const reportTool = tools.find((tool) => tool.name === "report_site_issue");
    const businessTools = tools.filter((tool) => tool.name !== "report_site_issue");
    const actionTool = businessTools
      .filter((tool) => !tool.annotations?.readOnlyHint)
      .sort((a, b) => scoreTool(b, goal.value) - scoreTool(a, goal.value))[0];
    if (!reportTool || !actionTool || scoreTool(actionTool, goal.value) === 0) throw new Error("The required WebMCP tools were not discovered.");

    const input = buildInput(actionTool, goal.value);
    addStep("Choose business action", `Selected ${actionTool.name} from its WebMCP metadata and schema.`);
    const actionResult = parseResult(await model.executeTool(actionTool, JSON.stringify(input)));
    const failedStatus = failureStatus(actionResult);
    addStep("Execute tool", `${actionTool.name} returned ${JSON.stringify(actionResult)}.`, failedStatus ? "failure" : "success");

    let reportInput: Record<string, unknown> | undefined;
    if (failedStatus) {
      addStep("Detect failure", `${actionTool.name} returned HTTP ${failedStatus}.`, "failure");
      reportInput = {
        category: "network_failure",
        severity: "degraded",
        summary: `${actionTool.title ?? actionTool.name} failed`,
        description: `The browser agent discovered ${actionTool.name}, executed it, and observed a failed status.`,
        expected: goal.value,
        observed: `HTTP ${failedStatus}: ${JSON.stringify(actionResult)}`,
        operation: actionTool.name,
      };
    } else {
      const verifier = businessTools.find((tool) => tool.annotations?.readOnlyHint);
      if (!verifier) throw new Error("No read-only verification tool was discovered.");
      addStep("Choose verification", `Selected read-only tool ${verifier.name}.`);
      const verification = parseResult(await model.executeTool(verifier, "{}"));
      addStep("Read saved state", `${verifier.name} returned ${JSON.stringify(verification)}.`);

      const expected = numericField(actionResult, "expectedlicensecount");
      const observed = numericField(verification, "licensecount");
      if (!expected || !observed || expected[1] === observed[1]) {
        addStep("Complete", "The saved result matches the available verification evidence.", "success");
        return;
      }
      addStep("Detect mismatch", `Expected ${expected[1]} licenses; observed ${observed[1]}.`, "failure");
      const count = Number(Object.values(input).find((value) => typeof value === "number") ?? 0);
      reportInput = {
        category: "wrong_result",
        severity: "blocking",
        summary: "Adding licenses produced an incorrect total",
        description: `The browser agent discovered ${actionTool.name}, added ${count} licenses, and verified a different persisted total.`,
        expected: `${expected[1]} licenses`,
        observed: `${observed[1]} licenses`,
        operation: actionTool.name,
      };
    }

    addStep("Choose reporting tool", "Selected report_site_issue after verifying the failure.");
    const report = parseResult(await model.executeTool(reportTool, JSON.stringify(reportInput)));
    addStep("Report issue", `TinCan returned ${JSON.stringify(report)}.`, "success");
  } catch (error) {
    addStep("Agent stopped", error instanceof Error ? error.message : "Unknown agent error.", "failure");
  } finally {
    running.value = false;
  }
}
</script>

<template>
  <div class="agent-page">
    <header>
      <a class="brand" href="/agent"><span>T</span><strong>TinCan browser agent</strong></a>
      <nav><a href="/">Open site</a><a href="/admin/overview">Open admin</a></nav>
    </header>
    <main>
      <section class="agent-panel">
        <p class="eyebrow">WebMCP browser agent</p>
        <h1>Browser agent</h1>
        <p class="intro">The agent starts with a goal, discovers tools from the embedded website, and executes WebMCP directly. It never clicks or reads the product UI.</p>
        <label for="agent-goal">User goal</label>
        <textarea id="agent-goal" v-model="goal" rows="3" />
        <div class="agent-actions">
          <button type="button" :disabled="running || !iframeReady" @click="runAgent">{{ running ? 'Agent working…' : 'Run browser agent' }}</button>
          <small>{{ iframeReady ? 'Website loaded' : 'Loading website…' }}</small>
        </div>
        <div v-if="discoveredTools.length" class="discovered"><span>Discovered via WebMCP</span><code v-for="tool in discoveredTools" :key="tool">{{ tool }}</code></div>
        <div class="steps">
          <p v-if="steps.length === 0">The agent has not taken any action.</p>
          <article v-for="step in steps" :key="step.id" :data-tone="step.tone"><strong>{{ step.title }}</strong><span>{{ step.detail }}</span></article>
        </div>
      </section>
      <section class="site-frame">
        <div><strong>Target website</strong><span>Human UI and WebMCP tools share the same operations</span></div>
        <iframe title="Acme Cloud target website" src="/?agent-target=1" @load="iframeReady = true" />
      </section>
    </main>
  </div>
</template>

<style scoped src="./agent-style.css"></style>
