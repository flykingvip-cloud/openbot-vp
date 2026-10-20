import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tmpDir = path.join(os.tmpdir(), `openbot-asset-digest-${Date.now()}`);

vi.mock("../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils.js")>();
  return {
    ...actual,
    CONFIG_DIR: tmpDir,
  };
});

vi.mock("../skill-lifecycle-store.js", () => ({
  listPersonalSkillAssets: () => [],
}));

const { buildWeeklyDigest, weekStartMs } = await import("./asset-incubation-digest.js");
const { appendSessionEvent } = await import("./asset-incubation-session-store.js");
const { recordAdminRecommendForCapability } = await import("./asset-incubation-adoption-store.js");

function cleanStore(): void {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
}

describe("asset-incubation-digest", () => {
  beforeEach(() => {
    cleanStore();
  });

  afterEach(() => {
    cleanStore();
  });

  it("includes admin_recommend entries in weekly digest", () => {
    recordAdminRecommendForCapability({
      capabilityId: "cap-admin",
      ownerKey: "platform",
      recommenderId: "reviewer",
    });

    const digest = buildWeeklyDigest({ ownerKey: "user-a" });
    expect(digest.entries.some((entry) => entry.kind === "admin_recommend")).toBe(true);
  });

  it("uses monday-based week key", () => {
    const monday = new Date("2026-06-15T12:00:00");
    expect(weekStartMs(monday.getTime())).toBe(new Date("2026-06-15T00:00:00").getTime());
  });

  it("merges review clusters into digest entries", () => {
    const now = Date.now();
    for (let index = 0; index < 3; index += 1) {
      appendSessionEvent({
        id: `evt-${index}`,
        ownerKey: "user-a",
        sessionKey: "agent:main:main",
        contextId: `ctx-${index}`,
        clusterId: "weekly-cluster",
        intentKey: "weekly-cluster",
        label: "周报生成",
        suggestedAssetType: "template",
        occurredAt: now - index,
      });
    }

    const digest = buildWeeklyDigest({ ownerKey: "user-a", minRecurrence: 3 });
    expect(digest.entries.some((entry) => entry.kind === "review")).toBe(true);
    expect(digest.headline).toContain("1");
  });
});
