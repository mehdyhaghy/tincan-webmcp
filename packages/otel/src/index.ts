export type OtelAttributeValue = string | number | boolean | Array<string | number | boolean>;
export type OtelAttributes = Record<string, OtelAttributeValue>;

export interface OtelResource {
  attributes: OtelAttributes;
}

export interface OtelInstrumentationScope {
  name: string;
  version?: string;
}

export interface OtelLogRecord {
  timestamp: string;
  observedTimestamp: string;
  eventName: string;
  severityText: "INFO" | "WARN" | "ERROR";
  severityNumber: 9 | 13 | 17;
  body: string;
  attributes?: OtelAttributes;
  traceId?: string;
  spanId?: string;
  traceFlags?: number;
}

export interface OtelSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: "INTERNAL" | "CLIENT" | "SERVER";
  startTime: string;
  endTime: string;
  attributes: OtelAttributes;
  status: { code: "UNSET" | "OK" | "ERROR"; message?: string };
  links: Array<{ traceId: string; spanId: string; attributes?: OtelAttributes }>;
}

export interface OtelNumberDataPoint {
  time: string;
  value: number;
  attributes?: OtelAttributes;
}

export interface OtelHistogramDataPoint {
  startTime: string;
  time: string;
  count: number;
  sum: number;
  min?: number;
  max?: number;
  attributes?: OtelAttributes;
}

export type OtelMetric =
  | { name: string; description: string; unit: string; gauge: { dataPoints: OtelNumberDataPoint[] } }
  | {
      name: string;
      description: string;
      unit: string;
      histogram: { aggregationTemporality: "DELTA"; dataPoints: OtelHistogramDataPoint[] };
    };

export interface OtelTelemetrySnapshot {
  resourceLogs: Array<{
    resource: OtelResource;
    scopeLogs: Array<{ scope: OtelInstrumentationScope; logRecords: OtelLogRecord[] }>;
  }>;
  resourceMetrics: Array<{
    resource: OtelResource;
    scopeMetrics: Array<{ scope: OtelInstrumentationScope; metrics: OtelMetric[] }>;
  }>;
  resourceSpans: Array<{
    resource: OtelResource;
    scopeSpans: Array<{ scope: OtelInstrumentationScope; spans: OtelSpan[] }>;
  }>;
}

export interface TraceCorrelation {
  traceId?: string;
  spanId?: string;
  requestIds?: string[];
}

export interface CorrelationProvider {
  capture(): TraceCorrelation | undefined;
}
