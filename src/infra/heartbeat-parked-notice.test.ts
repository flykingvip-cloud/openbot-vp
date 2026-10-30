import { describe, expect, it } from "vitest";
import { LIVE_SESSION_FOCUS_ID } from "../cron/isolated-agent/main-session-focus.js";
import {
  HEARTBEAT_FOCUS_SKIP_REASON,
  decideHeartbeatMainSessionRun,
  shouldNotifyHeartbeatWakeOnMainSession,
} from "./heartbeat-focus.js";
import {
  HEARTBEAT_PARKED_NOTICE_SENTINEL,
  formatHeartbeatParkedNoticeMessage,
  isHeartbeatParkedNoticeMessage,
  omitHeartbeatParkedNotices,
  resolveHeartbeatCronJobId,
} from "./heartbeat-parked-notice.js";

describe("heartbeat parked notice (P9 / EA-B5)", () => {
  it("notifies only event-driven parks, not idle patrol skips", () => {
    expect(
      shouldNotifyHeartbeatWakeOnMainSession(
        decideHeartbeatMainSessionRun({
          snapshot: { focusTaskId: LIVE_SESSION_FOCUS_ID, parkedTaskIds: [] },
          reason: "interval",
        }),
      ),
    ).toBe(false);
    expect(
      shouldNotifyHeartbeatWakeOnMainSession(
        decideHeartbeatMainSessionRun({
          snapshot: { focusTaskId: LIVE_SESSION_FOCUS_ID, parkedTaskIds: [] },
          reason: "exec-event",
        }),
      ),
    ).toBe(true);
  });

  it("extracts cron job ids from heartbeat wake reasons", () => {
    expect(resolveHeartbeatCronJobId("cron:2b9de6b0")).toBe("2b9de6b0");
    expect(resolveHeartbeatCronJobId("cron:2b9de6b0:failure-alert")).toBe("2b9de6b0");
    expect(resolveHeartbeatCronJobId("exec-event")).toBeUndefined();
  });

  it("formats a projection notice without minting ConversationTask identity", () => {
    const text = formatHeartbeatParkedNoticeMessage({
      reason: "exec-event",
      parkReason: "park",
      synopsis: "exec finished: npm test",
    });
    expect(text).toContain(HEARTBEAT_PARKED_NOTICE_SENTINEL);
    expect(text).toContain("后台结果");
    expect(text).toContain("exec finished: npm test");
    expect(text).toContain("exec-event");
  });

  it("names the dropped parked task when the fourth heartbeat park replaces it", () => {
    const text = formatHeartbeatParkedNoticeMessage({
      reason: "exec-event",
      parkReason: "park",
      droppedTitle: "最早的报告",
      droppedTaskId: "p1",
      droppedPaths: ["/tmp/oldest.md"],
    });
    expect(text).toContain("已归档最早挂起的「最早的报告」");
    expect(text).toContain("/tmp/oldest.md");
    expect(text).not.toContain("挂起已满");
  });

  it("omits parked notices from agent history", () => {
    const notice = formatHeartbeatParkedNoticeMessage({
      reason: "exec-event",
      parkReason: "park",
    });
    const kept = omitHeartbeatParkedNotices([
      { role: "user", content: [{ type: "text", text: "继续调研" }] },
      { role: "assistant", content: [{ type: "text", text: notice }] },
      { role: "assistant", content: [{ type: "text", text: "先拆子问题。" }] },
    ]);
    expect(kept).toHaveLength(2);
    expect(kept[0]).toMatchObject({ role: "user" });
    expect(kept[1]).toMatchObject({ role: "assistant" });
    expect(isHeartbeatParkedNoticeMessage(kept[1])).toBe(false);
  });

  it("does not treat idle skip as a skip reason other than focus-occupied", () => {
    const decision = decideHeartbeatMainSessionRun({
      snapshot: { focusTaskId: LIVE_SESSION_FOCUS_ID, parkedTaskIds: [] },
      reason: "interval",
    });
    expect(decision.run).toBe(false);
    if (!decision.run) {
      expect(decision.skipReason).toBe(HEARTBEAT_FOCUS_SKIP_REASON);
    }
  });
});
