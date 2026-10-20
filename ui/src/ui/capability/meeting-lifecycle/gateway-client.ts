/**
 * Gateway client — meeting lifecycle + human-assignee tasks.
 *
 * Strongly-typed wrapper over the `meeting.*` / `task.*` RPCs (Phase B/C). Mirrors
 * the cost-budget-billing `createCostBudgetGateway` pattern: each method delegates to
 * `client.request<Resp>(endpoint, params)`. No view/state logic lives here.
 */

import type { GatewayBrowserClient } from "../../gateway.ts";
import {
  MEETING_LIFECYCLE_ENDPOINTS,
  type MeetingAckResponse,
  type MeetingApproveRequest,
  type MeetingApproveResponse,
  type MeetingCreateRequest,
  type MeetingGenerateMinutesRequest,
  type MeetingGenerateMinutesResponse,
  type MeetingListResponse,
  type MeetingMinuteRequest,
  type MeetingReplayScheduleResponse,
  type MeetingResponse,
  type MeetingTransitionResponse,
  type TaskListResponse,
  type TaskMutateRequest,
  type TaskResponse,
} from "./endpoints.ts";

export function createMeetingLifecycleGateway(client: GatewayBrowserClient) {
  return {
    // ── Meeting lifecycle ──────────────────────────────────────────────────
    createMeeting(req: MeetingCreateRequest): Promise<MeetingResponse> {
      return client.request<MeetingResponse>(MEETING_LIFECYCLE_ENDPOINTS.meetingCreate, req);
    },
    submitMeeting(id: string): Promise<MeetingTransitionResponse> {
      return client.request<MeetingTransitionResponse>(MEETING_LIFECYCLE_ENDPOINTS.meetingSubmit, {
        id,
      });
    },
    approveMeeting(
      id: string,
      opts?: Omit<MeetingApproveRequest, "id">,
    ): Promise<MeetingApproveResponse> {
      return client.request<MeetingApproveResponse>(MEETING_LIFECYCLE_ENDPOINTS.meetingApprove, {
        id,
        ...(opts?.proposalId ? { proposalId: opts.proposalId } : {}),
        ...(opts?.confirmationToken ? { confirmationToken: opts.confirmationToken } : {}),
        ...(opts?.dismissConfirmation ? { dismissConfirmation: true } : {}),
      });
    },
    replayMeetingSchedule(id: string): Promise<MeetingReplayScheduleResponse> {
      return client.request<MeetingReplayScheduleResponse>(
        MEETING_LIFECYCLE_ENDPOINTS.meetingReplaySchedule,
        { id },
      );
    },
    startMeeting(id: string): Promise<MeetingTransitionResponse> {
      return client.request<MeetingTransitionResponse>(MEETING_LIFECYCLE_ENDPOINTS.meetingStart, {
        id,
      });
    },
    /** Attaches a validated minutes draft (in_progress -> minuted). */
    minuteMeeting(req: MeetingMinuteRequest): Promise<MeetingResponse> {
      return client.request<MeetingResponse>(MEETING_LIFECYCLE_ENDPOINTS.meetingMinute, req);
    },
    /** Confirms distribution (minuted -> distributed); fans out per-attendee tasks. */
    distributeMeeting(id: string): Promise<MeetingTransitionResponse> {
      return client.request<MeetingTransitionResponse>(
        MEETING_LIFECYCLE_ENDPOINTS.meetingDistribute,
        { id },
      );
    },
    /**
     * Asks the minutes producer for a draft. Does not attach or distribute it.
     * `status: "unavailable"` means the model runner is not configured.
     */
    generateMeetingMinutes(
      req: MeetingGenerateMinutesRequest,
    ): Promise<MeetingGenerateMinutesResponse> {
      return client.request<MeetingGenerateMinutesResponse>(
        MEETING_LIFECYCLE_ENDPOINTS.meetingGenerateMinutes,
        {
          transcript: req.transcript,
          ...(req.meetingId ? { meetingId: req.meetingId } : {}),
          ...(req.meetingTitle ? { meetingTitle: req.meetingTitle } : {}),
          ...(req.attendeeUserIds && req.attendeeUserIds.length > 0
            ? { attendeeUserIds: req.attendeeUserIds }
            : {}),
        },
      );
    },
    cancelMeeting(id: string): Promise<MeetingTransitionResponse> {
      return client.request<MeetingTransitionResponse>(MEETING_LIFECYCLE_ENDPOINTS.meetingCancel, {
        id,
      });
    },
    listMeetings(): Promise<MeetingListResponse> {
      return client.request<MeetingListResponse>(MEETING_LIFECYCLE_ENDPOINTS.meetingList, {});
    },
    ackMeeting(id: string): Promise<MeetingAckResponse> {
      return client.request<MeetingAckResponse>(MEETING_LIFECYCLE_ENDPOINTS.meetingAck, { id });
    },
    declineMeeting(id: string): Promise<MeetingAckResponse> {
      return client.request<MeetingAckResponse>(MEETING_LIFECYCLE_ENDPOINTS.meetingDecline, {
        id,
      });
    },
    // ── Human-assignee tasks ───────────────────────────────────────────────
    acceptTask(req: TaskMutateRequest): Promise<TaskResponse> {
      return client.request<TaskResponse>(MEETING_LIFECYCLE_ENDPOINTS.taskAccept, req);
    },
    completeTask(req: TaskMutateRequest): Promise<TaskResponse> {
      return client.request<TaskResponse>(MEETING_LIFECYCLE_ENDPOINTS.taskComplete, req);
    },
    listTasks(organizationId?: string): Promise<TaskListResponse> {
      return client.request<TaskListResponse>(
        MEETING_LIFECYCLE_ENDPOINTS.taskList,
        organizationId ? { organizationId } : {},
      );
    },
  };
}

export type MeetingLifecycleGateway = ReturnType<typeof createMeetingLifecycleGateway>;
