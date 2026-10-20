import { describe, expect, it } from "vitest";
import { createMeeting, transitionMeeting } from "../../organization/meeting-store.js";
import {
  countOrganizerMeetingTodoItems,
  listOrganizerMeetingTodoItems,
} from "./meeting-todo-projection.js";

describe("meeting todo projection", () => {
  it("includes draft and pending_approval meetings", () => {
    const draft = createMeeting({ organizerUserId: "u1", title: "Draft sync", startAtMs: 1 });
    const pending = transitionMeeting(
      createMeeting({ organizerUserId: "u1", title: "Pending sync", startAtMs: 2, id: "m2" }),
      "pending_approval",
    );
    const confirmed = transitionMeeting(
      createMeeting({ organizerUserId: "u1", title: "Done sync", startAtMs: 3, id: "m3" }),
      "pending_approval",
    );
    const confirmed2 = transitionMeeting(confirmed, "confirmed");
    const items = listOrganizerMeetingTodoItems([draft, pending, confirmed2]);
    expect(items).toEqual([
      { id: draft.id, title: "Draft sync", status: "draft" },
      { id: "m2", title: "Pending sync", status: "pending_approval" },
    ]);
    expect(countOrganizerMeetingTodoItems([draft, pending, confirmed2])).toBe(2);
  });
});
