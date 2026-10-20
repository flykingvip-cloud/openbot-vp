import { describe, expect, it } from "vitest";
import { diagnosisTargetsFromEnterpriseRoster, findDiagnosisTarget } from "./diagnosis-targets.ts";

describe("diagnosisTargetsFromEnterpriseRoster", () => {
  it("always includes 大白管家 and maps agents/groups to live session keys", () => {
    const targets = diagnosisTargetsFromEnterpriseRoster({
      agents: [
        { agentId: "market", name: "市场助手" },
        { agentId: "main", name: "Main" },
      ],
      groups: [{ groupId: "alpha", name: "产品协作" }],
      spaces: [
        {
          id: "space-beta",
          groupId: "beta",
          title: "增长小组",
          coordinatorBotId: "market",
        },
      ],
    });
    expect(targets[0]).toMatchObject({
      id: "agent:main",
      label: "大白管家",
      agentId: "main",
      sessionKey: "agent:main:main",
      steward: true,
    });
    expect(findDiagnosisTarget(targets, "agent:market")).toMatchObject({
      kind: "agent",
      sessionKey: "agent:market:main",
      steward: false,
    });
    expect(findDiagnosisTarget(targets, "group:alpha")).toMatchObject({
      kind: "group",
      agentId: "main",
      sessionKey: "agent:main:space:alpha",
      steward: true,
    });
    expect(findDiagnosisTarget(targets, "group:beta")).toMatchObject({
      kind: "group",
      agentId: "market",
      sessionKey: "agent:market:space:beta",
      steward: false,
    });
    expect(findDiagnosisTarget(targets, "all")).toBeNull();
  });

  it("keeps 大白管家 when the mesh roster is empty", () => {
    const targets = diagnosisTargetsFromEnterpriseRoster();
    expect(targets).toHaveLength(1);
    expect(targets[0]?.label).toBe("大白管家");
  });
});
