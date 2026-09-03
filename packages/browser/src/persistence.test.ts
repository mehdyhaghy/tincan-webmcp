import type { DiagnosticEvent } from "@tincan-webmcp/core";
import type { OtelSpan } from "@tincan-webmcp/otel";
import { describe, expect, it } from "vitest";
import { FlightRecorderStore, parseSnapshot, serializeSnapshot } from "./persistence";

const now = Date.parse("2026-09-03T10:00:00.000Z");

const event = (ageMs: number, body = "event"): DiagnosticEvent => ({
  timestamp: new Date(now - ageMs).toISOString(),
  observedTimestamp: new Date(now - ageMs).toISOString(),
  eventName: "tincan.browser.console",
  severityText: "INFO",
  severityNumber: 9,
  body,
});

const span = (ageMs: number, path = "/api/subscription"): OtelSpan => ({
  traceId: "1".repeat(32),
  spanId: "2".repeat(16),
  name: `GET ${path}`,
  kind: "CLIENT",
  startTime: new Date(now - ageMs - 50).toISOString(),
  endTime: new Date(now - ageMs).toISOString(),
  attributes: { "url.path": path, "http.request.duration_ms": 50, "http.request.method": "GET", "http.response.status_code": 200 },
  status: { code: "UNSET" },
  links: [],
});

describe("flight recorder persistence", () => {
  it("round-trips a snapshot and prunes entries outside the window", () => {
    const serialized = serializeSnapshot({ events: [event(5_000), event(200_000, "stale")], spans: [span(1_000), span(200_000, "/stale")] }, now, 256_000);
    const restored = parseSnapshot(serialized, now, 120_000);
    expect(restored.events.map((entry) => entry.body)).toEqual(["event"]);
    expect(restored.spans.map((entry) => entry.name)).toEqual(["GET /api/subscription"]);
  });

  it("drops the oldest entries until the snapshot fits the byte budget", () => {
    const spans = Array.from({ length: 40 }, (_, index) => span(40_000 - index * 1_000, `/api/item-${index}`));
    const serialized = serializeSnapshot({ events: [], spans }, now, 4_000);
    expect(new TextEncoder().encode(serialized).byteLength).toBeLessThanOrEqual(4_000);
    const restored = parseSnapshot(serialized, now, 120_000);
    expect(restored.spans.length).toBeGreaterThan(0);
    expect(restored.spans.at(-1)?.name).toBe("GET /api/item-39");
  });

  it("ignores malformed, foreign, or partially corrupted data", () => {
    expect(parseSnapshot(null, now, 120_000)).toEqual({ events: [], spans: [] });
    expect(parseSnapshot("{not json", now, 120_000)).toEqual({ events: [], spans: [] });
    expect(parseSnapshot(JSON.stringify({ version: 2, events: [], spans: [] }), now, 120_000)).toEqual({ events: [], spans: [] });
    const mixed = JSON.stringify({ version: 1, savedAt: "x", events: [event(1_000), { nope: true }], spans: [span(1_000), 42] });
    const restored = parseSnapshot(mixed, now, 120_000);
    expect(restored.events).toHaveLength(1);
    expect(restored.spans).toHaveLength(1);
  });

  it("treats storage failures as an empty window", () => {
    const broken = {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("quota"); },
      removeItem: () => { throw new Error("blocked"); },
    };
    const store = new FlightRecorderStore({ key: "test", storage: broken });
    expect(store.available).toBe(true);
    expect(store.load(now, 120_000)).toEqual({ events: [], spans: [] });
    expect(() => store.save({ events: [event(0)], spans: [] }, now, 1_000)).not.toThrow();
    expect(() => store.clear()).not.toThrow();
  });
});
