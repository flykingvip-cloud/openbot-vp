import { readFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { StubConfig } from "./config.js";
import { listenDeviceDh } from "./http.js";
import { createPlaceholderModelClient, type DeviceDhModelClient } from "./model.js";
import { DeviceDhService } from "./service.js";
import type { EventEnvelope } from "./types.js";
import { basicHeader, pkceS256, randomId } from "./util.js";

const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "examples", "fixtures");
const framePng = readFileSync(path.join(fixtureDir, "frame.png"));

const consentSecret = "consent-secret-16+";
const serviceSecret = "service-secret-16+";
const consentAuth = { authorization: basicHeader("consent-sim", consentSecret) };
const serviceAuth = { authorization: basicHeader("device-platform", serviceSecret) };

type Json = Record<string, unknown>;

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

function gatedModels(): {
  client: DeviceDhModelClient;
  visionCalls: () => number;
  entered: Promise<void>;
  release: () => void;
} {
  const inner = createPlaceholderModelClient();
  let calls = 0;
  let markEntered = () => {};
  const entered = new Promise<void>((resolve) => {
    markEntered = resolve;
  });
  let release = () => {};
  return {
    visionCalls: () => calls,
    entered,
    release: () => release(),
    client: {
      mode: inner.mode,
      target: inner.target,
      completeTurn: (ctx) => inner.completeTurn(ctx),
      async describeImage(ctx) {
        calls += 1;
        markEntered();
        await new Promise<void>((resolve, reject) => {
          if (ctx.signal?.aborted) {
            reject(new Error("aborted"));
            return;
          }
          const onAbort = () => reject(new Error("aborted"));
          ctx.signal?.addEventListener("abort", onAbort, { once: true });
          release = () => {
            ctx.signal?.removeEventListener("abort", onAbort);
            resolve();
          };
        });
        return inner.describeImage(ctx);
      },
    },
  };
}

function countingModels(): { client: DeviceDhModelClient; visionCalls: () => number } {
  const inner = createPlaceholderModelClient();
  let calls = 0;
  return {
    visionCalls: () => calls,
    client: {
      mode: inner.mode,
      target: inner.target,
      completeTurn: (ctx) => inner.completeTurn(ctx),
      async describeImage(ctx) {
        calls += 1;
        return inner.describeImage(ctx);
      },
    },
  };
}

async function start(options: ConstructorParameters<typeof DeviceDhService>[0]) {
  const service = new DeviceDhService({ approvalToken: "test-approval-token", ...options });
  const listening = await listenDeviceDh({ service, fixtureDir, port: 0 });
  return { service, ...listening };
}

