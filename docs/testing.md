# Testing TinCan

## Prerequisites

- Bun 1.3.13 or a compatible newer release
- A modern browser for the UI flow
- A WebMCP-capable Chrome build for real tool discovery and execution

Install dependencies and start all three local services:

```bash
bun install --frozen-lockfile
bun run dev
```

The demo runs at `http://127.0.0.1:5173`, the issues UI at `http://127.0.0.1:5174`, and the API at `http://127.0.0.1:8787`.

## Manual UI flow

1. Open the demo and click **Reset demo**.
2. Click **Run 20 → 19 demo**.
3. Confirm that the request succeeds but the persisted seat count is 19.
4. Confirm the page still reports `HTTP 200 · 0 JS errors`.
5. Click **Report site issue**.
6. Follow the incident link or open the issues UI.
7. Verify the expected and observed values, then inspect the Logs, Metrics, and Traces tabs.

The report result shown to the agent/UI must contain only `status` and `incidentId`.

## Real WebMCP flow

Follow Chrome's current [WebMCP setup instructions](https://developer.chrome.com/docs/ai/webmcp). At the time of writing, testing can be enabled at `chrome://flags/#enable-webmcp-testing`. Restart Chrome after changing the flag.

With the demo open, use the Chrome DevTools WebMCP panel or run:

```js
const tools = await document.modelContext.getTools();
tools.map((tool) => tool.name);
```

Expected tool names:

```js
["report_site_issue", "change_seat_count", "get_subscription"]
```

Execute the business operation and verify its persisted result:

```js
const tool = (name) => tools.find((candidate) => candidate.name === name);

await document.modelContext.executeTool(
  tool("change_seat_count"),
  { seats: 20 },
);

await document.modelContext.executeTool(tool("get_subscription"), {});
```

The second call must return `seatCount: 19`. Report the mismatch:

```js
await document.modelContext.executeTool(tool("report_site_issue"), {
  category: "wrong_result",
  severity: "blocking",
  summary: "Subscription upgrade produced incorrect seat count",
  expected: "20 seats",
  observed: "19 seats",
  operation: "change_seat_count",
  confidence: 0.99,
});
```

If `document.modelContext` is undefined, confirm the browser supports the latest draft API, the testing flag is enabled, and the page is loaded from localhost or another secure origin. The current API baseline is the [WebMCP Draft Community Group Report](https://webmachinelearning.github.io/webmcp/).

## API smoke checks

```bash
curl -X POST http://127.0.0.1:8787/api/reset
curl -X POST http://127.0.0.1:8787/api/subscription \
  -H 'content-type: application/json' \
  -d '{"seats":20}'
curl http://127.0.0.1:8787/api/subscription
```

The final response should contain `"seatCount":19`. Use the UI or WebMCP flow to test issue ingestion because it produces the complete diagnostic payload.

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
- **Port already in use:** stop the process using 5173, 5174, or 8787 before restarting.
- **No issue appears:** click Refresh in the issues UI and confirm the API is running.
- **Duplicate WebMCP tool error after hot reload:** refresh the page to clear the previous document registrations.
