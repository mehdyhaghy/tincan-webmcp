import { sanitizeValueWithMetadata, type IncidentPayload } from "@tincan-webmcp/core";

export interface StoredIncident extends IncidentPayload {
  id: string;
  fingerprint: string;
  classification: { semanticOnly: boolean };
}

const categories = new Set([
  "wrong_result",
  "unexpected_behavior",
  "action_failed",
  "network_failure",
  "performance",
  "ui_state_mismatch",
  "other",
]);
const severities = new Set(["info", "degraded", "blocking"]);

const failedSpanCount = (payload: IncidentPayload): number => payload.diagnostics.resourceSpans
  .flatMap((group) => group.scopeSpans.flatMap((scope) => scope.spans))
  .filter((span) =>
    span.status.code === "ERROR" ||
    Number(span.attributes["http.response.status_code"] ?? 0) >= 400,
  ).length;

export function validateIncident(input: unknown): asserts input is IncidentPayload {
  if (!input || typeof input !== "object") throw new TypeError("Incident payload must be an object");
  const payload = input as Partial<IncidentPayload>;
  const issue = payload.agentObservation;
  if (payload.schemaVersion !== "1.0" || !issue) throw new TypeError("Unsupported incident schema");
  if (!categories.has(issue.category) || !severities.has(issue.severity)) throw new TypeError("Invalid issue category or severity");
  if (!issue.summary || issue.summary.length > 300) throw new TypeError("Invalid issue summary");
  if ((issue.description?.length ?? 0) > 2_000 || (issue.expected?.length ?? 0) > 1_000 || (issue.observed?.length ?? 0) > 1_000) {
    throw new TypeError("Issue field exceeds its limit");
  }
  if (!Array.isArray(payload.diagnostics?.resourceLogs)) throw new TypeError("OTLP resource logs are required");
  if (!Array.isArray(payload.diagnostics?.resourceMetrics)) throw new TypeError("OTLP resource metrics are required");
  if (!Array.isArray(payload.diagnostics?.resourceSpans)) throw new TypeError("OTLP resource spans are required");
}

export function prepareIncident(input: unknown, sequence: number): StoredIncident {
  validateIncident(input);
  const sanitizedResult = sanitizeValueWithMetadata(input, {
    maxArrayItems: 500,
    maxObjectEntries: 100,
  });
  const sanitized = sanitizedResult.value as IncidentPayload;
  if (sanitizedResult.truncated) sanitized.diagnostics.truncated = true;
  const records = sanitized.diagnostics.resourceLogs.flatMap((group) =>
    group.scopeLogs.flatMap((scope) => scope.logRecords),
  );
  const jsErrorCount = records.filter((record) => record.eventName === "tincan.browser.error").length;
  const semanticOnly = sanitized.agentObservation.severity !== "info" &&
    jsErrorCount === 0 &&
    failedSpanCount(sanitized) === 0;
  const id = `INC-${String(1041 + sequence).padStart(4, "0")}`;
  const fingerprint = [
    sanitized.agentObservation.category,
    sanitized.agentObservation.operation ?? "unknown",
    sanitized.attributes["url.path"],
  ].join(":");
  return { ...sanitized, id, fingerprint, classification: { semanticOnly } };
}

export class MemoryIssueStore {
  readonly #incidents: StoredIncident[] = [];
  #nextSequence = 1;

  create(payload: unknown): StoredIncident {
    const incident = prepareIncident(payload, this.#nextSequence);
    this.#nextSequence += 1;
    this.#incidents.unshift(incident);
    return incident;
  }

  list(): StoredIncident[] {
    return JSON.parse(JSON.stringify(this.#incidents)) as StoredIncident[];
  }

  clear(): void {
    this.#incidents.length = 0;
  }
}
