import type { CollaborationSpacesListResult } from "../../../types.ts";
import type { EnterprisePortReadModel } from "../semantic/enterprise-read-model.ts";

export type HandoverAccessPolicyRow = {
  policyId: string;
  resourceType: string;
  resourceId: string;
  action: string;
};

export type EnterpriseHandoverSessionDataTransferSnapshot = {
  recentSessions: boolean;
  historyArchive: boolean;
  coveredAgentIds: string[];
  executedAt?: string;
  archivedSessionIds?: string[];
  recentSessionIds?: string[];
  archivedTranscriptCount?: number;
};

export function formatHandoverSessionTransferSummary(
  transfer: EnterpriseHandoverSessionDataTransferSnapshot | null | undefined,
): { headline: string; details: string[] } | null {
  if (!transfer || (!transfer.recentSessions && !transfer.historyArchive)) {
    return null;
  }
  const executed = Boolean(transfer.executedAt?.trim());
  const details: string[] = [];
  if (transfer.recentSessions) {
    if (executed) {
      details.push(`近期会话：已标记继承 ${transfer.recentSessionIds?.length ?? 0} 个`);
    } else {
      details.push(
        `近期会话：交接完成后继承最近 30 天记录（覆盖 ${transfer.coveredAgentIds.length} 个机器人）`,
      );
    }
  }
  if (transfer.historyArchive) {
    if (executed) {
      const sessionCount = transfer.archivedSessionIds?.length ?? 0;
      const fileCount = transfer.archivedTranscriptCount ?? 0;
      details.push(`历史归档：已归档 ${sessionCount} 个会话（${fileCount} 个 transcript 文件）`);
    } else {
      details.push("历史归档：交接完成时归档超过 30 天的 transcript");
    }
  }
  return {
    headline: executed ? "会话数据迁移结果" : "会话数据迁移计划",
    details,
  };
}

export function resolveHandoverSessionDataStatusLabel(params: {
  dataKey: "recent_sessions" | "history_archive";
  transfer: EnterpriseHandoverSessionDataTransferSnapshot | null | undefined;
}): { label: string; tone: "ok" | "warn" | "neutral" } {
  const { dataKey, transfer } = params;
  if (!transfer) {
    return { label: "可继承", tone: "ok" };
  }
  const executed = Boolean(transfer.executedAt?.trim());
  if (dataKey === "recent_sessions") {
    if (!transfer.recentSessions) {
      return { label: "未选择", tone: "neutral" };
    }
    if (executed) {
      return {
        label: `已继承 ${transfer.recentSessionIds?.length ?? 0}`,
        tone: "ok",
      };
    }
    return { label: "待继承", tone: "warn" };
  }
  if (!transfer.historyArchive) {
    return { label: "未选择", tone: "neutral" };
  }
  if (executed) {
    return {
      label: `已归档 ${transfer.archivedSessionIds?.length ?? 0}`,
      tone: "ok",
    };
  }
  return { label: "待归档", tone: "warn" };
}

export function formatHandoverExceptionFlagLabel(flag: string): string {
  const normalized = flag.trim().toLowerCase();
  switch (normalized) {
    case "connector_rebind_required":
      return "连接器需继任后重新授权";
    case "memory_review_pending":
      return "知识库需人工复核";
    case "credential_reauthorization_required":
      return "凭证需重新授权";
    default:
      return flag.trim();
  }
}

