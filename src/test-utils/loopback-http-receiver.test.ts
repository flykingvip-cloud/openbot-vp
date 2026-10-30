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
  it("classifies only permission/sandbox codes as listen-forbidden (not EADDRINUSE)", () => {
    expect(isListenForbiddenError(Object.assign(new Error("denied"), { code: "EPERM" }))).toBe(
      true,
    );
    expect(isListenForbiddenError(Object.assign(new Error("denied"), { code: "EACCES" }))).toBe(
      true,
    );
    expect(
      isListenForbiddenError(Object.assign(new Error("no addr"), { code: "EADDRNOTAVAIL" })),
    ).toBe(true);
    expect(isListenForbiddenError(Object.assign(new Error("busy"), { code: "EADDRINUSE" }))).toBe(
      false,
    );
    expect(isListenForbiddenError(new Error("loopback listen timed out after 80ms"))).toBe(false);
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

  it("tryProveRealLoopbackHttp returns mode=listen evidence or permission-skipped (never MockAgent PASS)", async (ctx) => {
    const evidence = await tryProveRealLoopbackHttp({ listenTimeoutMs: 2_000 });
    if (!evidence.ok) {
      expect(evidence.code.length).toBeGreaterThan(0);
      expect(evidence.reason).toMatch(/mode=listen/);
      if (!evidence.skipped) {
        throw new Error(
          `tryProveRealLoopbackHttp hard-failed (not skip): ${evidence.code} — ${evidence.reason}`,
        );
      }
      ctx.skip(true, `tryProveRealLoopbackHttp skipped: ${evidence.code} — ${evidence.reason}`);
      return;
    }
    expect(evidence.mode).toBe("listen");
    expect(evidence.port).toBeGreaterThan(0);
    expect(evidence.roundTrip.status).toBe(200);
    expect(evidence.roundTrip.body).toContain("real-loopback-http-listen-evidence");
  });

  it("tryProveRealLoopbackHttp EADDRINUSE is hard fail (skipped:false)", async () => {
    const evidence = await tryProveRealLoopbackHttp({
      listen: async () => {
        throw Object.assign(new Error("listen EADDRINUSE"), { code: "EADDRINUSE" });
      },
    });
    expect(evidence.ok).toBe(false);
    if (evidence.ok) {
      return;
    }
    expect(evidence.skipped).toBe(false);
    expect(evidence.code).toBe("EADDRINUSE");
    expect(evidence.reason).toMatch(/mode=listen failed/);
  });

  it("tryProveRealLoopbackHttp listen timeout is hard fail (skipped:false)", async () => {
    const evidence = await tryProveRealLoopbackHttp({
      listen: async () => {
        throw new Error("loopback listen timed out after 80ms");
      },
    });
    expect(evidence.ok).toBe(false);
    if (evidence.ok) {
      return;
    }
    expect(evidence.skipped).toBe(false);
    expect(evidence.code).toBe("ETIMEDOUT");
    expect(evidence.reason).toMatch(/timed out/);
  });

  it("tryProveRealLoopbackHttp EPERM is skipped:true (permission limit)", async () => {
    const evidence = await tryProveRealLoopbackHttp({
      listen: async () => {
        throw Object.assign(new Error("bind denied"), { code: "EPERM" });
      },
    });
    expect(evidence.ok).toBe(false);
    if (evidence.ok) {
      return;
    }
    expect(evidence.skipped).toBe(true);
    expect(evidence.code).toBe("EPERM");
    expect(evidence.reason).toMatch(/unavailable/);
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
