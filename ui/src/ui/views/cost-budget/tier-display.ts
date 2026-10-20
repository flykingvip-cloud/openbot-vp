import { t } from "../../../i18n/index.ts";

const TIER_I18N_KEYS: Record<string, string> = {
  tier_a: "costBudget.tierDisplay.tier_a",
  tier_b: "costBudget.tierDisplay.tier_b",
  tier_c: "costBudget.tierDisplay.tier_c",
};

/** 将 tier id（如 tier_a）转为用户可读名称；未知 id 原样返回。 */
export function formatTierDisplayName(tierId: string): string {
  const trimmed = tierId.trim();
  if (!trimmed) {
    return trimmed;
  }
  const key = TIER_I18N_KEYS[trimmed];
  if (key) {
    const label = t(key);
    if (label !== key) {
      return label;
    }
  }
  return trimmed;
}

export function formatTierList(tierIds: readonly string[]): string {
  if (tierIds.length === 0) {
    return "—";
  }
  return tierIds.map(formatTierDisplayName).join("、");
}

const TIER_COMPACT_LABELS: Record<string, string> = {
  tier_a: "Tier A",
  tier_b: "Tier B",
  tier_c: "Tier C",
};

/** 成长路径等紧凑场景：Tier B + Tier C（不含中文能力层名称）。 */
export function formatTierListCompact(tierIds: readonly string[]): string {
  if (tierIds.length === 0) {
    return "—";
  }
  return tierIds
    .map((tierId) => {
      const trimmed = tierId.trim();
      return TIER_COMPACT_LABELS[trimmed] ?? trimmed;
    })
    .join(" + ");
}
