import path from "node:path";
import { resolveAgentDir } from "../agents/agent-scope.js";
import type { OpenBotConfig } from "../config/config.js";
import { chatTurnTaskId, scopeFromChatEntry } from "./chat-entry.js";
import { ChatTaskOutcomeAdapter } from "./entrypoints/chat.js";
import { CliTaskOutcomeAdapter } from "./entrypoints/cli.js";
import { CollabTaskOutcomeAdapter } from "./entrypoints/collab.js";
import { CronTaskOutcomeAdapter } from "./entrypoints/cron.js";
import { GatewayAgentTaskOutcomeAdapter } from "./entrypoints/gateway-agent.js";
import { SubagentTaskOutcomeAdapter } from "./entrypoints/subagent.js";
import { newFencingToken, TaskOutcomeResultService } from "./result-service.js";
import { TASK_OUTCOME_STORE_DIRNAME } from "./runtime-from-runner.js";
import { DurableTaskOutcomeStore } from "./store.js";
import type { Entrypoint, TaskOutcomeRecord, TrustedScope } from "./types.js";

export type EntrypointEnsureIdentity = {
  agentId: string;
  taskId: string;
  subjectRef: string;
  tenantId?: string;
  authzScopeRef?: string;
  taskContractVersion?: string;
};

export type EntrypointEnsureOk = {
  ok: true;
  taskId: string;
  scope: TrustedScope;
  fencingToken: string;
  record: TaskOutcomeRecord;
  entrypoint: Entrypoint;
};

export type EntrypointEnsureErr = {
  ok: false;
  code: string;
  message: string;
};

function openWithAdapter(
  cfg: OpenBotConfig,
  identity: EntrypointEnsureIdentity,
  entrypoint: Entrypoint,
  open: (
    service: TaskOutcomeResultService,
  ) =>
    | { ok: true; record: TaskOutcomeRecord; fencingToken: string }
    | { ok: false; code: string; message: string },
): EntrypointEnsureOk | EntrypointEnsureErr {
  const scope = scopeFromChatEntry({
    agentId: identity.agentId,
    runId: identity.taskId,
    subjectRef: identity.subjectRef,
    tenantId: identity.tenantId,
    authzScopeRef: identity.authzScopeRef ?? `${entrypoint}-entry`,
  });
  const root = path.join(resolveAgentDir(cfg, identity.agentId), TASK_OUTCOME_STORE_DIRNAME);
  const store = new DurableTaskOutcomeStore(root);
  const service = new TaskOutcomeResultService({
    store,
    submittedBy: `${entrypoint}-entry`,
  });
  const opened = open(service);
  if (!opened.ok) {
    return { ok: false, code: opened.code, message: opened.message };
  }
  return {
    ok: true,
    taskId: identity.taskId,
    scope,
    fencingToken: opened.fencingToken || newFencingToken(),
    record: opened.record,
    entrypoint,
  };
}

/** cron: each fire = new taskId; same-fire retry reuses. */
export function cronTurnTaskId(params: { jobId: string; fireId: string }): string {
  return `cron:${params.jobId.trim()}:${params.fireId.trim()}`;
}

export function ensureCronTurnTaskOutcome(
  cfg: OpenBotConfig,
  identity: {
    agentId: string;
    jobId: string;
    fireId: string;
    subjectRef: string;
    tenantId?: string;
    authzScopeRef?: string;
    taskContractVersion?: string;
  },
): EntrypointEnsureOk | EntrypointEnsureErr {
  const taskId = cronTurnTaskId({ jobId: identity.jobId, fireId: identity.fireId });
  return openWithAdapter(cfg, { ...identity, taskId }, "cron", (service) =>
    new CronTaskOutcomeAdapter(service).openTask({
      taskId,
      scope: scopeFromChatEntry({
        agentId: identity.agentId,
        runId: taskId,
        subjectRef: identity.subjectRef,
        tenantId: identity.tenantId,
        authzScopeRef: identity.authzScopeRef ?? "cron-entry",
      }),
      taskContractVersion: identity.taskContractVersion ?? "1.0.0",
    }),
  );
}

export function cliTurnTaskId(params: { agentId: string; runId: string }): string {
  return `cli:${params.agentId.trim()}:${params.runId.trim()}`;
}

