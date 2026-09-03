import { TinCanApi } from "./app";

const api = new TinCanApi();
const trustProxy = Bun.env.TRUST_PROXY === "1";

// Behind a reverse proxy every socket address is the proxy itself, which would
// collapse the per-address rate limit into one shared bucket. When TRUST_PROXY=1
// the proxy is expected to overwrite X-Forwarded-For with the real client address.
const clientAddress = (request: Request, socketAddress: string | undefined): string => {
  if (trustProxy) {
    const forwarded = request.headers.get("x-forwarded-for")?.split(",").pop()?.trim();
    if (forwarded) return forwarded;
  }
  return socketAddress ?? "unknown";
};

const server = Bun.serve({
  hostname: Bun.env.HOST ?? "127.0.0.1",
  port: Number(Bun.env.PORT ?? 8787),
  async fetch(request, bunServer) {
    return api.fetch(request, clientAddress(request, bunServer.requestIP(request)?.address));
  },
});

console.info(`TinCan API listening on http://${server.hostname}:${server.port}`);
