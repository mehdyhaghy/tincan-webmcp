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
    return JSON.stringify({
      status: result.status,
      incidentId: result.incidentId,
    });
  },
});
```

Registration uses an `AbortSignal` so tools can be removed when the Vue page is unmounted. If WebMCP is unavailable, the demo continues to work and exposes the same flow through visible controls.

## `report_site_issue`

Required fields:

- `category`: `wrong_result`, `unexpected_behavior`, `action_failed`, `network_failure`, `performance`, `ui_state_mismatch`, or `other`
- `severity`: `info`, `degraded`, or `blocking`
- `summary`: at most 300 characters

Optional fields are `description`, `expected`, `observed`, `operation`, and `confidence`. The schema enforces the limits defined in `spec.md`.

Successful agent-visible result:

```json
{"status":"reported","incidentId":"INC-1042"}
```

Raw logs, metrics, spans, request data, trace identifiers, and application state are never included in this result.

## Demo business tools

### `change_seat_count`

Input:

```json
{"seats":20}
```

The tool calls the subscription mutation. In the canonical demo it returns a successful update response even though the server deliberately persists 19.

### `get_subscription`

Input is an empty object. The result contains the current plan, persisted seat count, and subscription status. Agents should use this read-back tool to verify the mutation before reporting a mismatch.

## Security behavior

Agent input is untrusted semantic data. It cannot change the ingestion endpoint, capture configuration, request headers, privacy policy, or diagnostic scope. WebMCP registration failure does not prevent normal page operation.

Because WebMCP remains a Community Group draft rather than a W3C Standard, re-check the official specification and Chrome documentation before a public release.
