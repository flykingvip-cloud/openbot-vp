import type { Meeting } from "../../organization/meeting-store.js";
import type { WorkbenchMeetingTodoItem } from "./notices-read-model.js";

/** Organizer-owned meetings that should surface on the employee-home 待办事项 card. */
export function listOrganizerMeetingTodoItems(meetings: Meeting[]): WorkbenchMeetingTodoItem[] {
  return meetings
    .filter((meeting) => meeting.status === "draft" || meeting.status === "pending_approval")
    .map((meeting) => ({
      id: meeting.id,
      title: (meeting.title ?? "").trim(),
      status: meeting.status as "draft" | "pending_approval",
    }))
    .filter((item) => item.title.length > 0);
}

export function countOrganizerMeetingTodoItems(meetings: Meeting[]): number {
  return listOrganizerMeetingTodoItems(meetings).length;
}
