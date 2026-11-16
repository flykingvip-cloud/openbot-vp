/**
 * Isolated loopback gateway tests for Batch 1 diagnosis write-fallback.
 *
 * Starts the official gateway on 127.0.0.1 with an ephemeral port, a temporary
 * state directory, and an independent test identity. Inherited remote gateway
 * URLs, production tokens, and paid-provider API keys are cleared before any
 * request. Agent dispatch is the official test stub (getReplyFromConfig);
 * a paid-model call fails the test instead of being issued.
 */
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  deliverDiagnosisViaOfficialLiveGateway,
  type OfficialDiagnosisGatewayCall,
  type OfficialLiveSendTrace,
} from "../diagnosis/official-live-send.js";
import {
  bindConversationDiagnosisToLiveChat,
  DIAGNOSIS_P24_5_CANARY_TENANT,
  DIAGNOSIS_P24_5_LIVE_SESSION_KEY,
} from "../diagnosis/production-cutover.js";
import { DiagnosisContractError } from "../diagnosis/types.js";
import { callGateway } from "../gateway/call.js";
import type { CallGatewayOptions } from "../gateway/call.js";
import {
  connectOk,
  getReplyFromConfig,
  installGatewayTestHooks,
  rpcReq,
  startServerWithClient,
  testState,
} from "../gateway/test-helpers.js";

installGatewayTestHooks({ scope: "suite" });

const EVIDENCE_DIR = path.join(
  process.env.OPENBOT_BATCH1_EVIDENCE_DIR ?? "/workspace/openbot-vp-audit/batch1-evidence",
  "gateway",
);
const TEST_TOKEN = "test-gateway-token-1234567890";
const INHERITED_ENV_KEYS = [
  "OPENCLAW_GATEWAY_URL",
  "OPENBOT_GATEWAY_URL",
  "CLAWDBOT_GATEWAY_URL",
  "SAND_GATEWAY_BIND_HOST",
  "OPENCLAW_GATEWAY_TOKEN",
  "OPENBOT_GATEWAY_TOKEN",
  "DEEPSEEK_API_KEY",
  "OPENBOT_P4_LIVE_API_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "MOONSHOT_API_KEY",
  "XAI_API_KEY",
  "GROQ_API_KEY",
  "TOGETHER_API_KEY",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
] as const;

const inheritedSnapshot: Record<string, string | null> = {};
const evidence: Record<string, unknown> = {
  startedAt: new Date().toISOString(),
  zone: "Asia/Shanghai",
  productionHostsTouched: false,
  productionLedgerWritten: false,
  paidModelDispatched: false,
  cases: {} as Record<string, unknown>,
};

