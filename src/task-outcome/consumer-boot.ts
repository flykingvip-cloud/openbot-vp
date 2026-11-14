/**
 * Boot + runtime drain for TaskOutcome growth-evolution consumers, plus
 * awaiting-delivery memory hydrate so restart does not rely only on peek lazy-read.
 */
import fs from "node:fs";
import path from "node:path";
import { confirmPendingTurnDeliveryWithPorts } from "../agent-runtime/delivery/dispatch/confirm-pending.js";
import { markAsyncWaitRecoveryDelivered } from "../agent-runtime/state/index.js";
import { listAgentIds, resolveAgentDir } from "../agents/agent-scope.js";
import type { OpenBotConfig } from "../config/config.js";
import {
  isTaskExecutionBindingCurrent,
  recordCheckedTaskCompletion,
} from "../conversation-task/session-task-board.js";
import type { OutboundChannel } from "../infra/outbound/targets.js";
import { confirmedDeliveryMessageIds } from "../shared/delivery-receipt.js";
import {
  clearPendingDeliveryIntent,
  hydrateAwaitingDeliveriesFromDisk,
  listDurableAwaitingDeliveries,
  listPendingDeliveryIntents,
  listStaleAwaitingDeliveries,
  markAwaitingDeliverySendDisposition,
  peekAwaitingDelivery,
  registerAwaitingDelivery,
  type AwaitingDeliveryRegistration,
  type PendingVisiblePayload,
  type PendingVisibleTarget,
} from "./pending-delivery.js";
import { drainPendingGrowthEvolution, TASK_OUTCOME_STORE_DIRNAME } from "./runtime-from-runner.js";
import { DurableTaskOutcomeStore } from "./store.js";

export type TaskOutcomeConsumerBootLog = {
  info?: (message: string) => void;
  warn?: (message: string) => void;
};

export type TaskOutcomeConsumerBootResult = {
  agentsScanned: number;
  /** Durable awaiting-delivery rows loaded into memory at boot. */
  hydrated: number;
  processed: number;
  deferred: number;
  written: number;
};

export type RecoveredVisibleSendInput = {
  cfg: OpenBotConfig;
  agentId: string;
  runId: string;
  deliveryId: string;
  taskId: string;
  persistRoot: string;
  payloads: PendingVisiblePayload[];
  target: PendingVisibleTarget;
  checkedTask?: AwaitingDeliveryRegistration["checkedTask"];
};

export type RecoveredVisibleSendPort = (input: RecoveredVisibleSendInput) => Promise<unknown>;

const RUNTIME_DRAIN_INTERVAL_MS = 15_000;
let runtimeDrainTimer: ReturnType<typeof setInterval> | undefined;
let runtimeDrainCfg: OpenBotConfig | undefined;
let runtimeSendPendingVisible: RecoveredVisibleSendPort | undefined;

/**
 * Reconstruct awaiting-delivery identity from persisted pending outcomes when
 * the process crashed after result commit and before registerAwaitingDelivery.
 * Does not invent checkedTask or a delivered receipt.
 */
export function rehydrateAwaitingDeliveriesFromPendingOutcomes(params: {
  persistRoot: string;
  agentId: string;
}): number {
  const persistRoot = params.persistRoot.trim();
  const agentId = params.agentId.trim();
  if (!persistRoot || !agentId || !fs.existsSync(persistRoot)) {
    return 0;
  }
  const tipsDir = path.join(persistRoot, "tips");
  if (!fs.existsSync(tipsDir)) {
    return 0;
  }
  const store = new DurableTaskOutcomeStore(persistRoot);
  let n = 0;
  for (const taskId of store.listTaskIds()) {
    const record = store.loadTask(taskId);
    if (!record || record.delivery.status !== "pending") {
      continue;
    }
    const deliveryId = record.deliveryId?.trim();
    const runId = record.decisiveRunId?.trim();
    if (!deliveryId || !runId) {
      continue;
    }
    if (peekAwaitingDelivery({ runId, deliveryId, taskId: record.taskId, persistRoot })) {
      continue;
    }
    registerAwaitingDelivery({
      taskId: record.taskId,
      deliveryId,
      agentId,
      runId,
      persistRoot,
    });
    n += 1;
  }
  return n;
}

