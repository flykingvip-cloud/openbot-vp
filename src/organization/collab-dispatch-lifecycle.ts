/** CollabDispatch D3/D4 lifecycle: release → deliver → organizer/recipient projection;
 * D4 adds broadcast authz, audit, and delivery capacity gate.
 */

import { broadcastWorkbenchSignalsInvalidate } from "../gateway/workbench/signals-invalidate.js";
import { appendCollabDispatchAuditEvent } from "./collab-dispatch-audit.js";
import {
  authorizeCollabDispatchBroadcastForDispatch,
  type CollabDispatchBroadcastAuthzContext,
} from "./collab-dispatch-broadcast-authz.js";
import { withCollabDispatchDeliveryCapacity } from "./collab-dispatch-delivery-gate.js";
import {
  type CollabDispatchDeliveryAdapters,
  type CollabDispatchDeliveryProgress,
  deliverCollabDispatchRoster,
  listCollabDispatchRosterDeliveryTargets,
  listFailedOrPendingCollabDispatchRecipientIds,
  summarizeCollabDispatchDeliveryProgress,
} from "./collab-dispatch-delivery.js";
import {
  type CollabDispatch,
  type CollabDispatchProjection,
  type CollabDispatchRecipient,
  collabDispatchHasTimeWindow,
  findCollabDispatchById,
  markCollabDispatchRecipientsAckPending,
  readOrganizerCollabDispatches,
  resolveCollabDispatchOrganizationId,
  transitionCollabDispatch,
  updateCollabDispatchRecipient,
  upsertCollabDispatch,
} from "./collab-dispatch-store.js";
import { buildCollabDispatchScheduleEntry, upsertScheduleEntry } from "./schedule-store.js";
import {
  buildCollabDispatchTodoAssignment,
  upsertManagedOrganizationTaskAssignment,
} from "./task-assignment.js";

function normalizeUserKey(userId: string): string {
  return userId.trim().toLowerCase();
}

function mergeProjections(
  existing: CollabDispatchProjection[] | undefined,
  next: CollabDispatchProjection[],
  rosterUserIds: ReadonlySet<string>,
): CollabDispatchProjection[] {
  const byUser = new Map<string, CollabDispatchProjection>();
  for (const row of existing ?? []) {
    if (rosterUserIds.has(row.userId)) {
      byUser.set(row.userId, row);
    }
  }
  for (const row of next) {
    byUser.set(row.userId, row);
  }
  return [...byUser.values()];
}

export type CollabDispatchProjectionResult = {
  projectedCount: number;
  failedCount: number;
  projections: CollabDispatchProjection[];
};

/** timeWindow → ScheduleEntry; else → todo TaskAssignment (§5.3). */
export async function projectCollabDispatchForUser(
  dispatch: CollabDispatch,
  userId: string,
): Promise<CollabDispatchProjection> {
  const atMs = Date.now();
  const mode = collabDispatchHasTimeWindow(dispatch) ? "schedule" : "todo";
  try {
    if (mode === "schedule" && dispatch.timeWindow) {
      await upsertScheduleEntry(
        buildCollabDispatchScheduleEntry({
          dispatchId: dispatch.id,
          ownerUserId: userId,
          tenantId: dispatch.tenantId,
          title: dispatch.title,
          startAtMs: dispatch.timeWindow.startAtMs,
          ...(dispatch.timeWindow.endAtMs !== undefined
            ? { endAtMs: dispatch.timeWindow.endAtMs }
            : {}),
          timezone: dispatch.timeWindow.timezone,
        }),
      );
    } else {
      await upsertManagedOrganizationTaskAssignment(
        buildCollabDispatchTodoAssignment({
          dispatchId: dispatch.id,
          organizationId: resolveCollabDispatchOrganizationId(dispatch),
          assigneeUserId: userId,
          title: dispatch.title,
          notes: dispatch.body || undefined,
          tenantId: dispatch.tenantId,
        }),
      );
    }
    return { userId, status: "ok", mode, atMs };
  } catch (error) {
    return {
      userId,
      status: "failed",
      mode,
      error: error instanceof Error ? error.message : "projection failed",
      atMs,
    };
  }
}

