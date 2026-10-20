/**
 * tasks.* — Task / Project context RPC (agent context lifecycle P0).
 */

import { resolveAgentWorkspaceDir, resolveSessionAgentId } from "../../agents/agent-scope.js";
import {
  bindSessionToTaskContext,
  buildTaskSummaryText,
  createTaskContext,
  getTaskContext,
  isTerminalTaskStatus,
  listTaskContexts,
  normalizeTaskStatus,
  resolveTaskContextScope,
  updateTaskContext,
} from "../../auto-reply/reply/task-context-store.js";
import { loadConfig } from "../../config/config.js";
import { resolveDefaultSessionStorePath } from "../../config/sessions/paths.js";
import { updateSessionStoreEntry } from "../../config/sessions/store.js";
import {
  employeeGlobalStewardTranscriptBlocked,
  resolveEmployeeScopedChatSessionKey,
} from "../employee-steward-session.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { stringValue } from "../records.js";
import { loadSessionEntry } from "../session-utils.js";
import { foreignEmployeeStewardAccessDenial } from "../steward-call-authorization.js";
import { assertMemoryCenterAgentAccess } from "./memory-center-access.js";
import type { GatewayRequestHandlers, RespondFn } from "./types.js";
import type { GatewayClient } from "./types.js";

async function assertTaskAgentAccess(params: {
  client: GatewayClient | null;
  agentId: string;
  respond: RespondFn;
  method: string;
}): Promise<boolean> {
  return assertMemoryCenterAgentAccess(params);
}

function readString(value: unknown): string | undefined {
  return stringValue(value) ?? undefined;
}

function denyGlobalStewardTaskSession(params: {
  client: GatewayClient | null;
  sessionKey: string;
  respond: RespondFn;
}): boolean {
  if (!employeeGlobalStewardTranscriptBlocked(params.client, params.sessionKey)) {
    return false;
  }
  params.respond(
    false,
    undefined,
    errorShape(
      ErrorCodes.INVALID_REQUEST,
      "global steward history is not available for this employee session",
    ),
  );
  return true;
}

async function clearSessionTaskContextBinds(params: {
  storePath: string;
  taskId: string;
  sessionKeys: string[];
}): Promise<void> {
  const seen = new Set<string>();
  for (const rawKey of params.sessionKeys) {
    const sessionKey = rawKey?.trim();
    if (!sessionKey || seen.has(sessionKey)) {
      continue;
    }
    seen.add(sessionKey);
    await updateSessionStoreEntry({
      storePath: params.storePath,
      sessionKey,
      update: async (entry) => {
        if (entry.taskContextId?.trim() !== params.taskId) {
          return null;
        }
        // Clear the live bind; JSON.stringify omits undefined on persist.
        return { taskContextId: undefined };
      },
    });
  }
}

function resolveTaskScopeFromParams(params: {
  sessionKey?: string;
  agentId?: string;
  cfg: ReturnType<typeof loadSessionEntry>["cfg"];
  entry?: ReturnType<typeof loadSessionEntry>["entry"];
}) {
  const agentId =
    params.agentId?.trim() ||
    (params.sessionKey
      ? resolveSessionAgentId({ sessionKey: params.sessionKey, config: params.cfg })
      : undefined);
  if (!agentId) {
    return null;
  }
  const workspaceDir = resolveAgentWorkspaceDir(params.cfg, agentId) ?? process.cwd();
  const scope = resolveTaskContextScope({
    cfg: params.cfg,
    workspaceDir,
    agentId,
    sessionKey: params.sessionKey,
    sessionEntry: params.entry,
  });
  return { agentId, workspaceDir, scope };
}

