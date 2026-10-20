import fs from "node:fs";
import path from "node:path";
// Gateway handlers for mesh.governance.* methods.
//
// 机巢治理 RPC 端点：
// - mesh.governance.listQueue: 列出当前治理队列状态（read scope）
// - mesh.governance.executeAction: 执行治理动作（admin scope）
// - mesh.governance.getConfig: 获取治理阈值配置（read scope）
// - mesh.governance.updateConfig: 更新治理阈值配置（admin scope）
// - mesh.ownership.transfer: 手动转移归属（admin scope）
import { loadConfig } from "../../config/config.js";
import { CONFIG_DIR } from "../../utils.js";
import { listGatewayCollaborationSpaces } from "../collaboration-learning.js";
import {
  findActiveOwnershipRecord,
  getOwnershipRecord,
  listOwnershipRecords,
  revokeOwnershipRecord,
  upsertOwnershipRecord,
  transferOwnershipRecord,
} from "../ownership-store.js";
import { loadSeatAssetsStoreForTenantId } from "../platform-auth/seat-store-loader.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { stringValue } from "../records.js";
import { listAgentsForGateway } from "../session-utils.js";
import { requireTenantContext } from "../tenant-context.js";
import type { GatewayRequestHandlers } from "./types.js";

function trimString(value: unknown): string | null {
  return stringValue(value);
}

type SeatOwnershipTarget = {
  seatId: string;
  positionLabel: string;
  managerUserId: string;
  managerLabel: string;
};

function resolveUserDisplayLabel(
  platformStore: { users?: Record<string, { displayName?: string }> } | null,
  userId: string,
): string {
  return platformStore?.users?.[userId]?.displayName?.trim() || userId;
}

function isBackfillOwnershipNotes(notes: string | undefined): boolean {
  return (notes ?? "").includes("mesh.ownership.list backfill");
}

/**
 * Map each agent/space to its owning seat across the whole tenant.
 * Previous logic only used a single "primary" seat (usually CEO), which made
 * every mesh row show CEO as owner/position.
 */
function collectSeatOwnershipTargets(params: {
  tenantId: string;
  seats: Array<{
    seatId: string;
    tenantId: string;
    title?: string | null;
    currentEmployeeId?: string | null;
    defaultAgentAssetIds?: string[] | null;
    defaultSpaceIds?: string[] | null;
  }>;
  assetBindings: Record<
    string,
    {
      tenantId: string;
      seatId: string;
      assetType: string;
      assetId: string;
      status: string;
    }
  >;
  platformStore: { users?: Record<string, { displayName?: string }> } | null;
}): {
  agents: Map<string, SeatOwnershipTarget>;
  groups: Map<string, SeatOwnershipTarget>;
} {
  const agents = new Map<string, SeatOwnershipTarget>();
  const groups = new Map<string, SeatOwnershipTarget>();
  const seatById = new Map(
    params.seats
      .filter((seat) => seat.tenantId === params.tenantId && seat.seatId && seat.currentEmployeeId)
      .map((seat) => [seat.seatId, seat] as const),
  );

  const remember = (
    map: Map<string, SeatOwnershipTarget>,
    subjectId: string,
    seat: (typeof params.seats)[number],
  ) => {
    const trimmed = subjectId.trim();
    if (!trimmed || map.has(trimmed) || !seat.currentEmployeeId) {
      return;
    }
    const managerUserId = seat.currentEmployeeId.trim();
    if (!managerUserId) {
      return;
    }
    map.set(trimmed, {
      seatId: seat.seatId,
      positionLabel: seat.title?.trim() || seat.seatId,
      managerUserId,
      managerLabel: resolveUserDisplayLabel(params.platformStore, managerUserId),
    });
  };

  for (const seat of seatById.values()) {
    for (const agentId of seat.defaultAgentAssetIds ?? []) {
      remember(agents, agentId, seat);
    }
    for (const spaceId of seat.defaultSpaceIds ?? []) {
      remember(groups, spaceId, seat);
    }
  }

  for (const binding of Object.values(params.assetBindings ?? {})) {
    if (binding.tenantId !== params.tenantId || binding.status !== "active") {
      continue;
    }
    const seat = seatById.get(binding.seatId);
    if (!seat) {
      continue;
    }
    const assetId = binding.assetId?.trim();
    if (!assetId) {
      continue;
    }
    if (binding.assetType === "agent") {
      remember(agents, assetId, seat);
    } else if (binding.assetType === "space" || binding.assetType === "group") {
      remember(groups, assetId, seat);
    }
  }

  return { agents, groups };
}

