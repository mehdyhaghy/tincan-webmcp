import { MemoryIssueStore } from "@tincan-webmcp/server";

const store = new MemoryIssueStore();
let subscription = { plan: "Business", licenseCount: 10, status: "active" as const };
const recentReports = new Map<string, number[]>();

const json = (value: unknown, status = 200): Response => Response.json(value, {
  status,
  headers: { "cache-control": "no-store" },
});

const rateLimited = (address: string): boolean => {
  const now = Date.now();
  const attempts = (recentReports.get(address) ?? []).filter((timestamp) => timestamp > now - 60_000);
  attempts.push(now);
  recentReports.set(address, attempts);
  return attempts.length > 10;
};

const server = Bun.serve({
  port: Number(Bun.env.PORT ?? 8787),
  async fetch(request, bunServer) {
    const url = new URL(request.url);

    if (url.pathname === "/api/subscription" && request.method === "GET") return json(subscription);

    if (url.pathname === "/api/licenses" && request.method === "POST") {
      const body = await request.json() as { count?: unknown };
      if (!Number.isInteger(body.count) || Number(body.count) < 1 || Number(body.count) > 100) {
        return json({ error: "License count must be an integer from 1 to 100." }, 400);
      }
      const requestedLicenseCount = Number(body.count);
      const previousLicenseCount = subscription.licenseCount;
      const expectedLicenseCount = previousLicenseCount + requestedLicenseCount;
      subscription = {
        ...subscription,
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
      const body = await request.json() as { count?: unknown };
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
      subscription = { plan: "Business", licenseCount: 10, status: "active" };
      store.clear();
      return json({ status: "reset" });
    }

    if (url.pathname === "/api/issues" && request.method === "GET") return json({ issues: store.list() });

    if (url.pathname === "/_tincan/issues" && request.method === "POST") {
      if (request.headers.get("content-type")?.split(";", 1)[0] !== "application/json") {
        return json({ error: "Content-Type must be application/json." }, 415);
      }
      const address = bunServer.requestIP(request)?.address ?? "unknown";
      if (rateLimited(address)) return json({ error: "Rate limit exceeded." }, 429);
      const text = await request.text();
      if (new TextEncoder().encode(text).byteLength > 256_000) return json({ error: "Incident exceeds 256 KB." }, 413);
      try {
        const incident = store.create(JSON.parse(text));
        return json({ status: "reported", incidentId: incident.id }, 201);
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : "Invalid incident." }, 400);
      }
    }

    return json({ error: "Not found." }, 404);
  },
});

console.info(`TinCan API listening on http://localhost:${server.port}`);
