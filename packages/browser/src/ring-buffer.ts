import type { DiagnosticEvent } from "./types";
import { DEFAULT_DIAGNOSTIC_WINDOW_MS } from "@tincan-webmcp/otel-instrumentation";

export { DEFAULT_DIAGNOSTIC_WINDOW_MS } from "@tincan-webmcp/otel-instrumentation";

export interface RingBufferOptions {
  maxAgeMs?: number;
  maxEvents?: number;
  maxBytes?: number;
}

const byteLength = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).byteLength;

export class DiagnosticRingBuffer {
  readonly #events: DiagnosticEvent[] = [];
  readonly #options: Required<RingBufferOptions>;
  #bytes = 0;

  constructor(options: RingBufferOptions = {}) {
    this.#options = {
      maxAgeMs: options.maxAgeMs ?? DEFAULT_DIAGNOSTIC_WINDOW_MS,
      maxEvents: options.maxEvents ?? 500,
      maxBytes: options.maxBytes ?? 1_000_000,
    };
  }

  push(event: DiagnosticEvent, now = Date.now()): void {
    const size = byteLength(event);
    if (size > this.#options.maxBytes) return;
    this.#events.push(event);
    this.#bytes += size;
    this.#evict(now);
  }

  snapshot(now = Date.now()): DiagnosticEvent[] {
    this.#evict(now);
    return structuredClone(this.#events);
  }

  clear(): void {
    this.#events.length = 0;
    this.#bytes = 0;
  }

  #evict(now: number): void {
    const cutoff = now - this.#options.maxAgeMs;
    while (
      this.#events.length > 0 &&
      (Date.parse(this.#events[0]!.timestamp) < cutoff ||
        this.#events.length > this.#options.maxEvents ||
        this.#bytes > this.#options.maxBytes)
    ) {
      this.#bytes -= byteLength(this.#events.shift());
    }
  }
}
