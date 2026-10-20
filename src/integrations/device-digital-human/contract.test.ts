import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { StubConfig } from "./config.js";
import { listenDeviceDh } from "./http.js";
import { DeviceDhService } from "./service.js";
import { basicHeader, pkceS256, randomId } from "./util.js";

const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "examples", "fixtures");
const gatewayServer = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "gateway",
  "server.ts",
);

const consentSecret = "consent-secret-16+";
const serviceSecret = "service-secret-16+";
const otherSecret = "other-service-secret";

function testConfig(): StubConfig {
  return {
    clients: [
      {
        clientId: "consent-sim",
        secret: consentSecret,
        role: "consent",
        allowedDigitalHumanIds: ["agent-demo-1", "agent-demo-2"],
        scopes: ["chat", "camera.capture", "media.read"],
      },
      {
        clientId: "device-platform",
        secret: serviceSecret,
        role: "service",
        redirectUris: ["https://device.example/callback"],
      },
      {
        clientId: "device-platform-b",
        secret: otherSecret,
        role: "service",
        redirectUris: ["https://device.example/callback"],
      },
    ],
    digitalHumans: [
      {
        digitalHumanId: "agent-demo-1",
        displayName: "Demo Assistant",
        avatar: "https://example.invalid/a.png",
        animationManifestUrl: "https://example.invalid/anim.json",
        locale: "zh-CN",
        voiceHint: "neutral",
        status: "active",
        userSubject: "user-demo",
        tenantId: "tenant-demo",
      },
      {
        digitalHumanId: "agent-demo-2",
        displayName: "Demo Two",
        locale: "zh-CN",
        status: "active",
        userSubject: "user-two",
        tenantId: "tenant-demo",
      },
    ],
  };
}

type Json = Record<string, unknown>;

async function start(
  options: ConstructorParameters<typeof DeviceDhService>[0] = { config: testConfig() },
) {
  const service = new DeviceDhService({ approvalToken: "test-approval-token", ...options });
  const listening = await listenDeviceDh({ service, fixtureDir, port: 0 });
  return { service, ...listening };
}

async function call(
  base: string,
  method: string,
  pathname: string,
  headers: Record<string, string> = {},
  body?: Json | Buffer,
): Promise<{ status: number; json: Json; headers: Headers }> {
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
  const json = text ? (JSON.parse(text) as Json) : {};
  return { status: response.status, json, headers: response.headers };
}

function payloadOf(event: Json | undefined): Json {
  const payload = event?.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("missing event payload");
  }
  return payload as Json;
}

function codeOf(json: Json): string | undefined {
  const error = json.error;
  if (!error || typeof error !== "object") {
    return undefined;
  }
  return (error as Json).code as string | undefined;
}

const consentAuth = { authorization: basicHeader("consent-sim", consentSecret) };
const serviceAuth = { authorization: basicHeader("device-platform", serviceSecret) };
const otherAuth = { authorization: basicHeader("device-platform-b", otherSecret) };

async function exchange(base: string, scopes = ["chat", "camera.capture", "media.read"]) {
  const verifier = `v-${randomId(16)}`;
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
      digitalHumanId: "agent-demo-1",
      deviceId: "device-demo-1",
      scopes,
      state: "state-1",
    },
  );
  expect(issued.status).toBe(201);
  const exchanged = await call(base, "POST", "/api/integrations/v1/grants/exchange", serviceAuth, {
    authorizationCode: issued.json.authorizationCode,
    codeVerifier: verifier,
    redirectUri: "https://device.example/callback",
  });
  expect(exchanged.status).toBe(200);
  return {
    authorizationRef: String(exchanged.json.authorizationRef),
    credential: String(exchanged.json.authorizationCredential),
    headers: {
      ...serviceAuth,
      "x-openbot-grant-credential": String(exchanged.json.authorizationCredential),
    },
  };
}

const tinyJpeg = readFileSync(path.join(fixtureDir, "frame.jpg"));

