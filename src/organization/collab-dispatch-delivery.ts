/**
 * CollabDispatch Sprint D2 — unified Delivery for roster recipients.
 *
 * Design: docs/design/org-collab-dispatch-dev-2026-09-27.md §5.2 / Sprint D2.
 * - human → existing workbench signals invalidate (employee session refresh path)
 * - agent → organization inter-agent bus (org agent session)
 * Per-recipient pending/sent/failed; partial failure does not block successes;
 * failed recipients are retryable.
 *
 * No LLM. confirmationToken never appears here.
 */

import crypto from "node:crypto";
import { AGENT_LANE_NESTED } from "../agents/lanes.js";
import { callGateway } from "../gateway/call.js";
import { broadcastWorkbenchSignalsInvalidate } from "../gateway/workbench/signals-invalidate.js";
import { logWarn } from "../logger.js";
import { INTERNAL_MESSAGE_CHANNEL } from "../utils/message-channel.js";
import {
  buildOrganizationAgentSessionKey,
  type AgentTaskDeliveryResult,
} from "./inter-agent-bus.js";
import {
  inferMeetingRecipientKind,
  type Meeting,
  type MeetingAttendee,
  type MeetingRecipientKind,
} from "./meeting-store.js";

export type CollabDispatchDeliveryKind = MeetingRecipientKind;

export type CollabDispatchDeliveryChannel = "workbench" | "agent-bus";

export type CollabDispatchDeliveryOutcomeStatus = "sent" | "failed" | "skipped";

export type CollabDispatchDeliveryTarget = {
  recipientId: string;
  kind: CollabDispatchDeliveryKind;
};

export type CollabDispatchDeliveryOutcome = {
  recipientId: string;
  kind: CollabDispatchDeliveryKind;
  status: CollabDispatchDeliveryOutcomeStatus;
  channel?: CollabDispatchDeliveryChannel;
  error?: string;
};

export type CollabDispatchDeliveryBatchResult = {
  deliveredCount: number;
  failedCount: number;
  skippedCount: number;
  results: CollabDispatchDeliveryOutcome[];
};

export type CollabDispatchDeliveryProgress = {
  totalRecipients: number;
  deliveredCount: number;
  failedCount: number;
  pendingCount: number;
};

export type CollabDispatchAdapterKind = "meeting" | "deploy" | "notice" | "summon";

export type CollabDispatchInvitePayload = {
  dispatchId: string;
  /** Adapter kind for this release (meeting D1/D2; deploy/notice/summon D3). */
  kind: CollabDispatchAdapterKind;
  title: string;
  body?: string;
  organizerUserId: string;
  tenantId?: string;
  spaceId?: string;
  /** Org scope for agent bus; defaults to spaceId then tenantId. */
  organizationId?: string;
  sourceSessionKey?: string;
};

export type DeliverHumanCollabInviteParams = CollabDispatchInvitePayload & {
  recipientUserId: string;
};

export type DeliverAgentCollabInviteParams = CollabDispatchInvitePayload & {
  recipientAgentId: string;
  organizationId: string;
};

