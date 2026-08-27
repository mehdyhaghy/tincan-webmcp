import { DiagnosticRingBuffer, type RingBufferOptions } from "./ring-buffer";
import { sanitizePath, sanitizeString, sanitizeValue } from "./sanitize";
import type { DiagnosticEvent, IncidentPayload, ReportResult, ReportSiteIssueInput } from "./types";
import type { OtelAttributes, OtelInstrumentationScope, OtelResource, OtelSpan, OtelTelemetrySnapshot } from "@tincan-webmcp/otel";

export interface TinCanOptions extends RingBufferOptions {
  endpoint?: string;
  application: { name: string; version?: string; environment?: string };
  fetch?: typeof globalThis.fetch;
}

type EventLevel = "info" | "warn" | "error";

const otelSeverity = (level: EventLevel): Pick<DiagnosticEvent, "severityText" | "severityNumber"> => {
  if (level === "error") return { severityText: "ERROR", severityNumber: 17 };
  if (level === "warn") return { severityText: "WARN", severityNumber: 13 };
  return { severityText: "INFO", severityNumber: 9 };
};

export class TinCanRecorder {
  readonly buffer: DiagnosticRingBuffer;
  readonly #options: TinCanOptions;
  readonly #spans: OtelSpan[] = [];
  readonly #requestDurations: number[] = [];
  readonly #startedAt = new Date().toISOString();
  #started = false;
  #originalFetch?: typeof globalThis.fetch;
  #originalWarn?: typeof console.warn;
  #originalError?: typeof console.error;
  #onError?: (event: ErrorEvent) => void;
  #onRejection?: (event: PromiseRejectionEvent) => void;

  constructor(options: TinCanOptions) {
    this.#options = options;
    this.buffer = new DiagnosticRingBuffer(options);
  }

