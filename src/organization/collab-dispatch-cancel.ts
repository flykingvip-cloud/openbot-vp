/**
 * CollabDispatch Sprint D4 — cancel / revoke (§5.6).
 *
 * - Stop pending delivery (status → cancelled; retry refuses non-released)
 * - Invalidate unused organizer confirm tickets
 * - Soft-cancel written ScheduleEntry + todo projections
 * - Best-effort notify already-acked users when channel available
 * - Audit cancel event
 */

import { broadcastWorkbenchSignalsInvalidate } from "../gateway/workbench/signals-invalidate.js";
import { appendCollabDispatchAuditEvent } from "./collab-dispatch-audit.js";
import { invalidateCollabDispatchApprovalConfirmations } from "./collab-dispatch-confirmation.js";
import {
  type CollabDispatchDeliveryAdapters,
  createDefaultCollabDispatchDeliveryAdapters,
} from "./collab-dispatch-delivery.js";
import {
  type CollabDispatch,
  collabDispatchHasTimeWindow,
  readOrganizerCollabDispatches,
  resolveCollabDispatchOrganizationId,
  transitionCollabDispatch,
  upsertCollabDispatch,
} from "./collab-dispatch-store.js";
import { cancelScheduleEntry, collabDispatchScheduleEntryId } from "./schedule-store.js";
import {
  readManagedOrganizationTaskAssignments,
  transitionTaskAssignment,
  writeManagedOrganizationTaskAssignments,
} from "./task-assignment.js";

function normalizeUserKey(userId: string): string {
  return userId.trim().toLowerCase();
}

/** Soft-cancel todo TaskAssignments projected from this dispatch. */
export async function recycleCollabDispatchTaskAssignments(
  dispatch: CollabDispatch,
): Promise<number> {
  const organizationId = resolveCollabDispatchOrganizationId(dispatch);
  if (!organizationId) {
    return 0;
  }
  const existing = await readManagedOrganizationTaskAssignments(organizationId);
  let count = 0;
  const next = existing.map((assignment) => {
    if (
      assignment.sourceRef?.kind === "collab-dispatch" &&
      assignment.sourceRef.id === dispatch.id &&
      assignment.status !== "rejected" &&
      assignment.status !== "completed"
    ) {
      count += 1;
      return transitionTaskAssignment(assignment, "rejected", {
        notes: "cancelled with collab dispatch",
      });
    }
    return assignment;
  });
  if (count > 0) {
    await writeManagedOrganizationTaskAssignments(organizationId, next);
  }
  return count;
}

async function softCancelScheduleProjections(dispatch: CollabDispatch): Promise<number> {
  if (!collabDispatchHasTimeWindow(dispatch)) {
    return 0;
  }
  let count = 0;
  for (const recipient of dispatch.recipients) {
    const result = await cancelScheduleEntry({
      userId: recipient.id,
      id: collabDispatchScheduleEntryId(dispatch.id, recipient.id),
    });
    if (result) {
      count += 1;
    }
  }
  return count;
}

/** Best-effort cancel notice to already-acked non-organizer recipients. */
async function notifyAckedRecipientsOfCancel(params: {
  dispatch: CollabDispatch;
  adapters?: CollabDispatchDeliveryAdapters;
}): Promise<{ notifiedCount: number; failedCount: number }> {
  const adapters = params.adapters ?? createDefaultCollabDispatchDeliveryAdapters();
  const organizerKey = normalizeUserKey(params.dispatch.organizerUserId);
  const acked = params.dispatch.recipients.filter(
    (row) =>
      normalizeUserKey(row.id) !== organizerKey &&
      row.ackStatus === "acked" &&
      row.kind === "human",
  );
  let notifiedCount = 0;
  let failedCount = 0;
  const payload = {
    dispatchId: params.dispatch.id,
    kind: params.dispatch.kind,
    title: `[已取消] ${params.dispatch.title}`,
    body: `组织通知「${params.dispatch.title}」已取消。`,
    organizerUserId: params.dispatch.organizerUserId,
    tenantId: params.dispatch.tenantId,
    ...(params.dispatch.audience.spaceId ? { spaceId: params.dispatch.audience.spaceId } : {}),
    organizationId: resolveCollabDispatchOrganizationId(params.dispatch),
  };
  for (const recipient of acked) {
    try {
      const outcome = await adapters.deliverHuman({
        ...payload,
        recipientUserId: recipient.id,
      });
      if (outcome.ok) {
        notifiedCount += 1;
      } else {
        failedCount += 1;
      }
    } catch {
      failedCount += 1;
    }
  }
  return { notifiedCount, failedCount };
}

export type CancelCollabDispatchResult =
  | {
      ok: true;
      dispatch: CollabDispatch;
      invalidatedTickets: number;
      recycledSchedules: number;
      recycledTodos: number;
      notifiedAckedCount: number;
    }
  | { ok: false; reason: "not-found" | "already-cancelled" };

export async function cancelCollabDispatch(params: {
  organizerUserId: string;
  dispatchId: string;
  adapters?: CollabDispatchDeliveryAdapters;
  actorUserId?: string;
}): Promise<CancelCollabDispatchResult> {
  const rows = await readOrganizerCollabDispatches(params.organizerUserId);
  const found = rows.find((row) => row.id === params.dispatchId);
  if (!found) {
    return { ok: false, reason: "not-found" };
  }
  if (found.status === "cancelled") {
    return { ok: false, reason: "already-cancelled" };
  }

  // Invalidate unused confirm tickets before status flip (pending_organizer_confirm).
  const invalidatedTickets = invalidateCollabDispatchApprovalConfirmations(found.id);

  const cancelled = await upsertCollabDispatch(transitionCollabDispatch(found, "cancelled"));

  const recycledSchedules = await softCancelScheduleProjections(cancelled);
  const recycledTodos = await recycleCollabDispatchTaskAssignments(cancelled);

  const notify = await notifyAckedRecipientsOfCancel({
    dispatch: found, // use pre-cancel ack statuses
    ...(params.adapters ? { adapters: params.adapters } : {}),
  });

  broadcastWorkbenchSignalsInvalidate({
    reason: "collaboration",
    userIds: cancelled.recipients.map((row) => row.id),
  });

  await appendCollabDispatchAuditEvent({
    ts: new Date().toISOString(),
    action: "cancel",
    dispatchId: cancelled.id,
    tenantId: cancelled.tenantId,
    kind: cancelled.kind,
    audienceMode: cancelled.audience.mode,
    spaceId: cancelled.audience.spaceId ?? null,
    actorUserId: params.actorUserId?.trim() || params.organizerUserId,
    status: cancelled.status,
    detail: {
      invalidatedTickets,
      recycledSchedules,
      recycledTodos,
      notifiedAckedCount: notify.notifiedCount,
      notifyFailedCount: notify.failedCount,
      priorStatus: found.status,
    },
  });

  return {
    ok: true,
    dispatch: cancelled,
    invalidatedTickets,
    recycledSchedules,
    recycledTodos,
    notifiedAckedCount: notify.notifiedCount,
  };
}
