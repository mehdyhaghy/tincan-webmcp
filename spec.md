# TinCan WebMCP

> A secure diagnostic channel between AI agents and the websites they operate.

**Project:** `tincan-webmcp`  
**Tool:** `report_site_issue`  
**Target:** WebMCP Challenge  
**License:** Apache-2.0  
**Specification:** Contest edition, v0.2 - August 26, 2026

## Contest Thesis

WebMCP lets agents act on a website. TinCan gives those agents a structured way to report when the website technically succeeds but semantically fails, while the host privately attaches its own browser evidence.

## 1. Executive Brief

TinCan WebMCP is a privacy-safe frontend flight recorder activated by a single WebMCP reporting tool. The agent supplies semantic information - what it expected versus what it observed. The host site privately supplies technical evidence: recent logs, browser errors, network metadata, performance signals, application data, and trace correlation.

The key case is a task that is technically healthy but behaviorally wrong. Monitoring may see HTTP 200, no JavaScript errors, and healthy performance while the agent sees that adding one license to an existing 10 resulted in a total of 12 instead of 11. A second case returns HTTP 504 when removing a license.

### MVP promise

- One WebMCP tool: `report_site_issue`.
- A 120-second in-memory flight recorder for host-page diagnostics.
- No raw diagnostics returned to the agent.
- A signal-oriented Issue Details view grounded in OpenTelemetry.
- Optional OpenTelemetry trace/request correlation.
- A minimal goal-driven browser agent that discovers tools without importing website-specific APIs or clicking the visible UI.
- A polished SaaS demo where technical signals are healthy but the business outcome is wrong.

TinCan is not a full RUM platform, DevTools over WebMCP, or a way for agents to read browser logs. It is a narrow agent-to-site diagnostic channel with host-controlled evidence collection.

## 2. Contest Strategy

Build for the judging rubric, not maximum SDK surface area.

| Criterion | TinCan approach | Demo proof |
| --- | --- | --- |
| WebMCP leverage | WebMCP is the core semantic reporting channel. | Agent discovers and calls `report_site_issue`. |
| Execution | Complete agent, SaaS, and admin workflow. | The browser agent discovers tools, performs an action, verifies it, and opens the reported issue with attached browser evidence. |
| Potential impact | Detect semantic failures RUM/APM cannot infer. | Requests return 200 and JS errors remain zero. |
| Creativity | Join agent intent, browser evidence, and backend traces. | The resulting semantic incident preserves site security. |

Submission constraints: a live WebMCP-enabled app, public open-source repository, clear written explanation, and a public YouTube demo under three minutes with audio. Judges must be able to access the live app. Deadline: September 3, 2026 at 1:00 PM PDT / 3:00 PM CDT.

## 3. Judge-Facing Product Experience

Build a polished fictional SaaS subscription portal for both human users and WebMCP agents. A person can add or remove one license with fixed UI actions, while an agent can request `n` licenses through WebMCP without clicking or reading the UI. The agent receives only a user goal and WebMCP tool metadata from the website; it must not import or directly call website application functions.

| Step | Required behavior |
| --- | --- |
| Starting state | Business plan, 10 active licenses |
| Human action | Click the fixed Add license or Remove license action |
| Agent input | Natural-language goal: add one license, remove one license, and verify each saved result |
| Discovery | Agent calls `getTools()` and chooses tools from names, descriptions, schemas, and annotations |
| Agent action | Agent calls `add_licenses({ count: 1 })`, verifies, then calls `remove_licenses({ count: 1 })` and verifies again |
| Injected defects | Add persists `n + 1`; remove returns HTTP 504 and does not change state |
| Technical state | Add returns 200 without a JS exception; remove returns 504 |
| Verification | Agent calls `get_subscription()` after each mutation |
| TinCan action | Agent reports the wrong add result and removal timeout through discovered tool guidance |
| Payoff | Issues page shows the semantic failure with host-only evidence and trace data |

The agent carries user intent and compares it with structured site observations. TinCan provides the reporting channel; it does not infer the mismatch. The target site must not expose “simulate error,” “run failure,” or manual reporting controls.

