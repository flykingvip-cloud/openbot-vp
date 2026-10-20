/**
 * Ownership Migration — 存量数据迁移
 *
 * 将旧数据模型（ownerId 可选、协作小组无 creator）迁移到新的岗位归属模型。
 */

import type { MeshOwnership } from "./types.ts";

export type PositionLookupEntry = {
  positionId: string;
  positionLabel: string;
  currentUserId: string;
  currentUserLabel: string;
};

export type LegacyAgentData = {
  agentId: string;
  ownerId?: string | null;
  ownerName?: string | null;
};

export type LegacyGroupData = {
  groupId: string;
  /** 小组内最早活跃成员的 userId（用于推断归属） */
  earliestActiveMemberUserId?: string | null;
  earliestActiveMemberLabel?: string | null;
};

/**
 * 迁移单个机器人的归属信息。
 *
 * 规则：
 * - 有 ownerId → 查找对应岗位 → 使用该岗位
 * - 无 ownerId → 使用企业默认管理岗位
 */
export function migrateAgentOwnership(
  agent: LegacyAgentData,
  positionLookup: Map<string, PositionLookupEntry>,
  defaultPositionId: string,
  defaultPositionLabel: string,
): MeshOwnership {
  const ownerId = agent.ownerId?.trim() || null;

  if (ownerId) {
    // 尝试通过 ownerId 找到对应岗位
    const position = findPositionByUserId(ownerId, positionLookup);
    if (position) {
      return {
        positionId: position.positionId,
        positionLabel: position.positionLabel,
        createdByUserId: ownerId,
        createdByUserLabel: agent.ownerName?.trim() || ownerId,
        currentManagerUserId: position.currentUserId,
        currentManagerLabel: position.currentUserLabel,
        createdAt: new Date().toISOString(), // 迁移时间作为 createdAt
      };
    }
    // ownerId 存在但找不到对应岗位 → 使用默认岗位，保留 ownerId 作为创建人
    return {
      positionId: defaultPositionId,
      positionLabel: defaultPositionLabel,
      createdByUserId: ownerId,
      createdByUserLabel: agent.ownerName?.trim() || ownerId,
      currentManagerUserId: ownerId,
      currentManagerLabel: agent.ownerName?.trim() || ownerId,
      createdAt: new Date().toISOString(),
    };
  }

  // 无 ownerId → 默认管理岗位
  const defaultPosition = positionLookup.get(defaultPositionId);
  return {
    positionId: defaultPositionId,
    positionLabel: defaultPositionLabel,
    createdByUserId: defaultPosition?.currentUserId ?? "system",
    createdByUserLabel: defaultPosition?.currentUserLabel ?? "系统迁移",
    currentManagerUserId: defaultPosition?.currentUserId ?? "system",
    currentManagerLabel: defaultPosition?.currentUserLabel ?? "系统迁移",
    createdAt: new Date().toISOString(),
  };
}

/**
 * 迁移单个协作小组的归属信息。
 *
 * 规则：
 * - 有最早活跃成员 → 查找该成员对应岗位 → 使用该岗位
 * - 无法推断 → 使用企业默认管理岗位
 */
export function migrateGroupOwnership(
  group: LegacyGroupData,
  positionLookup: Map<string, PositionLookupEntry>,
  defaultPositionId: string,
  defaultPositionLabel: string,
): MeshOwnership {
  const memberId = group.earliestActiveMemberUserId?.trim() || null;

  if (memberId) {
    const position = findPositionByUserId(memberId, positionLookup);
    if (position) {
      return {
        positionId: position.positionId,
        positionLabel: position.positionLabel,
        createdByUserId: memberId,
        createdByUserLabel: group.earliestActiveMemberLabel?.trim() || memberId,
        currentManagerUserId: position.currentUserId,
        currentManagerLabel: position.currentUserLabel,
        createdAt: new Date().toISOString(),
      };
    }
  }

  // 无法推断 → 默认管理岗位
  const defaultPosition = positionLookup.get(defaultPositionId);
  return {
    positionId: defaultPositionId,
    positionLabel: defaultPositionLabel,
    createdByUserId: defaultPosition?.currentUserId ?? "system",
    createdByUserLabel: defaultPosition?.currentUserLabel ?? "系统迁移",
    currentManagerUserId: defaultPosition?.currentUserId ?? "system",
    currentManagerLabel: defaultPosition?.currentUserLabel ?? "系统迁移",
    createdAt: new Date().toISOString(),
  };
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function findPositionByUserId(
  userId: string,
  positionLookup: Map<string, PositionLookupEntry>,
): PositionLookupEntry | null {
  for (const [, entry] of positionLookup) {
    if (entry.currentUserId === userId) {
      return entry;
    }
  }
  return null;
}
