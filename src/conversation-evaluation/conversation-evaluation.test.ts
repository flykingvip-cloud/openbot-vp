import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  noteChatRunTenant,
  resetChatSessionInterestForTests,
} from "../gateway/chat-session-interest.js";
import {
  emitAgentEvent,
  registerAgentRunContext,
  resetAgentRunContextForTest,
} from "../infra/agent-events.js";
import { judgeDimensions } from "./assessment.js";
import { EvaluationIdempotency, foldEvaluationRecords } from "./idempotency.js";
import { tenantHash16 } from "./identity.js";
import { startConversationEvaluation, type ConversationEvaluationHandle } from "./index.js";
import { readJsonlObjects } from "./store.js";
import {
  A0_DROP_ALERT_RATE,
  A0_DROP_ALERT_WINDOW_MS,
  A0_LATENCY_MIN_SAMPLES,
  A0_P95_ABS_MS,
  A0_P99_ABS_MS,
  A0_QUEUE_MAX_BYTES,
  A0_QUEUE_MAX_ITEMS,
  A0_WRITE_TIMEOUT_MS,
  compareLatencyRegression,
  isDropRateAlert,
} from "./thresholds.js";
import type { ConversationEvaluationRecord } from "./types.js";
import { CONVERSATION_EVALUATION_RULE_VERSION } from "./types.js";

const handles: ConversationEvaluationHandle[] = [];

afterEach(() => {
  for (const handle of handles) {
    handle.stop();
  }
  handles.length = 0;
  resetAgentRunContextForTest();
  resetChatSessionInterestForTests();
});

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "conv-eval-"));
}

function start(
  configDir: string,
  extra: Parameters<typeof startConversationEvaluation>[0] = {},
): ConversationEvaluationHandle {
  const handle = startConversationEvaluation({
    enabled: true,
    subscribe: false,
    configDir,
    ...extra,
  });
  handles.push(handle);
  return handle;
}

function lifecycle(input: {
  runId: string;
  phase: "start" | "end" | "error";
  ts: number;
  tenantId: string;
  sessionKey?: string;
  data?: Record<string, unknown>;
  visibleText?: boolean;
}) {
  return {
    runId: input.runId,
    ts: input.ts,
    stream: input.phase === "start" ? "lifecycle" : "lifecycle",
    ...(input.sessionKey ? { sessionKey: input.sessionKey } : {}),
    trustedTenantId: input.tenantId,
    ...(input.visibleText ? { visibleText: true } : {}),
    data: {
      phase: input.phase,
      startedAt: input.ts,
      ...(input.phase === "end" || input.phase === "error" ? { endedAt: input.ts } : {}),
      ...input.data,
    },
  };
}

function readRun(
  configDir: string,
  tenantId: string,
  runId: string,
): ConversationEvaluationRecord[] {
  const root = path.join(configDir, "conversation-evaluations", tenantHash16(tenantId));
  if (!fs.existsSync(root)) {
    return [];
  }
  const target = `${runId.replace(/[^A-Za-z0-9._:-]/g, "_")}.jsonl`;
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      break;
    }
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.name === target) {
        return readJsonlObjects<ConversationEvaluationRecord>(full);
      }
    }
  }
  return [];
}

