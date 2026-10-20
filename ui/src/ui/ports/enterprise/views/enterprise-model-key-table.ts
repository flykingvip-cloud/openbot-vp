/**
 * 模型与 API Key 的模型行。平台提供与企业自供共用同一张表，
 * 每一行都可以打开席位配置，写入与「模型授权」相同的 SeatModelGrant。
 */

import {
  buildAuthorizedModelCatalog,
  presentAuthorizedModel,
  type AuthorizedModelSource,
} from "../../../views/model-authorization-presentation.ts";

export type EnterpriseModelKeySupply = "platform" | "enterprise";

export type EnterpriseModelKeyRow = {
  modelId: string;
  title: string;
  supply: EnterpriseModelKeySupply;
  supplyLabel: "平台提供" | "企业自供";
  /** 平台行是只读摘要；企业行是可编辑入口旁的短说明。 */
  configSummary: string;
  configEditable: boolean;
  /** 两类供给都能打开组织树并写入席位授权。 */
  seatConfigurable: true;
  connectionId: string | null;
};

export type EnterpriseModelKeyConnection = {
  connectionId: string;
  displayName?: string | null;
  providerType?: string | null;
  baseUrl?: string | null;
  status?: string | null;
};

function statusLabel(status: string | null | undefined): string {
  if (status === "verified" || status === "models_discovered" || status === "active") {
    return "已连通";
  }
  if (status === "credential_saved" || status === "draft" || status === "verifying") {
    return "待验证";
  }
  return "未连通";
}

function pushUnique(rows: EnterpriseModelKeyRow[], seen: Set<string>, row: EnterpriseModelKeyRow) {
  if (!row.modelId || seen.has(row.modelId)) {
    return;
  }
  seen.add(row.modelId);
  rows.push(row);
}

export function buildEnterpriseModelKeyRows(input: {
  catalogModelIds: readonly string[];
  assets?: readonly AuthorizedModelSource[];
  connections?: readonly EnterpriseModelKeyConnection[];
}): EnterpriseModelKeyRow[] {
  const catalog = buildAuthorizedModelCatalog({
    assets: input.assets,
    connections: input.connections,
  });
  const connectionById = new Map(
    (input.connections ?? []).map((connection) => [connection.connectionId, connection]),
  );
  const rows: EnterpriseModelKeyRow[] = [];
  const seen = new Set<string>();

  for (const raw of input.catalogModelIds) {
    const modelId = raw.trim();
    if (!modelId || modelId.startsWith("ent/")) {
      continue;
    }
    const presented = presentAuthorizedModel(modelId, catalog);
    pushUnique(rows, seen, {
      modelId,
      title: presented.title,
      supply: "platform",
      supplyLabel: "平台提供",
      configSummary: "套餐下发 · 只读",
      configEditable: false,
      seatConfigurable: true,
      connectionId: null,
    });
  }

  for (const asset of input.assets ?? []) {
    const modelId = asset.runtimeModelId.trim();
    if (!modelId) {
      continue;
    }
    const presented = presentAuthorizedModel(modelId, catalog);
    const connection = asset.connectionId ? connectionById.get(asset.connectionId) : undefined;
    const protocol = connection?.providerType?.trim() || "企业连接";
    const endpoint = connection?.baseUrl?.trim();
    const summary = [statusLabel(connection?.status), protocol, endpoint]
      .filter(Boolean)
      .join(" · ");
    pushUnique(rows, seen, {
      modelId,
      title: presented.title,
      supply: "enterprise",
      supplyLabel: "企业自供",
      configSummary: summary,
      configEditable: true,
      seatConfigurable: true,
      connectionId: asset.connectionId?.trim() || null,
    });
  }

  return rows;
}
