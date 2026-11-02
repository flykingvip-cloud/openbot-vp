/**
 * 模型授权展示文案。不改变 modelId、授权集合或上界判定。
 * 企业自供运行时 id 形如 `ent/<connectionShort>/<upstream>`。
 */

import { humanizeModelSlug } from "../ports/platform/models/model-asset-presentation.ts";

const OPAQUE_SUBJECT_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type AuthorizedModelSourceKind = "platform" | "enterprise";

export type AuthorizedModelPresentation = {
  modelId: string;
  title: string;
  sourceKind: AuthorizedModelSourceKind;
  sourceName: string;
  badge: string;
};

export type AuthorizedModelSource = {
  runtimeModelId: string;
  displayName?: string | null;
  upstreamModelId?: string | null;
  connectionId?: string | null;
  connectionName?: string | null;
};

export type AuthorizedModelCatalog = {
  byRuntimeId: ReadonlyMap<string, AuthorizedModelSource>;
  connectionNameByHash: ReadonlyMap<string, string>;
};

export function looksLikeOpaqueSubjectId(value: string): boolean {
  return OPAQUE_SUBJECT_ID.test(value.trim());
}

export function buildAuthorizedModelCatalog(input: {
  assets?: readonly AuthorizedModelSource[];
  connections?: readonly { connectionId: string; displayName?: string | null }[];
}): AuthorizedModelCatalog {
  const connectionNames = new Map<string, string>();
  for (const connection of input.connections ?? []) {
    const name = connection.displayName?.trim() ?? "";
    if (connection.connectionId && name) {
      connectionNames.set(connection.connectionId, name);
    }
  }
  const byRuntimeId = new Map<string, AuthorizedModelSource>();
  const connectionNameByHash = new Map<string, string>();
  for (const asset of input.assets ?? []) {
    const runtimeModelId = asset.runtimeModelId.trim();
    if (!runtimeModelId) {
      continue;
    }
    const connectionName =
      asset.connectionName?.trim() ||
      (asset.connectionId ? connectionNames.get(asset.connectionId) : "") ||
      "";
    const source: AuthorizedModelSource = {
      ...asset,
      runtimeModelId,
      ...(connectionName ? { connectionName } : {}),
    };
    byRuntimeId.set(runtimeModelId, source);
    const enterprise = splitEnterpriseRuntimeId(runtimeModelId);
    if (enterprise?.hash && connectionName) {
      connectionNameByHash.set(enterprise.hash.toLowerCase(), connectionName);
    }
  }
  return { byRuntimeId, connectionNameByHash };
}

function splitEnterpriseRuntimeId(modelId: string): { hash: string; upstream: string } | null {
  if (!modelId.startsWith("ent/")) {
    return null;
  }
  const rest = modelId.slice(4);
  if (!rest) {
    return null;
  }
  const slash = rest.indexOf("/");
  if (slash <= 0) {
    return { hash: "", upstream: rest };
  }
  return { hash: rest.slice(0, slash), upstream: rest.slice(slash + 1) };
}

function usableDisplayName(
  name: string | null | undefined,
  raws: readonly string[],
): string | null {
  const trimmed = name?.trim() ?? "";
  if (!trimmed || trimmed.includes("/")) {
    return null;
  }
  if (raws.some((raw) => raw.trim() === trimmed)) {
    return null;
  }
  return trimmed;
}

/**
 * 越界文案。目录已加载时，把「资产已删除」和「还在库里但不在上界」分开，
 * 避免把已移除的连接哈希说成套餐不允许。
 */
