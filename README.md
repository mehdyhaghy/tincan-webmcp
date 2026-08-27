# TinCan WebMCP

AI agents are beginning to use websites much like people do: navigating pages, filling forms, changing settings, and checking results. But when something goes wrong, there is no widely adopted, site-native way for an agent to explain the problem to the website or service provider.

Traditional monitoring only sees the technical side. A request may return `200 OK`, the page may produce no JavaScript errors, and performance may look healthy—even though the website completed the wrong action.

TinCan gives agents a safe way to report that kind of failure. The site sends the associated diagnostic evidence as OTLP-aligned logs, metrics, and traces, ready to map into an existing OpenTelemetry pipeline.

## What TinCan does

TinCan adds one WebMCP tool to a website: `report_site_issue`. The agent supplies the meaning of the problem—what it expected, what it observed, and which operation was involved. The website privately attaches recent technical evidence from its own browser flight recorder.

```text
Agent notices a mismatch
        ↓
report_site_issue
        ↓
Site snapshots recent OpenTelemetry signals
        ↓
Developer receives one correlated issue
```

The raw browser evidence is never returned to the agent. The agent receives only a confirmation and incident ID.

## The demo

The included fictional SaaS app begins with a Business subscription and 10 seats. The requested task is simple: upgrade the account to 20 seats.

The mutation reports success, but a verification read shows that only 19 seats were persisted. Every HTTP request succeeded and no JavaScript exception occurred. The agent can still recognize the incorrect business result and report:

- Expected: `20 seats`
- Observed: `19 seats`
- Operation: `change_seat_count`
- Severity: `blocking`

TinCan turns that observation into an issue containing bounded, sanitized OpenTelemetry logs, metrics, and traces.

## Implementation status

The current reference implementation includes the browser recorder, privacy sanitizer, WebMCP tools, Bun ingestion API, in-memory issue store, demo application, investigation UI, and unit tests. Native OTLP/HTTP export, trace-header propagation, Web Vitals, XHR/resource collectors, persistent storage, and Playwright E2E coverage remain planned work.

## Privacy boundary

The agent reports meaning; the site controls evidence. TinCan never automatically captures request or response bodies, credentials, cookies, browser storage, form values, keystrokes, DOM contents, or screenshots. Sensitive values are sanitized in the browser and checked again by the server.

## Run locally

TinCan uses Bun, Vue 3, Vite, and strict TypeScript 6.0.3.

```bash
bun install
bun run dev
```

Then open:

- Demo SaaS: `http://127.0.0.1:5173`
- Signal investigation UI: `http://127.0.0.1:5174`
- Bun API: `http://127.0.0.1:8787`

Run the project checks with:

```bash
bun run typecheck
bun run test
bun run build
```

See [docs/testing.md](docs/testing.md) for the complete manual, WebMCP, API, and automated testing workflows.

## Repository layout

- `packages/browser` — flight recorder, sanitization, and signal collection
- `packages/webmcp` — WebMCP tool registration
- `packages/server` — validation, classification, and issue storage hooks
- `packages/otel` — OpenTelemetry-compatible signal types
- `apps/demo-saas` — Vue subscription demo
- `apps/issues-ui` — developer investigation interface
- `apps/api` — Bun reference API and demo state

## Documentation

- [Testing](docs/testing.md) — UI walkthrough, real WebMCP calls, API checks, and automation
- [Architecture](docs/architecture.md) — packages, runtime services, and incident lifecycle
- [WebMCP tools](docs/webmcp.md) — schemas, results, registration, and compatibility
- [OpenTelemetry mapping](docs/opentelemetry.md) — logs, metrics, traces, and OTLP boundaries
- [Security and privacy](docs/security.md) — trust boundary, sanitization, limits, and deployment warnings
- [Contributing](CONTRIBUTING.md) — development workflow and pull-request expectations
- [Contest specification](spec.md) — complete product and acceptance requirements

## License

TinCan WebMCP is licensed under Apache-2.0. Direct dependencies are limited to permissively licensed components; see [docs/license-policy.md](docs/license-policy.md).
