import { describe, expect, it } from "vitest";
import { DiagnosticRingBuffer } from "./ring-buffer";
import type { DiagnosticEvent } from "./types";

const record = (timestamp: string, body: string): DiagnosticEvent => ({
  timestamp,
  observedTimestamp: timestamp,
  eventName: "tincan.test.event",
  severityText: "INFO",
  severityNumber: 9,
  body,
});

describe("diagnostic ring buffer", () => {
  it("evicts records outside the time window", () => {
    const buffer = new DiagnosticRingBuffer({ maxAgeMs: 1_000 });
    buffer.push(record("2026-01-01T00:00:00.000Z", "old"), Date.parse("2026-01-01T00:00:00.000Z"));
    buffer.push(record("2026-01-01T00:00:02.000Z", "new"), Date.parse("2026-01-01T00:00:02.000Z"));
    expect(buffer.snapshot(Date.parse("2026-01-01T00:00:02.000Z")).map((item) => item.body)).toEqual(["new"]);
  });

  it("enforces the event limit with FIFO eviction", () => {
    const buffer = new DiagnosticRingBuffer({ maxEvents: 2 });
    const now = Date.parse("2026-01-01T00:00:00.000Z");
    buffer.push(record(new Date(now).toISOString(), "one"), now);
    buffer.push(record(new Date(now + 1).toISOString(), "two"), now + 1);
    buffer.push(record(new Date(now + 2).toISOString(), "three"), now + 2);
    expect(buffer.snapshot(now + 2).map((item) => item.body)).toEqual(["two", "three"]);
  });
});
