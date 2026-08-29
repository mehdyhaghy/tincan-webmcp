import type { OtelLogRecord, OtelTelemetrySnapshot } from "@tincan-webmcp/otel";

export const MAX_INCIDENT_BYTES = 256_000;

export type IssueCategory =
  | "wrong_result"
  | "unexpected_behavior"
  | "action_failed"
  | "network_failure"
  | "performance"
  | "ui_state_mismatch"
  | "other";

export type IssueSeverity = "info" | "degraded" | "blocking";

export interface ReportSiteIssueInput {
  category: IssueCategory;
  severity: IssueSeverity;
  summary: string;
  description?: string;
  expected?: string;
  observed?: string;
  operation?: string;
}

export type DiagnosticEvent = OtelLogRecord;

export interface IncidentPayload {
  schemaVersion: "1.0";
  agentObservation: ReportSiteIssueInput & { timestamp: string };
  resource: { attributes: Record<string, string> };
  instrumentationScope: { name: "@tincan-webmcp/browser"; version: string };
  attributes: { "url.path": string; "browser.visibility_state": string };
  diagnostics: OtelTelemetrySnapshot & { truncated?: boolean };
  correlation?: { traceId?: string; spanId?: string; requestIds?: string[] };
}

export interface ReportResult {
  status: "reported";
  incidentId: string;
}
