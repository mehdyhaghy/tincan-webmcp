# Security and Privacy

## Trust boundary

The agent reports semantic meaning. The host site decides what technical evidence is collected and where it is sent. Diagnostics travel only to the site's ingestion endpoint; they are never returned through the WebMCP tool result.

Treat the current applications as a local reference implementation. The API has no authentication or tenant isolation and must not be exposed publicly without production controls.

## Collected data

The recorder currently captures bounded metadata for navigation, `fetch` requests, console warnings/errors, JavaScript errors, unhandled rejections, request-duration metrics, error/failure counts, and browser HTTP spans.

Network records contain method, sanitized path, response status, and duration. They do not contain request or response bodies.

## Never collected automatically

- Cookies or authorization headers
- Request or response bodies
- Form values, keystrokes, or clipboard contents
- `localStorage`, `sessionStorage`, or IndexedDB contents
- DOM text, HTML, or screenshots
- Access tokens, refresh tokens, API keys, or private keys

## Sanitization

The browser sanitizer:

- removes URL origins, queries, fragments, and credentials;
- masks UUIDs and long numeric path segments;
- redacts sensitive object keys recursively;
- detects bearer tokens, JWT-like strings, payment-card-like values, and private-key markers;
- bounds strings, arrays, object entries, and nesting depth.

The server sanitizes the complete incident again after schema validation. Browser sanitization is never treated as the only protection.

## Resource limits

| Control | Current value |
| --- | --- |
| Recorder window | 60 seconds |
| Maximum records | 500 |
| Recorder byte budget | 1 MB |
| Maximum incident request | 256 KB |
| Ingestion rate limit | 10 reports per address per minute |
| Persistence | Process memory only |

The recorder evicts oldest entries by age, count, and bytes. A single record larger than the byte budget is discarded.

## Agent-visible response

A successful report returns only:

```json
{"status":"reported","incidentId":"INC-1042"}
```

Adding diagnostic fields, trace IDs, stack traces, or application data to this response violates the privacy boundary.

## Repository hygiene

Local environment files, credential formats, signing material, databases, logs, and build output are excluded by `.gitignore`. Run the non-printing high-confidence scanner before every commit or release:

```bash
bun run check:secrets
```

The scanner is a defense-in-depth check, not proof that a repository contains no secrets. Review staged changes and use a dedicated secret-scanning service in CI for production repositories.

## Production requirements

Before deployment, add authentication and authorization, tenant isolation, durable encrypted storage or forwarding, trusted-origin/CORS policy, proxy-aware rate limiting, retention/deletion rules, audit logging, a Content Security Policy, and a documented incident-response process. Re-run privacy tests whenever collectors or application-provided attributes change.