export const taskContextHandlers: GatewayRequestHandlers = {
  "tasks.list": async ({ params, respond, client }) => {
    const sessionKeyRaw = readString((params as { sessionKey?: string }).sessionKey);
    const agentIdRaw = readString((params as { agentId?: string }).agentId);
    let sessionKey: string | undefined;
    let entry: ReturnType<typeof loadSessionEntry>["entry"];
    let cfg: ReturnType<typeof loadSessionEntry>["cfg"];
    if (sessionKeyRaw) {
      sessionKey = await resolveEmployeeScopedChatSessionKey(client, sessionKeyRaw);
      if (denyGlobalStewardTaskSession({ client, sessionKey, respond })) {
        return;
      }
      const listDenial = await foreignEmployeeStewardAccessDenial(client, sessionKey);
      if (listDenial) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, listDenial));
        return;
      }
      const loaded = loadSessionEntry(sessionKey);
      cfg = loaded.cfg;
      entry = loaded.entry;
    } else if (agentIdRaw) {
      if (
        !(await assertTaskAgentAccess({
          client,
          agentId: agentIdRaw,
          respond,
          method: "tasks.list",
        }))
      ) {
        return;
      }
      cfg = loadConfig();
    } else {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "sessionKey or agentId required"),
      );
      return;
    }
    const resolved = resolveTaskScopeFromParams({
      sessionKey,
      agentId: agentIdRaw,
      cfg: cfg!,
      entry,
    });
    if (!resolved) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "unable to resolve task scope"),
      );
      return;
    }
    const tasks = await listTaskContexts(resolved.scope);
    respond(true, { tasks });
  },

  "tasks.create": async ({ params, respond, client }) => {
    const p = params as {
      sessionKey?: string;
      title?: string;
      description?: string;
      status?: string;
    };
    const sessionKeyRaw = readString(p.sessionKey);
    const title = readString(p.title);
    if (!sessionKeyRaw || !title) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "sessionKey and title required"),
      );
      return;
    }
    const sessionKey = await resolveEmployeeScopedChatSessionKey(client, sessionKeyRaw);
    if (denyGlobalStewardTaskSession({ client, sessionKey, respond })) {
      return;
    }
    const foreignStewardDenial = await foreignEmployeeStewardAccessDenial(client, sessionKey);
    if (foreignStewardDenial) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, foreignStewardDenial));
      return;
    }
    const { cfg, entry } = loadSessionEntry(sessionKey);
    const resolved = resolveTaskScopeFromParams({ sessionKey, cfg, entry });
    if (!resolved) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "unable to resolve task scope"),
      );
      return;
    }
    const status = normalizeTaskStatus(p.status) ?? "active";
    const task = await createTaskContext({
      scope: resolved.scope,
      title,
      description: p.description,
      status,
    });
    respond(true, { task });
  },

  "tasks.update": async ({ params, respond, client }) => {
    const p = params as {
      sessionKey?: string;
      taskId?: string;
      title?: string;
      description?: string;
      status?: string;
    };
    const sessionKeyRaw = readString(p.sessionKey);
    const taskId = readString(p.taskId);
    if (!sessionKeyRaw || !taskId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "sessionKey and taskId required"),
      );
      return;
    }
    const sessionKey = await resolveEmployeeScopedChatSessionKey(client, sessionKeyRaw);
    if (denyGlobalStewardTaskSession({ client, sessionKey, respond })) {
      return;
    }
    const foreignStewardDenial = await foreignEmployeeStewardAccessDenial(client, sessionKey);
    if (foreignStewardDenial) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, foreignStewardDenial));
      return;
    }
    const { cfg, entry } = loadSessionEntry(sessionKey);
    const resolved = resolveTaskScopeFromParams({ sessionKey, cfg, entry });
    if (!resolved) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "unable to resolve task scope"),
      );
      return;
    }
    const status = normalizeTaskStatus(p.status);
    const task = await updateTaskContext({
      scope: resolved.scope,
      taskId,
      patch: {
        title: readString(p.title),
        description: p.description,
        status,
      },
    });
    if (!task) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "task not found"));
      return;
    }
    // Sprint-1: terminal status clears session taskContextId / open_tasks bind.
    // Artifact detach happens inside updateTaskContext; reopen does not reattach.
    if (isTerminalTaskStatus(task.status)) {
      const { storePath } = loadSessionEntry(sessionKey);
      const agentId = resolveSessionAgentId({ sessionKey, config: cfg });
      const storePathResolved = storePath ?? resolveDefaultSessionStorePath(agentId);
      await clearSessionTaskContextBinds({
        storePath: storePathResolved,
        taskId,
        sessionKeys: [...(task.session_ids ?? []), sessionKey],
      });
    }
    respond(true, { task });
  },

  "tasks.bindSession": async ({ params, respond, client }) => {
    const p = params as { sessionKey?: string; taskId?: string };
    const sessionKeyRaw = readString(p.sessionKey);
    const taskId = readString(p.taskId);
    if (!sessionKeyRaw || !taskId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "sessionKey and taskId required"),
      );
      return;
    }
    const sessionKey = await resolveEmployeeScopedChatSessionKey(client, sessionKeyRaw);
    if (denyGlobalStewardTaskSession({ client, sessionKey, respond })) {
      return;
    }
    const foreignStewardDenial = await foreignEmployeeStewardAccessDenial(client, sessionKey);
    if (foreignStewardDenial) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, foreignStewardDenial));
      return;
    }
    const { cfg, entry, storePath } = loadSessionEntry(sessionKey);
    const resolved = resolveTaskScopeFromParams({ sessionKey, cfg, entry });
    if (!resolved || !entry) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "session not found"));
      return;
    }
    const task = await bindSessionToTaskContext({
      scope: resolved.scope,
      taskId,
      sessionKey,
      sessionId: entry.sessionId,
    });
    if (!task) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "task not found"));
      return;
    }
    const agentId = resolveSessionAgentId({ sessionKey, config: cfg });
    const storePathResolved = storePath ?? resolveDefaultSessionStorePath(agentId);
    await updateSessionStoreEntry({
      storePath: storePathResolved,
      sessionKey,
      update: async () => ({ taskContextId: taskId }),
    });
    respond(true, { task, taskContextId: taskId });
  },

  "tasks.getSummary": async ({ params, respond, client }) => {
    const p = params as { sessionKey?: string; taskId?: string };
    const sessionKeyRaw = readString(p.sessionKey);
    const taskId = readString(p.taskId);
    if (!sessionKeyRaw || !taskId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "sessionKey and taskId required"),
      );
      return;
    }
    const sessionKey = await resolveEmployeeScopedChatSessionKey(client, sessionKeyRaw);
    if (denyGlobalStewardTaskSession({ client, sessionKey, respond })) {
      return;
    }
    const foreignStewardDenial = await foreignEmployeeStewardAccessDenial(client, sessionKey);
    if (foreignStewardDenial) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, foreignStewardDenial));
      return;
    }
    const { cfg, entry } = loadSessionEntry(sessionKey);
    const resolved = resolveTaskScopeFromParams({ sessionKey, cfg, entry });
    if (!resolved) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "unable to resolve task scope"),
      );
      return;
    }
    const task = await getTaskContext(resolved.scope, taskId);
    if (!task) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "task not found"));
      return;
    }
    respond(true, { task, summary: buildTaskSummaryText(task) });
  },
};