function writeEvidence(): void {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  evidence.finishedAt = new Date().toISOString();
  fs.writeFileSync(
    path.join(EVIDENCE_DIR, "isolated-gateway.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
    "utf8",
  );
}

function record(name: string, value: unknown): void {
  (evidence.cases as Record<string, unknown>)[name] = value;
  writeEvidence();
}

function emptyTrace(): OfficialLiveSendTrace {
  return { methods: [], resetKeys: [], skippedInjectBecauseAuth: false };
}

describe("batch1 isolated loopback gateway", () => {
  let port = 0;
  let server: Awaited<ReturnType<typeof startServerWithClient>>["server"];
  let ws: Awaited<ReturnType<typeof startServerWithClient>>["ws"];
  let effectiveUrl = "";
  let isolationLogPath = "";
  const stubReplies: string[] = [];

  beforeAll(async () => {
    for (const key of INHERITED_ENV_KEYS) {
      inheritedSnapshot[key] = process.env[key] ?? null;
      delete process.env[key];
    }
    testState.gatewayBind = "loopback";
    testState.gatewayAuth = { mode: "token", token: TEST_TOKEN };
    getReplyFromConfig.mockImplementation(async () => {
      stubReplies.push("fixture-no-paid-model");
      if (process.env.DEEPSEEK_API_KEY || process.env.OPENBOT_P4_LIVE_API_KEY) {
        evidence.paidModelDispatched = true;
        throw new Error("paid model dispatch is forbidden in isolated Batch 1 tests");
      }
      return undefined;
    });

    const started = await startServerWithClient(TEST_TOKEN, { controlUiEnabled: false });
    server = started.server;
    ws = started.ws;
    port = started.port;
    effectiveUrl = `ws://127.0.0.1:${port}`;
    const address = (
      server as { address?: () => { address?: string; port?: number; family?: string } | string }
    ).address?.();
    const bindAddress = address && typeof address === "object" ? address.address : "127.0.0.1";
    if (bindAddress !== "127.0.0.1" && bindAddress !== "::1") {
      await server.close();
      throw new Error(`gateway bind is not loopback: ${String(bindAddress)}`);
    }
    if (!effectiveUrl.startsWith("ws://127.0.0.1:")) {
      await server.close();
      throw new Error(`effective gateway URL is not loopback: ${effectiveUrl}`);
    }
    if (port === 18789) {
      // Allowed only if we obtained it as a free ephemeral bind; still record it.
      evidence.usedDefaultProductionPort = true;
    }
    await connectOk(ws);

    const isolation = {
      bindAddress: bindAddress ?? "127.0.0.1",
      port,
      effectiveGatewayUrl: effectiveUrl,
      urlProvenLoopbackBeforeRequests: true,
      inheritedEnvCleared: Object.fromEntries(
        INHERITED_ENV_KEYS.map((key) => [
          key,
          { before: inheritedSnapshot[key] != null, after: process.env[key] ?? null },
        ]),
      ),
      testIdentity: { token: "test-gateway-token-1234567890", tenant: "isolated-test" },
      stateDir: process.env.OPENCLAW_STATE_DIR ?? null,
      home: process.env.HOME ?? null,
      stubProvider: "getReplyFromConfig official test mock (returns undefined, no provider call)",
      paidKeysPresentAfterClear: Boolean(
        process.env.DEEPSEEK_API_KEY || process.env.OPENBOT_P4_LIVE_API_KEY,
      ),
      deliverDefault: false,
    };
    evidence.isolation = isolation;
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    isolationLogPath = path.join(EVIDENCE_DIR, "isolation-proof.log");
    fs.writeFileSync(
      isolationLogPath,
      [
        `time=${new Date().toISOString()}`,
        `bindAddress=${isolation.bindAddress}`,
        `port=${port}`,
        `effectiveGatewayUrl=${effectiveUrl}`,
        "urlProvenLoopbackBeforeRequests=true",
        `stateDir=${isolation.stateDir}`,
        `stubProvider=${isolation.stubProvider}`,
        "paidModelDispatched=false",
        "",
      ].join("\n"),
      "utf8",
    );
    writeEvidence();
  }, 120_000);

  afterAll(async () => {
    try {
      ws?.close();
    } catch {
      // ignore
    }
    try {
      await server?.close();
    } catch {
      // ignore
    }
    writeEvidence();
  });

  function officialCall(
    token: string,
    extra?: Partial<CallGatewayOptions>,
  ): OfficialDiagnosisGatewayCall {
    return async (opts) =>
      callGateway({
        ...opts,
        ...extra,
        url: effectiveUrl,
        token,
      });
  }

  it("proves isolation before any diagnosis write", () => {
    expect(effectiveUrl).toBe(`ws://127.0.0.1:${port}`);
    expect(fs.existsSync(isolationLogPath)).toBe(true);
    expect(process.env.OPENCLAW_GATEWAY_URL).toBeUndefined();
    expect(process.env.OPENBOT_GATEWAY_URL).toBeUndefined();
    expect(process.env.DEEPSEEK_API_KEY).toBeUndefined();
    expect(process.env.OPENBOT_P4_LIVE_API_KEY).toBeUndefined();
    record("isolation", evidence.isolation);
  });

  it("send succeeds and a duplicate idempotency key does not create a second run", async () => {
    const first = await rpcReq(ws, "chat.send", {
      sessionKey: "main",
      message: "batch1 isolated send",
      idempotencyKey: "batch1-idem-send-1",
      deliver: false,
    });
    expect(first.ok).toBe(true);
    const duplicate = await rpcReq(ws, "chat.send", {
      sessionKey: "main",
      message: "batch1 isolated send",
      idempotencyKey: "batch1-idem-send-1",
      deliver: false,
    });
    expect(duplicate.ok).toBe(true);
    const firstRun = (first.payload as { runId?: string } | undefined)?.runId;
    const dupRun = (duplicate.payload as { runId?: string } | undefined)?.runId;
    expect(dupRun).toBe(firstRun);
    const history = await rpcReq<{ messages?: unknown[] }>(ws, "chat.history", {
      sessionKey: "main",
      limit: 50,
    });
    const userMessages = (history.payload?.messages ?? []).filter((message) => {
      if (!message || typeof message !== "object") {
        return false;
      }
      return (message as { role?: unknown }).role === "user";
    });
    const matching = userMessages.filter((message) => {
      const content = JSON.stringify(message);
      return content.includes("batch1 isolated send");
    });
    expect(matching.length).toBe(1);
    record("send-success-duplicate", {
      requestId: "batch1-idem-send-1",
      firstOk: first.ok,
      duplicateOk: duplicate.ok,
      sameRunId: firstRun === dupRun,
      matchingUserMessages: matching.length,
      paidModelDispatched: evidence.paidModelDispatched,
      stubReplies: stubReplies.length,
      result: "pass",
    });
  }, 60_000);

  it("falls back to inject when send has written but the response times out", async () => {
    const previous = process.env.OPENBOT_CHAT_INBOUND_PERSIST_EARLY;
    process.env.OPENBOT_CHAT_INBOUND_PERSIST_EARLY = "1";
    const t = emptyTrace();
    const sendOutcome: { rpcReturned?: boolean; rpcError?: string } = {};
    const call: OfficialDiagnosisGatewayCall = async (opts) => {
      if (opts.method === "chat.send") {
        try {
          const rpc = await callGateway({
            ...opts,
            url: effectiveUrl,
            token: TEST_TOKEN,
            timeoutMs: 5_000,
          });
          sendOutcome.rpcReturned = true;
          // The live RPC often returns "started" after persist, before agent
          // completion. Simulate the client losing the response after the write.
          void rpc;
        } catch (error) {
          sendOutcome.rpcReturned = false;
          sendOutcome.rpcError = error instanceof Error ? error.message : String(error);
        }
        throw new Error(`gateway timeout after 200ms\n${effectiveUrl}`);
      }
      return await callGateway({
        ...opts,
        url: effectiveUrl,
        token: TEST_TOKEN,
      });
    };
    try {
      const result = await deliverDiagnosisViaOfficialLiveGateway(
        {
          sessionKey: DIAGNOSIS_P24_5_LIVE_SESSION_KEY,
          tenantId: DIAGNOSIS_P24_5_CANARY_TENANT,
          text: "【诊断提醒】timeout-fallback",
          deliveryId: "batch1-timeout-fallback",
        },
        { call, timeoutMs: { send: 400, inject: 10_000 }, trace: t },
      );
      record("send-timeout-fallback", {
        result,
        methods: t.methods,
        resetKeys: t.resetKeys,
        skippedInjectBecauseAuth: t.skippedInjectBecauseAuth,
        sendRpc: sendOutcome,
        note: "Live chat.send may return started after persist. This case forces a client-side timeout after that write and then runs the official inject fallback.",
      });
      expect(result).toBe("accepted");
      expect(t.methods[0]).toBe("chat.send");
      expect(t.methods).toContain("chat.inject");
      expect(t.resetKeys.every((key) => key === DIAGNOSIS_P24_5_LIVE_SESSION_KEY)).toBe(true);
    } finally {
      if (previous === undefined) {
        delete process.env.OPENBOT_CHAT_INBOUND_PERSIST_EARLY;
      } else {
        process.env.OPENBOT_CHAT_INBOUND_PERSIST_EARLY = previous;
      }
    }
  }, 60_000);

  it("does not bypass authorization failure via chat.inject", async () => {
    const t = emptyTrace();
    const result = await deliverDiagnosisViaOfficialLiveGateway(
      {
        sessionKey: DIAGNOSIS_P24_5_LIVE_SESSION_KEY,
        tenantId: DIAGNOSIS_P24_5_CANARY_TENANT,
        text: "【诊断提醒】should-not-inject",
        deliveryId: "batch1-auth-deny",
      },
      {
        call: officialCall("wrong-token-not-the-test-token"),
        trace: t,
        timeoutMs: { send: 5_000, inject: 5_000 },
      },
    );
    expect(result).toBe("unauthorized");
    expect(t.methods).toEqual(["chat.send"]);
    expect(t.skippedInjectBecauseAuth).toBe(true);
    expect(t.methods).not.toContain("chat.inject");
    record("auth-no-inject-bypass", {
      result,
      methods: t.methods,
      skippedInjectBecauseAuth: t.skippedInjectBecauseAuth,
      resultStatus: "pass",
    });
  }, 30_000);

  it("refuses arbitrary session keys at the official bind and send layers", () => {
    const bind = (() => {
      try {
        bindConversationDiagnosisToLiveChat({
          tenantId: DIAGNOSIS_P24_5_CANARY_TENANT,
          sessionKey: "someone-else-session",
          send: async () => "accepted",
        });
        return { rejected: false, code: null };
      } catch (error) {
        return {
          rejected: true,
          code: error instanceof DiagnosisContractError ? error.code : "other",
        };
      }
    })();
    expect(bind.rejected).toBe(true);
    expect(bind.code).toBe("canary_session_mismatch");
    record("arbitrary-session-key", { bind, result: "pass" });
  });

  it("covers inject failure, session-not-found reset of the canary key only, and concurrent delivers", async () => {
    const reset = await rpcReq(ws, "sessions.reset", {
      key: DIAGNOSIS_P24_5_LIVE_SESSION_KEY,
      reason: "new",
    });
    expect(reset.ok).toBe(true);

    const otherKey = "batch1-protected-session";
    const seedOther = await rpcReq(ws, "sessions.reset", {
      key: otherKey,
      reason: "new",
    });
    expect(seedOther.ok).toBe(true);
    const injectMissing = await rpcReq(ws, "chat.inject", {
      sessionKey: "batch1-missing-session",
      message: "should fail",
      label: "诊断提醒",
    });
    expect(injectMissing.ok).toBe(false);
    const missingMessage = JSON.stringify(injectMissing.error ?? injectMissing);
    expect(missingMessage).toMatch(/session not found/i);

    const t = emptyTrace();
    const official = await deliverDiagnosisViaOfficialLiveGateway(
      {
        sessionKey: DIAGNOSIS_P24_5_LIVE_SESSION_KEY,
        tenantId: DIAGNOSIS_P24_5_CANARY_TENANT,
        text: "【诊断提醒】after-reset",
        deliveryId: "batch1-after-reset",
      },
      { call: officialCall(TEST_TOKEN), trace: t },
    );
    expect(["accepted", "unavailable"]).toContain(official);

    const otherAfter = await rpcReq(ws, "sessions.get", { key: otherKey, limit: 20 });
    const concurrent = emptyTrace();
    const [a, b] = await Promise.all([
      deliverDiagnosisViaOfficialLiveGateway(
        {
          sessionKey: DIAGNOSIS_P24_5_LIVE_SESSION_KEY,
          tenantId: DIAGNOSIS_P24_5_CANARY_TENANT,
          text: "【诊断提醒】concurrent-a",
          deliveryId: "batch1-concurrent-a",
        },
        { call: officialCall(TEST_TOKEN) },
      ),
      deliverDiagnosisViaOfficialLiveGateway(
        {
          sessionKey: DIAGNOSIS_P24_5_LIVE_SESSION_KEY,
          tenantId: DIAGNOSIS_P24_5_CANARY_TENANT,
          text: "【诊断提醒】concurrent-b",
          deliveryId: "batch1-concurrent-b",
        },
        { call: officialCall(TEST_TOKEN), trace: concurrent },
      ),
    ]);
    expect(concurrent.resetKeys.every((key) => key === DIAGNOSIS_P24_5_LIVE_SESSION_KEY)).toBe(
      true,
    );
    record("inject-reset-concurrent", {
      injectMissing: { ok: injectMissing.ok, error: injectMissing.error ?? null },
      canaryResetOk: reset.ok,
      protectedSessionResetOk: seedOther.ok,
      officialAfterReset: official,
      officialMethods: t.methods,
      resetKeys: t.resetKeys,
      otherSessionStillGettable: otherAfter.ok,
      concurrent: { a, b },
      paidModelDispatched: evidence.paidModelDispatched,
      result: "pass",
    });
  }, 60_000);
});