```text
User intent -> add_licenses({ count: 1 })
            -> action returns { expectedLicenseCount: 11 }
            -> get_subscription() returns { licenseCount: 12 }
            -> agent detects mismatch
            -> report_site_issue({ expected: "11 licenses", observed: "12 licenses" })
            -> remove_licenses({ count: 1 }) returns HTTP 504
            -> agent reports the timeout
```

## 4. Issue UX

Use a signal-oriented investigation layout based on the OpenTelemetry logs, metrics, and traces data models. The issue view must be data-driven and support every issue category, with optional descriptions, expected and observed outcomes, operation metadata, and a technical-evidence summary derived from the attached signals. The seat-count mismatch is demo data, not a fixed UI model. Present event records, metric points, and linked spans without imitating a specific vendor's product model.

At the bottom of each issue, expose a collapsible JSON view of the complete server-sanitized submitted incident payload: the agent observation, host-added timestamp, resource and scope metadata, page attributes, diagnostics, and optional trace context. Exclude server-generated IDs, fingerprints, and classifications. Never imply that sanitized stored data is the unsanitized original payload.

The canonical issue is blocking, titled "Adding licenses produced an incorrect total," and includes environment, application version, pathname, operation, health checks, recent breadcrumbs, and evidence tabs.

## 5. WebMCP Contract

Register a concrete public tool with `document.modelContext.registerTool(...)`; keep this implementation easy to find.

```ts
type ReportSiteIssueInput = {
  category:
    | "wrong_result"
    | "unexpected_behavior"
    | "action_failed"
    | "network_failure"
    | "performance"
    | "ui_state_mismatch"
    | "other";
  severity: "info" | "degraded" | "blocking";
  summary: string;       // <= 300 chars
  description?: string; // <= 2000 chars
  expected?: string;    // <= 1000 chars
  observed?: string;    // <= 1000 chars
  operation?: string;   // <= 200 chars
};
```

Agent-visible output is limited to:

```json
{ "status": "reported", "incidentId": "INC-1042" }
```

Never return console logs, stack traces, request metadata, application state, or trace IDs to the agent.

Reporting is initiated only when the browser agent calls `report_site_issue` after it has invoked a business tool and evaluated the result. The target site must not call its own WebMCP tools, infer the issue, or invoke TinCan automatically. It may show non-blocking notifications when the agent starts and completes a TinCan tool call. The issue viewer uses stable `/admin/*` routes and displays all issue and log times explicitly in UTC.

## 6. Frontend Flight Recorder

Use a bounded, memory-only ring buffer. Capture safe metadata continuously and freeze a snapshot when an issue is reported.

| OpenTelemetry signal | Capture | Default privacy rule |
| --- | --- | --- |
| Logs | JS errors, rejected promises, console warnings/errors, navigation, resource failures, and the agent observation | Sanitize bounded bodies and attributes; no arbitrary object dumping |
| Metrics | Request duration/count, failure count, long tasks, CLS, INP, LCP, FCP, and TTFB | Low-cardinality attributes and bounded aggregates only |
| Traces | Fetch/XHR spans and optional host/backend span links | No bodies or auth/cookie headers; allowlisted trace identifiers only |
| Application data | Host-defined providers attached as resource or event attributes | Execute only at issue time; bound size and time |

Defaults: 120-second window, 500 events, 1 MB memory, 256 KB incident payload, no persistence, FIFO eviction by age/count/bytes.

## 7. Privacy & Security Model

The agent reports meaning. The site controls evidence. Diagnostic data goes to the site backend, never back to the agent.

Never capture cookies, authorization headers, bodies, form values, keystrokes, clipboard, browser storage contents, DOM text/HTML, screenshots, tokens, API keys, or private keys.

Strip URL origins, query strings, fragments, and credentials by default. Mask UUIDs and long numeric path identifiers. Recursively redact keys such as `password`, `token`, `authorization`, `cookie`, `api_key`, `jwt`, and `private_key`. Detect bearer tokens, JWT-like strings, payment-card-like values, and PEM private-key markers conservatively. Repeat sanitization server-side. Treat all agent text as inert, untrusted data; it cannot alter capture scope, destination, headers, or privacy policy.

