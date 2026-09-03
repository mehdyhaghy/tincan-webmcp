# Deployment

TinCan deploys as one Bun process. The production build generates the Vue assets, and `apps/api` serves those files, the SPA fallback, the demo API, and `/_tincan/issues` from one origin.

## Direct Bun deployment

```bash
bun install --frozen-lockfile
bun run build
HOST=0.0.0.0 PORT=8080 bun run start
```

The API binds to `127.0.0.1` unless `HOST` is set, so a platform that connects to the process over the network must set `HOST=0.0.0.0`. Configure the platform's health check as `/api/subscription`. The public URL must use HTTPS because WebMCP is a secure-context browser API.

Any host that can run Bun can use these build and start commands. No separate static host, reverse proxy, or container configuration is required.

### Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Interface the API listens on. |
| `PORT` | `8787` | Port the API listens on. |
| `TRUST_PROXY` | unset | Set to `1` when a reverse proxy overwrites `X-Forwarded-For` with the client address, so the `/_tincan/issues` rate limit applies per visitor instead of per proxy. |

## Ubuntu host with nginx and Let's Encrypt

The `deploy/` directory provisions a fresh Ubuntu LTS host (tested on 24.04) that exposes the site on port 443 only:

- `setup.sh` installs nginx, certbot, ufw, the pinned Bun release, and the current Node.js LTS (tsc, vue-tsc, and vite need Node to build; Bun runs the API), clones the repository into `/opt/tincan`, builds it as the unprivileged `tincan` user, issues a Let's Encrypt certificate, and starts the services.
- `tincan-api.service` runs the API on `127.0.0.1:8787` with `TRUST_PROXY=1`.
- `nginx-site.conf` terminates TLS and proxies every request to the API. It has no port 80 server block.
- `certbot-pre.sh` and `certbot-post.sh` open port 80 in ufw only for the duration of a renewal, then close it and reload nginx.
- `update.sh` pulls the latest commit, rebuilds, and restarts the API.

Point the hostname's A record at the host first, then run the following as root:

```bash
DOMAIN=tincandemo.example.com bash deploy/setup.sh
```

The firewall allows inbound SSH and 443 only. The API, and any future database or cache, must stay bound to localhost or the private network.

## Demo-only security boundary

Demo state lives in process memory, partitioned by an anonymous `tincan_session` cookie (one hour idle expiry, header fallback `x-tincan-session`) so concurrent visitors, and a visitor whose page is reloaded between agent steps, keep their own subscription and issue list. It still resets when the process restarts. The session is a convenience, not an authentication boundary: the reference API intentionally has no accounts or tenant isolation. Deploy it only with synthetic demo data. Add authentication, authorization, durable storage, retention controls, and proxy-aware rate limiting before connecting TinCan to a real service.
