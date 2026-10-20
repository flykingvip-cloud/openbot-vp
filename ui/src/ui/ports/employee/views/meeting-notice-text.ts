/**
 * Organizer-facing meeting notice. Same facts as the attendee notice, plus
 * the attendee list. The confirmation token never appears here.
 *
 * Online detection prefers explicit `meetingMode`; location regex is legacy
 * compat only (confirmation-card SPEC).
 */

const ONLINE_LOCATION = /线上|远程|腾讯会议|online|remote|virtual|wemeet|tencent/i;

export type OrganizerNoticeMeeting = {
  title?: string;
  startAtMs?: number;
  endAtMs?: number;
  timezone?: string;
  location?: string;
  meetingMode?: "online" | "offline";
  joinUrl?: string;
  externalMeetingCode?: string;
  agenda?: string[];
  attendees?: Array<{ userId: string }>;
};

function isOnlineMeeting(meeting: OrganizerNoticeMeeting): boolean {
  if (meeting.meetingMode === "online") {
    return true;
  }
  if (meeting.meetingMode === "offline") {
    return false;
  }
  return ONLINE_LOCATION.test(meeting.location?.trim() ?? "");
}

/**
 * Defensive client check: online without joinUrl.
 * Main path is server-side preflight (no pending_confirmation). If a pending
 * card somehow still arrives without joinUrl, UI must not render confirm controls.
 */
export function organizerMeetingLinkPending(meeting: OrganizerNoticeMeeting): boolean {
  if (meeting.joinUrl?.trim()) {
    return false;
  }
  return isOnlineMeeting(meeting);
}

export function formatOrganizerMeetingNotice(meeting: OrganizerNoticeMeeting): string {
  const title = meeting.title?.trim() || "会议";
  const lines = [`会议通知：${title}`];
  if (typeof meeting.startAtMs === "number" && Number.isFinite(meeting.startAtMs)) {
    const timezone = meeting.timezone?.trim() || "UTC";
    const start = formatMeetingClock(meeting.startAtMs, timezone);
    const end =
      typeof meeting.endAtMs === "number" && Number.isFinite(meeting.endAtMs)
        ? formatMeetingClock(meeting.endAtMs, timezone)
        : "";
    lines.push(`时间：${end ? `${start}–${end}（${timezone}）` : `${start}（${timezone}）`}`);
  }
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
  const attendees = (meeting.attendees ?? []).map((row) => row.userId.trim()).filter(Boolean);
  if (attendees.length > 0) {
    lines.push(`参会人：${attendees.join("、")}`);
  }
  return lines.join("\n");
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
