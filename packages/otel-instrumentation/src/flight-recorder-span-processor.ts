import { SpanKind, SpanStatusCode, type Context } from "@opentelemetry/api";
import type { ReadableSpan, Span, SpanProcessor } from "@opentelemetry/sdk-trace-base";
import type { OtelAttributeValue, OtelAttributes, OtelSpan } from "@tincan-webmcp/otel";

export const DEFAULT_DIAGNOSTIC_WINDOW_MS = 120_000;

export interface TinCanFlightRecorderOptions {
  maxAgeMs?: number;
  maxSpans?: number;
  sanitizePath?: (url: string) => string;
}

interface RecordedSpan {
  span: OtelSpan;
  path: string;
  source?: OtelAttributeValue;
  startTimestamp: number;
  endTimestamp: number;
}

const hrTimeToEpochMs = ([seconds, nanoseconds]: readonly [number, number]): number =>
  seconds * 1_000 + nanoseconds / 1_000_000;

const defaultPath = (value: string): string => {
  try {
    return new URL(value, typeof location === "undefined" ? "https://tincan.invalid" : location.href).pathname;
  } catch {
    return value.split(/[?#]/, 1)[0] ?? "";
  }
};

const spanKind = (kind: SpanKind): OtelSpan["kind"] => {
  if (kind === SpanKind.CLIENT) return "CLIENT";
  if (kind === SpanKind.SERVER) return "SERVER";
  return "INTERNAL";
};

const spanStatus = (span: ReadableSpan, statusCode: number): OtelSpan["status"] => {
  if (span.status.code === SpanStatusCode.ERROR || statusCode >= 400) {
    return { code: "ERROR", ...(span.status.message ? { message: span.status.message } : {}) };
  }
  if (span.status.code === SpanStatusCode.OK) return { code: "OK" };
  return { code: "UNSET" };
};

const attribute = (value: unknown): OtelAttributeValue | undefined => {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    const entries = value.filter((entry): entry is string | number | boolean =>
      typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean",
    );
    return entries;
  }
  return undefined;
};

export class TinCanFlightRecorderSpanProcessor implements SpanProcessor {
  readonly #spans: RecordedSpan[] = [];
  readonly #maxAgeMs: number;
  readonly #maxSpans: number;
  readonly #sanitizePath: (url: string) => string;

  constructor(options: TinCanFlightRecorderOptions = {}) {
    this.#maxAgeMs = options.maxAgeMs ?? DEFAULT_DIAGNOSTIC_WINDOW_MS;
    this.#maxSpans = options.maxSpans ?? 500;
    this.#sanitizePath = options.sanitizePath ?? defaultPath;
  }

  onStart(_span: Span, _parentContext: Context): void {}

  onEnd(span: ReadableSpan): void {
    const recorded = this.#toRecordedSpan(span);
    if (recorded.source !== "resource_timing") {
      for (let index = this.#spans.length - 1; index >= 0; index -= 1) {
        const candidate = this.#spans[index]!;
        if (
          candidate.source === "resource_timing" &&
          candidate.path === recorded.path &&
          Math.abs(candidate.startTimestamp - recorded.startTimestamp) < 250
        ) {
          this.#spans.splice(index, 1);
        }
      }
    }
    this.#spans.push(recorded);
    this.#prune(Date.now());
  }

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }

  shutdown(): Promise<void> {
    this.#spans.length = 0;
    return Promise.resolve();
  }

  snapshot(now = Date.now()): OtelSpan[] {
    this.#prune(now);
    return structuredClone(this.#spans.map(({ span }) => span));
  }

  /** Re-adds spans that were persisted by an earlier page instance, oldest first. */
  restore(spans: readonly OtelSpan[], now = Date.now()): void {
    for (const span of spans) {
      const startTimestamp = Date.parse(span.startTime);
      const endTimestamp = Date.parse(span.endTime);
      if (!Number.isFinite(startTimestamp) || !Number.isFinite(endTimestamp)) continue;
      const source = span.attributes["tincan.capture.source"];
      this.#spans.push({
        span: structuredClone(span),
        path: String(span.attributes["url.path"] ?? "/"),
        ...(source !== undefined ? { source } : {}),
        startTimestamp,
        endTimestamp,
      });
    }
    this.#spans.sort((left, right) => left.endTimestamp - right.endTimestamp);
    this.#prune(now);
  }

  hasMatchingRequest(path: string, startTimestamp: number): boolean {
    return this.#spans.some((span) =>
      span.path === path && Math.abs(span.startTimestamp - startTimestamp) < 250,
    );
  }

  #toRecordedSpan(span: ReadableSpan): RecordedSpan {
    const path = this.#path(span);
    const method = attribute(span.attributes["http.request.method"] ?? span.attributes["http.method"]);
    const responseStatus = Number(
      span.attributes["http.response.status_code"] ?? span.attributes["http.status_code"] ?? 0,
    );
    const startTimestamp = hrTimeToEpochMs(span.startTime);
    const endTimestamp = hrTimeToEpochMs(span.endTime);
    const attributes: OtelAttributes = {
      "url.path": path,
      "http.request.duration_ms": Math.max(0, Math.round(endTimestamp - startTimestamp)),
    };
    if (method !== undefined) attributes["http.request.method"] = method;
    if (responseStatus > 0) attributes["http.response.status_code"] = responseStatus;
    const source = attribute(span.attributes["tincan.capture.source"]);
    if (source !== undefined) attributes["tincan.capture.source"] = source;

    const context = span.spanContext();
    const safeSpan: OtelSpan = {
      traceId: context.traceId,
      spanId: context.spanId,
      ...(span.parentSpanContext ? { parentSpanId: span.parentSpanContext.spanId } : {}),
      name: method ? `${String(method).toUpperCase()} ${path}` : `HTTP ${path}`,
      kind: spanKind(span.kind),
      startTime: new Date(startTimestamp).toISOString(),
      endTime: new Date(endTimestamp).toISOString(),
      attributes,
      status: spanStatus(span, responseStatus),
      links: span.links.map((link) => ({
        traceId: link.context.traceId,
        spanId: link.context.spanId,
      })),
    };
    return {
      span: safeSpan,
      path,
      ...(source !== undefined ? { source } : {}),
      startTimestamp,
      endTimestamp,
    };
  }

  #path(span: ReadableSpan): string {
    const raw = span.attributes["url.full"] ?? span.attributes["http.url"] ?? span.attributes["url.path"] ?? "/";
    return this.#sanitizePath(String(raw));
  }

  #prune(now: number): void {
    const cutoff = now - this.#maxAgeMs;
    for (let index = this.#spans.length - 1; index >= 0; index -= 1) {
      if (this.#spans[index]!.endTimestamp < cutoff) this.#spans.splice(index, 1);
    }
    if (this.#spans.length > this.#maxSpans) this.#spans.splice(0, this.#spans.length - this.#maxSpans);
  }
}
