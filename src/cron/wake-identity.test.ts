import { describe, expect, it } from "vitest";
import {
  cronWakeIncomingTaskId,
  normalizeConversationTaskIdRef,
  resolveCronLedgerTaskId,
  resolveCronWakeRef,
} from "./wake-identity.js";

describe("cron wake identity (P7 EA-B4)", () => {
  it("treats an unbound job id as a wake key, not ConversationTask identity", () => {
    expect(resolveCronWakeRef({ id: "2b9de6b0" })).toEqual({
      kind: "wake_key",
      wakeKey: "cron:2b9de6b0",
      jobId: "2b9de6b0",
    });
    expect(cronWakeIncomingTaskId({ id: "2b9de6b0" })).toBe("cron:2b9de6b0");
    expect(resolveCronLedgerTaskId({ id: "2b9de6b0" })).toBe("2b9de6b0");
  });

  it("uses an explicit ConversationTask reference when present", () => {
    const job = { id: "2b9de6b0", conversationTaskId: "ct-market-1" };
    expect(resolveCronWakeRef(job)).toEqual({
      kind: "conversation_task",
      taskId: "ct-market-1",
    });
    expect(cronWakeIncomingTaskId(job)).toBe("ct-market-1");
    expect(resolveCronLedgerTaskId(job)).toBe("ct-market-1");
  });

  it("refuses session or cron keys as conversationTaskId", () => {
    expect(normalizeConversationTaskIdRef("agent:bot-2:main")).toBeNull();
    expect(normalizeConversationTaskIdRef("cron:2b9de6b0")).toBeNull();
    expect(normalizeConversationTaskIdRef("session:abc")).toBeNull();
    expect(normalizeConversationTaskIdRef("  ct-ok  ")).toBe("ct-ok");
  });
});
