import type { ModelAsset } from "./view-model.ts";

export type ModelAssetScopeBadge = "BYOK" | "租户专属";

export type ModelAssetPresentation = {
  title: string;
  subtitle: string;
  avatarLabel: string;
  badges: ModelAssetScopeBadge[];
  /** Local model id without tenant hash prefix (for import / display). */
  localModelId: string;
  tenantScopeId?: string;
};

export type ModelAssetLifecycleStage = "pending" | "referenced" | "configured" | "published";

const TENANT_SCOPE_PATTERN = /^[a-f0-9]{6,12}$/i;

export function parseScopedModelId(modelId: string): {
  tenantScopeId?: string;
  localModelId: string;
} {
  const slashIndex = modelId.indexOf("/");
  if (slashIndex <= 0) {
    return { localModelId: modelId };
  }
  const prefix = modelId.slice(0, slashIndex);
  const rest = modelId.slice(slashIndex + 1);
  if (!rest || !TENANT_SCOPE_PATTERN.test(prefix)) {
    return { localModelId: modelId };
  }
  return { tenantScopeId: prefix, localModelId: rest };
}

export function humanizeModelSlug(slug: string): string {
  const cleaned = slug.trim().replace(/[-_]+/g, " ");
  if (!cleaned) {
    return slug;
  }
  return cleaned.replace(/\b\w/g, (char) => char.toUpperCase());
}

function stripByokSuffix(name: string): { title: string; hasByok: boolean } {
  const match = name.match(/\s*\((BYOK[^)]*)\)\s*$/i);
  if (!match) {
    return { title: name.trim(), hasByok: false };
  }
  return {
    title: name.slice(0, match.index).trim(),
    hasByok: true,
  };
}

function looksLikeRawPath(value: string): boolean {
  return value.includes("/") || TENANT_SCOPE_PATTERN.test(value);
}

export function resolveModelAssetPresentation(params: {
  name?: string | null;
  modelId: string;
  providerId: string;
  providerName?: string;
}): ModelAssetPresentation {
  const fullModelId = params.modelId.includes("/")
    ? params.modelId
    : `${params.providerId}/${params.modelId}`;
  const providerPrefix = `${params.providerId}/`;
  const scopedFromFull = fullModelId.startsWith(providerPrefix)
    ? fullModelId.slice(providerPrefix.length)
    : fullModelId;
  const { tenantScopeId, localModelId } = parseScopedModelId(scopedFromFull);

  const badges: ModelAssetScopeBadge[] = [];
  if (tenantScopeId) {
    badges.push("租户专属");
  }

  const rawName = params.name?.trim() ?? "";
  const { title: strippedName, hasByok } = stripByokSuffix(rawName);
  if (hasByok) {
    badges.push("BYOK");
  }

  let title = strippedName;
  if (!title || title === scopedFromFull || title === fullModelId || looksLikeRawPath(title)) {
    title = humanizeModelSlug(localModelId);
  }

  const providerLabel = params.providerName?.trim() || params.providerId;
  const subtitle = `${providerLabel} · ${localModelId}`;
  const avatarLabel = providerLabel.slice(0, 2).toUpperCase();

  return {
    title,
    subtitle,
    avatarLabel,
    badges,
    localModelId,
    ...(tenantScopeId ? { tenantScopeId } : {}),
  };
}

export function resolveModelAssetLifecycleStage(asset: ModelAsset): ModelAssetLifecycleStage {
  if (asset.source === "discovered") {
    return "pending";
  }
  if (asset.source === "referenced") {
    return "referenced";
  }
  if (asset.inRecommendationPool) {
    return "published";
  }
  return "configured";
}

export function lifecycleStageLabel(stage: ModelAssetLifecycleStage): string {
  switch (stage) {
    case "pending":
      return "待入池";
    case "referenced":
      return "已引用";
    case "configured":
      return "已配置";
    case "published":
      return "已上架";
  }
}

export function tenantSelectableLabel(asset: ModelAsset): string {
  if (asset.admissionControlsAvailable === false || asset.admissionControlsAvailable == null) {
    // Backend tenant-admission RPC not wired — never imply platform "允许".
    return "尚未接入";
  }
  if (asset.source !== "configured") {
    return "需先入池";
  }
  if (!asset.inRecommendationPool) {
    return "未上架";
  }
  if (asset.health === "unavailable") {
    return "不可用";
  }
  if (asset.health === "degraded") {
    return "降级可用";
  }
  return asset.tenantSelectable ? "允许" : "不允许";
}

export function tenantSelectableTone(asset: ModelAsset): "ok" | "warn" | "" {
  if (asset.admissionControlsAvailable === false || asset.admissionControlsAvailable == null) {
    return "warn";
  }
  if (asset.tenantSelectable) {
    return "ok";
  }
  if (asset.source === "configured" && asset.inRecommendationPool) {
    return "warn";
  }
  return "";
}

export function autoRoutingAdmissionLabel(asset: ModelAsset): string {
  if (asset.admissionControlsAvailable === false || asset.admissionControlsAvailable == null) {
    return "尚未接入";
  }
  switch (asset.autoRouting ?? "disabled") {
    case "eligible":
      return "可参与";
    case "restricted":
      return "受限";
    case "paused":
      return "暂停";
    case "disabled":
    default:
      return "未启用";
  }
}
