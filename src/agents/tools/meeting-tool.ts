import { randomUUID } from "node:crypto";
import { Type } from "@sinclair/typebox";
import {
  resolveEmployeeWorkbenchActor,
  type EmployeeWorkbenchActor,
} from "../../gateway/employee-workbench-scope.js";
import { resolveOperationalIdentityRuntimeScopeDecision } from "../../gateway/enterprise-operational-identity-runtime.js";
import {
  resolveExecutionIdentityFromRunFields,
  toRestrictedGatewayClient,
  type ExecutionIdentityContext,
} from "../../gateway/execution-identity-context.js";
import { getLifecycleModelRunner } from "../../gateway/lifecycle/lifecycle-model-runner.js";
import { generateMeetingMinutes } from "../../gateway/lifecycle/meeting-minutes-run.js";
import {
  maybeCancelTencentMeetingForMeeting,
  maybeProvisionTencentMeetingForMeeting,
  resolveMeetingTencentMeetingBridgeContext,
} from "../../gateway/meeting-tencent-meeting-bridge.js";
import type { GatewayClient } from "../../gateway/server-methods/types.js";
import { invalidateOrganizerMeetingWorkbenchSignals } from "../../gateway/workbench/signals-invalidate.js";
import { validateMinutesDraft } from "../../organization/lifecycle-candidates.js";
import {
  consumeMeetingApprovalConfirmation,
  invalidateMeetingApprovalConfirmations,
  meetingApprovalConfirmationDetail,
  reissueMeetingApprovalConfirmation,
} from "../../organization/meeting-confirmation.js";
import {
  applyMeetingTransition,
  attachMeetingMinutes,
  distributeMeetingMinutes,
  replayMeetingScheduleFanOut,
} from "../../organization/meeting-lifecycle.js";
import {
  parseMeetingMode,
  preflightOnlineMeetingJoinUrl,
} from "../../organization/meeting-mode.js";
import {
  createMeeting,
  MeetingTransitionError,
  readOrganizerMeetings,
  upsertMeeting,
} from "../../organization/meeting-store.js";
import { resolveSessionAgentId } from "../agent-scope.js";
import { jsonResult, readStringParam, ToolInputError } from "./common.js";
import type { AnyAgentTool } from "./common.js";
import { parseActionItemsParam, parseDecisionList } from "./meeting-tool-minutes.js";

/**
 * Steward (大白) meeting tool. Approve is gated by a server-issued confirmation
 * ticket: the tool never returns `confirmationToken` to the model (prevents
 * same-turn submit→approve bypass). The organizer UI / a later user-supplied
 * token is required to consume the ticket.
 */

const MeetingToolSchema = Type.Object({
  action: Type.String({
    description:
      "One of: create, submit, approve, cancel, list, replay-schedule, start, minute, distribute, generate-minutes.",
  }),
  id: Type.Optional(
    Type.String({
      description:
        "Meeting id (required for submit/approve/cancel/replay-schedule/start/minute/distribute/generate-minutes).",
    }),
  ),
  title: Type.Optional(Type.String({ description: "Meeting title (required for create)." })),
  startAt: Type.Optional(
    Type.String({ description: "ISO 8601 start datetime (required for create)." }),
  ),
  endAt: Type.Optional(Type.String({ description: "ISO 8601 end datetime (optional)." })),
  timezone: Type.Optional(Type.String({ description: "IANA timezone label (default UTC)." })),
  location: Type.Optional(
    Type.String({
      description:
        'Place label, e.g. "线上" / "3F-会议室A" (recommended for create; legacy online hint).',
    }),
  ),
  meetingMode: Type.Optional(
    Type.String({
      description:
        'Explicit "online" | "offline". Prefer over location regex for online detection.',
    }),
  ),
  joinUrl: Type.Optional(
    Type.String({ description: "Online meeting join URL when the meeting is remote." }),
  ),
  provisionTencentMeeting: Type.Optional(
    Type.Boolean({
      description:
        "When true (or location suggests online), auto-create a Tencent Meeting room via tenant enterprise identity and fill joinUrl.",
    }),
  ),
  agenda: Type.Optional(
    Type.String({
      description: "Agenda bullets separated by newlines or '|' (recommended for create).",
    }),
  ),
  attendees: Type.Optional(
    Type.String({ description: "Comma-separated attendee user ids (create)." }),
  ),
  spaceId: Type.Optional(
    Type.String({
      description:
        "Collaboration space id. Required for create if minutes should fan out into 待我处理 (task fan-out is skipped without it).",
    }),
  ),
  proposalId: Type.Optional(
    Type.String({
      description:
        "Server-issued proposal id for approve (from submit/pending_confirmation). Required with confirmationToken.",
    }),
  ),
  confirmationToken: Type.Optional(
    Type.String({
      description:
        "Server-issued one-shot confirmation token. Never invent this; only pass a token the user/UI provided after explicit confirmation.",
    }),
  ),
  summary: Type.Optional(Type.String({ description: "Minutes summary (required for minute)." })),
  decisions: Type.Optional(
    Type.String({ description: "Minutes decisions, separated by newlines or '|' (minute)." }),
  ),
  actionItems: Type.Optional(
    Type.String({
      description:
        "Minutes action items for minute. One per line: 'title @ assigneeUserId @ ISO-due', or a JSON array of {title, assigneeUserId?, dueAt?}. assigneeUserId must be an attendee or fan-out drops the item.",
    }),
  ),
  transcript: Type.Optional(
    Type.String({
      description:
        "Meeting transcript/notes for generate-minutes. Returns a draft only; call minute to attach it, then distribute to fan out tasks.",
    }),
  ),
});

