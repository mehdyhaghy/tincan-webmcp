# Repository Guidelines

## Project Structure & Module Organization

This Bun workspace follows `spec.md`:

- `packages/core`: shared incident contracts and sanitization with no browser runtime dependency.
- `packages/browser`: framework-independent recording, incident assembly, and transport.
- `packages/otel-instrumentation`: official OpenTelemetry browser instrumentation, Resource Timing fallback, and bounded span processor.
- `packages/webmcp`: `report_site_issue` registration and WebMCP types.
- `packages/server`: validation, classification, and persistence hooks.
- `packages/otel`: OTLP-aligned signal types.
- `apps/demo-saas`: Vue product, developer harness, and admin routes.
- `apps/api`: the Bun reference API and in-memory demo state.
- Keep unit and integration tests beside source as `*.test.ts`.

## Build, Test, and Development Commands

- `bun install`: install workspace dependencies.
- `bun run dev`: start Vite and the Bun API locally.
- `bun run build`: type-check and produce all package and app builds.
- `bun run test`: run Vitest unit and integration suites.
- `bun run check:secrets`: scan repository text for high-confidence credential formats.

## Coding Style & Naming Conventions

Use TypeScript strict mode, two-space indentation, semicolons, and explicit types at public boundaries. Use `camelCase` for values/functions and `PascalCase` for types and Vue components. Prefer lowercase kebab-case filenames; retain uppercase only for repository standards such as `README.md`, `AGENTS.md`, and `LICENSE`. Preserve the specified snake_case tool name, `report_site_issue`. Keep browser-core code framework-independent and collectors isolated behind small interfaces.

## Testing Guidelines

Use Vitest for unit and integration coverage. Privacy tests block release: verify redaction, body omission, payload limits, buffer eviction, server re-sanitization, instrumentation transparency, and the exact agent-visible result. Follow `docs/testing.md` for manual browser and WebMCP checks.

## Commit & Pull Request Guidelines

Use Conventional Commits, for example `fix(api): reject malformed JSON`. Keep commits focused. Pull requests should explain user-visible behavior, list verification, link issues, include screenshots for UI work, and call out schema or privacy changes.

## Security & Privacy

Never capture bodies, credentials, storage contents, form values, DOM text, or screenshots. Treat agent prose as untrusted data, sanitize in both browser and server, and never return host diagnostics to the agent.

Only add dependencies with permissive licenses approved by `docs/license-policy.md`. TinCan itself uses Apache-2.0.
Run `bun run check:secrets` before committing or publishing. Keep credentials in ignored local environment files; this project currently requires no secrets or environment template.
