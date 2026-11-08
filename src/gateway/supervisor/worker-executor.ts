/**
 * supervisor/worker-executor.ts — explicit WorkerExecutor ports (M0.5).
 *
 * RoutingWorkerPort selects an executor from ExecutionContext.placement.executor.
 * The Supervisor Engine must not branch on placement; only this port does.
 */

import crypto from "node:crypto";
import { runCliAgent } from "../../agent-runtime/execution/index.js";
import { recordCliBackendUsage } from "../../agents/cli-backend-usage-attribution.js";
import { createWorkerFromBackend } from "../../agents/cli-backend-worker.js";
import { resolveCliBackendConfig } from "../../agents/cli-backends.js";
import { FailoverError } from "../../agents/failover-error.js";
import type { OpenBotConfig } from "../../config/config.js";
import { resolveSessionTranscriptPath } from "../../config/sessions/paths.js";
import type { CliRunFn, CliRunResult } from "../../fabric/worker/cli-worker.js";
import type { ExecutionContext, WorkerLogEvent } from "../../fabric/worker/types.js";
import type { Worker as FabricWorker } from "../../fabric/worker/types.js";
import {
  SUPERVISOR_WORKER_CANCEL_COMMAND,
  SUPERVISOR_WORKER_DISPATCH_COMMAND,
} from "../../infra/node-commands.js";
import { DEFAULT_AGENT_ID } from "../../routing/session-key.js";
import {
  acquireSupervisorCommercialRun,
  releaseSupervisorCommercialRun,
} from "./commercial-run-gate.js";
import type { WorkerDispatchResult, WorkerPort } from "./engine.js";
import { WorkerAuthError } from "./engine.js";
import type { SupervisorWorkerDispatchResult } from "./node-agent-commands.js";
import type { NodeInvokePort } from "./node-invoke-port.js";
import { readNodeInvokePayload } from "./node-invoke-port.js";
import {
  cancelSupervisorRun,
  registerSupervisorRun,
  unregisterSupervisorRun,
} from "./run-registry.js";
import type { SupervisedTask } from "./types.js";

export class WorkerPlacementError extends Error {
  constructor(message = "worker placement unavailable") {
    super(message);
    this.name = "WorkerPlacementError";
  }
}

export interface WorkerExecutor {
  readonly kind: "gateway" | "node_agent";
  dispatch(input: {
    task: SupervisedTask;
    workerId: string;
    context: ExecutionContext;
    prompt: string;
    onProgress?: (event: WorkerLogEvent) => void;
    onStarted?: (handle: { runId: string; workerId: string }) => void | Promise<void>;
    shouldAbort?: () => boolean | Promise<boolean>;
  }): Promise<WorkerDispatchResult>;
  cancelActive?(taskId: string): Promise<void>;
  getRetryableExitCodes?(task: SupervisedTask): readonly number[] | undefined;
}

function pickLastWorkerSummaryText(
  payloads: Array<{ text?: string; isError?: boolean }> | undefined,
): string {
  if (!payloads || payloads.length === 0) {
    return "";
  }
  const last = payloads
    .filter((p) => !p.isError)
    .map((p) => p.text?.trim())
    .filter(Boolean)
    .at(-1);
  return typeof last === "string" ? last : "";
}

function createRunCliAsCliRunFn(params: { cfg: OpenBotConfig; agentId: string }): CliRunFn {
  return async (input) => {
    const sessionId = input.sessionId?.trim() || crypto.randomUUID();
    const sessionFile = resolveSessionTranscriptPath(sessionId, params.agentId);
    try {
      const result = await runCliAgent({
        sessionId,
        sessionKey: sessionId,
        agentId: params.agentId,
        sessionFile,
        workspaceDir: input.workspaceDir,
        config: params.cfg,
        prompt: input.prompt,
        provider: input.backendId,
        model: input.model,
        timeoutMs: input.timeoutMs,
        runId: sessionId,
        cliSessionId: input.sessionId,
        supervisedRun: true,
        ...(input.credentialEnv ? { credentialEnv: input.credentialEnv } : {}),
      });

      const payloads = result.payloads ?? [];
      const hasErrorPayload = payloads.some((p) => p.isError);
      const ok = !result.meta.aborted && !result.meta.error && !hasErrorPayload;
      const exitCode = ok ? 0 : 1;
      const summary = pickLastWorkerSummaryText(payloads);
      const rawError =
        (typeof result.meta.error === "string" ? result.meta.error : undefined) ??
        (summary || undefined);
      if (
        rawError &&
        /auth|unauthoriz|forbidden|invalid api key|permission denied|token/i.test(rawError)
      ) {
        throw new WorkerAuthError(rawError);
      }

      return {
        ok,
        exitCode,
        summary: summary || undefined,
        sessionId: result.meta.agentMeta?.sessionId ?? sessionId,
        usage: result.meta.agentMeta?.usage
          ? {
              input: result.meta.agentMeta.usage.input,
              output: result.meta.agentMeta.usage.output,
            }
          : undefined,
      } satisfies CliRunResult;
    } catch (err) {
      if (
        err instanceof FailoverError &&
        (err.reason === "auth" || err.reason === "auth_permanent")
      ) {
        throw new WorkerAuthError(err.message || "worker authentication failed");
      }
      return {
        ok: false,
        exitCode: 1,
        summary: err instanceof Error ? err.message : String(err),
      } satisfies CliRunResult;
    }
  };
}

