import { execFileSync } from "node:child_process";
/**
 * t22 diagnosis-track isolated RPC run.
 *
 * Re-checks timeout-fallback persistence against the official callGateway
 * client, the test WebSocket client, and the operator session stores.
 * Regenerates summaries from RPC assertions (failed original calls cannot
 * be marked pass). Retests concurrency with per-call errors and message
 * counts. Exercises the official diagnosis bridge reset path against
 * agent:other:t20. Does not enable diagnosis delivery.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
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
import { loadOrCreateDeviceIdentity } from "../infra/device-identity.js";
import { readBoundSha } from "./bound-sha.js";
import { BATCH1_EVIDENCE_ROOT } from "./evidence-root.js";
import {
  observationFromCallGatewayError,
  observationFromCallGatewayPayload,
  messageCountFromHistoryPayload,
} from "./gateway-call-observation.js";
import { findSessionAcrossOperators, scanOperatorSessionStores } from "./operator-session-scan.js";
import {
  T20_DIAGNOSIS_RPC_SPECS,
  deriveCaseHonesty,
  deriveSummaryCases,
  recordsFromJsonl,
  withCombinedConcurrency,
  type RpcRecord,
} from "./rpc-summary.js";

installGatewayTestHooks({ scope: "suite" });

const RUN_ID = `t22-diagnosis-rpc-${Date.now()}`;
const EVIDENCE_DIR =
  process.env.OPENBOT_T22_DIAGNOSIS_EVIDENCE_DIR ??
  path.join(BATCH1_EVIDENCE_ROOT, "t22-diagnosis");
const TEST_TOKEN = "test-gateway-token-1234567890";
const OTHER_SESSION_KEY = "agent:other:t20";
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
const recordedRpcs: RpcRecord[] = [];

type MessageFingerprint = {
  index: number;
  role: string | null;
  fingerprint: string;
  bytes: number;
};

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

function appendRpc(entry: Record<string, unknown> & RpcRecord): void {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.appendFileSync(rpcLogPath, `${JSON.stringify(entry)}\n`, "utf8");
  recordedRpcs.push(entry);
}

function writeSummary(value: unknown): void {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(path.join(EVIDENCE_DIR, "summary.json"), `${JSON.stringify(value, null, 2)}\n`);
}

function writeJson(name: string, value: unknown): void {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(path.join(EVIDENCE_DIR, name), `${JSON.stringify(value, null, 2)}\n`);
}

function emptyTrace(): OfficialLiveSendTrace {
  return { methods: [], resetKeys: [], skippedInjectBecauseAuth: false };
}

function officialIdentityPath(): string {
  return path.join(process.env.OPENCLAW_STATE_DIR ?? "", "identity", "device.json");
}

function readDeviceId(filePath: string): string | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as { deviceId?: unknown };
    return typeof parsed.deviceId === "string" ? parsed.deviceId : null;
  } catch {
    return null;
  }
}

function listTestDeviceIdentities(
  stateDir: string,
): Array<{ path: string; deviceId: string | null }> {
  const root = path.join(stateDir, "test-device-identities");
  if (!fs.existsSync(root)) {
    return [];
  }
  return fs.readdirSync(root).map((name) => {
    const filePath = path.join(root, name);
    return { path: filePath, deviceId: readDeviceId(filePath) };
  });
}

describe("t22 diagnosis isolated RPC honesty run", () => {
  let port = 0;
  let server: Awaited<ReturnType<typeof startServerWithClient>>["server"];
  let ws: Awaited<ReturnType<typeof startServerWithClient>>["ws"];
  let effectiveUrl = "";
  let stateDir = "";
  const cases: Record<string, unknown> = {};
  let paidModelDispatched = false;

  beforeAll(async () => {
    fs.rmSync(rpcLogPath, { force: true });
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
        throw new Error("paid model dispatch is forbidden in isolated t22 RPC tests");
      }
      return undefined;
    });
    const started = await startServerWithClient(TEST_TOKEN, { controlUiEnabled: false });
    server = started.server;
    ws = started.ws;
    port = started.port;
    effectiveUrl = `ws://127.0.0.1:${port}`;
    stateDir = process.env.OPENCLAW_STATE_DIR ?? "";
    const address = (
      server as { address?: () => { address?: string; port?: number } | string }
    ).address?.();
    const bindAddress = address && typeof address === "object" ? address.address : "127.0.0.1";
    if (bindAddress !== "127.0.0.1" && bindAddress !== "::1") {
      await server.close();
      throw new Error(`gateway bind is not loopback: ${String(bindAddress)}`);
    }
    await connectOk(ws);
    // Ensure the official callGateway identity file exists so we can compare
    // its device id with the test WebSocket identity after the first official call.
    loadOrCreateDeviceIdentity(officialIdentityPath());
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
      diagnosisDeliveryEnabledByThisTrack: false,
      doesNotBlockTaskProgressPreRelease: true,
      realImplementations: [
        "startServerWithClient official loopback gateway",
        "chat.send / chat.inject / chat.history / sessions.get / sessions.reset",
        "deliverDiagnosisViaOfficialLiveGateway official bind and send path",
      ],
      replaced: [
        "getReplyFromConfig official test stub (returns undefined; forbids paid-model dispatch)",
      ],
      notCompleteModelBusinessVerification: true,
      identities: {
        officialIdentityPath: officialIdentityPath(),
        officialDeviceId: readDeviceId(officialIdentityPath()),
        testDeviceIdentities: listTestDeviceIdentities(stateDir),
      },
      isolation: {
        bindAddress,
        port,
        effectiveUrl,
        stateDir,
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
    const ran = new Set([...recordedRpcs.map((record) => record.caseName), ...Object.keys(cases)]);
    if (ran.has("concurrency-a") || ran.has("concurrency-b")) {
      ran.add("concurrency");
    }
    const honestyCases = deriveSummaryCases(
      withCombinedConcurrency(recordedRpcs),
      T20_DIAGNOSIS_RPC_SPECS.filter((spec) => ran.has(spec.caseName)).map((spec) => {
        if (
          spec.caseName === "timeout-fallback" ||
          spec.caseName === "concurrency" ||
          spec.caseName === "concurrency-a" ||
          spec.caseName === "concurrency-b"
        ) {
          const extras = cases[spec.caseName] as { outcome?: string } | undefined;
          return {
            ...spec,
            officialOutcome: typeof extras?.outcome === "string" ? extras.outcome : "accepted",
          };
        }
        return spec;
      }),
      Object.fromEntries(
        Object.entries(cases).map(([name, value]) => [
          name,
          value && typeof value === "object" ? (value as Record<string, unknown>) : { value },
        ]),
      ),
    );
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
      cases: honestyCases,
      diagnosisDeliveryEnabledByThisTrack: false,
      doesNotBlockTaskProgressPreRelease: true,
    });
  });

  async function wsHistory(
    sessionKey: string,
    socket: typeof ws = ws,
  ): Promise<MessageFingerprint[]> {
    const response = await rpcReq(socket, "chat.history", { sessionKey, limit: 50 });
    const messages = (response.payload as { messages?: unknown[] } | undefined)?.messages ?? [];
    return messageFingerprints(messages);
  }

  async function officialHistory(sessionKey: string): Promise<{
    ok: boolean;
    error: string | null;
    count: number;
    fingerprints: MessageFingerprint[];
  }> {
    try {
      const payload = await callGateway({
        method: "chat.history",
        params: { sessionKey, limit: 50 },
        url: effectiveUrl,
        token: TEST_TOKEN,
        timeoutMs: 8_000,
      });
      const count = messageCountFromHistoryPayload(payload);
      const messages =
        payload && typeof payload === "object"
          ? ((payload as { messages?: unknown[] }).messages ?? [])
          : [];
      return { ok: true, error: null, count, fingerprints: messageFingerprints(messages) };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        count: 0,
        fingerprints: [],
      };
    }
  }

  function storeSnapshot(sessionKey: string) {
    const scans = scanOperatorSessionStores(stateDir);
    return {
      operators: scans.map((scan) => ({
        operatorId: scan.operatorId,
        storePath: scan.storePath,
        keys: scan.keys,
      })),
      hits: findSessionAcrossOperators(scans, sessionKey),
    };
  }

  function officialCall(token: string, caseName: string): OfficialDiagnosisGatewayCall {
    return async (opts) => {
      const params = (opts.params ?? {}) as Record<string, unknown>;
      const sessionKey =
        (typeof params.sessionKey === "string" && params.sessionKey) ||
        (typeof params.key === "string" && params.key) ||
        null;
      const before = sessionKey
        ? await officialHistory(sessionKey)
        : { fingerprints: [] as MessageFingerprint[] };
      const startedAt = new Date().toISOString();
      let observation = observationFromCallGatewayError("not started");
      try {
        const result = await callGateway({
          ...opts,
          url: effectiveUrl,
          token,
          timeoutMs: opts.timeoutMs ?? 8_000,
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
        const after = sessionKey
          ? await officialHistory(sessionKey)
          : { fingerprints: [] as MessageFingerprint[] };
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
          returnSummary: {
            runId: observation.runId,
            status: observation.status,
            officialHistoryBefore: before.fingerprints.length,
            officialHistoryAfter: after.fingerprints.length,
          },
          messages: {
            before: before.fingerprints,
            after: after.fingerprints,
            diff: messageDiff(before.fingerprints, after.fingerprints),
          },
        });
      }
    };
  }

  it("re-evaluates an isolated synthetic RPC fixture without relabelling failed calls", () => {
    const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "t22-synthetic-rpc-fixture-"));
    const fixturePath = path.join(fixtureDir, "rpc.jsonl");
    const noGrowth = { diff: { beforeCount: 0, afterCount: 0, added: [] } };
    const fixture: RpcRecord[] = [
      {
        phase: "under_test",
        caseName: "timeout-fallback",
        method: "chat.send",
        ok: false,
        error: "FAKE unit timeout",
        messages: noGrowth,
      },
      {
        phase: "under_test",
        caseName: "timeout-fallback",
        method: "chat.inject",
        ok: true,
        error: null,
        messages: noGrowth,
      },
      ...["concurrency-a", "concurrency-b"].map(
        (caseName): RpcRecord => ({
          phase: "under_test",
          caseName,
          method: "chat.send",
          ok: false,
          error: "FAKE unit failure",
          messages: noGrowth,
        }),
      ),
      {
        phase: "under_test",
        caseName: "duplicate-delivery",
        method: "chat.send",
        ok: true,
        messages: {
          diff: {
            beforeCount: 0,
            afterCount: 1,
            added: [{ role: "assistant", fingerprint: "fake-unit-result" }],
          },
        },
      },
    ];
    fs.writeFileSync(
      fixturePath,
      fixture.map((record) => JSON.stringify(record)).join("\n") + "\n",
    );
    try {
      const records = withCombinedConcurrency(
        recordsFromJsonl(fs.readFileSync(fixturePath, "utf8")),
      );
      const t20 = deriveSummaryCases(
        records,
        T20_DIAGNOSIS_RPC_SPECS.map((spec) =>
          spec.caseName === "timeout-fallback" || spec.caseName.startsWith("concurrency")
            ? { ...spec, officialOutcome: "accepted" }
            : spec,
        ),
      );
      writeJson("t20-revaluation.json", {
        at: new Date().toISOString(),
        zone: "Asia/Shanghai",
        source: fixturePath,
        evidenceKind: "synthetic-unit-fixture",
        isLiveEvidence: false,
        cases: Object.fromEntries(
          Object.entries(t20).map(([name, value]) => [
            name,
            (value as { result?: unknown; honesty?: unknown }).honesty ?? value,
          ]),
        ),
      });
      expect(t20["duplicate-delivery"]?.result).toBe("pass");
      expect(t20["timeout-fallback"]?.result).toBe("fail");
      expect(t20["concurrency"]?.result).toBe("fail");
      expect(t20["concurrency-a"]?.result).toBe("fail");
      cases["t20-revaluation"] = {
        evidenceKind: "synthetic-unit-fixture",
        isLiveEvidence: false,
        timeoutFallback: t20["timeout-fallback"]?.result,
        concurrency: t20["concurrency"]?.result,
      };
    } finally {
      fs.rmSync(fixtureDir, { recursive: true, force: true });
    }
  });

  it("explains timeout-fallback accepted-with-zero-writes against both clients and stores", async () => {
    const previous = process.env.OPENBOT_CHAT_INBOUND_PERSIST_EARLY;
    process.env.OPENBOT_CHAT_INBOUND_PERSIST_EARLY = "1";
    const t = emptyTrace();
    const canary = DIAGNOSIS_P24_5_LIVE_SESSION_KEY;
    const beforeWs = await wsHistory(canary);
    const beforeOfficial = await officialHistory(canary);
    const beforeStores = storeSnapshot(canary);
    appendRpc({
      at: new Date().toISOString(),
      runId: RUN_ID,
      phase: "preparation",
      caseName: "timeout-fallback",
      method: "chat.history",
      params: { sessionKey: canary, view: "test-ws" },
      ok: true,
      error: null,
      messages: { before: beforeWs, after: beforeWs, diff: messageDiff(beforeWs, beforeWs) },
    });
    let outcome: string | null = null;
    try {
      outcome = await deliverDiagnosisViaOfficialLiveGateway(
        {
          sessionKey: canary,
          tenantId: DIAGNOSIS_P24_5_CANARY_TENANT,
          text: "【诊断提醒】t22 timeout fallback",
          deliveryId: "t22-timeout-fallback",
        },
        {
          call: async (opts) => {
            if (opts.method === "chat.send") {
              const params = (opts.params ?? {}) as Record<string, unknown>;
              const before = await officialHistory(canary);
              let rpcReturned = false;
              let rpcError: string | null = null;
              let rpcObservation = observationFromCallGatewayError("not started");
              try {
                const rpc = await callGateway({
                  ...opts,
                  url: effectiveUrl,
                  token: TEST_TOKEN,
                  timeoutMs: 5_000,
                });
                rpcReturned = true;
                rpcObservation = observationFromCallGatewayPayload(rpc);
              } catch (error) {
                rpcError = error instanceof Error ? error.message : String(error);
                rpcObservation = observationFromCallGatewayError(error);
              }
              const after = await officialHistory(canary);
              appendRpc({
                at: new Date().toISOString(),
                runId: RUN_ID,
                phase: "under_test",
                caseName: "timeout-fallback",
                method: "chat.send",
                params: summarizeParams(params),
                ok: false,
                error: "gateway timeout after 200ms (simulated after persist attempt)",
                returnSummary: {
                  rpcReturned,
                  rpcError,
                  clientTimeoutForced: true,
                  sendOk: rpcObservation.ok,
                  sendError: rpcObservation.error,
                  sendRunId: rpcObservation.runId,
                  sendStatus: rpcObservation.status,
                  officialHistoryBefore: before.count,
                  officialHistoryAfter: after.count,
                },
                messages: {
                  before: before.fingerprints,
                  after: after.fingerprints,
                  diff: messageDiff(before.fingerprints, after.fingerprints),
                },
              });
              throw new Error(`gateway timeout after 200ms\n${effectiveUrl}`);
            }
            return officialCall(TEST_TOKEN, "timeout-fallback")(opts);
          },
          trace: t,
          timeoutMs: { send: 400, inject: 10_000 },
        },
      );
    } finally {
      if (previous == null) {
        delete process.env.OPENBOT_CHAT_INBOUND_PERSIST_EARLY;
      } else {
        process.env.OPENBOT_CHAT_INBOUND_PERSIST_EARLY = previous;
      }
    }
    const afterWs = await wsHistory(canary);
    const afterOfficial = await officialHistory(canary);
    const afterStores = storeSnapshot(canary);
    appendRpc({
      at: new Date().toISOString(),
      runId: RUN_ID,
      phase: "verification",
      caseName: "timeout-fallback",
      method: "chat.history",
      params: { sessionKey: canary, view: "test-ws" },
      ok: true,
      error: null,
      messages: { before: beforeWs, after: afterWs, diff: messageDiff(beforeWs, afterWs) },
    });
    appendRpc({
      at: new Date().toISOString(),
      runId: RUN_ID,
      phase: "verification",
      caseName: "timeout-fallback",
      method: "chat.history",
      params: { sessionKey: canary, view: "official-callGateway" },
      ok: afterOfficial.ok,
      error: afterOfficial.error,
      messages: {
        before: beforeOfficial.fingerprints,
        after: afterOfficial.fingerprints,
        diff: messageDiff(beforeOfficial.fingerprints, afterOfficial.fingerprints),
      },
    });
    const honesty = deriveCaseHonesty(
      {
        caseName: "timeout-fallback",
        requirePersistence: true,
        officialOutcome: outcome ?? null,
        expectedFailures: [{ method: "chat.send", phase: "under_test" }],
      },
      recordedRpcs.filter((record) => record.caseName === "timeout-fallback"),
    );
    const report = {
      outcome,
      methods: t.methods,
      resetKeys: t.resetKeys,
      testWs: { beforeCount: beforeWs.length, afterCount: afterWs.length },
      officialClient: {
        beforeCount: beforeOfficial.count,
        afterCount: afterOfficial.count,
        afterOk: afterOfficial.ok,
        afterError: afterOfficial.error,
      },
      officialDeviceId: readDeviceId(officialIdentityPath()),
      testDeviceIdentities: listTestDeviceIdentities(stateDir),
      storesBefore: beforeStores,
      storesAfter: afterStores,
      identitiesDiffer:
        readDeviceId(officialIdentityPath()) != null &&
        listTestDeviceIdentities(stateDir).some(
          (item) => item.deviceId && item.deviceId !== readDeviceId(officialIdentityPath()),
        ),
      honesty,
    };
    writeJson("timeout-fallback.json", report);
    cases["timeout-fallback"] = report;
    expect(t.methods).toContain("chat.inject");
    // Honesty is recorded; the test must not claim pass if history did not grow.
    if (!honesty.persistence.observed) {
      expect(honesty.result).toBe("fail");
    }
  }, 60_000);

  it("retests concurrent official delivers and records each error and final counts", async () => {
    const canary = DIAGNOSIS_P24_5_LIVE_SESSION_KEY;
    const beforeOfficial = await officialHistory(canary);
    const beforeWs = await wsHistory(canary);
    const tA = emptyTrace();
    const tB = emptyTrace();
    const settled = await Promise.allSettled([
      deliverDiagnosisViaOfficialLiveGateway(
        {
          sessionKey: canary,
          tenantId: DIAGNOSIS_P24_5_CANARY_TENANT,
          text: "【诊断提醒】t22 concurrent a",
          deliveryId: "t22-concurrent-a",
        },
        {
          call: officialCall(TEST_TOKEN, "concurrency-a"),
          trace: tA,
          timeoutMs: { send: 8_000, inject: 8_000 },
        },
      ),
      deliverDiagnosisViaOfficialLiveGateway(
        {
          sessionKey: canary,
          tenantId: DIAGNOSIS_P24_5_CANARY_TENANT,
          text: "【诊断提醒】t22 concurrent b",
          deliveryId: "t22-concurrent-b",
        },
        {
          call: officialCall(TEST_TOKEN, "concurrency-b"),
          trace: tB,
          timeoutMs: { send: 8_000, inject: 8_000 },
        },
      ),
    ]);
    const afterOfficial = await officialHistory(canary);
    const afterWs = await wsHistory(canary);
    const afterStores = storeSnapshot(canary);
    const describeSettled = (item: PromiseSettledResult<string>) =>
      item.status === "fulfilled"
        ? { ok: true, error: null, outcome: item.value }
        : {
            ok: false,
            error: item.reason instanceof Error ? item.reason.message : String(item.reason),
            outcome: null,
          };
    const callA = describeSettled(settled[0]);
    const callB = describeSettled(settled[1]);
    const rpcA = recordedRpcs.filter(
      (record) => record.caseName === "concurrency-a" && record.phase === "under_test",
    );
    const rpcB = recordedRpcs.filter(
      (record) => record.caseName === "concurrency-b" && record.phase === "under_test",
    );
    const honesty = deriveCaseHonesty(
      {
        caseName: "concurrency",
        requirePersistence: true,
        officialOutcome:
          callA.outcome === "accepted" && callB.outcome === "accepted" ? "accepted" : null,
      },
      withCombinedConcurrency(recordedRpcs).filter((record) => record.caseName === "concurrency"),
    );
    const report = {
      a: callA,
      b: callB,
      methodsA: tA.methods,
      methodsB: tB.methods,
      perCallRpcs: {
        a: rpcA.map((record) => ({
          method: record.method,
          ok: record.ok ?? null,
          error: record.error ?? null,
        })),
        b: rpcB.map((record) => ({
          method: record.method,
          ok: record.ok ?? null,
          error: record.error ?? null,
        })),
      },
      finalMessageCount: {
        officialClient: afterOfficial.count,
        testWs: afterWs.length,
        officialBefore: beforeOfficial.count,
        testWsBefore: beforeWs.length,
      },
      storesAfter: afterStores,
      honesty,
    };
    writeJson("concurrency.json", report);
    cases.concurrency = report;
    cases["concurrency-a"] = { ...callA, methods: tA.methods, rpcs: report.perCallRpcs.a };
    cases["concurrency-b"] = { ...callB, methods: tB.methods, rpcs: report.perCallRpcs.b };
    expect(settled).toHaveLength(2);
  }, 60_000);

  it("validates the official diagnosis bridge reset boundary for agent:other:t20", async () => {
    const canary = DIAGNOSIS_P24_5_LIVE_SESSION_KEY;
    let officialSeedOk = false;
    let officialSeedError: string | null = null;
    try {
      await callGateway({
        method: "chat.send",
        params: {
          sessionKey: OTHER_SESSION_KEY,
          message: "seed other session on official client",
          idempotencyKey: "t22-seed-other-official",
          deliver: false,
        },
        url: effectiveUrl,
        token: TEST_TOKEN,
        timeoutMs: 8_000,
      });
      officialSeedOk = true;
    } catch (error) {
      officialSeedError = error instanceof Error ? error.message : String(error);
    }
    const wsSeed = await rpcReq(ws, "chat.send", {
      sessionKey: OTHER_SESSION_KEY,
      message: "seed other session on test ws",
      idempotencyKey: "t22-seed-other-ws",
      deliver: false,
    });
    const officialBefore = await officialHistory(OTHER_SESSION_KEY);
    const wsBefore = await wsHistory(OTHER_SESSION_KEY);

    const tCross = emptyTrace();
    let crossCode: string | null = null;
    try {
      await deliverDiagnosisViaOfficialLiveGateway(
        {
          sessionKey: OTHER_SESSION_KEY,
          tenantId: DIAGNOSIS_P24_5_CANARY_TENANT,
          text: "【诊断提醒】should not leave the canary key",
          deliveryId: "t22-cross-reset",
        },
        {
          call: officialCall(TEST_TOKEN, "official-bridge-cross-key"),
          trace: tCross,
          timeoutMs: { send: 2_000, inject: 2_000, reset: 2_000 },
        },
      );
    } catch (error) {
      crossCode = error instanceof DiagnosisContractError ? error.code : String(error);
    }

    const tReset = emptyTrace();
    let injectAttempts = 0;
    const resetOutcome = await deliverDiagnosisViaOfficialLiveGateway(
      {
        sessionKey: canary,
        tenantId: DIAGNOSIS_P24_5_CANARY_TENANT,
        text: "【诊断提醒】t22 official reset path",
        deliveryId: "t22-official-reset-path",
      },
      {
        call: async (opts) => {
          if (opts.method === "chat.send") {
            throw new Error("gateway timeout after 200ms");
          }
          if (opts.method === "chat.inject") {
            injectAttempts += 1;
            if (injectAttempts === 1) {
              throw new Error(`session not found: ${canary}`);
            }
          }
          return officialCall(TEST_TOKEN, "official-bridge-reset")(opts);
        },
        trace: tReset,
        timeoutMs: { send: 2_000, inject: 8_000, reset: 8_000 },
      },
    );

    const officialAfter = await officialHistory(OTHER_SESSION_KEY);
    const wsAfter = await wsHistory(OTHER_SESSION_KEY);
    const stores = storeSnapshot(OTHER_SESSION_KEY);
    const officialBridgeBoundaryVerified =
      crossCode === "canary_session_mismatch" &&
      tCross.methods.length === 0 &&
      tCross.resetKeys.length === 0 &&
      tReset.resetKeys.length > 0 &&
      !tReset.resetKeys.includes(OTHER_SESSION_KEY) &&
      tReset.resetKeys.every((key) => key === canary) &&
      officialAfter.count >= officialBefore.count;

    const report = {
      otherKey: OTHER_SESSION_KEY,
      generalSessionsResetIsNotBridgeProof: true,
      otherInTestWsCallerScope: wsSeed.ok,
      otherInOfficialCallGatewayScope: officialSeedOk,
      officialSeedError,
      testWsSeedError: wsSeed.ok ? null : (wsSeed.error ?? null),
      officialBridgeCrossKey: {
        code: crossCode,
        methods: tCross.methods,
        resetKeys: tCross.resetKeys,
      },
      officialBridgeResetPath: {
        outcome: resetOutcome,
        methods: tReset.methods,
        resetKeys: tReset.resetKeys,
        injectAttempts,
      },
      officialOtherBeforeCount: officialBefore.count,
      officialOtherAfterCount: officialAfter.count,
      wsOtherBeforeCount: wsBefore.length,
      wsOtherAfterCount: wsAfter.length,
      stores,
      officialBridgeBoundaryVerified,
      citations: {
        canaryGuard: "src/diagnosis/official-live-send.ts#assertDiagnosisCanarySessionKey",
        canaryResetOnly: "src/diagnosis/official-live-send.ts#ensureCanarySession",
        testWsAdminScope:
          "src/gateway/test-helpers.server.ts#connectReq requestedScopes operator.admin",
        adminSubstitutes: "src/gateway/method-scopes.ts#authorizeOperatorScopesForMethod",
        operatorFromDevice: "src/config/operator-state-scope.ts#deriveOperatorIdFromGatewayClient",
      },
    };
    writeJson("reset-boundary.json", report);
    cases["reset-boundary"] = report;
    cases["boundary-deny"] = {
      sessionCode: crossCode,
      result: crossCode === "canary_session_mismatch" ? "pass" : "fail",
    };
    expect(crossCode).toBe("canary_session_mismatch");
    expect(tCross.methods).toEqual([]);
    expect(tReset.resetKeys.every((key) => key === canary)).toBe(true);
    if (officialBefore.count > 0) {
      expect(officialAfter.count).toBeGreaterThanOrEqual(officialBefore.count);
    }
  }, 60_000);
});
