import { describe, expect, it } from "vitest";
import type { IncidentPayload } from "@tincan-webmcp/browser";
import { prepareIncident } from "./index";

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

  it("rejects oversized semantic fields", () => {
    const input = payload();
    input.agentObservation.summary = "x".repeat(301);
    expect(() => prepareIncident(input, 1)).toThrow("Invalid issue summary");
  });
});
