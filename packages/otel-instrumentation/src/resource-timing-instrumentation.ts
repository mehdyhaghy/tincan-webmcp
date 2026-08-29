import { SpanKind, SpanStatusCode } from "@opentelemetry/api";
import { InstrumentationBase, type InstrumentationConfig } from "@opentelemetry/instrumentation";
import {
  DEFAULT_DIAGNOSTIC_WINDOW_MS,
  type TinCanFlightRecorderSpanProcessor,
} from "./flight-recorder-span-processor";

export interface TinCanResourceTimingInstrumentationConfig extends InstrumentationConfig {
  flightRecorder: TinCanFlightRecorderSpanProcessor;
  ignoreUrls?: Array<string | RegExp>;
  maxAgeMs?: number;
  sanitizePath?: (url: string) => string;
}

const matches = (url: string, patterns: Array<string | RegExp>): boolean => patterns.some((pattern) => {
  if (typeof pattern === "string") return pattern === url;
  pattern.lastIndex = 0;
  return pattern.test(url);
});

export class TinCanResourceTimingInstrumentation extends InstrumentationBase<TinCanResourceTimingInstrumentationConfig> {
  readonly #timers = new Set<number>();
  #observer?: PerformanceObserver;

  constructor(config: TinCanResourceTimingInstrumentationConfig) {
    // Delay enablement until registerInstrumentations has attached the host tracer provider.
    super("@tincan-webmcp/resource-timing", "0.1.0", { ...config, enabled: false });
  }

  init(): void {}

  enable(): void {
    if (
      this.#observer ||
      typeof PerformanceObserver === "undefined" ||
      !PerformanceObserver.supportedEntryTypes.includes("resource")
    ) return;

    this.#observer = new PerformanceObserver((list) => {
      const entries = list.getEntries() as PerformanceResourceTiming[];
      for (const entry of entries) {
        const timer = window.setTimeout(() => {
          this.#timers.delete(timer);
          this.#record(entry);
        });
        this.#timers.add(timer);
      }
    });
    this.#observer.observe({ type: "resource", buffered: true });
  }

  disable(): void {
    this.#observer?.disconnect();
    this.#observer = undefined;
    for (const timer of this.#timers) window.clearTimeout(timer);
    this.#timers.clear();
  }

  #record(entry: PerformanceResourceTiming): void {
    if (entry.initiatorType !== "fetch" && entry.initiatorType !== "xmlhttprequest") return;
    const config = this.getConfig();
    if (matches(entry.name, config.ignoreUrls ?? [])) return;

    const sanitizePath = config.sanitizePath ?? ((url: string) => new URL(url, location.href).pathname);
    const path = sanitizePath(entry.name);
    const startTimestamp = performance.timeOrigin + entry.startTime;
    const endTimestamp = performance.timeOrigin + entry.responseEnd;
    if (
      endTimestamp < Date.now() - (config.maxAgeMs ?? DEFAULT_DIAGNOSTIC_WINDOW_MS) ||
      config.flightRecorder.hasMatchingRequest(path, startTimestamp)
    ) return;

    const statusCode = entry.responseStatus;
    const span = this.tracer.startSpan(`HTTP ${path}`, {
      kind: SpanKind.CLIENT,
      startTime: new Date(startTimestamp),
      attributes: {
        "url.path": path,
        "http.response.status_code": statusCode,
        "http.request.duration_ms": Math.round(entry.duration),
        "tincan.capture.source": "resource_timing",
      },
    });
    if (statusCode >= 400) span.setStatus({ code: SpanStatusCode.ERROR });
    span.end(new Date(endTimestamp));
  }
}
