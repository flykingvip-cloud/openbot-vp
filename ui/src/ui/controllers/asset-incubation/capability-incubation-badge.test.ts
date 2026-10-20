import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MyCapabilityListItem } from "../my-accumulation.ts";
import { clearAdoptionStorageForTests, recordLocalAdoption } from "./adoption-sync.ts";
import {
  deriveOrganizationalIncubationBadge,
  organizationalBadgeLabel,
} from "./capability-incubation-badge.ts";

function buildItem(patch: Partial<MyCapabilityListItem> = {}): MyCapabilityListItem {
  return {
    id: "cap-1",
    name: "周报模板",
    summary: "生成周报",
    health: "运行稳定",
    shareVisibility: "私有",
    isDraft: false,
    recentUpdate: { id: "u1", at: Date.now(), headline: "更新" },
    updatedAt: Date.now(),
    sourceRobotName: "助手",
    usageBrief: { robotCount: 0, lastUsedAt: null },
    usageMetrics: {
      totalUsageCount: 0,
      robotCount: 0,
      groupCount: 0,
      lastUsedAt: null,
    },
    versionInfo: {
      currentVersion: "v1",
      versionCount: 1,
      submittedVersion: null,
    },
    ...patch,
  };
}

describe("capability-incubation-badge", () => {
  const storage = new Map<string, string>();

  beforeEach(() => {
    storage.clear();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
    });
  });

  afterEach(() => {
    clearAdoptionStorageForTests();
    vi.unstubAllGlobals();
  });

  it("shows admin badge when local adoption marks admin recommend", () => {
    recordLocalAdoption("cap-admin", { adminRecommended: true });
    const badge = deriveOrganizationalIncubationBadge(
      buildItem({ id: "cap-admin", shareVisibility: "私有" }),
    );
    expect(badge).toBe("admin");
    expect(organizationalBadgeLabel(badge!)).toBe("管理员推荐");
  });

  it("shows L4 badge when content is ready and real adoption + stability evidence meet the bar", () => {
    const badge = deriveOrganizationalIncubationBadge(
      buildItem({
        shareVisibility: "已共享到协作小组",
        incubationReady: true,
        usageBrief: { robotCount: 3, lastUsedAt: Date.now() },
        usageMetrics: {
          totalUsageCount: 5,
          robotCount: 3,
          groupCount: 2,
          lastUsedAt: Date.now(),
        },
        versionInfo: { currentVersion: "v3", versionCount: 3, submittedVersion: null },
      }),
    );
    expect(badge).toBe("L4");
    expect(organizationalBadgeLabel(badge!)).toBe("组织级候选");
  });

  it("withholds the org-level badge when standardized content is not filled yet", () => {
    const badge = deriveOrganizationalIncubationBadge(
      buildItem({
        shareVisibility: "已共享到协作小组",
        incubationReady: false,
        usageBrief: { robotCount: 3, lastUsedAt: Date.now() },
        usageMetrics: {
          totalUsageCount: 5,
          robotCount: 3,
          groupCount: 2,
          lastUsedAt: Date.now(),
        },
        versionInfo: { currentVersion: "v3", versionCount: 3, submittedVersion: null },
      }),
    );
    expect(badge).toBeNull();
  });

  it("does not mint an org-level candidate from sharing alone without stability/usage", () => {
    const badge = deriveOrganizationalIncubationBadge(
      buildItem({
        shareVisibility: "已共享到协作小组",
        incubationReady: true,
        usageBrief: { robotCount: 0, lastUsedAt: null },
        usageMetrics: { totalUsageCount: 0, robotCount: 0, groupCount: 0, lastUsedAt: null },
        versionInfo: { currentVersion: "v1", versionCount: 1, submittedVersion: null },
      }),
    );
    expect(badge).toBeNull();
  });
});