## 8. Implementation Architecture

```text
Single Vue Web App
|-- Target site (`/`)
|-- TinCan Browser SDK
|   |-- OpenTelemetry fetch/XHR instrumentation
|   |-- Resource Timing fallback
|   |-- sanitizer
|   |-- 120-second flight recorder
|   |-- application providers
|   |-- correlation adapter
|   |-- incident assembler
|   `-- HTTP transport
|-- WebMCP Adapter
|   `-- report_site_issue
|-- Demo business tools
    |-- add_licenses
    |-- remove_licenses
    |-- get_subscription
    `-- export_usage_report
|-- Browser agent (`/agent`)
|   |-- getTools discovery
|   |-- metadata/schema-based action selection
|   |-- optional read-back verification
|   `-- conditional report_site_issue call
`-- Admin UI (`/admin/*`)

POST /_tincan/issues
|-- validate, re-sanitize, and rate-limit
|-- fingerprint and semantic-only classification
|-- persist or stream issue
`-- optional OTel span/event/link
```

Packages: `@tincan-webmcp/core`, `@tincan-webmcp/browser`, `@tincan-webmcp/otel-instrumentation`, `@tincan-webmcp/webmcp`, `@tincan-webmcp/server`, and `@tincan-webmcp/otel`. Apps: one Vue application in `apps/demo-saas` for the target site, developer harness, and admin routes, plus the Bun reference API in `apps/api`.

Browser functionality must remain framework-independent. Use strict TypeScript. The demo stack may use Vite with a frontend framework, a reference server, and Vitest.

## 9. Incident Model & Semantic Classification

```ts
type TinCanIncident = {
  schemaVersion: "1.0";
  agentObservation: {
    timestamp: string;
    category: string;
    severity: string;
    summary: string;
    expected?: string;
    observed?: string;
    operation?: string;
  };
  resource: { attributes: Record<string, string> };
  instrumentationScope: { name: string; version?: string };
  attributes: { "url.path": string; "browser.visibility_state": string };
  diagnostics: OtelTelemetrySnapshot & { truncated?: boolean };
  correlation?: { traceId?: string; spanId?: string; requestIds?: string[] };
};
```

`OtelTelemetrySnapshot` uses OTLP-shaped `resourceLogs`, `resourceMetrics`, and `resourceSpans`. Log records use timestamp, observed timestamp, event name, severity, body, resource, scope, attributes, and optional trace/span identifiers. Metric streams use gauge, sum, or histogram points with units and low-cardinality attributes. Spans use W3C-compatible trace/span identifiers, start/end time, kind, status, attributes, events, and links. TinCan-specific names are lowercase and namespaced under `tincan.*`; established semantic-convention names such as `service.name`, `deployment.environment.name`, `url.path`, `http.request.method`, and `http.response.status_code` are reused.

```ts
const semanticOnly =
  issue.severity !== "info" &&
  jsErrorCount === 0 &&
  failedSpanCount === 0;
```

## 10. Backend & OpenTelemetry

`POST /_tincan/issues` uses JSON and same-origin credentials. Validate schema and content type, enforce a 256 KB body limit and rate limit, re-sanitize sensitive data, generate a server incident ID and stable fingerprint, classify `semanticOnly`, and persist through a callback. The SDK does not require a database.

OpenTelemetry export is optional, but the internal diagnostics model always follows OTLP shapes for logs, metrics, and traces. The browser integration uses the official fetch and XHR instrumentations plus a passive Resource Timing fallback for requests made from an unpatched realm. It retains only sanitized span fields for 120 seconds. Consume an existing provider when installed instead of initializing a competing provider. Safe attributes include category, severity, service name/version, deployment environment, URL path, HTTP method, response status, and duration. Free-form agent prose belongs in LogRecord bodies or span events, never metric attributes. If an originating span exists, link the issue span to it; do not manufacture trace ancestry.

## 11. Build Plan

Prioritize the end-to-end contest story before SDK breadth.