/**
 * Promote pre-commit intents only when the committed tip already proves the
 * pending result identity. Writing an intent never stands in for commit or delivery.
 */
export function promotePendingDeliveryIntents(params: {
  persistRoot: string;
  agentId: string;
}): number {
  const persistRoot = params.persistRoot.trim();
  const agentId = params.agentId.trim();
  if (!persistRoot || !agentId) {
    return 0;
  }
  const store = new DurableTaskOutcomeStore(persistRoot);
  let n = 0;
  for (const intent of listPendingDeliveryIntents(persistRoot)) {
    try {
      if (
        peekAwaitingDelivery({
          runId: intent.runId,
          deliveryId: intent.deliveryId,
          taskId: intent.taskId,
          persistRoot,
        })
      ) {
        clearPendingDeliveryIntent(persistRoot, intent.runId);
        continue;
      }
      const record = store.loadTask(intent.taskId);
      if (
        !record ||
        record.deliveryId !== intent.deliveryId ||
        record.decisiveRunId !== intent.runId ||
        (record.delivery.status !== "pending" && record.delivery.status !== "delivery_unknown")
      ) {
        // Keep the intent until a committed pending identity exists. Do not invent delivered.
        continue;
      }
      registerAwaitingDelivery({
        taskId: intent.taskId,
        deliveryId: intent.deliveryId,
        agentId: intent.agentId || agentId,
        runId: intent.runId,
        persistRoot,
        ...(intent.checkedTask ? { checkedTask: intent.checkedTask } : {}),
        ...(intent.payloads ? { payloads: intent.payloads } : {}),
        ...(intent.target ? { target: intent.target } : {}),
        sendDisposition: intent.sendDisposition ?? "not_attempted",
      });
      n += 1;
    } catch {
      // never block boot on one bad intent
    }
  }
  return n;
}

async function defaultSendPendingVisible(input: RecoveredVisibleSendInput): Promise<unknown> {
  const { deliverOutboundPayloads } = await import("../infra/outbound/deliver.js");
  if (!input.target.channel || input.target.channel === "none" || !input.target.to) {
    return undefined;
  }
  return deliverOutboundPayloads({
    cfg: input.cfg,
    channel: input.target.channel as Exclude<OutboundChannel, "none">,
    to: input.target.to,
    accountId: input.target.accountId,
    payloads: input.payloads,
    threadId: input.target.threadId,
    replyToId: input.target.replyToId,
    taskBoundary: input.checkedTask
      ? {
          sessionFile: input.checkedTask.sessionFile,
          binding: input.checkedTask.binding,
          constraints: input.checkedTask.binding.constraints ?? [],
        }
      : undefined,
  });
}

function confirmPorts(persistRoot: string) {
  return {
    resolvePersistRoot: () => persistRoot,
    completeTask: recordCheckedTaskCompletion,
    bindingCurrent: isTaskExecutionBindingCurrent,
    recordRecoveryDelivered: markAsyncWaitRecoveryDelivered,
  };
}

function canReuseCurrentBinding(pending: AwaitingDeliveryRegistration): boolean {
  if (!pending.checkedTask) {
    return true;
  }
  if (
    !isTaskExecutionBindingCurrent(pending.checkedTask.sessionFile, pending.checkedTask.binding)
  ) {
    return false;
  }
  return true;
}

/**
 * Send only not_attempted intents that already have payload, target, and a
 * committed pending tip. pending alone is not evidence of "not yet sent".
 * unknown is never blindly resent. Receipts go through production confirm.
 */