  start(): this {
    if (this.#started || typeof window === "undefined") return this;
    this.#started = true;
    this.record("tincan.browser.navigation", location.pathname, { "url.path": location.pathname });
    this.#patchConsole();
    this.#patchFetch();
    this.#onError = (event) => this.record("tincan.browser.error", event.message, undefined, "error");
    this.#onRejection = (event) => this.record("tincan.browser.unhandled_rejection", String(event.reason), undefined, "error");
    window.addEventListener("error", this.#onError);
    window.addEventListener("unhandledrejection", this.#onRejection);
    return this;
  }

  stop(): void {
    if (!this.#started || typeof window === "undefined") return;
    if (this.#originalFetch) window.fetch = this.#originalFetch;
    if (this.#originalWarn) console.warn = this.#originalWarn;
    if (this.#originalError) console.error = this.#originalError;
    if (this.#onError) window.removeEventListener("error", this.#onError);
    if (this.#onRejection) window.removeEventListener("unhandledrejection", this.#onRejection);
    this.#started = false;
  }

  record(eventName: string, body: string, attributes?: Record<string, unknown>, level: EventLevel = "info"): void {
    const timestamp = new Date().toISOString();
    this.buffer.push({
      timestamp,
      observedTimestamp: timestamp,
      eventName,
      ...otelSeverity(level),
      body: sanitizeString(body, 500),
      ...(attributes ? { attributes: sanitizeValue(attributes) as OtelAttributes } : {}),
    });
  }

  async reportIssue(input: ReportSiteIssueInput): Promise<ReportResult> {
    this.record("tincan.site.issue.reported", "Site issue reported", {
      "tincan.issue.category": input.category,
      "tincan.issue.severity": input.severity,
      "tincan.issue.operation": input.operation ?? "unknown",
    }, input.severity === "blocking" ? "error" : input.severity === "degraded" ? "warn" : "info");
    const resourceAttributes: Record<string, string> = {
      "service.name": this.#options.application.name,
      ...(this.#options.application.version ? { "service.version": this.#options.application.version } : {}),
      ...(this.#options.application.environment
        ? { "deployment.environment.name": this.#options.application.environment }
        : {}),
    };
    const payload: IncidentPayload = {
      schemaVersion: "1.0",
      agentObservation: { ...input, timestamp: new Date().toISOString() },
      resource: { attributes: resourceAttributes },
      instrumentationScope: { name: "@tincan-webmcp/browser", version: "0.1.0" },
      attributes: {
        "url.path": typeof location === "undefined" ? "/" : sanitizePath(location.href),
        "browser.visibility_state": typeof document === "undefined" ? "unknown" : document.visibilityState,
      },
      diagnostics: this.#telemetrySnapshot({ attributes: resourceAttributes }, {
        name: "@tincan-webmcp/browser",
        version: "0.1.0",
      }),
    };
    const transport = this.#options.fetch ?? this.#originalFetch ?? globalThis.fetch;
    const response = await transport(this.#options.endpoint ?? "/_tincan/issues", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`TinCan report failed with ${response.status}`);
    return (await response.json()) as ReportResult;
  }

  #patchConsole(): void {
    this.#originalWarn = console.warn.bind(console);
    this.#originalError = console.error.bind(console);
    console.warn = (...args: unknown[]) => {
      this.record("tincan.browser.console", args.map(String).join(" "), { "log.severity": "warn" }, "warn");
      this.#originalWarn?.(...args);
    };
    console.error = (...args: unknown[]) => {
      this.record("tincan.browser.console", args.map(String).join(" "), { "log.severity": "error" }, "error");
      this.#originalError?.(...args);
    };
  }

  #patchFetch(): void {
    this.#originalFetch = window.fetch.bind(window);
    const original = this.#originalFetch;
    window.fetch = async (input, init) => {
      const started = performance.now();
      const startTime = new Date().toISOString();
      const traceId = this.#hexId(32);
      const spanId = this.#hexId(16);
      const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
      const path = sanitizePath(input instanceof Request ? input.url : String(input));
      try {
        const response = await original(input, init);
        const durationMs = Math.round(performance.now() - started);
        this.#requestDurations.push(durationMs);
        this.record("tincan.browser.http.request", `${method} ${path}`, {
          "http.request.method": method,
          "url.path": path,
          "http.response.status_code": response.status,
          "http.request.duration_ms": durationMs,
        });
        this.#recordHttpSpan({ traceId, spanId, method, path, status: response.status, durationMs, startTime });
        return response;
      } catch (error) {
        const durationMs = Math.round(performance.now() - started);
        this.#requestDurations.push(durationMs);
        this.record("tincan.browser.http.request", `${method} ${path}`, {
          "http.request.method": method,
          "url.path": path,
          "http.response.status_code": 0,
          "http.request.duration_ms": durationMs,
          "error.message": sanitizeString(String(error), 300),
        }, "error");
        this.#recordHttpSpan({
          traceId,
          spanId,
          method,
          path,
          status: 0,
          durationMs,
          startTime,
          error: sanitizeString(String(error), 300),
        });
        throw error;
      }
    };
  }

  #recordHttpSpan(input: {
    traceId: string;
    spanId: string;
    method: string;
    path: string;
    status: number;
    durationMs: number;
    startTime: string;
    error?: string;
  }): void {
    this.#spans.push({
      traceId: input.traceId,
      spanId: input.spanId,
      name: `${input.method} ${input.path}`,
      kind: "CLIENT",
      startTime: input.startTime,
      endTime: new Date().toISOString(),
      attributes: {
        "http.request.method": input.method,
        "url.path": input.path,
        "http.response.status_code": input.status,
        "http.request.duration_ms": input.durationMs,
      },
      status: input.status === 0 || input.status >= 400
        ? { code: "ERROR", ...(input.error ? { message: input.error } : {}) }
        : { code: "UNSET" },
      links: [],
    });
    if (this.#spans.length > 500) this.#spans.shift();
  }

  #telemetrySnapshot(resource: OtelResource, scope: OtelInstrumentationScope): OtelTelemetrySnapshot {
    const records = this.buffer.snapshot();
    const now = new Date().toISOString();
    const failures = records.filter((record) =>
      record.eventName === "tincan.browser.http.request" &&
      Number(record.attributes?.["http.response.status_code"] ?? 0) >= 400,
    ).length;
    const errors = records.filter((record) => record.eventName === "tincan.browser.error").length;
    const durations = this.#requestDurations.slice(-500);
    const metrics = [
      {
        name: "http.client.request.duration",
        description: "Duration of outbound browser HTTP requests.",
        unit: "ms",
        histogram: {
          aggregationTemporality: "DELTA" as const,
          dataPoints: durations.length
            ? [{
                startTime: this.#startedAt,
                time: now,
                count: durations.length,
                sum: durations.reduce((sum, value) => sum + value, 0),
                min: Math.min(...durations),
                max: Math.max(...durations),
              }]
            : [],
        },
      },
      {
        name: "tincan.browser.error.count",
        description: "JavaScript errors observed in the recorder window.",
        unit: "{error}",
        gauge: { dataPoints: [{ time: now, value: errors }] },
      },
      {
        name: "tincan.browser.network.failure.count",
        description: "Failed browser requests observed in the recorder window.",
        unit: "{request}",
        gauge: { dataPoints: [{ time: now, value: failures }] },
      },
    ];
    return {
      resourceLogs: [{ resource, scopeLogs: [{ scope, logRecords: records }] }],
      resourceMetrics: [{ resource, scopeMetrics: [{ scope, metrics }] }],
      resourceSpans: [{ resource, scopeSpans: [{ scope, spans: structuredClone(this.#spans) }] }],
    };
  }

  #hexId(length: number): string {
    const bytes = crypto.getRandomValues(new Uint8Array(length / 2));
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
}

export const createTinCan = (options: TinCanOptions): TinCanRecorder => new TinCanRecorder(options);
