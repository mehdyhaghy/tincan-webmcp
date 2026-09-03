import {
  DEFAULT_DIAGNOSTIC_WINDOW_MS,
  TinCanBrowserTelemetry,
  type TinCanFlightRecorderSpanProcessor,
} from "@tincan-webmcp/otel-instrumentation";
import { FlightRecorderStore, type FlightRecorderPersistenceOptions } from "./persistence";
import { DiagnosticRingBuffer, type RingBufferOptions } from "./ring-buffer";
import {
  MAX_INCIDENT_BYTES,
  sanitizePath,
  sanitizeString,
  sanitizeValue,
  type DiagnosticEvent,
  type IncidentPayload,
  type ReportResult,
  type ReportSiteIssueInput,
} from "@tincan-webmcp/core";
import type { OtelAttributes, OtelInstrumentationScope, OtelResource, OtelTelemetrySnapshot } from "@tincan-webmcp/otel";
import { serializeIncidentPayload } from "./payload";
import { installConsoleInstrumentation, type ConsoleInstrumentation } from "./console-instrumentation";

export interface TinCanOptions extends RingBufferOptions {
  endpoint?: string;
  application: { name: string; version?: string; environment?: string };
  fetch?: typeof globalThis.fetch;
  spanProcessor?: TinCanFlightRecorderSpanProcessor;
  /**
   * Keep the sanitized recorder window in Web Storage so it survives a page reload,
   * for example when a browser agent re-navigates between tool calls. Off by default.
   */
  persistence?: FlightRecorderPersistenceOptions | false;
}

type EventLevel = "info" | "warn" | "error";

