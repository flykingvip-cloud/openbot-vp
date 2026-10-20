import { describe, expect, it } from "vitest";
import {
  isOnlineMeeting,
  parseMeetingMode,
  preflightOnlineMeetingJoinUrl,
  resolveMeetingMode,
} from "./meeting-mode.js";

describe("meetingMode resolution", () => {
  it("prefers explicit meetingMode over location regex", () => {
    expect(resolveMeetingMode({ meetingMode: "offline", location: "线上" })).toBe("offline");
    expect(resolveMeetingMode({ meetingMode: "online", location: "3F-A" })).toBe("online");
    expect(isOnlineMeeting({ meetingMode: "offline", location: "腾讯会议" })).toBe(false);
  });

  it("falls back to legacy location regex when meetingMode omitted", () => {
    expect(resolveMeetingMode({ location: "线上腾讯会议" })).toBe("online");
    expect(resolveMeetingMode({ location: "3F-会议室A" })).toBeUndefined();
    expect(isOnlineMeeting({ location: "remote standup" })).toBe(true);
  });

  it("parses meetingMode strings", () => {
    expect(parseMeetingMode("online")).toBe("online");
    expect(parseMeetingMode(" offline ")).toBe("offline");
    expect(parseMeetingMode("hybrid")).toBeUndefined();
  });
});

describe("preflightOnlineMeetingJoinUrl", () => {
  it("allows offline / legacy non-online without joinUrl", () => {
    expect(preflightOnlineMeetingJoinUrl({ meetingMode: "offline" }).ok).toBe(true);
    expect(preflightOnlineMeetingJoinUrl({ location: "3F-A" }).ok).toBe(true);
  });

  it("allows online when joinUrl is present", () => {
    expect(
      preflightOnlineMeetingJoinUrl({
        meetingMode: "online",
        joinUrl: "https://meeting.tencent.com/dm/x",
      }).ok,
    ).toBe(true);
  });

  it("returns provision_required for online without joinUrl (no provision attempt)", () => {
    const result = preflightOnlineMeetingJoinUrl({ meetingMode: "online" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("provision_required");
      expect(result.message).toMatch(/入会链接/);
    }
  });

  it("returns provision_failed when provision execution failed", () => {
    const result = preflightOnlineMeetingJoinUrl(
      { location: "线上" },
      { provisionReason: "execution_failed", provisionDetail: "upstream 500" },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("provision_failed");
      expect(result.message).toContain("upstream 500");
    }
  });

  it("maps no_identity / no_context to provision_required", () => {
    const a = preflightOnlineMeetingJoinUrl(
      { meetingMode: "online" },
      { provisionReason: "no_identity" },
    );
    const b = preflightOnlineMeetingJoinUrl(
      { meetingMode: "online" },
      { provisionReason: "no_context" },
    );
    expect(!a.ok && a.code).toBe("provision_required");
    expect(!b.ok && b.code).toBe("provision_required");
  });
});
