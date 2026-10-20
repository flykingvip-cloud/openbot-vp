/**
 * Employee-facing controller for per-agent runtime health.
 *
 * Reads the honest health verdict computed by the gateway
 * (`agents.runtime-health`: readiness + channel connectivity) and exposes it as
 * a simple agentId -> health map for the workbench robot roster. This is a
 * distinct signal from "recent activity" (session-existence) — health answers
 * "can this robot run / is it reachable right now", not "did it chat recently".
 */

/** Honest per-agent runtime health, mirrored from the gateway policy. */
export type WorkbenchRobotHealth = "online" | "degraded" | "offline" | "unconfigured";

const HEALTH_VALUES: ReadonlySet<string> = new Set<WorkbenchRobotHealth>([
  "online",
  "degraded",
  "offline",
  "unconfigured",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Pure: index `agents.runtime-health` reports into an agentId -> health map. */
export function indexAgentRuntimeHealth(reports: unknown): Map<string, WorkbenchRobotHealth> {
  const map = new Map<string, WorkbenchRobotHealth>();
  if (!Array.isArray(reports)) {
    return map;
  }
  for (const raw of reports) {
    if (!isRecord(raw)) {
      continue;
    }
    const agentId = typeof raw.agentId === "string" ? raw.agentId.trim() : "";
    const health = typeof raw.health === "string" ? raw.health : "";
    if (!agentId || !HEALTH_VALUES.has(health)) {
      continue;
    }
    map.set(agentId, health as WorkbenchRobotHealth);
  }
  return map;
}

type RuntimeHealthClient = {
  request: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
};

/** Fetch and index per-agent runtime health from the gateway. */
export async function loadAgentRuntimeHealth(
  client: RuntimeHealthClient,
): Promise<Map<string, WorkbenchRobotHealth>> {
  const result = await client.request("agents.runtime-health", {});
  const reports = isRecord(result) ? result.reports : undefined;
  return indexAgentRuntimeHealth(reports);
}
