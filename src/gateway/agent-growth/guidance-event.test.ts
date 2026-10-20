import { describe, expect, it } from "vitest";
import {
  buildGuidanceIntentKey,
  parseGuidanceEventInput,
  toGuidanceSessionEvent,
} from "./guidance-event.js";

describe("parseGuidanceEventInput", () => {
  it("accepts a completed guidance event", () => {
    const parsed = parseGuidanceEventInput({
      event: "guidance_completed",
      scenario: "wechat_oa_setup",
      contextConfidence: "high",
      stepsCompleted: 9,
      reusablePattern: true,
    });
    expect(parsed?.event).toBe("guidance_completed");
    expect(parsed?.skill).toBe("user-guidance-protocol");
  });

  it("requires stepId and failureReason for step failures", () => {
    expect(
      parseGuidanceEventInput({
        event: "guidance_step_failed",
        scenario: "wechat_oa_setup",
        contextConfidence: "medium",
      }),
    ).toBeNull();
    const ok = parseGuidanceEventInput({
      event: "guidance_step_failed",
      scenario: "wechat_oa_setup",
      stepId: "enter_settings",
      failureReason: "button_missing",
      contextConfidence: "medium",
    });
    expect(ok?.stepId).toBe("enter_settings");
  });

  it("rejects unknown event types", () => {
    expect(
      parseGuidanceEventInput({
        event: "guidance_maybe",
        scenario: "x",
        contextConfidence: "low",
      }),
    ).toBeNull();
  });
});

describe("toGuidanceSessionEvent", () => {
  it("maps into an asset-incubation session event with guidance cluster", () => {
    const record = toGuidanceSessionEvent(
      {
        event: "guidance_completed",
        scenario: "wechat_oa_setup",
        contextConfidence: "high",
        stepsCompleted: 8,
        exceptions: 1,
        reusablePattern: true,
        sessionKey: "agent:main:user",
        occurredAt: 1_700_000_000_000,
      },
      "daniel@example.com",
    );
    expect(record.clusterId).toBe("guidance:wechat_oa_setup");
    expect(record.intentKey).toBe(
      buildGuidanceIntentKey({
        event: "guidance_completed",
        scenario: "wechat_oa_setup",
        contextConfidence: "high",
      }),
    );
    expect(record.suggestedAssetType).toBe("sop");
    expect(record.workflowSignature).toContain("wechat_oa_setup");
    expect(record.ownerKey).toBe("daniel@example.com");
  });

  it("redacts AppSecret-like and api_key text from free-text fields", () => {
    const parsed = parseGuidanceEventInput({
      event: "guidance_step_failed",
      scenario: "wechat_oa_setup",
      stepId: "save_credentials",
      failureReason:
        "api_key=sk-abcdefghijklmnopqrstuvwxyz012345 and secret=abcdef0123456789abcdef0123456789",
      userAction: "pasted abcdef0123456789abcdef0123456789",
      contextConfidence: "low",
    });
    expect(parsed?.failureReason).not.toContain("sk-abcdefghijklmnopqrstuvwxyz012345");
    expect(parsed?.failureReason).not.toMatch(/[a-f0-9]{32}/i);
    expect(parsed?.userAction).toContain("***");
    expect(parsed?.userAction).not.toMatch(/[a-f0-9]{32}/i);
  });
});
