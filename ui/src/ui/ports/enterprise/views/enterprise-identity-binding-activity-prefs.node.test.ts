import { describe, expect, it } from "vitest";
import {
  countUnreadBindingActivity,
  isBindingActivityUnread,
} from "./enterprise-identity-binding-activity-prefs.ts";

describe("enterprise-identity-binding-activity-prefs", () => {
  it("counts unread activity after seen cursor", () => {
    const activity = [
      { createdAt: "2026-06-06T10:00:00.000Z" },
      { createdAt: "2026-06-06T12:00:00.000Z" },
    ];
    expect(countUnreadBindingActivity(activity, "2026-06-06T11:00:00.000Z")).toBe(1);
    expect(countUnreadBindingActivity(activity, null)).toBe(2);
  });

  it("marks entries unread when seen cursor is missing", () => {
    expect(isBindingActivityUnread("2026-06-06T12:00:00.000Z", null)).toBe(true);
    expect(isBindingActivityUnread("2026-06-06T10:00:00.000Z", "2026-06-06T11:00:00.000Z")).toBe(
      false,
    );
  });
});
