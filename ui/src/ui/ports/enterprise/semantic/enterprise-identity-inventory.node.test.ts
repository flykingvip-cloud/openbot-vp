import { describe, expect, it } from "vitest";
import { buildIdentityProviderInventoryGroups } from "./enterprise-identity-inventory.ts";

describe("buildIdentityProviderInventoryGroups", () => {
  it("keeps empty catalog providers visible and leftover IM identities readable but not registerable", () => {
    const groups = buildIdentityProviderInventoryGroups({
      providerCatalog: [
        {
          provider: "wechat-official",
          label: "微信公众号",
          category: "official",
          registrationReady: true,
        },
        {
          provider: "kuaishou",
          label: "快手（企业）",
          category: "official",
          registrationReady: true,
        },
        {
          provider: "tencent-meeting",
          label: "腾讯会议（企业）",
          category: "communication",
          registrationReady: true,
        },
      ],
      identityAssetSummaries: [
        {
          identityId: "id-mp",
          displayName: "AI数字替身",
          provider: "wechat-official",
          providerLabel: "微信公众号",
          category: "official" as const,
        },
        {
          identityId: "id-feishu",
          displayName: "Acme Feishu",
          provider: "feishu",
          providerLabel: "飞书（已移出目录，可经 MCP 接入）",
          category: "communication" as const,
        },
      ],
    });

    expect(groups.map((group) => group.provider)).toEqual([
      "feishu",
      "kuaishou",
      "tencent-meeting",
      "wechat-official",
    ]);
    expect(groups.find((group) => group.provider === "kuaishou")?.identities).toEqual([]);
    expect(groups.find((group) => group.provider === "kuaishou")?.canRegister).toBe(true);
    expect(groups.find((group) => group.provider === "feishu")?.canRegister).toBe(false);
    expect(groups.find((group) => group.provider === "wechat-official")?.identities).toHaveLength(
      1,
    );
  });
});
