# Repository Guidelines

## Project Structure & Module Organization

This Bun workspace follows the requirements in `spec.md`; the original PDF is retained as `tincan_webmcp_spec.pdf`. Use this layout:

- `packages/browser`: framework-independent collectors, sanitizer, ring buffer, and transport.
- `packages/webmcp`: the public `report_site_issue` adapter and visible browser tool registration.
- `packages/server`: validation, re-sanitization, rate limiting, and persistence hooks.
- `packages/otel`: OTLP-aligned log, metric, trace, resource, and scope types.
- `apps/demo-saas`: the single Vue/Vite application, including the user site, browser agent, and admin issue routes.
- `apps/api`: the Bun reference API and in-memory demo state.
- Place unit tests beside source as `*.test.ts`; keep browser journeys in `tests/e2e/*.spec.ts`. Store static app assets under each app's `public/` directory.

## Build, Test, and Development Commands

- `bun install`: install workspace dependencies.
- `bun run dev`: start the demo, issues UI, and reference server locally.
- `bun run build`: type-check and produce all package and app builds.
- `bun run test`: run Vitest unit and integration suites.
- `bun run test:e2e`: reserved for Playwright; the E2E suite is not implemented yet.
- `bun run check:secrets`: scan repository text for high-confidence credential formats.

## Coding Style & Naming Conventions

Use TypeScript strict mode, two-space indentation, semicolons, and explicit types at public boundaries. Use `camelCase` for values/functions and `PascalCase` for types and Vue components. Prefer lowercase kebab-case filenames; retain uppercase only for repository standards such as `README.md`, `AGENTS.md`, and `LICENSE`. Preserve the specified snake_case tool name, `report_site_issue`. Keep browser-core code framework-independent and collectors isolated behind small interfaces.

## Testing Guidelines

Use Vitest for units and Playwright for browser/E2E coverage. Privacy tests are release-blocking: verify redaction, body omission, payload limits, ring-buffer eviction, server-side re-sanitization, and agent-visible output containing only status plus incident ID. Add regression tests for instrumentation transparency and collector failure isolation.

## Commit & Pull Request Guidelines

There is no Git history to infer conventions from. Use Conventional Commits, for example `feat(browser): add bounded network collector` or `test(server): reject oversized incidents`. Keep commits focused. Pull requests should explain the user-visible effect, list verification commands, link an issue when applicable, and include screenshots or a short recording for UI changes. Call out privacy-boundary or schema changes explicitly.

## Security & Privacy

Never capture bodies, credentials, storage contents, form values, DOM text, or screenshots. Treat agent prose as untrusted data, sanitize in both browser and server, and never return host diagnostics to the agent.

Only add dependencies with permissive licenses approved by `docs/license-policy.md`. TinCan itself uses Apache-2.0.
Run `bun run check:secrets` before committing or publishing. Keep credentials in ignored local environment files and provide placeholders only in `.env.example`.
