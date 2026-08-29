import { TinCanApi } from "./app";

const api = new TinCanApi();

const server = Bun.serve({
  port: Number(Bun.env.PORT ?? 8787),
  async fetch(request, bunServer) {
    return api.fetch(request, bunServer.requestIP(request)?.address ?? "unknown");
  },
});

console.info(`TinCan API listening on http://localhost:${server.port}`);
