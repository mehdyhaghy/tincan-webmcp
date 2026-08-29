import type { Instrumentation } from "@opentelemetry/instrumentation";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { FetchInstrumentation } from "@opentelemetry/instrumentation-fetch";
import { XMLHttpRequestInstrumentation } from "@opentelemetry/instrumentation-xml-http-request";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { WebTracerProvider } from "@opentelemetry/sdk-trace-web";
import type { OtelSpan } from "@tincan-webmcp/otel";
import {
  DEFAULT_DIAGNOSTIC_WINDOW_MS,
  TinCanFlightRecorderSpanProcessor,
  type TinCanFlightRecorderOptions,
} from "./flight-recorder-span-processor";
import { TinCanResourceTimingInstrumentation } from "./resource-timing-instrumentation";

export interface TinCanBrowserTelemetryOptions extends TinCanFlightRecorderOptions {
  application: { name: string; version?: string; environment?: string };
  ignoreUrls?: Array<string | RegExp>;
}

export function createTinCanInstrumentations(
  flightRecorder: TinCanFlightRecorderSpanProcessor,
  options: TinCanBrowserTelemetryOptions,
): Instrumentation[] {
  const ignoreUrls = options.ignoreUrls ?? [];
  return [
    new FetchInstrumentation({ ignoreUrls }),
    new XMLHttpRequestInstrumentation({ ignoreUrls }),
    new TinCanResourceTimingInstrumentation({
      flightRecorder,
      ignoreUrls,
      maxAgeMs: options.maxAgeMs ?? DEFAULT_DIAGNOSTIC_WINDOW_MS,
      ...(options.sanitizePath ? { sanitizePath: options.sanitizePath } : {}),
    }),
  ];
}

export class TinCanBrowserTelemetry {
  readonly flightRecorder: TinCanFlightRecorderSpanProcessor;
  readonly #options: TinCanBrowserTelemetryOptions;
  #provider?: WebTracerProvider;
  #unregister?: () => void;

  constructor(options: TinCanBrowserTelemetryOptions) {
    this.#options = options;
    this.flightRecorder = new TinCanFlightRecorderSpanProcessor(options);
  }

  start(): void {
    if (this.#provider || typeof window === "undefined") return;
    const resourceAttributes: Record<string, string> = {
      "service.name": this.#options.application.name,
      ...(this.#options.application.version ? { "service.version": this.#options.application.version } : {}),
      ...(this.#options.application.environment
        ? { "deployment.environment.name": this.#options.application.environment }
        : {}),
    };
    this.#provider = new WebTracerProvider({
      resource: resourceFromAttributes(resourceAttributes),
      spanProcessors: [this.flightRecorder],
    });
    this.#unregister = registerInstrumentations({
      tracerProvider: this.#provider,
      instrumentations: createTinCanInstrumentations(this.flightRecorder, this.#options),
    });
  }

  stop(): void {
    this.#unregister?.();
    this.#unregister = undefined;
    this.#provider = undefined;
  }

  snapshot(now = Date.now()): OtelSpan[] {
    return this.flightRecorder.snapshot(now);
  }
}
