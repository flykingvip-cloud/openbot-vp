import { readFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  createGatewayAgentModelClient,
  DEFAULT_DEVICE_DH_AGENT_BASE_URL,
  resolveGatewayAgentConfig,
} from "./agent-client.js";
import type { StubConfig } from "./config.js";
import { listenDeviceDh } from "./http.js";
import {
  createPlaceholderModelClient,
  DeviceDhModelError,
  resolveDeviceDhModelMode,
} from "./model.js";
import { DeviceDhService } from "./service.js";
import { basicHeader, pkceS256, randomId } from "./util.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const agentSource = readFileSync(path.join(here, "agent-client.ts"), "utf8");
const serviceSource = readFileSync(path.join(here, "service.ts"), "utf8");

const tinyJpeg = Buffer.from([
  0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff,
  0xd9,
]);

type Json = Record<string, unknown>;

type Captured = {
  url?: string;
  headers: http.IncomingHttpHeaders;
  body?: Json;
};

function sse(chunks: string[]): string {
  return (
    chunks
      .map((content) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`)
      .join("") + "data: [DONE]\n\n"
  );
}

async function listenMockGateway(): Promise<{
  baseUrl: string;
  captured: Captured[];
  close: () => Promise<void>;
}> {
  const captured: Captured[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Json;
      captured.push({ url: req.url, headers: req.headers, body });
      const messages = JSON.stringify(body.messages ?? "");
      if (messages.includes("fail-please")) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "boom" } }));
        return;
      }
      if (messages.includes("claim-only")) {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.end(sse(["库存已更新。"]));
        return;
      }
      if (messages.includes("image_url")) {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.end(sse(["画面里有一个杯子。", "库存已更新。"]));
        return;
      }
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(sse(["你好，", "我在。"]));
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("mock gateway did not bind");
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    captured,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

function testConfig(): StubConfig {
  return {
    clients: [
      {
        clientId: "consent-sim",
        secret: "consent-secret-16+",
        role: "consent",
        allowedDigitalHumanIds: ["agent-demo-1"],
        scopes: ["chat", "camera.capture", "media.read"],
      },
      {
        clientId: "device-platform",
        secret: "service-secret-16+",
        role: "service",
        redirectUris: ["https://device.example/callback"],
      },
    ],
    digitalHumans: [
      {
        digitalHumanId: "agent-demo-1",
        displayName: "Demo Assistant",
        locale: "zh-CN",
        status: "active",
        userSubject: "user-demo",
        tenantId: "tenant-demo",
      },
    ],
  };
}

async function readSseUntil(
  url: string,
  headers: Record<string, string>,
  ready: (events: Json[]) => boolean,
): Promise<Json[]> {
  const response = await fetch(url, { headers });
  if (!response.body) {
    throw new Error("missing sse body");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events: Json[] = [];
  while (true) {
    const next = await reader.read();
    if (next.done) {
      break;
    }
    buffer += decoder.decode(next.value, { stream: true });
    let split = buffer.indexOf("\n\n");
    while (split >= 0) {
      const block = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      const dataLine = block.split(/\r?\n/).find((line) => line.startsWith("data:"));
      if (dataLine) {
        events.push(JSON.parse(dataLine.slice(5).trim()) as Json);
      }
      split = buffer.indexOf("\n\n");
    }
    if (ready(events)) {
      await reader.cancel();
      break;
    }
  }
  return events;
}

async function call(
  base: string,
  method: string,
  pathname: string,
  headers: Record<string, string>,
  body?: Json | Buffer,
) {
  const raw = Buffer.isBuffer(body);
  const response = await fetch(`${base}${pathname}`, {
    method,
    headers: {
      ...(body && !raw ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    body: raw ? new Uint8Array(body) : body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  return {
    status: response.status,
    json: text ? (JSON.parse(text) as Json) : {},
  };
}

describe("device digital-human gateway agent client", () => {
  it("keeps placeholder sentences out of the real client and the service", () => {
    expect(agentSource.includes("占位")).toBe(false);
    expect(serviceSource.includes("占位")).toBe(false);
    expect(serviceSource.includes("placeholderText")).toBe(false);
  });

  it("defaults to the local gateway origin and refuses a public base URL", () => {
    expect(resolveDeviceDhModelMode({})).toBe("placeholder");
    expect(
      resolveDeviceDhModelMode({
        OPENBOT_DEVICE_DH_AGENT: "1",
        OPENBOT_DEVICE_DH_STUB_PLACEHOLDER: "1",
      }),
    ).toBe("placeholder");
    expect(resolveDeviceDhModelMode({ OPENBOT_DEVICE_DH_AGENT: "1" })).toBe("agent");
    const config = resolveGatewayAgentConfig({
      OPENBOT_DEVICE_DH_AGENT_TOKEN: "gateway-token",
      OPENBOT_DEVICE_DH_AGENT_SESSION_KEY: "space:aegis",
    });
    expect(config.baseUrl).toBe(DEFAULT_DEVICE_DH_AGENT_BASE_URL);
    expect(config.token).toBe("gateway-token");
    expect(config.sessionKey).toBe("space:aegis");
    expect(config.agentId).toBe("main");
    expect(() =>
      resolveGatewayAgentConfig({ OPENBOT_DEVICE_DH_AGENT_BASE_URL: "https://example.com" }),
    ).toThrow(DeviceDhModelError);
    expect(() =>
      resolveGatewayAgentConfig({
        OPENBOT_DEVICE_DH_AGENT_BASE_URL: "http://user:secret@127.0.0.1:18789",
      }),
    ).toThrow(/credentials/);
  });

  it("streams a chat completion and a vision sentence from a mock gateway", async () => {
    const gateway = await listenMockGateway();
    const client = createGatewayAgentModelClient({
      baseUrl: gateway.baseUrl,
      token: "gateway-token",
      agentId: "main",
      sessionKey: "space:aegis",
      timeoutMs: 5_000,
    });
    const deltas: string[] = [];
    const spoken = await client.completeTurn({
      text: "你好",
      digitalHumanId: "agent-demo-1",
      displayName: "Demo Assistant",
      locale: "zh-CN",
      conversationId: "conv-1",
      onDelta: (delta) => deltas.push(delta),
    });
    expect(spoken).toBe("你好，我在。");
    expect(deltas.join("")).toBe("你好，我在。");
    expect(spoken.includes("占位")).toBe(false);
    const request = gateway.captured[0];
    expect(request?.url).toBe("/v1/chat/completions");
    expect(request?.headers.authorization).toBe("Bearer gateway-token");
    expect(request?.headers["x-openclaw-agent-id"]).toBe("main");
    expect(request?.headers["x-openclaw-session-key"]).toBe("space:aegis");
    expect(request?.body?.model).toBe("openclaw:main");
    expect(request?.body?.stream).toBe(true);

    const visionDeltas: string[] = [];
    const vision = await client.describeImage({
      userText: "看看画面",
      bytes: tinyJpeg,
      contentType: "image/jpeg",
      width: 1,
      height: 1,
      digitalHumanId: "agent-demo-1",
      displayName: "Demo Assistant",
      locale: "zh-CN",
      conversationId: "conv-1",
      onDelta: (delta) => visionDeltas.push(delta),
    });
    expect(vision).toBe("画面里有一个杯子。");
    expect(vision.includes("库存已更新")).toBe(false);
    expect(vision.includes("占位")).toBe(false);
    const imageBody = JSON.stringify(gateway.captured[1]?.body);
    expect(imageBody).toContain("data:image/jpeg;base64,");
    expect(imageBody).not.toContain("gateway-token");
    await gateway.close();
  });

  it("fails closed when the gateway errors or only claims an inventory write", async () => {
    const gateway = await listenMockGateway();
    const client = createGatewayAgentModelClient({
      baseUrl: gateway.baseUrl,
      agentId: "main",
      timeoutMs: 5_000,
    });
    const ctx = {
      text: "fail-please",
      digitalHumanId: "agent-demo-1",
      displayName: "Demo Assistant",
      conversationId: "conv-1",
      onDelta: () => {},
    };
    await expect(client.completeTurn(ctx)).rejects.toThrow(/HTTP 500/);
    await expect(client.completeTurn({ ...ctx, text: "claim-only" })).rejects.toThrow(
      /inventory change/,
    );
    const placeholder = createPlaceholderModelClient();
    const hatch = await placeholder.describeImage({
      userText: "看看",
      bytes: tinyJpeg,
      contentType: "image/png",
      width: 1,
      height: 1,
      digitalHumanId: "agent-demo-1",
      displayName: "Demo Assistant",
      conversationId: "conv-1",
      onDelta: () => {},
    });
    expect(hatch).toContain("占位视觉");
    await gateway.close();
  });

  it("turns gateway replies into assistant events without the placeholder hatch", async () => {
    const gateway = await listenMockGateway();
    const service = new DeviceDhService({
      config: testConfig(),
      approvalToken: "test-approval-token",
      models: createGatewayAgentModelClient({
        baseUrl: gateway.baseUrl,
        token: "gateway-token",
        agentId: "main",
        sessionKey: "space:aegis",
        timeoutMs: 5_000,
      }),
    });
    const server = await listenDeviceDh({
      service,
      fixtureDir: path.join(here, "examples", "fixtures"),
      port: 0,
    });
    const consentAuth = { authorization: basicHeader("consent-sim", "consent-secret-16+") };
    const serviceAuth = { authorization: basicHeader("device-platform", "service-secret-16+") };
    try {
      const verifier = `v-${randomId(16)}`;
      const issued = await call(
        server.url,
        "POST",
        "/api/integrations/v1/consent/authorization-codes",
        consentAuth,
        {
          serviceAudience: "device-platform",
          redirectUri: "https://device.example/callback",
          codeChallenge: pkceS256(verifier),
          codeChallengeMethod: "S256",
          digitalHumanId: "agent-demo-1",
          deviceId: "device-demo-1",
          scopes: ["chat", "camera.capture", "media.read"],
          state: "state-1",
        },
      );
      const exchanged = await call(
        server.url,
        "POST",
        "/api/integrations/v1/grants/exchange",
        serviceAuth,
        {
          authorizationCode: issued.json.authorizationCode,
          codeVerifier: verifier,
          redirectUri: "https://device.example/callback",
        },
      );
      const headers = {
        ...serviceAuth,
        "x-openbot-grant-credential": String(exchanged.json.authorizationCredential),
      };
      await call(
        server.url,
        "PUT",
        `/api/integrations/v1/grants/${String(exchanged.json.authorizationRef)}/device-capabilities`,
        headers,
        {
          bindingVersion: 1,
          deviceId: "device-demo-1",
          online: true,
          tools: [{ name: "camera.capture", available: true }],
        },
      );
      const created = await call(
        server.url,
        "POST",
        "/api/integrations/v1/conversations",
        headers,
        {
          bindingVersion: 1,
          deviceId: "device-demo-1",
        },
      );
      const conversationId = String(created.json.conversationId);
      const hello = await call(
        server.url,
        "POST",
        `/api/integrations/v1/conversations/${conversationId}/turns`,
        { ...headers, "idempotency-key": "hello" },
        {
          turnId: "t-hello",
          text: "你好",
          bindingVersion: 1,
          input: { type: "text", text: "你好" },
        },
      );
      expect(hello.status).toBe(202);
      expect(hello.json.status).toBe("completed");
      const helloRun = await call(
        server.url,
        "GET",
        `/api/integrations/v1/runs/${String(hello.json.runId)}`,
        headers,
      );
      const helloAssistant = helloRun.json.assistant as Json;
      expect(helloAssistant.visibleText).toBe("你好，我在。");
      expect(String(helloAssistant.visibleText).includes("占位")).toBe(false);
      const rows = await readSseUntil(
        `${server.url}/api/integrations/v1/runs/${String(hello.json.runId)}/events`,
        headers,
        (events) => events.some((event) => event.type === "run.completed"),
      );
      expect(rows.some((event) => event.type === "assistant.delta")).toBe(true);
      expect(rows.some((event) => event.type === "assistant.visible")).toBe(true);
      expect(rows.some((event) => event.type === "assistant.final")).toBe(true);

      const camera = await call(
        server.url,
        "POST",
        `/api/integrations/v1/conversations/${conversationId}/turns`,
        { ...headers, "idempotency-key": "camera" },
        {
          turnId: "t-camera",
          text: "看看画面",
          bindingVersion: 1,
          input: { type: "text", text: "看看画面" },
        },
      );
      expect(camera.json.status).toBe("waiting_tool");
      const device = await readSseUntil(
        `${server.url}/api/integrations/v1/grants/${String(exchanged.json.authorizationRef)}/device-events`,
        headers,
        (events) => events.some((event) => event.type === "tool.request"),
      );
      const tool = device.find((event) => event.type === "tool.request");
      const toolPayload = tool?.payload;
      if (!toolPayload || typeof toolPayload !== "object") {
        throw new Error("missing tool request");
      }
      const requestId = String((toolPayload as Json).requestId);
      const ticket = await call(
        server.url,
        "POST",
        "/api/integrations/v1/media/upload-tickets",
        headers,
        {
          bindingVersion: 1,
          requestId,
          contentType: "image/jpeg",
        },
      );
      await call(
        server.url,
        "PUT",
        String(ticket.json.uploadPath),
        { "content-type": "image/jpeg" },
        tinyJpeg,
      );
      const accepted = await call(
        server.url,
        "POST",
        `/api/integrations/v1/device-tool-requests/${requestId}/result`,
        { ...headers, "idempotency-key": "vision" },
        {
          bindingVersion: 1,
          status: "ok",
          result: {
            mediaId: ticket.json.mediaId,
            contentType: "image/jpeg",
            width: 1,
            height: 1,
            byteLength: tinyJpeg.length,
          },
        },
      );
      expect(accepted.status).toBe(200);
      const visionRun = await call(
        server.url,
        "GET",
        `/api/integrations/v1/runs/${String(camera.json.runId)}`,
        headers,
      );
      const visible = String((visionRun.json.assistant as Json).visibleText);
      expect(visible).toBe("画面里有一个杯子。");
      expect(visible.includes("占位视觉")).toBe(false);
      expect(visible.includes("库存已更新")).toBe(false);

      const failed = await call(
        server.url,
        "POST",
        `/api/integrations/v1/conversations/${conversationId}/turns`,
        { ...headers, "idempotency-key": "fail" },
        {
          turnId: "t-fail",
          text: "fail-please",
          bindingVersion: 1,
          input: { type: "text", text: "fail-please" },
        },
      );
      expect(failed.status).toBe(202);
      const failedRun = await call(
        server.url,
        "GET",
        `/api/integrations/v1/runs/${String(failed.json.runId)}`,
        headers,
      );
      expect(failedRun.json.status).toBe("failed");
      expect(failedRun.json.errorCode).toBe("INTERNAL");
      expect(JSON.stringify(failedRun.json).includes("占位")).toBe(false);
    } finally {
      await server.close();
      await gateway.close();
    }
  });
});
