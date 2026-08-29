import type { ReportResult, ReportSiteIssueInput, TinCanRecorder } from "@tincan-webmcp/browser";
import "./webmcp.d.ts";

export const REPORT_SITE_ISSUE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    category: {
      type: "string",
      enum: [
        "wrong_result",
        "unexpected_behavior",
        "action_failed",
        "network_failure",
        "performance",
        "ui_state_mismatch",
        "other",
      ],
    },
    severity: { type: "string", enum: ["info", "degraded", "blocking"] },
    summary: { type: "string", maxLength: 300 },
    description: { type: "string", maxLength: 2_000 },
    expected: { type: "string", maxLength: 1_000 },
    observed: { type: "string", maxLength: 1_000 },
    operation: { type: "string", maxLength: 200 },
  },
  required: ["category", "severity", "summary"],
} as const;

const isReportInput = (value: unknown): value is ReportSiteIssueInput => {
  if (!value || typeof value !== "object") return false;
  const input = value as Record<string, unknown>;
  return typeof input.category === "string" && typeof input.severity === "string" && typeof input.summary === "string";
};

export interface ReportSiteIssueLifecycle {
  onStart?(input: ReportSiteIssueInput): void;
  onSuccess?(result: ReportResult, input: ReportSiteIssueInput): void;
  onError?(error: unknown, input: ReportSiteIssueInput): void;
}

export async function registerReportSiteIssue(
  recorder: TinCanRecorder,
  signal?: AbortSignal,
  lifecycle?: ReportSiteIssueLifecycle,
): Promise<boolean> {
  if (!document.modelContext) return false;

  // Kept concrete and public so reviewers can verify genuine WebMCP usage.
  await document.modelContext.registerTool(
    {
      name: "report_site_issue",
      title: "Report site issue",
      description:
        "Report a site operation that failed, timed out, or produced an unexpected persisted result. Verify the result first when a read tool is available, then describe the expected and observed behavior.",
      inputSchema: REPORT_SITE_ISSUE_SCHEMA,
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: async (input) => {
        if (!isReportInput(input)) throw new TypeError("Invalid report_site_issue input");
        lifecycle?.onStart?.(input);
        try {
          const result = await recorder.reportIssue(input);
          lifecycle?.onSuccess?.(result, input);
          return { status: result.status, incidentId: result.incidentId };
        } catch (error) {
          lifecycle?.onError?.(error, input);
          throw error;
        }
      },
    },
    signal ? { signal } : undefined,
  );
  return true;
}
