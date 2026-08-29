import type { IncidentPayload } from "@tincan-webmcp/core";
import { describe, expect, it } from "vitest";
import { serializeIncidentPayload } from "./payload";

const incident = (): IncidentPayload => ({
  schemaVersion: "1.0",
  agentObservation: {
    timestamp: "2026-08-29T00:00:00.000Z",
    category: "wrong_result",
    severity: "blocking",
    summary: "Wrong result",
  },
  resource: { attributes: { "service.name": "test" } },
  instrumentationScope: { name: "@tincan-webmcp/browser", version: "0.1.0" },
  attributes: { "url.path": "/", "browser.visibility_state": "visible" },
  diagnostics: {
    resourceLogs: [{
      resource: { attributes: {} },
      scopeLogs: [{
        scope: { name: "test" },
        logRecords: Array.from({ length: 500 }, (_, index) => ({
          timestamp: "2026-08-29T00:00:00.000Z",
          observedTimestamp: "2026-08-29T00:00:00.000Z",
          eventName: "tincan.browser.console",
          severityText: "INFO",
          severityNumber: 9,
          body: `${index}:${"x".repeat(500)}`,
        })),
      }],
    }],
    resourceMetrics: [],
    resourceSpans: [],
  },
});

describe("incident payload serialization", () => {
  it("keeps a small payload unchanged", () => {
    const input = incident();
    input.diagnostics.resourceLogs[0]!.scopeLogs[0]!.logRecords.length = 1;
    const result = serializeIncidentPayload(input);
    expect(result.payload.diagnostics.truncated).toBeUndefined();
  });

  it("drops oldest evidence and marks an oversized payload as truncated", () => {
    const result = serializeIncidentPayload(incident());
    expect(new TextEncoder().encode(result.body).byteLength).toBeLessThanOrEqual(256_000);
    expect(result.payload.diagnostics.truncated).toBe(true);
    const records = result.payload.diagnostics.resourceLogs[0]!.scopeLogs[0]!.logRecords;
    expect(records.length).toBeLessThan(500);
    expect(records.at(-1)?.body).toMatch(/^499:/);
  });
});
