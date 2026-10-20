/**
 * CollabDispatch organizer release confirmation (Sprint D3/D4).
 * Reuses steward confirmation store — same chat-confirm primary path as meeting.
 * Tools must NOT echo confirmationToken into the model context.
 * D4: confirmation copy includes blast radius for space|tenant broadcast.
 *
 * Registered as ConfirmActionDescriptor `collab.dispatch.approve:` (SPEC §6).
 */

import {
  consumeConfirmation,
  createConfirmation,
  invalidateConfirmationsByActionId,
  type ConsumeConfirmationResult,
} from "../gateway/server-methods/steward-confirmation-store.js";
import type { DaibaiConfirmationEnvelope } from "../shared/daibai-types.js";
import { describeCollabDispatchBlastRadius } from "./collab-dispatch-broadcast-authz.js";
import type { CollabDispatch, CollabDispatchKind } from "./collab-dispatch-store.js";
import {
  registerConfirmAction,
  resolveConfirmIrreversible,
  type ConfirmActionDescriptor,
} from "./confirm-action-descriptor.js";

const KIND_LABEL: Record<CollabDispatchKind, string> = {
  deploy: "部署通知",
  notice: "组织通知",
  summon: "召集通知",
};

export function collabDispatchApproveActionId(dispatchId: string): string {
  return `collab.dispatch.approve:${dispatchId.trim()}`;
}

export function buildCollabDispatchApprovalPayload(
  dispatch: CollabDispatch,
): Record<string, unknown> {
  return {
    dispatchId: dispatch.id,
    kind: dispatch.kind,
    title: dispatch.title,
    body: dispatch.body,
    timeWindow: dispatch.timeWindow
      ? {
          startAtMs: dispatch.timeWindow.startAtMs,
          endAtMs: dispatch.timeWindow.endAtMs ?? null,
          timezone: dispatch.timeWindow.timezone,
        }
      : null,
    recipients: dispatch.recipients.map((row) => row.id).toSorted(),
    audienceMode: dispatch.audience.mode,
    spaceId: dispatch.audience.spaceId ?? null,
    updatedAt: dispatch.updatedAt,
  };
}

function collabDispatchConsequenceHint(dispatch: CollabDispatch): string {
  const label = KIND_LABEL[dispatch.kind];
  const blast = describeCollabDispatchBlastRadius(dispatch);
  const projectionHint = dispatch.timeWindow
    ? "并写入你的日程；对方知晓确认后才会写入其日程"
    : "并写入你的待办；对方知晓确认后才会写入其待办";
  const isBroadcast = dispatch.audience.mode === "space" || dispatch.audience.mode === "tenant";
  if (isBroadcast) {
    return `确认后以「${label}」执行${blast}，${projectionHint}。请确认影响范围后再放行。`;
  }
  if (blast.startsWith("仅发起人")) {
    return `确认后放行「${label}」并写入你的${dispatch.timeWindow ? "日程" : "待办"}`;
  }
  return `确认后发送「${label}」给${blast.replace("定向名单 ", "")}，${projectionHint}`;
}

function collabDispatchIsIrreversible(dispatch: CollabDispatch): boolean {
  return dispatch.audience.mode === "space" || dispatch.audience.mode === "tenant";
}

export const COLLAB_DISPATCH_APPROVE_CONFIRM_ACTION: ConfirmActionDescriptor<CollabDispatch> =
  registerConfirmAction({
    actionIdPattern: "collab.dispatch.approve:",
    buildActionId: collabDispatchApproveActionId,
    buildPayload: buildCollabDispatchApprovalPayload,
    consequenceHint: collabDispatchConsequenceHint,
    irreversible: collabDispatchIsIrreversible,
    onConfirm: (params) =>
      consumeConfirmation({
        proposalId: params.proposalId,
        confirmationToken: params.confirmationToken,
        actionId: collabDispatchApproveActionId(params.entity.id),
        payload: buildCollabDispatchApprovalPayload(params.entity),
        ...(params.now !== undefined ? { now: params.now } : {}),
      }),
    onCancel: (dispatchId) =>
      invalidateConfirmationsByActionId(collabDispatchApproveActionId(dispatchId)),
    uiChrome: "inline_card",
  });

export function issueCollabDispatchApprovalConfirmation(
  dispatch: CollabDispatch,
): DaibaiConfirmationEnvelope {
  return createConfirmation({
    actionId: COLLAB_DISPATCH_APPROVE_CONFIRM_ACTION.buildActionId(dispatch.id),
    payload: COLLAB_DISPATCH_APPROVE_CONFIRM_ACTION.buildPayload(dispatch),
  });
}

export function consumeCollabDispatchApprovalConfirmation(params: {
  dispatch: CollabDispatch;
  proposalId: string;
  confirmationToken: string;
  now?: number;
}): ConsumeConfirmationResult {
  return (
    COLLAB_DISPATCH_APPROVE_CONFIRM_ACTION.onConfirm?.({
      entity: params.dispatch,
      proposalId: params.proposalId,
      confirmationToken: params.confirmationToken,
      ...(params.now !== undefined ? { now: params.now } : {}),
    }) ?? { ok: false, reason: "not_found" }
  );
}

/** Invalidate unused organizer confirm tickets for this dispatch (cancel path). */
export function invalidateCollabDispatchApprovalConfirmations(dispatchId: string): number {
  return COLLAB_DISPATCH_APPROVE_CONFIRM_ACTION.onCancel?.(dispatchId) ?? 0;
}

export function collabDispatchApprovalConfirmationDetail(
  dispatch: CollabDispatch,
  expiresAtMs: number,
) {
  const blast = describeCollabDispatchBlastRadius(dispatch);
  return {
    title: dispatch.title,
    impact: COLLAB_DISPATCH_APPROVE_CONFIRM_ACTION.consequenceHint?.(dispatch),
    irreversible: resolveConfirmIrreversible(COLLAB_DISPATCH_APPROVE_CONFIRM_ACTION, dispatch),
    expiresAtMs,
    blastRadius: blast,
    audienceMode: dispatch.audience.mode,
  };
}
