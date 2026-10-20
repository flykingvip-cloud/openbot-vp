import { readFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  createGatewayAgentModelClient,
  DEFAULT_DEVICE_DH_AGENT_BASE_URL,
  deviceDhSessionKey,
  resolveGatewayAgentConfig,
  resolveTrustedGatewayAgent,
} from "./agent-client.js";
import { parseStubConfig, type StubConfig } from "./config.js";
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

const tinyJpeg = readFileSync(path.join(here, "examples", "fixtures", "frame.jpg"));

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
        gatewayAgentId: "main",
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

function trusted(digitalHumanId: string, gatewayAgentId?: string, allowed?: string[]) {
  return {
    grantDigitalHumanId: digitalHumanId,
    humanDigitalHumanId: digitalHumanId,
    ...(gatewayAgentId ? { gatewayAgentId } : {}),
    ...(allowed ? { allowedGatewayAgentIds: allowed } : {}),
  };
}

function codeOf(json: Json): string | undefined {
  const error = json.error;
  if (!error || typeof error !== "object") {
    return undefined;
  }
  return (error as Json).code as string | undefined;
}

async function waitRun(
  base: string,
  headers: Record<string, string>,
  runId: string,
  ready: (run: Json) => boolean,
) {
  let last: Json = {};
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const run = await call(base, "GET", `/api/integrations/v1/runs/${runId}`, headers);
    last = run.json;
    if (ready(run.json)) {
      return run;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`run ${runId} stayed ${String(last.status)}`);
}

