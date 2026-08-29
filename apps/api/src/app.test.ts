import type { IncidentPayload } from "@tincan-webmcp/core";
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TinCanApi } from "./app";

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

const issueRequest = (payload: unknown = incident()): Request => new Request("http://test/_tincan/issues", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(payload),
});

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("TinCan API", () => {
  it("returns 400 for malformed business JSON", async () => {
    const api = new TinCanApi();
    const response = await api.fetch(new Request("http://test/api/licenses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    }));
    expect(response.status).toBe(400);
  });

  it("enforces incident content type and body size", async () => {
    const api = new TinCanApi();
    const unsupported = await api.fetch(new Request("http://test/_tincan/issues", {
      method: "POST",
      body: "{}",
    }));
    expect(unsupported.status).toBe(415);

    const oversized = await api.fetch(new Request("http://test/_tincan/issues", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: `"${"x".repeat(256_001)}"`,
    }));
    expect(oversized.status).toBe(413);
  });

  it("rate limits reports and expires stale address state", async () => {
    let now = 1_000_000;
    const api = new TinCanApi({ now: () => now, rateLimitMax: 1 });
    expect((await api.fetch(issueRequest(), "127.0.0.1")).status).toBe(201);
    expect((await api.fetch(issueRequest(), "127.0.0.1")).status).toBe(429);
    now += 60_001;
    expect((await api.fetch(issueRequest(), "127.0.0.1")).status).toBe(201);
  });

  it("keeps incident IDs monotonic across demo resets", async () => {
    const api = new TinCanApi();
    expect(await (await api.fetch(issueRequest())).json()).toMatchObject({ incidentId: "INC-1042" });
    await api.fetch(new Request("http://test/api/reset", { method: "POST" }));
    expect(await (await api.fetch(issueRequest())).json()).toMatchObject({ incidentId: "INC-1043" });
  });

  it("serves static assets and falls back to the SPA entry point", async () => {
    const root = await mkdtemp(join(tmpdir(), "tincan-api-test-"));
    temporaryRoots.push(root);
    await mkdir(join(root, "assets"));
    await writeFile(join(root, "index.html"), "<main>TinCan app</main>");
    await writeFile(join(root, "assets", "app.js"), "export const ready = true;");
    const api = new TinCanApi({ staticRoot: root });

    const deepLink = await api.fetch(new Request("http://test/admin/issues/INC-1042"));
    expect(await deepLink.text()).toContain("TinCan app");
    const asset = await api.fetch(new Request("http://test/assets/app.js"));
    expect(await asset.text()).toContain("ready = true");
  });
});
