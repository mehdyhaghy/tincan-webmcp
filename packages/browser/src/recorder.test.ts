import type { TinCanFlightRecorderSpanProcessor } from "@tincan-webmcp/otel-instrumentation";
import type { OtelSpan } from "@tincan-webmcp/otel";
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

  it("restores a persisted window on start and saves it when the page is hidden", () => {
    vi.useFakeTimers();
    const listeners = new Map<string, () => void>();
    vi.stubGlobal("window", {
      addEventListener: (name: string, handler: () => void) => listeners.set(`window:${name}`, handler),
      removeEventListener: (name: string) => listeners.delete(`window:${name}`),
    });
    vi.stubGlobal("document", {
      visibilityState: "visible",
      addEventListener: (name: string, handler: () => void) => listeners.set(`document:${name}`, handler),
      removeEventListener: (name: string) => listeners.delete(`document:${name}`),
    });
    vi.stubGlobal("location", { href: "https://example.test/billing", pathname: "/billing" });
    const now = Date.now();
    const iso = (ageMs: number) => new Date(now - ageMs).toISOString();
    const persistedSpan = (ageMs: number, path: string): OtelSpan => ({
      traceId: "1".repeat(32),
      spanId: "2".repeat(16),
      name: `POST ${path}`,
      kind: "CLIENT",
      startTime: iso(ageMs + 40),
      endTime: iso(ageMs),
      attributes: { "url.path": path, "http.request.duration_ms": 40, "http.request.method": "POST", "http.response.status_code": 200 },
      status: { code: "UNSET" },
      links: [],
    });
    const stored = new Map<string, string>();
    stored.set("tincan:test", JSON.stringify({
      version: 1,
      savedAt: iso(0),
      events: [
        { timestamp: iso(8_000), observedTimestamp: iso(8_000), eventName: "tincan.browser.console", severityText: "WARN", severityNumber: 13, body: "restored" },
        { timestamp: iso(300_000), observedTimestamp: iso(300_000), eventName: "tincan.browser.console", severityText: "WARN", severityNumber: 13, body: "stale" },
      ],
      spans: [persistedSpan(9_000, "/api/licenses"), persistedSpan(300_000, "/stale")],
    }));
    const storage = {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => void stored.set(key, value),
      removeItem: (key: string) => void stored.delete(key),
    };
    const restoredSpans: OtelSpan[] = [];
    const spanProcessor = {
      snapshot: () => restoredSpans,
      restore: (spans: OtelSpan[]) => restoredSpans.push(...spans),
    } as unknown as TinCanFlightRecorderSpanProcessor;
    const recorder = createTinCan({
      application: { name: "test-app" },
      spanProcessor,
      persistence: { key: "tincan:test", storage },
    });

    recorder.start();
    expect(restoredSpans.map((span) => span.name)).toEqual(["POST /api/licenses"]);
    expect(recorder.buffer.snapshot().map((event) => event.body)).toEqual(["restored", "/billing"]);

    listeners.get("window:pagehide")?.();
    const saved = JSON.parse(stored.get("tincan:test") ?? "{}") as { events: Array<{ eventName: string }>; spans: OtelSpan[] };
    expect(saved.events.map((event) => event.eventName)).toEqual(["tincan.browser.console", "tincan.browser.navigation"]);
    expect(saved.spans).toHaveLength(1);

    recorder.stop();
    expect(listeners.size).toBe(0);
    vi.useRealTimers();
  });
});

