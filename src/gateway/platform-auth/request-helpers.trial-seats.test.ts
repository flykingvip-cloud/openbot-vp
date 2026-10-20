import { describe, expect, it } from "vitest";
import { toTrialSeats } from "./request-helpers.js";
import {
  createDefaultPolicy,
  DEFAULT_TRIAL_SEATS,
  MAX_CUSTOM_TRIAL_SEATS,
} from "./trial-policy.js";

describe("toTrialSeats", () => {
  it("defaults when value is missing", () => {
    const policy = createDefaultPolicy();
    expect(toTrialSeats(policy, undefined)).toBe(DEFAULT_TRIAL_SEATS);
  });

  it("accepts listed options", () => {
    const policy = createDefaultPolicy();
    expect(toTrialSeats(policy, 10)).toBe(10);
  });

  it("accepts custom counts when allowCustomTrialSeatCount is true", () => {
    const policy = { ...createDefaultPolicy(), allowCustomTrialSeatCount: true };
    expect(toTrialSeats(policy, 500)).toBe(500);
  });

  it("clamps custom counts to MAX_CUSTOM_TRIAL_SEATS", () => {
    const policy = { ...createDefaultPolicy(), allowCustomTrialSeatCount: true };
    expect(toTrialSeats(policy, MAX_CUSTOM_TRIAL_SEATS + 1)).toBe(MAX_CUSTOM_TRIAL_SEATS);
  });

  it("rejects custom counts when allowCustomTrialSeatCount is false", () => {
    const policy = { ...createDefaultPolicy(), allowCustomTrialSeatCount: false };
    expect(toTrialSeats(policy, 500)).toBe(policy.defaultTrialSeatCount);
  });
});