export async function projectCollabDispatchForUsers(
  dispatch: CollabDispatch,
  userIds: ReadonlyArray<string>,
): Promise<CollabDispatchProjectionResult> {
  const projections = await Promise.all(
    userIds.map((userId) => projectCollabDispatchForUser(dispatch, userId)),
  );
  const projectedCount = projections.filter((row) => row.status === "ok").length;
  return {
    projectedCount,
    failedCount: projections.length - projectedCount,
    projections,
  };
}

function applyProjectionFlags(
  dispatch: CollabDispatch,
  projections: CollabDispatchProjection[],
): CollabDispatch {
  let next = dispatch;
  for (const row of projections) {
    next = updateCollabDispatchRecipient(next, row.userId, {
      scheduleProjection: row.status === "ok" ? "ok" : "failed",
    });
  }
  return next;
}

export type DeliverCollabDispatchOptions = {
  adapters?: CollabDispatchDeliveryAdapters;
  onlyRecipientIds?: ReadonlySet<string>;
  /** Seat/tenant concurrency key; defaults to tenantId. */
  deliveryCapacityKey?: string;
  maxConcurrentDeliveries?: number;
};

async function deliverCollabDispatchNotifications(
  dispatch: CollabDispatch,
  options?: DeliverCollabDispatchOptions,
): Promise<{
  deliveredCount: number;
  failedCount: number;
  skippedCount: number;
  results: Array<{
    recipientId: string;
    kind: "human" | "agent";
    status: "sent" | "failed" | "skipped";
    channel?: "workbench" | "agent-bus";
    error?: string;
  }>;
}> {
  const recipients = listCollabDispatchRosterDeliveryTargets(dispatch);
  const batch = await deliverCollabDispatchRoster({
    payload: {
      dispatchId: dispatch.id,
      kind: dispatch.kind,
      title: dispatch.title,
      ...(dispatch.body ? { body: dispatch.body } : {}),
      organizerUserId: dispatch.organizerUserId,
      tenantId: dispatch.tenantId,
      ...(dispatch.audience.spaceId ? { spaceId: dispatch.audience.spaceId } : {}),
      organizationId: resolveCollabDispatchOrganizationId(dispatch),
    },
    recipients,
    ...(options?.onlyRecipientIds ? { onlyRecipientIds: options.onlyRecipientIds } : {}),
    ...(options?.adapters ? { adapters: options.adapters } : {}),
  });
  return {
    deliveredCount: batch.deliveredCount,
    failedCount: batch.failedCount,
    skippedCount: batch.skippedCount,
    results: batch.results.map((row) => ({
      recipientId: row.recipientId,
      kind: row.kind,
      status: row.status,
      ...(row.channel ? { channel: row.channel } : {}),
      ...(row.error ? { error: row.error } : {}),
    })),
  };
}

function applyDeliveryStatuses(
  dispatch: CollabDispatch,
  results: Array<{ recipientId: string; status: "sent" | "failed" | "skipped" }>,
): CollabDispatch {
  const byId = new Map(results.map((row) => [normalizeUserKey(row.recipientId), row]));
  let next = dispatch;
  for (const recipient of dispatch.recipients) {
    const row = byId.get(normalizeUserKey(recipient.id));
    if (!row || row.status === "skipped") {
      continue;
    }
    next = updateCollabDispatchRecipient(next, recipient.id, {
      deliveryStatus: row.status === "sent" ? "sent" : "failed",
    });
  }
  return next;
}

function isAgentRecipient(recipient: CollabDispatchRecipient): boolean {
  return recipient.kind === "agent";
}