describe("device digital-human integrations v1 stub", () => {
  it("does not mount the stub on the production gateway", () => {
    const source = readFileSync(gatewayServer, "utf8");
    expect(source.includes("device-digital-human")).toBe(false);
  });

  it("rejects bearer, cookie, and forwarded user headers", async () => {
    const server = await start();
    try {
      const bearer = await call(
        server.url,
        "POST",
        "/api/integrations/v1/grants/exchange",
        {
          authorization: "Bearer token",
        },
        {},
      );
      const cookie = await call(
        server.url,
        "POST",
        "/api/integrations/v1/grants/exchange",
        {
          ...serviceAuth,
          cookie: "session=abc",
        },
        {},
      );
      const forwarded = await call(
        server.url,
        "POST",
        "/api/integrations/v1/grants/exchange",
        {
          ...serviceAuth,
          "x-forwarded-user": "root",
        },
        {},
      );
      expect(bearer.status).toBe(401);
      expect(cookie.status).toBe(401);
      expect(forwarded.status).toBe(401);
      expect(codeOf(bearer.json)).toBe("AUTH_INVALID");
      expect(codeOf(cookie.json)).toBe("AUTH_INVALID");
      expect(codeOf(forwarded.json)).toBe("AUTH_INVALID");
    } finally {
      await server.close();
    }
  });

  it("rejects role mixups and bad PKCE without issuing a grant", async () => {
    const server = await start();
    try {
      const mix = await call(
        server.url,
        "POST",
        "/api/integrations/v1/consent/authorization-codes",
        serviceAuth,
        {
          serviceAudience: "device-platform",
          redirectUri: "https://device.example/callback",
          codeChallenge: pkceS256("verifier-ok-16chars"),
          codeChallengeMethod: "S256",
          digitalHumanId: "agent-demo-1",
          deviceId: "device-demo-1",
          scopes: ["chat"],
          state: "s",
        },
      );
      expect(mix.status).toBe(401);
      expect(codeOf(mix.json)).toBe("AUTH_INVALID");

      const verifier = "verifier-ok-16chars";
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
          scopes: ["chat"],
          state: "s",
        },
      );
      const bad = await call(
        server.url,
        "POST",
        "/api/integrations/v1/grants/exchange",
        serviceAuth,
        {
          authorizationCode: issued.json.authorizationCode,
          codeVerifier: "wrong-verifier-value",
          redirectUri: "https://device.example/callback",
        },
      );
      expect(bad.status).toBe(401);
      expect(codeOf(bad.json)).toBe("AUTH_INVALID");
      expect(bad.json.authorizationRef).toBeUndefined();
    } finally {
      await server.close();
    }
  });

  it("uses one not-found response for missing and cross-grant objects", async () => {
    const server = await start();
    try {
      const first = await exchange(server.url);
      const second = await exchange(server.url);
      const missing = await call(
        server.url,
        "GET",
        "/api/integrations/v1/grants/azr_missing",
        first.headers,
      );
      const cross = await call(
        server.url,
        "GET",
        `/api/integrations/v1/grants/${second.authorizationRef}`,
        first.headers,
      );
      expect(missing.status).toBe(404);
      expect(cross.status).toBe(404);
      expect(codeOf(missing.json)).toBe("OBJECT_NOT_FOUND");
      expect(JSON.stringify(missing.json.error)).toBe(JSON.stringify(cross.json.error));

      const otherIssued = await call(
        server.url,
        "POST",
        "/api/integrations/v1/consent/authorization-codes",
        consentAuth,
        {
          serviceAudience: "device-platform-b",
          redirectUri: "https://device.example/callback",
          codeChallenge: pkceS256("other-verifier-16c"),
          codeChallengeMethod: "S256",
          digitalHumanId: "agent-demo-1",
          deviceId: "device-b",
          scopes: ["chat"],
          state: "s",
        },
      );
      const otherGrant = await call(
        server.url,
        "POST",
        "/api/integrations/v1/grants/exchange",
        otherAuth,
        {
          authorizationCode: otherIssued.json.authorizationCode,
          codeVerifier: "other-verifier-16c",
          redirectUri: "https://device.example/callback",
        },
      );
      const foreign = await call(
        server.url,
        "GET",
        `/api/integrations/v1/grants/${first.authorizationRef}`,
        {
          ...otherAuth,
          "x-openbot-grant-credential": String(otherGrant.json.authorizationCredential),
        },
      );
      expect(foreign.status).toBe(404);
      expect(JSON.stringify(foreign.json.error)).toBe(JSON.stringify(missing.json.error));
    } finally {
      await server.close();
    }
  });

  it("rejects identity overrides, binding mismatches, and busy conversations", async () => {
    const server = await start();
    try {
      const grant = await exchange(server.url);
      const created = await call(
        server.url,
        "POST",
        "/api/integrations/v1/conversations",
        grant.headers,
        {
          authorizationRef: grant.authorizationRef,
          deviceId: "device-demo-1",
          bindingVersion: 1,
          userId: "someone-else",
        },
      );
      expect(created.status).toBe(400);
      expect(codeOf(created.json)).toBe("PARAM_UNSUPPORTED");

      const ok = await call(
        server.url,
        "POST",
        "/api/integrations/v1/conversations",
        grant.headers,
        {
          authorizationRef: grant.authorizationRef,
          deviceId: "device-demo-1",
          bindingVersion: 1,
          externalConversationId: "ext-1",
        },
      );
      expect(ok.status).toBe(201);
      const conversationId = String(ok.json.conversationId);
      await call(
        server.url,
        "PUT",
        `/api/integrations/v1/grants/${grant.authorizationRef}/device-capabilities`,
        grant.headers,
        {
          bindingVersion: 1,
          deviceId: "device-demo-1",
          online: true,
          tools: [{ name: "camera.capture", available: true }],
        },
      );
      const first = await call(
        server.url,
        "POST",
        `/api/integrations/v1/conversations/${conversationId}/turns`,
        { ...grant.headers, "idempotency-key": "k-busy" },
        {
          turnId: "t-busy",
          text: "拍照",
          bindingVersion: 1,
          input: { type: "text", text: "拍照" },
        },
      );
      expect(first.status).toBe(202);
      const busy = await call(
        server.url,
        "POST",
        `/api/integrations/v1/conversations/${conversationId}/turns`,
        { ...grant.headers, "idempotency-key": "k-busy-2" },
        {
          turnId: "t-busy-2",
          text: "你好",
          bindingVersion: 1,
          input: { type: "text", text: "你好" },
        },
      );
      expect(busy.status).toBe(409);
      expect(codeOf(busy.json)).toBe("SESSION_BUSY");
      expect(busy.headers.get("retry-after")).toBe("1");

      const mismatch = await call(
        server.url,
        "POST",
        "/api/integrations/v1/conversations",
        grant.headers,
        { bindingVersion: 9, deviceId: "device-demo-1" },
      );
      expect(mismatch.status).toBe(409);
      expect(codeOf(mismatch.json)).toBe("BINDING_MISMATCH");
    } finally {
      await server.close();
    }
  });

  it("dedupes accepted turns and conflicts when the body changes", async () => {
    let now = 10_000;
    const server = await start({
      config: testConfig(),
      now: () => now,
      idempotencyTtlMs: 50,
      approvalToken: "test-approval-token",
    });
    try {
      const grant = await exchange(server.url);
      const created = await call(
        server.url,
        "POST",
        "/api/integrations/v1/conversations",
        grant.headers,
        {
          bindingVersion: 1,
          deviceId: "device-demo-1",
        },
      );
      const conversationId = String(created.json.conversationId);
      const body = {
        turnId: "t1",
        text: "你好",
        bindingVersion: 1,
        input: { type: "text", text: "你好" },
      };
      const first = await call(
        server.url,
        "POST",
        `/api/integrations/v1/conversations/${conversationId}/turns`,
        { ...grant.headers, "idempotency-key": "same-key" },
        body,
      );
      const again = await call(
        server.url,
        "POST",
        `/api/integrations/v1/conversations/${conversationId}/turns`,
        { ...grant.headers, "idempotency-key": "same-key" },
        body,
      );
      expect(again.status).toBe(202);
      expect(again.json.disposition).toBe("duplicate");
      expect(again.json.runId).toBe(first.json.runId);
      const conflict = await call(
        server.url,
        "POST",
        `/api/integrations/v1/conversations/${conversationId}/turns`,
        { ...grant.headers, "idempotency-key": "same-key" },
        { ...body, text: "不同内容", input: { type: "text", text: "不同内容" } },
      );
      expect(conflict.status).toBe(409);
      expect(codeOf(conflict.json)).toBe("IDEMPOTENCY_CONFLICT");

      now += 100;
      const reused = await call(
        server.url,
        "POST",
        `/api/integrations/v1/conversations/${conversationId}/turns`,
        { ...grant.headers, "idempotency-key": "same-key" },
        { turnId: "t2", text: "你好", bindingVersion: 1, input: { type: "text", text: "你好" } },
      );
      expect(reused.status).toBe(202);
      expect(reused.json.disposition).toBe("accepted");
      expect(reused.json.runId).not.toBe(first.json.runId);
    } finally {
      await server.close();
    }
  });

  it("expires cursors, cancels without claiming rollback, and keeps approvals inside OpenBot", async () => {
    const server = await start({
      config: testConfig(),
      maxEvents: 2,
      approvalToken: "test-approval-token",
    });
    try {
      const grant = await exchange(server.url);
      const created = await call(
        server.url,
        "POST",
        "/api/integrations/v1/conversations",
        grant.headers,
        {
          bindingVersion: 1,
          deviceId: "device-demo-1",
        },
      );
      const conversationId = String(created.json.conversationId);
      const turn = await call(
        server.url,
        "POST",
        `/api/integrations/v1/conversations/${conversationId}/turns`,
        { ...grant.headers, "idempotency-key": "cursor-key" },
        {
          turnId: "t-cursor",
          text: "你好",
          bindingVersion: 1,
          input: { type: "text", text: "你好" },
        },
      );
      const expired = await call(
        server.url,
        "GET",
        `/api/integrations/v1/runs/${String(turn.json.runId)}/events?cursor=0`,
        grant.headers,
      );
      expect(expired.status).toBe(409);
      expect(codeOf(expired.json)).toBe("CURSOR_EXPIRED");

      const approval = await call(
        server.url,
        "POST",
        `/api/integrations/v1/conversations/${conversationId}/turns`,
        { ...grant.headers, "idempotency-key": "approve-key" },
        {
          turnId: "t-approve",
          text: "记下这些",
          bindingVersion: 1,
          input: { type: "text", text: "记下这些" },
        },
      );
      expect(approval.json.status).toBe("waiting_approval");
      const runId = String(approval.json.runId);
      const events = await call(
        server.url,
        "GET",
        `/api/integrations/v1/runs/${runId}`,
        grant.headers,
      );
      expect(events.json.status).toBe("waiting_approval");
      const forged = await call(
        server.url,
        "POST",
        "/api/integrations/v1/internal/approvals/appr_missing",
        grant.headers,
        { decision: "approve" },
      );
      expect(forged.status).toBe(401);
      expect(codeOf(forged.json)).toBe("AUTH_INVALID");

      const snapshot = await readSseUntil(
        `${server.url}/api/integrations/v1/runs/${runId}/events?cursor=1`,
        grant.headers,
        (events) => events.some((event) => event.type === "approval.required"),
      );
      const required = snapshot.find((event) => event.type === "approval.required");
      expect(required).toBeTruthy();
      const approvalId = String(payloadOf(required).approvalId);
      const decided = await call(
        server.url,
        "POST",
        `/api/integrations/v1/internal/approvals/${approvalId}`,
        { "x-openbot-approval-token": "test-approval-token" },
        { decision: "approve" },
      );
      expect(decided.status).toBe(200);
      const done = await call(
        server.url,
        "GET",
        `/api/integrations/v1/runs/${runId}`,
        grant.headers,
      );
      const assistant = done.json.assistant as Json;
      expect(String(assistant.visibleText)).toContain("不能播报库存已更新");

      const cancelled = await call(
        server.url,
        "POST",
        `/api/integrations/v1/runs/${runId}/cancel`,
        grant.headers,
        {
          reason: "user",
        },
      );
      expect(cancelled.json.accepted).toBe(false);
      expect(cancelled.json.sideEffectsRolledBack).toBe(false);
      expect(cancelled.json.status).toBe("completed");
    } finally {
      await server.close();
    }
  });

  it("pulls a PNG fixture, rejects unsafe media, and drops late results after revoke", async () => {
    let now = 5_000;
    const server = await start({
      config: testConfig(),
      now: () => now,
      toolTimeoutMs: 30,
      approvalToken: "test-approval-token",
    });
    try {
      const grant = await exchange(server.url, ["chat"]);
      const created = await call(
        server.url,
        "POST",
        "/api/integrations/v1/conversations",
        grant.headers,
        {
          bindingVersion: 1,
          deviceId: "device-demo-1",
        },
      );
      const denied = await call(
        server.url,
        "POST",
        `/api/integrations/v1/conversations/${String(created.json.conversationId)}/turns`,
        { ...grant.headers, "idempotency-key": "no-camera" },
        {
          turnId: "t-scope",
          text: "看看冰箱",
          bindingVersion: 1,
          input: { type: "text", text: "看看冰箱" },
        },
      );
      expect(denied.status).toBe(202);
      const deniedRun = await call(
        server.url,
        "GET",
        `/api/integrations/v1/runs/${String(denied.json.runId)}`,
        grant.headers,
      );
      expect(deniedRun.json.status).toBe("failed");
      expect(deniedRun.json.errorCode).toBe("SCOPE_DENIED");

      const full = await exchange(server.url);
      await call(
        server.url,
        "PUT",
        `/api/integrations/v1/grants/${full.authorizationRef}/device-capabilities`,
        full.headers,
        {
          bindingVersion: 1,
          deviceId: "device-demo-1",
          online: true,
          tools: [
            { name: "camera.capture", available: true },
            { name: "shell.exec", available: true },
          ],
        },
      );
      const caps = await call(
        server.url,
        "PUT",
        `/api/integrations/v1/grants/${full.authorizationRef}/device-capabilities`,
        full.headers,
        {
          bindingVersion: 1,
          deviceId: "device-demo-1",
          online: true,
          tools: [
            { name: "camera.capture", available: true },
            { name: "shell.exec", available: true },
          ],
        },
      );
      expect(caps.json.acceptedTools).toEqual(["camera.capture"]);
      expect(caps.json.ignoredTools).toEqual(["shell.exec"]);

      const conversation = await call(
        server.url,
        "POST",
        "/api/integrations/v1/conversations",
        full.headers,
        {
          bindingVersion: 1,
          deviceId: "device-demo-1",
        },
      );
      const conversationId = String(conversation.json.conversationId);
      const turn = await call(
        server.url,
        "POST",
        `/api/integrations/v1/conversations/${conversationId}/turns`,
        { ...full.headers, "idempotency-key": "cam-1" },
        {
          turnId: "t-cam",
          text: "看看冰箱里有什么",
          bindingVersion: 1,
          input: { type: "text", text: "看看冰箱里有什么" },
        },
      );
      const device = await readSseUntil(
        `${server.url}/api/integrations/v1/grants/${full.authorizationRef}/device-events`,
        full.headers,
        (events) => events.some((event) => event.type === "tool.request"),
      );
      const requestId = String(
        payloadOf(device.find((event) => event.type === "tool.request")).requestId,
      );

      const ssrf = await call(
        server.url,
        "POST",
        `/api/integrations/v1/device-tool-requests/${requestId}/result`,
        { ...full.headers, "idempotency-key": "bad-media" },
        {
          bindingVersion: 1,
          status: "ok",
          result: { readUrl: "http://169.254.169.254/latest/meta-data" },
        },
      );
      expect(ssrf.status).toBe(400);
      expect(codeOf(ssrf.json)).toBe("MEDIA_INVALID");

      const ticket = await call(
        server.url,
        "POST",
        "/api/integrations/v1/media/upload-tickets",
        full.headers,
        {
          bindingVersion: 1,
          requestId,
          contentType: "image/jpeg",
        },
      );
      expect(ticket.status).toBe(201);
      const uploadPath = String(ticket.json.uploadPath);
      const uploaded = await call(
        server.url,
        "PUT",
        uploadPath,
        { "content-type": "image/jpeg" },
        tinyJpeg,
      );
      expect(uploaded.status).toBe(200);
      expect(uploaded.json.contentType).toBe("image/jpeg");

      const gif = Buffer.from("GIF89a");
      const badUpload = await call(
        server.url,
        "POST",
        "/api/integrations/v1/media/upload-tickets",
        full.headers,
        {
          bindingVersion: 1,
          requestId,
          contentType: "image/gif",
        },
      );
      expect(codeOf(badUpload.json)).toBe("MEDIA_INVALID");
      expect(gif[0]).toBe(0x47);

      const accepted = await call(
        server.url,
        "POST",
        `/api/integrations/v1/device-tool-requests/${requestId}/result`,
        { ...full.headers, "idempotency-key": "good-media" },
        {
          bindingVersion: 1,
          runId: turn.json.runId,
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
      const finished = await call(
        server.url,
        "GET",
        `/api/integrations/v1/runs/${String(turn.json.runId)}`,
        full.headers,
      );
      expect(String((finished.json.assistant as Json).visibleText)).toContain("占位视觉");

      const timeoutTurn = await call(
        server.url,
        "POST",
        `/api/integrations/v1/conversations/${conversationId}/turns`,
        { ...full.headers, "idempotency-key": "cam-timeout" },
        {
          turnId: "t-timeout",
          text: "拍照",
          bindingVersion: 1,
          input: { type: "text", text: "拍照" },
        },
      );
      now += 50;
      server.service.sweep();
      const timedOut = await call(
        server.url,
        "GET",
        `/api/integrations/v1/runs/${String(timeoutTurn.json.runId)}`,
        full.headers,
      );
      expect(timedOut.json.status).toBe("failed");
      expect(timedOut.json.errorCode).toBe("TOOL_TIMEOUT");

      const lateTurn = await call(
        server.url,
        "POST",
        `/api/integrations/v1/conversations/${conversationId}/turns`,
        { ...full.headers, "idempotency-key": "cam-late" },
        {
          turnId: "t-late",
          text: "拍照",
          bindingVersion: 1,
          input: { type: "text", text: "拍照" },
        },
      );
      const lateEvents = await readSseUntil(
        `${server.url}/api/integrations/v1/grants/${full.authorizationRef}/device-events`,
        full.headers,
        (events) =>
          events.some(
            (event) =>
              event.type === "tool.request" &&
              (event.payload as Json).runId === lateTurn.json.runId,
          ),
      );
      const lateRequest = [...lateEvents]
        .toReversed()
        .find((event) => event.type === "tool.request");
      const lateId = String(payloadOf(lateRequest).requestId);
      await call(
        server.url,
        "POST",
        `/api/integrations/v1/grants/${full.authorizationRef}/revoke`,
        full.headers,
        {},
      );
      const late = await call(
        server.url,
        "POST",
        `/api/integrations/v1/device-tool-requests/${lateId}/result`,
        { ...full.headers, "idempotency-key": "late-result" },
        {
          bindingVersion: 1,
          status: "ok",
          result: { readUrl: `${server.url}/api/integrations/v1/media/fixtures/frame.png` },
        },
      );
      expect(late.status).toBe(401);
      expect(codeOf(late.json)).toBe("AUTH_REVOKED");
      const lateRun = await call(
        server.url,
        "GET",
        `/api/integrations/v1/runs/${String(lateTurn.json.runId)}`,
        full.headers,
      );
      expect(lateRun.status).toBe(401);

      now += 60;
      server.service.sweep();
    } finally {
      await server.close();
    }
  });

  it("rebinding invalidates the previous binding and tool request", async () => {
    const server = await start();
    try {
      const grant = await exchange(server.url);
      await call(
        server.url,
        "PUT",
        `/api/integrations/v1/grants/${grant.authorizationRef}/device-capabilities`,
        grant.headers,
        {
          bindingVersion: 1,
          deviceId: "device-demo-1",
          online: true,
          tools: [{ name: "camera.capture", available: true }],
        },
      );
      const conversation = await call(
        server.url,
        "POST",
        "/api/integrations/v1/conversations",
        grant.headers,
        {
          bindingVersion: 1,
          deviceId: "device-demo-1",
        },
      );
      const turn = await call(
        server.url,
        "POST",
        `/api/integrations/v1/conversations/${String(conversation.json.conversationId)}/turns`,
        { ...grant.headers, "idempotency-key": "rebind-turn" },
        {
          turnId: "t-rebind",
          text: "拍照",
          bindingVersion: 1,
          input: { type: "text", text: "拍照" },
        },
      );
      const events = await readSseUntil(
        `${server.url}/api/integrations/v1/grants/${grant.authorizationRef}/device-events`,
        grant.headers,
        (found) => found.some((event) => event.type === "tool.request"),
      );
      const requestId = String(
        payloadOf(events.find((event) => event.type === "tool.request")).requestId,
      );
      const rebound = await call(
        server.url,
        "POST",
        `/api/integrations/v1/grants/${grant.authorizationRef}/rebind`,
        consentAuth,
        { digitalHumanId: "agent-demo-2" },
      );
      expect(rebound.status).toBe(200);
      expect(rebound.json.bindingVersion).toBe(2);
      expect((rebound.json.assistant as Json).digitalHumanId).toBe("agent-demo-2");
      const stale = await call(
        server.url,
        "POST",
        `/api/integrations/v1/device-tool-requests/${requestId}/result`,
        { ...grant.headers, "idempotency-key": "stale-result" },
        {
          bindingVersion: 1,
          status: "ok",
          result: { readUrl: `${server.url}/api/integrations/v1/media/fixtures/frame.png` },
        },
      );
      expect(stale.status).toBe(409);
      expect(codeOf(stale.json)).toBe("BINDING_MISMATCH");
      const run = await call(
        server.url,
        "GET",
        `/api/integrations/v1/runs/${String(turn.json.runId)}`,
        grant.headers,
      );
      expect(run.json.status).toBe("cancelled");
      const serviceRebind = await call(
        server.url,
        "POST",
        `/api/integrations/v1/grants/${grant.authorizationRef}/rebind`,
        grant.headers,
        { digitalHumanId: "agent-demo-1" },
      );
      expect(serviceRebind.status).toBe(401);
    } finally {
      await server.close();
    }
  });
});

async function readSseUntil(
  url: string,
  headers: Record<string, string>,
  until: (events: Json[]) => boolean,
): Promise<Json[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  const response = await fetch(url, { headers, signal: controller.signal });
  if (!response.ok || !response.body) {
    const text = await response.text();
    throw new Error(`sse ${response.status} ${text}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events: Json[] = [];
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      buffer += decoder.decode(chunk.value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        const data = part
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .join("\n");
        if (!data) {
          continue;
        }
        events.push(JSON.parse(data) as Json);
        if (until(events)) {
          controller.abort();
          return events;
        }
      }
    }
  } catch (error) {
    if (until(events)) {
      return events;
    }
    throw error;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
  if (!until(events)) {
    throw new Error(`sse ended early: ${events.map((event) => event.type).join(",")}`);
  }
  return events;
}
