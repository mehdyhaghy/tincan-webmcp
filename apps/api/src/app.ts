import { MAX_INCIDENT_BYTES } from "@tincan-webmcp/core";
import { MemoryIssueStore } from "@tincan-webmcp/server";
import { readFile } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface Subscription {
  plan: "Business";
  licenseCount: number;
  status: "active";
}

interface DemoSession {
  id: string;
  subscription: Subscription;
  lastSeen: number;
}

export interface TinCanApiOptions {
  now?: () => number;
  rateLimitMax?: number;
  staticRoot?: string;
  sessionTtlMs?: number;
  maxSessions?: number;
}

/**
 * The subscription is partitioned by an anonymous session so concurrent visitors, and a
 * single visitor whose page is reloaded between agent steps, keep their own license
 * count. The cookie is the primary carrier; the header lets a client that cannot keep
 * cookies resume with an identifier it stored itself. Reported issues are deliberately
 * NOT partitioned: the admin investigation UI is the site owner's view and must show
 * every incident, whichever session reported it.
 */
export const SESSION_COOKIE = "tincan_session";
export const SESSION_HEADER = "x-tincan-session";
export const DEFAULT_SESSION_TTL_MS = 60 * 60 * 1_000;
const SESSION_ID_PATTERN = /^[a-f0-9]{32}$/;
const ASSET_CACHE_CONTROL = "public, max-age=31536000, immutable";

const initialSubscription = (): Subscription => ({ plan: "Business", licenseCount: 10, status: "active" });

const json = (value: unknown, status = 200): Response => Response.json(value, {
  status,
  headers: {
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  },
});

const defaultStaticRoot = fileURLToPath(new URL("../../demo-saas/dist/", import.meta.url));

const contentTypes: Record<string, string> = {
  ".avif": "image/avif",
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
  ".webmanifest": "application/manifest+json",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".xml": "application/xml; charset=utf-8",
};

const staticResponse = async (path: string, cacheControl?: string): Promise<Response | undefined> => {
  try {
    const contents = await readFile(path);
    const headers = new Headers({
      "content-type": contentTypes[extname(path).toLowerCase()] ?? "application/octet-stream",
      "x-content-type-options": "nosniff",
    });
    if (cacheControl) headers.set("cache-control", cacheControl);
    return new Response(contents, { headers });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "EISDIR") return undefined;
    throw error;
  }
};

