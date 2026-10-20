/**
 * server-methods/supervisor.ts — gateway API for Development Supervisor.
 *
 * This is the missing "production wiring" entry-point that the supervisor
 * engine/modules require in order to run in real gateway requests.
 *
 * Methods:
 *  - supervisor.task.create
 *  - supervisor.task.get
 *  - supervisor.task.list
 *  - supervisor.task.abort
 *  - supervisor.task.subscribe
 *  - supervisor.task.audit
 *  - supervisor.template.list
 *  - supervisor.worker.list
 *  - supervisor.worker.health
 *  - supervisor.worker.policy.list
 *  - supervisor.worker.policy.upsert
 *  - supervisor.worker.policy.remove
 *  - supervisor.node.list
 *  - supervisor.node.bind
 *  - supervisor.node.unbind
 *  - supervisor.node.bindingRequest.create
 *  - supervisor.node.bindingRequest.list
 *  - supervisor.node.bindingRequest.resolve
 *  - supervisor.runner.status
 */

import { queryCliBackendUsage } from "../../agents/cli-backend-usage-attribution.js";
import { loadConfig, writeConfigFile } from "../../config/config.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { abortSupervisedTask } from "../supervisor/driver.js";
import type { SupervisorPorts } from "../supervisor/engine.js";
import { registerSupervisorTaskEventRecipient } from "../supervisor/events.js";
import { GatewayPlacementResolver } from "../supervisor/execution-context.js";
import { isSupervisorRunnerEnabled, resolveSupervisorRunnerConfig } from "../supervisor/feature.js";
import { isSupervisorEnabled } from "../supervisor/feature.js";
import { createDefaultNodeAgentRegistry } from "../supervisor/node-agent-registry.js";
import { NodeRegistryInvokePort } from "../supervisor/node-invoke-port.js";
import {
  createNodeSeatBindingRequest,
  listNodeSeatBindingRequests,
  resolveNodeSeatBindingRequest,
} from "../supervisor/node-seat-binding-request-store.js";
import {
  listNodeSeatBindings,
  removeNodeSeatBinding,
  upsertNodeSeatBinding,
} from "../supervisor/node-seat-binding-store.js";
import { listSupervisorNodeSessions } from "../supervisor/node-sessions.js";
import { readSupervisorReportEvents } from "../supervisor/reporter.js";
import { getSupervisorRunnerStatus, listSupervisorLeases } from "../supervisor/runner.js";
import { getTask, listTasks } from "../supervisor/store.js";
import { listActiveTasks } from "../supervisor/store.js";
import {
  isSupervisedTaskVisibleToScope,
  resolveSupervisedTaskCreateIdentity,
  resolveSupervisorTaskAccessScope,
} from "../supervisor/task-access-scope.js";
import {
  createSupervisedTask,
  SupervisorTaskCreateError,
} from "../supervisor/task-create-service.js";
import {
  SUPERVISOR_REPO_AUTO_TEMPLATE_ID,
  listSupervisorTaskTemplates,
} from "../supervisor/templates.js";
import { listSupervisorWorkerHealth } from "../supervisor/worker-health.js";
import {
  listWorkerExecutionPolicies,
  removeWorkerExecutionPolicy,
  resolveWorkerPolicyWriteActor,
  upsertWorkerExecutionPolicy,
  validateWorkerExecutionPolicy,
} from "../supervisor/worker-policy-store.js";
import { listSupervisorWorkers } from "../supervisor/workers.js";
import { getFabricAuditStore } from "./fabric.js";
import type { GatewayClient, GatewayRequestHandlers, RespondFn } from "./types.js";

let portsProvider: (() => SupervisorPorts | null) | null = null;

export function setSupervisorPortsProvider(provider: (() => SupervisorPorts | null) | null): void {
  portsProvider = provider;
}

export function getSupervisorPorts(): SupervisorPorts | null {
  return portsProvider ? portsProvider() : null;
}

function getPorts(): SupervisorPorts | null {
  return getSupervisorPorts();
}

