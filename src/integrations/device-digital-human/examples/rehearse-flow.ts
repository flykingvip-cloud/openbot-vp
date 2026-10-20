import { basicHeader, pkceS256, randomId } from "../util.js";

type Json = Record<string, unknown>;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function asRecord(value: unknown, label: string): Json {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is not an object`);
  }
  return value as Json;
}

async function requestJson(
  baseUrl: string,
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: Json,
): Promise<{ status: number; json: Json }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let parsed: unknown = {};
  if (text) {
    parsed = JSON.parse(text);
  }
  return { status: response.status, json: asRecord(parsed, path) };
}

async function readSse(
  url: string,
  headers: Record<string, string>,
  until: (events: Json[]) => boolean,
): Promise<Json[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  const response = await fetch(url, { headers, signal: controller.signal });
  if (!response.ok || !response.body) {
    const text = await response.text();
    throw new Error(`SSE ${response.status} ${text}`);
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
        events.push(asRecord(JSON.parse(data), "sse"));
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
    throw new Error(
      `SSE ended before the expected event (${events.map((event) => event.type).join(",")})`,
    );
  }
  return events;
}

function errorCode(json: Json): string | undefined {
  const error = json.error;
  if (!error || typeof error !== "object") {
    return undefined;
  }
  const code = (error as Json).code;
  return typeof code === "string" ? code : undefined;
}

/** End-to-end stub loop used by examples.test.ts and rehearse.sh. */
export async function runRehearse(baseUrl: string): Promise<void> {
  const health = await requestJson(baseUrl, "GET", "/healthz", {});
  assert(health.status === 200 && health.json.ok === true, "healthz failed");

  const consent = { authorization: basicHeader("consent-sim", "consent-secret-16+") };
  const service = { authorization: basicHeader("device-platform", "service-secret-16+") };
  const verifier = `verifier-${randomId(18)}`;
  const issued = await requestJson(
    baseUrl,
    "POST",
    "/api/integrations/v1/consent/authorization-codes",
    consent,
    {
      serviceAudience: "device-platform",
      redirectUri: "https://device.example/callback",
      codeChallenge: pkceS256(verifier),
      codeChallengeMethod: "S256",
      digitalHumanId: "agent-demo-1",
      deviceId: "device-demo-1",
      scopes: ["chat", "camera.capture", "media.read"],
      state: "rehearse-state",
    },
  );
  assert(issued.status === 201, `authorization code failed: ${issued.status}`);
  const authorizationCode = issued.json.authorizationCode;
  assert(typeof authorizationCode === "string", "missing authorizationCode");

  const exchanged = await requestJson(
    baseUrl,
    "POST",
    "/api/integrations/v1/grants/exchange",
    { ...service, "idempotency-key": "rehearse-exchange" },
    {
      authorizationCode,
      codeVerifier: verifier,
      redirectUri: "https://device.example/callback",
    },
  );
  assert(
    exchanged.status === 200,
    `exchange failed: ${exchanged.status} ${JSON.stringify(exchanged.json)}`,
  );
  const authorizationRef = exchanged.json.authorizationRef;
  const authorizationCredential = exchanged.json.authorizationCredential;
  const bindingVersion = exchanged.json.bindingVersion;
  const assistant = asRecord(exchanged.json.assistant, "assistant");
  assert(typeof authorizationRef === "string", "missing authorizationRef");
  assert(typeof authorizationCredential === "string", "missing authorizationCredential");
  assert(bindingVersion === 1, "bindingVersion must start at 1");
  assert(assistant.digitalHumanId === "agent-demo-1", "assistant.digitalHumanId mismatch");
  assert(exchanged.json.deviceId === "device-demo-1", "deviceId mismatch");

  const grantHeaders = {
    ...service,
    "x-openbot-grant-credential": authorizationCredential,
  };
  const loaded = await requestJson(
    baseUrl,
    "GET",
    `/api/integrations/v1/grants/${authorizationRef}`,
    grantHeaders,
  );
  assert(loaded.status === 200, "grant query failed");
  assert(
    loaded.json.authorizationCredential === undefined,
    "credential must not be readable again",
  );

  const capabilities = await requestJson(
    baseUrl,
    "PUT",
    `/api/integrations/v1/grants/${authorizationRef}/device-capabilities`,
    grantHeaders,
    {
      authorizationRef,
      bindingVersion,
      deviceId: "device-demo-1",
      schemaVersion: 1,
      capabilitiesVersion: 1,
      online: true,
      tools: [{ name: "camera.capture", available: true }],
      camera: { formats: ["image/jpeg", "image/png"], maxBytes: 2_000_000 },
    },
  );
  assert(capabilities.status === 200, "capabilities failed");
  assert(
    Array.isArray(capabilities.json.acceptedTools) &&
      capabilities.json.acceptedTools.includes("camera.capture"),
    "camera.capture was not accepted",
  );

  const created = await requestJson(
    baseUrl,
    "POST",
    "/api/integrations/v1/conversations",
    grantHeaders,
    {
      authorizationRef,
      externalConversationId: "device_conversation_rehearse",
      deviceId: "device-demo-1",
      bindingVersion,
    },
  );
  assert(created.status === 201, "conversation create failed");
  const conversationId = created.json.conversationId;
  assert(typeof conversationId === "string", "missing conversationId");

  const turn = await requestJson(
    baseUrl,
    "POST",
    `/api/integrations/v1/conversations/${conversationId}/turns`,
    { ...grantHeaders, "idempotency-key": "rehearse-turn-camera" },
    {
      turnId: "turn-camera",
      text: "看看冰箱里有什么",
      locale: "zh-CN",
      authorizationRef,
      bindingVersion,
      deviceId: "device-demo-1",
      connectionId: "conn-rehearse",
      input: { type: "text", text: "看看冰箱里有什么" },
      traceId: "trace-rehearse",
    },
  );
  assert(turn.status === 202, `turn failed: ${turn.status} ${JSON.stringify(turn.json)}`);
  assert(turn.json.disposition === "accepted", "turn was not accepted");
  const runId = turn.json.runId;
  assert(typeof runId === "string", "missing runId");

  const deviceEvents = await readSse(
    `${baseUrl}/api/integrations/v1/grants/${authorizationRef}/device-events`,
    grantHeaders,
    (events) => events.some((event) => event.type === "tool.request"),
  );
  const toolEvent = deviceEvents.find((event) => event.type === "tool.request");
  const toolPayload = asRecord(toolEvent?.payload, "tool payload");
  const requestId = toolPayload.requestId;
  assert(typeof requestId === "string", "missing requestId");
  assert(toolPayload.toolName === "camera.capture", "unexpected tool");
  assert(toolPayload.authorizationRef === authorizationRef, "tool authorizationRef mismatch");

  const result = await requestJson(
    baseUrl,
    "POST",
    `/api/integrations/v1/device-tool-requests/${requestId}/result`,
    { ...grantHeaders, "idempotency-key": "rehearse-tool-result" },
    {
      requestId,
      authorizationRef,
      bindingVersion,
      runId,
      status: "ok",
      result: {
        contentType: "image/png",
        readUrl: `${baseUrl}/api/integrations/v1/media/fixtures/frame.png`,
      },
    },
  );
  assert(
    result.status === 200,
    `tool result failed: ${result.status} ${JSON.stringify(result.json)}`,
  );

  const runEvents = await readSse(
    `${baseUrl}/api/integrations/v1/runs/${runId}/events`,
    grantHeaders,
    (events) => events.some((event) => event.type === "run.completed"),
  );
  const visible = runEvents.find(
    (event) => event.type === "assistant.visible" && eventSpeakable(event),
  );
  const finalEvent = runEvents.find((event) => event.type === "assistant.final");
  assert(visible, "missing speakable assistant.visible");
  assert(finalEvent, "missing assistant.final");
  const finalPayload = asRecord(finalEvent.payload, "final payload");
  assert(finalPayload.speakable === false, "assistant.final must not be speakable");
  assert(
    typeof finalPayload.text === "string" && finalPayload.text.includes("占位视觉"),
    "vision placeholder missing",
  );
  assert(finalPayload.reconciliation === true, "assistant.final is the reconciliation event");

  const duplicate = await requestJson(
    baseUrl,
    "POST",
    `/api/integrations/v1/conversations/${conversationId}/turns`,
    { ...grantHeaders, "idempotency-key": "rehearse-turn-camera" },
    {
      turnId: "turn-camera",
      text: "看看冰箱里有什么",
      locale: "zh-CN",
      authorizationRef,
      bindingVersion,
      deviceId: "device-demo-1",
      connectionId: "conn-rehearse",
      input: { type: "text", text: "看看冰箱里有什么" },
    },
  );
  assert(duplicate.status === 202, "duplicate turn failed");
  assert(duplicate.json.disposition === "duplicate", "expected duplicate disposition");
  assert(duplicate.json.runId === runId, "duplicate returned a different run");

  const cancelTurn = await requestJson(
    baseUrl,
    "POST",
    `/api/integrations/v1/conversations/${conversationId}/turns`,
    { ...grantHeaders, "idempotency-key": "rehearse-turn-cancel" },
    {
      turnId: "turn-cancel",
      text: "拍照",
      authorizationRef,
      bindingVersion,
      deviceId: "device-demo-1",
      input: { type: "text", text: "拍照" },
    },
  );
  assert(cancelTurn.status === 202, "cancel setup turn failed");
  const cancelRunId = cancelTurn.json.runId;
  assert(typeof cancelRunId === "string", "missing cancel run");
  const cancelled = await requestJson(
    baseUrl,
    "POST",
    `/api/integrations/v1/runs/${cancelRunId}/cancel`,
    grantHeaders,
    { reason: "barge_in", turnId: "turn-cancel" },
  );
  assert(cancelled.status === 200 && cancelled.json.accepted === true, "cancel was not accepted");
  assert(cancelled.json.sideEffectsRolledBack === false, "cancel must not claim a rollback");

  const revoked = await requestJson(
    baseUrl,
    "POST",
    `/api/integrations/v1/grants/${authorizationRef}/revoke`,
    grantHeaders,
    {},
  );
  assert(revoked.status === 200 && revoked.json.status === "revoked", "revoke failed");
  const revokedAgain = await requestJson(
    baseUrl,
    "POST",
    `/api/integrations/v1/grants/${authorizationRef}/revoke`,
    grantHeaders,
    {},
  );
  assert(
    revokedAgain.status === 200 && revokedAgain.json.status === "revoked",
    "revoke is not idempotent",
  );

  const after = await requestJson(
    baseUrl,
    "POST",
    `/api/integrations/v1/conversations/${conversationId}/turns`,
    { ...grantHeaders, "idempotency-key": "rehearse-after-revoke" },
    {
      turnId: "turn-after-revoke",
      text: "你好",
      authorizationRef,
      bindingVersion,
      input: { type: "text", text: "你好" },
    },
  );
  assert(
    after.status === 401 && errorCode(after.json) === "AUTH_REVOKED",
    "revoked grant still accepted a turn",
  );
}

function eventSpeakable(event: Json): boolean {
  const payload = event.payload;
  return Boolean(payload && typeof payload === "object" && (payload as Json).speakable === true);
}
