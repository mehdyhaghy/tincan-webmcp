import { MAX_INCIDENT_BYTES, type IncidentPayload } from "@tincan-webmcp/core";
import type { OtelLogRecord, OtelSpan } from "@tincan-webmcp/otel";

export interface SerializedIncident {
  body: string;
  payload: IncidentPayload;
}

const byteLength = (value: string): number => new TextEncoder().encode(value).byteLength;

const removeOldest = <T>(collections: T[][], count: number): number => {
  let remaining = count;
  for (const collection of collections) {
    if (remaining === 0) break;
    const removed = Math.min(remaining, collection.length);
    collection.splice(0, removed);
    remaining -= removed;
  }
  return count - remaining;
};

const itemCount = <T>(collections: T[][]): number =>
  collections.reduce((total, collection) => total + collection.length, 0);

export function serializeIncidentPayload(
  payload: IncidentPayload,
  maxBytes = MAX_INCIDENT_BYTES,
): SerializedIncident {
  let body = JSON.stringify(payload);
  let size = byteLength(body);
  if (size <= maxBytes) return { body, payload };

  payload.diagnostics.truncated = true;
  const logCollections: OtelLogRecord[][] = payload.diagnostics.resourceLogs.flatMap((group) =>
    group.scopeLogs.map((scope) => scope.logRecords),
  );
  const spanCollections: OtelSpan[][] = payload.diagnostics.resourceSpans.flatMap((group) =>
    group.scopeSpans.map((scope) => scope.spans),
  );

  while (size > maxBytes) {
    const logs = itemCount(logCollections);
    const spans = itemCount(spanCollections);
    const total = logs + spans;
    if (total === 0) throw new Error("TinCan incident metadata exceeds the configured payload limit");

    const estimatedRemoval = Math.max(1, Math.ceil(total * ((size - maxBytes) / size)));
    if (logs >= spans) {
      const removed = removeOldest(logCollections, estimatedRemoval);
      if (removed < estimatedRemoval) removeOldest(spanCollections, estimatedRemoval - removed);
    } else {
      const removed = removeOldest(spanCollections, estimatedRemoval);
      if (removed < estimatedRemoval) removeOldest(logCollections, estimatedRemoval - removed);
    }
    body = JSON.stringify(payload);
    size = byteLength(body);
  }

  return { body, payload };
}