function requireString(
  params: Record<string, unknown>,
  key: string,
  respond: RespondFn,
): string | null {
  const raw = params[key];
  const value = typeof raw === "string" || typeof raw === "number" ? String(raw) : "";
  const trimmed = value.trim();
  if (!trimmed) {
    respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, `missing ${key}`));
    return null;
  }
  return trimmed;
}

function requireOptionalString(params: Record<string, unknown>, key: string): string | undefined {
  const raw = params[key];
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    return trimmed ? trimmed : undefined;
  }
  if (typeof raw === "number") {
    const trimmed = String(raw).trim();
    return trimmed ? trimmed : undefined;
  }
  return undefined;
}

function requireSupervisorEnabled(respond: RespondFn): boolean {
  if (!isSupervisorEnabled()) {
    respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, "supervisor is not enabled"));
    return false;
  }
  return true;
}

async function requireSupervisorTaskAccessScope(params: {
  client: GatewayClient | null | undefined;
  requestedTenantId?: string;
  requestedUserId?: string;
  respond: RespondFn;
}): Promise<Awaited<ReturnType<typeof resolveSupervisorTaskAccessScope>>> {
  const scope = await resolveSupervisorTaskAccessScope({
    client: params.client,
    requestedTenantId: params.requestedTenantId,
    requestedUserId: params.requestedUserId,
  });
  if (!scope) {
    params.respond(
      false,
      undefined,
      errorShape(ErrorCodes.INVALID_REQUEST, "Active workbench session is required."),
    );
    return null;
  }
  return scope;
}

function denySupervisedTaskNotFound(respond: RespondFn): void {
  respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "supervised task not found"));
}

