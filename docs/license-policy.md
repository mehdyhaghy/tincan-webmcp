# Dependency License Policy

TinCan WebMCP is licensed under Apache-2.0. Direct runtime and development dependencies must use a permissive license such as Apache-2.0, MIT, BSD-2-Clause, BSD-3-Clause, or ISC.

Before adding or upgrading a dependency:

1. Confirm the declared package license in the package registry and upstream repository.
2. Review transitive dependencies with `bun pm ls --all` and a license-audit tool before release.
3. Do not add copyleft, source-available, non-commercial, or license-ambiguous components without explicit maintainer approval.
4. Record required attribution in a notice file before distribution.

The direct dependency set was checked on August 28, 2026. Vue, Vite, Vitest, the Vue Vite plugin, Vue TypeScript tooling, and Bun type definitions declare MIT. TypeScript, Playwright, and the official OpenTelemetry API, SDK, resources, and browser instrumentation packages declare Apache-2.0.
