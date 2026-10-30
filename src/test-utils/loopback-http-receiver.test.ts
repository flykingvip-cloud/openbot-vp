/**
 * Ensures loopback receiver never hangs on listen failure and cleans up.
 */
import http from "node:http";
import { describe, expect, it } from "vitest";
import {
  isListenForbiddenError,
  listenOnLoopback,
  startLoopbackHttpReceiver,
} from "./loopback-http-receiver.js";

describe("loopback-http-receiver", () => {
  it("classifies EPERM/EACCES as listen-forbidden", () => {
    expect(isListenForbiddenError(Object.assign(new Error("denied"), { code: "EPERM" }))).toBe(
      true,
    );
    expect(isListenForbiddenError(Object.assign(new Error("denied"), { code: "EACCES" }))).toBe(
      true,
    );
    expect(isListenForbiddenError(Object.assign(new Error("busy"), { code: "EADDRINUSE" }))).toBe(
      false,
    );
  });

  it("forceMockAgent path starts and closes without hang", async () => {
    const receiver = await startLoopbackHttpReceiver({ forceMockAgent: true });
    expect(receiver.mode).toBe("mock-agent");
    const res = await fetch(`${receiver.baseUrl}/probe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ping: 1 }),
    });
    expect(res.ok).toBe(true);
    expect(receiver.received).toHaveLength(1);
    await receiver.close();
  });

  it("listenOnLoopback succeeds on USER loopback and closes", async () => {
    const server = http.createServer((_req, res) => {
      res.end("ok");
    });
    const addr = await listenOnLoopback(server, "127.0.0.1", 2_000);
    expect(addr.port).toBeGreaterThan(0);
    const res = await fetch(`http://127.0.0.1:${addr.port}/`);
    expect(res.status).toBe(200);
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  });

  it("listenOnLoopback times out when listening never fires (no hang)", async () => {
    const server = http.createServer((_req, res) => {
      res.end("x");
    });
    // Do not actually bind; leave the promise waiting until timeout.
    server.listen = ((..._args: unknown[]) => server) as typeof server.listen;
    await expect(listenOnLoopback(server, "127.0.0.1", 80)).rejects.toThrow(/timed out after 80ms/);
  });

  it("listenOnLoopback rejects on immediate error event", async () => {
    const server = http.createServer((_req, res) => {
      res.end("x");
    });
    server.listen = ((..._args: unknown[]) => {
      queueMicrotask(() => {
        server.emit("error", Object.assign(new Error("bind denied"), { code: "EPERM" }));
      });
      return server;
    }) as typeof server.listen;
    await expect(listenOnLoopback(server, "127.0.0.1", 2_000)).rejects.toMatchObject({
      code: "EPERM",
    });
  });
});
