import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer, type WebSocket } from "ws";
import {
  mapAibotTextToInbound,
  probeWecomAibotLongConnection,
  WECOM_AIBOT_DEFAULT_WS_URL,
} from "./aibot-ws.js";

const servers: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  while (servers.length > 0) {
    const entry = servers.pop();
    await entry?.close();
  }
});

async function listenMockAibotServer(handler: (socket: WebSocket) => void): Promise<string> {
  const httpServer = createServer();
  const wss = new WebSocketServer({ server: httpServer });
  wss.on("connection", handler);
  await new Promise<void>((resolve) => {
    httpServer.listen(0, "127.0.0.1", () => resolve());
  });
  const address = httpServer.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to bind mock aibot server");
  }
  servers.push({
    close: async () => {
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
      });
    },
  });
  return `ws://127.0.0.1:${address.port}`;
}

describe("wecom aibot ws helpers", () => {
  it("exposes the public WeCom AIBot websocket endpoint", () => {
    expect(WECOM_AIBOT_DEFAULT_WS_URL).toBe("wss://openws.work.weixin.qq.com");
  });

  it("maps AIBot text callbacks into the shared inbound shape", () => {
    expect(
      mapAibotTextToInbound({
        reqId: "req-1",
        msgId: "m-1",
        fromUserId: "zhangsan",
        content: "hello",
      }),
    ).toEqual({
      msgType: "text",
      fromUserName: "zhangsan",
      content: "hello",
      msgId: "m-1",
      aibotReqId: "req-1",
    });
  });

  it("probes AIBot long connection by completing subscribe ack", async () => {
    const wsUrl = await listenMockAibotServer((socket) => {
      socket.on("message", (raw) => {
        const frame = JSON.parse(String(raw)) as {
          cmd?: string;
          headers?: { req_id?: string };
          body?: { bot_id?: string; secret?: string };
        };
        expect(frame.cmd).toBe("aibot_subscribe");
        expect(frame.body?.bot_id).toBe("aib-test");
        expect(frame.body?.secret).toBe("sec-test");
        socket.send(
          JSON.stringify({
            headers: { req_id: frame.headers?.req_id },
            errcode: 0,
            errmsg: "ok",
          }),
        );
      });
    });

    const result = await probeWecomAibotLongConnection({
      botId: "aib-test",
      secret: "sec-test",
      wsUrl,
      timeoutMs: 3_000,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
    }
  });

  it("fails AIBot probe when subscribe returns a non-zero errcode", async () => {
    const wsUrl = await listenMockAibotServer((socket) => {
      socket.on("message", (raw) => {
        const frame = JSON.parse(String(raw)) as { headers?: { req_id?: string } };
        socket.send(
          JSON.stringify({
            headers: { req_id: frame.headers?.req_id },
            errcode: 40014,
            errmsg: "invalid secret",
          }),
        );
      });
    });

    const result = await probeWecomAibotLongConnection({
      botId: "aib-test",
      secret: "bad",
      wsUrl,
      timeoutMs: 3_000,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("40014");
      expect(result.error).toContain("invalid secret");
    }
  });

  it("fails AIBot probe when botId/secret are missing", async () => {
    const result = await probeWecomAibotLongConnection({
      botId: " ",
      secret: "",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("botId and secret");
    }
  });
});