export function ensureCliTurnTaskOutcome(
  cfg: OpenBotConfig,
  identity: {
    agentId: string;
    runId: string;
    subjectRef: string;
    tenantId?: string;
    authzScopeRef?: string;
    taskContractVersion?: string;
  },
): EntrypointEnsureOk | EntrypointEnsureErr {
  const taskId = cliTurnTaskId({ agentId: identity.agentId, runId: identity.runId });
  return openWithAdapter(cfg, { ...identity, taskId }, "cli", (service) =>
    new CliTaskOutcomeAdapter(service).openTask({
      taskId,
      scope: scopeFromChatEntry({
        agentId: identity.agentId,
        runId: taskId,
        subjectRef: identity.subjectRef,
        tenantId: identity.tenantId,
        authzScopeRef: identity.authzScopeRef ?? "cli-entry",
      }),
      taskContractVersion: identity.taskContractVersion ?? "1.0.0",
    }),
  );
}

/** Collab claim/accept association: taskId includes board item + claim id. */
export function collabTurnTaskId(params: {
  groupId: string;
  boardItemId: string;
  claimId: string;
}): string {
  return `collab:${params.groupId.trim()}:${params.boardItemId.trim()}:${params.claimId.trim()}`;
}

export function ensureCollabTurnTaskOutcome(
  cfg: OpenBotConfig,
  identity: {
    agentId: string;
    groupId: string;
    boardItemId: string;
    claimId: string;
    subjectRef: string;
    tenantId?: string;
    authzScopeRef?: string;
    taskContractVersion?: string;
  },
): EntrypointEnsureOk | EntrypointEnsureErr {
  const taskId = collabTurnTaskId({
    groupId: identity.groupId,
    boardItemId: identity.boardItemId,
    claimId: identity.claimId,
  });
  return openWithAdapter(cfg, { ...identity, taskId }, "collab", (service) =>
    new CollabTaskOutcomeAdapter(service).openTask({
      taskId,
      scope: scopeFromChatEntry({
        agentId: identity.agentId,
        runId: taskId,
        subjectRef: identity.subjectRef,
        tenantId: identity.tenantId,
        authzScopeRef: identity.authzScopeRef ?? "collab-entry",
      }),
      taskContractVersion: identity.taskContractVersion ?? "1.0.0",
    }),
  );
}

export function subagentTurnTaskId(params: { agentId: string; runId: string }): string {
  return `subagent:${params.agentId.trim()}:${params.runId.trim()}`;
}

/**
 * Link a child run to a parent tip only when that tip already exists.
 * Candidates are the real entrypoint task ids for the parent run — no agentId guess.
 */
export function resolveLinkedParentTaskId(
  cfg: OpenBotConfig,
  params: { parentAgentId: string; parentRunId: string; parentSessionKey?: string },
): string | undefined {
  const parentAgentId = params.parentAgentId.trim();
  const parentRunId = params.parentRunId.trim();
  if (!parentAgentId || !parentRunId) {
    return undefined;
  }
  const sessionKey = params.parentSessionKey?.trim();
  const candidates = [
    chatTurnTaskId({
      agentId: parentAgentId,
      runId: parentRunId,
      ...(sessionKey ? { sessionKey } : {}),
    }),
    chatTurnTaskId({ agentId: parentAgentId, runId: parentRunId }),
    cliTurnTaskId({ agentId: parentAgentId, runId: parentRunId }),
    gatewayAgentTurnTaskId({ agentId: parentAgentId, runId: parentRunId }),
    subagentTurnTaskId({ agentId: parentAgentId, runId: parentRunId }),
  ];
  const store = new DurableTaskOutcomeStore(
    path.join(resolveAgentDir(cfg, parentAgentId), TASK_OUTCOME_STORE_DIRNAME),
  );
  const seen = new Set<string>();
  for (const taskId of candidates) {
    if (seen.has(taskId)) {
      continue;
    }
    seen.add(taskId);
    if (store.loadTask(taskId)) {
      return taskId;
    }
  }
  return undefined;
}