/** Agents auto-ack on release; humans wait for collab.dispatch.ack. */
async function autoAckAgentRecipients(dispatch: CollabDispatch): Promise<CollabDispatch> {
  const organizerKey = normalizeUserKey(dispatch.organizerUserId);
  const agents = dispatch.recipients.filter(
    (recipient) =>
      normalizeUserKey(recipient.id) !== organizerKey &&
      recipient.ackStatus === "pending" &&
      isAgentRecipient(recipient),
  );
  if (agents.length === 0) {
    return dispatch;
  }
  let next = dispatch;
  const nowMs = Date.now();
  for (const agent of agents) {
    next = updateCollabDispatchRecipient(next, agent.id, {
      ackStatus: "acked",
      ackedAtMs: nowMs,
    });
  }
  next = await upsertCollabDispatch(next);
  const fanOut = await projectCollabDispatchForUsers(
    next,
    agents.map((agent) => agent.id),
  );
  next = applyProjectionFlags(next, fanOut.projections);
  const roster = new Set(next.recipients.map((row) => row.id));
  return upsertCollabDispatch({
    ...next,
    projections: mergeProjections(next.projections, fanOut.projections, roster),
    updatedAt: new Date().toISOString(),
  });
}

/** Release: deliver + organizer projection; humans stay ack-pending. */
export async function releaseCollabDispatchSideEffects(
  dispatch: CollabDispatch,
  options?: DeliverCollabDispatchOptions,
): Promise<{
  dispatch: CollabDispatch;
  projectedCount: number;
  projectionComplete: boolean;
  deliveredCount: number;
  failedCount: number;
  deliveryProgress: CollabDispatchDeliveryProgress;
}> {
  const withAckPending = markCollabDispatchRecipientsAckPending(dispatch);
  const capacityKey =
    options?.deliveryCapacityKey?.trim() ||
    dispatch.tenantId.trim() ||
    dispatch.organizerUserId.trim();
  const delivery = await withCollabDispatchDeliveryCapacity({
    key: capacityKey,
    ...(options?.maxConcurrentDeliveries !== undefined
      ? { maxConcurrent: options.maxConcurrentDeliveries }
      : {}),
    run: () => deliverCollabDispatchNotifications(withAckPending, options),
  });
  let next = applyDeliveryStatuses(withAckPending, delivery.results);

  const fanOut = await projectCollabDispatchForUsers(next, [dispatch.organizerUserId]);
  next = applyProjectionFlags(next, fanOut.projections);
  const roster = new Set(next.recipients.map((row) => row.id));
  next = await upsertCollabDispatch({
    ...next,
    projections: mergeProjections(next.projections, fanOut.projections, roster),
    updatedAt: new Date().toISOString(),
  });

  next = await autoAckAgentRecipients(next);

  const organizerOk = (next.projections ?? []).some(
    (row) =>
      normalizeUserKey(row.userId) === normalizeUserKey(dispatch.organizerUserId) &&
      row.status === "ok",
  );
  const deliveryProgress = summarizeCollabDispatchDeliveryProgress(next);
  broadcastWorkbenchSignalsInvalidate({
    reason: "collaboration",
    userIds: [dispatch.organizerUserId],
  });
  await appendCollabDispatchAuditEvent({
    ts: new Date().toISOString(),
    action: "deliver",
    dispatchId: next.id,
    tenantId: next.tenantId,
    kind: next.kind,
    audienceMode: next.audience.mode,
    spaceId: next.audience.spaceId ?? null,
    actorUserId: next.organizerUserId,
    status: next.status,
    detail: {
      deliveredCount: deliveryProgress.deliveredCount,
      failedCount: deliveryProgress.failedCount,
      pendingCount: deliveryProgress.pendingCount,
      totalRecipients: deliveryProgress.totalRecipients,
    },
  });
  return {
    dispatch: next,
    projectedCount: fanOut.projectedCount,
    projectionComplete: organizerOk,
    deliveredCount: deliveryProgress.deliveredCount,
    failedCount: deliveryProgress.failedCount,
    deliveryProgress,
  };
}

