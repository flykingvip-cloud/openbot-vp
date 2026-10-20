import { describe, expect, it } from "vitest";
import {
  isCronHeartbeatNoOpBody,
  replaceHeartbeatAckForOrdinaryReminder,
  visibleReminderReplyForOrdinaryCron,
} from "./reminder-reply.js";

describe("ordinary cron reminder replies", () => {
  it("turns HEARTBEAT_OK for 提醒我喝水 into a visible reminder", () => {
    expect(isCronHeartbeatNoOpBody("提醒我喝水")).toBe(false);
    expect(visibleReminderReplyForOrdinaryCron("提醒我喝水")).toBe("提醒：喝水");
    const next = replaceHeartbeatAckForOrdinaryReminder([{ text: "HEARTBEAT_OK" }], "提醒我喝水");
    expect(next).toEqual([{ text: "提醒：喝水" }]);
    expect(JSON.stringify(next)).not.toContain("HEARTBEAT_OK");
  });

  it("keeps HEARTBEAT_OK for a real heartbeat body", () => {
    const body = "Read HEARTBEAT.md if it exists and reply HEARTBEAT_OK when nothing is due";
    expect(isCronHeartbeatNoOpBody(body)).toBe(true);
    expect(visibleReminderReplyForOrdinaryCron(body)).toBeNull();
    expect(replaceHeartbeatAckForOrdinaryReminder([{ text: "HEARTBEAT_OK" }], body)).toEqual([
      { text: "HEARTBEAT_OK" },
    ]);
  });

  it("does not rewrite a long-horizon goal plus acceptance", () => {
    const body = ["目标：把 example.com 的标题写入文件", "验收：文件内容包含 Example Domain"].join(
      "\n",
    );
    expect(visibleReminderReplyForOrdinaryCron(body)).toBeNull();
    expect(replaceHeartbeatAckForOrdinaryReminder([{ text: "HEARTBEAT_OK" }], body)).toEqual([
      { text: "HEARTBEAT_OK" },
    ]);
  });

  it("does not treat a greeting as a reminder", () => {
    expect(visibleReminderReplyForOrdinaryCron("hello")).toBeNull();
    expect(replaceHeartbeatAckForOrdinaryReminder([{ text: "HEARTBEAT_OK" }], "hello")).toEqual([
      { text: "HEARTBEAT_OK" },
    ]);
  });
});
