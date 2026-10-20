import { describe, expect, it } from "vitest";
import { validateChatSendParams } from "../index.js";

describe("chat.send focusSwitchProceed", () => {
  it("accepts focusSwitchProceed and growthGateProceed", () => {
    expect(
      validateChatSendParams({
        sessionKey: "agent:bot-2:main",
        message: "请使用 web-research 做一次调研",
        idempotencyKey: "run-focus-switch",
        focusSwitchProceed: true,
        growthGateProceed: true,
      }),
    ).toBe(true);
  });

  it("accepts a steward call authorization id on the same send", () => {
    expect(
      validateChatSendParams({
        sessionKey: "agent:main:employee:employee-1",
        message: "同意",
        idempotencyKey: "run-steward-call",
        stewardCallAuthorizationId: "steward-call-1",
      }),
    ).toBe(true);
  });

  it("accepts focusSwitchCancel as explicit user consent", () => {
    expect(
      validateChatSendParams({
        sessionKey: "agent:bot-2:main",
        message: "请使用 web-research 做一次调研",
        idempotencyKey: "run-focus-cancel",
        focusSwitchCancel: true,
      }),
    ).toBe(true);
  });
});