async function listenHeldGateway(): Promise<{
  baseUrl: string;
  captured: Captured[];
  started: () => boolean;
  aborted: () => boolean;
  release: () => void;
  close: () => Promise<void>;
}> {
  const captured: Captured[] = [];
  let started = false;
  let aborted = false;
  let releaseHold = () => {};
  const hold = new Promise<void>((resolve) => {
    releaseHold = resolve;
  });
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("aborted", () => {
      aborted = true;
      if (!res.writableEnded) {
        res.end();
      }
    });
    req.on("close", () => {
      if (!res.writableEnded) {
        aborted = true;
      }
    });
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      started = true;
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Json;
      captured.push({ url: req.url, headers: req.headers, body });
      void hold.then(() => {
        if (res.writableEnded || res.destroyed) {
          return;
        }
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.end(sse(["晚点到。"]));
      });
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("held gateway did not bind");
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    captured,
    started: () => started,
    aborted: () => aborted,
    release: releaseHold,
    close: () =>
      new Promise((resolve, reject) => {
        releaseHold();
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

describe("device digital-human gateway agent client", () => {
  it("resolves a trusted agent and refuses a shared fallback", () => {
    expect(resolveTrustedGatewayAgent(trusted("agent-demo-1", "agent-alpha"))).toBe("agent-alpha");
    expect(resolveTrustedGatewayAgent(trusted("agent-demo-1"), "debug-agent")).toBe("debug-agent");
    expect(() => resolveTrustedGatewayAgent(trusted("agent-demo-1"))).toThrow(
      /no gateway agent mapping/,
    );
    expect(() =>
      resolveTrustedGatewayAgent(trusted("agent-demo-1", "agent-alpha", ["someone-else"])),
    ).toThrow(/not allowed to use this gateway agent/);
    expect(() =>
      resolveTrustedGatewayAgent({
        grantDigitalHumanId: "agent-demo-1",
        humanDigitalHumanId: "agent-demo-2",
        gatewayAgentId: "agent-alpha",
      }),
    ).toThrow(/not allowed to use a gateway agent/);
    expect(deviceDhSessionKey({}, "agent-demo-1", "conv-a")).toBe("device-dh:agent-demo-1:conv-a");
    expect(deviceDhSessionKey({}, "agent-demo-2", "conv-b")).not.toBe(
      deviceDhSessionKey({}, "agent-demo-1", "conv-a"),
    );
    expect(
      deviceDhSessionKey(
        { forceSessionKey: true, sessionKey: "space:aegis" },
        "agent-demo-1",
        "conv-a",
      ),
    ).toBe("space:aegis");
    expect(() => parseStubConfig({ clients: [], digitalHumans: [] })).toThrow(/digital human/i);
    expect(() =>
      parseStubConfig({
        clients: [
          {
            clientId: "consent-sim",
            secret: "consent-secret-16+",
            role: "consent",
          },
        ],
        digitalHumans: [
          {
            digitalHumanId: "agent-demo-1",
            displayName: "Demo",
            userSubject: "user-demo",
            tenantId: "tenant-demo",
            gatewayAgentId: "not an id",
          },
        ],
      }),
    ).toThrow(/gatewayAgentId/);
  });

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
      OPENBOT_DEVICE_DH_AGENT_ID: "main",
      OPENBOT_DEVICE_DH_AGENT_SESSION_KEY: "space:aegis",
    });
    expect(config.baseUrl).toBe(DEFAULT_DEVICE_DH_AGENT_BASE_URL);
    expect(config.token).toBe("gateway-token");
    expect(config.debugAgentId).toBeUndefined();
    expect(config.sessionKey).toBeUndefined();
    expect(config.forceSessionKey).toBe(false);
    const forced = resolveGatewayAgentConfig({
      OPENBOT_DEVICE_DH_AGENT_DEBUG: "1",
      OPENBOT_DEVICE_DH_AGENT_ID: "main",
      OPENBOT_DEVICE_DH_AGENT_SESSION_FORCE: "1",
      OPENBOT_DEVICE_DH_AGENT_SESSION_KEY: "space:aegis",
    });
    expect(forced.debugAgentId).toBe("main");
    expect(forced.sessionKey).toBe("space:aegis");
    expect(forced.forceSessionKey).toBe(true);
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
      sessionKey: "space:aegis",
      forceSessionKey: true,
      timeoutMs: 5_000,
    });
    const deltas: string[] = [];
    const spoken = await client.completeTurn({
      text: "你好",
      digitalHumanId: "agent-demo-1",
      displayName: "Demo Assistant",
      locale: "zh-CN",
      conversationId: "conv-1",
      trustedAgent: trusted("agent-demo-1", "main"),
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
      trustedAgent: trusted("agent-demo-1", "main"),
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
      timeoutMs: 5_000,
    });
    const ctx = {
      text: "fail-please",
      digitalHumanId: "agent-demo-1",
      displayName: "Demo Assistant",
      conversationId: "conv-1",
      trustedAgent: trusted("agent-demo-1", "main"),
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
      expect(["accepted", "running", "completed"]).toContain(hello.json.status);
      const helloRun = await waitRun(
        server.url,
        headers,
        String(hello.json.runId),
        (run) => run.status === "completed" || run.status === "failed",
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
      const failedRun = await waitRun(
        server.url,
        headers,
        String(failed.json.runId),
        (run) => run.status === "failed" || run.status === "completed",
      );
      expect(failedRun.json.status).toBe("failed");
      expect(failedRun.json.errorCode).toBe("INTERNAL");
      expect(JSON.stringify(failedRun.json).includes("占位")).toBe(false);
    } finally {
      await server.close();
      await gateway.close();
    }
  });

  it("maps each digital human to its own gateway agent and isolated session", async () => {
    const gateway = await listenMockGateway();
    const config = twoHumanConfig();
    const service = new DeviceDhService({
      config,
      models: createGatewayAgentModelClient({
        baseUrl: gateway.baseUrl,
        timeoutMs: 5_000,
        sessionKey: "space:aegis",
      }),
    });
    const server = await listenDeviceDh({
      service,
      fixtureDir: path.join(here, "examples", "fixtures"),
      port: 0,
    });
    try {
      const alpha = await submitHello(server.url, "agent-demo-1", "key-alpha");
      const beta = await submitHello(server.url, "agent-demo-2", "key-beta");
      await waitRun(server.url, alpha.headers, alpha.runId, (run) => run.status === "completed");
      await waitRun(server.url, beta.headers, beta.runId, (run) => run.status === "completed");
      const agents = gateway.captured.map((request) => request.headers["x-openclaw-agent-id"]);
      const models = gateway.captured.map((request) => request.body?.model);
      const sessions = gateway.captured.map((request) => request.headers["x-openclaw-session-key"]);
      expect(agents).toEqual(["agent-alpha", "agent-beta"]);
      expect(models).toEqual(["openclaw:agent-alpha", "openclaw:agent-beta"]);
      expect(sessions[0]).toBe(`device-dh:agent-demo-1:${alpha.conversationId}`);
      expect(sessions[1]).toBe(`device-dh:agent-demo-2:${beta.conversationId}`);
      expect(sessions[0]).not.toBe(sessions[1]);
      expect(sessions).not.toContain("space:aegis");
    } finally {
      await server.close();
      await gateway.close();
    }
  });

  it("pins every grant to one UI session only when the force flag is set", async () => {
    const gateway = await listenMockGateway();
    const service = new DeviceDhService({
      config: twoHumanConfig(),
      models: createGatewayAgentModelClient({
        baseUrl: gateway.baseUrl,
        timeoutMs: 5_000,
        sessionKey: "space:aegis",
        forceSessionKey: true,
      }),
    });
    const server = await listenDeviceDh({
      service,
      fixtureDir: path.join(here, "examples", "fixtures"),
      port: 0,
    });
    try {
      await submitHello(server.url, "agent-demo-1", "force-a");
      await submitHello(server.url, "agent-demo-2", "force-b");
      await waitFor(() => gateway.captured.length >= 2);
      const sessions = gateway.captured.map((request) => request.headers["x-openclaw-session-key"]);
      expect(sessions).toEqual(["space:aegis", "space:aegis"]);
    } finally {
      await server.close();
      await gateway.close();
    }
  });

  it("fails the run when the digital human has no gateway agent mapping", async () => {
    const gateway = await listenMockGateway();
    const config = twoHumanConfig();
    delete config.digitalHumans[0]?.gatewayAgentId;
    const resolved = resolveGatewayAgentConfig({ OPENBOT_DEVICE_DH_AGENT_ID: "main" });
    const service = new DeviceDhService({
      config,
      models: createGatewayAgentModelClient({
        ...resolved,
        baseUrl: gateway.baseUrl,
        timeoutMs: 5_000,
      }),
    });
    const server = await listenDeviceDh({
      service,
      fixtureDir: path.join(here, "examples", "fixtures"),
      port: 0,
    });
    try {
      const turn = await submitHello(server.url, "agent-demo-1", "missing-map");
      const run = await waitRun(
        server.url,
        turn.headers,
        turn.runId,
        (row) => row.status === "failed",
      );
      expect(run.json.errorCode).toBe("INTERNAL");
      expect(gateway.captured).toHaveLength(0);
      const events = await readSseUntil(
        `${server.url}/api/integrations/v1/runs/${turn.runId}/events`,
        turn.headers,
        (rows) => rows.some((event) => event.type === "run.failed"),
      );
      const failed = events.find((event) => event.type === "run.failed");
      expect(JSON.stringify(failed?.payload)).toContain("no gateway agent mapping");
    } finally {
      await server.close();
      await gateway.close();
    }
  });

  it("returns the run before the gateway finishes and replays an in-flight idempotency key", async () => {
    const gateway = await listenHeldGateway();
    const service = new DeviceDhService({
      config: twoHumanConfig(),
      models: createGatewayAgentModelClient({
        baseUrl: gateway.baseUrl,
        timeoutMs: 5_000,
      }),
    });
    const server = await listenDeviceDh({
      service,
      fixtureDir: path.join(here, "examples", "fixtures"),
      port: 0,
    });
    try {
      const grant = await exchangeFor(server.url, "agent-demo-1");
      const created = await call(
        server.url,
        "POST",
        "/api/integrations/v1/conversations",
        grant.headers,
        {
          bindingVersion: 1,
          deviceId: "device-agent-demo-1",
        },
      );
      const conversationId = String(created.json.conversationId);
      const body = {
        turnId: "t-slow",
        text: "你好",
        bindingVersion: 1,
        input: { type: "text", text: "你好" },
      };
      const first = await Promise.race([
        call(
          server.url,
          "POST",
          `/api/integrations/v1/conversations/${conversationId}/turns`,
          { ...grant.headers, "idempotency-key": "slow-key" },
          body,
        ),
        new Promise<never>((_resolve, reject) => {
          setTimeout(() => reject(new Error("submitTurn waited for the gateway")), 1_000);
        }),
      ]);
      expect(first.status).toBe(202);
      expect(first.json.disposition).toBe("accepted");
      await waitFor(() => gateway.started());
      expect(gateway.captured).toHaveLength(1);
      const again = await call(
        server.url,
        "POST",
        `/api/integrations/v1/conversations/${conversationId}/turns`,
        { ...grant.headers, "idempotency-key": "slow-key" },
        body,
      );
      expect(again.status).toBe(202);
      expect(again.json.disposition).toBe("duplicate");
      expect(again.json.runId).toBe(first.json.runId);
      const busy = await call(
        server.url,
        "POST",
        `/api/integrations/v1/conversations/${conversationId}/turns`,
        { ...grant.headers, "idempotency-key": "other-key" },
        { ...body, turnId: "t-other" },
      );
      expect(busy.status).toBe(409);
      expect(codeOf(busy.json)).toBe("SESSION_BUSY");
      gateway.release();
      const done = await waitRun(
        server.url,
        grant.headers,
        String(first.json.runId),
        (run) => run.status === "completed",
      );
      expect((done.json.assistant as Json).visibleText).toBe("晚点到。");
    } finally {
      await server.close();
      await gateway.close();
    }
  });

  it("aborts the in-flight gateway fetch on cancel and emits no assistant.visible", async () => {
    const gateway = await listenHeldGateway();
    const cancelled: Array<{ agentId: string; sessionKey: string }> = [];
    const service = new DeviceDhService({
      config: twoHumanConfig(),
      models: createGatewayAgentModelClient({
        baseUrl: gateway.baseUrl,
        timeoutMs: 5_000,
        onGatewayCancel: (target) => {
          cancelled.push(target);
        },
      }),
    });
    const server = await listenDeviceDh({
      service,
      fixtureDir: path.join(here, "examples", "fixtures"),
      port: 0,
    });
    try {
      const turn = await submitHello(server.url, "agent-demo-1", "cancel-key");
      await waitFor(() => gateway.started());
      const cancel = await call(
        server.url,
        "POST",
        `/api/integrations/v1/runs/${turn.runId}/cancel`,
        turn.headers,
        { reason: "barge_in", turnId: "t-hello" },
      );
      expect(cancel.json.accepted).toBe(true);
      expect(cancel.json.sideEffectsRolledBack).toBe(false);
      await waitFor(() => gateway.aborted() && cancelled.length > 0);
      expect(cancelled[0]?.agentId).toBe("agent-alpha");
      expect(cancelled[0]?.sessionKey).toBe(`device-dh:agent-demo-1:${turn.conversationId}`);
      const events = await readSseUntil(
        `${server.url}/api/integrations/v1/runs/${turn.runId}/events`,
        turn.headers,
        (rows) => rows.some((event) => event.type === "run.cancelled"),
      );
      expect(events.some((event) => event.type === "assistant.visible")).toBe(false);
      expect(events.some((event) => event.type === "assistant.final")).toBe(false);
      expect(events.some((event) => event.type === "run.cancelled")).toBe(true);
      const run = await call(
        server.url,
        "GET",
        `/api/integrations/v1/runs/${turn.runId}`,
        turn.headers,
      );
      expect(run.json.status).toBe("cancelled");
    } finally {
      await server.close();
      await gateway.close();
    }
  });
});