async function call(
  base: string,
  method: string,
  pathname: string,
  headers: Record<string, string> = {},
  body?: Json,
): Promise<{ status: number; json: Json }> {
  const response = await fetch(`${base}${pathname}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  return { status: response.status, json: text ? (JSON.parse(text) as Json) : {} };
}

function codeOf(json: Json): string | undefined {
  const error = json.error;
  if (!error || typeof error !== "object") {
    return undefined;
  }
  return (error as Json).code as string | undefined;
}

async function exchange(base: string) {
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
      scopes: ["chat", "camera.capture", "media.read"],
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
    headers: {
      ...serviceAuth,
      "x-openbot-grant-credential": String(exchanged.json.authorizationCredential),
    },
  };
}

async function openCamera(server: { url: string; service: DeviceDhService }, key: string) {
  const grant = await exchange(server.url);
  const deviceEvents: EventEnvelope[] = [];
  server.service.subscribeDevice(grant.authorizationRef, (event) => {
    deviceEvents.push(event);
  });
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
  const conversationId = String(conversation.json.conversationId);
  const turn = await call(
    server.url,
    "POST",
    `/api/integrations/v1/conversations/${conversationId}/turns`,
    { ...grant.headers, "idempotency-key": key },
    {
      turnId: `t-${key}`,
      text: "看看冰箱",
      bindingVersion: 1,
      input: { type: "text", text: "看看冰箱" },
    },
  );
  expect(turn.status).toBe(202);
  expect(turn.json.status).toBe("waiting_tool");
  const request = deviceEvents.find((event) => event.type === "tool.request");
  const requestId = String(request?.payload.requestId);
  expect(requestId.startsWith("req_")).toBe(true);
  const runId = String(turn.json.runId);
  const runEvents: EventEnvelope[] = [];
  server.service.subscribeRun(runId, (event) => {
    runEvents.push(event);
  });
  return { grant, runId, requestId, runEvents };
}

function resultBody(readUrl: string, width = 1): Json {
  return {
    bindingVersion: 1,
    status: "ok",
    result: {
      readUrl,
      contentType: "image/png",
      width,
      height: 1,
      byteLength: framePng.length,
    },
  };
}

async function countingPng(): Promise<{
  url: string;
  pulls: () => number;
  close: () => Promise<void>;
}> {
  let pulls = 0;
  const server = http.createServer((_req, res) => {
    pulls += 1;
    res.writeHead(200, {
      "content-type": "image/png",
      "content-length": String(framePng.length),
    });
    res.end(framePng);
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("counting media server did not bind");
  }
  return {
    url: `http://127.0.0.1:${address.port}/frame.png`,
    pulls: () => pulls,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

async function holdPng(): Promise<{
  url: string;
  started: Promise<void>;
  release: () => void;
  close: () => Promise<void>;
}> {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let markStarted = () => {};
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const server = http.createServer((_req, res) => {
    markStarted();
    void gate.then(() => {
      res.writeHead(200, {
        "content-type": "image/png",
        "content-length": String(framePng.length),
      });
      res.end(framePng);
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("held media server did not bind");
  }
  return {
    url: `http://127.0.0.1:${address.port}/frame.png`,
    started,
    release,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

function assertNoVisionSuccess(events: EventEnvelope[]): void {
  expect(events.some((event) => event.type === "run.completed")).toBe(false);
  const visible = events.filter((event) => event.type === "assistant.visible");
  expect(visible.every((event) => !JSON.stringify(event.payload).includes("占位视觉"))).toBe(true);
}

describe("device digital-human tool-result reliability", () => {
  it("does not complete a run when media arrives after cancel, revoke, rebind, or timeout", async () => {
    const cases = ["cancel", "revoke", "rebind", "timeout"] as const;
    for (const kind of cases) {
      const models = countingModels();
      let now = 20_000;
      const server = await start({
        config: testConfig(),
        now: () => now,
        toolTimeoutMs: 5_000,
        models: models.client,
      });
      const held = await holdPng();
      let pending: Promise<{ status: number; json: Json }> | undefined;
      try {
        const camera = await openCamera(server, `cam-${kind}`);
        pending = call(
          server.url,
          "POST",
          `/api/integrations/v1/device-tool-requests/${camera.requestId}/result`,
          { ...camera.grant.headers, "idempotency-key": `result-${kind}` },
          resultBody(held.url),
        );
        await held.started;
        if (kind === "cancel") {
          const cancelled = await call(
            server.url,
            "POST",
            `/api/integrations/v1/runs/${camera.runId}/cancel`,
            camera.grant.headers,
            { reason: "user" },
          );
          expect(cancelled.json.status).toBe("cancelled");
        } else if (kind === "revoke") {
          const revoked = await call(
            server.url,
            "POST",
            `/api/integrations/v1/grants/${camera.grant.authorizationRef}/revoke`,
            camera.grant.headers,
            {},
          );
          expect(revoked.json.status).toBe("revoked");
        } else if (kind === "rebind") {
          const rebound = await call(
            server.url,
            "POST",
            `/api/integrations/v1/grants/${camera.grant.authorizationRef}/rebind`,
            consentAuth,
            { digitalHumanId: "agent-demo-2" },
          );
          expect(rebound.json.bindingVersion).toBe(2);
        } else {
          now += 10_000;
          server.service.sweep();
        }
        held.release();
        const late = await pending;
        expect(late.status).not.toBe(200);
        if (kind === "revoke") {
          expect(late.status).toBe(401);
          expect(codeOf(late.json)).toBe("AUTH_REVOKED");
        } else if (kind === "rebind") {
          expect(codeOf(late.json)).toBe("BINDING_MISMATCH");
        } else {
          expect(codeOf(late.json)).toBe("LATE_RESULT");
        }
        expect(models.visionCalls()).toBe(0);
        assertNoVisionSuccess(camera.runEvents);
        if (kind !== "revoke") {
          const run = await call(
            server.url,
            "GET",
            `/api/integrations/v1/runs/${camera.runId}`,
            camera.grant.headers,
          );
          expect(run.json.status).not.toBe("completed");
          const assistant = run.json.assistant as Json;
          const visibleText = assistant.visibleText;
          expect(typeof visibleText === "string" ? visibleText : "").not.toContain("占位视觉");
          if (kind === "timeout") {
            expect(run.json.status).toBe("failed");
            expect(run.json.errorCode).toBe("TOOL_TIMEOUT");
          } else {
            expect(run.json.status).toBe("cancelled");
          }
        }
      } finally {
        held.release();
        await pending?.catch(() => undefined);
        await held.close();
        await server.close();
      }
    }
  });

  it("replays an accepted tool result and conflicts when the body changes", async () => {
    const models = countingModels();
    const server = await start({ config: testConfig(), models: models.client });
    try {
      const camera = await openCamera(server, "idem-cam");
      const body = resultBody(`${server.url}/api/integrations/v1/media/fixtures/frame.png`);
      const headers = { ...camera.grant.headers, "idempotency-key": "tool-ok" };
      const first = await call(
        server.url,
        "POST",
        `/api/integrations/v1/device-tool-requests/${camera.requestId}/result`,
        headers,
        body,
      );
      expect(first.status).toBe(200);
      expect(first.json.status).toBe("accepted");
      expect(first.json.runStatus).toBe("completed");
      expect(first.json.duplicate).toBeUndefined();
      expect(models.visionCalls()).toBe(1);
      const finished = await call(
        server.url,
        "GET",
        `/api/integrations/v1/runs/${camera.runId}`,
        camera.grant.headers,
      );
      const finishedText = (finished.json.assistant as Json).visibleText;
      expect(typeof finishedText === "string" ? finishedText : "").toContain("占位视觉");

      const replay = await call(
        server.url,
        "POST",
        `/api/integrations/v1/device-tool-requests/${camera.requestId}/result`,
        headers,
        body,
      );
      expect(replay.status).toBe(200);
      expect(replay.json.duplicate).toBe(true);
      expect(replay.json.runId).toBe(first.json.runId);
      expect(replay.json.mediaId).toBe(first.json.mediaId);
      expect(replay.json.runStatus).toBe("completed");
      expect(models.visionCalls()).toBe(1);

      const conflict = await call(
        server.url,
        "POST",
        `/api/integrations/v1/device-tool-requests/${camera.requestId}/result`,
        headers,
        resultBody(`${server.url}/api/integrations/v1/media/fixtures/frame.png`, 2),
      );
      expect(conflict.status).toBe(409);
      expect(codeOf(conflict.json)).toBe("IDEMPOTENCY_CONFLICT");
      expect(codeOf(conflict.json)).not.toBe("LATE_RESULT");
      expect(models.visionCalls()).toBe(1);

      const revoked = await call(
        server.url,
        "POST",
        `/api/integrations/v1/grants/${camera.grant.authorizationRef}/revoke`,
        camera.grant.headers,
        {},
      );
      expect(revoked.status).toBe(200);
      const replayAfterRevoke = await call(
        server.url,
        "POST",
        `/api/integrations/v1/device-tool-requests/${camera.requestId}/result`,
        headers,
        body,
      );
      expect(replayAfterRevoke.status).toBe(200);
      expect(replayAfterRevoke.json.duplicate).toBe(true);
      expect(replayAfterRevoke.json.mediaId).toBe(first.json.mediaId);
      expect(models.visionCalls()).toBe(1);
      const conflictAfterRevoke = await call(
        server.url,
        "POST",
        `/api/integrations/v1/device-tool-requests/${camera.requestId}/result`,
        headers,
        resultBody(`${server.url}/api/integrations/v1/media/fixtures/frame.png`, 9),
      );
      expect(conflictAfterRevoke.status).toBe(409);
      expect(codeOf(conflictAfterRevoke.json)).toBe("IDEMPOTENCY_CONFLICT");
      const freshKey = await call(
        server.url,
        "POST",
        `/api/integrations/v1/device-tool-requests/${camera.requestId}/result`,
        { ...camera.grant.headers, "idempotency-key": "tool-ok-2" },
        body,
      );
      expect(freshKey.status).toBe(401);
      expect(codeOf(freshKey.json)).toBe("AUTH_REVOKED");
      expect(models.visionCalls()).toBe(1);
    } finally {
      await server.close();
    }
  });

  it("replays the same tool result while vision is still running", async () => {
    const models = gatedModels();
    const server = await start({ config: testConfig(), models: models.client });
    const media = await countingPng();
    let first: Promise<{ status: number; json: Json }> | undefined;
    try {
      const camera = await openCamera(server, "inflight-cam");
      const body = resultBody(media.url);
      const headers = { ...camera.grant.headers, "idempotency-key": "tool-inflight" };
      const path = `/api/integrations/v1/device-tool-requests/${camera.requestId}/result`;
      first = call(server.url, "POST", path, headers, body);
      await models.entered;
      const second = await Promise.race([
        call(server.url, "POST", path, headers, body).then((value) => ({
          settled: true as const,
          value,
        })),
        new Promise<{ settled: false }>((resolve) => {
          setTimeout(() => resolve({ settled: false }), 2_000);
        }),
      ]);
      if (!second.settled) {
        throw new Error("in-flight tool-result retry waited on vision");
      }
      expect(second.value.status).toBe(200);
      expect(codeOf(second.value.json)).not.toBe("LATE_RESULT");
      expect(second.value.json.duplicate).toBe(true);
      expect(second.value.json.status).toBe("accepted");
      expect(second.value.json.runId).toBe(camera.runId);
      expect(second.value.json.requestId).toBe(camera.requestId);
      expect(models.visionCalls()).toBe(1);
      expect(media.pulls()).toBe(1);

      const conflict = await call(server.url, "POST", path, headers, resultBody(media.url, 2));
      expect(conflict.status).toBe(409);
      expect(codeOf(conflict.json)).toBe("IDEMPOTENCY_CONFLICT");
      expect(models.visionCalls()).toBe(1);
      expect(media.pulls()).toBe(1);

      models.release();
      const done = await first;
      expect(done.status).toBe(200);
      expect(done.json.duplicate).toBeUndefined();
      expect(done.json.status).toBe(second.value.json.status);
      expect(done.json.runId).toBe(second.value.json.runId);
      expect(done.json.requestId).toBe(second.value.json.requestId);
      expect(done.json.runStatus).toBe("completed");
      expect(done.json.mediaId).toBe(second.value.json.mediaId);
      expect(models.visionCalls()).toBe(1);
      expect(media.pulls()).toBe(1);

      const replay = await call(server.url, "POST", path, headers, body);
      expect(replay.status).toBe(200);
      expect(replay.json.duplicate).toBe(true);
      expect(replay.json.runId).toBe(done.json.runId);
      expect(replay.json.mediaId).toBe(done.json.mediaId);
      expect(replay.json.runStatus).toBe("completed");
      expect(models.visionCalls()).toBe(1);
      expect(media.pulls()).toBe(1);
    } finally {
      models.release();
      await first?.catch(() => undefined);
      await media.close();
      await server.close();
    }
  });

  it("does not replay a successful completion when vision is cancelled, revoked, rebound, or timed out", async () => {
    const cases = ["cancel", "revoke", "rebind", "timeout"] as const;
    for (const kind of cases) {
      const models = gatedModels();
      let now = 20_000;
      const server = await start({
        config: testConfig(),
        now: () => now,
        toolTimeoutMs: 5_000,
        models: models.client,
      });
      const media = await countingPng();
      let pending: Promise<{ status: number; json: Json }> | undefined;
      try {
        const camera = await openCamera(server, `vision-${kind}`);
        const body = resultBody(media.url);
        const headers = { ...camera.grant.headers, "idempotency-key": `vision-${kind}` };
        const path = `/api/integrations/v1/device-tool-requests/${camera.requestId}/result`;
        pending = call(server.url, "POST", path, headers, body);
        await models.entered;
        if (kind === "cancel") {
          const cancelled = await call(
            server.url,
            "POST",
            `/api/integrations/v1/runs/${camera.runId}/cancel`,
            camera.grant.headers,
            { reason: "user" },
          );
          expect(cancelled.json.status).toBe("cancelled");
        } else if (kind === "revoke") {
          const revoked = await call(
            server.url,
            "POST",
            `/api/integrations/v1/grants/${camera.grant.authorizationRef}/revoke`,
            camera.grant.headers,
            {},
          );
          expect(revoked.json.status).toBe("revoked");
        } else if (kind === "rebind") {
          const rebound = await call(
            server.url,
            "POST",
            `/api/integrations/v1/grants/${camera.grant.authorizationRef}/rebind`,
            consentAuth,
            { digitalHumanId: "agent-demo-2" },
          );
          expect(rebound.json.bindingVersion).toBe(2);
        } else {
          now += 10_000;
          server.service.sweep();
        }
        models.release();
        const late = await pending;
        expect(late.status).not.toBe(200);
        if (kind === "revoke") {
          expect(late.status).toBe(401);
          expect(codeOf(late.json)).toBe("AUTH_REVOKED");
        } else if (kind === "rebind") {
          expect(codeOf(late.json)).toBe("BINDING_MISMATCH");
        } else {
          expect(codeOf(late.json)).toBe("LATE_RESULT");
        }
        expect(models.visionCalls()).toBe(1);
        expect(media.pulls()).toBe(1);
        assertNoVisionSuccess(camera.runEvents);

        const retry = await call(server.url, "POST", path, headers, body);
        expect(retry.status).not.toBe(200);
        if (kind === "revoke") {
          expect(codeOf(retry.json)).toBe("AUTH_REVOKED");
        } else if (kind === "rebind") {
          expect(codeOf(retry.json)).toBe("BINDING_MISMATCH");
        } else {
          expect(codeOf(retry.json)).toBe("LATE_RESULT");
        }
        expect(models.visionCalls()).toBe(1);
        expect(media.pulls()).toBe(1);
        if (kind !== "revoke") {
          const run = await call(
            server.url,
            "GET",
            `/api/integrations/v1/runs/${camera.runId}`,
            camera.grant.headers,
          );
          expect(run.json.status).not.toBe("completed");
          if (kind === "timeout") {
            expect(run.json.status).toBe("failed");
            expect(run.json.errorCode).toBe("TOOL_TIMEOUT");
          } else {
            expect(run.json.status).toBe("cancelled");
          }
        }
      } finally {
        models.release();
        await pending?.catch(() => undefined);
        await media.close();
        await server.close();
      }
    }
  });
});
