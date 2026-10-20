import { describe, expect, it } from "vitest";
import {
  countSignals,
  emptyTaskSignals,
  NON_LEDGER_WORK_TYPES,
  requiresAuthorization,
  workTypeForQualification,
} from "./types.js";

describe("conversation-task type helpers", () => {
  it("empty signals are all false", () => {
    const s = emptyTaskSignals();
    expect(countSignals(s)).toBe(0);
    expect(Object.values(s).every((v) => !v)).toBe(true);
  });

  it("counts set signals", () => {
    expect(
      countSignals({ ...emptyTaskSignals(), hasFutureIntent: true, hasDeliverable: true }),
    ).toBe(2);
  });

  it("maps qualification kinds to work types", () => {
    expect(workTypeForQualification("chat")).toBe("l0_chat");
    expect(workTypeForQualification("short_action")).toBe("l1_short_action");
    expect(workTypeForQualification("reminder")).toBe("reminder");
    expect(workTypeForQualification("scheduled_action")).toBe("scheduled_action");
    expect(workTypeForQualification("long_running_candidate")).toBe("l2_long_running");
    expect(workTypeForQualification("needs_clarification")).toBeUndefined();
  });

  it("only l2 is excluded from the non-ledger work types", () => {
    expect(NON_LEDGER_WORK_TYPES).not.toContain("l2_long_running");
    expect(NON_LEDGER_WORK_TYPES).toContain("reminder");
    expect(NON_LEDGER_WORK_TYPES).toContain("scheduled_action");
  });

  it("requires authorization for any non-none side effect", () => {
    expect(requiresAuthorization("none")).toBe(false);
    expect(requiresAuthorization("outbound_message")).toBe(true);
    expect(requiresAuthorization("external_write")).toBe(true);
    expect(requiresAuthorization("broadcast")).toBe(true);
  });
});
