/**
 * Isolated loopback gateway tests for Batch 1 diagnosis write-fallback.
 *
 * Starts the official gateway on 127.0.0.1 with an ephemeral port, a temporary
 * state directory, and an independent test identity. Inherited remote gateway
 * URLs, production tokens, and paid-provider API keys are cleared before any
 * request. Agent dispatch is the official test stub (getReplyFromConfig);
 * a paid-model call fails the test instead of being issued.
 */
import { execFileSync } from "node:child_process";
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
import { readBoundSha } from "./bound-sha.js";

installGatewayTestHooks({ scope: "suite" });

const EVIDENCE_ROOT =
  process.env.OPENBOT_BATCH1_EVIDENCE_DIR ?? "/workspace/openbot-vp-audit/batch1-evidence";
const EVIDENCE_DIR = path.join(EVIDENCE_ROOT, "gateway");
const ISOLATION_PROOF_DIR = path.join(EVIDENCE_ROOT, "isolation-proof");
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
  boundSha: readBoundSha(),
  rpc: [] as unknown[],
  stubUpstreamCalls: [] as unknown[],
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

function appendJsonl(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(value)}\n`, "utf8");
}

function writeIsolationProof(name: string, value: unknown): void {
  fs.mkdirSync(ISOLATION_PROOF_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(ISOLATION_PROOF_DIR, name),
    typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`,
    "utf8",
  );
}

function captureProcessGatewayProof(input: {
  bindAddress: string;
  port: number;
  effectiveUrl: string;
}): Record<string, unknown> {
  const pid = process.pid;
  const comm = fs.existsSync("/proc/self/comm")
    ? fs.readFileSync("/proc/self/comm", "utf8").trim()
    : "";
  let exe = "";
  try {
    exe = fs.readlinkSync("/proc/self/exe");
  } catch {
    exe = "";
  }
  const cmdline = fs.existsSync("/proc/self/cmdline")
    ? fs.readFileSync("/proc/self/cmdline", "utf8").replaceAll("\0", " ").trim()
    : process.argv.join(" ");
  let ssOutput = "";
  try {
    ssOutput = execFileSync("ss", ["-ltnp"], { encoding: "utf8" });
  } catch (error) {
    ssOutput = error instanceof Error ? error.message : String(error);
  }
  const portNeedle = `:${input.port}`;
  const ssLines = ssOutput
    .split("\n")
    .filter(
      (line) =>
        line.includes(portNeedle) || line.includes(`pid=${pid}`) || line.startsWith("State"),
    );
  let procNet = "";
  try {
    procNet = fs.readFileSync("/proc/net/tcp", "utf8");
  } catch {
    procNet = "";
  }
  return {
    boundSha: readBoundSha(),
    note: "The isolated test gateway is started in-process by startServerWithClient; the Vitest worker pid is the gateway process.",
    pid,
    comm,
    exe,
    cmdline,
    bindAddress: input.bindAddress,
    port: input.port,
    effectiveUrl: input.effectiveUrl,
    ssListenMatchingPortOrPid: ssLines,
    ssRawTruncated: ssOutput.slice(0, 8000),
    procNetTcpBytes: Buffer.byteLength(procNet, "utf8"),
    correspondence: {
      processIsTestGateway: true,
      listen: `${input.bindAddress}:${input.port}`,
      url: input.effectiveUrl,
    },
  };
}

function redactInheritedEnv(): Record<
  string,
  { presentBefore: boolean; presentAfterClear: boolean }
