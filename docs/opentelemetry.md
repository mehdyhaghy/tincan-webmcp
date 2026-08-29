# OpenTelemetry Signal Mapping

TinCan represents private browser evidence as three OpenTelemetry-aligned signal groups under `diagnostics`: `resourceLogs`, `resourceMetrics`, and `resourceSpans`. Each group includes resource attributes and an instrumentation scope.

## Shared identity

The browser SDK currently emits:

- `service.name`
- `service.version`, when configured
- `deployment.environment.name`, when configured
- instrumentation scope name `@tincan-webmcp/browser`
- instrumentation scope version `0.1.0`

TinCan-specific names are lowercase and namespaced under `tincan.*`. Established HTTP and URL semantic-convention names are reused where applicable.

## Logs

Each browser event is represented as a LogRecord-like object with timestamp, observed timestamp, event name, severity text/number, body, attributes, and optional trace/span identifiers.

| Event name | Meaning |
| --- | --- |
| `tincan.browser.navigation` | Initial page navigation |
| `tincan.browser.console` | Console warning or error |
| `tincan.browser.error` | Window JavaScript error |
| `tincan.browser.unhandled_rejection` | Unhandled promise rejection |
| `tincan.site.issue.reported` | Agent issue observation submitted |

Severity numbers use the OpenTelemetry ranges: INFO `9`, WARN `13`, and ERROR `17`.

## Metrics

The issue snapshot currently contains:

| Metric | Type | Unit |
| --- | --- | --- |
| `http.client.request.duration` | Delta histogram | `ms` |
| `tincan.browser.error.count` | Gauge | `{error}` |
| `tincan.browser.network.failure.count` | Gauge | `{request}` |

Metric attributes must remain bounded and low-cardinality. Agent prose, paths containing identifiers, and arbitrary application values must not become metric attributes.

## Traces

TinCan registers the official OpenTelemetry fetch and XMLHttpRequest instrumentations. Their completed CLIENT spans are passed through `TinCanFlightRecorderSpanProcessor`, immediately reduced to the privacy allowlist, and retained for 120 seconds. Retained fields are:

- trace and span identifiers
- start and end timestamps and duration
- `http.request.method`
- sanitized `url.path`
- `http.response.status_code`
- UNSET or ERROR status

Some WebMCP implementations execute a site tool in a realm that captured `fetch` before instrumentation loaded. A passive `PerformanceObserver` fallback sees these resource requests without changing the website's request flow. Where the browser exposes `PerformanceResourceTiming.responseStatus`, it records the path, duration, status, and error state. Resource Timing does not expose the HTTP method, so a fallback span is named `HTTP /path`; a later official span replaces it when both describe the same request.

## SDK integration

Applications with an OpenTelemetry provider should add TinCan to that provider once:

```ts
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { WebTracerProvider } from "@opentelemetry/sdk-trace-web";
import { createTinCan, sanitizePath } from "@tincan-webmcp/browser";
import {
  createTinCanInstrumentations,
  TinCanFlightRecorderSpanProcessor,
} from "@tincan-webmcp/otel-instrumentation";

const recorder = new TinCanFlightRecorderSpanProcessor({ maxAgeMs: 120_000, sanitizePath });
const provider = new WebTracerProvider({ spanProcessors: [recorder] });

registerInstrumentations({
  tracerProvider: provider,
  instrumentations: createTinCanInstrumentations(recorder, {
    application: { name: "acme-saas" },
    sanitizePath,
  }),
});

createTinCan({ application: { name: "acme-saas" }, spanProcessor: recorder }).start();
```

This avoids a competing provider and requires no changes to business request functions. If no processor is supplied, `createTinCan` creates the same browser instrumentation through its convenience setup.

## Transport compatibility

The current payload mirrors OTLP's resource/scope/signal nesting and semantic attribute names, but it is application JSON rather than a byte-for-byte OTLP/JSON export. For example, timestamps are ISO strings rather than OTLP nanosecond integer strings, and bodies/attributes use ordinary JSON values rather than encoded `AnyValue` objects.

A production exporter must map these fields to the official OTLP schema and send them through an OpenTelemetry Collector or OTLP/HTTP endpoint. This export adapter is planned but not implemented. Do not point the current `/_tincan/issues` payload directly at an OTLP receiver.

References:

- [OpenTelemetry logs data model](https://opentelemetry.io/docs/specs/otel/logs/data-model/)
- [OpenTelemetry metrics data model](https://opentelemetry.io/docs/specs/otel/metrics/data-model/)
- [OpenTelemetry tracing API](https://opentelemetry.io/docs/specs/otel/trace/api/)
- [OpenTelemetry semantic conventions](https://opentelemetry.io/docs/specs/semconv/)
- [Resource Timing](https://www.w3.org/TR/resource-timing/)