export const supervisorHandlers: GatewayRequestHandlers = {
  "supervisor.template.list": ({ respond }) => {
    if (!requireSupervisorEnabled(respond)) {
      return;
    }
    respond(
      true,
      {
        templates: listSupervisorTaskTemplates(),
        repoAutoTemplateId: SUPERVISOR_REPO_AUTO_TEMPLATE_ID,
      },
      undefined,
    );
  },

  "supervisor.worker.list": ({ respond }) => {
    if (!requireSupervisorEnabled(respond)) {
      return;
    }
    const cfg = loadConfig();
    respond(true, { workers: listSupervisorWorkers(cfg) }, undefined);
  },

  "supervisor.worker.health": async ({ params, respond, context }) => {
    if (!requireSupervisorEnabled(respond)) {
      return;
    }
    const tenantId = typeof params.tenantId === "string" ? params.tenantId.trim() : undefined;
    const seatId = typeof params.seatId === "string" ? params.seatId.trim() : undefined;
    const backendId = typeof params.backendId === "string" ? params.backendId.trim() : undefined;
    const cfg = loadConfig();
    const nodeInvoke = new NodeRegistryInvokePort(context.nodeRegistry);
    const placementResolver = new GatewayPlacementResolver(
      createDefaultNodeAgentRegistry(context.nodeRegistry),
    );
    const workers = await listSupervisorWorkerHealth({
      cfg,
      nodeInvoke,
      placementResolver,
      ...(tenantId ? { tenantId } : {}),
      ...(seatId ? { seatId } : {}),
      ...(backendId ? { backendId } : {}),
    });
    respond(true, { workers }, undefined);
  },

  "supervisor.worker.policy.list": async ({ params, respond }) => {
    if (!requireSupervisorEnabled(respond)) {
      return;
    }
    const tenantId = typeof params.tenantId === "string" ? params.tenantId.trim() : "";
    if (!tenantId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "tenantId is required"));
      return;
    }
    const policies = await listWorkerExecutionPolicies(tenantId);
    respond(true, { policies }, undefined);
  },

  "supervisor.worker.policy.upsert": async ({ params, respond, client }) => {
    if (!requireSupervisorEnabled(respond)) {
      return;
    }
    const tenantId = typeof params.tenantId === "string" ? params.tenantId.trim() : "";
    const workerId = typeof params.workerId === "string" ? params.workerId.trim() : "";
    if (!tenantId || !workerId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "tenantId and workerId are required"),
      );
      return;
    }
    try {
      const profile = validateWorkerExecutionPolicy({
        credentialPolicy: params.credentialPolicy,
        executionPlacement: params.executionPlacement,
      });
      const policy = await upsertWorkerExecutionPolicy({
        tenantId,
        workerId,
        ...profile,
        actor: resolveWorkerPolicyWriteActor(client),
      });
      respond(true, { policy }, undefined);
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, err instanceof Error ? err.message : String(err)),
      );
    }
  },

  "supervisor.worker.policy.remove": async ({ params, respond, client }) => {
    if (!requireSupervisorEnabled(respond)) {
      return;
    }
    const tenantId = typeof params.tenantId === "string" ? params.tenantId.trim() : "";
    const workerId = typeof params.workerId === "string" ? params.workerId.trim() : "";
    if (!tenantId || !workerId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "tenantId and workerId are required"),
      );
      return;
    }
    try {
      const removed = await removeWorkerExecutionPolicy(
        tenantId,
        workerId,
        resolveWorkerPolicyWriteActor(client),
      );
      respond(true, { removed }, undefined);
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, err instanceof Error ? err.message : String(err)),
      );
    }
  },

  "supervisor.node.list": ({ respond, context }) => {
    if (!requireSupervisorEnabled(respond)) {
      return;
    }
    respond(true, { nodes: listSupervisorNodeSessions(context.nodeRegistry) }, undefined);
  },

  "supervisor.node.bind": async ({ params, respond }) => {
    if (!requireSupervisorEnabled(respond)) {
      return;
    }
    const tenantId = typeof params.tenantId === "string" ? params.tenantId.trim() : "";
    const seatId = typeof params.seatId === "string" ? params.seatId.trim() : "";
    const nodeId = typeof params.nodeId === "string" ? params.nodeId.trim() : "";
    if (!tenantId || !seatId || !nodeId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "tenantId, seatId, and nodeId are required"),
      );
      return;
    }
    try {
      const binding = await upsertNodeSeatBinding({ tenantId, seatId, nodeId });
      respond(true, { binding }, undefined);
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, err instanceof Error ? err.message : String(err)),
      );
    }
  },

  "supervisor.node.unbind": async ({ params, respond }) => {
    if (!requireSupervisorEnabled(respond)) {
      return;
    }
    const tenantId = typeof params.tenantId === "string" ? params.tenantId.trim() : "";
    const seatId = typeof params.seatId === "string" ? params.seatId.trim() : "";
    if (!tenantId || !seatId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "tenantId and seatId are required"),
      );
      return;
    }
    const removed = await removeNodeSeatBinding(tenantId, seatId);
    respond(true, { removed }, undefined);
  },

  "supervisor.node.bindings.list": async ({ params, respond }) => {
    if (!requireSupervisorEnabled(respond)) {
      return;
    }
    const tenantId = typeof params.tenantId === "string" ? params.tenantId.trim() : "";
    if (!tenantId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "tenantId is required"));
      return;
    }
    const bindings = await listNodeSeatBindings(tenantId);
    respond(true, { bindings }, undefined);
  },

  "supervisor.node.bindingRequest.create": async ({ params, respond, context, client }) => {
    if (!requireSupervisorEnabled(respond)) {
      return;
    }
    const tenantId = typeof params.tenantId === "string" ? params.tenantId.trim() : "";
    const seatId = typeof params.seatId === "string" ? params.seatId.trim() : "";
    const userId =
      typeof params.userId === "string" && params.userId.trim()
        ? params.userId.trim()
        : client?.user?.trim() || undefined;
    const nodeId = typeof params.nodeId === "string" ? params.nodeId.trim() : "";
    if (!tenantId || !seatId || !nodeId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "tenantId, seatId, and nodeId are required"),
      );
      return;
    }
    const node = listSupervisorNodeSessions(context.nodeRegistry).find(
      (entry) => entry.nodeId === nodeId,
    );
    if (!node) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "node is not online"));
      return;
    }
    if (!node.supportsSupervisorWorker) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "node does not support supervisor worker"),
      );
      return;
    }
    try {
      const request = await createNodeSeatBindingRequest({
        tenantId,
        seatId,
        ...(userId ? { userId } : {}),
        nodeId,
        ...(node.displayName ? { nodeDisplayName: node.displayName } : {}),
      });
      respond(true, { request }, undefined);
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, err instanceof Error ? err.message : String(err)),
      );
    }
  },

  "supervisor.node.bindingRequest.list": async ({ params, respond }) => {
    if (!requireSupervisorEnabled(respond)) {
      return;
    }
    const tenantId = typeof params.tenantId === "string" ? params.tenantId.trim() : "";
    if (!tenantId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "tenantId is required"));
      return;
    }
    const status =
      params.status === "all" || params.status === "approved" || params.status === "rejected"
        ? params.status
        : "pending";
    const seatId =
      typeof params.seatId === "string" && params.seatId.trim() ? params.seatId.trim() : undefined;
    const requests = await listNodeSeatBindingRequests({
      tenantId,
      ...(seatId ? { seatId } : {}),
      status,
    });
    respond(true, { requests }, undefined);
  },

  "supervisor.node.bindingRequest.resolve": async ({ params, respond, client }) => {
    if (!requireSupervisorEnabled(respond)) {
      return;
    }
    const requestId = typeof params.requestId === "string" ? params.requestId.trim() : "";
    const decision =
      params.decision === "approved" || params.decision === "rejected" ? params.decision : "";
    if (!requestId || !decision) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "requestId and decision are required"),
      );
      return;
    }
    const request = await resolveNodeSeatBindingRequest({
      requestId,
      decision,
      decidedBy: client?.user,
      reason: typeof params.reason === "string" ? params.reason : undefined,
    });
    if (!request) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "binding request not found"),
      );
      return;
    }
    if (decision === "rejected") {
      respond(true, { request }, undefined);
      return;
    }
    const binding = await upsertNodeSeatBinding({
      tenantId: request.tenantId,
      seatId: request.seatId,
      nodeId: request.nodeId,
    });
    respond(true, { request, binding }, undefined);
  },

  "supervisor.runner.status": async ({ respond }) => {
    if (!requireSupervisorEnabled(respond)) {
      return;
    }
    const runnerEnabled = isSupervisorRunnerEnabled();
    const config = resolveSupervisorRunnerConfig(loadConfig());
    const status = getSupervisorRunnerStatus(config, runnerEnabled);
    const active = await listActiveTasks();
    respond(
      true,
      {
        ...status,
        queuedCandidates: active.length,
        leases: listSupervisorLeases(),
      },
      undefined,
    );
  },

  "supervisor.task.create": async ({ params, client, respond }) => {
    const ports = getPorts();
    if (!ports) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, "supervisor runtime unavailable"),
      );
      return;
    }
    if (typeof params !== "object" || params === null) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "invalid params"));
      return;
    }
    const p = params;
    const goal = requireString(p, "goal", respond);
    const repoRoot = requireString(p, "repoRoot", respond);
    if (!goal || !repoRoot) {
      return;
    }
    const backendIdRaw =
      p.workerBackendId ?? (p.worker as { backendId?: unknown } | undefined)?.backendId;
    const modelRaw = p.workerModel ?? (p.worker as { model?: unknown } | undefined)?.model;
    const workerBackendId = typeof backendIdRaw === "string" ? backendIdRaw.trim() : "";
    const workerModel =
      typeof modelRaw === "string" && modelRaw.trim() ? modelRaw.trim() : undefined;
    if (!workerBackendId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing workerBackendId"));
      return;
    }
    const requestedTenantId = requireOptionalString(p, "tenantId");
    const requestedUserId = requireOptionalString(p, "userId");
    const requestedSeatId = requireOptionalString(p, "seatId");
    const scope = await requireSupervisorTaskAccessScope({
      client,
      requestedTenantId,
      requestedUserId,
      respond,
    });
    if (!scope) {
      return;
    }
    const identity = resolveSupervisedTaskCreateIdentity({
      scope,
      requestedTenantId,
      requestedUserId,
    });
    try {
      const created = await createSupervisedTask(
        {
          goal,
          repoRoot,
          workerBackendId,
          workerModel,
          taskId: typeof p.taskId === "string" && p.taskId.trim() ? p.taskId.trim() : undefined,
          tenantId: identity.tenantId,
          userId: identity.userId,
          seatId: requestedSeatId,
          agentId: requireOptionalString(p, "agentId"),
          templateId: requireOptionalString(p, "templateId"),
          acceptance: p.acceptance,
        },
        { ports },
      );
      respond(true, created, undefined);
    } catch (err) {
      if (err instanceof SupervisorTaskCreateError) {
        respond(
          false,
          undefined,
          errorShape(
            err.code === "UNAVAILABLE" ? ErrorCodes.UNAVAILABLE : ErrorCodes.INVALID_REQUEST,
            err.message,
          ),
        );
        return;
      }
      throw err;
    }
  },

  "supervisor.task.get": async ({ params, client, respond }) => {
    if (!isSupervisorEnabled()) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, "supervisor is not enabled"));
      return;
    }
    const ports = getPorts();
    if (!ports) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, "supervisor runtime unavailable"),
      );
      return;
    }
    if (typeof params !== "object" || params === null) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "invalid params"));
      return;
    }
    const p = params;
    const taskId = requireString(p, "taskId", respond);
    if (!taskId) {
      return;
    }

    const scope = await requireSupervisorTaskAccessScope({
      client,
      requestedTenantId: requireOptionalString(p, "tenantId"),
      requestedUserId: requireOptionalString(p, "userId"),
      respond,
    });
    if (!scope) {
      return;
    }

    const found = await getTask(taskId);
    if (!found || !isSupervisedTaskVisibleToScope(found, scope)) {
      denySupervisedTaskNotFound(respond);
      return;
    }
    respond(true, found, undefined);
  },

  "supervisor.task.list": async ({ params, client, respond }) => {
    if (!isSupervisorEnabled()) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, "supervisor is not enabled"));
      return;
    }
    const ports = getPorts();
    if (!ports) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, "supervisor runtime unavailable"),
      );
      return;
    }
    if (typeof params !== "object" || params === null) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "invalid params"));
      return;
    }
    const p = params;
    const scope = await requireSupervisorTaskAccessScope({
      client,
      requestedTenantId: requireOptionalString(p, "tenantId"),
      requestedUserId: requireOptionalString(p, "userId"),
      respond,
    });
    if (!scope) {
      return;
    }

    // Session scope: only the caller's tasks (orphan / colleague tasks excluded).
    // Legacy (no personal session): soft filter from optional params for local/CLI.
    const tasks = (await listTasks()).filter((t) => isSupervisedTaskVisibleToScope(t, scope));
    respond(true, { tasks }, undefined);
  },

  "supervisor.task.abort": async ({ params, client, respond }) => {
    if (!isSupervisorEnabled()) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, "supervisor is not enabled"));
      return;
    }
    if (typeof params !== "object" || params === null) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "invalid params"));
      return;
    }
    const p = params;
    const taskId = requireString(p, "taskId", respond);
    if (!taskId) {
      return;
    }

    const scope = await requireSupervisorTaskAccessScope({
      client,
      requestedTenantId: requireOptionalString(p, "tenantId"),
      requestedUserId: requireOptionalString(p, "userId"),
      respond,
    });
    if (!scope) {
      return;
    }
    const found = await getTask(taskId);
    if (!found || !isSupervisedTaskVisibleToScope(found, scope)) {
      denySupervisedTaskNotFound(respond);
      return;
    }

    const ports = getPorts();
    const next = await abortSupervisedTask(taskId, ports ?? undefined);
    if (!next) {
      denySupervisedTaskNotFound(respond);
      return;
    }
    respond(true, next, undefined);
  },

  "supervisor.task.subscribe": async ({ params, client, respond }) => {
    if (!isSupervisorEnabled()) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, "supervisor is not enabled"));
      return;
    }
    const connId = client?.connId;
    if (!connId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "subscribe requires a connected client"),
      );
      return;
    }
    if (typeof params !== "object" || params === null) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "invalid params"));
      return;
    }
    const p = params;
    const taskId = requireString(p, "taskId", respond);
    if (!taskId) {
      return;
    }

    const scope = await requireSupervisorTaskAccessScope({
      client,
      requestedTenantId: requireOptionalString(p, "tenantId"),
      requestedUserId: requireOptionalString(p, "userId"),
      respond,
    });
    if (!scope) {
      return;
    }

    const found = await getTask(taskId);
    if (!found || !isSupervisedTaskVisibleToScope(found, scope)) {
      denySupervisedTaskNotFound(respond);
      return;
    }

    registerSupervisorTaskEventRecipient(taskId, connId);
    respond(true, { taskId, subscribed: true }, undefined);
  },

  "supervisor.task.audit": async ({ params, client, respond }) => {
    if (!isSupervisorEnabled()) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, "supervisor is not enabled"));
      return;
    }
    if (typeof params !== "object" || params === null) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "invalid params"));
      return;
    }
    const p = params;
    const taskId = requireString(p, "taskId", respond);
    if (!taskId) {
      return;
    }

    const scope = await requireSupervisorTaskAccessScope({
      client,
      requestedTenantId: requireOptionalString(p, "tenantId"),
      requestedUserId: requireOptionalString(p, "userId"),
      respond,
    });
    if (!scope) {
      return;
    }

    const found = await getTask(taskId);
    if (!found || !isSupervisedTaskVisibleToScope(found, scope)) {
      denySupervisedTaskNotFound(respond);
      return;
    }

    const limit = typeof p.limit === "number" && p.limit > 0 ? Math.floor(p.limit) : 100;
    const tenantId =
      (scope.kind === "session" ? scope.actor.tenantId : undefined)?.trim() ||
      requireOptionalString(p, "tenantId") ||
      found.tenantId;

    const store = getFabricAuditStore();
    const fabricQuery = { correlationId: taskId, ...(tenantId ? { tenantId } : {}) };
    const fabricRecords = store?.query(fabricQuery, limit) ?? [];
    const fabricStats = store?.stats(fabricQuery) ?? null;

    const usageAttribution = await queryCliBackendUsage({
      tenantId,
      executionIdPrefix: taskId,
      limit,
    });
    const reportEvents = await readSupervisorReportEvents({ taskId, limit });

    respond(
      true,
      {
        taskId,
        fabricRecords,
        fabricStats,
        usageAttribution,
        reportEvents,
      },
      undefined,
    );
  },

  "supervisor.status": ({ respond }) => {
    const env = process.env;
    const envOnly = isSupervisorEnabled(env, () => false);
    let configEnabled = false;
    try {
      configEnabled = loadConfig().gateway?.supervisor?.enabled === true;
    } catch {
      configEnabled = false;
    }
    respond(true, {
      enabled: isSupervisorEnabled(),
      envEnabled: envOnly,
      configEnabled,
      runnerEnabled: isSupervisorRunnerEnabled(),
    });
  },

  "supervisor.feature.set": async ({ params, respond }) => {
    const enabled = params.enabled === true;
    try {
      const cfg = loadConfig();
      const next = {
        ...cfg,
        gateway: {
          ...cfg.gateway,
          supervisor: { ...cfg.gateway?.supervisor, enabled },
        },
      };
      await writeConfigFile(next);
      respond(true, { enabled: isSupervisorEnabled() });
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, err instanceof Error ? err.message : String(err)),
      );
    }
  },
};