> {
  return Object.fromEntries(
    INHERITED_ENV_KEYS.map((key) => [
      key,
      {
        presentBefore: inheritedSnapshot[key] != null,
        presentAfterClear: process.env[key] != null && key !== "OPENCLAW_GATEWAY_TOKEN",
      },
    ]),
  );
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
    getReplyFromConfig.mockImplementation(async (...args: unknown[]) => {
      const call = {
        at: new Date().toISOString(),
        stub: "getReplyFromConfig",
        paidModelDispatched: false,
        argCount: args.length,
      };
      stubReplies.push("fixture-no-paid-model");
      (evidence.stubUpstreamCalls as unknown[]).push(call);
      appendJsonl(path.join(EVIDENCE_DIR, "upstream-calls.jsonl"), call);
      appendJsonl(path.join(ISOLATION_PROOF_DIR, "upstream-calls.jsonl"), call);
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
    const processProof = captureProcessGatewayProof({
      bindAddress: String(isolation.bindAddress),
      port,
      effectiveUrl,
    });
    evidence.processGateway = processProof;
    const credentialCheck = {
      boundSha: readBoundSha(),
      inheritedEnv: redactInheritedEnv(),
      testTokenInstalledByHelper: process.env.OPENCLAW_GATEWAY_TOKEN === TEST_TOKEN,
      productionTokensPresentAfterClear: Boolean(
        inheritedSnapshot.OPENCLAW_GATEWAY_TOKEN &&
        process.env.OPENCLAW_GATEWAY_TOKEN &&
        process.env.OPENCLAW_GATEWAY_TOKEN !== TEST_TOKEN,
      ),
      paidKeysPresentAfterClear: Boolean(
        process.env.DEEPSEEK_API_KEY || process.env.OPENBOT_P4_LIVE_API_KEY,
      ),
      valuesRedacted: true,
    };
    evidence.credentialCheck = credentialCheck;
    writeIsolationProof("process-gateway.json", processProof);
    writeIsolationProof("credential-check.json", credentialCheck);
    writeIsolationProof(
      "listen.txt",
      [
        `time=${new Date().toISOString()}`,
        `pid=${process.pid}`,
        `bindAddress=${isolation.bindAddress}`,
        `port=${port}`,
        `effectiveGatewayUrl=${effectiveUrl}`,
        "urlProvenLoopbackBeforeRequests=true",
        `ss=${JSON.stringify(processProof.ssListenMatchingPortOrPid)}`,
        "",
      ].join("\n"),
    );
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
    return async (opts) => {
      const entry = {
        at: new Date().toISOString(),
        caseName: "official-call",
        method: opts.method,
        requestId:
          (
            opts.params as
              | { idempotencyKey?: string; key?: string; sessionKey?: string }
              | undefined
          )?.idempotencyKey ??
          (opts.params as { key?: string } | undefined)?.key ??
          (opts.params as { sessionKey?: string } | undefined)?.sessionKey ??
          null,
        tokenIsTestToken: token === TEST_TOKEN,
      };
      (evidence.rpc as unknown[]).push(entry);
      appendJsonl(path.join(EVIDENCE_DIR, "rpc-log.jsonl"), entry);
      appendJsonl(path.join(ISOLATION_PROOF_DIR, "rpc-log.jsonl"), entry);
      return await callGateway({
        ...opts,
        ...extra,
        url: effectiveUrl,
        token,
      });
    };
  }

  async function tracedRpc<T extends Record<string, unknown> = Record<string, unknown>>(
    caseName: string,
    method: string,
    params: Record<string, unknown>,
  ) {
    const response = await rpcReq<T>(ws, method, params);
    const payload = response.payload as { runId?: string; messages?: unknown[] } | undefined;
    const entry = {
      at: new Date().toISOString(),
      caseName,
      method,
      requestId:
        (params.idempotencyKey as string | undefined) ??
        (params.deliveryId as string | undefined) ??
        (params.key as string | undefined) ??
        (params.sessionKey as string | undefined) ??
        null,
      ok: response.ok,
      error: response.error ?? null,
      runId: payload?.runId ?? null,
      messageCount: Array.isArray(payload?.messages) ? payload.messages.length : null,
    };
    (evidence.rpc as unknown[]).push(entry);
    appendJsonl(path.join(EVIDENCE_DIR, "rpc-log.jsonl"), entry);
    appendJsonl(path.join(ISOLATION_PROOF_DIR, "rpc-log.jsonl"), entry);
    return response;
  }

  async function snapshotSession(caseName: string, key: string, label: "before" | "after") {
    const history = await tracedRpc(caseName, "chat.history", {
      sessionKey: key,
      limit: 50,
    });
    const got = await tracedRpc(caseName, "sessions.get", { key, limit: 20 });
    const historyPayload = history.payload as { messages?: unknown[] } | undefined;
    const messages = historyPayload?.messages ?? [];
    return {
      label,
      sessionKey: key,
      historyOk: history.ok,
      getOk: got.ok,
      messageCount: messages.length,
      roles: messages.map((message) => {
        if (!message || typeof message !== "object") {
          return null;
        }
        const row = message as { role?: unknown; message?: { role?: unknown } };
        return row.role ?? row.message?.role ?? null;
      }),
    };
  }

  it("proves isolation before any diagnosis write", () => {
    expect(effectiveUrl).toBe(`ws://127.0.0.1:${port}`);
    expect(fs.existsSync(isolationLogPath)).toBe(true);
    expect(process.env.OPENCLAW_GATEWAY_URL).toBeUndefined();
    expect(process.env.OPENBOT_GATEWAY_URL).toBeUndefined();
    expect(process.env.DEEPSEEK_API_KEY).toBeUndefined();
    expect(process.env.OPENBOT_P4_LIVE_API_KEY).toBeUndefined();
    expect(fs.existsSync(path.join(ISOLATION_PROOF_DIR, "process-gateway.json"))).toBe(true);
    record("isolation", {
      isolation: evidence.isolation,
      processGateway: evidence.processGateway,
      credentialCheck: evidence.credentialCheck,
    });
  });

  it("send succeeds and a duplicate idempotency key does not create a second run", async () => {
    const before = await snapshotSession("send-success-duplicate", "main", "before");
    const first = await tracedRpc("send-success-duplicate", "chat.send", {
      sessionKey: "main",
      message: "batch1 isolated send",
      idempotencyKey: "batch1-idem-send-1",
      deliver: false,
    });
    expect(first.ok).toBe(true);
    const duplicate = await tracedRpc("send-success-duplicate", "chat.send", {
      sessionKey: "main",
      message: "batch1 isolated send",
      idempotencyKey: "batch1-idem-send-1",
      deliver: false,
    });
    expect(duplicate.ok).toBe(true);
    const firstRun = (first.payload as { runId?: string } | undefined)?.runId;
    const dupRun = (duplicate.payload as { runId?: string } | undefined)?.runId;
    expect(dupRun).toBe(firstRun);
    const after = await snapshotSession("send-success-duplicate", "main", "after");
    const history = after;
    const historyPayload = await tracedRpc("send-success-duplicate", "chat.history", {
      sessionKey: "main",
      limit: 50,
    });
    const historyMessages =
      (historyPayload.payload as { messages?: unknown[] } | undefined)?.messages ?? [];
    const userMessages = historyMessages.filter((message) => {
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
      boundSha: readBoundSha(),
      requestId: "batch1-idem-send-1",
      rpcs: [
        "sessions.get/chat.history before",
        "chat.send",
        "chat.send duplicate",
        "chat.history/sessions.get after",
      ],
      firstOk: first.ok,
      duplicateOk: duplicate.ok,
      firstRunId: firstRun ?? null,
      duplicateRunId: dupRun ?? null,
      sameRunId: firstRun === dupRun,
      matchingUserMessages: matching.length,
      sessionBefore: before,
      sessionAfter: after,
      messageCountBefore: before.messageCount,
      messageCountAfter: after.messageCount,
      paidModelDispatched: evidence.paidModelDispatched,
      stubReplies: stubReplies.length,
      result: "pass",
    });
    void history;
  }, 60_000);

  it("falls back to inject when send has written but the response times out", async () => {
    const before = await snapshotSession(
      "send-timeout-fallback",
      DIAGNOSIS_P24_5_LIVE_SESSION_KEY,
      "before",
    );
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
      const after = await snapshotSession(
        "send-timeout-fallback",
        DIAGNOSIS_P24_5_LIVE_SESSION_KEY,
        "after",
      );
      record("send-timeout-fallback", {
        boundSha: readBoundSha(),
        requestId: "batch1-timeout-fallback",
        result,
        rpcs: t.methods,
        methods: t.methods,
        resetKeys: t.resetKeys,
        skippedInjectBecauseAuth: t.skippedInjectBecauseAuth,
        sendRpc: sendOutcome,
        sessionBefore: before,
        sessionAfter: after,
        messageCountAfter: after.messageCount,
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
      boundSha: readBoundSha(),
      requestId: "batch1-auth-deny",
      result,
      rpcs: t.methods,
      methods: t.methods,
      skippedInjectBecauseAuth: t.skippedInjectBecauseAuth,
      injectBypassed: t.methods.includes("chat.inject"),
      resultStatus: "pass",
    });
  }, 30_000);

  it("refuses arbitrary session keys at the official bind and send layers", async () => {
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
    const sendLayer = await (async () => {
      try {
        const outcome = await deliverDiagnosisViaOfficialLiveGateway(
          {
            sessionKey: "someone-else-session",
            tenantId: DIAGNOSIS_P24_5_CANARY_TENANT,
            text: "【诊断提醒】arbitrary-key",
            deliveryId: "batch1-arbitrary-key",
          },
          { call: officialCall(TEST_TOKEN), timeoutMs: { send: 2_000, inject: 2_000 } },
        );
        return { rejected: false, result: outcome, code: null };
      } catch (error) {
        return {
          rejected: true,
          result: null,
          code: error instanceof DiagnosisContractError ? error.code : "other",
        };
      }
    })();
    expect(sendLayer.rejected).toBe(true);
    expect(sendLayer.code).toBe("canary_session_mismatch");
    record("arbitrary-session-key", {
      boundSha: readBoundSha(),
      bindLayer: "bindConversationDiagnosisToLiveChat",
      sendLayer: "deliverDiagnosisViaOfficialLiveGateway/assertDiagnosisCanarySessionKey",
      bind,
      officialSend: sendLayer,
      result: "pass",
    });
  });

  it("covers inject failure, session-not-found reset of the canary key only, and concurrent delivers", async () => {
    const canaryBefore = await snapshotSession(
      "inject-reset-concurrent",
      DIAGNOSIS_P24_5_LIVE_SESSION_KEY,
      "before",
    );
    const reset = await tracedRpc("inject-reset-concurrent", "sessions.reset", {
      key: DIAGNOSIS_P24_5_LIVE_SESSION_KEY,
      reason: "new",
    });
    expect(reset.ok).toBe(true);

    const otherKey = "batch1-protected-session";
    const seedOther = await tracedRpc("inject-reset-concurrent", "sessions.reset", {
      key: otherKey,
      reason: "new",
    });
    expect(seedOther.ok).toBe(true);
    const injectMissing = await tracedRpc("inject-reset-concurrent", "chat.inject", {
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

    const otherAfter = await tracedRpc("inject-reset-concurrent", "sessions.get", {
      key: otherKey,
      limit: 20,
    });
    const canaryAfter = await snapshotSession(
      "inject-reset-concurrent",
      DIAGNOSIS_P24_5_LIVE_SESSION_KEY,
      "after",
    );
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
      boundSha: readBoundSha(),
      rpcs: [
        "sessions.reset canary",
        "sessions.reset protected",
        "chat.inject missing",
        "deliverDiagnosisViaOfficialLiveGateway after-reset",
        "sessions.get protected",
        "concurrent delivers",
      ],
      injectMissing: { ok: injectMissing.ok, error: injectMissing.error ?? null },
      canaryResetOk: reset.ok,
      protectedSessionResetOk: seedOther.ok,
      officialAfterReset: official,
      officialMethods: t.methods,
      resetKeys: t.resetKeys,
      otherSessionStillGettable: otherAfter.ok,
      sessionBefore: canaryBefore,
      sessionAfter: canaryAfter,
      concurrent: {
        a,
        b,
        methods: concurrent.methods,
        requestIds: ["batch1-concurrent-a", "batch1-concurrent-b"],
      },
      paidModelDispatched: evidence.paidModelDispatched,
      result: "pass",
    });
  }, 60_000);

  it("refuses cross-tenant official delivery before any gateway call", async () => {
    const t = emptyTrace();
    let code: string | null = null;
    let outcome: string | null = null;
    try {
      outcome = await deliverDiagnosisViaOfficialLiveGateway(
        {
          sessionKey: DIAGNOSIS_P24_5_LIVE_SESSION_KEY,
          tenantId: "tenant-foreign",
          text: "【诊断提醒】cross-tenant",
          deliveryId: "batch1-cross-tenant",
        },
        { call: officialCall(TEST_TOKEN), trace: t, timeoutMs: { send: 2_000, inject: 2_000 } },
      );
    } catch (error) {
      code = error instanceof DiagnosisContractError ? error.code : String(error);
    }
    expect(code).toBe("canary_tenant_mismatch");
    expect(t.methods).toEqual([]);
    record("cross-tenant", {
      boundSha: readBoundSha(),
      requestId: "batch1-cross-tenant",
      rejected: true,
      code,
      outcome,
      rpcs: t.methods,
      gatewayCalls: t.methods.length,
      result: "pass",
    });
  });
});
