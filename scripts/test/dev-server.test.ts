import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startDevServer } from "./support/dev-server";

let server: Awaited<ReturnType<typeof startDevServer>>;

// Design doc §7 case 2.
describe("dev server", () => {
  beforeAll(async () => {
    server = await startDevServer();
  }, 180_000);

  afterAll(() => server?.stop());

  it("answers health with 200 and the local deploy sha, signed in", async () => {
    const res = await fetch(`${server.base}/api/v1/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", deploy_sha: "local" });
  });

  it("serves the SPA HTML at /", async () => {
    const res = await fetch(`${server.base}/`, { headers: { Accept: "text/html" } });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<div id="root">');
  });
});
