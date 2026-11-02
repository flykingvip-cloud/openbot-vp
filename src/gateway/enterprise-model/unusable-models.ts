/**
 * Enterprise-admin warnings for self-supplied models that can no longer be called.
 * Draft / not-yet-verified connections are not warnings. A failed probe, an
 * unhealthy asset, or a grant whose asset is gone is.
 */

export type UnusableEnterpriseModelKind = "connection" | "asset" | "grant";

export type UnusableEnterpriseModelWarning = {
  kind: UnusableEnterpriseModelKind;
  id: string;
  title: string;
  detail: string;
  modelId?: string;
  connectionId?: string;
};

export type UnusableEnterpriseConnection = {
  connectionId: string;
  displayName?: string | null;
  status: string;
  healthStatus: string;
  lastVerificationResult?: { code?: string | null; message?: string | null } | null;
};

export type UnusableEnterpriseAsset = {
  runtimeModelId: string;
  displayName?: string | null;
  upstreamModelId?: string | null;
  connectionId: string;
  enabled: boolean;
  healthStatus: string;
};

const FAILED_CONNECTION_STATUSES = new Set([
  "invalid_credential",
  "network_unreachable",
  "protocol_incompatible",
  "rate_limited",
]);

function connectionProbeFailed(connection: UnusableEnterpriseConnection): boolean {
  if (connection.status === "disabled") {
    return false;
  }
  if (connection.healthStatus === "unhealthy" || connection.healthStatus === "degraded") {
    return true;
  }
  if (FAILED_CONNECTION_STATUSES.has(connection.status)) {
    return true;
  }
  const code = connection.lastVerificationResult?.code?.trim() ?? "";
  return code.length > 0 && code !== "OK";
}

function assetTitle(asset: UnusableEnterpriseAsset): string {
  const display = asset.displayName?.trim() ?? "";
  const upstream = asset.upstreamModelId?.trim() ?? "";
  if (display && display !== asset.runtimeModelId && display !== upstream) {
    return display;
  }
  return upstream || asset.runtimeModelId;
}

export function listUnusableEnterpriseModelWarnings(input: {
  connections: readonly UnusableEnterpriseConnection[];
  assets: readonly UnusableEnterpriseAsset[];
  grantedModelIds?: readonly string[];
}): UnusableEnterpriseModelWarning[] {
  const warnings: UnusableEnterpriseModelWarning[] = [];
  const seen = new Set<string>();
  const push = (warning: UnusableEnterpriseModelWarning) => {
    if (seen.has(warning.id)) {
      return;
    }
    seen.add(warning.id);
    warnings.push(warning);
  };

  const failedConnectionIds = new Set<string>();
  for (const connection of input.connections) {
    if (!connectionProbeFailed(connection)) {
      continue;
    }
    failedConnectionIds.add(connection.connectionId);
    const name = connection.displayName?.trim() || connection.connectionId;
    const models = input.assets
      .filter((asset) => asset.connectionId === connection.connectionId && asset.enabled)
      .map(assetTitle);
    const probeMessage = connection.lastVerificationResult?.message?.trim() ?? "";
    const state = probeMessage || `状态 ${connection.status}，健康 ${connection.healthStatus}`;
    const listed = models.length > 0 ? `涉及模型：${models.join("、")}。` : "";
    push({
      kind: "connection",
      id: `connection:${connection.connectionId}`,
      connectionId: connection.connectionId,
      title: name,
      detail: `企业自供连接不可用（${state}）。${listed}员工调用这些模型会失败。`.replace(
        /\s+/g,
        " ",
      ),
    });
  }

  for (const asset of input.assets) {
    if (!asset.enabled) {
      continue;
    }
    if (asset.healthStatus !== "unhealthy" && asset.healthStatus !== "degraded") {
      continue;
    }
    if (failedConnectionIds.has(asset.connectionId)) {
      continue;
    }
    const runtimeModelId = asset.runtimeModelId.trim();
    if (!runtimeModelId) {
      continue;
    }
    push({
      kind: "asset",
      id: `asset:${runtimeModelId}`,
      modelId: runtimeModelId,
      connectionId: asset.connectionId,
      title: assetTitle(asset),
      detail: `模型健康状态为 ${asset.healthStatus}，当前不能调用。`,
    });
  }

  const knownRuntimeIds = new Set(
    input.assets.map((asset) => asset.runtimeModelId.trim()).filter((id) => id.length > 0),
  );
  for (const raw of input.grantedModelIds ?? []) {
    const modelId = raw.trim();
    if (!modelId.startsWith("ent/") || knownRuntimeIds.has(modelId)) {
      continue;
    }
    push({
      kind: "grant",
      id: `grant:${modelId}`,
      modelId,
      title: modelId,
      detail: "席位授权仍指向已不在模型库的运行时模型，打开模型授权时会从授权中移除。",
    });
  }

  return warnings;
}
