import type { TinCanRecorder } from "@tincan-webmcp/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerReportSiteIssue } from "./index";

describe("report_site_issue registration", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns exactly the agent-visible status and incident ID", async () => {
    let registeredTool: ModelContextTool | undefined;
    const registerTool = vi.fn(async (tool: ModelContextTool) => {
      registeredTool = tool;
    });
    vi.stubGlobal("document", { modelContext: { registerTool } });
    const reportIssue = vi.fn(async () => ({
      status: "reported" as const,
      incidentId: "INC-2042",
      privateDiagnostics: "must not escape",
    }));
    const recorder = { reportIssue } as unknown as TinCanRecorder;

    await expect(registerReportSiteIssue(recorder)).resolves.toBe(true);
    expect(registerTool).toHaveBeenCalledOnce();
    const result = await registeredTool!.execute({
      category: "wrong_result",
      severity: "blocking",
      summary: "Persisted state differs",
    }, { signal: new AbortController().signal });

    expect(result).toEqual({ status: "reported", incidentId: "INC-2042" });
    expect(Object.keys(result as object)).toEqual(["status", "incidentId"]);
  });

  it("does nothing when WebMCP is unavailable", async () => {
    vi.stubGlobal("document", {});
    const recorder = { reportIssue: vi.fn() } as unknown as TinCanRecorder;
    await expect(registerReportSiteIssue(recorder)).resolves.toBe(false);
  });
});
