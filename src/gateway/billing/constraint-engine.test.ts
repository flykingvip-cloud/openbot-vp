// @vitest-environment node

import { describe, expect, it } from "vitest";
import { DEFAULT_OVERAGE_POLICY } from "../package-entitlement/normalize-entitlement.js";
import {
  checkEntitlementConstraints,
  computeBotQuotaUsage,
  computeConcurrencyUsage,
} from "./constraint-engine.js";

const baseSnapshot = {
  maxBots: 10,
  maxConcurrentRuns: 4,
  monthlyCredits: 1000,
  overagePolicy: DEFAULT_OVERAGE_POLICY,
};

describe("constraint-engine", () => {
  it("computeBotQuotaUsage counts active bots", () => {
    expect(computeBotQuotaUsage(3)).toBe(3);
  });

  it("computeConcurrencyUsage counts active runs", () => {
    expect(computeConcurrencyUsage(2)).toBe(2);
  });

  it("blocks bot create at maxBots", () => {
    const result = checkEntitlementConstraints({
      snapshot: baseSnapshot,
      activeBotCount: 10,
      activeRunCount: 0,
      creditsRemaining: 500,
      botCreateAttempt: true,
      runStartAttempt: false,
      creditsChargeAttempt: false,
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe("BOT_LIMIT_EXCEEDED");
    }
  });

  it("blocks run start at maxConcurrentRuns", () => {
    const result = checkEntitlementConstraints({
      snapshot: baseSnapshot,
      activeBotCount: 1,
      activeRunCount: 4,
      creditsRemaining: 500,
      botCreateAttempt: false,
      runStartAttempt: true,
      creditsChargeAttempt: false,
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe("CONCURRENCY_LIMIT_EXCEEDED");
    }
  });

  it("allows burst concurrency when overagePolicy.allowBurstConcurrency", () => {
    const result = checkEntitlementConstraints({
      snapshot: {
        ...baseSnapshot,
        overagePolicy: { type: "credits_only", allowBurstConcurrency: true },
      },
      activeBotCount: 1,
      activeRunCount: 99,
      creditsRemaining: 500,
      botCreateAttempt: false,
      runStartAttempt: true,
      creditsChargeAttempt: false,
    });
    expect(result.allowed).toBe(true);
  });

  it("blocks credits charge when exhausted under block policy", () => {
    const result = checkEntitlementConstraints({
      snapshot: baseSnapshot,
      activeBotCount: 0,
      activeRunCount: 0,
      creditsRemaining: 2,
      creditsRequired: 5,
      botCreateAttempt: false,
      runStartAttempt: false,
      creditsChargeAttempt: true,
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe("CREDITS_EXHAUSTED");
    }
  });

  it("credits_only denies shortfall (no currency overage)", () => {
    const result = checkEntitlementConstraints({
      snapshot: {
        ...baseSnapshot,
        overagePolicy: { type: "credits_only", allowBurstConcurrency: false },
      },
      activeBotCount: 0,
      activeRunCount: 0,
      creditsRemaining: 0,
      creditsRequired: 1,
      botCreateAttempt: false,
      runStartAttempt: false,
      creditsChargeAttempt: true,
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe("CREDITS_EXHAUSTED");
      expect(result.message).toMatch(/仅 Credits/);
    }
  });

  it("pay_as_you_go allows credits shortfall with overage flag", () => {
    const result = checkEntitlementConstraints({
      snapshot: {
        ...baseSnapshot,
        overagePolicy: { type: "pay_as_you_go", allowBurstConcurrency: false },
      },
      activeBotCount: 0,
      activeRunCount: 0,
      creditsRemaining: 0,
      creditsRequired: 10,
      botCreateAttempt: false,
      runStartAttempt: false,
      creditsChargeAttempt: true,
    });
    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.creditsOverage).toBe(true);
    }
  });

  it("maxBots=0 means unlimited bots", () => {
    const result = checkEntitlementConstraints({
      snapshot: { ...baseSnapshot, maxBots: 0 },
      activeBotCount: 999,
      activeRunCount: 0,
      creditsRemaining: 500,
      botCreateAttempt: true,
      runStartAttempt: false,
      creditsChargeAttempt: false,
    });
    expect(result.allowed).toBe(true);
  });
});