export async function submitCollabDispatch(params: {
  organizerUserId: string;
  dispatchId: string;
}): Promise<{ ok: true; dispatch: CollabDispatch } | { ok: false; reason: "not-found" }> {
  const rows = await readOrganizerCollabDispatches(params.organizerUserId);
  const found = rows.find((row) => row.id === params.dispatchId);
  if (!found) {
    return { ok: false, reason: "not-found" };
  }
  const next = await upsertCollabDispatch(
    transitionCollabDispatch(found, "pending_organizer_confirm"),
  );
  return { ok: true, dispatch: next };
}

export async function approveCollabDispatchRelease(params: {
  organizerUserId: string;
  dispatchId: string;
  adapters?: CollabDispatchDeliveryAdapters;
  /** Required for space|tenant broadcast; roster skips the check. */
  broadcastAuthz?: CollabDispatchBroadcastAuthzContext;
  deliveryCapacityKey?: string;
  maxConcurrentDeliveries?: number;
  actorUserId?: string;
}): Promise<
  | {
      ok: true;
      dispatch: CollabDispatch;
      projectedCount: number;
      projectionComplete: boolean;
      deliveredCount: number;
      failedCount: number;
      deliveryProgress: CollabDispatchDeliveryProgress;
    }
  | {
      ok: false;
      reason: "not-found" | "illegal-transition" | "broadcast-forbidden";
      error?: string;
    }
