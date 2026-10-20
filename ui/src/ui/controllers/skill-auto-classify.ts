import type { GatewayBrowserClient } from "../gateway.ts";

export type ClassificationSuggestion = {
  skillId: string;
  suggestedCategory: string | null;
  suggestedTags: string[];
  reason: string;
  confidence: number;
};

export type SkillAutoClassifyState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  pendingSuggestions: ClassificationSuggestion[];
  loading: boolean;
};

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

function boundedConfidence(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

export function normalizeClassificationSuggestion(value: unknown): ClassificationSuggestion | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const skillId = stringValue(record.skillId).trim();
  if (!skillId) {
    return null;
  }
  const suggestedCategory =
    typeof record.suggestedCategory === "string" && record.suggestedCategory.trim()
      ? record.suggestedCategory.trim()
      : null;
  const suggestedTags = stringArray(record.suggestedTags);
  const reason = stringValue(record.reason).trim() || "基于同类技能的常见分类";
  const confidence = boundedConfidence(record.confidence);

  return {
    skillId,
    suggestedCategory,
    suggestedTags,
    reason,
    confidence,
  };
}

function normalizeSuggestionList(value: unknown): ClassificationSuggestion[] {
  const record = asRecord(value);
  const rawList = Array.isArray(value)
    ? value
    : Array.isArray(record?.suggestions)
      ? record.suggestions
      : [];
  return rawList
    .map(normalizeClassificationSuggestion)
    .filter((s): s is ClassificationSuggestion => s !== null);
}

export async function loadClassificationSuggestions(state: SkillAutoClassifyState): Promise<void> {
  if (!state.client || !state.connected || state.loading) {
    return;
  }
  state.loading = true;
  try {
    const result = await state.client.request("skill-auto-classify.suggestions", {});
    state.pendingSuggestions = normalizeSuggestionList(result);
  } catch {
    // On failure, keep existing suggestions unchanged
  } finally {
    state.loading = false;
  }
}

export async function acceptClassificationSuggestion(
  state: SkillAutoClassifyState,
  skillId: string,
  acceptCategory: boolean,
  acceptTags: boolean,
): Promise<void> {
  if (!state.client || !state.connected) {
    return;
  }
  try {
    await state.client.request("skill-auto-classify.accept", {
      skillId,
      acceptCategory,
      acceptTags,
    });
    state.pendingSuggestions = state.pendingSuggestions.filter((s) => s.skillId !== skillId);
  } catch {
    // Silently fail — suggestion remains in list for retry
  }
}

export function dismissClassificationSuggestion(
  state: SkillAutoClassifyState,
  skillId: string,
): void {
  state.pendingSuggestions = state.pendingSuggestions.filter((s) => s.skillId !== skillId);
}
