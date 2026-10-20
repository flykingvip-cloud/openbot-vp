/**
 * CollabDispatch RPCs (Sprint D3/D4) — deploy / notice / summon + broadcast governance.
 * Shared pipeline; chat confirm primary via steward tickets.
 * D4: audience.mode space|tenant with authz + blast-radius confirm copy.
 */

import {
  authorizeCollabDispatchBroadcast,
  type CollabDispatchBroadcastAuthzContext,
  type CollabDispatchMembershipRole,
  type CollabDispatchSpaceGovernanceRole,
} from "../../organization/collab-dispatch-broadcast-authz.js";
import { cancelCollabDispatch } from "../../organization/collab-dispatch-cancel.js";
import {
  consumeCollabDispatchApprovalConfirmation,
  issueCollabDispatchApprovalConfirmation,
  collabDispatchApprovalConfirmationDetail,
} from "../../organization/collab-dispatch-confirmation.js";
import {
  applyCollabDispatchRecipientDecision,
  approveCollabDispatchRelease,
  retryCollabDispatchDelivery,
  submitCollabDispatch,
} from "../../organization/collab-dispatch-lifecycle.js";
import {
  type CollabDispatchAudienceMode,
  createCollabDispatch,
  isCollabDispatchKind,
  readOrganizerCollabDispatches,
  CollabDispatchTransitionError,
  upsertCollabDispatch,
} from "../../organization/collab-dispatch-store.js";
import type { SeatRole } from "../../shared/seat-role.js";
import { listEmployeeSessionVisibilitySpaces } from "../employee-session-visibility-policy.js";
import {
  resolveActorGovernanceRoleInSpace,
  resolveEmployeeWorkbenchActor,
  type EmployeeWorkbenchActor,
} from "../employee-workbench-scope.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { looseRecordOrEmpty as asRecord } from "../records.js";
import { broadcastWorkbenchSignalsInvalidate } from "../workbench/signals-invalidate.js";
import type { GatewayClient, GatewayRequestHandlers } from "./types.js";

function parseRecipients(
  raw: unknown,
): Array<{ id: string; kind?: "human" | "agent"; role?: "required" | "optional" }> {
  if (!Array.isArray(raw)) {
    return [];
  }
  const result: Array<{ id: string; kind?: "human" | "agent"; role?: "required" | "optional" }> =
    [];
  for (const entry of raw) {
    if (typeof entry === "string") {
      const id = entry.trim();
      if (id) {
        result.push({ id });
      }
      continue;
    }
    const record = asRecord(entry);
    const id = (
      typeof record.id === "string"
        ? record.id
        : typeof record.userId === "string"
          ? record.userId
          : ""
    ).trim();
    if (!id) {
      continue;
    }
    const kind = record.kind === "agent" || record.kind === "human" ? record.kind : undefined;
    const role =
      record.role === "optional" ? "optional" : record.role === "required" ? "required" : undefined;
    result.push({
      id,
      ...(kind ? { kind } : {}),
      ...(role ? { role } : {}),
    });
  }
  return result;
}

function parseTimeWindow(
  record: Record<string, unknown>,
):
  | { ok: true; timeWindow?: { startAtMs: number; endAtMs?: number; timezone: string } }
  | { ok: false; message: string } {
  const raw = record.timeWindow;
  if (raw === undefined || raw === null) {
    // Also accept flat startAtMs for convenience.
    if (record.startAtMs === undefined || record.startAtMs === null) {
      return { ok: true };
    }
    const startAtMs = typeof record.startAtMs === "number" ? record.startAtMs : Number.NaN;
    if (!Number.isFinite(startAtMs) || startAtMs <= 0) {
      return { ok: false, message: "startAtMs must be a positive epoch-ms timestamp" };
    }
    const timezone =
      typeof record.timezone === "string" && record.timezone.trim()
        ? record.timezone.trim()
        : "UTC";
    if (record.endAtMs !== undefined && record.endAtMs !== null) {
      if (
        typeof record.endAtMs !== "number" ||
        !Number.isFinite(record.endAtMs) ||
        record.endAtMs < startAtMs
      ) {
        return { ok: false, message: "endAtMs must be a number >= startAtMs" };
      }
      return { ok: true, timeWindow: { startAtMs, endAtMs: record.endAtMs, timezone } };
    }
    return { ok: true, timeWindow: { startAtMs, timezone } };
  }
  if (typeof raw !== "object") {
    return { ok: false, message: "timeWindow must be an object" };
  }
  const tw = asRecord(raw);
  const startAtMs = typeof tw.startAtMs === "number" ? tw.startAtMs : Number.NaN;
  if (!Number.isFinite(startAtMs) || startAtMs <= 0) {
    return { ok: false, message: "timeWindow.startAtMs must be a positive epoch-ms timestamp" };
  }
  const timezone =
    typeof tw.timezone === "string" && tw.timezone.trim() ? tw.timezone.trim() : "UTC";
  if (tw.endAtMs !== undefined && tw.endAtMs !== null) {
    if (typeof tw.endAtMs !== "number" || !Number.isFinite(tw.endAtMs) || tw.endAtMs < startAtMs) {
      return { ok: false, message: "timeWindow.endAtMs must be a number >= startAtMs" };
    }
    return { ok: true, timeWindow: { startAtMs, endAtMs: tw.endAtMs, timezone } };
  }
  return { ok: true, timeWindow: { startAtMs, timezone } };
}