function normalizeAction(
  raw: string,
):
  | "create"
  | "submit"
  | "approve"
  | "cancel"
  | "list"
  | "replay-schedule"
  | "start"
  | "minute"
  | "distribute"
  | "generate-minutes" {
  const action = raw.trim().toLowerCase();
  if (
    action === "create" ||
    action === "submit" ||
    action === "approve" ||
    action === "cancel" ||
    action === "list" ||
    action === "replay-schedule" ||
    action === "start" ||
    action === "minute" ||
    action === "distribute" ||
    action === "generate-minutes"
  ) {
    return action;
  }
  throw new ToolInputError(
    "action must be one of: create, submit, approve, cancel, list, replay-schedule, start, minute, distribute, generate-minutes",
  );
}

function parseIsoToMs(value: string, label: string): number {
  const ms = Date.parse(value.trim());
  if (!Number.isFinite(ms)) {
    throw new ToolInputError(`${label} must be a valid ISO 8601 datetime`);
  }
  return ms;
}

function parseAttendeeIds(raw: string): Array<{ userId: string }> {
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((userId) => ({ userId }));
}

function parseAgenda(raw: string | undefined): string[] | undefined {
  if (!raw?.trim()) {
    return undefined;
  }
  const agenda = raw
    .split(/\r?\n|\|/)
    .map((item) => item.trim())
    .filter(Boolean);
  return agenda.length > 0 ? agenda : undefined;
}

function readProvisionTencentMeetingFlag(params: Record<string, unknown>): boolean | undefined {
  const raw = params.provisionTencentMeeting;
  if (typeof raw === "boolean") {
    return raw;
  }
  if (typeof raw === "string") {
    const normalized = raw.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["0", "false", "no", "off"].includes(normalized)) {
      return false;
    }
  }
  return undefined;
}

function actorFromOperationalIdentityScope(scope: {
  tenantId: string;
  seatId: string;
  employeeId: string;
  agentId: string;
}): EmployeeWorkbenchActor {
  return {
    userId: scope.employeeId,
    userEmail: "",
    tenantId: scope.tenantId,
    currentSeatId: scope.seatId,
    seatAgentIds: [scope.agentId],
    seatSpaceIds: [],
  };
}

async function applyTencentMeetingProvision(params: {
  meeting: import("../../organization/meeting-store.js").Meeting;
  actor: EmployeeWorkbenchActor;
  agentId?: string;
  explicit?: boolean;
}) {
  const bridgeCtx = resolveMeetingTencentMeetingBridgeContext({
    actor: params.actor,
    agentId: params.agentId,
  });
  const provision = await maybeProvisionTencentMeetingForMeeting({
    meeting: params.meeting,
    ctx: bridgeCtx,
    explicit: params.explicit,
  });
  if (provision.ok) {
    return { meeting: provision.meeting, provisionMeta: { joinUrl: provision.joinUrl } };
  }
  return { meeting: params.meeting, provisionMeta: null as { joinUrl: string } | null };
}

