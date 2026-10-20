import { describe, expect, it } from "vitest";
import {
  countEmployeeWorkbenchNavAgents,
  countEmployeeWorkbenchOwnedSpaces,
  EMPLOYEE_WORKBENCH_AGENT_NAV_LIMIT,
  EMPLOYEE_WORKBENCH_COLLABORATION_SPACE_NAV_LIMIT,
  isEmployeeWorkbenchQuotaExemptAgentId,
  resolveEmployeeWorkbenchNavQuota,
} from "./employee-workbench-nav-quota.ts";

describe("employee-workbench-nav-quota", () => {
  it("excludes the builtin steward and daibai nav seed from the nav agent count", () => {
    expect(isEmployeeWorkbenchQuotaExemptAgentId("main")).toBe(true);
    expect(isEmployeeWorkbenchQuotaExemptAgentId("daibai")).toBe(true);
    expect(
      countEmployeeWorkbenchNavAgents([
        { id: "main" },
        { id: "daibai" },
        { id: "bot-a" },
        { id: "bot-b" },
      ]),
    ).toBe(2);
  });

  it("caps creatable assistants at 4 excluding steward", () => {
    expect(EMPLOYEE_WORKBENCH_AGENT_NAV_LIMIT).toBe(4);
    const atAgentLimit = resolveEmployeeWorkbenchNavQuota({
      agents: [
        { id: "main" },
        ...Array.from({ length: EMPLOYEE_WORKBENCH_AGENT_NAV_LIMIT }, (_, i) => ({
          id: `bot-${i}`,
        })),
      ],
      spaces: [],
      actorIdentities: new Set(["me@example.com"]),
    });
    expect(atAgentLimit.agentCount).toBe(4);
    expect(atAgentLimit.canAddAgent).toBe(false);
    expect(atAgentLimit.canAddSpace).toBe(true);
  });

  it("counts only actor-owned spaces toward the create quota", () => {
    const actorIdentities = new Set(["me@example.com", "user-me"]);
    const spaces = [
      { ownerUserId: "me@example.com" },
      { ownerUserId: "me@example.com" },
      { ownerUserId: "peer@example.com" },
      { ownerUserId: "other@example.com" },
      { ownerUserId: "someone@example.com" },
      { ownerUserId: "another@example.com" },
    ];
    expect(countEmployeeWorkbenchOwnedSpaces(spaces, actorIdentities)).toBe(2);

    const underOwnedCap = resolveEmployeeWorkbenchNavQuota({
      agents: [{ id: "main" }],
      spaces,
      actorIdentities,
    });
    // 2 owned + many joined — still under the create cap of 5.
    expect(underOwnedCap.spaceCount).toBe(2);
    expect(underOwnedCap.canAddSpace).toBe(true);

    const atOwnedCap = resolveEmployeeWorkbenchNavQuota({
      agents: [{ id: "main" }],
      spaces: [
        ...Array.from({ length: EMPLOYEE_WORKBENCH_COLLABORATION_SPACE_NAV_LIMIT }, () => ({
          ownerUserId: "me@example.com",
        })),
        { ownerUserId: "peer@example.com" },
        { ownerUserId: "other@example.com" },
      ],
      actorIdentities,
    });
    expect(atOwnedCap.spaceCount).toBe(EMPLOYEE_WORKBENCH_COLLABORATION_SPACE_NAV_LIMIT);
    expect(atOwnedCap.canAddSpace).toBe(false);
  });

  it("lets platform admins bypass the agent quota while members stay capped", () => {
    const agents = [
      { id: "main" },
      ...Array.from({ length: EMPLOYEE_WORKBENCH_AGENT_NAV_LIMIT }, (_, i) => ({
        id: `bot-${i}`,
      })),
    ];
    const actorIdentities = new Set(["me@example.com"]);
    expect(
      resolveEmployeeWorkbenchNavQuota({
        agents,
        spaces: [],
        actorIdentities,
        bypassAgentLimit: false,
      }).canAddAgent,
    ).toBe(false);
    expect(
      resolveEmployeeWorkbenchNavQuota({
        agents,
        spaces: [],
        actorIdentities,
        bypassAgentLimit: true,
      }).canAddAgent,
    ).toBe(true);
  });
});
