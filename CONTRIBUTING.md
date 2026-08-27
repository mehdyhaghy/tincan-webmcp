# Contributing to TinCan WebMCP

Thank you for helping build a safer diagnostic channel for the agentic web.

## Development setup

Install Bun, clone the repository, and run:

```bash
bun install --frozen-lockfile
bun run dev
```

See [docs/testing.md](docs/testing.md) for the manual demo and WebMCP verification flow.

## Before opening a pull request

Run all currently implemented checks:

```bash
bun run check:secrets
bun run typecheck
bun run test
bun run build
```

Playwright is installed, but the E2E suite is not implemented yet. Add browser tests under `tests/e2e/*.spec.ts` when changing an end-to-end flow.

## Code conventions

- Use strict TypeScript and two-space indentation.
- Use `camelCase` for values/functions and `PascalCase` for types and Vue components.
- Prefer lowercase kebab-case filenames except conventional repository files.
- Keep `packages/browser` independent of Vue and other UI frameworks.
- Use lowercase, dot-namespaced TinCan signal names such as `tincan.site.issue.reported`.
- Reuse stable OpenTelemetry semantic attributes instead of inventing equivalents.

## Privacy requirements

Privacy regressions block release. Never add automatic capture of bodies, credentials, browser storage, form values, DOM contents, or screenshots. Any new collector must have bounded memory, explicit sanitization, failure isolation, server-side validation, and tests proving it does not change application behavior.

## Dependencies

Only permissively licensed dependencies are accepted. Follow [docs/license-policy.md](docs/license-policy.md), commit `bun.lock`, and do not commit `node_modules` or local environment files.

## Commits and pull requests

Use Conventional Commits, for example:

```text
feat(browser): collect bounded resource failures
test(server): reject oversized incidents
docs(webmcp): update draft API baseline
```

Keep commits focused. Pull requests should describe the user-visible effect, list verification performed, link relevant issues, include screenshots for UI changes, and call out schema, capture-scope, or privacy-boundary changes explicitly.
