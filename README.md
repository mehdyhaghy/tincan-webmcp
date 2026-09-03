# TinCan WebMCP

AI agents are beginning to use websites much like people do: navigating pages, filling forms, changing settings, and checking results. But when something goes wrong, there is no widely adopted, site-native way for an agent to explain the problem to the website or service provider.

Traditional monitoring only sees the technical side. A request may return `200 OK`, the page may produce no JavaScript errors, and performance may look healthy—even though the website completed the wrong action.

TinCan gives agents a safe way to report that kind of failure. The site sends the associated diagnostic evidence as OTLP-aligned logs, metrics, and traces, ready to map into an existing OpenTelemetry pipeline.

## What TinCan does

TinCan adds one WebMCP tool to a website: `report_site_issue`. The agent supplies the meaning of the problem—what it expected, what it observed, and which operation was involved. The website privately attaches recent technical evidence from its own browser flight recorder.

![TinCan WebMCP architecture](docs/architecture.png)

The raw browser evidence is never returned to the agent. The agent receives only a confirmation and incident ID.

## The demo

The fictional SaaS app begins with a Business subscription and 10 active licenses. Its human UI has fixed **Add license** and **Remove license** buttons. Agents receive equivalent parameterized WebMCP tools: `add_licenses({ count: n })` and `remove_licenses({ count: n })`.

Adding licenses contains a semantic defect: requesting `n` licenses persists `n + 1`. In the canonical demo, the agent starts at 10 and requests one license. The mutation reports an expected total of 11, but verification finds 12. Every request succeeds and no JavaScript exception occurs. The agent can still recognize and report:

- Expected: `11 licenses`
- Observed: `12 licenses`
- Operation: `add_licenses`
- Severity: `blocking`

Removing a license exercises a second failure mode. Both the UI and `remove_licenses` call the same endpoint, which returns HTTP `504` without changing the subscription. TinCan turns either observation into an issue containing bounded, sanitized OpenTelemetry logs, metrics, and traces.

The canonical agent is Codex in the ChatGPT desktop app's built-in browser. The `/agent` route is only a deterministic developer harness for testing Chrome's draft API; it is not the canonical OpenAI flow. Neither path requires an OpenAI API key in this project.

## Implementation status

The current reference implementation includes the browser agent, privacy sanitizer, WebMCP tools, Bun ingestion API, in-memory issue store scoped to anonymous sessions, unified Vue application, investigation UI, focused Vitest coverage, and OpenTelemetry fetch/XHR instrumentation with a Resource Timing fallback and a 120-second flight recorder. Native OTLP/HTTP export, trace-header propagation, Web Vitals, and persistent storage remain planned work.

## Privacy boundary

The agent reports meaning; the site controls evidence. TinCan never automatically captures request or response bodies, credentials, cookies, browser storage, form values, keystrokes, DOM contents, or screenshots. Sensitive values are sanitized in the browser and checked again by the server.

## Run locally

TinCan uses Bun, Vue 3, Vite, and strict TypeScript 6.0.3.

```bash
bun install
bun run dev
```

Then open:

- Demo SaaS: `http://127.0.0.1:5173/`
- Developer harness: `http://127.0.0.1:5173/agent`
- Signal investigation UI: `http://127.0.0.1:5173/admin/overview`
- Bun API: `http://127.0.0.1:8787`

The site, developer harness, and admin UI are routes in one Vue application and share port `5173`.

## Demo with Codex desktop

The canonical showcase follows OpenAI's [Site tools documentation](https://learn.chatgpt.com/docs/webmcp):

1. Update the ChatGPT desktop app and select GPT-5.6 Sol or Terra.
2. Enable **Settings → Browser → Permissions → Enable site tools**.
3. Open `https://tincandemo.haghy.com/` and click **Reset demo**. Confirm that the page shows 10 active licenses before handing control to the agent.
4. Start a new Codex chat, select `@Browser`, and use the open demo page directly. Do not use `/agent` or an iframe.
5. Open **Site tools → Available site tools** in the built-in browser address bar and confirm that the page provides `add_licenses`, `remove_licenses`, `get_subscription`, `export_usage_report`, and `report_site_issue`.
6. Paste this prompt:

   ```text
   go to https://tincandemo.haghy.com/ add one license and verify results. Use only the WebMCP Site tools exposed by this page. Follow the descriptions of any relevant website tools you discover when handling the results. At the end, tell me which Site tools you called, in order, and what each returned.
   ```

The run exposes the designed add-license defect: adding one license persists two, so the read-back shows 12 where 11 was expected. The agent should discover `report_site_issue` from its description and file the mismatch. Use **Site tools → Recently used** to prove these were browser-mediated Site tool calls. Finally, open `https://tincandemo.haghy.com/admin/issues` to inspect the incident and its OTLP-compatible evidence.

Site tools depend on OpenAI rollout and are currently unavailable in Enterprise and Edu workspaces. If the tools do not appear in the built-in browser, the canonical OpenAI demo is unavailable for that account.

## Manual Chrome WebMCP testing

Chrome's local testing flag is useful for the developer harness and manual API checks; it is not required by Codex's built-in browser:

1. Open `chrome://flags/#enable-webmcp-testing` in Chrome 149 or newer.
2. Set **WebMCP testing** to **Enabled**.
3. Relaunch Chrome completely, then reload the demo.
4. In DevTools Console, verify that
   `typeof document.modelContext?.registerTool` returns `"function"`.

If the page still reports **WebMCP unavailable**, the browser API is not active
in that Chrome session. Enablement is a prerequisite for testing with a browser
agent or the ChatGPT Chrome extension; it does not by itself guarantee that a
particular extension can discover or invoke WebMCP tools.

Run the project checks with:

```bash
bun run check:secrets
bun run typecheck
bun run test
bun run build
```

See [docs/testing.md](docs/testing.md) for the complete manual, WebMCP, API, and automated testing workflows.

## Repository layout

- `packages/browser` — flight recorder, incident assembly, and transport
- `packages/core` — shared incident contracts and server-safe sanitization
- `packages/otel-instrumentation` — OpenTelemetry fetch/XHR integration, Resource Timing fallback, and the 120-second span processor
- `packages/webmcp` — WebMCP tool registration
- `packages/server` — validation, classification, and issue storage hooks
- `packages/otel` — OpenTelemetry-compatible signal types
- `apps/demo-saas` — single Vue application containing the site, browser agent, and admin routes
- `apps/api` — Bun reference API and demo state

## Documentation

- [Testing](docs/testing.md) — UI walkthrough, real WebMCP calls, API checks, and automation
- [Architecture](docs/architecture.md) — packages, runtime services, and incident lifecycle
- [WebMCP tools](docs/webmcp.md) — schemas, results, registration, and compatibility
- [OpenTelemetry mapping](docs/opentelemetry.md) — logs, metrics, traces, and OTLP boundaries
- [Security and privacy](docs/security.md) — trust boundary, sanitization, limits, and deployment warnings
- [Deployment](docs/deployment.md) — single-process Bun deployment and the HTTPS host setup
- [Contributing](CONTRIBUTING.md) — development workflow and pull-request expectations
- [Contest specification](spec.md) — complete product and acceptance requirements

## License

TinCan WebMCP is licensed under Apache-2.0. Direct dependencies are limited to permissively licensed components; see [docs/license-policy.md](docs/license-policy.md).
