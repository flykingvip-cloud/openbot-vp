import { randomUUID } from "node:crypto";
import { readOrganizerMeetings } from "../../organization/meeting-store.js";
import { resolveEmployeeWorkbenchActor } from "../employee-workbench-scope.js";
import { generateInviteDraft } from "../lifecycle/invite-draft-run.js";
import { getLifecycleModelRunner } from "../lifecycle/lifecycle-model-runner.js";
import { generateMeetingMinutes } from "../lifecycle/meeting-minutes-run.js";
import { extractScheduleCandidates } from "../lifecycle/schedule-extraction-run.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { looseRecordOrEmpty as asRecord } from "../records.js";
import type { GatewayRequestHandlers } from "./types.js";

/**
 * Gated LLM producer RPCs (Phase C): invite drafting, meeting minutes, and
 * conversation extraction. Each resolves the employee actor, then runs
 * the corresponding gated producer (commercial gate + per-user usage + C0 validation).
 *
 * The model step is a dormant DI seam (`getLifecycleModelRunner`): when no runner is
 * wired the handler returns `{ status: "unavailable" }` — an honest, non-crashing
 * outcome — rather than fabricating a result. Output is a structured candidate the
 * user reviews/confirms; the LLM never writes the authoritative store directly.
 */

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry) => stringValue(entry)).filter((entry) => entry.length > 0);
}

export const lifecycleProducerHandlers: GatewayRequestHandlers = {
  "meeting.draft-invite": async ({ params, respond, client }) => {
    const actor = await resolveEmployeeWorkbenchActor(client);
    if (!actor) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "no workbench actor"));
      return;
    }
    const record = asRecord(params);
    const meetingTitle = stringValue(record.meetingTitle);
    const context = stringValue(record.context);
    if (!meetingTitle || !context) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "meetingTitle and context are required"),
      );
      return;
    }
    const attendeeUserIds = stringList(record.attendeeUserIds);
    const runModel = getLifecycleModelRunner();
    if (!runModel) {
      respond(true, { status: "unavailable", reason: "model runner not configured" });
      return;
    }
    try {
      const result = await generateInviteDraft(
        {
          runId: randomUUID(),
          organizerUserId: actor.userId,
          ...(actor.tenantId !== undefined ? { enterpriseId: actor.tenantId } : {}),
          meetingTitle,
          context,
          ...(attendeeUserIds.length > 0 ? { attendeeUserIds } : {}),
        },
        { runModel },
      );
      if (result.status === "produced") {
        respond(true, { status: "produced", draft: result.candidate });
        return;
      }
      respond(true, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "failed to draft invite";
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, message));
    }
  },

  "meeting.generate-minutes": async ({ params, respond, client }) => {
    const actor = await resolveEmployeeWorkbenchActor(client);
    if (!actor) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "no workbench actor"));
      return;
    }
    const record = asRecord(params);
    const transcript = stringValue(record.transcript);
    if (!transcript) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "transcript is required"));
      return;
    }
    const meetingId = stringValue(record.meetingId);
    let meetingTitle = stringValue(record.meetingTitle);
    let attendeeUserIds = stringList(record.attendeeUserIds);
    if (meetingId) {
      const meetings = await readOrganizerMeetings(actor.userId);
      const meeting = meetings.find((entry) => entry.id === meetingId);
      if (!meeting) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "meeting not found"));
        return;
      }
      meetingTitle = meeting.title;
      attendeeUserIds = meeting.attendees.map((attendee) => attendee.userId);
    }
    if (!meetingTitle) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "meetingTitle or meetingId is required"),
      );
      return;
    }
    const runModel = getLifecycleModelRunner();
    if (!runModel) {
      respond(true, { status: "unavailable", reason: "model runner not configured" });
      return;
    }
    try {
      const result = await generateMeetingMinutes(
        {
          runId: randomUUID(),
          organizerUserId: actor.userId,
          ...(actor.tenantId !== undefined ? { enterpriseId: actor.tenantId } : {}),
          meetingTitle,
          transcript,
          ...(attendeeUserIds.length > 0 ? { attendeeUserIds } : {}),
        },
        { runModel },
      );
      if (result.status === "produced") {
        respond(true, { status: "produced", draft: result.candidate });
        return;
      }
      respond(true, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "failed to generate minutes";
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, message));
    }
  },

  "schedule.extract": async ({ params, respond, client }) => {
    const actor = await resolveEmployeeWorkbenchActor(client);
    if (!actor) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "no workbench actor"));
      return;
    }
    const record = asRecord(params);
    const conversationText = stringValue(record.conversationText);
    if (!conversationText) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "conversationText is required"),
      );
      return;
    }
    const sourceLabel = stringValue(record.sourceLabel);
    const runModel = getLifecycleModelRunner();
    if (!runModel) {
      respond(true, { status: "unavailable", reason: "model runner not configured" });
      return;
    }
    try {
      const result = await extractScheduleCandidates(
        {
          runId: randomUUID(),
          userId: actor.userId,
          ...(actor.tenantId !== undefined ? { enterpriseId: actor.tenantId } : {}),
          conversationText,
          ...(sourceLabel ? { sourceLabel } : {}),
        },
        { runModel },
      );
      if (result.status === "produced") {
        respond(true, { status: "produced", candidates: result.candidate });
        return;
      }
      respond(true, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "failed to extract schedule";
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, message));
    }
  },
};