export function describeUnavailableModelGrants(input: {
  modelIds: readonly string[];
  catalog?: AuthorizedModelCatalog | null;
}): string {
  const ids = [
    ...new Set(input.modelIds.map((id) => id.trim()).filter((id) => id.length > 0)),
  ].toSorted();
  if (ids.length === 0) {
    return "";
  }
  const catalog = input.catalog;
  if (!catalog) {
    return `以下模型不在本企业模型上界（套餐∪企业自供）内，不能授权：${ids.join(", ")}`;
  }
  const missing: string[] = [];
  const outside: string[] = [];
  for (const id of ids) {
    if (id.startsWith("ent/") && !catalog.byRuntimeId.has(id)) {
      missing.push(id);
    } else {
      outside.push(id);
    }
  }
  const parts: string[] = [];
  if (outside.length > 0) {
    parts.push(`以下模型不在本企业模型上界（套餐∪企业自供）内，不能授权：${outside.join(", ")}`);
  }
  if (missing.length > 0) {
    parts.push(`以下模型已不在模型库，不能授权（取消勾选即可移除）：${missing.join(", ")}`);
  }
  return parts.join(" ");
}

export function enterpriseUnusableBannerText(
  warnings: readonly { title: string; detail: string }[],
): string {
  if (warnings.length === 0) {
    return "";
  }
  const lines = warnings.map((warning) => `${warning.title}：${warning.detail}`);
  return `以下企业自供模型当前不可用，请先处理，不要等到员工聊天失败。${lines.join(" ")}`;
}

export function presentAuthorizedModel(
  modelId: string,
  catalog?: AuthorizedModelCatalog | null,
): AuthorizedModelPresentation {
  const id = modelId.trim();
  const enterprise = splitEnterpriseRuntimeId(id);
  if (enterprise) {
    const asset = catalog?.byRuntimeId.get(id);
    const sourceName =
      asset?.connectionName?.trim() ||
      (enterprise.hash
        ? catalog?.connectionNameByHash.get(enterprise.hash.toLowerCase())
        : undefined) ||
      enterprise.hash ||
      "企业自供";
    const upstream = asset?.upstreamModelId?.trim() || enterprise.upstream || id;
    const title =
      usableDisplayName(asset?.displayName, [upstream, id, enterprise.upstream]) ||
      humanizeModelSlug(upstream);
    return {
      modelId: id,
      title,
      sourceKind: "enterprise",
      sourceName,
      badge: `企业自供 · ${sourceName}`,
    };
  }
  const slash = id.indexOf("/");
  if (slash > 0) {
    const provider = id.slice(0, slash);
    const model = id.slice(slash + 1);
    return {
      modelId: id,
      title: humanizeModelSlug(model || id),
      sourceKind: "platform",
      sourceName: provider,
      badge: `平台提供 · ${provider}`,
    };
  }
  return {
    modelId: id,
    title: humanizeModelSlug(id),
    sourceKind: "platform",
    sourceName: "平台提供",
    badge: "平台提供",
  };
}

export function modelAuthorizationSubjectHeadline(entry: {
  label: string;
  meta?: string | null;
  subjectType?: string | null;
  subjectId?: string | null;
  roleLabel?: string | null;
}): { title: string; tooltip: string } {
  const subjectId = entry.subjectId?.trim() ?? "";
  const kind = entry.subjectType === "employee" ? "员工" : "席位";
  const label = entry.label.trim();
  const meta = entry.meta?.trim() ?? "";
  const job =
    meta &&
    meta !== "空岗" &&
    meta !== "已有授权" &&
    meta !== "已撤销" &&
    meta !== subjectId &&
    !looksLikeOpaqueSubjectId(meta)
      ? meta
      : "";
  const labelIsOpaque =
    looksLikeOpaqueSubjectId(subjectId) &&
    (label === subjectId ||
      label === `${kind} · ${subjectId}` ||
      label === `${kind}：${subjectId}` ||
      label.endsWith(subjectId));
  const person = labelIsOpaque ? "" : label;
  const title = person && job && job !== person ? `${person} · ${job}` : person || job || kind;
  const tooltip = [subjectId, entry.roleLabel?.trim() ?? ""].filter(
    (part, index, all) => part.length > 0 && all.indexOf(part) === index,
  );
  return { title, tooltip: tooltip.join(" · ") };
}
