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

export interface TinCanApiOptions {
  now?: () => number;
  rateLimitMax?: number;
  staticRoot?: string;
}

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

const staticResponse = async (path: string, noStore = false): Promise<Response | undefined> => {
  try {
    const contents = await readFile(path);
    const headers = new Headers({
      "content-type": contentTypes[extname(path).toLowerCase()] ?? "application/octet-stream",
      "x-content-type-options": "nosniff",
    });
    if (noStore) headers.set("cache-control", "no-store");
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

export class TinCanApi {
  readonly #store = new MemoryIssueStore();
  readonly #recentReports = new Map<string, number[]>();
  readonly #now: () => number;
  readonly #rateLimitMax: number;
  readonly #staticRoot: string;
  #subscription: Subscription = { plan: "Business", licenseCount: 10, status: "active" };

  constructor(options: TinCanApiOptions = {}) {
    this.#now = options.now ?? Date.now;
    this.#rateLimitMax = options.rateLimitMax ?? 10;
    this.#staticRoot = resolve(options.staticRoot ?? defaultStaticRoot);
  }

  async fetch(request: Request, address = "unknown"): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/subscription" && (request.method === "GET" || request.method === "HEAD")) {
      const response = json(this.#subscription);
      return request.method === "HEAD"
        ? new Response(null, { status: response.status, headers: response.headers })
        : response;
    }

    if (url.pathname === "/api/licenses" && request.method === "POST") {
      const body = await parseJsonObject(request);
      if (!body) return json({ error: "Request body must be a valid JSON object." }, 400);
      if (!Number.isInteger(body.count) || Number(body.count) < 1 || Number(body.count) > 100) {
        return json({ error: "License count must be an integer from 1 to 100." }, 400);
      }
      const requestedLicenseCount = Number(body.count);
      const previousLicenseCount = this.#subscription.licenseCount;
      const expectedLicenseCount = previousLicenseCount + requestedLicenseCount;
      this.#subscription = {
        ...this.#subscription,
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
      return json({
        error: "The billing service did not respond before the gateway timeout.",
        requestedLicenseCount: Number(body.count),
      }, 504);
    }

    if (url.pathname === "/api/usage-export" && request.method === "POST") {
      return json({ error: "The export service did not respond before the gateway timeout." }, 504);
    }

    if (url.pathname === "/api/reset" && request.method === "POST") {
      this.#subscription = { plan: "Business", licenseCount: 10, status: "active" };
      this.#store.clear();
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

    if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/_tincan/")) {
      return json({ error: "Not found." }, 404);
    }

    return this.#serveApp(url.pathname);
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

    const file = await staticResponse(requested);
    if (file) return file;
    if (extname(decodedPath)) return json({ error: "Not found." }, 404);

    return await staticResponse(join(this.#staticRoot, "index.html"), true) ??
      json({ error: "Not found." }, 404);
  }
}
