import type { PlatformModelsActions } from "./actions.ts";
import {
  resolveModelAssetLifecycleStage,
  resolveModelAssetPresentation,
  type ModelAssetLifecycleStage,
} from "./model-asset-presentation.ts";
import {
  hasSuccessfulModelConnection,
  markModelConnectionVerified,
} from "./model-connection-gate.ts";
import type { ModelAsset } from "./view-model.ts";

export function localModelIdFromAsset(asset: ModelAsset) {
  const prefix = `${asset.providerId}/`;
  return asset.modelId.startsWith(prefix) ? asset.modelId.slice(prefix.length) : asset.modelId;
}

export function resolveModelAssetCanManage(params: {
  compatCanManage?: boolean;
  actions: PlatformModelsActions;
}) {
  const { compatCanManage, actions } = params;
  if (compatCanManage === false) {
    return false;
  }
  return (
    typeof actions.onImportCatalogModel === "function" && typeof actions.onSaveConfig === "function"
  );
}

export function primaryLifecycleAction(
  stage: ModelAssetLifecycleStage,
): "import" | "publish" | "done" {
  if (stage === "pending" || stage === "referenced") {
    return "import";
  }
  if (stage === "configured") {
    return "publish";
  }
  return "done";
}

export async function importAssetIntoPool(params: {
  asset: ModelAsset;
  actions: PlatformModelsActions;
  /** Set when this session already probed the endpoint successfully. */
  connectionVerified?: boolean;
}) {
  const { asset, actions, connectionVerified } = params;
  if (!connectionVerified && !hasSuccessfulModelConnection(asset)) {
    return false;
  }
  const presentation = resolveModelAssetPresentation({
    name: asset.displayName,
    modelId: localModelIdFromAsset(asset),
    providerId: asset.providerId,
    providerName: asset.providerName,
  });
  actions.onImportCatalogModel({
    providerId: asset.providerId,
    modelId: presentation.localModelId,
    name: asset.displayName,
    contextWindow: asset.contextWindow ?? null,
  });
  actions.onUpsertAllowlistEntry(asset.modelId, asset.displayName);
  await actions.onSaveConfig?.();
  markModelConnectionVerified(asset.modelId);
  return true;
}

/**
 * Persist the endpoint so the gateway can probe it, then allowlist only the models
 * whose probe succeeded. Failures stay configured-but-pending and out of the pool.
 */
export async function saveEndpointThenAllowlistVerified<
  T extends { providerId: string; modelId: string; name: string },
>(params: {
  inputs: T[];
  add: (input: T) => void;
  save: () => Promise<void> | void;
  allowlist: (modelRef: string, name: string) => void;
  verify: (modelRef: string) => Promise<boolean>;
}) {
  const { inputs, add, save, allowlist, verify } = params;
  for (const input of inputs) {
    add(input);
  }
  await save();
  const allowlisted: string[] = [];
  for (const input of inputs) {
    const modelRef = `${input.providerId}/${input.modelId}`;
    if (await verify(modelRef)) {
      allowlisted.push(modelRef);
      allowlist(modelRef, input.name);
      markModelConnectionVerified(modelRef);
    }
  }
  if (allowlisted.length > 0) {
    await save();
  }
  return { allowlisted };
}

export async function publishAssetToAllowlist(params: {
  asset: ModelAsset;
  actions: PlatformModelsActions;
}) {
  const { asset, actions } = params;
  actions.onUpsertAllowlistEntry(asset.modelId, asset.displayName);
  await actions.onSaveConfig?.();
}

export function lifecycleActionLabel(asset: ModelAsset) {
  switch (primaryLifecycleAction(resolveModelAssetLifecycleStage(asset))) {
    case "import":
      return "入池";
    case "publish":
      return "上架";
    default:
      return "已上架";
  }
}