describe("conversation evaluation M0", () => {
  it("locks A7 field mapping and does not rename modelTtftMs into user ttftMs", async () => {
    const configDir = tempDir();
    const ts = Date.UTC(2026, 9, 11, 1, 0, 0);
    const handle = start(configDir, { now: () => ts });
    const runId = "run-a7";
    const tenantId = "tenant-acme";
    handle.observe({
      runId,
      ts: 1_000,
      stream: "lifecycle",
      trustedTenantId: tenantId,
      sessionKey: "agent:main:main",
      data: { event: "chat.dispatch_started" },
    });
    handle.observe({
      runId,
      ts: 1_100,
      stream: "tool",
      trustedTenantId: tenantId,
      data: { phase: "start", toolCallId: "tool-1", name: "read" },
    });
    handle.observe({
      runId,
      ts: 1_250,
      stream: "tool",
      trustedTenantId: tenantId,
      data: { phase: "result", toolCallId: "tool-1", isError: false },
    });
    handle.observe({
      runId,
      ts: 1_200,
      stream: "lifecycle",
      trustedTenantId: tenantId,
      data: {
        event: "chat.first_token",
        modelTtftMs: 40,
        llmTtftMs: 999,
        dockerMs: 12,
        coldStartMs: 500,
        text: "super-secret-phrase",
        correctness: "pass",
        attemptId: 9,
      },
    });
    handle.observe({
      runId,
      ts: 1_300,
      stream: "lifecycle",
      trustedTenantId: tenantId,
      data: { event: "chat.context_compiled", compileMs: 15 },
    });
    handle.observe({
      runId,
      ts: 1_400,
      stream: "lifecycle",
      trustedTenantId: tenantId,
      data: { event: "chat.model_finished", modelMs: 200, model: "model-a" },
    });
    handle.observe(
      lifecycle({
        runId,
        phase: "end",
        ts: 1_500,
        tenantId,
        data: { startedAt: 1_000, endedAt: 1_500 },
      }),
    );
    await handle.flush();

    const lines = readRun(configDir, tenantId, runId);
    const current = foldEvaluationRecords(lines);
    expect(current).toMatchObject({
      tenantId,
      runId,
      linkQuality: "strong",
      entrypoint: "gateway-chat",
      execution: "completed",
      usability: "usable",
      correctness: "unassessed",
      correctnessReason: "no_signal",
      assessmentStatus: "assessed",
      modelFirstTokenMs: 40,
      ttftMs: 100,
      firstVisibleKind: "tool",
      totalMs: 500,
      llmMs: 200,
      toolMs: 150,
      compileMs: 15,
      dockerMs: "n/a",
      startupMode: "unknown",
      modelId: "model-a",
      t0Source: "chat.dispatch_started",
    });
    expect(current).not.toHaveProperty("attempt");
    expect(current).not.toHaveProperty("ttftAlgorithm");
    const serialized = JSON.stringify(lines);
    expect(serialized).not.toContain("super-secret-phrase");
    expect(serialized).not.toContain("llmTtftMs");
    expect(serialized).not.toContain("coldStartMs");
    expect(serialized).not.toContain('"dockerMs":12');
    expect(serialized).not.toContain("attemptId");
    expect(current?.correctness).not.toBe("pass");
  });

  it("derives non-stream ttftMs and keeps modelFirstTokenMs n/a when first_token is absent", async () => {
    const configDir = tempDir();
    const ts = Date.UTC(2026, 9, 11, 2, 0, 0);
    const handle = start(configDir, { now: () => ts });
    handle.observe(
      lifecycle({
        runId: "run-cli",
        phase: "start",
        ts: 1_000,
        tenantId: "tenant-acme",
        data: { entrypoint: "cli" },
      }),
    );
    handle.observe({
      runId: "run-cli",
      ts: 1_800,
      stream: "assistant",
      trustedTenantId: "tenant-acme",
      visibleText: true,
      data: { text: "full reply that must not be stored" },
    });
    handle.observe(
      lifecycle({
        runId: "run-cli",
        phase: "end",
        ts: 2_000,
        tenantId: "tenant-acme",
        data: { startedAt: 1_000, endedAt: 2_000, entrypoint: "cli", llmTtftMs: 5 },
      }),
    );
    await handle.flush();
    const current = foldEvaluationRecords(readRun(configDir, "tenant-acme", "run-cli"));
    expect(current).toMatchObject({
      entrypoint: "cli",
      modelFirstTokenMs: "n/a",
      ttftMs: 800,
      firstVisibleKind: "model",
      ttftAlgorithm: "non_stream_first_complete_reply.v1",
      t0Source: "lifecycle_start",
      totalMs: 1_000,
      toolMs: "n/a",
      dockerMs: "n/a",
    });
    expect(JSON.stringify(current)).not.toContain("full reply");
    expect(current?.modelFirstTokenMs).not.toBe(5);
  });

  it("sets ttftMs n/a when failure happens before any visible fragment", async () => {
    const configDir = tempDir();
    const ts = Date.UTC(2026, 9, 11, 3, 0, 0);
    const handle = start(configDir, { now: () => ts });
    handle.observe({
      runId: "run-fail-visible",
      ts: 1_000,
      stream: "lifecycle",
      trustedTenantId: "tenant-acme",
      data: { event: "chat.dispatch_started" },
    });
    handle.observe(
      lifecycle({
        runId: "run-fail-visible",
        phase: "error",
        ts: 1_400,
        tenantId: "tenant-acme",
        data: { startedAt: 1_000, endedAt: 1_400, error: "timed out talking to the provider" },
      }),
    );
    await handle.flush();
    const current = foldEvaluationRecords(readRun(configDir, "tenant-acme", "run-fail-visible"));
    expect(current).toMatchObject({
      execution: "timed_out",
      usability: "blocked",
      failureAttribution: "external",
      correctness: "unassessed",
      correctnessReason: "no_signal",
      ttftMs: "n/a",
      modelFirstTokenMs: "n/a",
      totalMs: 400,
      dockerMs: "n/a",
    });
    expect(current).not.toHaveProperty("firstVisibleKind");
    expect(JSON.stringify(current)).not.toContain("talking to the provider");
  });

  it("keeps a measured zero and does not invent one for missing timings", async () => {
    const configDir = tempDir();
    const ts = Date.UTC(2026, 9, 11, 4, 0, 0);
    const handle = start(configDir, { now: () => ts });
    handle.observe({
      runId: "run-zero",
      ts: 1_000,
      stream: "lifecycle",
      trustedTenantId: "tenant-acme",
      data: { event: "chat.dispatch_started" },
    });
    handle.observe({
      runId: "run-zero",
      ts: 1_000,
      stream: "tool",
      trustedTenantId: "tenant-acme",
      data: { phase: "start", toolCallId: "t" },
    });
    handle.observe({
      runId: "run-zero",
      ts: 1_000,
      stream: "lifecycle",
      trustedTenantId: "tenant-acme",
      data: { event: "chat.first_token", modelTtftMs: 0 },
    });
    handle.observe({
      runId: "run-zero",
      ts: 1_000,
      stream: "tool",
      trustedTenantId: "tenant-acme",
      data: { phase: "result", toolCallId: "t" },
    });
    handle.observe(
      lifecycle({
        runId: "run-zero",
        phase: "end",
        ts: 1_000,
        tenantId: "tenant-acme",
        data: { startedAt: 1_000, endedAt: 1_000 },
      }),
    );
    await handle.flush();
    const current = foldEvaluationRecords(readRun(configDir, "tenant-acme", "run-zero"));
    expect(current).toMatchObject({
      modelFirstTokenMs: 0,
      ttftMs: 0,
      firstVisibleKind: "tool",
      toolMs: 0,
      totalMs: 0,
      compileMs: "n/a",
      llmMs: null,
    });
  });

  it("omits attempt unless it is an integer >= 1 and ignores attemptId (A-att)", async () => {
    const configDir = tempDir();
    const ts = Date.UTC(2026, 9, 11, 5, 0, 0);
    const handle = start(configDir, { now: () => ts });
    handle.observe(
      lifecycle({
        runId: "run-no-attempt",
        phase: "end",
        ts: 2_000,
        tenantId: "tenant-acme",
        data: { attemptId: 4, attempt: 0, startedAt: 1_000, endedAt: 2_000 },
      }),
    );
    handle.observe(
      lifecycle({
        runId: "run-attempt",
        phase: "end",
        ts: 2_000,
        tenantId: "tenant-acme",
        data: { attempt: 2, attemptId: 99, startedAt: 1_000, endedAt: 2_000 },
      }),
    );
    await handle.flush();
    const missing = foldEvaluationRecords(readRun(configDir, "tenant-acme", "run-no-attempt"));
    const present = foldEvaluationRecords(readRun(configDir, "tenant-acme", "run-attempt"));
    expect(missing?.assessmentStatus).toBe("assessed");
    expect(missing).not.toHaveProperty("attempt");
    expect(present?.attempt).toBe(2);
    expect(JSON.stringify(present)).not.toContain("attemptId");
  });

  it("isolates weak samples from high-trust coverage and groups the denominator by entrypoint", async () => {
    const configDir = tempDir();
    const ts = Date.UTC(2026, 9, 11, 6, 0, 0);
    const handle = start(configDir, {
      now: () => ts,
      breakRunIds: new Set(["run-broken"]),
    });
    const tenantId = "tenant-acme";
    const strong = (
      runId: string,
      extra?: { sessionKey?: string; data?: Record<string, unknown> },
    ) => {
      handle.observe({
        runId,
        ts: 1_000,
        stream: "lifecycle",
        trustedTenantId: tenantId,
        ...(extra?.sessionKey ? { sessionKey: extra.sessionKey } : {}),
        data: { event: "chat.dispatch_started", ...extra?.data },
      });
      handle.observe(
        lifecycle({
          runId,
          phase: "end",
          ts: 1_200,
          tenantId,
          sessionKey: extra?.sessionKey,
          data: { startedAt: 1_000, endedAt: 1_200, ...extra?.data },
        }),
      );
    };
    strong("run-chat");
    strong("round-9:helper");
    strong("run-sub", { sessionKey: "agent:research:subagent:task-1" });
    strong("run-cli-hint", { data: { entrypoint: "cli" } });
    strong("run-broken");
    handle.observeWeak({
      conversationId: "conv-weak",
      startedAt: 1_000,
      agentId: "helper",
      trustedTenantId: tenantId,
      ts: 1_500,
    });
    await handle.flush();

    const metrics = handle.getMetrics();
    expect(metrics.weakSamples).toBe(1);
    expect(metrics.highTrust.denominator).toBe(5);
    expect(metrics.highTrust.withRecord).toBe(5);
    expect(metrics.highTrust.observableCoverage).toBe(1);
    expect(metrics.highTrust.processingCompletion).toBe(1);
    expect(metrics.highTrust.effectiveComplete).toBe(4);
    expect(metrics.highTrust.effectiveAssessment).toBe(4 / 5);
    expect(metrics.byEntrypoint["gateway-chat"].denominator).toBe(2);
    expect(metrics.byEntrypoint["collab-bot"].denominator).toBe(1);
    expect(metrics.byEntrypoint.subagent.denominator).toBe(1);
    expect(metrics.byEntrypoint.cli.denominator).toBe(1);

    const broken = foldEvaluationRecords(readRun(configDir, tenantId, "run-broken"));
    expect(broken?.assessmentStatus).toBe("failed_to_assess");
    expect(broken?.failureCode).toBe("reducer_error");
    expect(broken?.correctness).toBe("unassessed");
    const collab = foldEvaluationRecords(readRun(configDir, tenantId, "round-9:helper"));
    expect(collab).toMatchObject({ entrypoint: "collab-bot", roundId: "round-9" });
    const weakRoot = path.join(configDir, "conversation-evaluations", tenantHash16(tenantId));
    const weakFiles: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.name.startsWith("weak:")) {
          weakFiles.push(full);
        }
      }
    };
    walk(weakRoot);
    expect(weakFiles).toHaveLength(1);
    const weak = readJsonlObjects<ConversationEvaluationRecord>(weakFiles[0] ?? "");
    expect(weak[0]?.linkQuality).toBe("weak");
    expect(weak[0]?.assessmentStatus).toBe("unassessed");
    expect(weak[0]?.unassessedReason).toBe("out_of_scope");
    expect(metrics.highTrust.denominator).not.toBe(6);
  });

  it("uses server membership tenant and refuses a client-claimed tenant", async () => {
    const configDir = tempDir();
    const ts = Date.UTC(2026, 9, 11, 7, 0, 0);
    noteChatRunTenant("run-member", "Tenant-Acme");
    const handle = start(configDir, { now: () => ts, subscribe: true });
    emitAgentEvent({
      runId: "run-member",
      stream: "lifecycle",
      data: { phase: "end", startedAt: ts, endedAt: ts + 10, tenantId: "evil-tenant" },
    });
    emitAgentEvent({
      runId: "run-untrusted",
      stream: "lifecycle",
      data: { phase: "end", tenantId: "evil-tenant" },
    });
    await handle.flush();
    const lines = readRun(configDir, "tenant-acme", "run-member");
    expect(lines.at(-1)?.tenantId).toBe("tenant-acme");
    expect(lines.at(-1)?.evidenceRefs).toContain("tenant_claim_ignored");
    const evilHash = tenantHash16("evil-tenant");
    expect(fs.existsSync(path.join(configDir, "conversation-evaluations", evilHash))).toBe(false);
    expect(handle.getDropCounts().missing_membership_tenant).toBe(1);
  });

  it("appends history, keeps reassess, and does not let pending replace a terminal", async () => {
    const configDir = tempDir();
    const ts = Date.UTC(2026, 9, 11, 8, 0, 0);
    const handle = start(configDir, { now: () => ts });
    handle.observe({
      runId: "run-hist",
      ts: 1_000,
      stream: "lifecycle",
      trustedTenantId: "tenant-acme",
      data: { event: "chat.dispatch_started" },
    });
    handle.observe(
      lifecycle({
        runId: "run-hist",
        phase: "end",
        ts: 1_400,
        tenantId: "tenant-acme",
        data: { startedAt: 1_000, endedAt: 1_400 },
      }),
    );
    await handle.flush();
    handle.reassess("tenant-acme", "run-hist");
    await handle.flush();
    const lines = readRun(configDir, "tenant-acme", "run-hist");
    expect(lines.map((line) => line.recordKind)).toEqual(["pending", "terminal", "reassess"]);
    expect(lines[0]?.assessmentStatus).toBe("pending");
    expect(lines[2]?.supersedesEventId).toBe(lines[1]?.eventId);
    expect(foldEvaluationRecords(lines)?.recordKind).toBe("reassess");
    const first = JSON.stringify(lines[0]);
    expect(JSON.stringify(readRun(configDir, "tenant-acme", "run-hist")[0])).toBe(first);

    const index = new EvaluationIdempotency();
    const terminal = lines[1];
    if (!terminal) {
      throw new Error("missing terminal");
    }
    const pending: ConversationEvaluationRecord = { ...lines[0], eventId: "pending-late" };
    expect(index.admit(terminal).action).toBe("append");
    expect(index.admit(pending)).toMatchObject({ action: "skip", reason: "pending_over_terminal" });
    expect(index.current("run-hist")?.assessmentStatus).toBe("assessed");

    const newer = {
      ...terminal,
      eventId: "newer",
      ruleVersion: "m0.v3.2",
      evidenceRefs: ["lifecycle:end", "extra"],
      assessedAt: "2026-10-11T08:00:02.000Z",
    };
    const older = {
      ...terminal,
      eventId: "older",
      ruleVersion: "m0.v3.1",
      assessedAt: "2026-10-11T08:00:03.000Z",
    };
    const versions = new EvaluationIdempotency();
    expect(versions.admit(newer).action).toBe("append");
    expect(versions.admit(older)).toMatchObject({ action: "skip", reason: "older_rule_version" });
    expect(versions.current("run-hist")?.ruleVersion).toBe("m0.v3.2");

    const conflict = new EvaluationIdempotency();
    const firstTerminal = {
      ...terminal,
      eventId: "c1",
      evidenceRefs: ["lifecycle:end"],
      assessedAt: "2026-10-11T08:00:01.000Z",
    };
    const secondTerminal = {
      ...terminal,
      eventId: "c2",
      evidenceRefs: ["lifecycle:end", "chat.first_token"],
      assessedAt: "2026-10-11T08:00:02.000Z",
    };
    expect(conflict.admit(firstTerminal).action).toBe("append");
    const winner = conflict.admit(secondTerminal);
    expect(winner.action).toBe("append");
    if (winner.action === "append") {
      expect(winner.record.conflictFlag).toBe(true);
      expect(winner.record.eventId).toBe("c2");
    }
    expect(conflict.history("run-hist").length).toBeGreaterThanOrEqual(2);
  });

  it("meets A0 bounds: flag off, non-blocking write, overflow, and latency math", async () => {
    expect(A0_WRITE_TIMEOUT_MS).toBe(200);
    expect(A0_QUEUE_MAX_ITEMS).toBe(10_000);
    expect(A0_QUEUE_MAX_BYTES).toBe(256 * 1024 * 1024);
    expect(A0_DROP_ALERT_RATE).toBe(0.01);
    expect(A0_DROP_ALERT_WINDOW_MS).toBe(5 * 60 * 1000);
    expect(A0_P95_ABS_MS).toBe(50);
    expect(A0_P99_ABS_MS).toBe(100);

    const offDir = tempDir();
    const off = start(offDir, { enabled: false, subscribe: true });
    emitAgentEvent({
      runId: "run-off",
      stream: "lifecycle",
      data: { phase: "end", endedAt: 1 },
    });
    off.observe(lifecycle({ runId: "run-off-2", phase: "end", ts: 2, tenantId: "tenant-acme" }));
    await off.flush();
    expect(fs.existsSync(path.join(offDir, "conversation-evaluations"))).toBe(false);

    const blockDir = tempDir();
    const blocking = start(blockDir, {
      writeTimeoutMs: 30,
      maxQueueItems: 1,
      appendFile: () => new Promise(() => undefined),
    });
    const started = Date.now();
    blocking.observe(lifecycle({ runId: "run-a", phase: "end", ts: 10, tenantId: "tenant-acme" }));
    blocking.observe(lifecycle({ runId: "run-b", phase: "end", ts: 11, tenantId: "tenant-acme" }));
    blocking.observe(lifecycle({ runId: "run-c", phase: "end", ts: 12, tenantId: "tenant-acme" }));
    expect(Date.now() - started).toBeLessThan(20);
    expect(blocking.getDropCounts().overflow).toBe(1);
    await blocking.flush();
    expect(blocking.getDropCounts().write_timeout).toBeGreaterThanOrEqual(1);

    const timeoutDir = tempDir();
    const timingOut = start(timeoutDir, {
      writeTimeoutMs: 20,
      appendFile: () => new Promise(() => undefined),
    });
    timingOut.observe(
      lifecycle({ runId: "run-timeout", phase: "end", ts: 50, tenantId: "tenant-acme" }),
    );
    await timingOut.flush();
    expect(timingOut.getDropCounts().write_timeout).toBe(1);
    expect(timingOut.getMetrics().highTrust.denominator).toBe(1);
    expect(timingOut.getMetrics().highTrust.withRecord).toBe(0);
    expect(timingOut.getMetrics().highTrust.observableCoverage).toBe(0);

    const liveDir = tempDir();
    const live = start(liveDir, { subscribe: true, now: () => Date.UTC(2026, 9, 11, 9, 0, 0) });
    noteChatRunTenant("run-live", "tenant-acme");
    emitAgentEvent({
      runId: "run-live",
      stream: "lifecycle",
      data: { phase: "end", startedAt: 1, endedAt: 2 },
    });
    await live.flush();
    expect(readRun(liveDir, "tenant-acme", "run-live")).toHaveLength(1);
    noteChatRunTenant("run-after-stop", "tenant-acme");
    live.stop();
    emitAgentEvent({
      runId: "run-after-stop",
      stream: "lifecycle",
      data: { phase: "end", startedAt: 3, endedAt: 4 },
    });
    live.observe(
      lifecycle({ runId: "run-direct-after-stop", phase: "end", ts: 5, tenantId: "tenant-acme" }),
    );
    await live.flush();
    expect(readRun(liveDir, "tenant-acme", "run-after-stop")).toHaveLength(0);
    expect(live.getDropCounts().flag_off).toBeGreaterThanOrEqual(1);

    registerAgentRunContext("run-beat", { isHeartbeat: true });
    noteChatRunTenant("run-beat", "tenant-acme");
    const beat = start(tempDir(), { subscribe: true });
    emitAgentEvent({
      runId: "run-beat",
      stream: "lifecycle",
      data: { phase: "end", endedAt: 9 },
    });
    emitAgentEvent({
      runId: "diag-live-abc",
      stream: "lifecycle",
      data: { phase: "end", endedAt: 9, diagnosedAgentRunId: "real-run" },
    });
    await beat.flush();
    expect(beat.getMetrics().highTrust.denominator).toBe(0);

    const offSamples = Array.from({ length: A0_LATENCY_MIN_SAMPLES }, () => 100);
    const onSamples = Array.from({ length: A0_LATENCY_MIN_SAMPLES }, () => 140);
    expect(compareLatencyRegression({ offMs: offSamples, onMs: onSamples }).status).toBe("pass");
    expect(
      compareLatencyRegression({
        offMs: offSamples,
        onMs: onSamples.map((value) => value + 200),
      }).status,
    ).toBe("fail");
    expect(compareLatencyRegression({ offMs: [1], onMs: [1] }).status).toBe("insufficient_sample");
    expect(isDropRateAlert(2, 10)).toBe(true);
    expect(isDropRateAlert(1, 1000)).toBe(false);

    const root = path.resolve("src/conversation-evaluation");
    for (const name of fs.readdirSync(root)) {
      if (!name.endsWith(".ts") || name.endsWith(".test.ts")) {
        continue;
      }
      const source = fs.readFileSync(path.join(root, name), "utf8");
      expect(source).not.toMatch(/from\s+["'][^"']*diagnosis\/diagnose/);
      expect(source).not.toMatch(/upsertDiagnosisSchedule/);
      expect(source).not.toMatch(/confirm_diagnose/);
      expect(source).not.toMatch(/allowSelfEvolutionConfirm:\s*true/);
    }
    const written = fs.readdirSync(blockDir, { recursive: true }).map(String);
    expect(written.join("\n")).not.toContain("diagnosis-schedules");
    expect(written.join("\n")).not.toContain("diagnosis-projections");
    expect(written.join("\n")).not.toContain("diagnosis-evolution-prescriptions");
  });

  it("does not treat execution success as correctness", () => {
    const judged = judgeDimensions({
      terminal: true,
      phase: "end",
      aborted: false,
      errorClass: null,
      toolFailed: false,
      visible: true,
      linkQuality: "strong",
      reducerFailed: false,
    });
    expect(judged.execution).toBe("completed");
    expect(judged.correctness).toBe("unassessed");
    expect(judged.correctnessReason).toBe("no_signal");
    expect(judged.assessmentStatus).toBe("assessed");
    expect(CONVERSATION_EVALUATION_RULE_VERSION).toBe("m0.v3.1");
  });

  it("hashes the tenant the same way as the schedule directory, into a different tree", async () => {
    const tenantId = "tenant-acme";
    const hash = createHash("sha256").update(tenantId).digest("hex").slice(0, 16);
    expect(tenantHash16(tenantId)).toBe(hash);
    expect(hash).not.toContain("diagnosis-schedules");
    const configDir = tempDir();
    const at = Date.UTC(2026, 9, 11, 12, 0, 0);
    const handle = start(configDir, { now: () => at });
    handle.observe(
      lifecycle({
        runId: "run-path",
        phase: "end",
        ts: at,
        tenantId,
        data: { startedAt: at, endedAt: at + 5 },
      }),
    );
    await handle.flush();
    const expected = path.join(
      configDir,
      "conversation-evaluations",
      hash,
      "2026",
      "10",
      "11",
      "run-path.jsonl",
    );
    expect(fs.existsSync(expected)).toBe(true);
    expect(expected).not.toContain("diagnosis-schedules");
    expect(expected).not.toContain("diagnosis-projections");
    expect(expected).not.toContain("diagnosis-evolution-prescriptions");
  });
});