function twoHumanConfig(): StubConfig {
  return {
    clients: [
      {
        clientId: "consent-sim",
        secret: "consent-secret-16+",
        role: "consent",
        allowedDigitalHumanIds: ["agent-demo-1", "agent-demo-2"],
        scopes: ["chat"],
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
        gatewayAgentId: "agent-alpha",
      },
      {
        digitalHumanId: "agent-demo-2",
        displayName: "Demo Two",
        locale: "zh-CN",
        status: "active",
        userSubject: "user-two",
        tenantId: "tenant-demo",
        gatewayAgentId: "agent-beta",
      },
    ],
  };
}

async function waitFor(ready: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (ready()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("condition was not met");
}

async function exchangeFor(base: string, digitalHumanId: string) {
  const verifier = `v-${randomId(16)}`;
  const consentAuth = { authorization: basicHeader("consent-sim", "consent-secret-16+") };
  const serviceAuth = { authorization: basicHeader("device-platform", "service-secret-16+") };
  const issued = await call(
    base,
    "POST",
    "/api/integrations/v1/consent/authorization-codes",
    consentAuth,
    {
      serviceAudience: "device-platform",
      redirectUri: "https://device.example/callback",
      codeChallenge: pkceS256(verifier),
      codeChallengeMethod: "S256",
      digitalHumanId,
      deviceId: `device-${digitalHumanId}`,
      scopes: ["chat"],
      state: "state-1",
    },
  );
  if (issued.status !== 201) {
    throw new Error(`authorization code failed: ${issued.status}`);
  }
  const exchanged = await call(base, "POST", "/api/integrations/v1/grants/exchange", serviceAuth, {
    authorizationCode: issued.json.authorizationCode,
    codeVerifier: verifier,
    redirectUri: "https://device.example/callback",
  });
  if (exchanged.status !== 200) {
    throw new Error(`grant exchange failed: ${exchanged.status}`);
  }
  return {
    headers: {
      ...serviceAuth,
      "x-openbot-grant-credential": String(exchanged.json.authorizationCredential),
    },
  };
}

async function submitHello(base: string, digitalHumanId: string, idempotencyKey: string) {
  const grant = await exchangeFor(base, digitalHumanId);
  const created = await call(base, "POST", "/api/integrations/v1/conversations", grant.headers, {
    bindingVersion: 1,
    deviceId: `device-${digitalHumanId}`,
  });
  if (created.status !== 201) {
    throw new Error(`conversation failed: ${created.status}`);
  }
  const conversationId = String(created.json.conversationId);
  const turn = await call(
    base,
    "POST",
    `/api/integrations/v1/conversations/${conversationId}/turns`,
    { ...grant.headers, "idempotency-key": idempotencyKey },
    {
      turnId: "t-hello",
      text: "你好",
      bindingVersion: 1,
      input: { type: "text", text: "你好" },
    },
  );
  if (turn.status !== 202) {
    throw new Error(`turn failed: ${turn.status} ${JSON.stringify(turn.json)}`);
  }
  return { headers: grant.headers, conversationId, runId: String(turn.json.runId) };
}
