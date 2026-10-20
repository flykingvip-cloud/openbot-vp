import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  describeNoVncObserverToken,
  issueNoVncObserverToken,
  resetNoVncObserverTokensForTests,
} from "../agents/sandbox/novnc-auth.js";
import { consumeNoVncObserverToken } from "../agents/sandbox/novnc-auth.js";
import { handleNoVncObserverHttp } from "./novnc-observer-http.js";

describe("noVNC observer HEAD vs GET token consume", () => {
  const servers: http.Server[] = [];

  afterEach(async () => {
    resetNoVncObserverTokensForTests();
    while (servers.length) {
      const server = servers.pop();
      if (!server) {
        continue;
      }
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });

  async function startServer() {
    const server = http.createServer((req, res) => {
      if (!handleNoVncObserverHttp(req, res, consumeNoVncObserverToken)) {
        res.statusCode = 404;
        res.end("no");
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    servers.push(server);
    const { port } = server.address() as AddressInfo;
    return `http://127.0.0.1:${port}`;
  }

  it("HEAD peeks without consuming; GET consumes once", async () => {
    const base = await startServer();
    const token = issueNoVncObserverToken({
      noVncPort: 16080,
      password: "secret-vnc",
      ttlMs: 60_000,
      relay: true,
    });
    expect(describeNoVncObserverToken(token)).not.toBeNull();
    const url = `${base}/sandbox/novnc?token=${token}`;
    const head = await fetch(url, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(describeNoVncObserverToken(token)).not.toBeNull();
    const get = await fetch(url);
    expect(get.status).toBe(200);
    expect(await get.text()).toContain("sandbox%2Fnovnc%2Fws%3Fgrant%3D");
    expect(describeNoVncObserverToken(token)).toBeNull();
    const replay = await fetch(url);
    expect(replay.status).toBe(404);
    expect(await replay.text()).toBe("Invalid or expired token");
  });
});
