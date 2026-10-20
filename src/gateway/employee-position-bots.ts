/**
 * Single invite → position → bots projection.
 *
 * `seatId` on an enterprise position seat IS the stable position id. Ownership
 * records store that same value as `positionId`. There is no second identifier.
 * Invite and activation bind `tenantId` + this id. Displayed bots are the
 * agents granted to that position (seat defaults ∪ active agent asset bindings
 * ∪ config rows whose ownerId is the position id), plus the universal steward.
 *
 * User id and email authenticate the person. They do not select bots. The
 * creator is audit-only. Browser memory, org directory, and ownership rows
 * matched by manager user/email are not a second roster.
 *
 * LIVE CEO seat occupancy was not observed in this workspace: UNVERIFIED.
 * Historical rows that name a manager but are absent from the position set are
 * reported by {@link auditAgentOwnershipOutsidePosition} and are not rewritten.
 */
import {
  isBuiltinStewardAgent,
  withEmployeeUniversalStewardAgentIds,
} from "../agents/builtin-steward/identity.js";
import {
  assignSeatToEmployee,
  type EnterprisePositionSeat,
  type EnterpriseSeatAssetsStore,
  type EnterpriseSeatBinding,
} from "./enterprise-seat-assets-store.js";

export type InvitePositionResolution =
  | { ok: true; positionId: string }
  | { ok: false; code: "PLATFORM_AUTH_POSITION_REQUIRED"; error: string };

function normalizeId(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

/**
 * Invite body → stable position id.
 *
 * Accepts `positionId` or the legacy field name `seatId`. They are the same id.
 * Title, email, and display name are never a lookup key.
 */
export function resolveInvitePositionId(body: {
  positionId?: unknown;
  seatId?: unknown;
}): InvitePositionResolution {
  const positionId =
    (typeof body.positionId === "string" ? body.positionId.trim() : "") ||
    (typeof body.seatId === "string" ? body.seatId.trim() : "");
  if (!positionId || positionId.includes("@")) {
    return {
      ok: false,
      code: "PLATFORM_AUTH_POSITION_REQUIRED",
      error: "Invite requires an existing position id.",
    };
  }
  return { ok: true, positionId };
}

export type PositionBotConfigAgent = {
  id: string;
  ownerId?: string | null;
};

/**
 * Bots bound to one position. Empty when the employee has no position —
 * a successful invite without a position is an anomaly, not an empty roster
 * to fill from the user id.
 */
export function resolvePositionBotIds(params: {
  positionId: string | null | undefined;
  grantedAgentIds: readonly string[];
  configAgents?: readonly PositionBotConfigAgent[];
}): string[] {
  const positionId = normalizeId(params.positionId);
  if (!positionId) {
    return [];
  }
  const positionKey = positionId.toLowerCase();
  const ids = new Set<string>();
  for (const agentId of params.grantedAgentIds) {
    const trimmed = normalizeId(agentId);
    if (!trimmed || isBuiltinStewardAgent(trimmed)) {
      continue;
    }
    ids.add(trimmed);
  }
  for (const agent of params.configAgents ?? []) {
    const agentId = normalizeId(agent.id);
    if (!agentId || isBuiltinStewardAgent(agentId)) {
      continue;
    }
    const ownerId = normalizeId(agent.ownerId).toLowerCase();
    if (ownerId && ownerId === positionKey) {
      ids.add(agentId);
    }
  }
  return [...ids].toSorted((left, right) => left.localeCompare(right));
}

/** Position bots plus the universal steward. No seat → steward only. */
export function assembleEmployeePositionAgentIds(params: {
  positionId: string | null | undefined;
  grantedAgentIds: readonly string[];
  configAgents?: readonly PositionBotConfigAgent[];
}): string[] {
  return withEmployeeUniversalStewardAgentIds(resolvePositionBotIds(params));
}

export type AgentOwnershipDriftReason = "missing-position-id" | "not-in-position-bot-set";

export type AgentOwnershipDriftRow = {
  tenantId: string;
  subjectId: string;
  positionId: string;
  currentManagerUserId: string;
  reason: AgentOwnershipDriftReason;
};

type OwnershipAuditRecord = {
  tenantId: string;
  subjectKind: string;
  subjectId: string;
  positionId?: string | null;
  currentManagerUserId: string;
  bindingStatus: string;
};

/**
 * Read-only inventory of agent ownership rows that are not on the position bot
 * set. Callers must not apply this report as a live bulk write.
 */
export function auditAgentOwnershipOutsidePosition(params: {
  records: readonly OwnershipAuditRecord[];
  botsByPositionKey: Readonly<Record<string, readonly string[]>>;
}): AgentOwnershipDriftRow[] {
  const rows: AgentOwnershipDriftRow[] = [];
  for (const record of params.records) {
    if (record.subjectKind !== "agent" || record.bindingStatus === "revoked") {
      continue;
    }
    const tenantId = normalizeId(record.tenantId);
    const subjectId = normalizeId(record.subjectId);
    if (!tenantId || !subjectId) {
      continue;
    }
    const positionId = normalizeId(record.positionId);
    if (!positionId) {
      rows.push({
        tenantId,
        subjectId,
        positionId: "",
        currentManagerUserId: record.currentManagerUserId,
        reason: "missing-position-id",
      });
      continue;
    }
    const key = `${tenantId}:${positionId}`;
    const bots = new Set(params.botsByPositionKey[key] ?? []);
    if (!bots.has(subjectId)) {
      rows.push({
        tenantId,
        subjectId,
        positionId,
        currentManagerUserId: record.currentManagerUserId,
        reason: "not-in-position-bot-set",
      });
    }
  }
  return rows;
}

/**
 * Activate-time bind. Repeating it for the same employee and position keeps
 * the existing active binding instead of stacking a transfer.
 */
export function bindInvitedEmployeeToPosition(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  seatId: string;
  employeeId: string;
  nowIso: string;
  actorEmployeeId?: string;
  auditId?: string;
}): { seat: EnterprisePositionSeat; binding: EnterpriseSeatBinding; idempotent: boolean } {
  const seatId = normalizeId(params.seatId);
  if (!seatId) {
    throw new Error("Position id is required.");
  }
  const seat = params.store.seats[seatId];
  if (!seat || seat.tenantId !== params.tenantId) {
    throw new Error("Seat not found.");
  }
  const existing =
    Object.values(params.store.bindings).find(
      (binding) =>
        binding.tenantId === params.tenantId &&
        binding.seatId === seatId &&
        binding.employeeId === params.employeeId &&
        binding.bindingStatus === "active",
    ) ?? null;
  if (existing && seat.currentEmployeeId === params.employeeId && seat.status === "occupied") {
    return { seat, binding: existing, idempotent: true };
  }
  const assigned = assignSeatToEmployee({
    store: params.store,
    tenantId: params.tenantId,
    seatId,
    employeeId: params.employeeId,
    nowIso: params.nowIso,
    actorEmployeeId: params.actorEmployeeId,
    auditId: params.auditId,
  });
  return { ...assigned, idempotent: false };
}
