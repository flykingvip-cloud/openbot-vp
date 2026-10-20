// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { ContributionPerformanceItem } from "../capability/enterprise-capability/types.ts";
import {
  buildEnterpriseContributorLeaderboardSections,
  buildPlatformEnterpriseLeaderboardSections,
  scoreEnterpriseContributor,
  scoreEnterpriseIterationContributor,
} from "./asset-incubation-leaderboards-vm.ts";

function contributor(
  overrides: Partial<ContributionPerformanceItem> = {},
): ContributionPerformanceItem {
  return {
    employeeId: overrides.employeeId ?? "emp-1",
    employeeName: overrides.employeeName ?? "张三",
    department: overrides.department ?? "销售部",
    totalContributions: overrides.totalContributions ?? 10,
    approvedCount: overrides.approvedCount ?? 8,
    approvalRate: overrides.approvalRate ?? 80,
    averageMaturityLevel: overrides.averageMaturityLevel ?? 4,
    totalReuseRobots: overrides.totalReuseRobots ?? 6,
    totalReuseEmployees: overrides.totalReuseEmployees ?? 20,
    averageSuccessRate: overrides.averageSuccessRate ?? 92,
  };
}

describe("asset incubation leaderboard view model", () => {
  it("scores enterprise contributors and iteration contributors", () => {
    const a = contributor({ totalContributions: 12, approvedCount: 10 });
    const b = contributor({ totalContributions: 6, approvedCount: 4 });

    expect(scoreEnterpriseContributor(a)).toBeGreaterThan(scoreEnterpriseContributor(b));
    expect(scoreEnterpriseIterationContributor(a)).toBeGreaterThan(
      scoreEnterpriseIterationContributor(b),
    );
  });

  it("builds enterprise contributor leaderboard sections", () => {
    const sections = buildEnterpriseContributorLeaderboardSections([
      contributor({ employeeId: "emp-1", employeeName: "张三" }),
      contributor({ employeeId: "emp-2", employeeName: "李四", totalReuseRobots: 20 }),
    ]);

    expect(sections).toHaveLength(2);
    expect(sections[0]?.title).toBe("创作者榜");
    expect(sections[1]?.title).toBe("迭代贡献榜");
    expect(sections[0]?.entries.length).toBeGreaterThan(0);
  });

  it("builds platform enterprise leaderboard sections", () => {
    const sections = buildPlatformEnterpriseLeaderboardSections({
      enterprises: [
        { tenantId: "ent-1", label: "华东运营中心", status: "paid" },
        { tenantId: "ent-2", label: "华南客服中心", status: "trial" },
      ],
      installedCapabilityCount: 12,
      runtimeHostCount: 3,
      attentionCount: 2,
    });

    expect(sections).toHaveLength(1);
    expect(sections[0]?.entries[0]?.name).toBe("华东运营中心");
    expect(sections[0]?.entries[0]?.highlights[0]).toContain("综合贡献分");
  });
});