export function ensureSubagentTurnTaskOutcome(
  cfg: OpenBotConfig,
  identity: {
    agentId: string;
    runId: string;
    subjectRef: string;
    tenantId?: string;
    authzScopeRef?: string;
    taskContractVersion?: string;
    parentTaskId?: string;
  },
): EntrypointEnsureOk | EntrypointEnsureErr {
  const taskId = subagentTurnTaskId({ agentId: identity.agentId, runId: identity.runId });
  const scope = scopeFromChatEntry({
    agentId: identity.agentId,
    runId: taskId,
    subjectRef: identity.subjectRef,
    tenantId: identity.tenantId,
    authzScopeRef: identity.authzScopeRef ?? "subagent-entry",
  });
  return openWithAdapter(cfg, { ...identity, taskId }, "subagent", (service) =>
    new SubagentTaskOutcomeAdapter(service).openTask({
      taskId,
      scope,
      taskContractVersion: identity.taskContractVersion ?? "1.0.0",
      ...(identity.parentTaskId?.trim() ? { parentTaskId: identity.parentTaskId.trim() } : {}),
    }),
  );
}

export function gatewayAgentTurnTaskId(params: { agentId: string; runId: string }): string {
  return `gateway_agent:${params.agentId.trim()}:${params.runId.trim()}`;
}

export function ensureGatewayAgentTurnTaskOutcome(
  cfg: OpenBotConfig,
  identity: {
    agentId: string;
    runId: string;
    subjectRef: string;
    tenantId?: string;
    authzScopeRef?: string;
    taskContractVersion?: string;
  },
): EntrypointEnsureOk | EntrypointEnsureErr {
  const taskId = gatewayAgentTurnTaskId({
    agentId: identity.agentId,
    runId: identity.runId,
  });
  return openWithAdapter(cfg, { ...identity, taskId }, "gateway_agent", (service) =>
    new GatewayAgentTaskOutcomeAdapter(service).openTask({
      taskId,
      scope: scopeFromChatEntry({
        agentId: identity.agentId,
        runId: taskId,
        subjectRef: identity.subjectRef,
        tenantId: identity.tenantId,
        authzScopeRef: identity.authzScopeRef ?? "gateway-agent-entry",
      }),
      taskContractVersion: identity.taskContractVersion ?? "1.0.0",
    }),
  );
}

/**
 * Follow-up turns reuse chat entrypoint identity (continuation of a chat turn),
 * with a stable followup-scoped taskId so tips land under chat.
 */
/**
 * askOutcome W1 followup semantics (independent child):
 * - Stable identity = enqueue-time `followupItemId` (not a fresh random per drain).
 * - taskId = chat:{agent}:followup:{session?}:{followupItemId}
 * - Optional parentTaskId links to the originating user/chat/collab task.
 * - Agent runId remains a separate correlation id for registerAgentRunContext.
 */
export function followupTurnTaskId(params: {
  agentId: string;
  /** Stable followupItemId (preferred) or legacy runId alias. */
  runId: string;
  sessionKey?: string;
}): string {
  const session = params.sessionKey?.trim();
  if (session) {
    return `chat:${params.agentId}:followup:${session}:${params.runId}`;
  }
  return `chat:${params.agentId}:followup:${params.runId}`;
}

export function ensureFollowupTurnTaskOutcome(
  cfg: OpenBotConfig,
  identity: {
    agentId: string;
    /** Stable followupItemId allocated at enqueue. */
    runId: string;
    sessionKey?: string;
    subjectRef: string;
    tenantId?: string;
    authzScopeRef?: string;
    taskContractVersion?: string;
    parentTaskId?: string;
  },
): EntrypointEnsureOk | EntrypointEnsureErr {
  const taskId = followupTurnTaskId({
    agentId: identity.agentId,
    runId: identity.runId,
    sessionKey: identity.sessionKey,
  });
  return openWithAdapter(cfg, { ...identity, taskId }, "chat", (service) =>
    new ChatTaskOutcomeAdapter(service).createOrRestore({
      taskId,
      scope: scopeFromChatEntry({
        agentId: identity.agentId,
        runId: taskId,
        subjectRef: identity.subjectRef,
        tenantId: identity.tenantId,
        authzScopeRef: identity.authzScopeRef ?? "followup-entry",
      }),
      taskContractVersion: identity.taskContractVersion ?? "1.0.0",
      commandId: `entry:${taskId}`,
      ...(identity.parentTaskId?.trim() ? { parentTaskId: identity.parentTaskId.trim() } : {}),
    }),
  );
}
