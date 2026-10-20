/**
 * S4 — Gateway bootstrap for group-task-heartbeat scheduler.
 * Thin wiring only: bind runCollaborationGroupTaskHeartbeat as the tick runner.
 * schedulerEnabled default false → dormant timer until tip enables.
 */
import type { OpenBotConfig } from "../config/types.js";
import {
  startGroupTaskHeartbeatScheduler,
  type GroupTaskHeartbeatScheduler,
  type StartGroupTaskHeartbeatSchedulerOpts,
} from "./collaboration-dispatch/group-task-heartbeat-scheduler.js";
import { runCollaborationGroupTaskHeartbeat } from "./collaboration-learning/wake-contract-entry.js";
import {
  bindGatewayWakeRoundDispatcher,
  unbindGatewayWakeRoundDispatcher,
} from "./wake-round-dispatcher-boot.js";

export function startGatewayGroupTaskHeartbeatScheduler(
  opts: { cfg?: OpenBotConfig } & Omit<StartGroupTaskHeartbeatSchedulerOpts, "runGroup"> = {},
): GroupTaskHeartbeatScheduler {
  // P0-2: bind Mode B wake→round dispatcher alongside heartbeat boot so
  // self_advance/nudge/escalate can open 真回合 (unbound → recorded).
  // Gray execute allowlist still gates; no second orchestrator.
  bindGatewayWakeRoundDispatcher({ cfg: opts.cfg });
  const scheduler = startGroupTaskHeartbeatScheduler({
    ...opts,
    runGroup: async (target, options) =>
      runCollaborationGroupTaskHeartbeat({
        groupId: target.groupId,
        tenant: target.tenantId
          ? { tenantId: target.tenantId, trust: "actor_fallback" }
          : { tenantId: null, trust: "none" },
        cfg: options.cfg,
        force: options.force,
        nowMs: options.nowMs,
        coordinatorBotId: options.coordinatorBotId,
        groupOwnerId: options.groupOwnerId,
        actorId: options.actorId,
        dryRun: options.dryRun,
      }),
  });
  return {
    ...scheduler,
    stop: () => {
      try {
        scheduler.stop();
      } finally {
        unbindGatewayWakeRoundDispatcher();
      }
    },
  };
}