export async function deliverRecoveredAwaitingSends(params: {
  cfg: OpenBotConfig;
  persistRoot: string;
  agentId: string;
  sendPendingVisible?: RecoveredVisibleSendPort;
}): Promise<{ sent: number; blocked: number; unknown: number }> {
  const persistRoot = params.persistRoot.trim();
  const out = { sent: 0, blocked: 0, unknown: 0 };
  if (!persistRoot) {
    return out;
  }
  const store = new DurableTaskOutcomeStore(persistRoot);
  const send = params.sendPendingVisible ?? defaultSendPendingVisible;
  for (const pending of listDurableAwaitingDeliveries(persistRoot)) {
    try {
      if (pending.sendDisposition !== "not_attempted") {
        continue;
      }
      if (!pending.payloads?.length || !pending.target) {
        out.blocked += 1;
        continue;
      }
      const record = store.loadTask(pending.taskId);
      if (
        !record ||
        record.deliveryId !== pending.deliveryId ||
        record.decisiveRunId !== pending.runId ||
        record.delivery.status === "delivered" ||
        record.delivery.status === "failed"
      ) {
        out.blocked += 1;
        continue;
      }
      if (record.delivery.status === "delivery_unknown") {
        out.unknown += 1;
        continue;
      }
      if (record.delivery.status !== "pending") {
        out.blocked += 1;
        continue;
      }
      if (!canReuseCurrentBinding(pending)) {
        out.blocked += 1;
        continue;
      }
      // Persist unknown before the channel call so a crash mid-send is not resent.
      markAwaitingDeliverySendDisposition(
        {
          runId: pending.runId,
          deliveryId: pending.deliveryId,
          taskId: pending.taskId,
          persistRoot,
        },
        "unknown",
      );
      const receipts = await send({
        cfg: params.cfg,
        agentId: params.agentId,
        runId: pending.runId,
        deliveryId: pending.deliveryId,
        taskId: pending.taskId,
        persistRoot,
        payloads: pending.payloads,
        target: pending.target,
        ...(pending.checkedTask ? { checkedTask: pending.checkedTask } : {}),
      });
      const ids = confirmedDeliveryMessageIds(receipts);
      if (ids) {
        await confirmPendingTurnDeliveryWithPorts(
          {
            cfg: params.cfg,
            runId: pending.runId,
            deliveryId: pending.deliveryId,
            taskId: pending.taskId,
            sessionKey: `agent:${params.agentId}:main`,
            status: "delivered",
          },
          confirmPorts(persistRoot),
        );
        out.sent += 1;
      } else {
        await confirmPendingTurnDeliveryWithPorts(
          {
            cfg: params.cfg,
            runId: pending.runId,
            deliveryId: pending.deliveryId,
            taskId: pending.taskId,
            sessionKey: `agent:${params.agentId}:main`,
            status: "delivery_unknown",
          },
          confirmPorts(persistRoot),
        );
        out.unknown += 1;
      }
    } catch {
      out.unknown += 1;
    }
  }
  return out;
}

/**
 * Preload awaiting-delivery registrations from each agent TaskOutcome store.
 * One bad agent root must never block boot.
 */
export async function hydrateAllAgentsAwaitingDeliveries(
  cfg: OpenBotConfig,
  opts?: { sendPendingVisible?: RecoveredVisibleSendPort },
): Promise<{
  agentsScanned: number;
  hydrated: number;
}> {
  let hydrated = 0;
  const agents = listAgentIds(cfg);
  for (const agentId of agents) {
    try {
      const persistRoot = path.join(resolveAgentDir(cfg, agentId), TASK_OUTCOME_STORE_DIRNAME);
      hydrated += hydrateAwaitingDeliveriesFromDisk(persistRoot);
      hydrated += promotePendingDeliveryIntents({ persistRoot, agentId });
      hydrated += rehydrateAwaitingDeliveriesFromPendingOutcomes({ persistRoot, agentId });
      await deliverRecoveredAwaitingSends({
        cfg,
        persistRoot,
        agentId,
        sendPendingVisible: opts?.sendPendingVisible,
      });
    } catch {
      // never block boot on one bad agent store
    }
  }
  return { agentsScanned: agents.length, hydrated };
}

export async function drainAllAgentsPendingGrowth(
  cfg: OpenBotConfig,
): Promise<Omit<TaskOutcomeConsumerBootResult, "hydrated">> {
  let processed = 0;
  let deferred = 0;
  let written = 0;
  const agents = listAgentIds(cfg);
  for (const agentId of agents) {
    try {
      const out = await drainPendingGrowthEvolution(cfg, agentId);
      processed += out.processed;
      deferred += out.deferred;
      if (out.written) {
        written += 1;
      }
    } catch {
      // never block boot / timer on one bad agent store
    }
  }
  return { agentsScanned: agents.length, processed, deferred, written };
}

