import { describe, expect, it } from "vitest";
import {
  resolveSubscriptionContractReminder,
  subscriptionContractLifecycleLabel,
} from "./subscription-contract-reminder.ts";

describe("subscription contract reminder", () => {
  const now = Date.parse("2026-07-25T01:00:00.000Z");

  it("marks paid contracts within 7 days as expiring", () => {
    const reminder = resolveSubscriptionContractReminder("2026-07-28T00:00:00.000Z", now);
    expect(reminder.kind).toBe("expiring");
    expect(reminder.days).toBe(3);
  });

  it("marks past contractEnd as expired without implying suspend", () => {
    const reminder = resolveSubscriptionContractReminder("2026-07-22T05:33:21.511Z", now);
    expect(reminder.kind).toBe("expired");
    expect(reminder.days).toBeLessThan(0);
    expect(
      subscriptionContractLifecycleLabel({
        status: "paid",
        trialDays: null,
        contractDays: reminder.days,
        contractReminder: reminder.kind,
      }),
    ).toContain("合同已到期");
  });

  it("keeps distant contracts quiet", () => {
    expect(resolveSubscriptionContractReminder("2026-09-01T00:00:00.000Z", now).kind).toBe("none");
  });
});