| Priority | Deliverable | Must prove | Defer if needed |
| --- | --- | --- | --- |
| P0 | Demo SaaS and real WebMCP business tools | Agent acts and verifies state | Additional scenarios |
| P0 | Minimal WebMCP browser agent | Goal leads to discovered action, verification, and conditional TinCan report | General-purpose planning |
| P0 | Reporting tool and flight recorder | Mismatch becomes an issue with captured browser evidence | Advanced collectors |
| P0 | OpenTelemetry signal investigation UI | Evidence is immediately clear | Charts/dashboarding |
| P1 | Privacy sanitizer and server validation | No sensitive payload leakage | Advanced PII detection |
| P1 | OTel/request correlation | Issue links to distributed execution | Vendor exporters |
| P1 | Tests and public README | Runnable open-source project | Framework adapters |
| P2 | Collector polish | More evidence depth | Replay, screenshots, offline queue |

## 12. Release-Blocking Acceptance Tests

- `report_site_issue` is discoverable in a WebMCP-capable browser.
- The browser agent starts only with a user goal and discovered WebMCP metadata; it does not import target-site functions or operate visible UI controls.
- The target site contains no scripted failure or manual reporting controls.
- Adding one license through `add_licenses({ count: 1 })` produces an expected total of 11 and a persisted total of 12.
- Removing one license through `remove_licenses({ count: 1 })` returns HTTP 504 and leaves the persisted total unchanged.
- The same add and remove operations are available as fixed one-license actions in the human UI.
- The 11-to-12 demo creates an issue with HTTP 200 everywhere and zero JS exceptions.
- The agent receives only status and incident ID.
- Authorization, cookies, JWTs, API keys, passwords, payment-card-like values, and URL query secrets are redacted.
- Request and response bodies never appear in diagnostic payloads.
- Instrumentation does not change fetch values/errors, XHR or console behavior, or navigation.
- The ring buffer enforces time, count, and byte limits.
- The host page works if a collector fails or WebMCP is unavailable.
- The server validates and re-sanitizes independently.
- The live demo has a one-click Reset Demo action.

Use Vitest for unit and integration tests, strict TypeScript, and a documented manual WebMCP browser check. Privacy tests block release.

## 13. Demo Video Plan

Target 2:30-2:45. Open with the problem, show the fixed human add/remove actions, then give the canonical browser agent the combined goal. Show `add_licenses`, `get_subscription`, `remove_licenses`, and any agent-selected reporting calls in Site tools → Recently used. Verify the incorrect 12-license add result and the removal timeout, inspect both Issue Details views and their OpenTelemetry evidence, show the single-process architecture, and close on "Semantic observability for the agentic web."

## 14. Submission Checklist

- Working live URL accessible in the ChatGPT in-app browser or Chrome with WebMCP enabled.
- Public source repository with run instructions and an open-source license.
- Concrete tool registration easy to find.
- README explaining why WebMCP matters, the improved experience, and the implementation.
- Public YouTube demo under three minutes with audio.
- Demo remains free and unrestricted during judging.
- English submission materials.
- Commit history clearly shows hackathon-period work.
- Submit before September 3, 2026 at 1:00 PM PDT / 3:00 PM CDT.

## 15. Definition of Done

```text
User intent
  -> WebMCP action
  -> structured verification
  -> agent detects semantic mismatch
  -> report_site_issue
  -> host recorder snapshots private evidence
  -> Issue Details: Expected 11 licenses / Observed 12 licenses
  -> captured browser evidence and any explicitly linked trace context
```

**One-sentence MVP:** Build a privacy-safe frontend flight recorder and WebMCP reporting channel that lets an AI agent report a semantic host-site failure, causing the website to privately attach recent sanitized browser diagnostics and trace data to a familiar developer issue without exposing those diagnostics to the agent.

## 16. Verified References

The source specification cites the WebMCP Challenge official rules, WebMCP Draft Community Group Report (August 26, 2026), Chrome documentation, OpenTelemetry logs, metrics, traces, and semantic-convention specifications, and Google `web-vitals`. Source verification date: August 26, 2026.
