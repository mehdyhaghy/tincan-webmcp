import { describe, expect, it } from "vitest";
import type { IncidentPayload } from "@tincan-webmcp/core";
import { MemoryIssueStore, prepareIncident } from "./index";

const payload = (): IncidentPayload => ({
  schemaVersion: "1.0",
  agentObservation: {
    timestamp: "2026-08-27T12:00:00.000Z",
    category: "wrong_result",
    severity: "blocking",
    summary: "Wrong license total",
    expected: "20 licenses",
    observed: "19 licenses",
    operation: "add_licenses",
  },
  resource: { attributes: { "service.name": "acme-saas" } },
  instrumentationScope: { name: "@tincan-webmcp/browser", version: "0.1.0" },
  attributes: { "url.path": "/settings/billing", "browser.visibility_state": "visible" },
  diagnostics: {
    resourceLogs: [{
      resource: { attributes: { "service.name": "acme-saas" } },
      scopeLogs: [{ scope: { name: "@tincan-webmcp/browser" }, logRecords: [] }],
    }],
    resourceMetrics: [{
      resource: { attributes: { "service.name": "acme-saas" } },
      scopeMetrics: [{ scope: { name: "@tincan-webmcp/browser" }, metrics: [] }],
    }],
    resourceSpans: [{
      resource: { attributes: { "service.name": "acme-saas" } },
      scopeSpans: [{ scope: { name: "@tincan-webmcp/browser" }, spans: [] }],
    }],
  },
});

describe("server incident preparation", () => {
  it("classifies the canonical failure as semantic-only", () => {
    const incident = prepareIncident(payload(), 1);
    expect(incident.id).toBe("INC-1042");
    expect(incident.classification.semanticOnly).toBe(true);
  });

  it("re-sanitizes agent and diagnostic values", () => {
    const input = payload();
    input.agentObservation.description = "Authorization: Bearer top-secret-token";
    const incident = prepareIncident(input, 1);
    expect(incident.agentObservation.description).not.toContain("top-secret-token");
  });

  it("preserves valid nested OTLP signal structures", () => {
    const incident = prepareIncident(payload(), 1);
    expect(incident.diagnostics.resourceLogs[0]?.scopeLogs[0]?.logRecords).toEqual([]);
    expect(incident.diagnostics.resourceMetrics[0]?.scopeMetrics[0]?.metrics).toEqual([]);
    expect(incident.diagnostics.resourceSpans[0]?.scopeSpans[0]?.spans).toEqual([]);
  });

  it("preserves up to 500 evidence records during server sanitization", () => {
    const input = payload();
    const scope = input.diagnostics.resourceLogs[0]!.scopeLogs[0]!;
    scope.logRecords = Array.from({ length: 500 }, (_, index) => ({
      timestamp: "2026-08-27T12:00:00.000Z",
      observedTimestamp: "2026-08-27T12:00:00.000Z",
      eventName: "tincan.browser.console",
      severityText: "INFO",
      severityNumber: 9,
      body: `record ${index}`,
    }));
    const incident = prepareIncident(input, 1);
    expect(incident.diagnostics.resourceLogs[0]!.scopeLogs[0]!.logRecords).toHaveLength(500);
    expect(incident.diagnostics.truncated).toBeUndefined();
  });

  it("does not classify an incident with a failed HTTP span as semantic-only", () => {
    const input = payload();
    input.agentObservation.category = "network_failure";
    input.diagnostics.resourceSpans[0]!.scopeSpans[0]!.spans.push({
      traceId: "1".repeat(32),
      spanId: "2".repeat(16),
      name: "HTTP /api/licenses/remove",
      kind: "CLIENT",
      startTime: "2026-08-27T12:00:00.000Z",
      endTime: "2026-08-27T12:00:01.000Z",
      attributes: {
        "url.path": "/api/licenses/remove",
        "http.response.status_code": 504,
      },
      status: { code: "ERROR" },
      links: [],
    });
    expect(prepareIncident(input, 1).classification.semanticOnly).toBe(false);
  });

  it("rejects oversized semantic fields", () => {
    const input = payload();
    input.agentObservation.summary = "x".repeat(301);
    expect(() => prepareIncident(input, 1)).toThrow("Invalid issue summary");
  });

  it("keeps incident IDs monotonic when stored issues are cleared", () => {
    const store = new MemoryIssueStore();
    expect(store.create(payload()).id).toBe("INC-1042");
    store.clear();
    expect(store.create(payload()).id).toBe("INC-1043");
  });
});
