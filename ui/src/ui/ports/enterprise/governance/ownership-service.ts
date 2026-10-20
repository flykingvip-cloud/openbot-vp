/**
 * Ownership Service — 岗位归属管理
 *
 * 职责：
 * 1. 创建机器人/协作小组时自动绑定岗位归属
 * 2. 岗位人员变动时自动继承管理权
 * 3. 批量导入时使用默认管理岗位
 */

import type { MeshOwnership, OwnershipTransferLog } from "./types.ts";

// ─── 创建时自动绑定 ────────────────────────────────────────────────────────────

export type CreateOwnershipParams = {
  operatorUserId: string;
  operatorUserLabel: string;
  operatorPositionId: string;
  operatorPositionLabel: string;
};

/**
 * 创建机器人/协作小组时，自动生成岗位归属信息。
 * 保证 positionId 始终非空。
 */
export function resolveOwnershipOnCreate(params: CreateOwnershipParams): MeshOwnership {
  if (!params.operatorPositionId.trim()) {
    throw new Error("resolveOwnershipOnCreate: operatorPositionId must not be empty");
  }
  const now = new Date().toISOString();
  return {
    positionId: params.operatorPositionId.trim(),
    positionLabel: params.operatorPositionLabel.trim() || params.operatorPositionId.trim(),
    createdByUserId: params.operatorUserId.trim(),
    createdByUserLabel: params.operatorUserLabel.trim() || params.operatorUserId.trim(),
    currentManagerUserId: params.operatorUserId.trim(),
    currentManagerLabel: params.operatorUserLabel.trim() || params.operatorUserId.trim(),
    createdAt: now,
  };
}

// ─── 批量导入 ──────────────────────────────────────────────────────────────────

export type ImportOwnershipParams = {
  /** 导入数据中指定的岗位 ID（可能为空） */
  positionId?: string | null;
  positionLabel?: string | null;
  /** 导入操作人 */
  importerUserId: string;
  importerUserLabel: string;
  /** 企业默认管理岗位（兜底） */
  fallbackPositionId: string;
  fallbackPositionLabel: string;
};

/**
 * 批量导入机器人时，解析岗位归属。
 * 如果导入数据中无法确定岗位，使用企业默认管理岗位。
 */
export function resolveOwnershipOnImport(params: ImportOwnershipParams): MeshOwnership {
  const positionId = params.positionId?.trim() || params.fallbackPositionId.trim();
  const positionLabel =
    params.positionLabel?.trim() ||
    (params.positionId?.trim() ? params.positionId.trim() : params.fallbackPositionLabel.trim());
  const now = new Date().toISOString();
  return {
    positionId,
    positionLabel,
    createdByUserId: params.importerUserId.trim(),
    createdByUserLabel: params.importerUserLabel.trim() || params.importerUserId.trim(),
    currentManagerUserId: params.importerUserId.trim(),
    currentManagerLabel: params.importerUserLabel.trim() || params.importerUserId.trim(),
    createdAt: now,
  };
}

// ─── 岗位人员变动时管理权继承 ──────────────────────────────────────────────────

export type TransferOwnershipParams = {
  positionId: string;
  previousUserId: string;
  newUserId: string;
  newUserLabel: string;
};

export type OwnedAsset = {
  id: string;
  kind: "agent" | "group";
  ownership: MeshOwnership;
};

export type TransferResult = {
  updatedAssets: OwnedAsset[];
  transferLog: OwnershipTransferLog;
};

/**
 * 岗位人员变动时，将该岗位下所有机器人和协作小组的管理权转移给新任职人员。
 * - 保留 createdByUserId 不变（历史记录）
 * - 仅更新 currentManagerUserId 和 currentManagerLabel
 */
export function transferOwnershipOnPositionChange(
  params: TransferOwnershipParams,
  assets: OwnedAsset[],
): TransferResult {
  const { positionId, newUserId, newUserLabel } = params;
  const targetAssets = assets.filter((asset) => asset.ownership.positionId === positionId);

  const updatedAssets: OwnedAsset[] = targetAssets.map((asset) => ({
    ...asset,
    ownership: {
      ...asset.ownership,
      currentManagerUserId: newUserId.trim(),
      currentManagerLabel: newUserLabel.trim() || newUserId.trim(),
    },
  }));

  const agentCount = updatedAssets.filter((a) => a.kind === "agent").length;
  const groupCount = updatedAssets.filter((a) => a.kind === "group").length;

  const transferLog: OwnershipTransferLog = {
    positionId,
    previousUserId: params.previousUserId.trim(),
    newUserId: newUserId.trim(),
    newUserLabel: newUserLabel.trim() || newUserId.trim(),
    transferredAt: new Date().toISOString(),
    affectedAgentCount: agentCount,
    affectedGroupCount: groupCount,
  };

  return { updatedAssets, transferLog };
}
