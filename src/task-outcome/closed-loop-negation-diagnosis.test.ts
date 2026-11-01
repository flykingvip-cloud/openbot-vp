/**
 * Business path: structured rejection writes TaskOutcome only,
 * and diagnosis.diagnose reads that version.
 * Evolution revoke uses a temp agent dir. The experience-verified handler is not called.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyInboundTaskFeedback } from "../auto-reply/reply/inbound-task-feedback.js";
import {
  createTaskContext,
  getTaskContext,
  resolveTaskContextScope,
} from "../auto-reply/reply/task-context-store.js";
import type { OpenBotConfig } from "../config/config.js";
import { createDiagnosisReportGatewayHandlers } from "../diagnosis/report-query-gateway.js";
import type { TaskOutcomeEvidence } from "../diagnosis/task-outcome-evidence.js";
import { resolveEvolutionTaskOutcomesPath } from "../gateway/agent-growth/evolution-task-outcomes.js";
import { authorizeOperatorScopesForMethod } from "../gateway/method-scopes.js";
import { listGatewayMethods } from "../gateway/server-methods-list.js";
import { handleGatewayRequest } from "../gateway/server-methods.js";
import { diagnosisReportsPack } from "../gateway/server-methods/diagnosis-reports.pack.js";
import { createTaskOutcomeRejectHandlers } from "../gateway/server-methods/task-outcome-reject.js";
import { taskOutcomeRejectPack } from "../gateway/server-methods/task-outcome-reject.pack.js";
import { OutcomeConsumerRuntime } from "./consumers.js";
import { ChatTaskOutcomeAdapter } from "./entrypoints/chat.js";
import { planInboundFeedbackDisposition } from "./feedback-disposition.js";
import { publishEvolutionFromTaskOutcome } from "./growth-bridge.js";
import { callerOwnsTaskOutcome, rejectTaskOutcomeResult } from "./reject-result.js";
import { TaskOutcomeResultService } from "./result-service.js";
import { DurableTaskOutcomeStore } from "./store.js";
import type { TrustedScope } from "./types.js";

const scope: TrustedScope = {
  kind: "personal",
  personalDomainId: "personal:subject-alice",
  subjectRef: "subject:alice",
  authzScopeRef: "scope:isolation",
};

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

function closeSuccess(store: DurableTaskOutcomeStore, taskId: string) {
  const service = new TaskOutcomeResultService({ store, submittedBy: "test" });
  const chat = new ChatTaskOutcomeAdapter(service);
  const opened = chat.createOrRestore({
    taskId,
    scope,
    taskContractVersion: "1.0.0",
    commandId: `create:${taskId}`,
  });
  if (!opened.ok) {
    throw new Error(opened.message);
  }
  const fencing = opened.fencingToken;
  const attempt = chat.recordAttempt(
    taskId,
    opened.record.outcomeVersion,
    fencing,
    {
      attemptId: "a1",
      runId: "r1",
      status: "succeeded",
      observedAt: "2026-11-01T00:00:00.000Z",
      toolObservations: [{ toolName: "turn_tools", ok: false, summary: "0/1" }],
    },
    { runId: "r1", attemptIds: ["a1"], fencingToken: fencing, status: "succeeded" },
    { scope, commandId: `attempt:${taskId}` },
  );
  if (!attempt.ok) {
    throw new Error(attempt.message);
  }
  const accepted = chat.setAcceptance(
    taskId,
    attempt.record.outcomeVersion,
    fencing,
    { status: "not_required", reason: "chat_turn_contract_v1:no_external_acceptance" },
    { allowRetry: true, scope, commandId: `accept:${taskId}` },
  );
  if (!accepted.ok) {
    throw new Error(accepted.message);
  }
  const delivered = chat.setDelivery(
    taskId,
    accepted.record.outcomeVersion,
    fencing,
    { status: "delivered" },
    "delivery-1",
    { scope, commandId: `delivery:${taskId}` },
  );
  if (!delivered.ok) {
    throw new Error(delivered.message);
  }
  return delivered.record;
}

describe("structured task rejection and diagnosis read", () => {
  it("rejects only an owned closed result, keeps history, and does not rewrite the workspace task", async () => {
    const agentDir = tempDir("neg-agent-");
    const cfg = { agents: { list: [{ id: "bot", agentDir }] } } as unknown as OpenBotConfig;
    const store = new DurableTaskOutcomeStore(path.join(agentDir, "task-outcomes"));
    const closed = closeSuccess(store, "task-owned");
    expect(closed.taskJudgement).toBe("success");
    expect(closed.attempts[0]?.toolObservations?.[0]?.ok).toBe(false);
    store.close();

    const workspace = tempDir("neg-ws-");
    fs.mkdirSync(path.join(workspace, "memory"), { recursive: true });
    const contextScope = resolveTaskContextScope({
      cfg: {} as OpenBotConfig,
      workspaceDir: workspace,
      agentId: "bot",
      sessionKey: "agent:bot:main",
    });
    const bound = await createTaskContext({
      scope: contextScope,
      title: "原目标",
      description: "原来的交付说明",
    });

    expect(planInboundFeedbackDisposition("他说「不对」")).toEqual({
      kind: "ignore",
      reason: "quoted",
    });
    expect(planInboundFeedbackDisposition("转述：上次的交付不对")).toEqual({
      kind: "ignore",
      reason: "paraphrase",
    });
    expect(planInboundFeedbackDisposition("今天天气不对")).toEqual({
      kind: "ignore",
      reason: "vague_negation",
    });
    expect(planInboundFeedbackDisposition("请再加一个导出")).toEqual({
      kind: "ignore",
      reason: "new_requirement",
    });
    expect(planInboundFeedbackDisposition("上次的交付不对").kind).toBe("clarify_unbound_task");
    expect(planInboundFeedbackDisposition("你搞错了，应该是要让结果调用工具").kind).toBe(
      "workspace_goal",
    );

    for (const text of ["他说「不对，重做这个结果」", "请再加一个导出", "今天天气不对啊"]) {
      const feedback = await applyInboundTaskFeedback({
        cfg: {} as OpenBotConfig,
        workspaceDir: workspace,
        agentId: "bot",
        sessionKey: "agent:bot:main",
        sessionEntry: { sessionId: "s1", updatedAt: 1, taskContextId: bound.id },
        text,
        sourceMessageId: `m-${text.length}`,
      });
      expect(feedback.workspace).toBe("skipped");
    }
    expect((await getTaskContext(contextScope, bound.id))?.description).toBe("原来的交付说明");

    const goal = await applyInboundTaskFeedback({
      cfg: {} as OpenBotConfig,
      workspaceDir: workspace,
      agentId: "bot",
      sessionKey: "agent:bot:main",
      sessionEntry: { sessionId: "s1", updatedAt: 1, taskContextId: bound.id },
      text: "你搞错了，应该是要让结果调用工具",
      sourceMessageId: "m-goal",
    });
    expect(goal.workspace).toBe("updated");
    expect(goal.disposition.kind).toBe("workspace_goal");

    expect(
      callerOwnsTaskOutcome({
        scope: {
          kind: "enterprise",
          enterpriseDomainId: "enterprise:t1",
          tenantId: "t1",
          subjectRef: "subject:alice",
          authzScopeRef: "scope:isolation",
        },
        callerSubjectRef: "subject:alice",
        callerTenantId: "t2",
      }),
    ).toBe(false);
    expect(
      callerOwnsTaskOutcome({
        scope: {
          kind: "enterprise",
          enterpriseDomainId: "enterprise:t1",
          tenantId: "t1",
          subjectRef: "subject:alice",
          authzScopeRef: "scope:isolation",
        },
        callerSubjectRef: "subject:alice",
        callerTenantId: "t1",
      }),
    ).toBe(true);

    const stranger = rejectTaskOutcomeResult({
      cfg,
      agentId: "bot",
      taskId: "task-owned",
      outcomeVersion: closed.outcomeVersion,
      callerSubjectRaw: "mallory",
    });
    expect(stranger).toMatchObject({ ok: false, code: "unauthorized" });

    const named = rejectTaskOutcomeResult({
      cfg,
      agentId: "bot",
      taskId: "task-owned",
      outcomeVersion: closed.outcomeVersion,
      callerSubjectRaw: "alice",
    });
    expect(named.ok).toBe(true);
    if (!named.ok) {
      return;
    }
    expect(named.record.revisionKind).toBe("correction");
    expect(named.record.lifecycle).toBe("closed");
    expect(named.record.taskJudgement).toBe("failure");
    expect(named.record.reasonCode).toBe("correction");
    expect(named.record.attempts).toHaveLength(1);
    expect(named.record.outcomeVersion).toBe(closed.outcomeVersion + 1);
    expect(named.replayed).toBe(false);

    const again = rejectTaskOutcomeResult({
      cfg,
      agentId: "bot",
      taskId: "task-owned",
      outcomeVersion: closed.outcomeVersion,
      callerSubjectRaw: "alice",
    });
    expect(again).toMatchObject({
      ok: false,
      code: "version_conflict",
      tipVersion: named.record.outcomeVersion,
    });

    const replay = rejectTaskOutcomeResult({
      cfg,
      agentId: "bot",
      taskId: "task-owned",
      outcomeVersion: named.record.outcomeVersion,
      callerSubjectRaw: "alice",
      commandId: `reject-result:task-owned:${named.record.outcomeVersion}:subject:alice`,
    });
    expect(replay.ok).toBe(true);
    if (replay.ok) {
      expect(replay.replayed).toBe(true);
      expect(replay.record.outcomeVersion).toBe(named.record.outcomeVersion);
    }

    const reopened = new DurableTaskOutcomeStore(path.join(agentDir, "task-outcomes"));
    expect(reopened.loadTaskVersion("task-owned", closed.outcomeVersion)?.taskJudgement).toBe(
      "success",
    );
    expect(reopened.loadTask("task-owned")?.taskJudgement).toBe("failure");
    const prior = reopened.loadTaskVersion("task-owned", closed.outcomeVersion);
    const tip = reopened.loadTask("task-owned");
    reopened.close();
    if (!prior || !tip) {
      throw new Error("missing history");
    }
    const publishedOld = publishEvolutionFromTaskOutcome(cfg, "bot", prior);
    const publishedNew = publishEvolutionFromTaskOutcome(cfg, "bot", tip);
    expect(publishedOld.written).toBe(true);
    expect(publishedNew.reason === "excluded:other" || publishedNew.written).toBeTruthy();
    const lines = fs
      .readFileSync(resolveEvolutionTaskOutcomesPath(cfg, "bot"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { revoked?: boolean; outcomeVersion?: number });
    expect(lines.some((line) => line.revoked === true)).toBe(true);

    const consumerStore = new DurableTaskOutcomeStore(path.join(agentDir, "task-outcomes"));
    const consumer = new OutcomeConsumerRuntime(consumerStore);
    await consumer.drain((taskId) => consumerStore.loadTask(taskId));
    expect(consumer.getProjection().successCount).toBe(0);
    expect(consumer.getProjection().failureCount).toBe(1);
    consumerStore.close();

    expect((await getTaskContext(contextScope, bound.id))?.description).toContain("调用工具");
    expect((await getTaskContext(contextScope, bound.id))?.description).not.toContain(
      "结果不符合要求",
    );
  });

  it("diagnosis.diagnose returns the pinned version and does not treat tool failure as task failure", async () => {
    const agentDir = tempDir("neg-diag-");
    const cfg = { agents: { list: [{ id: "bot", agentDir }] } } as unknown as OpenBotConfig;
    const store = new DurableTaskOutcomeStore(path.join(agentDir, "task-outcomes"));
    const closed = closeSuccess(store, "task-diag");
    store.close();
    const handlers = createDiagnosisReportGatewayHandlers(
      undefined,
      { resolveMembership: async () => ({ tenantId: "tenant-a", userId: "alice" }) },
      { taskOutcomeCfg: cfg },
    );
    const call = async (params: Record<string, unknown>, userId = "alice") => {
      let body: Record<string, unknown> | undefined;
      await handlers["diagnosis.diagnose"]({
        req: { type: "req", id: "d", method: "diagnosis.diagnose" } as never,
        params,
        client: {
          user: userId,
          platformUserId: userId,
          sessionDomain: "enterprise",
        } as never,
        isWebchatConnect: () => false,
        respond: (_ok, payload) => {
          body = payload as Record<string, unknown>;
        },
        context: {} as never,
      });
      return body;
    };
    const ok = await call({
      agentId: "missing",
      sessionKey: "agent:missing:main",
      taskOutcome: {
        taskId: "task-diag",
        outcomeVersion: closed.outcomeVersion,
        agentId: "bot",
      },
    });
    const evidence = ok?.taskOutcomeEvidence as TaskOutcomeEvidence;
    expect(evidence.ok).toBe(true);
    if (evidence.ok) {
      expect(evidence.judgement).toBe("success");
      expect(evidence.toolObservations.some((row) => !row.ok)).toBe(true);
    }
    expect(String(ok?.reportText)).toContain("工具失败不改变任务判定");
    expect(String(ok?.reportText)).not.toMatch(/判定=success[\s\S]*系统正常。$/);

    const rejected = rejectTaskOutcomeResult({
      cfg,
      agentId: "bot",
      taskId: "task-diag",
      outcomeVersion: closed.outcomeVersion,
      callerSubjectRaw: "alice",
    });
    expect(rejected.ok).toBe(true);
    const stale = await call({
      agentId: "missing",
      sessionKey: "agent:missing:main",
      taskOutcome: {
        taskId: "task-diag",
        outcomeVersion: closed.outcomeVersion,
        agentId: "bot",
      },
    });
    expect(stale?.taskOutcomeEvidence).toMatchObject({
      ok: false,
      code: "outcome_version_changed",
    });
    expect(String(stale?.reportText)).toContain("不代表系统正常或问题已恢复");

    const denied = await call(
      {
        agentId: "missing",
        sessionKey: "agent:missing:main",
        taskOutcome: {
          taskId: "task-diag",
          outcomeVersion: closed.outcomeVersion + 1,
          agentId: "bot",
        },
      },
      "mallory",
    );
    expect(denied?.taskOutcomeEvidence).toMatchObject({ ok: false, code: "unauthorized" });
    expect(JSON.stringify(denied?.taskOutcomeEvidence)).not.toContain("success");

    const incomplete = await call({
      agentId: "missing",
      sessionKey: "agent:missing:main",
      taskId: "task-diag",
    });
    expect(incomplete?.taskOutcomeEvidence).toMatchObject({
      ok: false,
      code: "task_ref_incomplete",
    });
  });

  it("exposes the structured reject RPC and refuses a caller who only names the task", async () => {
    expect(taskOutcomeRejectPack.methods).toEqual(["task.outcome.rejectResult"]);
    const agentDir = tempDir("neg-rpc-");
    const cfg = { agents: { list: [{ id: "bot", agentDir }] } } as unknown as OpenBotConfig;
    const store = new DurableTaskOutcomeStore(path.join(agentDir, "task-outcomes"));
    const closed = closeSuccess(store, "task-rpc");
    store.close();
    const handlers = createTaskOutcomeRejectHandlers({
      cfg,
      resolveCaller: async (client) => ({
        subjectRaw: client?.platformUserId?.trim() || "",
        tenantId: "tenant-a",
      }),
    });
    const call = async (userId: string, outcomeVersion: number) => {
      let body: { ok?: boolean; code?: string; record?: { outcomeVersion?: number } } | undefined;
      await handlers["task.outcome.rejectResult"]({
        req: { type: "req", id: "r", method: "task.outcome.rejectResult" } as never,
        params: { taskId: "task-rpc", agentId: "bot", outcomeVersion },
        client: { platformUserId: userId } as never,
        isWebchatConnect: () => false,
        respond: (_ok, payload) => {
          body = payload as typeof body;
        },
        context: {} as never,
      });
      return body;
    };
    expect(await call("mallory", closed.outcomeVersion)).toMatchObject({
      ok: false,
      code: "unauthorized",
    });
    const accepted = await call("alice", closed.outcomeVersion);
    expect(accepted?.ok).toBe(true);
    expect(accepted?.record?.outcomeVersion).toBe(closed.outcomeVersion + 1);
    expect(await call("alice", closed.outcomeVersion)).toMatchObject({
      ok: false,
      code: "version_conflict",
    });
  });

  it("keeps explicit goal rewrites and refuses agentId as a writable path", async () => {
    expect(
      planInboundFeedbackDisposition("你是不是搞错了，应该是要让数字人调用这个 MCP").kind,
    ).toBe("workspace_goal");
    expect(planInboundFeedbackDisposition("请改为导出 csv").kind).toBe("workspace_goal");
    expect(planInboundFeedbackDisposition("目标是把结果写成表格").kind).toBe("workspace_goal");
    const workspace = tempDir("neg-goal-");
    fs.mkdirSync(path.join(workspace, "memory"), { recursive: true });
    const cfg = {} as OpenBotConfig;
    const contextScope = resolveTaskContextScope({
      cfg,
      workspaceDir: workspace,
      agentId: "bot",
      sessionKey: "agent:bot:main",
    });
    const bound = await createTaskContext({
      scope: contextScope,
      title: "原目标",
      description: "开源智能体平台对比",
    });
    const updated = await applyInboundTaskFeedback({
      cfg,
      workspaceDir: workspace,
      agentId: "bot",
      sessionKey: "agent:bot:main",
      sessionEntry: { sessionId: "s1", updatedAt: 1, taskContextId: bound.id },
      text: "你是不是搞错了，应该是要让数字人调用 github.com/gmood2008/tool 这个 MCP",
      sourceMessageId: "m-goal-keep",
    });
    expect(updated.workspace).toBe("updated");
    expect((await getTaskContext(contextScope, bound.id))?.description).toContain(
      "github.com/gmood2008/tool",
    );

    const agentDir = tempDir("neg-agent-bound-");
    const owned = { agents: { list: [{ id: "bot", agentDir }] } } as unknown as OpenBotConfig;
    const store = new DurableTaskOutcomeStore(path.join(agentDir, "task-outcomes"));
    closeSuccess(store, "task-owned");
    store.close();
    const outside = path.join(tempDir("neg-outside-"), "escaped");
    const escaped = rejectTaskOutcomeResult({
      cfg: owned,
      agentId: "../../etc",
      taskId: "task-owned",
      outcomeVersion: 1,
      callerSubjectRaw: "alice",
    });
    expect(escaped).toMatchObject({ ok: false, code: "agent_unresolved" });
    expect(fs.existsSync(outside)).toBe(false);
    const unknown = rejectTaskOutcomeResult({
      cfg: owned,
      agentId: "not-configured",
      taskId: "task-owned",
      outcomeVersion: 1,
      callerSubjectRaw: "alice",
    });
    expect(unknown).toMatchObject({ ok: false, code: "agent_unresolved" });
    expect(fs.existsSync(path.join(agentDir, "..", "not-configured"))).toBe(false);
  });

  it("registers the reject and diagnose methods and does not treat a body subject as authority", async () => {
    expect(listGatewayMethods()).toContain("task.outcome.rejectResult");
    expect(listGatewayMethods()).toContain("diagnosis.diagnose");
    expect(diagnosisReportsPack.methods).toContain("diagnosis.diagnose");
    expect(
      authorizeOperatorScopesForMethod("task.outcome.rejectResult", ["operator.write"]),
    ).toEqual({
      allowed: true,
    });
    expect(
      authorizeOperatorScopesForMethod("task.outcome.rejectResult", ["operator.read"]),
    ).toEqual({
      allowed: false,
      missingScope: "operator.write",
    });
    const agentDir = tempDir("neg-gw-");
    const cfg = { agents: { list: [{ id: "bot", agentDir }] } } as unknown as OpenBotConfig;
    const store = new DurableTaskOutcomeStore(path.join(agentDir, "task-outcomes"));
    const closed = closeSuccess(store, "task-gw");
    store.close();
    const handlers = createTaskOutcomeRejectHandlers({
      cfg,
      resolveCaller: async (client) => ({
        subjectRaw: client?.platformUserId?.trim() || "",
        tenantId: "tenant-a",
      }),
    });
    let spoofed: { ok?: boolean; code?: string } | undefined;
    await handlers["task.outcome.rejectResult"]({
      req: { type: "req", id: "spoof", method: "task.outcome.rejectResult" } as never,
      params: {
        taskId: "task-gw",
        agentId: "bot",
        outcomeVersion: closed.outcomeVersion,
        subjectRef: "subject:alice",
      },
      client: { platformUserId: "mallory", user: "alice@example.com" } as never,
      isWebchatConnect: () => false,
      respond: (_ok, payload) => {
        spoofed = payload as typeof spoofed;
      },
      context: {} as never,
    });
    expect(spoofed).toMatchObject({ ok: false, code: "unauthorized" });

    const respond = (ok: boolean, payload?: unknown) => {
      captured = { ok, payload };
    };
    let captured: { ok: boolean; payload?: unknown } | undefined;
    await handleGatewayRequest({
      req: {
        type: "req",
        id: "scope",
        method: "task.outcome.rejectResult",
      },
      params: { taskId: "task-gw" },
      respond,
      client: {
        connect: { role: "operator", scopes: ["operator.read"], minProtocol: 1, maxProtocol: 1 },
        platformUserId: "alice",
        sessionDomain: "enterprise",
      } as never,
      isWebchatConnect: () => false,
      context: { logGateway: { warn: () => undefined, info: () => undefined } } as never,
    });
    expect(captured?.ok).toBe(false);
  });
});
