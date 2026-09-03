import type { IncidentPayload } from "@tincan-webmcp/core";
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SESSION_COOKIE, SESSION_HEADER, TinCanApi } from "./app";

const temporaryRoots: string[] = [];

const incident = (): IncidentPayload => ({
  schemaVersion: "1.0",
  agentObservation: {
    timestamp: "2026-08-29T00:00:00.000Z",
    category: "wrong_result",
    severity: "blocking",
    summary: "Wrong result",
  },
  resource: { attributes: { "service.name": "test" } },
  instrumentationScope: { name: "@tincan-webmcp/browser", version: "0.1.0" },
  attributes: { "url.path": "/", "browser.visibility_state": "visible" },
  diagnostics: { resourceLogs: [], resourceMetrics: [], resourceSpans: [] },
});

const jsonInit = (payload: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(payload),
});

type Client = (path: string, init?: RequestInit) => Promise<Response>;

/** Minimal cookie jar: replays the session cookie the way a browser would. */
const client = (api: TinCanApi, address?: string): Client => {
  let cookie = "";
  return async (path, init = {}) => {
    const headers = new Headers(init.headers);
    if (cookie && !headers.has("cookie")) headers.set("cookie", cookie);
    const response = await api.fetch(new Request(`http://test${path}`, { ...init, headers }), address);
    const issued = response.headers.get("set-cookie");
    if (issued) cookie = issued.split(";", 1)[0]!;
    return response;
  };
};

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("TinCan API", () => {
  it("preserves the intentional add-license mismatch used by the demo", async () => {
    const call = client(new TinCanApi());
    const response = await call("/api/licenses", jsonInit({ count: 1 }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "added",
      requestedLicenseCount: 1,
      previousLicenseCount: 10,
      expectedLicenseCount: 11,
    });
    expect(await (await call("/api/subscription")).json()).toMatchObject({ licenseCount: 12 });
  });

  it("preserves the intentional remove-license timeout without changing state", async () => {
    const call = client(new TinCanApi());
    const response = await call("/api/licenses/remove", jsonInit({ count: 1 }));
    expect(response.status).toBe(504);
    expect(await response.json()).toMatchObject({ requestedLicenseCount: 1 });
    expect(await (await call("/api/subscription")).json()).toMatchObject({ licenseCount: 10 });
  });

  it("supports HEAD health checks without minting a session", async () => {
    const api = new TinCanApi();
    const response = await api.fetch(new Request("http://test/api/subscription", { method: "HEAD" }));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(api.sessionCount).toBe(0);
  });

  it("returns 400 for malformed business JSON", async () => {
    const call = client(new TinCanApi());
    const response = await call("/api/licenses", { ...jsonInit({}), body: "{" });
    expect(response.status).toBe(400);
  });

  it("enforces incident content type and body size", async () => {
    const call = client(new TinCanApi());
    const unsupported = await call("/_tincan/issues", { method: "POST", body: "{}" });
    expect(unsupported.status).toBe(415);

    const oversized = await call("/_tincan/issues", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: `"${"x".repeat(256_001)}"`,
    });
    expect(oversized.status).toBe(413);
  });

  it("rate limits reports and expires stale address state", async () => {
    let now = 1_000_000;
    const call = client(new TinCanApi({ now: () => now, rateLimitMax: 1 }), "127.0.0.1");
    expect((await call("/_tincan/issues", jsonInit(incident()))).status).toBe(201);
    expect((await call("/_tincan/issues", jsonInit(incident()))).status).toBe(429);
    now += 60_001;
    expect((await call("/_tincan/issues", jsonInit(incident()))).status).toBe(201);
  });

  it("keeps incident IDs monotonic across demo resets", async () => {
    const call = client(new TinCanApi());
    expect(await (await call("/_tincan/issues", jsonInit(incident()))).json()).toMatchObject({ incidentId: "INC-1042" });
    await call("/api/reset", { method: "POST" });
    expect(await (await call("/_tincan/issues", jsonInit(incident()))).json()).toMatchObject({ incidentId: "INC-1043" });
  });

  it("returns submitted incidents through the admin API", async () => {
    const call = client(new TinCanApi());
    expect((await call("/_tincan/issues", jsonInit(incident()))).status).toBe(201);
    const response = await call("/api/issues");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      issues: [{ id: "INC-1042", agentObservation: { summary: "Wrong result" } }],
    });
  });

  it("issues an anonymous session cookie and isolates demo state per session", async () => {
    const api = new TinCanApi();
    const alice = client(api);
    const bob = client(api);

    const first = await alice("/api/subscription");
    const cookie = first.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(new RegExp(`^${SESSION_COOKIE}=[a-f0-9]{32}; Path=/; Max-Age=3600; HttpOnly; SameSite=Lax$`));
    expect(first.headers.get(SESSION_HEADER)).toBe(cookie.slice(SESSION_COOKIE.length + 1, SESSION_COOKIE.length + 33));

    await alice("/api/licenses", jsonInit({ count: 1 }));
    await alice("/_tincan/issues", jsonInit(incident()));
    expect(await (await alice("/api/subscription")).json()).toMatchObject({ licenseCount: 12 });
    expect(await (await bob("/api/subscription")).json()).toMatchObject({ licenseCount: 10 });
    expect(await (await bob("/api/issues")).json()).toEqual({ issues: [] });

    await bob("/api/reset", { method: "POST" });
    expect(await (await alice("/api/subscription")).json()).toMatchObject({ licenseCount: 12 });
    expect(api.sessionCount).toBe(2);
  });

  it("marks the cookie Secure when the request arrived over HTTPS", async () => {
    const api = new TinCanApi();
    const proxied = await api.fetch(new Request("http://test/api/subscription", { headers: { "x-forwarded-proto": "https" } }));
    expect(proxied.headers.get("set-cookie")).toContain("; Secure");
    const direct = await api.fetch(new Request("https://test/api/subscription"));
    expect(direct.headers.get("set-cookie")).toContain("; Secure");
  });

  it("resumes a session from the header fallback and revives unknown well-formed ids", async () => {
    const api = new TinCanApi();
    const id = "0123456789abcdef0123456789abcdef";
    const headers = { [SESSION_HEADER]: id };
    await api.fetch(new Request("http://test/api/licenses", { ...jsonInit({ count: 1 }), headers: { ...headers, "content-type": "application/json" } }));
    const response = await api.fetch(new Request("http://test/api/subscription", { headers }));
    expect(await response.json()).toMatchObject({ licenseCount: 12 });
    expect(response.headers.get(SESSION_HEADER)).toBe(id);
    expect(response.headers.get("set-cookie")).toContain(`${SESSION_COOKIE}=${id};`);
  });

  it("replaces malformed session identifiers with a fresh one", async () => {
    const api = new TinCanApi();
    const response = await api.fetch(new Request("http://test/api/subscription", {
      headers: { [SESSION_HEADER]: "../../etc/passwd", cookie: `${SESSION_COOKIE}=not-hex` },
    }));
    expect(response.headers.get(SESSION_HEADER)).toMatch(/^[a-f0-9]{32}$/);
  });

  it("expires idle sessions and caps the session count", async () => {
    let now = 1_000_000;
    const api = new TinCanApi({ now: () => now, sessionTtlMs: 1_000, maxSessions: 2 });
    const alice = client(api);
    await alice("/api/licenses", jsonInit({ count: 1 }));
    now += 1_001;
    expect(await (await alice("/api/subscription")).json()).toMatchObject({ licenseCount: 10 });

    const bob = client(api);
    const carol = client(api);
    await bob("/api/subscription");
    await carol("/api/subscription");
    expect(api.sessionCount).toBe(2);
  });

  it("serves static assets and falls back to the SPA entry point", async () => {
    const outerRoot = await mkdtemp(join(tmpdir(), "tincan-api-test-"));
    const root = join(outerRoot, "public");
    temporaryRoots.push(outerRoot);
    await mkdir(root);
    await mkdir(join(root, "assets"));
    await writeFile(join(root, "index.html"), "<main>TinCan app</main>");
    await writeFile(join(root, "assets", "app.js"), "export const ready = true;");
    await writeFile(join(root, "assets", "brand.woff2"), "font-data");
    await writeFile(join(outerRoot, "secret.txt"), "must not be served");
    const api = new TinCanApi({ staticRoot: root });

    const deepLink = await api.fetch(new Request("http://test/admin/issues/INC-1042"));
    expect(await deepLink.text()).toContain("TinCan app");
    expect(deepLink.headers.get("cache-control")).toBe("no-store");
    expect(deepLink.headers.get("set-cookie")).toBeNull();
    const asset = await api.fetch(new Request("http://test/assets/app.js"));
    expect(await asset.text()).toContain("ready = true");
    expect(asset.headers.get("x-content-type-options")).toBe("nosniff");
    expect(asset.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    const font = await api.fetch(new Request("http://test/assets/brand.woff2"));
    expect(font.headers.get("content-type")).toBe("font/woff2");
    const traversal = await api.fetch(new Request("http://test/%2e%2e%2fsecret.txt"));
    expect(traversal.status).toBe(404);
    expect(await traversal.text()).not.toContain("must not be served");
  });
});
