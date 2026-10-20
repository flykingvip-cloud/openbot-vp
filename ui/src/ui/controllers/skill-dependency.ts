import type { GatewayBrowserClient } from "../gateway.ts";
import { sanitizeSkillDependencyGraph, type SkillDependencyGraph } from "./skill-models.ts";

export type SkillDependencySummary = {
  installedRobotCount: number;
  sharedGroupCount: number;
  dependentSkillCount: number;
  enterpriseConsumerCount: number;
  hasAnyConsumer: boolean; // Requirement 8.6: when all empty, skip confirmation
};

export type SkillDependencyGraphSnapshot = SkillDependencySummary & {
  installedRobots: Array<{ id: string; name: string }>;
  sharedGroups: Array<{ id: string; name: string }>;
  dependentSkills: Array<{ id: string; name: string }>;
  enterpriseConsumers: Array<{
    kind: "department" | "group" | "role" | "enterprise";
    id: string | null;
    label: string;
  }>;
};

export type SkillDependencyState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  summaryCache: Record<string, SkillDependencySummary>;
  graphCache: Record<string, SkillDependencyGraphSnapshot>;
  loadingSkillId: string | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function normalizeConsumerKind(value: unknown): "department" | "group" | "role" | "enterprise" {
  switch (value) {
    case "department":
    case "group":
    case "role":
      return value;
    default:
      return "enterprise";
  }
}

function computeHasAnyConsumer(
  installedRobotCount: number,
  sharedGroupCount: number,
  dependentSkillCount: number,
  enterpriseConsumerCount: number,
): boolean {
  return (
    installedRobotCount > 0 ||
    sharedGroupCount > 0 ||
    dependentSkillCount > 0 ||
    enterpriseConsumerCount > 0
  );
}

/**
 * Normalizes a raw summary response into a SkillDependencySummary.
 * Handles missing/malformed data gracefully by defaulting counts to 0.
 */
export function normalizeDependencySummary(value: unknown): SkillDependencySummary {
  const record = asRecord(value) ?? {};
  const installedRobotCount = Math.max(
    0,
    typeof record.installedRobotCount === "number" ? record.installedRobotCount : 0,
  );
  const sharedGroupCount = Math.max(
    0,
    typeof record.sharedGroupCount === "number" ? record.sharedGroupCount : 0,
  );
  const dependentSkillCount = Math.max(
    0,
    typeof record.dependentSkillCount === "number" ? record.dependentSkillCount : 0,
  );
  const enterpriseConsumerCount = Math.max(
    0,
    typeof record.enterpriseConsumerCount === "number" ? record.enterpriseConsumerCount : 0,
  );
  return {
    installedRobotCount,
    sharedGroupCount,
    dependentSkillCount,
    enterpriseConsumerCount,
    hasAnyConsumer: computeHasAnyConsumer(
      installedRobotCount,
      sharedGroupCount,
      dependentSkillCount,
      enterpriseConsumerCount,
    ),
  };
}

/**
 * Normalizes a raw dependency graph response into a SkillDependencyGraphSnapshot.
 * Uses sanitizeSkillDependencyGraph from skill-models for the base graph normalization,
 * then maps to the snapshot shape with id/name pairs and enterprise consumer kinds.
 */
export function normalizeDependencyGraph(value: unknown): SkillDependencyGraphSnapshot {
  const graph: SkillDependencyGraph = sanitizeSkillDependencyGraph(value);

  const installedRobots = graph.installedRobots.map((r) => ({
    id: r.agentId,
    name: r.name,
  }));
  const sharedGroups = graph.sharedGroups.map((g) => ({
    id: g.groupId,
    name: g.name,
  }));
  const dependentSkills = graph.dependentSkills.map((s) => ({
    id: s.skillId,
    name: s.name,
  }));

  const record = asRecord(value) ?? {};
  const rawConsumers = Array.isArray(record.enterpriseConsumers) ? record.enterpriseConsumers : [];
  const enterpriseConsumers = rawConsumers
    .map((entry: unknown) => {
      const rec = asRecord(entry);
      if (!rec) {
        return null;
      }
      const kind = normalizeConsumerKind(rec.kind ?? rec.type);
      const id = typeof rec.id === "string" ? rec.id.trim() : null;
      const label =
        typeof rec.label === "string"
          ? rec.label.trim()
          : typeof rec.name === "string"
            ? rec.name.trim()
            : "";
      if (!label) {
        return null;
      }
      return { kind, id, label };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  const installedRobotCount = installedRobots.length;
  const sharedGroupCount = sharedGroups.length;
  const dependentSkillCount = dependentSkills.length;
  const enterpriseConsumerCount = enterpriseConsumers.length;

  return {
    installedRobotCount,
    sharedGroupCount,
    dependentSkillCount,
    enterpriseConsumerCount,
    hasAnyConsumer: computeHasAnyConsumer(
      installedRobotCount,
      sharedGroupCount,
      dependentSkillCount,
      enterpriseConsumerCount,
    ),
    installedRobots,
    sharedGroups,
    dependentSkills,
    enterpriseConsumers,
  };
}

/**
 * Loads a dependency summary for the given skill and caches it.
 * Calls the `skill-dependency.summary` gateway endpoint.
 */
export async function loadDependencySummary(
  state: SkillDependencyState,
  skillId: string,
): Promise<void> {
  if (!state.client || !state.connected) {
    return;
  }
  state.loadingSkillId = skillId;
  try {
    const result = await state.client.request("skill-dependency.summary", { skillId });
    state.summaryCache[skillId] = normalizeDependencySummary(result);
  } catch {
    // Graceful error handling: leave cache unchanged
  } finally {
    state.loadingSkillId = null;
  }
}

/**
 * Loads the full dependency graph for the given skill and caches it.
 * Calls the `skill-dependency.graph` gateway endpoint.
 */
export async function loadDependencyGraph(
  state: SkillDependencyState,
  skillId: string,
): Promise<void> {
  if (!state.client || !state.connected) {
    return;
  }
  state.loadingSkillId = skillId;
  try {
    const result = await state.client.request("skill-dependency.graph", { skillId });
    state.graphCache[skillId] = normalizeDependencyGraph(result);
  } catch {
    // Graceful error handling: leave cache unchanged
  } finally {
    state.loadingSkillId = null;
  }
}
