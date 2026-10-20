// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildEnterpriseNotices } from "./enterprise-notices-read-model.js";

describe("enterprise notices read model", () => {
  it("returns an empty result when no signals are present", () => {
    expect(buildEnterpriseNotices({})).toEqual({
      totalCount: 0,
      billingCount: 0,
      channelOfflineCount: 0,
      items: [],
    });
  });

  it("does not alert on a healthy budget / normal allocation", () => {
    const result = buildEnterpriseNotices({
      budget: { level: "ok" },
      overAllocation: { status: "normal" },
    });
    expect(result.totalCount).toBe(0);
    expect(result.items).toEqual([]);
  });

  it("flags budget alert (warning) and exceeded (critical)", () => {
    expect(buildEnterpriseNotices({ budget: { level: "alert" } }).items).toEqual([
      { id: "budget", kind: "budget", severity: "warning", code: "budget-alert" },
    ]);
    expect(buildEnterpriseNotices({ budget: { level: "exceeded" } }).items).toEqual([
      { id: "budget", kind: "budget", severity: "critical", code: "budget-exceeded" },
    ]);
  });

  it("flags over-allocation", () => {
    const result = buildEnterpriseNotices({ overAllocation: { status: "over_allocated" } });
    expect(result.billingCount).toBe(1);
    expect(result.items[0]).toMatchObject({ kind: "over-allocation", code: "over-allocated" });
  });

  it("flags exhausted vs low credits, and ignores credits when no monthly grant", () => {
    expect(
      buildEnterpriseNotices({ credits: { monthlyCredits: 100, creditsRemaining: 0 } }).items[0],
    ).toMatchObject({ code: "credits-exhausted", severity: "critical" });
    expect(
      buildEnterpriseNotices({ credits: { monthlyCredits: 100, creditsRemaining: 5 } }).items[0],
    ).toMatchObject({ code: "credits-low", severity: "warning" });
    // 50% remaining is above the 10% default threshold → no alert.
    expect(
      buildEnterpriseNotices({ credits: { monthlyCredits: 100, creditsRemaining: 50 } }).items,
    ).toEqual([]);
    // No monthly grant → credits never alert.
    expect(
      buildEnterpriseNotices({ credits: { monthlyCredits: 0, creditsRemaining: 0 } }).items,
    ).toEqual([]);
  });

  it("counts offline channels separately from billing and aggregates totals", () => {
    const result = buildEnterpriseNotices({
      budget: { level: "exceeded" },
      overAllocation: { status: "over_allocated" },
      offlineChannels: [
        { channelId: "telegram", accountId: "default", reason: "disconnected" },
        { channelId: "slack", accountId: "default", reason: "not-running" },
      ],
    });
    expect(result.billingCount).toBe(2); // budget + over-allocation
    expect(result.channelOfflineCount).toBe(2);
    expect(result.totalCount).toBe(4);
    expect(result.items.filter((i) => i.kind === "channel-offline")).toHaveLength(2);
    expect(result.items.find((i) => i.id === "channel-offline:slack:default")).toMatchObject({
      severity: "warning",
      code: "channel-offline",
      source: "slack:default",
    });
  });

  it("honours a custom credits-low threshold", () => {
    const result = buildEnterpriseNotices({
      credits: { monthlyCredits: 100, creditsRemaining: 30 },
      creditsLowThreshold: 0.5, // 30% < 50% → low
    });
    expect(result.items[0]).toMatchObject({ code: "credits-low" });
  });
});