export type CollabDispatchDeliveryAdapters = {
  deliverHuman: (
    params: DeliverHumanCollabInviteParams,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  deliverAgent: (
    params: DeliverAgentCollabInviteParams,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
};

function normalizeId(value: string): string {
  return value.trim().toLowerCase();
}

export function resolveCollabDispatchOrganizationId(
  payload: Pick<CollabDispatchInvitePayload, "organizationId" | "spaceId" | "tenantId">,
): string | undefined {
  const org =
    payload.organizationId?.trim() || payload.spaceId?.trim() || payload.tenantId?.trim() || "";
  return org || undefined;
}

const KIND_ACK_HINT: Record<CollabDispatchAdapterKind, string> = {
  meeting: "Acknowledge with meeting.ack when human confirmation is required for this seat.",
  deploy: "Acknowledge with collab.dispatch.ack when human confirmation is required for this seat.",
  notice: "Acknowledge with collab.dispatch.ack when human confirmation is required for this seat.",
  summon: "Acknowledge with collab.dispatch.ack when human confirmation is required for this seat.",
};

export function buildCollabDispatchInviteMessage(params: {
  dispatchId: string;
  kind: CollabDispatchAdapterKind;
  title: string;
  body?: string;
  organizerUserId: string;
  organizationId: string;
}): string {
  const label =
    params.kind === "meeting"
      ? "meeting invite"
      : params.kind === "deploy"
        ? "deploy notice"
        : params.kind === "summon"
          ? "summon notice"
          : "organization notice";
  return [
    `Organization ${label} (CollabDispatch):`,
    `Dispatch ID: ${params.dispatchId}`,
    `Kind: ${params.kind}`,
    `Title: ${params.title}`,
    `Organizer: ${params.organizerUserId}`,
    `Organization ID: ${params.organizationId}`,
    params.body ? `Body: ${params.body}` : undefined,
    "",
    KIND_ACK_HINT[params.kind],
  ]
    .filter(Boolean)
    .join("\n");
}

/** @deprecated Prefer buildCollabDispatchInviteMessage with kind. */
export function buildMeetingCollabInviteMessage(params: {
  dispatchId: string;
  title: string;
  body?: string;
  organizerUserId: string;
  organizationId: string;
}): string {
  return buildCollabDispatchInviteMessage({ ...params, kind: "meeting" });
}

export async function sendAgentCollabDispatchInvite(
  params: DeliverAgentCollabInviteParams & { timeoutMs?: number },
): Promise<AgentTaskDeliveryResult> {
  const targetSessionKey = buildOrganizationAgentSessionKey({
    agentId: params.recipientAgentId,
    organizationId: params.organizationId,
  });
  try {
    const response = await callGateway<{ runId?: string }>({
      method: "agent",
      params: {
        message: buildCollabDispatchInviteMessage({
          dispatchId: params.dispatchId,
          kind: params.kind,
          title: params.title,
          ...(params.body !== undefined ? { body: params.body } : {}),
          organizerUserId: params.organizerUserId,
          organizationId: params.organizationId,
        }),
        sessionKey: targetSessionKey,
        idempotencyKey: crypto.randomUUID(),
        deliver: false,
        channel: INTERNAL_MESSAGE_CHANNEL,
        lane: AGENT_LANE_NESTED,
        inputProvenance: {
          kind: "inter_session",
          sourceSessionKey: params.sourceSessionKey,
          sourceTool: "collab_dispatch_delivery",
        },
      },
      timeoutMs: params.timeoutMs ?? 10_000,
    });
    return {
      status: "accepted",
      targetSessionKey,
      ...(response?.runId ? { runId: response.runId } : {}),
    };
  } catch (err) {
    return {
      status: "error",
      targetSessionKey,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function createDefaultCollabDispatchDeliveryAdapters(): CollabDispatchDeliveryAdapters {
  return {
    async deliverHuman(params) {
      try {
        broadcastWorkbenchSignalsInvalidate({
          reason: params.kind === "meeting" ? "meeting" : "collaboration",
          userIds: [params.recipientUserId],
        });
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
    async deliverAgent(params) {
      const result = await sendAgentCollabDispatchInvite(params);
      if (result.status === "accepted") {
        return { ok: true };
      }
      return {
        ok: false,
        error: result.error ?? "agent bus delivery failed",
      };
    },
  };
}

export function attendeeRecipientKind(attendee: MeetingAttendee): CollabDispatchDeliveryKind {
  if (attendee.kind === "agent" || attendee.kind === "human") {
    return attendee.kind;
  }
  return inferMeetingRecipientKind(attendee.userId);
}

export function listCollabDispatchDeliveryTargets(
  meeting: Meeting,
  options?: { includeOrganizer?: boolean },
): CollabDispatchDeliveryTarget[] {
  const organizerKey = normalizeId(meeting.organizerUserId);
  return meeting.attendees
    .filter((attendee) => {
      if (options?.includeOrganizer) {
        return true;
      }
      return normalizeId(attendee.userId) !== organizerKey;
    })
    .map((attendee) => ({
      recipientId: attendee.userId,
      kind: attendeeRecipientKind(attendee),
    }));
}

export function summarizeMeetingDeliveryProgress(meeting: Meeting): CollabDispatchDeliveryProgress {
  const organizerKey = normalizeId(meeting.organizerUserId);
  const recipients = meeting.attendees.filter(
    (attendee) => normalizeId(attendee.userId) !== organizerKey,
  );
  let deliveredCount = 0;
  let failedCount = 0;
  let pendingCount = 0;
  for (const attendee of recipients) {
    const status = attendee.deliveryStatus ?? "pending";
    if (status === "sent") {
      deliveredCount += 1;
    } else if (status === "failed") {
      failedCount += 1;
    } else {
      pendingCount += 1;
    }
  }
  return {
    totalRecipients: recipients.length,
    deliveredCount,
    failedCount,
    pendingCount,
  };
}

export function listFailedOrPendingDeliveryRecipientIds(meeting: Meeting): string[] {
  const organizerKey = normalizeId(meeting.organizerUserId);
  return meeting.attendees
    .filter((attendee) => normalizeId(attendee.userId) !== organizerKey)
    .filter((attendee) => {
      const status = attendee.deliveryStatus ?? "pending";
      return status === "failed" || status === "pending";
    })
    .map((attendee) => attendee.userId);
}

export type DeliverCollabDispatchRosterParams = {
  payload: CollabDispatchInvitePayload;
  recipients: ReadonlyArray<CollabDispatchDeliveryTarget>;
  /** When set, only these recipient ids are attempted (retry path). */
  onlyRecipientIds?: ReadonlySet<string>;
  adapters?: CollabDispatchDeliveryAdapters;
};

/**
 * Fan-out delivery for a roster. Never throws; per-recipient failures become
 * `failed` outcomes so successes stay recorded. Partial failure is expected.
 */
export async function deliverCollabDispatchRoster(
  params: DeliverCollabDispatchRosterParams,
): Promise<CollabDispatchDeliveryBatchResult> {
  const adapters = params.adapters ?? createDefaultCollabDispatchDeliveryAdapters();
  const only = params.onlyRecipientIds;
  const results: CollabDispatchDeliveryOutcome[] = [];

  for (const target of params.recipients) {
    if (only && !only.has(target.recipientId) && !only.has(normalizeId(target.recipientId))) {
      // Allow callers to pass either raw or normalized keys.
      const match = [...only].some((id) => normalizeId(id) === normalizeId(target.recipientId));
      if (!match) {
        continue;
      }
    }

    if (target.kind === "human") {
      try {
        const outcome = await adapters.deliverHuman({
          ...params.payload,
          recipientUserId: target.recipientId,
        });
        if (outcome.ok) {
          results.push({
            recipientId: target.recipientId,
            kind: "human",
            status: "sent",
            channel: "workbench",
          });
        } else {
          results.push({
            recipientId: target.recipientId,
            kind: "human",
            status: "failed",
            channel: "workbench",
            error: outcome.error,
          });
        }
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        logWarn(`collab-dispatch-delivery: human deliver failed: ${error}`);
        results.push({
          recipientId: target.recipientId,
          kind: "human",
          status: "failed",
          channel: "workbench",
          error,
        });
      }
      continue;
    }

    const organizationId = resolveCollabDispatchOrganizationId(params.payload);
    if (!organizationId) {
      results.push({
        recipientId: target.recipientId,
        kind: "agent",
        status: "failed",
        channel: "agent-bus",
        error: "organizationId/spaceId/tenantId required for agent CollabDispatch delivery",
      });
      continue;
    }

    try {
      const outcome = await adapters.deliverAgent({
        ...params.payload,
        recipientAgentId: target.recipientId,
        organizationId,
      });
      if (outcome.ok) {
        results.push({
          recipientId: target.recipientId,
          kind: "agent",
          status: "sent",
          channel: "agent-bus",
        });
      } else {
        results.push({
          recipientId: target.recipientId,
          kind: "agent",
          status: "failed",
          channel: "agent-bus",
          error: outcome.error,
        });
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logWarn(`collab-dispatch-delivery: agent deliver failed: ${error}`);
      results.push({
        recipientId: target.recipientId,
        kind: "agent",
        status: "failed",
        channel: "agent-bus",
        error,
      });
    }
  }

  const deliveredCount = results.filter((row) => row.status === "sent").length;
  const failedCount = results.filter((row) => row.status === "failed").length;
  const skippedCount = results.filter((row) => row.status === "skipped").length;
  return { deliveredCount, failedCount, skippedCount, results };
}

export type CollabDispatchRosterLike = {
  organizerUserId: string;
  recipients: ReadonlyArray<{
    id: string;
    kind?: CollabDispatchDeliveryKind;
    deliveryStatus?: "pending" | "sent" | "failed";
  }>;
};

export function listCollabDispatchRosterDeliveryTargets(
  dispatch: CollabDispatchRosterLike,
  options?: { includeOrganizer?: boolean },
): CollabDispatchDeliveryTarget[] {
  const organizerKey = normalizeId(dispatch.organizerUserId);
  return dispatch.recipients
    .filter((recipient) => {
      if (options?.includeOrganizer) {
        return true;
      }
      return normalizeId(recipient.id) !== organizerKey;
    })
    .map((recipient) => ({
      recipientId: recipient.id,
      kind:
        recipient.kind === "agent" || recipient.kind === "human"
          ? recipient.kind
          : inferMeetingRecipientKind(recipient.id),
    }));
}

export function summarizeCollabDispatchDeliveryProgress(
  dispatch: CollabDispatchRosterLike,
): CollabDispatchDeliveryProgress {
  const organizerKey = normalizeId(dispatch.organizerUserId);
  const recipients = dispatch.recipients.filter(
    (recipient) => normalizeId(recipient.id) !== organizerKey,
  );
  let deliveredCount = 0;
  let failedCount = 0;
  let pendingCount = 0;
  for (const recipient of recipients) {
    const status = recipient.deliveryStatus ?? "pending";
    if (status === "sent") {
      deliveredCount += 1;
    } else if (status === "failed") {
      failedCount += 1;
    } else {
      pendingCount += 1;
    }
  }
  return {
    totalRecipients: recipients.length,
    deliveredCount,
    failedCount,
    pendingCount,
  };
}

export function listFailedOrPendingCollabDispatchRecipientIds(
  dispatch: CollabDispatchRosterLike,
): string[] {
  const organizerKey = normalizeId(dispatch.organizerUserId);
  return dispatch.recipients
    .filter((recipient) => normalizeId(recipient.id) !== organizerKey)
    .filter((recipient) => {
      const status = recipient.deliveryStatus ?? "pending";
      return status === "failed" || status === "pending";
    })
    .map((recipient) => recipient.id);
}
