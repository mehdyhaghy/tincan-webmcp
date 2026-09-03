import { SpanKind, SpanStatusCode, type HrTime } from "@opentelemetry/api";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";
import type { OtelSpan } from "@tincan-webmcp/otel";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_DIAGNOSTIC_WINDOW_MS,
  TinCanFlightRecorderSpanProcessor,
} from "./flight-recorder-span-processor";

const hrTime = (timestamp: number): HrTime => [
  Math.floor(timestamp / 1_000),
  Math.floor(timestamp % 1_000) * 1_000_000,
];

const readableSpan = (input: {
  start: number;
  end: number;
  path?: string;
  method?: string;
  status?: number;
  source?: string;
}): ReadableSpan => ({
  name: input.method ?? "HTTP",
  kind: SpanKind.CLIENT,
  spanContext: () => ({
    traceId: "1".repeat(32),
    spanId: "2".repeat(16),
    traceFlags: 1,
  }),
  startTime: hrTime(input.start),
  endTime: hrTime(input.end),
  duration: hrTime(input.end - input.start),
  status: { code: (input.status ?? 200) >= 400 ? SpanStatusCode.ERROR : SpanStatusCode.UNSET },
  attributes: {
    "url.full": `https://example.test${input.path ?? "/api/subscription"}?token=secret`,
    ...(input.method ? { "http.request.method": input.method } : {}),
    "http.response.status_code": input.status ?? 200,
    ...(input.source ? { "tincan.capture.source": input.source } : {}),
  },
  links: [],
  events: [],
  ended: true,
  resource: { attributes: {}, asyncAttributesPending: false },
  instrumentationScope: { name: "@opentelemetry/instrumentation-fetch" },
  droppedAttributesCount: 0,
  droppedEventsCount: 0,
  droppedLinksCount: 0,
}) as unknown as ReadableSpan;

describe("TinCanFlightRecorderSpanProcessor", () => {
  it("converts official OpenTelemetry spans into sanitized incident spans", () => {
    const now = Date.now();
    const processor = new TinCanFlightRecorderSpanProcessor({
      sanitizePath: (url) => new URL(url).pathname,
    });
    processor.onEnd(readableSpan({
      start: now - 250,
      end: now,
      path: "/api/licenses/remove",
      method: "POST",
      status: 504,
    }));

    expect(processor.snapshot(now)).toMatchObject([{
      name: "POST /api/licenses/remove",
      kind: "CLIENT",
      attributes: {
        "url.path": "/api/licenses/remove",
        "http.request.method": "POST",
        "http.response.status_code": 504,
      },
      status: { code: "ERROR" },
    }]);
    expect(JSON.stringify(processor.snapshot(now))).not.toContain("token=secret");
  });

  it("matches a resource timing entry to an existing OpenTelemetry request span", () => {
    const now = Date.now();
    const processor = new TinCanFlightRecorderSpanProcessor({
      sanitizePath: (url) => new URL(url).pathname,
    });
    processor.onEnd(readableSpan({ start: now - 100, end: now, path: "/api/licenses/remove" }));
    expect(processor.hasMatchingRequest("/api/licenses/remove", now - 100)).toBe(true);
  });

  it("replaces a fallback span when the richer fetch span finishes", () => {
    const now = Date.now();
    const processor = new TinCanFlightRecorderSpanProcessor({
      sanitizePath: (url) => new URL(url).pathname,
    });
    processor.onEnd(readableSpan({
      start: now - 100,
      end: now - 50,
      path: "/api/subscription",
      source: "resource_timing",
    }));
    processor.onEnd(readableSpan({
      start: now - 100,
      end: now,
      path: "/api/subscription",
      method: "GET",
    }));
    expect(processor.snapshot(now)).toMatchObject([{
      name: "GET /api/subscription",
      attributes: { "http.request.method": "GET" },
    }]);
  });

  it("evicts spans outside the 120-second window", () => {
    expect(DEFAULT_DIAGNOSTIC_WINDOW_MS).toBe(120_000);
    const now = Date.now();
    const processor = new TinCanFlightRecorderSpanProcessor();
    processor.onEnd(readableSpan({ start: now - 120_500, end: now - 120_001 }));
    processor.onEnd(readableSpan({ start: now - 100, end: now }));
    expect(processor.snapshot(now)).toHaveLength(1);
  });

  it("restores persisted spans in chronological order and prunes stale ones", () => {
    const processor = new TinCanFlightRecorderSpanProcessor({ maxAgeMs: 60_000 });
    // onEnd prunes with the wall clock, so anchor the fixture to it.
    const now = Date.now();
    const persisted = (input: { start: number; end: number; path: string }): OtelSpan => ({
      traceId: "3".repeat(32),
      spanId: "4".repeat(16),
      name: `GET ${input.path}`,
      kind: "CLIENT",
      startTime: new Date(input.start).toISOString(),
      endTime: new Date(input.end).toISOString(),
      attributes: { "url.path": input.path, "http.request.duration_ms": input.end - input.start, "http.request.method": "GET", "http.response.status_code": 200 },
      status: { code: "UNSET" },
      links: [],
    });
    processor.onEnd(readableSpan({ start: now - 5_000, end: now - 4_000, method: "POST", path: "/api/licenses" }));
    processor.restore([
      persisted({ start: now - 20_000, end: now - 19_000, path: "/api/subscription" }),
      persisted({ start: now - 90_000, end: now - 89_000, path: "/stale" }),
    ], now);
    expect(processor.snapshot(now).map((span) => span.name)).toEqual(["GET /api/subscription", "POST /api/licenses"]);
    expect(processor.hasMatchingRequest("/api/subscription", now - 20_000)).toBe(true);
  });
});