export const createTinCanEndpointPattern = (endpoint = "/_tincan/issues"): RegExp => {
  const endpointPath = sanitizePath(endpoint);
  const escapedEndpoint = endpointPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${escapedEndpoint}(?:\\?|$)`);
};

const otelSeverity = (level: EventLevel): Pick<DiagnosticEvent, "severityText" | "severityNumber"> => {
  if (level === "error") return { severityText: "ERROR", severityNumber: 17 };
  if (level === "warn") return { severityText: "WARN", severityNumber: 13 };
  return { severityText: "INFO", severityNumber: 9 };
};

export class TinCanRecorder {
  readonly buffer: DiagnosticRingBuffer;
  readonly #options: TinCanOptions;
  readonly #telemetry?: TinCanBrowserTelemetry;
  readonly #spanProcessor: TinCanFlightRecorderSpanProcessor;
  readonly #startedAt = new Date().toISOString();
  readonly #maxAgeMs: number;
  readonly #store?: FlightRecorderStore;
  readonly #persistIntervalMs: number;
  readonly #persistMaxBytes: number;
  #started = false;
  #consoleInstrumentation?: ConsoleInstrumentation;
  #onError?: (event: ErrorEvent) => void;
  #onRejection?: (event: PromiseRejectionEvent) => void;
  #onPageHide?: () => void;
  #onVisibilityChange?: () => void;
  #persistTimer?: ReturnType<typeof setTimeout>;
  #persistInterval?: ReturnType<typeof setInterval>;

  constructor(options: TinCanOptions) {
    this.#options = options;
    this.buffer = new DiagnosticRingBuffer(options);
    this.#maxAgeMs = options.maxAgeMs ?? DEFAULT_DIAGNOSTIC_WINDOW_MS;
    const persistence = options.persistence || undefined;
    if (persistence) this.#store = new FlightRecorderStore(persistence);
    this.#persistIntervalMs = persistence?.intervalMs ?? 3_000;
    this.#persistMaxBytes = persistence?.maxBytes ?? MAX_INCIDENT_BYTES;
    if (options.spanProcessor) {
      this.#spanProcessor = options.spanProcessor;
    } else {
      this.#telemetry = new TinCanBrowserTelemetry({
        application: options.application,
        ...(options.maxAgeMs !== undefined ? { maxAgeMs: options.maxAgeMs } : {}),
        ...(options.maxEvents !== undefined ? { maxSpans: options.maxEvents } : {}),
        sanitizePath,
        ignoreUrls: [createTinCanEndpointPattern(options.endpoint)],
      });
      this.#spanProcessor = this.#telemetry.flightRecorder;
    }
  }

  start(): this {
    if (this.#started || typeof window === "undefined") return this;
    this.#started = true;
    this.#restore();
    this.record("tincan.browser.navigation", location.pathname, { "url.path": location.pathname });
    this.#patchConsole();
    this.#telemetry?.start();
    this.#onError = (event) => this.record("tincan.browser.error", event.message, undefined, "error");
    this.#onRejection = (event) => this.record("tincan.browser.unhandled_rejection", String(event.reason), undefined, "error");
    window.addEventListener("error", this.#onError);
    window.addEventListener("unhandledrejection", this.#onRejection);
    this.#watchPersistence();
    return this;
  }

  stop(): void {
    if (!this.#started || typeof window === "undefined") return;
    this.#unwatchPersistence();
    this.#persist();
    this.#consoleInstrumentation?.stop();
    this.#consoleInstrumentation = undefined;
    this.#telemetry?.stop();
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
    this.#schedulePersist();
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
    const serialized = serializeIncidentPayload(payload);
    const transport = this.#options.fetch ?? globalThis.fetch;
    const response = await transport(this.#options.endpoint ?? "/_tincan/issues", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: serialized.body,
    });
    if (!response.ok) throw new Error(`TinCan report failed with ${response.status}`);
    return (await response.json()) as ReportResult;
  }

  #restore(): void {
    if (!this.#store) return;
    const now = Date.now();
    const snapshot = this.#store.load(now, this.#maxAgeMs);
    for (const event of snapshot.events) this.buffer.push(event, now);
    this.#spanProcessor.restore?.(snapshot.spans, now);
  }

  #persist(): void {
    if (!this.#store) return;
    const now = Date.now();
    this.#store.save({ events: this.buffer.snapshot(now), spans: this.#spanProcessor.snapshot(now) }, now, this.#persistMaxBytes);
  }

  #schedulePersist(): void {
    if (!this.#store || !this.#started || this.#persistTimer !== undefined) return;
    this.#persistTimer = setTimeout(() => {
      this.#persistTimer = undefined;
      this.#persist();
    }, 250);
  }

  #watchPersistence(): void {
    if (!this.#store) return;
    this.#onPageHide = () => this.#persist();
    this.#onVisibilityChange = () => {
      if (document.visibilityState === "hidden") this.#persist();
    };
    window.addEventListener("pagehide", this.#onPageHide);
    document.addEventListener("visibilitychange", this.#onVisibilityChange);
    // Spans end without going through record(), so also save on a short interval.
    this.#persistInterval = setInterval(() => this.#persist(), this.#persistIntervalMs);
  }

  #unwatchPersistence(): void {
    if (this.#persistTimer !== undefined) clearTimeout(this.#persistTimer);
    if (this.#persistInterval !== undefined) clearInterval(this.#persistInterval);
    this.#persistTimer = undefined;
    this.#persistInterval = undefined;
    if (this.#onPageHide) window.removeEventListener("pagehide", this.#onPageHide);
    if (this.#onVisibilityChange) document.removeEventListener("visibilitychange", this.#onVisibilityChange);
    this.#onPageHide = undefined;
    this.#onVisibilityChange = undefined;
  }

  #patchConsole(): void {
    this.#consoleInstrumentation = installConsoleInstrumentation(console, (level, args) => {
      this.record(
        "tincan.browser.console",
        args.map(String).join(" "),
        { "log.severity": level },
        level,
      );
    });
  }

  #telemetrySnapshot(resource: OtelResource, scope: OtelInstrumentationScope): OtelTelemetrySnapshot {
    const snapshotTime = Date.now();
    const records = this.buffer.snapshot();
    const now = new Date(snapshotTime).toISOString();
    const spans = this.#spanProcessor.snapshot(snapshotTime);
    const failures = spans.filter((span) =>
      span.status.code === "ERROR" || Number(span.attributes["http.response.status_code"] ?? 0) >= 400,
    ).length;
    const errors = records.filter((record) => record.eventName === "tincan.browser.error").length;
    const durations = spans
      .map((span) => Number(span.attributes["http.request.duration_ms"] ?? 0))
      .filter((duration) => Number.isFinite(duration));
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
      resourceSpans: [{ resource, scopeSpans: [{ scope, spans }] }],
    };
  }
}

export const createTinCan = (options: TinCanOptions): TinCanRecorder => new TinCanRecorder(options);