/**
 * Gateway boot: hydrate awaiting deliveries from disk, drain growth consumers
 * once, then keep a lightweight runtime timer so failed handler acks can retry
 * without a subsequent user message.
 */
export async function recoverTaskOutcomeConsumersAtGatewayBoot(params: {
  cfg: OpenBotConfig;
  log?: TaskOutcomeConsumerBootLog;
  /** When true, also start the independent runtime drain interval. */
  startRuntimeDrain?: boolean;
  intervalMs?: number;
  /** Test/production send port; defaults to outbound deliver. */
  sendPendingVisible?: RecoveredVisibleSendPort;
}): Promise<TaskOutcomeConsumerBootResult> {
  const hydrate = await hydrateAllAgentsAwaitingDeliveries(params.cfg, {
    sendPendingVisible: params.sendPendingVisible,
  });
  params.log?.info?.(
    `task-outcome awaiting-delivery hydrate: agents=${hydrate.agentsScanned} hydrated=${hydrate.hydrated}`,
  );
  const stale = listStaleAwaitingDeliveries();
  if (stale.length > 0) {
    params.log?.warn?.(
      `task-outcome awaiting-delivery still pending: count=${stale.length} oldestTaskId=${stale[0]?.taskId ?? ""}`,
    );
  }

  const drain = await drainAllAgentsPendingGrowth(params.cfg);
  params.log?.info?.(
    `task-outcome consumer boot: agents=${drain.agentsScanned} processed=${drain.processed} deferred=${drain.deferred} written=${drain.written}`,
  );
  if (params.startRuntimeDrain !== false) {
    startTaskOutcomeRuntimeDrain(params.cfg, {
      intervalMs: params.intervalMs,
      log: params.log,
      sendPendingVisible: params.sendPendingVisible,
    });
  }
  return {
    agentsScanned: Math.max(hydrate.agentsScanned, drain.agentsScanned),
    hydrated: hydrate.hydrated,
    processed: drain.processed,
    deferred: drain.deferred,
    written: drain.written,
  };
}

export function startTaskOutcomeRuntimeDrain(
  cfg: OpenBotConfig,
  opts?: {
    intervalMs?: number;
    log?: TaskOutcomeConsumerBootLog;
    sendPendingVisible?: RecoveredVisibleSendPort;
  },
): void {
  runtimeDrainCfg = cfg;
  if (opts?.sendPendingVisible) {
    runtimeSendPendingVisible = opts.sendPendingVisible;
  }
  if (runtimeDrainTimer) {
    return;
  }
  const intervalMs = opts?.intervalMs ?? RUNTIME_DRAIN_INTERVAL_MS;
  runtimeDrainTimer = setInterval(() => {
    const active = runtimeDrainCfg;
    if (!active) {
      return;
    }
    void drainAllAgentsPendingGrowth(active)
      .then(async (out) => {
        if (out.processed > 0 || out.deferred > 0) {
          opts?.log?.info?.(
            `task-outcome runtime drain: processed=${out.processed} deferred=${out.deferred}`,
          );
        }
        await hydrateAllAgentsAwaitingDeliveries(active, {
          sendPendingVisible: runtimeSendPendingVisible ?? opts?.sendPendingVisible,
        });
        const stale = listStaleAwaitingDeliveries();
        if (stale.length > 0) {
          opts?.log?.warn?.(`task-outcome awaiting-delivery still pending: count=${stale.length}`);
        }
      })
      .catch((err) => {
        opts?.log?.warn?.(
          `task-outcome runtime drain failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
  }, intervalMs);
  // Allow process to exit in tests without lingering handles when unref is available.
  if (typeof runtimeDrainTimer === "object" && runtimeDrainTimer && "unref" in runtimeDrainTimer) {
    runtimeDrainTimer.unref();
  }
}

/** Test helper */
export function stopTaskOutcomeRuntimeDrainForTests(): void {
  if (runtimeDrainTimer) {
    clearInterval(runtimeDrainTimer);
    runtimeDrainTimer = undefined;
  }
  runtimeDrainCfg = undefined;
  runtimeSendPendingVisible = undefined;
}
