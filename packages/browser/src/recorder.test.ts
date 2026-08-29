import type { TinCanFlightRecorderSpanProcessor } from "@tincan-webmcp/otel-instrumentation";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTinCan, createTinCanEndpointPattern } from "./recorder";

describe("TinCan recorder", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("assembles a private payload but returns only the report confirmation", async () => {
    vi.stubGlobal("location", { href: "https://example.test/billing?token=secret", pathname: "/billing" });
    vi.stubGlobal("document", { visibilityState: "visible" });
    let submittedBody = "";
    const transport = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      submittedBody = String(init?.body ?? "");
      return Response.json({ status: "reported", incidentId: "INC-1042" });
    }) as unknown as typeof fetch;
    const spanProcessor = { snapshot: () => [] } as unknown as TinCanFlightRecorderSpanProcessor;
    const recorder = createTinCan({
      application: { name: "test-app" },
      fetch: transport,
      spanProcessor,
    });

    const result = await recorder.reportIssue({
      category: "wrong_result",
      severity: "blocking",
      summary: "Saved value differs",
      expected: "11",
      observed: "12",
    });

    expect(result).toEqual({ status: "reported", incidentId: "INC-1042" });
    expect(transport).toHaveBeenCalledWith("/_tincan/issues", expect.objectContaining({
      method: "POST",
      credentials: "same-origin",
    }));
    const submitted = JSON.parse(submittedBody) as Record<string, unknown>;
    expect(submitted).toHaveProperty("diagnostics");
    expect(JSON.stringify(submitted)).not.toContain("token=secret");
  });

  it("excludes the TinCan ingestion endpoint without hiding similar routes", () => {
    const pattern = createTinCanEndpointPattern();
    expect(pattern.test("https://example.test/_tincan/issues")).toBe(true);
    expect(pattern.test("https://example.test/_tincan/issues?retry=1")).toBe(true);
    expect(pattern.test("https://example.test/_tincan/issues-preview")).toBe(false);
  });
});
