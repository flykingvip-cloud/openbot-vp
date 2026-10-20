export const IDENTITY_PROVIDER_CATEGORY_LABELS = {
  official: "企业官方与新媒体",
  communication: "企业通信身份",
  business: "企业业务系统",
} as const;

export type IdentityProviderInventoryGroup<TIdentity> = {
  provider: string;
  providerLabel: string;
  category: "official" | "communication" | "business";
  canRegister: boolean;
  identities: TIdentity[];
};

export function buildIdentityProviderInventoryGroups<
  TIdentity extends {
    provider: string;
    providerLabel: string;
    category: "official" | "communication" | "business";
  },
>(params: {
  providerCatalog: Array<{
    provider: string;
    label: string;
    category: "official" | "communication" | "business";
    registrationReady?: boolean;
  }>;
  identityAssetSummaries: TIdentity[];
}): Array<IdentityProviderInventoryGroup<TIdentity>> {
  const assetsByProvider = new Map<string, TIdentity[]>();
  for (const asset of params.identityAssetSummaries) {
    const bucket = assetsByProvider.get(asset.provider) ?? [];
    bucket.push(asset);
    assetsByProvider.set(asset.provider, bucket);
  }
  const catalogProviders = new Set(params.providerCatalog.map((entry) => entry.provider));
  const catalogGroups = params.providerCatalog.map((entry) => ({
    provider: entry.provider,
    providerLabel: entry.label,
    category: entry.category,
    canRegister: entry.registrationReady !== false,
    identities: assetsByProvider.get(entry.provider) ?? [],
  }));
  const leftoverGroups = [...assetsByProvider.entries()]
    .filter(([provider, identities]) => !catalogProviders.has(provider) && identities.length > 0)
    .map(([provider, identities]) => ({
      provider,
      providerLabel: identities[0]?.providerLabel ?? provider,
      category: identities[0]?.category ?? ("communication" as const),
      canRegister: false,
      identities,
    }));
  return [...catalogGroups, ...leftoverGroups].toSorted((left, right) =>
    left.providerLabel.localeCompare(right.providerLabel, "zh-CN"),
  );
}
