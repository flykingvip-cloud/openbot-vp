/**
 * Meeting notices for digital humans land in agent:<id>:main.
 * A display name that matches neither an owned agent nor a platform user id
 * is failed, so a workbench signal to that string is not counted as sent.
 */
import { BUILTIN_STEWARD_NAME } from "../agents/builtin-steward/identity.js";
import {
  defaultConversationSessionKey,
  dispatchConversationHandoff,
} from "../conversation-task/conversation-handoff.js";
import {
  inferMeetingRecipientKind,
  type Meeting,
  type MeetingRecipientKind,
} from "./meeting-store.js";

const PLATFORM_USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_ID = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Opaque collab ids such as user-2. Display names (spaces, CJK) do not match. */
const OPAQUE_RECIPIENT_ID = /^[a-z0-9][a-z0-9._:-]{0,80}$/i;

export type MeetingNoticePeer = {
  agentId: string;
  displayName: string;
  sessionKey: string;
};

export type MeetingNoticeRoute =
  | { route: "conversation"; agentId: string; sessionKey: string }
  | { route: "workbench" }
  | { route: "failed"; error: string };

export type MeetingNoticeSendInput = {
  meeting: Meeting;
  attendeeId: string;
  agentId: string;
  sessionKey: string;
  notice: string;
  sessionExists?: (agentId: string, sessionKey: string) => boolean;
};

export type MeetingNoticeSend = (
  input: MeetingNoticeSendInput,
) => Promise<{ ok: true } | { ok: false; error: string }>;

const UNMATCHED_ATTENDEE_ERROR = "找不到这位参会人的会话";

export function isWorkbenchHumanRecipientId(userId: string): boolean {
  const id = userId.trim();
  if (!id) {
    return false;
  }
  return PLATFORM_USER_ID.test(id) || EMAIL_ID.test(id) || OPAQUE_RECIPIENT_ID.test(id);
}

export function buildMeetingAttendeeNotice(
  meeting: Pick<
    Meeting,
    | "title"
    | "startAtMs"
    | "endAtMs"
    | "timezone"
    | "location"
    | "joinUrl"
    | "externalMeetingCode"
    | "agenda"
  >,
): string {
  const title = meeting.title.trim() || "会议";
  const timezone = meeting.timezone.trim() || "UTC";
  const start = formatMeetingClock(meeting.startAtMs, timezone);
  const end = meeting.endAtMs !== undefined ? formatMeetingClock(meeting.endAtMs, timezone) : "";
  const when = end ? `${start}–${end}（${timezone}）` : `${start}（${timezone}）`;
  const lines = [`会议通知：${title}`, `时间：${when}`];
  const location = meeting.location?.trim();
  if (location) {
    lines.push(`地点：${location}`);
  }
  const joinUrl = meeting.joinUrl?.trim();
  if (joinUrl) {
    lines.push(`链接：${joinUrl}`);
  }
  const meetingCode = meeting.externalMeetingCode?.trim();
  if (meetingCode) {
    lines.push(`会议号：${meetingCode}`);
  }
  const agenda = (meeting.agenda ?? []).map((item) => item.trim()).filter(Boolean);
  if (agenda.length > 0) {
    lines.push("议程：", ...agenda.map((item) => `- ${item}`));
  }
  return lines.join("\n");
}

export function planMeetingNoticeRoute(input: {
  recipientId: string;
  kind: MeetingRecipientKind;
  peers: readonly MeetingNoticePeer[];
}): MeetingNoticeRoute {
  const recipientId = input.recipientId.trim();
  const peer = resolveExactMeetingPeer(recipientId, input.peers);
  if (peer) {
    return {
      route: "conversation",
      agentId: peer.agentId,
      sessionKey: peer.sessionKey || defaultConversationSessionKey(peer.agentId),
    };
  }
  const kind =
    input.kind === "agent" || inferMeetingRecipientKind(recipientId) === "agent"
      ? "agent"
      : "human";
  if (kind === "agent") {
    return {
      route: "conversation",
      agentId: recipientId,
      sessionKey: defaultConversationSessionKey(recipientId),
    };
  }
  if (isWorkbenchHumanRecipientId(recipientId)) {
    return { route: "workbench" };
  }
  return { route: "failed", error: UNMATCHED_ATTENDEE_ERROR };
}

export function meetingRecipientSelected(
  recipientId: string,
  only: ReadonlySet<string> | undefined,
): boolean {
  if (!only) {
    return true;
  }
  if (only.has(recipientId)) {
    return true;
  }
  const key = recipientId.trim().toLowerCase();
  for (const id of only) {
    if (id.trim().toLowerCase() === key) {
      return true;
    }
  }
  return false;
}

export async function defaultMeetingNoticeSend(
  input: MeetingNoticeSendInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await dispatchConversationHandoff({
    title: input.meeting.title.trim() || "会议通知",
    message: input.notice,
    targetAgentId: input.agentId,
    requesterUserId: input.meeting.organizerUserId,
    tenantId: input.meeting.tenantId?.trim() || null,
    tenantAdmin: false,
    fromDisplayName: BUILTIN_STEWARD_NAME,
    waitForReply: false,
    ...(input.sessionExists ? { sessionExists: input.sessionExists } : {}),
  });
  if (!result.ok) {
    return { ok: false, error: result.reason };
  }
  return { ok: true };
}

function resolveExactMeetingPeer(
  token: string,
  peers: readonly MeetingNoticePeer[],
): MeetingNoticePeer | undefined {
  const needle = normalizeMeetingPeerToken(token);
  if (!needle) {
    return undefined;
  }
  const exact = peers.filter((peer) =>
    [peer.agentId, peer.displayName, peer.sessionKey].some(
      (value) => normalizeMeetingPeerToken(value) === needle,
    ),
  );
  return exact.length === 1 ? exact[0] : undefined;
}

function normalizeMeetingPeerToken(value: string): string {
  return value.trim().toLowerCase().replaceAll(/\s+/g, "");
}

function formatMeetingClock(ms: number, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      timeZone,
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date(ms));
  } catch {
    return new Intl.DateTimeFormat("zh-CN", {
      timeZone: "UTC",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date(ms));
  }
}
