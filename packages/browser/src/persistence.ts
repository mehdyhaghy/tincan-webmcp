import type { DiagnosticEvent } from "@tincan-webmcp/core";
import type { OtelSpan } from "@tincan-webmcp/otel";

export interface FlightRecorderSnapshot {
  events: DiagnosticEvent[];
  spans: OtelSpan[];
}

export type FlightRecorderStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface FlightRecorderPersistenceOptions {
  /** Storage key. Defaults to "tincan:flight-recorder". */
  key?: string;
  /** Storage area. Defaults to window.localStorage when it is available. */
  storage?: FlightRecorderStorage;
  /** Upper bound for one serialized snapshot. Defaults to the incident size limit. */
  maxBytes?: number;
  /** Periodic save interval in milliseconds. Defaults to 3000. */
  intervalMs?: number;
}

interface PersistedFlightRecorder extends FlightRecorderSnapshot {
  version: 1;
  savedAt: string;
}

export const DEFAULT_PERSISTENCE_KEY = "tincan:flight-recorder";

const empty = (): FlightRecorderSnapshot => ({ events: [], spans: [] });
const byteLength = (value: string): number => new TextEncoder().encode(value).byteLength;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const isEvent = (value: unknown): value is DiagnosticEvent =>
  isRecord(value) && typeof value.timestamp === "string" && typeof value.eventName === "string" && typeof value.body === "string";
const isSpan = (value: unknown): value is OtelSpan =>
  isRecord(value) &&
  typeof value.name === "string" &&
  typeof value.startTime === "string" &&
  typeof value.endTime === "string" &&
  isRecord(value.attributes);

const defaultStorage = (): FlightRecorderStorage | undefined => {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
};

export function pruneSnapshot(snapshot: FlightRecorderSnapshot, now: number, maxAgeMs: number): FlightRecorderSnapshot {
  const cutoff = now - maxAgeMs;
  return {
    events: snapshot.events.filter((event) => Date.parse(event.timestamp) >= cutoff),
    spans: snapshot.spans.filter((span) => Date.parse(span.endTime) >= cutoff),
  };
}

export function serializeSnapshot(snapshot: FlightRecorderSnapshot, now: number, maxBytes: number): string {
  let events = snapshot.events;
  let spans = snapshot.spans;
  for (;;) {
    const payload: PersistedFlightRecorder = { version: 1, savedAt: new Date(now).toISOString(), events, spans };
    const serialized = JSON.stringify(payload);
    if (byteLength(serialized) <= maxBytes || (events.length === 0 && spans.length === 0)) return serialized;
    // Drop the oldest quarter of whichever list is longer until the snapshot fits.
    if (spans.length >= events.length) spans = spans.slice(Math.max(1, Math.ceil(spans.length / 4)));
    else events = events.slice(Math.max(1, Math.ceil(events.length / 4)));
  }
}

export function parseSnapshot(raw: string | null | undefined, now: number, maxAgeMs: number): FlightRecorderSnapshot {
  if (!raw) return empty();
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.events) || !Array.isArray(parsed.spans)) {
      return empty();
    }
    return pruneSnapshot({ events: parsed.events.filter(isEvent), spans: parsed.spans.filter(isSpan) }, now, maxAgeMs);
  } catch {
    return empty();
  }
}

/**
 * Keeps the already-sanitized flight recorder window in Web Storage so evidence survives
 * a page reload. Every call is best-effort: storage can be full, blocked, or absent.
 */
export class FlightRecorderStore {
  readonly #key: string;
  readonly #storage: FlightRecorderStorage | undefined;

  constructor(options: FlightRecorderPersistenceOptions = {}) {
    this.#key = options.key ?? DEFAULT_PERSISTENCE_KEY;
    this.#storage = options.storage ?? defaultStorage();
  }

  get available(): boolean {
    return this.#storage !== undefined;
  }

  load(now: number, maxAgeMs: number): FlightRecorderSnapshot {
    try {
      return parseSnapshot(this.#storage?.getItem(this.#key), now, maxAgeMs);
    } catch {
      return empty();
    }
  }

  save(snapshot: FlightRecorderSnapshot, now: number, maxBytes: number): void {
    try {
      this.#storage?.setItem(this.#key, serializeSnapshot(snapshot, now, maxBytes));
    } catch {
      // Quota exceeded or storage blocked: the in-memory window still works.
    }
  }

  clear(): void {
    try {
      this.#storage?.removeItem(this.#key);
    } catch {
      // Nothing to recover from.
    }
  }
}
