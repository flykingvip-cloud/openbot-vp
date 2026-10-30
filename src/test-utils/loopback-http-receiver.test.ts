/**
 * Ensures loopback receiver never hangs on listen failure and cleans up.
 * Real mode=listen evidence is skip (not PASS) when bind is forbidden.
 * MockAgent proves fetch/dispatcher only — labeled mode=mock-agent.
 */
import http from "node:http";
import { describe, expect, it } from "vitest";
import {
  isListenForbiddenError,
  listenOnLoopback,
  startLoopbackHttpReceiver,
  tryProveRealLoopbackHttp,
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

  it("mode=mock-agent forceMockAgent path starts and closes without hang (not Live TCP)", async () => {
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

  it("mode=listen listenOnLoopback succeeds on USER loopback and closes (skip on EPERM, never PASS)", async (ctx) => {
    const server = http.createServer((_req, res) => {
      res.end("ok");
    });
    let addr;
    try {
      addr = await listenOnLoopback(server, "127.0.0.1", 2_000);
    } catch (err) {
      try {
        server.close();
      } catch {
        /* ignore */
      }
      if (isListenForbiddenError(err)) {
        const code = (err as NodeJS.ErrnoException).code ?? "EPERM";
        ctx.skip(
          true,
          `mode=listen unavailable: ${code} (Codex/restricted); not counted PASS — use scripts/evidence/prove-loopback-http.ts on USER/unrestricted`,
        );
        return;
      }
      throw err;
    }
    expect(addr.port).toBeGreaterThan(0);
    const res = await fetch(`http://127.0.0.1:${addr.port}/`);
    expect(res.status).toBe(200);
    await new Promise<void>((resolve, reject) =>
      server.close((closeErr) => (closeErr ? reject(closeErr) : resolve())),
    );
  });

  it("tryProveRealLoopbackHttp returns mode=listen evidence or skipped (never MockAgent PASS)", async (ctx) => {
    const evidence = await tryProveRealLoopbackHttp({ listenTimeoutMs: 2_000 });
    if (!evidence.ok) {
      expect(evidence.skipped).toBe(true);
      expect(evidence.code.length).toBeGreaterThan(0);
      expect(evidence.reason).toMatch(/mode=listen/);
      ctx.skip(true, `tryProveRealLoopbackHttp skipped: ${evidence.code} — ${evidence.reason}`);
      return;
    }
    expect(evidence.mode).toBe("listen");
    expect(evidence.port).toBeGreaterThan(0);
    expect(evidence.roundTrip.status).toBe(200);
    expect(evidence.roundTrip.body).toContain("real-loopback-http-listen-evidence");
  });

  it("listenOnLoopback times out when listening never fires (no hang)", async () => {
    const server = http.createServer((_req, res) => {
      res.end("x");
    });
    // Do not actually bind; leave the promise waiting until timeout.
    server.listen = ((..._args: unknown[]) => server) as typeof server.listen;
    await expect(listenOnLoopback(server, "127.0.0.1", 80)).rejects.toThrow(/timed out after 80ms/);
  });

  it("listenOnLoopback rejects on immediate error event (EPERM cleanup)", async () => {
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
