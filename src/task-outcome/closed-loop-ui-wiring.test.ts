/**
 * Subject-scoped rejection and the diagnosis rows that read that version.
 * operator.write and operator.admin do not grant the method.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../config/config.js";
import { createDiagnosisReportGatewayHandlers } from "../diagnosis/report-query-gateway.js";
import type { TaskOutcomeEvidence } from "../diagnosis/task-outcome-evidence.js";
import {
  adminScopeSubstitutesForMethod,
  authorizeOperatorScopesForMethod,
} from "../gateway/method-scopes.js";
import { handleGatewayRequest } from "../gateway/server-methods.js";
import { createTaskOutcomeRejectHandlers } from "../gateway/server-methods/task-outcome-reject.js";
import { taskOutcomeRejectPack } from "../gateway/server-methods/task-outcome-reject.pack.js";
import { ChatTaskOutcomeAdapter } from "./entrypoints/chat.js";
import { TaskOutcomeResultService } from "./result-service.js";
import { DurableTaskOutcomeStore } from "./store.js";
import type { TrustedScope } from "./types.js";

const personal: TrustedScope = {
  kind: "personal",
  personalDomainId: "personal:subject-alice",
  subjectRef: "subject:alice",
  authzScopeRef: "scope:ui-wiring",
};

const historical: TrustedScope = {
  kind: "personal",
  personalDomainId: "personal:session",
  subjectRef: "agent:bot:main",
  authzScopeRef: "scope:ui-wiring",
};

const enterprise: TrustedScope = {
  kind: "enterprise",
  enterpriseDomainId: "enterprise:tenant-a",
  tenantId: "tenant-a",
  subjectRef: "subject:alice",
  authzScopeRef: "scope:ui-wiring",
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

function closeOwned(store: DurableTaskOutcomeStore, taskId: string, scope: TrustedScope) {
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
      toolObservations: [],
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
    `delivery:${taskId}`,
    { scope, commandId: `delivery:${taskId}` },
  );
  if (!delivered.ok) {
    throw new Error(delivered.message);
  }
  return delivered.record;
}

function client(scopes: string[], platformUserId?: string) {
  return {
    connect: { role: "operator", scopes, minProtocol: 1, maxProtocol: 1 },
    ...(platformUserId ? { platformUserId } : {}),
    sessionDomain: "enterprise",
  } as never;
}

describe("closed-loop ui wiring authorization", () => {
  it("rejects operator scopes and lets only the matching subject append a correction", async () => {
    expect(taskOutcomeRejectPack.scopes["operator.write"] ?? []).not.toContain(
      "task.outcome.rejectResult",
    );
    expect(adminScopeSubstitutesForMethod("task.outcome.rejectResult")).toBe(false);
    for (const scopes of [["operator.admin"], ["operator.write"], ["operator.read"]]) {
      expect(authorizeOperatorScopesForMethod("task.outcome.rejectResult", scopes)).toEqual({
        allowed: false,
        missingScope: "operator.approvals",
      });
    }

    const agentDir = tempDir("ui-wire-");
    const cfg = { agents: { list: [{ id: "bot", agentDir }] } } as unknown as OpenBotConfig;
    const store = new DurableTaskOutcomeStore(path.join(agentDir, "task-outcomes"));
    const closed = closeOwned(store, "task-ui", personal);
    store.close();
    const handlers = createTaskOutcomeRejectHandlers({ cfg });

    const call = async (scopes: string[], platformUserId?: string) => {
      let captured: { ok: boolean; payload?: Record<string, unknown> } | undefined;
      await handleGatewayRequest({
        req: {
          type: "req",
          id: "reject",
          method: "task.outcome.rejectResult",
          params: {
            taskId: "task-ui",
            agentId: "bot",
            outcomeVersion: closed.outcomeVersion,
          },
        } as never,
        respond: (ok, payload) => {
          captured = {
            ok,
            payload:
              payload && typeof payload === "object"
                ? (payload as Record<string, unknown>)
                : undefined,
          };
        },
        client: client(scopes, platformUserId),
        isWebchatConnect: () => false,
        context: { logGateway: { warn: () => undefined, info: () => undefined } } as never,
        extraHandlers: handlers,
      });
      return captured;
    };

    const admin = await call(["operator.admin"], "mallory");
    expect(admin?.ok).toBe(true);
    expect(admin?.payload).toMatchObject({ ok: false, code: "unauthorized" });

    const write = await call(["operator.write"], "mallory");
    expect(write?.payload).toMatchObject({ ok: false, code: "unauthorized" });

    const anonymous = await call(["operator.admin", "operator.write"]);
    expect(anonymous?.ok).toBe(false);

    const subject = await call(["operator.read"], "alice");
    expect(subject?.ok).toBe(true);
    const record = subject?.payload?.record as
      | { taskJudgement?: string; revisionKind?: string; outcomeVersion?: number }
      | undefined;
    expect(subject?.payload?.ok).toBe(true);
    expect(record?.taskJudgement).toBe("failure");
    expect(record?.revisionKind).toBe("correction");
    expect(record?.outcomeVersion).toBe(closed.outcomeVersion + 1);

    const conflict = await call(["operator.read"], "alice");
    expect(conflict?.payload).toMatchObject({ ok: false, code: "version_conflict" });

    const diagnose = createDiagnosisReportGatewayHandlers(
      undefined,
      { resolveMembership: async () => ({ tenantId: "tenant-a", userId: "alice" }) },
      { taskOutcomeCfg: cfg },
    );
    let evidenceBody: { taskOutcomeEvidence?: TaskOutcomeEvidence } | undefined;
    await diagnose["diagnosis.diagnose"]({
      req: { type: "req", id: "d", method: "diagnosis.diagnose" } as never,
      params: {
        agentId: "bot",
        sessionKey: "agent:bot:main",
        taskOutcome: {
          taskId: "task-ui",
          agentId: "bot",
          outcomeVersion: closed.outcomeVersion + 1,
        },
      },
      client: { platformUserId: "alice", sessionDomain: "enterprise" } as never,
      isWebchatConnect: () => false,
      respond: (_ok, payload) => {
        evidenceBody = payload as typeof evidenceBody;
      },
      context: {} as never,
    });
    expect(evidenceBody?.taskOutcomeEvidence).toMatchObject({
      ok: true,
      taskId: "task-ui",
      outcomeVersion: closed.outcomeVersion + 1,
      judgement: "failure",
      revisionKind: "correction",
    });

    const otherTenant = createTaskOutcomeRejectHandlers({
      cfg: { agents: { list: [{ id: "bot", agentDir }] } } as unknown as OpenBotConfig,
      resolveCaller: async () => ({ subjectRaw: "alice", tenantId: "tenant-b" }),
    });
    const enterpriseStore = new DurableTaskOutcomeStore(path.join(agentDir, "task-outcomes"));
    const enterpriseClosed = closeOwned(enterpriseStore, "task-ent", enterprise);
    enterpriseStore.close();
    let tenantBody: { ok?: boolean; code?: string } | undefined;
    await otherTenant["task.outcome.rejectResult"]({
      req: { type: "req", id: "t", method: "task.outcome.rejectResult" } as never,
      params: {
        taskId: "task-ent",
        agentId: "bot",
        outcomeVersion: enterpriseClosed.outcomeVersion,
      },
      client: { platformUserId: "alice" } as never,
      isWebchatConnect: () => false,
      respond: (_ok, payload) => {
        tenantBody = payload as typeof tenantBody;
      },
      context: {} as never,
    });
    expect(tenantBody).toMatchObject({ ok: false, code: "unauthorized" });

    const historyStore = new DurableTaskOutcomeStore(path.join(agentDir, "task-outcomes"));
    const historyClosed = closeOwned(historyStore, "task-old", historical);
    const before = historyStore.loadTask("task-old");
    historyStore.close();
    const historyHandlers = createTaskOutcomeRejectHandlers({ cfg });
    let historyBody: { ok?: boolean; code?: string } | undefined;
    await historyHandlers["task.outcome.rejectResult"]({
      req: { type: "req", id: "h", method: "task.outcome.rejectResult" } as never,
      params: {
        taskId: "task-old",
        agentId: "bot",
        outcomeVersion: historyClosed.outcomeVersion,
      },
      client: { platformUserId: "alice" } as never,
      isWebchatConnect: () => false,
      respond: (_ok, payload) => {
        historyBody = payload as typeof historyBody;
      },
      context: {} as never,
    });
    expect(historyBody).toMatchObject({ ok: false, code: "unauthorized" });
    const afterStore = new DurableTaskOutcomeStore(path.join(agentDir, "task-outcomes"));
    expect(afterStore.loadTask("task-old")?.scope.subjectRef).toBe(before?.scope.subjectRef);
    expect(afterStore.loadTask("task-old")?.outcomeVersion).toBe(historyClosed.outcomeVersion);
    afterStore.close();
  });
});
