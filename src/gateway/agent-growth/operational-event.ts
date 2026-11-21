import type { OpenBotConfig } from "../../config/config.js";
import { createInitialGrowthStatus } from "./factory.js";
import { projectOperationalGrowth } from "./operational-growth.js";
import type { OperationalMetrics } from "./operational-metrics-store.js";
import { applyRobotGrowthEvent } from "./store.js";
import type { AgentGrowthPathOpts } from "./tenant-agent-dir.js";

/** Deterministic replay into the sole GrowthStatus aggregate, without self-tuning. */
export async function applyOperationalGrowthEvent(input: {
  cfg: OpenBotConfig;
  agentId: string;
  eventId: string;
  observedAtMs: number;
  metrics: OperationalMetrics;
  installedSkillKeys: readonly string[];
  opts?: AgentGrowthPathOpts;
}) {
  if (!Number.isFinite(input.observedAtMs) || input.observedAtMs < 0) {
    throw new Error("Invalid growth observation time");
  }
  if (
    !Number.isSafeInteger(input.metrics.tasksTotal) ||
    input.metrics.tasksTotal < 0 ||
    !Number.isSafeInteger(input.metrics.tasksSucceeded) ||
    input.metrics.tasksSucceeded < 0 ||
    input.metrics.tasksSucceeded > input.metrics.tasksTotal
  ) {
    throw new Error("Invalid operational growth metrics");
  }
  return applyRobotGrowthEvent({
    cfg: input.cfg,
    agentId: input.agentId,
    eventId: input.eventId,
    opts: input.opts,
    payload: {
      metrics: input.metrics,
      observedAtMs: input.observedAtMs,
      installedSkillKeys: input.installedSkillKeys,
    },
    update: (current) => {
      if (
        current?.operationalObservationAtMs !== undefined &&
        current.operationalObservationAtMs >= input.observedAtMs
      ) {
        return current;
      }
      return {
        ...projectOperationalGrowth(
          current ?? createInitialGrowthStatus({ kind: "robot", atMs: input.observedAtMs }),
          input.metrics,
          input.observedAtMs,
          input.installedSkillKeys,
        ),
        operationalObservationAtMs: input.observedAtMs,
      };
    },
  });
}
