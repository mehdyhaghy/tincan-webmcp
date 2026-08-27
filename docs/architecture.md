# Architecture

TinCan joins an agent's semantic observation with recent site-owned browser signals. The agent never receives the private diagnostic payload.

```text
Demo page
  ├─ WebMCP business tools
  ├─ report_site_issue
  └─ browser recorder
       ├─ sanitized log records
       ├─ bounded metric points
       └─ browser HTTP spans
              ↓
       POST /_tincan/issues
              ↓
       validate and re-sanitize
              ↓
       classify and store issue
              ↓
       signal investigation UI
```

## Workspace packages

- `@tincan-webmcp/browser` provides the framework-independent recorder, sanitization, bounded buffer, incident assembly, and HTTP transport.
- `@tincan-webmcp/webmcp` registers `report_site_issue` through the current document-scoped WebMCP API.
- `@tincan-webmcp/server` validates incoming incidents, sanitizes them again, generates IDs/fingerprints, and performs semantic-only classification.
- `@tincan-webmcp/otel` defines the internal resource, instrumentation scope, LogRecord, Metric, and Span types.

## Applications

- `apps/demo-saas` is the Vue subscription portal and registers the two business tools.
- `apps/issues-ui` displays the semantic observation and its three correlated signal groups.
- `apps/api` is a Bun reference server with in-memory subscription and issue state.

Vite proxies `/api` and `/_tincan` to the Bun server during local development, preserving same-origin browser calls from each frontend.

## Incident lifecycle

1. `TinCanRecorder.start()` records navigation and instruments `fetch`, console warnings/errors, window errors, and unhandled rejections.
2. A business operation completes and the agent verifies the persisted result.
3. The agent calls `report_site_issue` with semantic fields such as `expected`, `observed`, and `operation`.
4. The recorder adds an issue LogRecord and freezes the current logs, metrics, and spans.
5. The browser posts the payload to `/_tincan/issues`.
6. The server validates lengths and enums, sanitizes the complete payload again, and generates an `INC-*` ID.
7. The issue is classified as semantic-only when severity is not `info`, no JavaScript error was recorded, and no HTTP response has a failure status.

## Reference API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/subscription` | Read persisted demo state |
| `POST` | `/api/subscription` | Change the requested seat count |
| `POST` | `/api/reset` | Restore 10 seats and clear issues |
| `GET` | `/api/issues` | List in-memory issues |
| `POST` | `/_tincan/issues` | Validate and ingest a TinCan issue |

The canonical defect is deliberately implemented in the subscription endpoint: a request for exactly 20 seats persists 19 while returning a successful response.

## Current boundaries

The reference store is process memory only and is cleared on restart. It has no authentication, tenancy, durable persistence, or production exporter. The browser currently instruments `fetch`, not XHR. Web Vitals, resource failures, long tasks, trace propagation, native OTLP export, and collector adapters remain future work.
