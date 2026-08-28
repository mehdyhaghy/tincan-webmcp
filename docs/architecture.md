# Architecture

TinCan joins an agent's semantic observation with recent site-owned browser signals. The agent never receives the private diagnostic payload.

```text
User goal
  ↓
Browser agent (/agent)
  ├─ discovers site tools through WebMCP
  ├─ invokes a business tool
  ├─ verifies the result when a read tool is available
  └─ calls report_site_issue only after a verified failure
            ↓
Target site (/)
  ├─ business WebMCP tools
  ├─ TinCan report_site_issue tool
  └─ browser recorder
       ├─ sanitized log records
       ├─ bounded metric points
       └─ browser HTTP spans
            ↓
       POST /_tincan/issues
            ↓
       validate, re-sanitize, classify, and store
            ↓
       Admin issue UI (/admin/*)
```

## Workspace packages

- `@tincan-webmcp/browser` provides the framework-independent recorder, sanitization, bounded buffer, incident assembly, and HTTP transport.
- `@tincan-webmcp/webmcp` registers `report_site_issue` through the current document-scoped WebMCP API.
- `@tincan-webmcp/server` validates incoming incidents, sanitizes them again, generates IDs/fingerprints, and performs semantic-only classification.
- `@tincan-webmcp/otel` defines the internal resource, instrumentation scope, LogRecord, Metric, and Span types.

## Applications

- `apps/demo-saas` is one Vue application containing the target site, the browser agent, and the admin issue interface. The target site registers three business tools plus TinCan's reporting tool.
- `apps/api` is a Bun reference server with in-memory subscription and issue state.

The web application uses one origin and port. Vite proxies `/api` and `/_tincan` to the Bun server during local development, preserving same-origin calls for every route.

## Incident lifecycle

1. `TinCanRecorder.start()` records navigation and instruments `fetch`, console warnings/errors, window errors, and unhandled rejections.
2. The browser agent receives a user goal and discovers tools from the target site's descendant frame with `getTools()`; it does not inspect or operate the visible product controls.
3. The agent selects and invokes a business tool from its metadata, then uses a read-only tool to verify the result when available.
4. Only when that evidence indicates failure does the agent call `report_site_issue` with semantic fields such as `expected`, `observed`, and `operation`.
5. The recorder adds an issue LogRecord and freezes the current logs, metrics, and spans.
6. The browser posts the payload to `/_tincan/issues`.
7. The server validates lengths and enums, sanitizes the complete payload again, and generates an `INC-*` ID.
8. The issue is classified as semantic-only when severity is not `info`, no JavaScript error was recorded, and no HTTP response has a failure status.

## Reference API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/subscription` | Read persisted demo state |
| `POST` | `/api/licenses` | Add `count` licenses to the subscription |
| `POST` | `/api/usage-export` | Return the demo gateway-timeout failure |
| `POST` | `/api/reset` | Restore 10 licenses and clear issues |
| `GET` | `/api/issues` | List in-memory issues |
| `POST` | `/_tincan/issues` | Validate and ingest a TinCan issue |

The canonical defect is deliberately implemented in the license endpoint: adding 10 licenses to the initial 10 reports an expected total of 20 but persists 19. The product form and `add_licenses` WebMCP tool use this same operation.

## Current boundaries

The reference store is process memory only and is cleared on restart. It has no authentication, tenancy, durable persistence, or production exporter. The browser currently instruments `fetch`, not XHR. Web Vitals, resource failures, long tasks, trace propagation, native OTLP export, and collector adapters remain future work.
