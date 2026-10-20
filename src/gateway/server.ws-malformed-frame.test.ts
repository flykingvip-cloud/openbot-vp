/**
 * Stage 3 API-02 E3: real gateway WS malformed-frame / reconnect evidence.
 *
 * Proves wire behavior (not AJV-only):
 * - Pre-handshake malformed JSON → connection closes (1007)
 * - Pre-handshake invalid request frame → connection closes (1008)
 * - Post-handshake malformed JSON → connection closes (1007)
 * - Post-handshake invalid request frame → res.ok=false (request terminate; not default success)
 * - After malformed-frame disconnect, a fresh client can connectOk again (server resilience)
 *
 * Not a full fuzz corpus / binary-frame suite. Stage 3 overall is not PASS.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { WebSocket } from "ws";
import { startGatewayServerHarness, type GatewayServerHarness } from "./server.e2e-ws-harness.js";
import {
  installGatewayTestHooks,
  onceMessage,
  trackConnectChallengeNonce,
} from "./test-helpers.js";

installGatewayTestHooks({ scope: "suite" });

const TIMEOUT_MS = 20_000;

let harness: GatewayServerHarness;

beforeAll(async () => {
  harness = await startGatewayServerHarness();
}, TIMEOUT_MS);

afterAll(async () => {
  await harness.close();
});

async function openRawWs(): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${harness.port}`);
  trackConnectChallengeNonce(ws);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout waiting for ws open")), 10_000);
    ws.once("open", () => {
      clearTimeout(timer);
      resolve();
    });
    ws.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
  return ws;
}

function waitClose(ws: WebSocket, timeoutMs = 5_000): Promise<{ code: number; reason: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout waiting for ws close")), timeoutMs);
    ws.once("close", (code, reason) => {
      clearTimeout(timer);
      resolve({ code, reason: reason.toString() });
    });
  });
}

describe("Stage 3 API-02 WS malformed-frame disconnect / reconnect", () => {
  test("pre-handshake malformed JSON closes the connection", { timeout: TIMEOUT_MS }, async () => {
    const ws = await openRawWs();
    const closed = waitClose(ws);
    ws.send("{");
    const { code, reason } = await closed;
    expect(code).toBe(1007);
    expect(reason).toMatch(/invalid json/i);
  });

  test(
    "pre-handshake invalid request frame closes with 1008",
    { timeout: TIMEOUT_MS },
    async () => {
      const ws = await openRawWs();
      const closed = waitClose(ws);
      ws.send(JSON.stringify({ type: "req" }));
      const { code, reason } = await closed;
      expect(code).toBe(1008);
      expect(reason.toLowerCase()).toMatch(/invalid request frame|invalid handshake/);
    },
  );

  test(
    "post-handshake malformed JSON closes; fresh client can reconnect",
    { timeout: TIMEOUT_MS },
    async () => {
      const { ws } = await harness.openClient();
      const closed = waitClose(ws);
      ws.send("not-json{{{");
      const { code, reason } = await closed;
      expect(code).toBe(1007);
      expect(reason).toMatch(/invalid json/i);

      // Server still accepts a new handshake after the prior disconnect.
      const { ws: ws2 } = await harness.openClient();
      expect(ws2.readyState).toBe(WebSocket.OPEN);
      ws2.close();
      await waitClose(ws2);
    },
  );

  test(
    "post-handshake invalid request frame terminates the request (ok:false), not success",
    { timeout: TIMEOUT_MS },
    async () => {
      const { ws } = await harness.openClient();
      const resP = onceMessage<{
        type?: string;
        id?: string;
        ok?: boolean;
        error?: { message?: string; code?: string };
      }>(ws, (o) => o.type === "res" && o.id === "invalid", 5_000);
      ws.send(JSON.stringify({ type: "req", id: "invalid" }));
      const res = await resP;
      expect(res.ok).toBe(false);
      expect(res.error?.message?.toLowerCase()).toMatch(/invalid request frame/);
      // Request terminate (ok:false) satisfies API-02 for validated invalid frames;
      // connection may stay open. Prove it is still usable, then clean up.
      expect(ws.readyState).toBe(WebSocket.OPEN);
      ws.close();
      await waitClose(ws);
    },
  );
});
