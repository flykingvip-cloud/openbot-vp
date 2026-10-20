import { describe, expect, it } from "vitest";
import { CONVERSATION_TASK_ENV } from "../conversation-task/feature.js";
import {
  ORCHESTRATION_ENV,
  isConversationTaskActivationEnabled,
  isDispatchPermitted,
  isOrchestrationDormant,
  isOrchestrationEnabledByFlags,
  isOrchestrationFlagEnabled,
  readOrchestrationFlags,
} from "./feature.js";
import { emptyOrchestrationFlags } from "./types.js";

describe("orchestration feature gates", () => {
  it("is off by default for every flag", () => {
    const flags = readOrchestrationFlags({});
    expect(flags).toEqual({
      shadowEnabled: false,
      dispatchEnabled: false,
      nodeEnabled: false,
      browserEnabled: false,
    });
    expect(isOrchestrationDormant(flags)).toBe(true);
  });

  it("does not reuse CTR flag env names", () => {
    const orchEnvs = Object.values(ORCHESTRATION_ENV);
    const ctrEnvs = Object.values(CONVERSATION_TASK_ENV);
    for (const name of orchEnvs) {
      expect(ctrEnvs).not.toContain(name);
    }
  });

  it("enables via truthy env values only", () => {
    for (const value of ["1", "true", "TRUE", "yes", "on"]) {
      expect(
        isOrchestrationFlagEnabled("shadowEnabled", { [ORCHESTRATION_ENV.shadowEnabled]: value }),
      ).toBe(true);
    }
    for (const value of ["0", "", "false", "off", "no"]) {
      expect(
        isOrchestrationFlagEnabled("shadowEnabled", { [ORCHESTRATION_ENV.shadowEnabled]: value }),
      ).toBe(false);
    }
  });

  it("stays dormant when only node/browser master switches are on", () => {
    const flags = readOrchestrationFlags({
      [ORCHESTRATION_ENV.nodeEnabled]: "1",
      [ORCHESTRATION_ENV.browserEnabled]: "1",
    });
    expect(flags.nodeEnabled).toBe(true);
    expect(flags.browserEnabled).toBe(true);
    expect(isOrchestrationDormant(flags)).toBe(true);
  });

  it("refuses to treat CTR activation as orchestration enable", () => {
    const env = { [CONVERSATION_TASK_ENV.activation]: "1" };
    expect(isConversationTaskActivationEnabled(env)).toBe(true);
    const flags = readOrchestrationFlags(env);
    expect(isOrchestrationDormant(flags)).toBe(true);
    expect(isOrchestrationEnabledByFlags(flags)).toBe(false);
    expect(isDispatchPermitted(flags, { ctrActivationEnabled: true, allowlistEmpty: false })).toBe(
      false,
    );
  });

  it("does not permit dispatch while CTR is shadow-only", () => {
    const flags = {
      ...emptyOrchestrationFlags(),
      shadowEnabled: true,
      dispatchEnabled: true,
    };
    expect(isDispatchPermitted(flags, { ctrActivationEnabled: false, allowlistEmpty: false })).toBe(
      false,
    );
  });

  it("does not permit dispatch when the allowlist is empty", () => {
    const flags = {
      ...emptyOrchestrationFlags(),
      dispatchEnabled: true,
    };
    expect(isDispatchPermitted(flags, { ctrActivationEnabled: true, allowlistEmpty: true })).toBe(
      false,
    );
  });
});
