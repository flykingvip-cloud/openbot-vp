import { describe, expect, it } from "vitest";
import {
  CONVERSATION_TASK_ENV,
  SHADOW_ALLOWED_FLAGS,
  SHADOW_FORBIDDEN_FLAGS,
  isConversationTaskFlagEnabled,
  isShadowModeOnly,
  readConversationTaskFlags,
} from "./feature.js";

describe("conversation-task feature gates", () => {
  it("is off by default for every flag", () => {
    const flags = readConversationTaskFlags({});
    expect(flags).toEqual({
      detection: false,
      qualification: false,
      activation: false,
      projection: false,
      authorization: false,
    });
  });

  it("enables via truthy env values only", () => {
    for (const value of ["1", "true", "TRUE", "yes", "on"]) {
      expect(
        isConversationTaskFlagEnabled("detection", { [CONVERSATION_TASK_ENV.detection]: value }),
      ).toBe(true);
    }
    for (const value of ["0", "", "false", "off", "no"]) {
      expect(
        isConversationTaskFlagEnabled("detection", { [CONVERSATION_TASK_ENV.detection]: value }),
      ).toBe(false);
    }
  });

  it("classifies shadow-allowed vs forbidden flags", () => {
    expect(SHADOW_ALLOWED_FLAGS).toEqual(["detection", "qualification"]);
    expect(SHADOW_FORBIDDEN_FLAGS).toEqual(["activation", "projection", "authorization"]);
  });

  it("treats detection+qualification as a legal shadow config", () => {
    expect(
      isShadowModeOnly({
        detection: true,
        qualification: true,
        activation: false,
        projection: false,
        authorization: false,
      }),
    ).toBe(true);
  });

  it("rejects any forbidden flag as non-shadow", () => {
    for (const flag of SHADOW_FORBIDDEN_FLAGS) {
      const flags = readConversationTaskFlags({ [CONVERSATION_TASK_ENV[flag]]: "1" });
      expect(isShadowModeOnly(flags)).toBe(false);
    }
  });
});