export function createMeetingTool(options?: {
  executionIdentity?: ExecutionIdentityContext;
  gatewayClientUser?: string;
  gatewayClientSessionDomain?: GatewayClient["sessionDomain"];
  gatewayClientPlatformUserId?: string;
  gatewayClientSessionEnterpriseId?: string;
  gatewayClientSessionMembershipId?: string;
  agentSessionKey?: string;
  requesterAgentIdOverride?: string;
}): AnyAgentTool {
  return {
    name: "meeting",
    label: "Meeting",
    description:
      "Convene meetings for the signed-in user with a server-verified confirm-before-approve gate. " +
      "Flow: (1) create a draft with title/startAt/attendees plus location and/or joinUrl and agenda; " +
      "if endAt is omitted, default to startAt + 1 hour; set meetingMode=online (preferred) or provisionTencentMeeting=true / location like 线上/腾讯会议 to auto-book via tenant Tencent Meeting identity; " +
      "(2) submit — this issues a confirmation ticket (token is NOT returned to you) and shows the UI confirm card; " +
      "(3) stop talking about whether to create: wait for the user to tap the card, OR call approve only with proposalId+confirmationToken the user/UI provided. " +
      "Do not run a verbal questionnaire about duration/attendees after the user already named them; apply defaults and state them in the draft/result. " +
      "After pending_confirmation, never re-ask 'create/submit/confirm?' — the card is the only confirm exit. " +
      "Approve (=release) writes the organizer schedule and notifies recipients; recipients get their own schedule only after they ack. " +
      "Pass spaceId on create and put every task owner in attendees, or later distribute writes nothing to 待我处理. " +
      "After the meeting is reminded: start (reminded → in_progress), minute (attach MinutesDraft action items), distribute (fan those items out as assignee tasks). " +
      "generate-minutes turns a transcript into a draft and does not persist or distribute it. " +
      "Do not invent confirmationToken. Do not use the schedule tool to silently book multi-attendee meetings. " +
      "Prefer this meeting tool over exec/shell/bash for booking, changing, or canceling Tencent/online meetings — never spawn docker, shell, or CLI as a substitute. " +
      "replay-schedule compensates organizer/acked projections after confirm. cancel drops it; list inspects.",
    parameters: MeetingToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = normalizeAction(readStringParam(params, "action", { required: true }));
      const identity = resolveExecutionIdentityFromRunFields({
        executionIdentity: options?.executionIdentity,
        gatewayClientUser: options?.gatewayClientUser,
        gatewayClientSessionDomain: options?.gatewayClientSessionDomain,
        gatewayClientPlatformUserId: options?.gatewayClientPlatformUserId,
        gatewayClientSessionEnterpriseId: options?.gatewayClientSessionEnterpriseId,
        gatewayClientSessionMembershipId: options?.gatewayClientSessionMembershipId,
        agentId: options?.requesterAgentIdOverride,
        sessionKey: options?.agentSessionKey,
      });
      const client = toRestrictedGatewayClient(identity);
      const agentId =
        identity.agentId ||
        options?.requesterAgentIdOverride?.trim() ||
        (options?.agentSessionKey
          ? resolveSessionAgentId({ sessionKey: options.agentSessionKey })
          : undefined);
      let actor = client ? await resolveEmployeeWorkbenchActor(client) : null;
      if (!actor) {
        const decision = await resolveOperationalIdentityRuntimeScopeDecision(client, {
          agentId,
          ...(identity.collaborationOwnerEntitlement
            ? { collaborationOwnerEntitlement: identity.collaborationOwnerEntitlement }
            : {}),
        });
        if (!decision.ok) {
          throw new ToolInputError(decision.message);
        }
        actor = actorFromOperationalIdentityScope(decision.scope);
      }
      if (!actor) {
        throw new ToolInputError(
          "A signed-in employee session or an enrolled enterprise meeting identity is required to manage meetings.",
        );
      }

      if (action === "list") {
        const meetings = await readOrganizerMeetings(actor.userId);
        return jsonResult({ ok: true, action, meetings });
      }

      if (action === "create") {
        const title = readStringParam(params, "title", { required: true });
        const startAtMs = parseIsoToMs(
          readStringParam(params, "startAt", { required: true }),
          "startAt",
        );
        const endAtRaw = readStringParam(params, "endAt");
        let endAtMs: number | undefined;
        if (endAtRaw) {
          endAtMs = parseIsoToMs(endAtRaw, "endAt");
          if (endAtMs < startAtMs) {
            throw new ToolInputError("endAt must be the same as or after startAt");
          }
        } else {
          // P0 default: 1h when user omitted duration — state in result, don't questionnaire.
          endAtMs = startAtMs + 60 * 60 * 1000;
        }
        const timezone = readStringParam(params, "timezone");
        const spaceId = readStringParam(params, "spaceId");
        const location = readStringParam(params, "location");
        const meetingMode = parseMeetingMode(params.meetingMode);
        const joinUrl = readStringParam(params, "joinUrl");
        const agenda = parseAgenda(readStringParam(params, "agenda"));
        const provisionExplicit = readProvisionTencentMeetingFlag(params);
        let meeting = await upsertMeeting(
          createMeeting({
            organizerUserId: actor.userId,
            ...(actor.tenantId !== undefined ? { tenantId: actor.tenantId } : {}),
            ...(spaceId ? { spaceId } : {}),
            title,
            startAtMs,
            ...(endAtMs !== undefined ? { endAtMs } : {}),
            ...(timezone ? { timezone } : {}),
            ...(location ? { location } : {}),
            ...(meetingMode ? { meetingMode } : {}),
            ...(joinUrl ? { joinUrl } : {}),
            ...(agenda ? { agenda } : {}),
            attendees: parseAttendeeIds(readStringParam(params, "attendees") ?? ""),
          }),
        );
        const provisioned = await applyTencentMeetingProvision({
          meeting,
          actor,
          agentId,
          explicit: provisionExplicit,
        });
        if (provisioned.meeting !== meeting) {
          meeting = await upsertMeeting(provisioned.meeting);
        }
        invalidateOrganizerMeetingWorkbenchSignals(actor.userId);
        return jsonResult({
          ok: true,
          action,
          meeting,
          ...(provisioned.provisionMeta
            ? { tencentMeetingProvisioned: true, joinUrl: provisioned.provisionMeta.joinUrl }
            : {}),
          template: {
            title: meeting.title,
            startAtMs: meeting.startAtMs,
            endAtMs: meeting.endAtMs ?? null,
            timezone: meeting.timezone,
            location: meeting.location ?? null,
            joinUrl: meeting.joinUrl ?? null,
            agenda: meeting.agenda ?? [],
            attendees: meeting.attendees.map((a) => a.userId),
          },
          nextStep:
            "Briefly state the draft (incl. defaults such as duration). Then submit — do not ask whether to create. After submit, wait for the UI confirm card; approve only with a user/UI token.",
        });
      }

      const id = readStringParam(params, "id", { required: true });

      if (action === "replay-schedule") {
        try {
          const result = await replayMeetingScheduleFanOut({
            organizerUserId: actor.userId,
            meetingId: id,
          });
          if (!result.ok) {
            throw new ToolInputError(`Meeting not found: ${id}`);
          }
          return jsonResult({
            ok: true,
            action,
            meeting: result.meeting,
            scheduledCount: result.scheduledCount,
            scheduleComplete: result.scheduleComplete ?? false,
          });
        } catch (error) {
          if (error instanceof ToolInputError) {
            throw error;
          }
          throw new ToolInputError(
            error instanceof Error ? error.message : "failed to replay schedule fan-out",
          );
        }
      }

      if (action === "approve") {
        const meetings = await readOrganizerMeetings(actor.userId);
        const meeting = meetings.find((entry) => entry.id === id);
        if (!meeting) {
          throw new ToolInputError(`Meeting not found: ${id}`);
        }
        if (meeting.status !== "pending_approval") {
          throw new ToolInputError(`illegal meeting transition: ${meeting.status} -> confirmed`);
        }
        const proposalId = readStringParam(params, "proposalId");
        const confirmationToken = readStringParam(params, "confirmationToken");
        if (!proposalId || !confirmationToken) {
          const joinUrlGate = preflightOnlineMeetingJoinUrl(meeting);
          if (!joinUrlGate.ok) {
            return jsonResult({
              ok: false,
              action,
              code: joinUrlGate.code,
              error: joinUrlGate.message,
              meeting,
              message: joinUrlGate.message,
            });
          }
          // Re-check the current draft and invalidate any previous ticket.
          // Never return confirmationToken, and never put it on the recovery row.
          const reissued = reissueMeetingApprovalConfirmation({
            meeting,
            actorUserId: actor.userId,
          });
          if (!reissued.ok) {
            return jsonResult({
              ok: false,
              action,
              code: reissued.code,
              error: reissued.message,
              meeting,
              message: reissued.message,
            });
          }
          return jsonResult({
            ok: true,
            action,
            status: "pending_confirmation",
            meeting,
            proposalId: reissued.confirmation.proposalId,
            expiresAtMs: reissued.confirmation.expiresAtMs,
            recovery: reissued.recovery,
            confirmationDetail: meetingApprovalConfirmationDetail(
              meeting,
              reissued.confirmation.expiresAtMs,
            ),
            message:
              "pending_confirmation: UI confirm card is the only exit. Do not verbally re-ask create/submit/confirm. Wait for the card tap or a user-provided confirmationToken; never invent one.",
          });
        }
        const joinUrlGateBeforeConfirm = preflightOnlineMeetingJoinUrl(meeting);
        if (!joinUrlGateBeforeConfirm.ok) {
          throw new ToolInputError(joinUrlGateBeforeConfirm.message);
        }
        const consume = consumeMeetingApprovalConfirmation({
          meeting,
          proposalId,
          confirmationToken,
        });
        if (!consume.ok) {
          throw new ToolInputError(
            consume.reason === "payload_mismatch"
              ? "Meeting content changed; re-submit and confirm again."
              : `Confirmation rejected: ${consume.reason}`,
          );
        }
        const bridgeCtx = resolveMeetingTencentMeetingBridgeContext({ actor, agentId });
        const provision = await maybeProvisionTencentMeetingForMeeting({
          meeting,
          ctx: bridgeCtx,
        });
        if (provision.ok) {
          await upsertMeeting(provision.meeting);
        }
        try {
          const result = await applyMeetingTransition({
            organizerUserId: actor.userId,
            meetingId: id,
            to: "confirmed",
            sessionClient: client,
          });
          if (!result.ok) {
            throw new ToolInputError(`Meeting not found: ${id}`);
          }
          return jsonResult({
            ok: true,
            action,
            status: "confirmed",
            meeting: result.meeting,
            scheduledCount: result.scheduledCount,
            scheduleComplete: result.scheduleComplete ?? false,
          });
        } catch (error) {
          if (error instanceof MeetingTransitionError) {
            throw new ToolInputError(error.message);
          }
          throw error;
        }
      }

      if (action === "start" || action === "distribute") {
        try {
          const result =
            action === "start"
              ? await applyMeetingTransition({
                  organizerUserId: actor.userId,
                  meetingId: id,
                  to: "in_progress",
                })
              : await distributeMeetingMinutes({
                  organizerUserId: actor.userId,
                  meetingId: id,
                });
          if (!result.ok) {
            throw new ToolInputError(`Meeting not found: ${id}`);
          }
          const taskCount = result.taskCount ?? 0;
          return jsonResult({
            ok: true,
            action,
            meeting: result.meeting,
            scheduledCount: result.scheduledCount,
            ...(action === "distribute"
              ? {
                  taskCount,
                  note:
                    taskCount > 0
                      ? "Action items were written for attendees. Each assignee sees them on 待我处理."
                      : "No tasks written. The meeting needs a spaceId and action items whose assigneeUserId is an attendee.",
                }
              : {}),
          });
        } catch (error) {
          if (error instanceof ToolInputError) {
            throw error;
          }
          if (error instanceof MeetingTransitionError) {
            throw new ToolInputError(error.message);
          }
          throw error;
        }
      }

      if (action === "minute") {
        const summary = readStringParam(params, "summary", { required: true });
        const parsedItems = parseActionItemsParam(readStringParam(params, "actionItems"));
        if (parsedItems.error) {
          throw new ToolInputError(parsedItems.error);
        }
        const validated = validateMinutesDraft({
          summary,
          decisions: parseDecisionList(readStringParam(params, "decisions")),
          actionItems: parsedItems.items,
        });
        if (!validated.ok) {
          throw new ToolInputError(`invalid minutes: ${validated.errors.join("; ")}`);
        }
        try {
          const result = await attachMeetingMinutes({
            organizerUserId: actor.userId,
            meetingId: id,
            minutes: validated.value,
          });
          if (!result.ok) {
            throw new ToolInputError(`Meeting not found: ${id}`);
          }
          const roster = new Set(result.meeting.attendees.map((attendee) => attendee.userId));
          const dropped = validated.value.actionItems.filter(
            (item) => !item.assigneeUserId || !roster.has(item.assigneeUserId),
          );
          return jsonResult({
            ok: true,
            action,
            meeting: result.meeting,
            droppedActionItems: dropped.map((item) => item.title),
            note: result.meeting.spaceId
              ? "Minutes attached. Call distribute so assignees receive them on 待我处理."
              : "Minutes attached, but this meeting has no spaceId so distribute will not create 待我处理 tasks.",
          });
        } catch (error) {
          if (error instanceof ToolInputError) {
            throw error;
          }
          if (error instanceof MeetingTransitionError) {
            throw new ToolInputError(error.message);
          }
          throw error;
        }
      }

      if (action === "generate-minutes") {
        const transcript = readStringParam(params, "transcript", { required: true });
        const meetings = await readOrganizerMeetings(actor.userId);
        const meeting = meetings.find((entry) => entry.id === id);
        if (!meeting) {
          throw new ToolInputError(`Meeting not found: ${id}`);
        }
        const runModel = getLifecycleModelRunner();
        if (!runModel) {
          return jsonResult({
            ok: true,
            action,
            status: "unavailable",
            reason: "model runner not configured",
            meeting,
          });
        }
        const result = await generateMeetingMinutes(
          {
            runId: randomUUID(),
            organizerUserId: actor.userId,
            ...(actor.tenantId !== undefined ? { enterpriseId: actor.tenantId } : {}),
            meetingTitle: meeting.title,
            transcript,
            attendeeUserIds: meeting.attendees.map((attendee) => attendee.userId),
          },
          { runModel },
        );
        if (result.status === "produced") {
          return jsonResult({
            ok: true,
            action,
            status: "produced",
            draft: result.candidate,
            meeting,
            note: "Draft only. Call minute with this summary and actionItems, then distribute.",
          });
        }
        return jsonResult({ ok: true, action, meeting, ...result });
      }

      const to = action === "submit" ? "pending_approval" : "cancelled";
      try {
        if (action === "cancel") {
          // SPEC §5.1 / migration E: invalidate unused meeting.approve tickets before flip.
          invalidateMeetingApprovalConfirmations(id);
        }
        const result = await applyMeetingTransition({
          organizerUserId: actor.userId,
          meetingId: id,
          to,
        });
        if (!result.ok) {
          throw new ToolInputError(`Meeting not found: ${id}`);
        }
        if (action === "submit") {
          let meetingForSubmit = result.meeting;
          const provision = await applyTencentMeetingProvision({
            meeting: result.meeting,
            actor,
            agentId,
          });
          if (provision.meeting !== result.meeting) {
            meetingForSubmit = await upsertMeeting(provision.meeting);
          }
          const joinUrlGate = preflightOnlineMeetingJoinUrl(meetingForSubmit);
          if (!joinUrlGate.ok) {
            return jsonResult({
              ok: false,
              action,
              code: joinUrlGate.code,
              error: joinUrlGate.message,
              meeting: meetingForSubmit,
              message: joinUrlGate.message,
            });
          }
          const reissued = reissueMeetingApprovalConfirmation({
            meeting: meetingForSubmit,
            actorUserId: actor.userId,
          });
          if (!reissued.ok) {
            return jsonResult({
              ok: false,
              action,
              code: reissued.code,
              error: reissued.message,
              meeting: meetingForSubmit,
              message: reissued.message,
            });
          }
          return jsonResult({
            ok: true,
            action,
            status: "pending_confirmation",
            meeting: meetingForSubmit,
            proposalId: reissued.confirmation.proposalId,
            expiresAtMs: reissued.confirmation.expiresAtMs,
            recovery: reissued.recovery,
            confirmationDetail: meetingApprovalConfirmationDetail(
              meetingForSubmit,
              reissued.confirmation.expiresAtMs,
            ),
            ...(provision.provisionMeta
              ? { tencentMeetingProvisioned: true, joinUrl: provision.provisionMeta.joinUrl }
              : {}),
            message:
              "Submitted → pending_confirmation. Tell the user the card is ready; do not re-ask create/submit/confirm. Approve only with a user-provided confirmationToken.",
          });
        }
        if (action === "cancel") {
          const bridgeCtx = resolveMeetingTencentMeetingBridgeContext({ actor, agentId });
          const meetings = await readOrganizerMeetings(actor.userId);
          const existing = meetings.find((entry) => entry.id === id);
          if (existing) {
            await maybeCancelTencentMeetingForMeeting({ meeting: existing, ctx: bridgeCtx });
          }
        }
        return jsonResult({
          ok: true,
          action,
          meeting: result.meeting,
          scheduledCount: result.scheduledCount,
        });
      } catch (error) {
        if (error instanceof MeetingTransitionError) {
          throw new ToolInputError(error.message);
        }
        throw error;
      }
    },
  };
}