> {
  const rows = await readOrganizerCollabDispatches(params.organizerUserId);
  const found = rows.find((row) => row.id === params.dispatchId);
  if (!found) {
    return { ok: false, reason: "not-found" };
  }
  const authz = params.broadcastAuthz ?? {};
  const broadcastGate = authorizeCollabDispatchBroadcastForDispatch(found, authz);
  if (!broadcastGate.ok) {
    return { ok: false, reason: "broadcast-forbidden", error: broadcastGate.reason };
  }
  try {
    const released = transitionCollabDispatch(found, "released");
    const persisted = await upsertCollabDispatch(released);
    await appendCollabDispatchAuditEvent({
      ts: new Date().toISOString(),
      action: "approve",
      dispatchId: persisted.id,
      tenantId: persisted.tenantId,
      kind: persisted.kind,
      audienceMode: persisted.audience.mode,
      spaceId: persisted.audience.spaceId ?? null,
      actorUserId: params.actorUserId?.trim() || params.organizerUserId,
      status: persisted.status,
      detail: {
        recipientCount: Math.max(0, persisted.recipients.length - 1),
      },
    });
    const effects = await releaseCollabDispatchSideEffects(persisted, {
      ...(params.adapters ? { adapters: params.adapters } : {}),
      ...(params.deliveryCapacityKey ? { deliveryCapacityKey: params.deliveryCapacityKey } : {}),
      ...(params.maxConcurrentDeliveries !== undefined
        ? { maxConcurrentDeliveries: params.maxConcurrentDeliveries }
        : {}),
    });
    return { ok: true, ...effects };
  } catch (error) {
    return {
      ok: false,
      reason: "illegal-transition",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function retryCollabDispatchDelivery(params: {
  organizerUserId: string;
  dispatchId: string;
  adapters?: CollabDispatchDeliveryAdapters;
  onlyRecipientIds?: ReadonlyArray<string>;
}): Promise<
  | {
      ok: true;
      dispatch: CollabDispatch;
      deliveredCount: number;
      failedCount: number;
      deliveryProgress: CollabDispatchDeliveryProgress;
    }
  | { ok: false; reason: "not-found" | "not-released" }
> {
  const rows = await readOrganizerCollabDispatches(params.organizerUserId);
  const found = rows.find((row) => row.id === params.dispatchId);
  if (!found) {
    return { ok: false, reason: "not-found" };
  }
  if (found.status !== "released") {
    return { ok: false, reason: "not-released" };
  }
  const only =
    params.onlyRecipientIds && params.onlyRecipientIds.length > 0
      ? new Set(params.onlyRecipientIds)
      : new Set(listFailedOrPendingCollabDispatchRecipientIds(found));
  const delivery = await deliverCollabDispatchNotifications(found, {
    onlyRecipientIds: only,
    ...(params.adapters ? { adapters: params.adapters } : {}),
  });
  const next = await upsertCollabDispatch(applyDeliveryStatuses(found, delivery.results));
  return {
    ok: true,
    dispatch: next,
    deliveredCount: delivery.deliveredCount,
    failedCount: delivery.failedCount,
    deliveryProgress: summarizeCollabDispatchDeliveryProgress(next),
  };
}

export type CollabDispatchRecipientDecisionResult =
  | {
      ok: true;
      dispatch: CollabDispatch;
      projected: boolean;
      projection?: CollabDispatchProjection;
    }
  | {
      ok: false;
      reason:
        | "not-found"
        | "not-released"
        | "cancelled"
        | "organizer-self"
        | "not-recipient"
        | "already-decided";
    };

/** Recipient ack projects that user; decline writes none; organizer cannot self-ack. */
export async function applyCollabDispatchRecipientDecision(params: {
  actorUserId: string;
  dispatchId: string;
  decision: "acked" | "declined";
}): Promise<CollabDispatchRecipientDecisionResult> {
  const dispatch = await findCollabDispatchById(params.dispatchId);
  if (!dispatch) {
    return { ok: false, reason: "not-found" };
  }
  if (dispatch.status === "cancelled") {
    return { ok: false, reason: "cancelled" };
  }
  if (dispatch.status !== "released") {
    return { ok: false, reason: "not-released" };
  }
  const actorKey = normalizeUserKey(params.actorUserId);
  if (normalizeUserKey(dispatch.organizerUserId) === actorKey) {
    return { ok: false, reason: "organizer-self" };
  }
  const recipient = dispatch.recipients.find((row) => normalizeUserKey(row.id) === actorKey);
  if (!recipient) {
    return { ok: false, reason: "not-recipient" };
  }
  if (recipient.ackStatus === "acked" || recipient.ackStatus === "declined") {
    if (params.decision === "acked" && recipient.ackStatus === "acked") {
      // Idempotent re-ack: ensure projection exists.
      const fanOut = await projectCollabDispatchForUsers(dispatch, [recipient.id]);
      let next = applyProjectionFlags(dispatch, fanOut.projections);
      const roster = new Set(next.recipients.map((row) => row.id));
      next = await upsertCollabDispatch({
        ...next,
        projections: mergeProjections(next.projections, fanOut.projections, roster),
        updatedAt: new Date().toISOString(),
      });
      broadcastWorkbenchSignalsInvalidate({
        reason: "collaboration",
        userIds: [recipient.id, dispatch.organizerUserId],
      });
      return {
        ok: true,
        dispatch: next,
        projected: fanOut.projectedCount > 0,
        projection: fanOut.projections[0],
      };
    }
    return { ok: false, reason: "already-decided" };
  }

  if (params.decision === "declined") {
    const next = await upsertCollabDispatch(
      updateCollabDispatchRecipient(dispatch, recipient.id, {
        ackStatus: "declined",
        ackedAtMs: Date.now(),
        scheduleProjection: "none",
      }),
    );
    broadcastWorkbenchSignalsInvalidate({
      reason: "collaboration",
      userIds: [recipient.id, dispatch.organizerUserId],
    });
    return { ok: true, dispatch: next, projected: false };
  }

  let next = updateCollabDispatchRecipient(dispatch, recipient.id, {
    ackStatus: "acked",
    ackedAtMs: Date.now(),
  });
  next = await upsertCollabDispatch(next);
  const fanOut = await projectCollabDispatchForUsers(next, [recipient.id]);
  next = applyProjectionFlags(next, fanOut.projections);
  const roster = new Set(next.recipients.map((row) => row.id));
  next = await upsertCollabDispatch({
    ...next,
    projections: mergeProjections(next.projections, fanOut.projections, roster),
    updatedAt: new Date().toISOString(),
  });
  broadcastWorkbenchSignalsInvalidate({
    reason: "collaboration",
    userIds: [recipient.id, dispatch.organizerUserId],
  });
  return {
    ok: true,
    dispatch: next,
    projected: fanOut.projectedCount > 0,
    projection: fanOut.projections[0],
  };
}