export function parseHandoverExceptionFlags(raw: string): string[] {
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export function formatHandoverExceptionFlags(raw: string): string {
  const flags = parseHandoverExceptionFlags(raw);
  if (flags.length === 0) {
    return "";
  }
  return flags.map((flag) => formatHandoverExceptionFlagLabel(flag)).join("；");
}

export function detectHandoverExceptionFlags(params: {
  connectorCredentialReauthorizationRequired?: boolean;
  memoryScopes?: Array<{ transferClass?: string }>;
}): string[] {
  const flags: string[] = [];
  if (params.connectorCredentialReauthorizationRequired) {
    flags.push("connector_rebind_required");
  }
  if (params.memoryScopes?.some((scope) => scope.transferClass === "manual_review")) {
    flags.push("memory_review_pending");
  }
  return flags;
}

function formatUnresolvedCollaborationName(assetId: string): string {
  const normalized = assetId.trim();
  if (!normalized) {
    return assetId;
  }
  if (/^grp[-:]/i.test(normalized)) {
    return `协作小组 · ${normalized.replace(/^grp[-:]/i, "").slice(0, 24)}`;
  }
  if (/^space[-:]/i.test(normalized) || /^[0-9a-f-]{36}$/i.test(normalized)) {
    return `协作空间 · ${normalized.replace(/^space[-:]/i, "").slice(0, 12)}`;
  }
  // Content-hash / node-derived ids (e.g. 64-char hex) must not dump raw into UI.
  if (/^[0-9a-f]{40,128}$/i.test(normalized)) {
    return `协作组 · ${normalized.slice(0, 8)}…`;
  }
  return normalized;
}

export function resolveSeatMemoryScopeId(seatId: string): string {
  return `seat:${seatId}`;
}

/** Normalize collaboration ids so `space-sales` and `group-sales` collapse when equivalent. */
export function normalizeCollaborationAssetKey(assetId: string): string {
  return assetId
    .trim()
    .toLowerCase()
    .replace(/^(space|group)[-_:/]+/i, "");
}

function findCollaborationSpaceByAssetId(
  spaces: Array<{
    id?: string | null;
    groupId?: string | null;
    title?: string | null;
  }>,
  assetId: string,
) {
  const normalizedAssetId = assetId.trim();
  if (!normalizedAssetId) {
    return null;
  }
  const normalizedKey = normalizeCollaborationAssetKey(normalizedAssetId);
  for (const space of spaces) {
    const id = space.id?.trim() ?? "";
    const groupId = space.groupId?.trim() ?? "";
    if (
      id === normalizedAssetId ||
      groupId === normalizedAssetId ||
      (id && normalizeCollaborationAssetKey(id) === normalizedKey) ||
      (groupId && normalizeCollaborationAssetKey(groupId) === normalizedKey)
    ) {
      return space;
    }
  }
  return null;
}

export function resolveCollaborationGroupDisplayName(
  readModel: EnterprisePortReadModel,
  assetId: string,
  collaborationSpaces?: CollaborationSpacesListResult | null,
): string {
  const normalizedAssetId = assetId.trim();
  if (!normalizedAssetId) {
    return assetId;
  }

  const managedSpace = findCollaborationSpaceByAssetId(
    collaborationSpaces?.spaces ?? [],
    normalizedAssetId,
  );
  const managedTitle = managedSpace?.title?.trim();
  if (managedTitle && !isGeneratedCollaborationTitle(managedTitle, normalizedAssetId)) {
    return managedTitle;
  }

  const meshGroup =
    readModel.meshGroups.find((group) => group.groupId === normalizedAssetId) ??
    readModel.meshGroups.find(
      (group) =>
        normalizeCollaborationAssetKey(group.groupId) ===
        normalizeCollaborationAssetKey(normalizedAssetId),
    ) ??
    null;
  if (meshGroup?.name) {
    const name = meshGroup.name.trim();
    if (name && name !== meshGroup.groupId && name !== normalizedAssetId) {
      return name;
    }
    if (name && !isGeneratedCollaborationTitle(name, normalizedAssetId)) {
      return name;
    }
  }

  return formatUnresolvedCollaborationName(managedTitle || normalizedAssetId);
}

function isGeneratedCollaborationTitle(title: string, assetId: string): boolean {
  const normalizedTitle = title.trim();
  const normalizedAssetId = assetId.trim();
  if (!normalizedTitle || normalizedTitle === normalizedAssetId) {
    return true;
  }
  if (/^space[:/]/i.test(normalizedTitle)) {
    return true;
  }
  if (/^grp[-:]/i.test(normalizedTitle)) {
    return true;
  }
  return normalizedTitle.toLowerCase() === `group:${normalizedAssetId}`.toLowerCase();
}

export function isTransferableHandoverPolicy(policy: HandoverAccessPolicyRow): boolean {
  return policy.resourceType !== "seat" && policy.resourceType !== "connector";
}

export function filterTransferableHandoverPolicyIds(
  policyIds: string[],
  policies: HandoverAccessPolicyRow[],
): string[] {
  const transferable = new Set(
    policies.filter(isTransferableHandoverPolicy).map((policy) => policy.policyId),
  );
  return policyIds.filter((policyId) => transferable.has(policyId));
}

export function isRedundantHandoverAccessPolicy(params: {
  policy: HandoverAccessPolicyRow;
  agentIds: Set<string>;
  collaborationIds: Set<string>;
  seatMemoryScopeId: string | null;
}): boolean {
  const { policy, agentIds, collaborationIds, seatMemoryScopeId } = params;
  if (policy.resourceType === "agent" && agentIds.has(policy.resourceId)) {
    return true;
  }
  if (policy.resourceType === "space" && collaborationIds.has(policy.resourceId)) {
    return true;
  }
  if (
    policy.resourceType === "memory" &&
    seatMemoryScopeId &&
    policy.resourceId === seatMemoryScopeId
  ) {
    return true;
  }
  return false;
}

export function resolveHandoverAccessPolicyLabel(params: {
  policy: HandoverAccessPolicyRow;
  seatTitle: string;
  readModel: EnterprisePortReadModel;
  collaborationSpaces?: CollaborationSpacesListResult | null;
}): string {
  const { policy, seatTitle, readModel, collaborationSpaces } = params;
  switch (policy.resourceType) {
    case "seat":
      return `岗位访问 · ${seatTitle}`;
    case "connector":
      return `连接器 · ${policy.resourceId}`;
    case "capability":
      return `能力权限 · ${policy.resourceId}`;
    case "memory":
      return `记忆权限 · ${policy.resourceId}`;
    case "agent": {
      const agent = readModel.meshAgents.find((entry) => entry.agentId === policy.resourceId);
      return `机器人权限 · ${agent?.name ?? policy.resourceId}`;
    }
    case "space":
      return `协作权限 · ${resolveCollaborationGroupDisplayName(
        readModel,
        policy.resourceId,
        collaborationSpaces,
      )}`;
    default:
      return `${policy.resourceType} · ${policy.resourceId}`;
  }
}
