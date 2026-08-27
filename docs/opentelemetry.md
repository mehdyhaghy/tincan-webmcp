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
| `tincan.browser.http.request` | Completed or failed browser fetch |
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

Each instrumented `fetch` creates a CLIENT span with:

- a lowercase 32-character trace ID and 16-character span ID
- start and end timestamps
- `http.request.method`
- sanitized `url.path`
- `http.response.status_code`
- measured duration
- UNSET or ERROR status

The current recorder generates standalone browser trace IDs. It does not yet inject `traceparent`, consume an installed OpenTelemetry provider, or link the reported issue to an existing backend span.

## Transport compatibility

The current payload mirrors OTLP's resource/scope/signal nesting and semantic attribute names, but it is application JSON rather than a byte-for-byte OTLP/JSON export. For example, timestamps are ISO strings rather than OTLP nanosecond integer strings, and bodies/attributes use ordinary JSON values rather than encoded `AnyValue` objects.

A production exporter must map these fields to the official OTLP schema and send them through an OpenTelemetry SDK, Collector, or OTLP/HTTP endpoint. This adapter is planned but not implemented. Do not point the current `/_tincan/issues` payload directly at an OTLP receiver.

References:

- [OpenTelemetry logs data model](https://opentelemetry.io/docs/specs/otel/logs/data-model/)
- [OpenTelemetry metrics data model](https://opentelemetry.io/docs/specs/otel/metrics/data-model/)
- [OpenTelemetry tracing API](https://opentelemetry.io/docs/specs/otel/trace/api/)
- [OpenTelemetry semantic conventions](https://opentelemetry.io/docs/specs/semconv/)