function ensureSeatOwnershipRecord(params: {
  tenantId: string;
  subjectKind: "agent" | "group";
  subjectId: string;
  target: SeatOwnershipTarget;
  ownerLabel: string;
}): void {
  const existing = getOwnershipRecord({
    tenantId: params.tenantId,
    subjectKind: params.subjectKind,
    subjectId: params.subjectId,
  });
  // Preserve explicit revoke / transfer history.
  if (existing?.bindingStatus === "revoked" || existing?.bindingStatus === "transferred") {
    return;
  }
  const active = findActiveOwnershipRecord({
    tenantId: params.tenantId,
    subjectKind: params.subjectKind,
    subjectId: params.subjectId,
  });
  if (active) {
    const mismatched =
      active.positionId !== params.target.seatId ||
      active.currentManagerUserId !== params.target.managerUserId;
    if (!mismatched) {
      return;
    }
    // Heal prior primary-seat-only backfill mistakes; leave manual assignments alone.
    if (!isBackfillOwnershipNotes(active.notes)) {
      return;
    }
  }

  upsertOwnershipRecord({
    tenantId: params.tenantId,
    subjectKind: params.subjectKind,
    subjectId: params.subjectId,
    positionId: params.target.seatId,
    positionLabel: params.target.positionLabel,
    createdByUserId: params.target.managerUserId,
    createdByUserLabel: params.ownerLabel,
    currentManagerUserId: params.target.managerUserId,
    currentManagerLabel: params.ownerLabel,
    notes: "mesh.ownership.list backfill",
  });
}

async function backfillMeshOwnershipRecords(tenantId: string) {
  const seatStore = await loadSeatAssetsStoreForTenantId(tenantId);
  const cfg = loadConfig();
  const platformStorePath = path.join(
    process.env.HOME ?? "",
    ".openbot",
    "openbot-platform-auth.json",
  );
  const platformStore = fs.existsSync(platformStorePath)
    ? (JSON.parse(fs.readFileSync(platformStorePath, "utf8")) as {
        users?: Record<string, { displayName?: string }>;
      })
    : null;
  const agents = listAgentsForGateway(cfg).agents;
  const spaces = (await listGatewayCollaborationSpaces()).spaces ?? [];
  const seats = Object.values(seatStore.seats ?? {}).filter((seat) => seat.tenantId === tenantId);
  const { agents: agentTargets, groups: groupTargets } = collectSeatOwnershipTargets({
    tenantId,
    seats,
    assetBindings: seatStore.assetBindings ?? {},
    platformStore,
  });

  if (agentTargets.size === 0 && groupTargets.size === 0) {
    return listOwnershipRecords().filter(
      (record) => record.tenantId === tenantId && record.bindingStatus !== "revoked",
    );
  }

  for (const [agentId, target] of agentTargets) {
    const agent = agents.find((entry) => entry.id === agentId) ?? null;
    const ownerLabel = agent?.ownerName?.trim() || target.managerLabel;
    ensureSeatOwnershipRecord({
      tenantId,
      subjectKind: "agent",
      subjectId: agentId,
      target,
      ownerLabel,
    });
  }

  for (const [spaceId, target] of groupTargets) {
    const space = spaces.find((entry) => entry.groupId === spaceId) ?? null;
    const ownerLabel =
      space?.members?.humans?.find((member) => member.status !== "removed")?.name?.trim() ||
      target.managerLabel;
    ensureSeatOwnershipRecord({
      tenantId,
      subjectKind: "group",
      subjectId: spaceId,
      target,
      ownerLabel,
    });
  }

  const pruneActor =
    [...agentTargets.values(), ...groupTargets.values()][0] ??
    ({
      managerUserId: "system",
      managerLabel: "system",
    } as const);

  for (const record of listOwnershipRecords()) {
    if (
      record.tenantId !== tenantId ||
      record.subjectKind !== "agent" ||
      record.bindingStatus !== "active"
    ) {
      continue;
    }
    if (agentTargets.has(record.subjectId)) {
      continue;
    }
    // Only prune auto-backfill rows. Manual / member-owned assignments must survive
    // when seat bindings are incomplete — otherwise mesh.ownership.list wiped every
    // non-CEO ownership on each refresh and the UI fell back to the admin's seat.
    if (!isBackfillOwnershipNotes(record.notes)) {
      continue;
    }
    revokeOwnershipRecord({
      tenantId,
      subjectKind: "agent",
      subjectId: record.subjectId,
      revokedByUserId: pruneActor.managerUserId,
      revokedByUserLabel: pruneActor.managerLabel,
      notes: "mesh.ownership.list prune orphan",
    });
  }

  return listOwnershipRecords().filter(
    (record) => record.tenantId === tenantId && record.bindingStatus !== "revoked",
  );
}

