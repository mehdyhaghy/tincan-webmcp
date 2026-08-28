# Testing TinCan

## Prerequisites

- Bun 1.3.13 or a compatible newer release
- A modern browser for the UI flow
- Chrome 149 or newer with WebMCP testing enabled for real tool discovery and
  execution

Install dependencies and start the two local processes:

```bash
bun install --frozen-lockfile
bun run dev
```

The target site, browser agent, and admin UI are routes in one Vue application at `http://127.0.0.1:5173`. The Bun API runs at `http://127.0.0.1:8787` and is reached through the web app's same-origin development proxy. No OpenAI API key is required.

Before opening the demo, enable Chrome's local WebMCP implementation:

1. Open `chrome://flags/#enable-webmcp-testing`.
2. Set **WebMCP testing** to **Enabled**.
3. Relaunch Chrome completely.
4. Open the demo and confirm in DevTools Console that
   `typeof document.modelContext?.registerTool` returns `"function"`.

If the page reports **WebMCP unavailable**, stop there: the browser API is not
enabled in that Chrome session, so no browser agent or extension can discover
the site's tools. Enabling the API makes the tools available to compatible
agents, but does not establish that every Chrome extension supports WebMCP.

## Browser agent flow

1. Open `http://127.0.0.1:5173/` in a WebMCP-capable browser and click **Reset demo**.
2. Confirm the normal product form accepts a number from 1 to 100 and offers **Add licenses**. This form and the agent tool call the same API operation.
3. Open `http://127.0.0.1:5173/agent`.
4. Keep the default goal: “Add 10 licenses to the subscription and verify the saved result.”
5. Click **Run browser agent**.
6. Confirm the agent discovers the site's tools without clicking the product UI, selects `add_licenses`, passes `{ count: 10 }`, invokes `get_subscription`, and detects an expected total of 20 but a saved total of 19.
7. Confirm the agent then discovers and calls `report_site_issue`; the target site shows agent-detected and report-success notifications.
8. Open `http://127.0.0.1:5173/admin/issues` and inspect the resulting issue, Logs, Metrics, Traces, and full submitted payload.

To exercise a different tool result, change the agent goal to “Export the usage report” and run it again. The agent should select `export_usage_report`, observe HTTP `504`, and call TinCan with a network-failure report.

The target website never invokes its own tools, injects a scripted browser-side flow, or decides to report. It only implements the business behavior and exposes WebMCP tools. The agent owns tool selection, verification, failure detection, and the decision to call TinCan.

The admin UI uses stable routes: `/admin/overview`, `/admin/issues`, `/admin/issues/:incidentId`, `/admin/signal-health`, and `/admin/settings`. Refreshing a deep issue link and browser back/forward navigation must preserve the view. The TinCan logo links to `/admin/overview`.

The report result shown to the agent/UI must contain only `status` and `incidentId`.

## Real WebMCP flow

Follow Chrome's current [WebMCP setup instructions](https://developer.chrome.com/docs/ai/webmcp). The setup above enables the current local testing implementation. Re-check Chrome's documentation if the flag name or minimum version changes.

With the demo open, use the Chrome DevTools WebMCP panel or run:

```js
const tools = await document.modelContext.getTools();
tools.map((tool) => tool.name);
```

Expected tool names:

```js
["report_site_issue", "add_licenses", "get_subscription", "export_usage_report"]
```

Execute the business operation and verify its persisted result:

```js
const tool = (name) => tools.find((candidate) => candidate.name === name);

await document.modelContext.executeTool(
  tool("add_licenses"),
  JSON.stringify({ count: 10 }),
);

await document.modelContext.executeTool(tool("get_subscription"), "{}");
```

The action result reports `expectedLicenseCount: 20`, while the read-back call returns `licenseCount: 19`. Report the mismatch:

```js
await document.modelContext.executeTool(tool("report_site_issue"), JSON.stringify({
  category: "wrong_result",
  severity: "blocking",
  summary: "Adding licenses produced an incorrect total",
  expected: "20 licenses",
  observed: "19 licenses",
  operation: "add_licenses",
}));
```

If `document.modelContext` is undefined, confirm the browser supports the latest draft API, the testing flag is enabled, and the page is loaded from localhost or another secure origin. The current API baseline is the [WebMCP Draft Community Group Report](https://webmachinelearning.github.io/webmcp/).

## API smoke checks

```bash
curl -X POST http://127.0.0.1:8787/api/reset
curl -X POST http://127.0.0.1:8787/api/licenses \
  -H 'content-type: application/json' \
  -d '{"count":10}'
curl http://127.0.0.1:8787/api/subscription
```

The action response should contain `"expectedLicenseCount":20`, and the final subscription response should contain `"licenseCount":19`. Use the UI or WebMCP flow to test issue ingestion because it produces the complete diagnostic payload.

## Automated checks

```bash
bun run check:secrets
bun run typecheck
bun run test
bun run build
```

The current suite contains nine Vitest tests covering sanitization, ring-buffer eviction, server validation, semantic-only classification, and preservation of nested signal data. `bun run test:e2e` is reserved for Playwright, but no E2E tests are committed yet.

## Troubleshooting

- **`bun: command not found`:** add Bun to your shell path or run `~/.bun/bin/bun`.
- **Port already in use:** stop the process using 5173 or 8787 before restarting.
- **Agent reports WebMCP unavailable:** open `chrome://flags/#enable-webmcp-testing`, enable the flag, relaunch Chrome completely, and verify `typeof document.modelContext?.registerTool` returns `"function"`.
- **No issue appears:** inspect the agent steps to confirm it called `report_site_issue`, click Refresh in the admin UI, and confirm the API is running.
- **Duplicate WebMCP tool error after hot reload:** refresh the page to clear the previous document registrations.
