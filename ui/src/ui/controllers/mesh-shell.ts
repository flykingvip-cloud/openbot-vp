import { agentsCapability } from "../capability/agents/index.ts";
import { spacesCapability } from "../capability/spaces/index.ts";
import {
  adaptAgentsLoadCapabilityState,
  adaptSpacesLoadCapabilityState,
} from "../capability/view-state.ts";
import type { SessionsUsageResult } from "../types.ts";
import { refreshEnterpriseOrganizationSnapshot } from "./enterprise-organization-snapshot.ts";
import { loadMeshOwnership } from "./mesh-ownership.ts";
import { loadUsage, type UsageState } from "./usage.ts";

type MeshLifetimeUsageHost = {
  client: UsageState["client"];
  connected: boolean;
  usageTimeZone?: UsageState["usageTimeZone"];
  meshLifetimeUsageResult: SessionsUsageResult | null;
};

type MeshShellHost = Parameters<typeof loadMeshOwnership>[0] &
  Parameters<typeof adaptAgentsLoadCapabilityState>[0] &
  Parameters<typeof refreshEnterpriseOrganizationSnapshot>[0] &
  UsageState &
  MeshLifetimeUsageHost;

function isSessionsUsageResult(value: unknown): value is SessionsUsageResult {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.updatedAt === "number" &&
    typeof record.startDate === "string" &&
    typeof record.endDate === "string" &&
    Array.isArray(record.sessions) &&
    record.totals !== null &&
    typeof record.totals === "object" &&
    record.aggregates !== null &&
    typeof record.aggregates === "object"
  );
}

function formatUsageDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Mesh list / KPIs: calendar-month cost (本月 1 日 → today). */
export function resolveMeshUsageDateRange(now = new Date()): {
  startDate: string;
  endDate: string;
} {
  const end = new Date(now);
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  return { startDate: formatUsageDate(start), endDate: formatUsageDate(end) };
}

/** Mesh detail: lifetime / cumulative cost window. */
export function resolveMeshLifetimeUsageDateRange(now = new Date()): {
  startDate: string;
  endDate: string;
} {
  const end = new Date(now);
  return { startDate: "2020-01-01", endDate: formatUsageDate(end) };
}

/**
 * Load tenant-wide lifetime usage into a dedicated field so monthly `usageResult`
 * (shared by mesh KPIs / list) is never overwritten.
 */
export async function loadMeshLifetimeUsage(host: MeshLifetimeUsageHost): Promise<void> {
  const client = host.client;
  if (!client || !host.connected) {
    return;
  }
  const range = resolveMeshLifetimeUsageDateRange();
  const requestUsage = async (includeDateInterpretation: boolean) => {
    const dateInterpretation =
      includeDateInterpretation && host.usageTimeZone === "utc"
        ? { mode: "utc" as const }
        : includeDateInterpretation
          ? {
              mode: "specific" as const,
              utcOffset: (() => {
                const offsetFromUtcMinutes = -new Date().getTimezoneOffset();
                const sign = offsetFromUtcMinutes >= 0 ? "+" : "-";
                const absMinutes = Math.abs(offsetFromUtcMinutes);
                const hours = Math.floor(absMinutes / 60);
                const minutes = absMinutes % 60;
                return minutes === 0
                  ? `UTC${sign}${hours}`
                  : `UTC${sign}${hours}:${minutes.toString().padStart(2, "0")}`;
              })(),
            }
          : {};
    return await client.request("sessions.usage", {
      startDate: range.startDate,
      endDate: range.endDate,
      ...dateInterpretation,
      limit: 1000,
      includeContextWeight: true,
      aggregateAll: true,
      scope: "tenant",
    });
  };

  try {
    const usage = await requestUsage(true);
    if (isSessionsUsageResult(usage)) {
      host.meshLifetimeUsageResult = usage;
    }
  } catch {
    try {
      const usage = await requestUsage(false);
      if (isSessionsUsageResult(usage)) {
        host.meshLifetimeUsageResult = usage;
      }
    } catch {
      // Keep prior lifetime snapshot if refresh fails.
    }
  }
}

/**
 * Mesh governance shell data: ownership + agent roster + collaboration spaces + usage.
 * Used by mesh tab shell profile, refreshActiveTab, and the mesh header refresh button.
 * Does not reintroduce lean-connect fan-out — only loads when the mesh surface is active.
 */
export async function loadMeshShellData(host: MeshShellHost): Promise<void> {
  const usageRange = resolveMeshUsageDateRange();
  await Promise.all([
    refreshEnterpriseOrganizationSnapshot(host).catch(() => undefined),
    loadMeshOwnership(host),
    agentsCapability.load(adaptAgentsLoadCapabilityState(host)),
    spacesCapability.load(adaptSpacesLoadCapabilityState(host), { scope: "tenant" }),
    // Monthly window for list KPIs / 月成本.
    loadUsage(host, { ...usageRange, aggregateAll: true, scope: "tenant" }),
    // Lifetime window for detail 总成本（累积）; dedicated state field.
    loadMeshLifetimeUsage(host),
  ]);
}