const parseJsonObject = async (request: Request): Promise<Record<string, unknown> | undefined> => {
  try {
    const value = await request.json() as unknown;
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
};

const cookieValue = (header: string | null, name: string): string | undefined => {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return undefined;
};

const newSessionId = (): string => crypto.randomUUID().replace(/-/g, "");

export class TinCanApi {
  readonly #sessions = new Map<string, DemoSession>();
  // Shared across all sessions so the admin/investigation UI sees every reported incident.
  readonly #store = new MemoryIssueStore();
  readonly #recentReports = new Map<string, number[]>();
  readonly #now: () => number;
  readonly #rateLimitMax: number;
  readonly #staticRoot: string;
  readonly #sessionTtlMs: number;
  readonly #maxSessions: number;

  constructor(options: TinCanApiOptions = {}) {
    this.#now = options.now ?? Date.now;
    this.#rateLimitMax = options.rateLimitMax ?? 10;
    this.#staticRoot = resolve(options.staticRoot ?? defaultStaticRoot);
    this.#sessionTtlMs = options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
    this.#maxSessions = options.maxSessions ?? 1_000;
  }

  get sessionCount(): number {
    return this.#sessions.size;
  }

  async fetch(request: Request, address = "unknown"): Promise<Response> {
    const url = new URL(request.url);
    const isApiRoute = url.pathname.startsWith("/api/") || url.pathname.startsWith("/_tincan/");
    if (!isApiRoute) return this.#serveApp(url.pathname);

    // Health checks must not mint sessions.
    if (url.pathname === "/api/subscription" && request.method === "HEAD") {
      return new Response(null, { status: 200, headers: { "cache-control": "no-store" } });
    }

    const session = this.#resolveSession(request);
    const response = await this.#handleApi(request, url, address, session);
    response.headers.set(SESSION_HEADER, session.id);
    response.headers.append("set-cookie", this.#sessionCookie(request, session.id));
    return response;
  }

  async #handleApi(request: Request, url: URL, address: string, session: DemoSession): Promise<Response> {
    if (url.pathname === "/api/subscription" && request.method === "GET") {
      return json(session.subscription);
    }

    if (url.pathname === "/api/licenses" && request.method === "POST") {
      const body = await parseJsonObject(request);
      if (!body) return json({ error: "Request body must be a valid JSON object." }, 400);
      if (!Number.isInteger(body.count) || Number(body.count) < 1 || Number(body.count) > 100) {
        return json({ error: "License count must be an integer from 1 to 100." }, 400);
      }
      const requestedLicenseCount = Number(body.count);
      const previousLicenseCount = session.subscription.licenseCount;
      const expectedLicenseCount = previousLicenseCount + requestedLicenseCount;
      // Intentional demo defect: the successful mutation persists one more license than requested.
      // The agent must detect this semantic mismatch during read-back and report it through TinCan.
      session.subscription = {
        ...session.subscription,
        licenseCount: expectedLicenseCount + 1,
      };
      return json({
        status: "added",
        requestedLicenseCount,
        previousLicenseCount,
        expectedLicenseCount,
      });
    }

    if (url.pathname === "/api/licenses/remove" && request.method === "POST") {
      const body = await parseJsonObject(request);
      if (!body) return json({ error: "Request body must be a valid JSON object." }, 400);
      if (!Number.isInteger(body.count) || Number(body.count) < 1 || Number(body.count) > 100) {
        return json({ error: "License count must be an integer from 1 to 100." }, 400);
      }
      // Intentional demo defect: removal always times out and must leave subscription state unchanged.
      // This gives the agent a network failure to report alongside the semantic add-license failure.
      return json({
        error: "The billing service did not respond before the gateway timeout.",
        requestedLicenseCount: Number(body.count),
      }, 504);
    }

    if (url.pathname === "/api/usage-export" && request.method === "POST") {
      return json({ error: "The export service did not respond before the gateway timeout." }, 504);
    }

    if (url.pathname === "/api/reset" && request.method === "POST") {
      // Reset only the caller's own subscription. The shared issue store is left intact
      // so one visitor's reset cannot erase incidents another visitor reported.
      session.subscription = initialSubscription();
      return json({ status: "reset" });
    }

    if (url.pathname === "/api/issues" && request.method === "GET") {
      return json({ issues: this.#store.list() });
    }

    if (url.pathname === "/_tincan/issues" && request.method === "POST") {
      if (request.headers.get("content-type")?.split(";", 1)[0] !== "application/json") {
        return json({ error: "Content-Type must be application/json." }, 415);
      }
      if (this.#rateLimited(address)) return json({ error: "Rate limit exceeded." }, 429);
      const text = await request.text();
      if (new TextEncoder().encode(text).byteLength > MAX_INCIDENT_BYTES) {
        return json({ error: `Incident exceeds ${MAX_INCIDENT_BYTES} bytes.` }, 413);
      }
      try {
        const incident = this.#store.create(JSON.parse(text));
        return json({ status: "reported", incidentId: incident.id }, 201);
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : "Invalid incident." }, 400);
      }
    }

    return json({ error: "Not found." }, 404);
  }

  #resolveSession(request: Request): DemoSession {
    const now = this.#now();
    const requested = request.headers.get(SESSION_HEADER) ?? cookieValue(request.headers.get("cookie"), SESSION_COOKIE);
    const id = requested && SESSION_ID_PATTERN.test(requested) ? requested : newSessionId();
    let session = this.#sessions.get(id);
    if (session && now - session.lastSeen > this.#sessionTtlMs) {
      this.#sessions.delete(id);
      session = undefined;
    }
    if (!session) {
      this.#evictSessions(now);
      session = { id, subscription: initialSubscription(), lastSeen: now };
    }
    session.lastSeen = now;
    // Re-insert so Map iteration order doubles as least-recently-used order.
    this.#sessions.delete(id);
    this.#sessions.set(id, session);
    return session;
  }

  #evictSessions(now: number): void {
    for (const [id, session] of this.#sessions) {
      if (now - session.lastSeen > this.#sessionTtlMs) this.#sessions.delete(id);
    }
    while (this.#sessions.size >= this.#maxSessions) {
      const oldest = this.#sessions.keys().next().value;
      if (oldest === undefined) break;
      this.#sessions.delete(oldest);
    }
  }

  #sessionCookie(request: Request, id: string): string {
    const secure = request.headers.get("x-forwarded-proto") === "https" || new URL(request.url).protocol === "https:";
    const maxAge = Math.floor(this.#sessionTtlMs / 1_000);
    return `${SESSION_COOKIE}=${id}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
  }

  #rateLimited(address: string): boolean {
    const cutoff = this.#now() - 60_000;
    for (const [candidate, timestamps] of this.#recentReports) {
      const recent = timestamps.filter((timestamp) => timestamp > cutoff);
      if (recent.length === 0) this.#recentReports.delete(candidate);
      else this.#recentReports.set(candidate, recent);
    }
    const attempts = this.#recentReports.get(address) ?? [];
    attempts.push(this.#now());
    this.#recentReports.set(address, attempts);
    return attempts.length > this.#rateLimitMax;
  }

  async #serveApp(pathname: string): Promise<Response> {
    let decodedPath: string;
    try {
      decodedPath = decodeURIComponent(pathname);
    } catch {
      return json({ error: "Invalid path." }, 400);
    }
    const requested = resolve(this.#staticRoot, `.${decodedPath}`);
    const childPath = relative(this.#staticRoot, requested);
    if (childPath.startsWith("..") || isAbsolute(childPath)) return json({ error: "Not found." }, 404);

    // Vite writes content-hashed filenames under /assets, so they can be cached forever.
    const file = await staticResponse(requested, decodedPath.startsWith("/assets/") ? ASSET_CACHE_CONTROL : undefined);
    if (file) return file;
    if (extname(decodedPath)) return json({ error: "Not found." }, 404);

    return await staticResponse(join(this.#staticRoot, "index.html"), "no-store") ??
      json({ error: "Not found." }, 404);
  }
}
