import { describe, expect, it } from "vitest";
import { resolveBrowserConfig, resolveProfile } from "../config.js";
import { ACCOUNT_COMPUTER_SNAPSHOT_MAX_CHARS } from "../constants.js";
import { resolveSnapshotPlan } from "./agent.snapshot.plan.js";

describe("resolveSnapshotPlan", () => {
  it("defaults chrome extension relay snapshots to aria when format is omitted", () => {
    const resolved = resolveBrowserConfig({});
    const profile = resolveProfile(resolved, "chrome");
    expect(profile).toBeTruthy();

    const plan = resolveSnapshotPlan({
      profile: profile as NonNullable<typeof profile>,
      query: {},
      hasPlaywright: true,
    });

    expect(plan.format).toBe("aria");
  });

  it("keeps ai snapshots for managed browsers when Playwright is available", () => {
    const resolved = resolveBrowserConfig({});
    const profile = resolveProfile(resolved, "openclaw");
    expect(profile).toBeTruthy();

    const plan = resolveSnapshotPlan({
      profile: profile as NonNullable<typeof profile>,
      query: {},
      hasPlaywright: true,
    });

    expect(plan.format).toBe("ai");
  });

  it("defaults Account Computer snapshots to 12000 chars and keeps an explicit maxChars", () => {
    const resolved = resolveBrowserConfig({});
    const profile = resolveProfile(resolved, "openclaw");
    expect(profile).toBeTruthy();

    const plan = resolveSnapshotPlan({
      profile: profile as NonNullable<typeof profile>,
      query: {},
      hasPlaywright: true,
      accountComputerWorkArea: true,
    });
    expect(plan.resolvedMaxChars).toBe(ACCOUNT_COMPUTER_SNAPSHOT_MAX_CHARS);

    const explicit = resolveSnapshotPlan({
      profile: profile as NonNullable<typeof profile>,
      query: { maxChars: "5000" },
      hasPlaywright: true,
      accountComputerWorkArea: true,
    });
    expect(explicit.resolvedMaxChars).toBe(5000);
  });
});
