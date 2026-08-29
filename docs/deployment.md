# Deployment

TinCan deploys as one Bun process. The production build generates the Vue assets, and `apps/api` serves those files, the SPA fallback, the demo API, and `/_tincan/issues` from one origin.

## Direct Bun deployment

```bash
bun install --frozen-lockfile
bun run build
PORT=8080 bun run start
```

Configure the platform's health check as `/api/subscription`. The public URL must use HTTPS because WebMCP is a secure-context browser API.

Any host that can run Bun can use these build and start commands. No separate static host, reverse proxy, or container configuration is required.

## Demo-only security boundary

The issue store is process memory and resets when the process restarts. The reference API intentionally has no accounts or tenant isolation. Deploy it only with synthetic demo data. Add authentication, authorization, durable storage, retention controls, and proxy-aware rate limiting before connecting TinCan to a real service.