/** Gateway-hosted CLI worker runs (enterprise_shared + gateway). */
export class GatewayWorkerExecutor implements WorkerExecutor {
  readonly kind = "gateway" as const;
  private readonly workerCache = new Map<string, FabricWorker | null>();

  constructor(private readonly cfg: OpenBotConfig) {}

  async cancelActive(taskId: string): Promise<void> {
    await cancelSupervisorRun(taskId);
  }

  getRetryableExitCodes(task: SupervisedTask): readonly number[] | undefined {
    const backendId = task.worker.backendId.trim();
    const resolved = resolveCliBackendConfig(backendId, this.cfg);
    const codes = resolved?.config.worker?.retryableExitCodes;
    if (!codes) {
      return undefined;
    }
    return codes.filter((code) => Number.isInteger(code));
  }

  async dispatch(input: {
    task: SupervisedTask;
    workerId: string;
    context: ExecutionContext;
    prompt: string;
    onProgress?: (event: WorkerLogEvent) => void;
    onStarted?: (handle: { runId: string; workerId: string }) => void | Promise<void>;
    shouldAbort?: () => boolean | Promise<boolean>;
  }): Promise<WorkerDispatchResult> {
    const task = input.task;
    const agentId = (task.agentId ?? DEFAULT_AGENT_ID).trim() || DEFAULT_AGENT_ID;
    const backendId = input.workerId.trim();
    const model = task.worker.model?.trim() || undefined;

    const cacheKey = `${backendId}:${agentId}`;
    if (!this.workerCache.has(cacheKey)) {
      const runCli = createRunCliAsCliRunFn({ cfg: this.cfg, agentId });
      this.workerCache.set(cacheKey, createWorkerFromBackend(this.cfg, backendId, runCli));
    }
    const worker = this.workerCache.get(cacheKey);
    if (!worker) {
      throw new Error(`No worker adapter for backend "${backendId}" (missing worker metadata?)`);
    }

    const credentialEnv = input.context.identity.credentialEnv;
    const timeoutMs = Math.max(60_000, task.budget.maxDurationMinutes * 60_000);
    const handle = await worker.start({
      task: { goal: task.goal, prompt: input.prompt },
      workspaceDir: task.workspace.root,
      model,
      continuityKey: task.continuityKey ?? task.taskId,
      timeoutMs,
      executionContext: input.context,
      ...(credentialEnv ? { credentialEnv } : {}),
    });

    let commercialSlotHeld = false;
    try {
      commercialSlotHeld = await acquireSupervisorCommercialRun({
        runId: handle.runId,
        agentId,
        enterpriseId: input.context.attribution.tenantId,
      });
    } catch (err) {
      await worker.cancel(handle.runId).catch(() => undefined);
      throw err;
    }

    registerSupervisorRun({
      taskId: task.taskId,
      runId: handle.runId,
      workerId: handle.workerId,
      worker,
    });
    await input.onStarted?.({ runId: handle.runId, workerId: handle.workerId });

    try {
      for await (const event of worker.logs(handle.runId)) {
        if (input.shouldAbort && (await input.shouldAbort())) {
          await worker.cancel(handle.runId).catch(() => undefined);
          break;
        }
        input.onProgress?.(event);
      }

      const status = await worker.status(handle.runId);
      if (input.context.attribution.credentialId && input.context.attribution.tenantId) {
        void recordCliBackendUsage({
          tenantId: input.context.attribution.tenantId,
          userId:
            input.context.attribution.userId ??
            input.context.attribution.seatId ??
            task.userId ??
            "unknown",
          backendId,
          credentialId: input.context.attribution.credentialId,
          model,
          executionId: `${task.taskId}:${handle.runId}`,
        });
      }
      return {
        summary: status.summary ?? "",
        exitCode: status.exitCode,
        usage: status.usage,
      };
    } finally {
      unregisterSupervisorRun(task.taskId);
      if (commercialSlotHeld) {
        void releaseSupervisorCommercialRun(handle.runId);
      }
    }
  }
}

/** Node Agent worker runs (local_ide_login + node_agent). */
export class NodeAgentWorkerExecutor implements WorkerExecutor {
  readonly kind = "node_agent" as const;

  constructor(private readonly invokePort: NodeInvokePort) {}