function readId(record: Record<string, unknown>): string {
  return typeof record.id === "string"
    ? record.id.trim()
    : typeof record.dispatchId === "string"
      ? record.dispatchId.trim()
      : "";
}

function parseAudienceMode(raw: unknown): CollabDispatchAudienceMode {
  if (raw === "space" || raw === "tenant" || raw === "roster") {
    return raw;
  }
  return "roster";
}

function parseAudience(record: Record<string, unknown>): {
  mode: CollabDispatchAudienceMode;
  spaceId?: string;
} {
  const nested = asRecord(record.audience);
  const modeRaw =
    typeof nested.mode === "string"
      ? nested.mode
      : typeof record.audienceMode === "string"
        ? record.audienceMode
        : "roster";
  const mode = parseAudienceMode(modeRaw);
  const spaceId = (
    typeof nested.spaceId === "string"
      ? nested.spaceId
      : typeof record.spaceId === "string"
        ? record.spaceId
        : ""
  ).trim();
  return {
    mode,
    ...(spaceId ? { spaceId } : {}),
  };
}

function membershipRoleFromClient(
  client: GatewayClient | null | undefined,
): CollabDispatchMembershipRole | null {
  if (client?.sessionKind === "enterprise-admin") {
    return "enterprise-admin";
  }
  if (client?.sessionKind === "member") {
    return "member";
  }
  return null;
}

function parseSeatRole(value: unknown): SeatRole | null {
  return value === "viewer" || value === "creator" || value === "admin" ? value : null;
}

function parseSpaceGovernanceRole(value: unknown): CollabDispatchSpaceGovernanceRole | null {
  return value === "owner" || value === "admin" || value === "member" || value === "observer"
    ? value
    : null;
}

async function resolveBroadcastAuthz(params: {
  client: GatewayClient | null | undefined;
  actor: EmployeeWorkbenchActor;
  audience: { mode: CollabDispatchAudienceMode; spaceId?: string };
  record: Record<string, unknown>;
}): Promise<CollabDispatchBroadcastAuthzContext> {
  const membershipRole = membershipRoleFromClient(params.client);
  const seatRole =
    parseSeatRole(params.record.seatRole) ?? parseSeatRole(asRecord(params.record.authz).seatRole);
  let spaceGovernanceRole =
    parseSpaceGovernanceRole(params.record.spaceGovernanceRole) ??
    parseSpaceGovernanceRole(asRecord(params.record.authz).spaceGovernanceRole);

  if (!spaceGovernanceRole && params.audience.mode === "space" && params.audience.spaceId) {
    try {
      const listed = await listEmployeeSessionVisibilitySpaces();
      const target = params.audience.spaceId.trim().toLowerCase();
      const space = (listed.spaces ?? []).find((entry) => {
        const id = (entry.groupId ?? entry.id?.replace(/^space:/, "") ?? "").trim().toLowerCase();
        return id === target;
      });
      if (space) {
        const role = resolveActorGovernanceRoleInSpace(space, params.actor);
        spaceGovernanceRole = parseSpaceGovernanceRole(role);
      }
    } catch {
      // best-effort; authz will fail closed without elevated roles
    }
  }

  return {
    ...(membershipRole ? { membershipRole } : {}),
    ...(seatRole ? { seatRole } : {}),
    ...(spaceGovernanceRole ? { spaceGovernanceRole } : {}),
  };
}