// ─── Config store (persisted) ─────────────────────────────────────────────────
// Phase 4: ~/.openbot/organization/governance-config.json

type GovernanceConfig = {
  consecutiveErrorThreshold: number;
  offlineAlertHours: number;
  zombieDays: number;
  errorRateThreshold: number;
  costSpikeMultiplier: number;
  qualityDropPoints: number;
  groupZombieDays: number;
};

const DEFAULT_CONFIG: GovernanceConfig = {
  consecutiveErrorThreshold: 5,
  offlineAlertHours: 24,
  zombieDays: 30,
  errorRateThreshold: 0.3,
  costSpikeMultiplier: 3,
  qualityDropPoints: 20,
  groupZombieDays: 30,
};

const GOVERNANCE_CONFIG_DIR = path.join(CONFIG_DIR, "organization");
const GOVERNANCE_CONFIG_FILE = path.join(GOVERNANCE_CONFIG_DIR, "governance-config.json");

function loadPersistedGovernanceConfig(): GovernanceConfig {
  try {
    if (!fs.existsSync(GOVERNANCE_CONFIG_FILE)) {
      return { ...DEFAULT_CONFIG };
    }
    const raw = JSON.parse(
      fs.readFileSync(GOVERNANCE_CONFIG_FILE, "utf8"),
    ) as Partial<GovernanceConfig>;
    return { ...DEFAULT_CONFIG, ...raw };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function persistGovernanceConfig(config: GovernanceConfig): void {
  if (!fs.existsSync(GOVERNANCE_CONFIG_DIR)) {
    fs.mkdirSync(GOVERNANCE_CONFIG_DIR, { recursive: true });
  }
  fs.writeFileSync(GOVERNANCE_CONFIG_FILE, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

type AuditEntry = {
  issueId: string;
  actionType: string;
  targetId: string;
  targetKind: "agent" | "group";
  operatorUserId: string;
  operatorPositionId: string;
  executedAt: string;
  reason?: string;
};

let currentConfig: GovernanceConfig = loadPersistedGovernanceConfig();
const auditLog: AuditEntry[] = [];
const ignoredIssues = new Set<string>();

// ─── Validation helpers ───────────────────────────────────────────────────────

function validateConfig(partial: Partial<GovernanceConfig>): GovernanceConfig {
  const merged: GovernanceConfig = { ...currentConfig, ...partial };

  if (merged.consecutiveErrorThreshold < 1 || merged.consecutiveErrorThreshold > 100) {
    throw new Error("consecutiveErrorThreshold out of range [1, 100]");
  }
  if (merged.offlineAlertHours < 1 || merged.offlineAlertHours > 168) {
    throw new Error("offlineAlertHours out of range [1, 168]");
  }
  if (merged.zombieDays < 7 || merged.zombieDays > 365) {
    throw new Error("zombieDays out of range [7, 365]");
  }
  if (merged.errorRateThreshold < 0.05 || merged.errorRateThreshold > 1) {
    throw new Error("errorRateThreshold out of range [0.05, 1]");
  }
  if (merged.costSpikeMultiplier < 1.5 || merged.costSpikeMultiplier > 10) {
    throw new Error("costSpikeMultiplier out of range [1.5, 10]");
  }
  if (merged.qualityDropPoints < 5 || merged.qualityDropPoints > 50) {
    throw new Error("qualityDropPoints out of range [5, 50]");
  }
  if (merged.groupZombieDays < 7 || merged.groupZombieDays > 365) {
    throw new Error("groupZombieDays out of range [7, 365]");
  }

  return merged;
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

export const meshGovernanceHandlers: GatewayRequestHandlers = {
  "mesh.ownership.list": async ({ params, client, respond }) => {
    // Tenant must come from membership. Never default to a hardcoded tenant id
    // (docs/design/isolation-layers-hard-rules-2026-08-06.md).
    let tenantId: string | null = null;
    try {
      const context = await requireTenantContext(client ?? null);
      tenantId = context.tenantId;
    } catch {
      tenantId =
        trimString((params as { tenantId?: unknown } | null)?.tenantId) ??
        trimString(client?.sessionTenantId);
    }
    if (!tenantId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "mesh.ownership.list requires a resolved tenantId"),
      );
      return;
    }
    const records = await backfillMeshOwnershipRecords(tenantId);
    // Tenant agent roster for mesh UI — independent of personal-scoped agents.list.
    let agents: Array<{
      id: string;
      name?: string | null;
      identity?: { name?: string | null } | null;
      ownerId?: string | null;
      ownerName?: string | null;
    }> = [];
    try {
      const { listTenantMeshGrowthAgents } =
        await import("../agent-growth/mesh-growth-tenant-scope.js");
      const cfg = loadConfig();
      const tenantAgents = await listTenantMeshGrowthAgents({ tenantId, cfg });
      const gatewayById = new Map(
        listAgentsForGateway(cfg).agents.map((agent) => [agent.id.trim().toLowerCase(), agent]),
      );
      agents = tenantAgents.map((entry) => {
        const gateway = gatewayById.get(entry.agentId.trim().toLowerCase());
        return {
          id: gateway?.id ?? entry.agentId,
          name: gateway?.identity?.name?.trim() || gateway?.name?.trim() || entry.name,
          ...(gateway?.identity ? { identity: gateway.identity } : {}),
          ...(gateway?.ownerId ? { ownerId: gateway.ownerId } : {}),
          ...(gateway?.ownerName ? { ownerName: gateway.ownerName } : {}),
        };
      });
    } catch {
      agents = [];
    }
    respond(true, { records, agents }, undefined);
  },
  /**
   * mesh.governance.listQueue
   *
   * 返回服务端持有的治理队列状态：
   * - ignoredIssues: 被管理员忽略的治理项 ID 集合
   * - auditLogCount: 已执行治理动作总数
   *
   * 实际的治理项检测发生在 UI 层（governance-engine.ts），因为它依赖完整的 mesh 状态数据。
   * 客户端调用流程：
   * 1. 从 enterprise read model 获取 agents/groups 数据
   * 2. 调用 detectGovernanceIssues 计算治理项
   * 3. 调用 mesh.governance.listQueue 获取被忽略的项
   * 4. 过滤掉已忽略项后展示
   */
  "mesh.governance.listQueue": ({ respond }) => {
    respond(
      true,
      {
        ignoredIssues: Array.from(ignoredIssues),
        auditLogCount: auditLog.length,
      },
      undefined,
    );
  },

  /**
   * mesh.governance.executeAction
   *
   * 执行治理动作，写入审计日志。
   * 实际的目标对象状态变更由 UI 层调用对应的 agent/group RPC 完成。
   * 此端点仅记录"治理动作已被执行"事实。
   */
  "mesh.governance.executeAction": ({ params, respond }) => {
    const p = params as {
      issueId?: string;
      actionType?: string;
      targetId?: string;
      targetKind?: "agent" | "group";
      operatorUserId?: string;
      operatorPositionId?: string;
      reason?: string;
    };

    if (
      !p?.issueId ||
      !p?.actionType ||
      !p?.targetId ||
      !p?.targetKind ||
      !p?.operatorUserId ||
      !p?.operatorPositionId
    ) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          "executeAction requires issueId, actionType, targetId, targetKind, operatorUserId, operatorPositionId",
        ),
      );
      return;
    }

    const entry: AuditEntry = {
      issueId: p.issueId,
      actionType: p.actionType,
      targetId: p.targetId,
      targetKind: p.targetKind,
      operatorUserId: p.operatorUserId,
      operatorPositionId: p.operatorPositionId,
      executedAt: new Date().toISOString(),
      reason: p.reason,
    };
    auditLog.push(entry);

    if (p.actionType === "ignore" || p.actionType === "mark_known") {
      ignoredIssues.add(p.issueId);
    }

    respond(
      true,
      {
        ok: true,
        removedIssueId: p.issueId,
        auditEntry: entry,
      },
      undefined,
    );
  },

  /**
   * mesh.governance.getConfig
   */
  "mesh.governance.getConfig": ({ respond }) => {
    respond(true, { config: currentConfig }, undefined);
  },

  /**
   * mesh.governance.updateConfig
   */
  "mesh.governance.updateConfig": ({ params, respond }) => {
    const p = (params ?? {}) as Partial<GovernanceConfig>;

    try {
      currentConfig = validateConfig(p);
      persistGovernanceConfig(currentConfig);
      respond(true, { config: currentConfig }, undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          error instanceof Error ? error.message : "Invalid config",
        ),
      );
    }
  },

  /**
   * mesh.ownership.transfer
   *
   * 手动转移归属。通常由组织架构系统在岗位人员变动时自动调用，
   * 此端点用于管理员手动干预。
   */
  "mesh.ownership.transfer": ({ params, respond }) => {
    const p = params as {
      tenantId?: string;
      positionId?: string;
      previousUserId?: string;
      newUserId?: string;
      newUserLabel?: string;
      subjectKind?: "agent" | "group";
      subjectId?: string;
    };

    if (!p?.positionId || !p?.previousUserId || !p?.newUserId) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          "transfer requires positionId, previousUserId, newUserId",
        ),
      );
      return;
    }

    const now = new Date().toISOString();
    if (p.tenantId && p.subjectKind && p.subjectId) {
      const transferred = transferOwnershipRecord({
        tenantId: p.tenantId,
        subjectKind: p.subjectKind,
        subjectId: p.subjectId,
        newPositionId: p.positionId,
        newPositionLabel: p.positionId,
        transferredByUserId: p.previousUserId,
        transferredByUserLabel: p.previousUserId,
        newCurrentManagerUserId: p.newUserId,
        newCurrentManagerLabel: p.newUserLabel ?? p.newUserId,
      });
      if (!transferred) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "ownership record not found"),
        );
        return;
      }
      respond(
        true,
        {
          ok: true,
          transferLog: {
            positionId: p.positionId,
            previousUserId: p.previousUserId,
            newUserId: p.newUserId,
            newUserLabel: p.newUserLabel ?? p.newUserId,
            transferredAt: transferred.transferredAt ?? now,
            subjectKind: p.subjectKind,
            subjectId: p.subjectId,
          },
        },
        undefined,
      );
      return;
    }

    const affected = listOwnershipRecords().filter((record) => record.positionId === p.positionId);
    for (const record of affected) {
      transferOwnershipRecord({
        tenantId: record.tenantId,
        subjectKind: record.subjectKind,
        subjectId: record.subjectId,
        newPositionId: p.positionId,
        newPositionLabel: record.positionLabel,
        transferredByUserId: p.previousUserId,
        transferredByUserLabel: p.previousUserId,
        newCurrentManagerUserId: p.newUserId,
        newCurrentManagerLabel: p.newUserLabel ?? p.newUserId,
      });
    }

    respond(
      true,
      {
        ok: true,
        transferLog: {
          positionId: p.positionId,
          previousUserId: p.previousUserId,
          newUserId: p.newUserId,
          newUserLabel: p.newUserLabel ?? p.newUserId,
          transferredAt: now,
          affectedCount: affected.length,
        },
      },
      undefined,
    );
  },

  "mesh.ownership.revoke": ({ params, respond }) => {
    const p = params as {
      tenantId?: string;
      subjectKind?: "agent" | "group";
      subjectId?: string;
      revokedByUserId?: string;
      revokedByUserLabel?: string;
      reason?: string;
    };

    if (!p?.tenantId || !p?.subjectKind || !p?.subjectId || !p?.revokedByUserId) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          "revoke requires tenantId, subjectKind, subjectId, revokedByUserId",
        ),
      );
      return;
    }

    const revoked = revokeOwnershipRecord({
      tenantId: p.tenantId,
      subjectKind: p.subjectKind,
      subjectId: p.subjectId,
      revokedByUserId: p.revokedByUserId,
      revokedByUserLabel: p.revokedByUserLabel ?? p.revokedByUserId,
      notes: p.reason,
    });
    if (!revoked) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "ownership record not found"),
      );
      return;
    }

    respond(true, { ok: true, record: revoked }, undefined);
  },
};

// ─── Test helpers (exported for unit tests) ──────────────────────────────────

export function _resetMeshGovernanceState(): void {
  currentConfig = { ...DEFAULT_CONFIG };
  try {
    if (fs.existsSync(GOVERNANCE_CONFIG_FILE)) {
      fs.unlinkSync(GOVERNANCE_CONFIG_FILE);
    }
  } catch {
    // best-effort cleanup for unit tests
  }
  auditLog.length = 0;
  ignoredIssues.clear();
}

export function _getAuditLog(): AuditEntry[] {
  return [...auditLog];
}

export function _getIgnoredIssues(): string[] {
  return Array.from(ignoredIssues);
}