  async cancelActive(taskId: string): Promise<void> {
    await cancelSupervisorRun(taskId);
  }

  async dispatch(input: {
    task: SupervisedTask;
    workerId: string;
    context: ExecutionContext;
    prompt: string;
    onProgress?: (event: WorkerLogEvent) => void;
    onStarted?: (handle: { runId: string; workerId: string }) => void | Promise<void>;
    shouldAbort?: () => boolean | Promise<boolean>;
  }): Promise<WorkerDispatchResult> {
    const nodeId = input.context.placement.nodeAgentId?.trim();
    if (!nodeId) {
      throw new WorkerPlacementError("Node Agent id missing from execution context");
    }
    if (!this.invokePort.isConnected(nodeId)) {
      throw new WorkerPlacementError(`Node Agent "${nodeId}" is not connected`);
    }
    const declared = this.invokePort.getDeclaredCommands(nodeId);
    if (!declared.includes(SUPERVISOR_WORKER_DISPATCH_COMMAND)) {
      throw new WorkerPlacementError(
        `Node Agent "${nodeId}" does not declare ${SUPERVISOR_WORKER_DISPATCH_COMMAND}`,
      );
    }

    const runId = crypto.randomUUID();
    const task = input.task;
    const backendId = input.workerId.trim();
    const model = task.worker.model?.trim() || undefined;
    const timeoutMs = Math.max(60_000, task.budget.maxDurationMinutes * 60_000);
    const agentId = (task.agentId ?? DEFAULT_AGENT_ID).trim() || DEFAULT_AGENT_ID;

    let commercialSlotHeld = false;
    commercialSlotHeld = await acquireSupervisorCommercialRun({
      runId,
      agentId,
      enterpriseId: input.context.attribution.tenantId,
    });

    registerSupervisorRun({
      taskId: task.taskId,
      runId,
      workerId: backendId,
      worker: {
        cancel: async () => {
          if (!declared.includes(SUPERVISOR_WORKER_CANCEL_COMMAND)) {
            return;
          }
          await this.invokePort.invoke({
            nodeId,
            command: SUPERVISOR_WORKER_CANCEL_COMMAND,
            params: { runId, taskId: task.taskId, workerId: backendId },
            timeoutMs: 30_000,
            idempotencyKey: `${task.taskId}:${runId}:cancel`,
          });
        },
      },
      onProgress: input.onProgress,
    });
    await input.onStarted?.({ runId, workerId: backendId });

    try {
      if (input.shouldAbort && (await input.shouldAbort())) {
        return { summary: "aborted before node dispatch", exitCode: 130 };
      }

      const result = await this.invokePort.invoke({
        nodeId,
        command: SUPERVISOR_WORKER_DISPATCH_COMMAND,
        params: {
          runId,
          taskId: task.taskId,
          workerId: backendId,
          ...(model ? { model } : {}),
          prompt: input.prompt,
          goal: task.goal,
          workspaceDir: task.workspace.root,
          identityPolicy: input.context.identity.policy,
        },
        timeoutMs,
        idempotencyKey: `${task.taskId}:${runId}`,
      });

      if (!result.ok) {
        const code = result.error?.code ?? "NODE_INVOKE_FAILED";
        const message = result.error?.message ?? "node worker dispatch failed";
        if (code === "NOT_CONNECTED" || code === "UNAVAILABLE" || code === "TIMEOUT") {
          throw new WorkerPlacementError(message);
        }
        if (/auth|login|logged in|unauthor|expired|invalid key/i.test(message)) {
          throw new WorkerAuthError(message);
        }
        return { summary: message, exitCode: 1 };
      }

      const payload = readNodeInvokePayload(result) as SupervisorWorkerDispatchResult | null;
      input.onProgress?.({
        type: "status",
        phase: "terminal",
        data: payload?.summary ?? "node worker finished",
      });
      return {
        summary: payload?.summary ?? "",
        exitCode: payload?.exitCode,
        usage: payload?.usage,
      };
    } finally {
      unregisterSupervisorRun(task.taskId);
      if (commercialSlotHeld) {
        void releaseSupervisorCommercialRun(runId);
      }
    }
  }
}

export function createRoutingWorkerPort(executors: WorkerExecutor[]): WorkerPort {
  const byKind = new Map(executors.map((executor) => [executor.kind, executor]));
  return {
    async dispatch(input) {
      const kind = input.context.placement.executor;
      const executor = byKind.get(kind);
      if (!executor) {
        throw new WorkerPlacementError(`No worker executor registered for "${kind}"`);
      }
      return executor.dispatch(input);
    },
    async cancelActive(taskId) {
      await Promise.all(
        executors.map((executor) => executor.cancelActive?.(taskId) ?? Promise.resolve()),
      );
    },
    getRetryableExitCodes(task) {
      return byKind.get("gateway")?.getRetryableExitCodes?.(task);
    },
  };
}