export const collabDispatchHandlers: GatewayRequestHandlers = {
  "collab.dispatch.create": async ({ params, respond, client }) => {
    const actor = await resolveEmployeeWorkbenchActor(client);
    if (!actor) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "no workbench actor"));
      return;
    }
    const record = asRecord(params);
    const kindRaw = typeof record.kind === "string" ? record.kind.trim() : "";
    if (!isCollabDispatchKind(kindRaw)) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "kind must be deploy|notice|summon"),
      );
      return;
    }
    const title = typeof record.title === "string" ? record.title.trim() : "";
    if (!title) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "title is required"));
      return;
    }
    const tenantId =
      (typeof record.tenantId === "string" && record.tenantId.trim()) ||
      actor.tenantId?.trim() ||
      "";
    if (!tenantId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "tenantId is required"));
      return;
    }
    const timeWindow = parseTimeWindow(record);
    if (!timeWindow.ok) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, timeWindow.message));
      return;
    }
    const body = typeof record.body === "string" ? record.body : "";
    const audience = parseAudience(record);
    const broadcastAuthz = await resolveBroadcastAuthz({
      client,
      actor,
      audience,
      record,
    });
    const authzGate = authorizeCollabDispatchBroadcast({
      audienceMode: audience.mode,
      spaceId: audience.spaceId,
      authz: broadcastAuthz,
    });
    if (!authzGate.ok) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, authzGate.reason));
      return;
    }
    try {
      const draft = createCollabDispatch({
        organizerUserId: actor.userId,
        tenantId,
        kind: kindRaw,
        title,
        body,
        ...(timeWindow.timeWindow ? { timeWindow: timeWindow.timeWindow } : {}),
        audience,
        recipients: parseRecipients(record.recipients),
      });
      const saved = await upsertCollabDispatch(draft);
      broadcastWorkbenchSignalsInvalidate({
        reason: "collaboration",
        userIds: [actor.userId],
      });
      respond(true, { dispatch: saved });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, message));
    }
  },

  "collab.dispatch.submit": async ({ params, respond, client }) => {
    const actor = await resolveEmployeeWorkbenchActor(client);
    if (!actor) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "no workbench actor"));
      return;
    }
    const id = readId(asRecord(params));
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "id is required"));
      return;
    }
    try {
      const submitted = await submitCollabDispatch({
        organizerUserId: actor.userId,
        dispatchId: id,
      });
      if (!submitted.ok) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "dispatch not found"));
        return;
      }
      const confirmation = issueCollabDispatchApprovalConfirmation(submitted.dispatch);
      respond(true, {
        status: "pending_confirmation",
        dispatch: submitted.dispatch,
        confirmation,
        confirmationDetail: collabDispatchApprovalConfirmationDetail(
          submitted.dispatch,
          confirmation.expiresAtMs,
        ),
      });
    } catch (error) {
      if (error instanceof CollabDispatchTransitionError) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, error.message));
        return;
      }
      throw error;
    }
  },

  "collab.dispatch.approve": async ({ params, respond, client }) => {
    const actor = await resolveEmployeeWorkbenchActor(client);
    if (!actor) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "no workbench actor"));
      return;
    }
    const record = asRecord(params);
    const id = readId(record);
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "id is required"));
      return;
    }
    const rows = await readOrganizerCollabDispatches(actor.userId);
    const found = rows.find((row) => row.id === id);
    if (!found) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "dispatch not found"));
      return;
    }
    if (found.status !== "pending_organizer_confirm") {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `illegal CollabDispatch transition: ${found.status} -> released`,
        ),
      );
      return;
    }
    const proposalId = typeof record.proposalId === "string" ? record.proposalId.trim() : "";
    const confirmationToken =
      typeof record.confirmationToken === "string" ? record.confirmationToken.trim() : "";
    if (!proposalId || !confirmationToken) {
      const confirmation = issueCollabDispatchApprovalConfirmation(found);
      respond(true, {
        status: "pending_confirmation",
        dispatch: found,
        confirmation,
        confirmationDetail: collabDispatchApprovalConfirmationDetail(
          found,
          confirmation.expiresAtMs,
        ),
      });
      return;
    }
    const consumed = consumeCollabDispatchApprovalConfirmation({
      dispatch: found,
      proposalId,
      confirmationToken,
    });
    if (!consumed.ok) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, consumed.reason ?? "confirmation failed"),
      );
      return;
    }
    const broadcastAuthz = await resolveBroadcastAuthz({
      client,
      actor,
      audience: found.audience,
      record,
    });
    const released = await approveCollabDispatchRelease({
      organizerUserId: actor.userId,
      dispatchId: found.id,
      broadcastAuthz,
      actorUserId: actor.userId,
      deliveryCapacityKey: actor.currentSeatId?.trim() || found.tenantId,
    });
    if (!released.ok) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, released.error ?? released.reason),
      );
      return;
    }
    respond(true, {
      status: "released",
      dispatch: released.dispatch,
      projectedCount: released.projectedCount,
      projectionComplete: released.projectionComplete,
      deliveredCount: released.deliveredCount,
      failedCount: released.failedCount,
      deliveryProgress: released.deliveryProgress,
    });
  },

  "collab.dispatch.ack": async ({ params, respond, client }) => {
    const actor = await resolveEmployeeWorkbenchActor(client);
    if (!actor) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "no workbench actor"));
      return;
    }
    const id = readId(asRecord(params));
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "id is required"));
      return;
    }
    const result = await applyCollabDispatchRecipientDecision({
      actorUserId: actor.userId,
      dispatchId: id,
      decision: "acked",
    });
    if (!result.ok) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, result.reason));
      return;
    }
    respond(true, {
      dispatch: result.dispatch,
      projected: result.projected,
      projection: result.projection,
    });
  },

  "collab.dispatch.decline": async ({ params, respond, client }) => {
    const actor = await resolveEmployeeWorkbenchActor(client);
    if (!actor) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "no workbench actor"));
      return;
    }
    const id = readId(asRecord(params));
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "id is required"));
      return;
    }
    const result = await applyCollabDispatchRecipientDecision({
      actorUserId: actor.userId,
      dispatchId: id,
      decision: "declined",
    });
    if (!result.ok) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, result.reason));
      return;
    }
    respond(true, { dispatch: result.dispatch, projected: result.projected });
  },

  "collab.dispatch.list": async ({ params, respond, client }) => {
    const actor = await resolveEmployeeWorkbenchActor(client);
    if (!actor) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "no workbench actor"));
      return;
    }
    const record = asRecord(params);
    const kindFilter =
      typeof record.kind === "string" && isCollabDispatchKind(record.kind.trim())
        ? record.kind.trim()
        : undefined;
    let dispatches = await readOrganizerCollabDispatches(actor.userId);
    if (kindFilter) {
      dispatches = dispatches.filter((row) => row.kind === kindFilter);
    }
    respond(true, { dispatches });
  },

  "collab.dispatch.retry-delivery": async ({ params, respond, client }) => {
    const actor = await resolveEmployeeWorkbenchActor(client);
    if (!actor) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "no workbench actor"));
      return;
    }
    const id = readId(asRecord(params));
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "id is required"));
      return;
    }
    const result = await retryCollabDispatchDelivery({
      organizerUserId: actor.userId,
      dispatchId: id,
    });
    if (!result.ok) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, result.reason));
      return;
    }
    respond(true, {
      dispatch: result.dispatch,
      deliveredCount: result.deliveredCount,
      failedCount: result.failedCount,
      deliveryProgress: result.deliveryProgress,
    });
  },

  "collab.dispatch.cancel": async ({ params, respond, client }) => {
    const actor = await resolveEmployeeWorkbenchActor(client);
    if (!actor) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "no workbench actor"));
      return;
    }
    const id = readId(asRecord(params));
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "id is required"));
      return;
    }
    try {
      const result = await cancelCollabDispatch({
        organizerUserId: actor.userId,
        dispatchId: id,
        actorUserId: actor.userId,
      });
      if (!result.ok) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            result.reason === "already-cancelled"
              ? "dispatch already cancelled"
              : "dispatch not found",
          ),
        );
        return;
      }
      respond(true, {
        dispatch: result.dispatch,
        invalidatedTickets: result.invalidatedTickets,
        recycledSchedules: result.recycledSchedules,
        recycledTodos: result.recycledTodos,
        notifiedAckedCount: result.notifiedAckedCount,
      });
    } catch (error) {
      if (error instanceof CollabDispatchTransitionError) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, error.message));
        return;
      }
      throw error;
    }
  },
};
