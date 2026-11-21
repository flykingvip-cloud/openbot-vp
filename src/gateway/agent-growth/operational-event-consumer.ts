import type { OpenBotConfig } from "../../config/config.js";
import { applyOperationalGrowthEvent } from "./operational-event.js";
import type { OperationalMetrics } from "./operational-metrics-store.js";

/** Host resolves an authorized agent directory; event payload cannot choose filesystem paths. */
export function createOperationalGrowthConsumer(input: {
  cfg: OpenBotConfig;
  resolveAgentDir: (agentId: string) => Promise<string>;
}) {
  return async (
    eventId: string,
    agentId: string,
    payload: Record<string, unknown>,
  ): Promise<void> => {
    const metrics = payload.metrics;
    if (
      !metrics ||
      typeof metrics !== "object" ||
      Array.isArray(metrics) ||
      typeof payload.observedAtMs !== "number" ||
      !Array.isArray(payload.installedSkillKeys) ||
      !payload.installedSkillKeys.every((key) => typeof key === "string")
    ) {
      throw new Error("Invalid growth event snapshot");
    }
    const row = metrics as Record<string, unknown>;
    const counters = [
      "tasksTotal",
      "tasksSucceeded",
      "toolsTotal",
      "toolsSucceeded",
      "humanTakeovers",
      "takeoverObservations",
      "satisfactionPositive",
      "satisfactionNegative",
    ];
    if (
      counters.some((key) => !Number.isSafeInteger(row[key]) || Number(row[key]) < 0) ||
      typeof row.updatedAtMs !== "number" ||
      !Number.isFinite(row.updatedAtMs)
    ) {
      throw new Error("Invalid growth event metrics");
    }
    if (
      Number(row.toolsSucceeded) > Number(row.toolsTotal) ||
      Number(row.humanTakeovers) > Number(row.takeoverObservations)
    ) {
      throw new Error("Inconsistent growth metrics");
    }
    const agentDir = await input.resolveAgentDir(agentId);
    await applyOperationalGrowthEvent({
      cfg: input.cfg,
      agentId,
      eventId,
      metrics: metrics as OperationalMetrics,
      observedAtMs: payload.observedAtMs,
      installedSkillKeys: payload.installedSkillKeys,
      opts: { agentDir },
    });
  };
}
