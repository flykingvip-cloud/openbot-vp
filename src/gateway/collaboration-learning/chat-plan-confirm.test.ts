import { describe, expect, it } from "vitest";
import { parseChatPlanConfirmIntent } from "./chat-plan-confirm.js";

describe("parseChatPlanConfirmIntent", () => {
  it("accepts standalone confirm phrases", () => {
    expect(parseChatPlanConfirmIntent("确认计划").kind).toBe("confirm");
    expect(parseChatPlanConfirmIntent("确认").kind).toBe("confirm");
    expect(parseChatPlanConfirmIntent("confirm plan").kind).toBe("confirm");
  });

  it("rejects mixed or ambiguous chat", () => {
    expect(parseChatPlanConfirmIntent("确认计划，另外把范围改成商业化").kind).toBe("ambiguous");
    expect(parseChatPlanConfirmIntent("你好").kind).toBe("not_confirm");
    expect(parseChatPlanConfirmIntent("拒绝计划").kind).toBe("not_confirm");
  });
});
