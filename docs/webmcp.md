# WebMCP Tools

TinCan follows the [WebMCP Draft Community Group Report](https://webmachinelearning.github.io/webmcp/) published August 26, 2026. The current implementation uses `document.modelContext`, not older proposal examples based on `navigator.modelContext` or `provideContext()`.

## Registration

The public registration is intentionally visible in `packages/webmcp/src/index.ts`:

```ts
await document.modelContext.registerTool({
  name: "report_site_issue",
  description: "Report a problem observed in the current website...",
  inputSchema: REPORT_SITE_ISSUE_SCHEMA,
  execute: async (input) => {
    const result = await recorder.reportIssue(input);
    return {
      status: result.status,
      incidentId: result.incidentId,
    };
  },
});
```

Registration uses an `AbortSignal` so tools can be removed when the Vue page is unmounted. The website has no UI fallback that invokes business or reporting tools. If WebMCP is unavailable, normal website operation continues, but the agent flow is unavailable.

## Browser agent

The `/agent` route embeds the target site in a same-origin iframe. It receives only a user goal, discovers descendant-frame tools with `document.modelContext.getTools()`, and invokes selected tools with `executeTool()`. Tool selection uses only names, titles, descriptions, schemas, and annotations; the agent never clicks or reads the website UI and does not import its application functions.

The reference planner is deterministic and requires no OpenAI API key. A model-backed planner could replace it later without changing the WebMCP tools.

Chrome's current testing implementation expects the second `executeTool()` argument to be a valid JSON string. The browser agent therefore serializes each input object before execution. This differs from the newest draft IDL's object argument and should be rechecked as Chrome converges on the draft.

The agent excludes `report_site_issue` from its initial business-tool candidates. It calls TinCan only after a business tool returns a failure status or a read-only verification tool exposes a state mismatch. This keeps failure detection and the reporting decision in the agent rather than the website.

## `report_site_issue`

Required fields:

- `category`: `wrong_result`, `unexpected_behavior`, `action_failed`, `network_failure`, `performance`, `ui_state_mismatch`, or `other`
- `severity`: `info`, `degraded`, or `blocking`
- `summary`: at most 300 characters

Optional fields are `description`, `expected`, `observed`, and `operation`. The schema enforces the limits defined in `spec.md`.

Successful agent-visible result:

```json
{"status":"reported","incidentId":"INC-1042"}
```

Raw logs, metrics, spans, request data, trace identifiers, and application state are never included in this result.

The imperative WebMCP callback returns this object directly. The current draft accepts any callback result and stringifies it for `executeTool()`; an MCP transport-style `{ content: [...] }` envelope is not used.

## Demo business tools

### `add_licenses`

Input:

```json
{"count":1}
```

The tool adds `count` new user licenses. It calls the same endpoint as the website's **Add license** button. In the canonical demo, starting from 10 and adding 1 returns a successful result with `expectedLicenseCount: 11`, even though the server deliberately persists 12.

### `remove_licenses`

Input:

```json
{"count":1}
```

The tool calls the same endpoint as **Remove license**. The demo deliberately returns HTTP `504` and leaves the persisted license count unchanged.

### `get_subscription`

Input is an empty object. The result contains the current plan, persisted license count, and subscription status. Agents should use this read-back tool to verify the mutation before reporting a mismatch.

### `export_usage_report`

Input is an empty object. The demo endpoint returns HTTP `504`; the agent recognizes the failed status and reports it through TinCan without requiring a website-specific error button.

## Security behavior

Agent input is untrusted semantic data. It cannot change the ingestion endpoint, capture configuration, request headers, privacy policy, or diagnostic scope. WebMCP registration failure does not prevent normal page operation.

Because WebMCP remains a Community Group draft rather than a W3C Standard, re-check the official specification and Chrome documentation before a public release.
