/**
 * 用量归属上下文：从 agentId / userId 解析 orgSeatId，供 usage-ingest 与 recordCreditUsage 自动打标。
 */

import type { EnterpriseSeatAssetsStore } from "../enterprise-seat-assets-store.js";
import { loadEnterpriseSeatAssetsStore } from "../enterprise-seat-assets-store.js";
import { canonicalizeTenantId } from "../tenant-canonicalization.js";

function tenantId(enterpriseId: string): string {
  return canonicalizeTenantId(enterpriseId) ?? enterpriseId;
}

/** 在已加载的 seat store 中按 runtime agentId 查找岗位 seatId。 */
export function resolveOrgSeatIdForAgentInStore(
  seatStore: EnterpriseSeatAssetsStore,
  enterpriseId: string,
  agentId: string,
): string | null {
  const t = tenantId(enterpriseId);
  const normalizedAgentId = agentId.trim();
  if (!normalizedAgentId) {
    return null;
  }
  const seat = Object.values(seatStore.seats).find(
    (entry) => entry.tenantId === t && entry.defaultAgentAssetIds.includes(normalizedAgentId),
  );
  return seat?.seatId ?? null;
}

/** 在已加载的 seat store 中按成员 userId 查找当前活跃岗位 seatId。 */
export function resolveOrgSeatIdForMemberInStore(
  seatStore: EnterpriseSeatAssetsStore,
  enterpriseId: string,
  userId: string,
): string | null {
  const t = tenantId(enterpriseId);
  const normalized = userId.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  for (const seat of Object.values(seatStore.seats)) {
    if (seat.tenantId !== t) {
      continue;
    }
    if (seat.currentEmployeeId?.trim().toLowerCase() === normalized) {
      return seat.seatId;
    }
  }
  const binding = Object.values(seatStore.bindings).find(
    (entry) =>
      entry.tenantId === t &&
      entry.bindingStatus === "active" &&
      entry.employeeId.trim().toLowerCase() === normalized,
  );
  return binding ? (seatStore.seats[binding.seatId]?.seatId ?? null) : null;
}

export type ResolveUsageAttributionInput = {
  enterpriseId: string;
  agentId?: string | null;
  orgSeatId?: string | null;
  userId?: string | null;
  /** 测试注入 seat store 路径 */
  seatAssetsPath?: string;
};

export type ResolvedUsageAttributionTags = {
  agentId?: string;
  orgSeatId?: string;
};

/**
 * 补齐用量记录的 agentId / orgSeatId：
 * - 仅有 agentId → 查 defaultAgentAssetIds 映射 orgSeatId
 * - 仅有 userId → 查当前岗位绑定 orgSeatId
 */
export async function resolveUsageAttributionTags(
  input: ResolveUsageAttributionInput,
): Promise<ResolvedUsageAttributionTags> {
  const agentId = input.agentId?.trim() || undefined;
  let orgSeatId = input.orgSeatId?.trim() || undefined;

  const needsSeatLookup =
    Boolean(agentId && !orgSeatId) || Boolean(!orgSeatId && input.userId?.trim());
  if (!needsSeatLookup) {
    return {
      ...(agentId ? { agentId } : {}),
      ...(orgSeatId ? { orgSeatId } : {}),
    };
  }

  const seatStore = await loadEnterpriseSeatAssetsStore(input.seatAssetsPath);
  if (!orgSeatId && agentId) {
    orgSeatId =
      resolveOrgSeatIdForAgentInStore(seatStore, input.enterpriseId, agentId) ?? undefined;
  }
  if (!orgSeatId && input.userId?.trim()) {
    orgSeatId =
      resolveOrgSeatIdForMemberInStore(seatStore, input.enterpriseId, input.userId) ?? undefined;
  }

  return {
    ...(agentId ? { agentId } : {}),
    ...(orgSeatId ? { orgSeatId } : {}),
  };
}
