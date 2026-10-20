import type { GatewayBrowserClient } from "../gateway.ts";
import type { SkillHealthStatus } from "./skill-models.ts";

export type SkillRecommendation = {
  skillId: string;
  name: string;
  summary: string;
  category: string;
  tags: string[];
  source: "enterprise" | "shared";
  sourceLabel: string;
  health: SkillHealthStatus;
  usageCount: number;
  matchScore: number;
};

export type SkillRecommendationsState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  loading: boolean;
  error: string | null;
  agentId: string | null;
  recommendations: SkillRecommendation[];
};

// --- Normalization helpers ---

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((entry) => stringValue(entry).trim()).filter(Boolean)
    : [];
}

function normalizeHealthStatus(value: unknown): SkillHealthStatus {
  return value === "warning" || value === "broken" ? value : "healthy";
}

function normalizeSource(value: unknown): "enterprise" | "shared" {
  return value === "shared" ? "shared" : "enterprise";
}

function clampScore(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

/**
 * Normalizes a single raw recommendation from the gateway response.
 * Handles missing or malformed fields gracefully.
 */
export function normalizeRecommendation(value: unknown): SkillRecommendation {
  const record = asRecord(value) ?? {};
  return {
    skillId: stringValue(record.skillId).trim(),
    name: stringValue(record.name).trim(),
    summary: stringValue(record.summary).trim(),
    category: stringValue(record.category).trim(),
    tags: stringArray(record.tags),
    source: normalizeSource(record.source),
    sourceLabel: stringValue(record.sourceLabel, "企业资产库").trim() || "企业资产库",
    health: normalizeHealthStatus(record.health),
    usageCount: Math.max(
      0,
      typeof record.usageCount === "number" && Number.isFinite(record.usageCount)
        ? record.usageCount
        : 0,
    ),
    matchScore: clampScore(record.matchScore),
  };
}

/**
 * Normalizes an array of raw recommendations from the gateway response.
 */
export function normalizeRecommendationList(value: unknown): SkillRecommendation[] {
  const record = asRecord(value);
  const rawItems = Array.isArray(value)
    ? value
    : Array.isArray(record?.items)
      ? record.items
      : Array.isArray(record?.recommendations)
        ? record.recommendations
        : [];
  return rawItems.map(normalizeRecommendation);
}

/**
 * Filters recommendations by source type ("enterprise" or "shared").
 */
export function filterBySource(
  recommendations: SkillRecommendation[],
  source: "enterprise" | "shared",
): SkillRecommendation[] {
  return recommendations.filter((r) => r.source === source);
}

// --- Controller functions ---

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Loads skill recommendations for a given robot (agentId).
 * Calls the `skill-recommendations.list` gateway endpoint and normalizes the response.
 * Only returns skills with source "enterprise" (published) or "shared" (from groups).
 */
export async function loadRecommendations(
  state: SkillRecommendationsState,
  agentId: string,
): Promise<void> {
  if (!state.client || !state.connected || state.loading) {
    return;
  }
  state.loading = true;
  state.error = null;
  try {
    const result = await state.client.request("skill-recommendations.list", { agentId });
    state.recommendations = normalizeRecommendationList(result);
    state.agentId = agentId;
  } catch (err) {
    state.error = getErrorMessage(err);
  } finally {
    state.loading = false;
  }
}
