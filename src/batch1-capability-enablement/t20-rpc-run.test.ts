import { execFileSync } from "node:child_process";
/**
 * Clean Batch 1 t20 RPC run. Independent evidence directory, bound SHA and
 * runId. Distinguishes preparation, official-bridge-under-test, and
 * verification. Message diffs include roles and content fingerprints; two
 * messages are not treated as a duplicate write by themselves.
 *
 * Mocks: only getReplyFromConfig, to forbid paid model calls. Official
 * bind, send, inject, reset, and session APIs are real. This is not a
 * complete model-business verification.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  deliverDiagnosisViaOfficialLiveGateway,
  type OfficialDiagnosisGatewayCall,
  type OfficialLiveSendTrace,
} from "../diagnosis/official-live-send.js";
import {
  DIAGNOSIS_P24_5_CANARY_TENANT,
  DIAGNOSIS_P24_5_LIVE_SESSION_KEY,
} from "../diagnosis/production-cutover.js";
import { DiagnosisContractError } from "../diagnosis/types.js";
import { callGateway } from "../gateway/call.js";
import {
  connectOk,
  getReplyFromConfig,
  installGatewayTestHooks,
  rpcReq,
  startServerWithClient,
  testState,
} from "../gateway/test-helpers.js";
import { readBoundSha } from "./bound-sha.js";
import {
  observationFromCallGatewayError,
  observationFromCallGatewayPayload,
} from "./gateway-call-observation.js";
import { deriveCaseHonesty } from "./rpc-summary.js";

installGatewayTestHooks({ scope: "suite" });

const RUN_ID = `t20-rpc-${Date.now()}`;
const EVIDENCE_DIR = process.env.OPENBOT_T20_RPC_EVIDENCE_DIR ?? "/tmp/openbot-t20-rpc-evidence";
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
] as const;

const inheritedSnapshot: Record<string, string | null> = {};
const rpcLogPath = path.join(EVIDENCE_DIR, "rpc.jsonl");

type MessageFingerprint = {
  index: number;
  role: string | null;
  fingerprint: string;
  bytes: number;
};

type RpcPhase = "preparation" | "under_test" | "verification";

function summarizeParams(params: Record<string, unknown>): Record<string, unknown> {
  const summary: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") {
      summary[key] = value.length > 180 ? `${value.slice(0, 180)}…` : value;
    } else if (value == null || typeof value === "number" || typeof value === "boolean") {
      summary[key] = value;
    } else {
      summary[key] = Array.isArray(value) ? `array(${value.length})` : typeof value;
    }
  }
  return summary;
}

function messageFingerprints(messages: unknown[]): MessageFingerprint[] {
  return messages.map((message, index) => {
    const row = message && typeof message === "object" ? (message as Record<string, unknown>) : {};
    const nested =
      row.message && typeof row.message === "object"
        ? (row.message as Record<string, unknown>)
        : {};
    const role =
      (typeof row.role === "string" ? row.role : null) ??
      (typeof nested.role === "string" ? nested.role : null);
    const raw = JSON.stringify(message ?? null);
    return {
      index,
      role,
      fingerprint: createHash("sha256").update(raw).digest("hex").slice(0, 16),
      bytes: Buffer.byteLength(raw, "utf8"),
    };
  });
}

function messageDiff(before: MessageFingerprint[], after: MessageFingerprint[]) {
  const beforeSet = new Set(before.map((item) => `${item.role}:${item.fingerprint}`));
  const added = after.filter((item) => !beforeSet.has(`${item.role}:${item.fingerprint}`));
  return {
    beforeCount: before.length,
    afterCount: after.length,
    added,
    note: "Two messages do not automatically mean a duplicate write; added rows are labeled by role and content fingerprint.",
  };
}

function appendRpc(entry: Record<string, unknown>): void {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.appendFileSync(rpcLogPath, `${JSON.stringify(entry)}\n`, "utf8");
}

function writeSummary(value: unknown): void {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(path.join(EVIDENCE_DIR, "summary.json"), `${JSON.stringify(value, null, 2)}\n`);
}

function emptyTrace(): OfficialLiveSendTrace {
  return { methods: [], resetKeys: [], skippedInjectBecauseAuth: false };
}

describe("t20 clean isolated RPC run", () => {
  let port = 0;
  let server: Awaited<ReturnType<typeof startServerWithClient>>["server"];
  let ws: Awaited<ReturnType<typeof startServerWithClient>>["ws"];
  let effectiveUrl = "";
  const cases: Record<string, unknown> = {};
  let paidModelDispatched = false;

  beforeAll(async () => {
    fs.rmSync(EVIDENCE_DIR, { recursive: true, force: true });
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    for (const key of INHERITED_ENV_KEYS) {
      inheritedSnapshot[key] = process.env[key] ?? null;
      delete process.env[key];
    }
    testState.gatewayBind = "loopback";
    testState.gatewayAuth = { mode: "token", token: TEST_TOKEN };
    getReplyFromConfig.mockImplementation(async () => {
      if (process.env.DEEPSEEK_API_KEY || process.env.OPENBOT_P4_LIVE_API_KEY) {
        paidModelDispatched = true;
        throw new Error("paid model dispatch is forbidden in isolated t20 RPC tests");
      }
      return undefined;
    });
    const started = await startServerWithClient(TEST_TOKEN, { controlUiEnabled: false });
    server = started.server;
    ws = started.ws;
    port = started.port;
    effectiveUrl = `ws://127.0.0.1:${port}`;
    const address = (
      server as { address?: () => { address?: string; port?: number } | string }
    ).address?.();
    const bindAddress = address && typeof address === "object" ? address.address : "127.0.0.1";
    if (bindAddress !== "127.0.0.1" && bindAddress !== "::1") {
      await server.close();
      throw new Error(`gateway bind is not loopback: ${String(bindAddress)}`);
    }
    await connectOk(ws);
    let ssOutput = "";
    try {
      ssOutput = execFileSync("ss", ["-ltnp"], { encoding: "utf8" });
    } catch (error) {
      ssOutput = error instanceof Error ? error.message : String(error);
    }
    writeSummary({
      runId: RUN_ID,
      boundSha: readBoundSha(),
      startedAt: new Date().toISOString(),
      zone: "Asia/Shanghai",
      realImplementations: [
        "startServerWithClient official loopback gateway",
        "chat.send / chat.inject / chat.history / sessions.get / sessions.reset",
        "deliverDiagnosisViaOfficialLiveGateway official bind and send path",
      ],
      replaced: [
        "getReplyFromConfig official test stub (returns undefined; forbids paid-model dispatch)",
      ],
      notCompleteModelBusinessVerification: true,
      isolation: {
        bindAddress,
        port,
        effectiveUrl,
        listenProof: ssOutput
          .split("\n")
          .filter((line) => line.includes(`:${port}`) || line.includes(`pid=${process.pid}`))
          .slice(0, 20),
      },
    });
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
    const current = fs.existsSync(path.join(EVIDENCE_DIR, "summary.json"))
      ? (JSON.parse(fs.readFileSync(path.join(EVIDENCE_DIR, "summary.json"), "utf8")) as Record<
          string,
          unknown
        >)
      : {};
    writeSummary({
      ...current,
      finishedAt: new Date().toISOString(),
      paidModelDispatched,
      cases,
    });
  });

  async function historyFingerprints(sessionKey: string): Promise<MessageFingerprint[]> {
    const response = await rpcReq(ws, "chat.history", { sessionKey, limit: 50 });
    const messages = (response.payload as { messages?: unknown[] } | undefined)?.messages ?? [];
    return messageFingerprints(messages);
  }

  async function traced(
    phase: RpcPhase,
    caseName: string,
    method: string,
    params: Record<string, unknown>,
    extra?: { timeoutMs?: number },
  ) {
    const before =
      typeof params.sessionKey === "string" ? await historyFingerprints(params.sessionKey) : [];
    const startedAt = new Date().toISOString();
    const response = extra?.timeoutMs
      ? await callGateway({
          method,
          params,
          url: effectiveUrl,
          token: TEST_TOKEN,
          timeoutMs: extra.timeoutMs,
        })
      : await rpcReq(ws, method, params);
    const payload = response.payload as Record<string, unknown> | undefined;
    const afterKey =
      (typeof params.sessionKey === "string" && params.sessionKey) ||
      (typeof params.key === "string" && params.key) ||
      null;
    const after = afterKey ? await historyFingerprints(afterKey) : [];
    const entry = {
      at: startedAt,
      runId: RUN_ID,
      boundSha: readBoundSha(),
      phase,
      caseName,
      method,
      params: summarizeParams(params),
      ok: response.ok,
      error: response.error ?? null,
      returnSummary: {
        runId: payload?.runId ?? null,
        status: payload?.status ?? null,
        messageCount: Array.isArray(payload?.messages) ? payload.messages.length : null,
      },
      messages: {
        before,
        after,
        diff: messageDiff(before, after),
      },
    };
    appendRpc(entry);
    return { response, entry };
  }

  function officialCall(token: string, caseName: string): OfficialDiagnosisGatewayCall {
    return async (opts) => {
      const params = (opts.params ?? {}) as Record<string, unknown>;
      const before =
        typeof params.sessionKey === "string" ? await historyFingerprints(params.sessionKey) : [];
      const startedAt = new Date().toISOString();
      let observation = observationFromCallGatewayError("not started");
      try {
        const result = await callGateway({
          ...opts,
          url: effectiveUrl,
          token,
          timeoutMs: 8_000,
        });
        observation = observationFromCallGatewayPayload(result);
        if (!observation.ok) {
          throw new Error(observation.error ?? "gateway call returned ok=false");
        }
        return result;
      } catch (caught) {
        observation = observationFromCallGatewayError(caught);
        throw caught;
      } finally {
        const afterKey = typeof params.sessionKey === "string" ? params.sessionKey : null;
        const after = afterKey ? await historyFingerprints(afterKey) : [];
        appendRpc({
          at: startedAt,
          runId: RUN_ID,
          boundSha: readBoundSha(),
          phase: "under_test",
          caseName,
          method: opts.method,
          params: summarizeParams(params),
          ok: observation.ok,
          error: observation.error,
          returnSummary: { runId: observation.runId, status: observation.status },
          messages: { before, after, diff: messageDiff(before, after) },
        });
      }
    };
  }

  it("send succeeds and a duplicate idempotency key reuses the same run", async () => {
    const first = await traced("under_test", "duplicate-delivery", "chat.send", {
      sessionKey: "main",
      message: "t20 clean send",
      idempotencyKey: "t20-idem-send-1",
      deliver: false,
    });
    const duplicate = await traced("under_test", "duplicate-delivery", "chat.send", {
      sessionKey: "main",
      message: "t20 clean send",
      idempotencyKey: "t20-idem-send-1",
      deliver: false,
    });
    expect(first.response.ok).toBe(true);
    expect(duplicate.response.ok).toBe(true);
    const firstRun = (first.response.payload as { runId?: string } | undefined)?.runId;
    const dupRun = (duplicate.response.payload as { runId?: string } | undefined)?.runId;
    expect(dupRun).toBe(firstRun);
    const addedUser = first.entry.messages.diff.added.filter((row) => row.role === "user");
    cases["duplicate-delivery"] = {
      firstRunId: firstRun ?? null,
      duplicateRunId: dupRun ?? null,
      sameRunId: firstRun === dupRun,
      addedUserFingerprints: addedUser,
      result: firstRun && firstRun === dupRun ? "pass" : "fail",
    };
  }, 60_000);

  it("falls back to official inject after a written send times out", async () => {
    const previous = process.env.OPENBOT_CHAT_INBOUND_PERSIST_EARLY;
    process.env.OPENBOT_CHAT_INBOUND_PERSIST_EARLY = "1";
    const t = emptyTrace();
    const before = await historyFingerprints(DIAGNOSIS_P24_5_LIVE_SESSION_KEY);
    appendRpc({
      at: new Date().toISOString(),
      runId: RUN_ID,
      phase: "preparation",
      caseName: "timeout-fallback",
      method: "chat.history",
      params: { sessionKey: DIAGNOSIS_P24_5_LIVE_SESSION_KEY },
      ok: true,
      error: null,
      messages: { before, after: before, diff: messageDiff(before, before) },
    });
    try {
      const outcome = await deliverDiagnosisViaOfficialLiveGateway(
        {
          sessionKey: DIAGNOSIS_P24_5_LIVE_SESSION_KEY,
          tenantId: DIAGNOSIS_P24_5_CANARY_TENANT,
          text: "【诊断提醒】t20 timeout fallback",
          deliveryId: "t20-timeout-fallback",
        },
        {
          call: async (opts) => {
            if (opts.method === "chat.send") {
              const params = (opts.params ?? {}) as Record<string, unknown>;
              const before =
                typeof params.sessionKey === "string"
                  ? await historyFingerprints(params.sessionKey)
                  : [];
              let rpcError: string | null = null;
              let rpcReturned = false;
              try {
                const rpc = await callGateway({
                  ...opts,
                  url: effectiveUrl,
                  token: TEST_TOKEN,
                  timeoutMs: 5_000,
                });
                rpcReturned = true;
                void rpc;
              } catch (error) {
                rpcError = error instanceof Error ? error.message : String(error);
              }
              const after =
                typeof params.sessionKey === "string"
                  ? await historyFingerprints(params.sessionKey)
                  : [];
              appendRpc({
                at: new Date().toISOString(),
                runId: RUN_ID,
                phase: "under_test",
                caseName: "timeout-fallback",
                method: "chat.send",
                params: summarizeParams(params),
                ok: false,
                error: "gateway timeout after 200ms (simulated after persist)",
                returnSummary: { rpcReturned, rpcError, clientTimeoutForced: true },
                messages: { before, after, diff: messageDiff(before, after) },
              });
              throw new Error(`gateway timeout after 200ms\n${effectiveUrl}`);
            }
            return officialCall(TEST_TOKEN, "timeout-fallback")(opts);
          },
          trace: t,
          timeoutMs: { send: 400, inject: 10_000 },
        },
      );
      const after = await historyFingerprints(DIAGNOSIS_P24_5_LIVE_SESSION_KEY);
      appendRpc({
        at: new Date().toISOString(),
        runId: RUN_ID,
        phase: "verification",
        caseName: "timeout-fallback",
        method: "chat.history",
        params: { sessionKey: DIAGNOSIS_P24_5_LIVE_SESSION_KEY },
        ok: true,
        error: null,
        messages: { before, after, diff: messageDiff(before, after) },
      });
      expect(t.methods).toContain("chat.inject");
      const honesty = deriveCaseHonesty(
        {
          caseName: "timeout-fallback",
          requirePersistence: true,
          officialOutcome: outcome,
          expectedFailures: [{ method: "chat.send", phase: "under_test" }],
        },
        [
          {
            phase: "verification",
            caseName: "timeout-fallback",
            method: "chat.history",
            ok: true,
            messages: { diff: messageDiff(before, after) },
          },
        ],
      );
      cases["timeout-fallback"] = {
        outcome,
        methods: t.methods,
        messageDiff: messageDiff(before, after),
        honesty,
        result: honesty.result,
      };
    } finally {
      if (previous == null) {
        delete process.env.OPENBOT_CHAT_INBOUND_PERSIST_EARLY;
      } else {
        process.env.OPENBOT_CHAT_INBOUND_PERSIST_EARLY = previous;
      }
    }
  }, 60_000);

  it("does not bypass authorization failure via chat.inject", async () => {
    const t = emptyTrace();
    let code: string | null = null;
    try {
      await deliverDiagnosisViaOfficialLiveGateway(
        {
          sessionKey: DIAGNOSIS_P24_5_LIVE_SESSION_KEY,
          tenantId: DIAGNOSIS_P24_5_CANARY_TENANT,
          text: "【诊断提醒】t20 auth deny",
          deliveryId: "t20-auth-deny",
        },
        {
          call: officialCall("wrong-token", "auth-deny"),
          trace: t,
          timeoutMs: { send: 4_000, inject: 4_000 },
        },
      );
    } catch (error) {
      code =
        error instanceof DiagnosisContractError
          ? error.code
          : error instanceof Error
            ? error.message
            : String(error);
    }
    expect(t.skippedInjectBecauseAuth).toBe(true);
    expect(t.methods.includes("chat.inject")).toBe(false);
    cases["auth-deny"] = {
      code,
      methods: t.methods,
      skippedInjectBecauseAuth: t.skippedInjectBecauseAuth,
      result: t.skippedInjectBecauseAuth && !t.methods.includes("chat.inject") ? "pass" : "fail",
    };
  }, 60_000);

  it("covers session-not-found, canary reset boundary, and concurrent official delivers", async () => {
    const missing = await traced("under_test", "reset-boundary", "chat.inject", {
      sessionKey: "t20-missing-session",
      message: "should fail",
    });
    const canaryBefore = await historyFingerprints(DIAGNOSIS_P24_5_LIVE_SESSION_KEY);
    const reset = await traced("under_test", "reset-boundary", "sessions.reset", {
      key: DIAGNOSIS_P24_5_LIVE_SESSION_KEY,
    });
    const otherKey = "agent:other:t20";
    await traced("preparation", "reset-boundary", "chat.send", {
      sessionKey: otherKey,
      message: "seed other session",
      idempotencyKey: "t20-seed-other",
      deliver: false,
    });
    const otherReset = await traced("under_test", "reset-boundary", "sessions.reset", {
      key: otherKey,
    });
    const otherGet = await traced("verification", "reset-boundary", "sessions.get", {
      key: otherKey,
    });
    const tA = emptyTrace();
    const tB = emptyTrace();
    const [a, b] = await Promise.all([
      deliverDiagnosisViaOfficialLiveGateway(
        {
          sessionKey: DIAGNOSIS_P24_5_LIVE_SESSION_KEY,
          tenantId: DIAGNOSIS_P24_5_CANARY_TENANT,
          text: "【诊断提醒】t20 concurrent a",
          deliveryId: "t20-concurrent-a",
        },
        {
          call: officialCall(TEST_TOKEN, "concurrency-a"),
          trace: tA,
          timeoutMs: { send: 8_000, inject: 8_000 },
        },
      ),
      deliverDiagnosisViaOfficialLiveGateway(
        {
          sessionKey: DIAGNOSIS_P24_5_LIVE_SESSION_KEY,
          tenantId: DIAGNOSIS_P24_5_CANARY_TENANT,
          text: "【诊断提醒】t20 concurrent b",
          deliveryId: "t20-concurrent-b",
        },
        {
          call: officialCall(TEST_TOKEN, "concurrency-b"),
          trace: tB,
          timeoutMs: { send: 8_000, inject: 8_000 },
        },
      ),
    ]);
    const canaryAfter = await historyFingerprints(DIAGNOSIS_P24_5_LIVE_SESSION_KEY);
    cases["reset-boundary"] = {
      injectMissingOk: missing.response.ok,
      injectMissingError: missing.response.error ?? null,
      canaryResetOk: reset.response.ok,
      otherResetOk: otherReset.response.ok,
      otherGetOk: otherGet.response.ok,
      canaryDiff: messageDiff(canaryBefore, canaryAfter),
    };
    const concurrencyHonesty = deriveCaseHonesty(
      {
        caseName: "concurrency",
        requirePersistence: true,
        officialOutcome: a === "accepted" && b === "accepted" ? "accepted" : null,
      },
      [
        {
          phase: "verification",
          caseName: "concurrency",
          method: "chat.history",
          ok: true,
          messages: { diff: messageDiff(canaryBefore, canaryAfter) },
        },
      ],
    );
    cases.concurrency = {
      a,
      b,
      methodsA: tA.methods,
      methodsB: tB.methods,
      honesty: concurrencyHonesty,
      result: concurrencyHonesty.result,
    };
    expect(otherGet.response.ok).toBe(true);
  }, 60_000);

  it("refuses an arbitrary session key and a cross-tenant official delivery", async () => {
    const tSession = emptyTrace();
    let sessionCode: string | null = null;
    try {
      await deliverDiagnosisViaOfficialLiveGateway(
        {
          sessionKey: "arbitrary:session:t20",
          tenantId: DIAGNOSIS_P24_5_CANARY_TENANT,
          text: "【诊断提醒】arbitrary",
          deliveryId: "t20-arbitrary-session",
        },
        {
          call: officialCall(TEST_TOKEN, "arbitrary-session"),
          trace: tSession,
          timeoutMs: { send: 2_000, inject: 2_000 },
        },
      );
    } catch (error) {
      sessionCode = error instanceof DiagnosisContractError ? error.code : String(error);
    }
    const tTenant = emptyTrace();
    let tenantCode: string | null = null;
    try {
      await deliverDiagnosisViaOfficialLiveGateway(
        {
          sessionKey: DIAGNOSIS_P24_5_LIVE_SESSION_KEY,
          tenantId: "tenant-foreign",
          text: "【诊断提醒】cross-tenant",
          deliveryId: "t20-cross-tenant",
        },
        {
          call: officialCall(TEST_TOKEN, "cross-tenant"),
          trace: tTenant,
          timeoutMs: { send: 2_000, inject: 2_000 },
        },
      );
    } catch (error) {
      tenantCode = error instanceof DiagnosisContractError ? error.code : String(error);
    }
    expect(sessionCode).toBe("canary_session_mismatch");
    expect(tenantCode).toBe("canary_tenant_mismatch");
    expect(tSession.methods).toEqual([]);
    expect(tTenant.methods).toEqual([]);
    cases["boundary-deny"] = {
      sessionCode,
      tenantCode,
      result:
        sessionCode === "canary_session_mismatch" && tenantCode === "canary_tenant_mismatch"
          ? "pass"
          : "fail",
    };
  }, 60_000);
});
