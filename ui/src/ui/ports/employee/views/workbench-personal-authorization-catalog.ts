import type { SettingsContract } from "./workbench-stage-contracts.ts";

export type ReadyCatalogEntry = NonNullable<
  NonNullable<SettingsContract["userOperationalIdentitySnapshot"]>["providerCatalog"]
>[number];

/** Stable provider order without exposing category labels in the nav. */
const PROVIDER_CATEGORY_RANK: Record<ReadyCatalogEntry["category"], number> = {
  official: 0,
  communication: 1,
  developer: 2,
  social: 3,
};

/** Pin 微信公众号 then 微信个人号 before category rank so 个人号 is not buried in social. */
function providerPinRank(provider: string): number {
  if (provider === "wechat-official") {
    return 0;
  }
  if (provider === "wechat-personal") {
    return 1;
  }
  return 100;
}

export function sortReadyCatalog(readyCatalog: ReadyCatalogEntry[]): ReadyCatalogEntry[] {
  return [...readyCatalog].toSorted((left, right) => {
    const pinDelta = providerPinRank(left.provider) - providerPinRank(right.provider);
    if (pinDelta !== 0) {
      return pinDelta;
    }
    const rankDelta =
      (PROVIDER_CATEGORY_RANK[left.category] ?? 99) -
      (PROVIDER_CATEGORY_RANK[right.category] ?? 99);
    if (rankDelta !== 0) {
      return rankDelta;
    }
    return left.label.localeCompare(right.label, "zh-CN");
  });
}
