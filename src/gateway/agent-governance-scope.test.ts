import { describe, expect, it } from "vitest";
import {
  filterAgentsForGovernanceScope,
  isAgentVisibleToGovernanceScope,
} from "./agent-governance-scope.js";

const agents = [
  { id: "daibai" },
  { id: "sales", ownerId: "user-a" },
  { id: "support", ownerId: "user-b" },
];

const ownershipRecords = [
  {
    id: "tenant-a:agent:sales",
    tenantId: "tenant-a",
    subjectKind: "agent" as const,
    subjectId: "sales",
    positionId: "seat-a",
    positionLabel: "Sales",
    createdByUserId: "user-a",
    createdByUserLabel: "User A",
    currentManagerUserId: "user-a",
    currentManagerLabel: "User A",
    bindingStatus: "active" as const,
    createdAt: "2026-08-04T00:00:00.000Z",
    updatedAt: "2026-08-04T00:00:00.000Z",
  },
];

describe("agent governance scope", () => {
  it("lets platform governance see the complete roster", () => {
    expect(
      filterAgentsForGovernanceScope({
        agents,
        scope: { kind: "platform" },
        ownershipRecords,
      }),
    ).toHaveLength(3);
  });

  it("limits tenant governance to active assets in that tenant", () => {
    expect(
      filterAgentsForGovernanceScope({
        agents,
        scope: { kind: "tenant", tenantId: "tenant-a" },
        ownershipRecords,
      }).map((agent) => agent.id),
    ).toEqual(["sales"]);
  });

  it("limits employee supervisors to their own workers", () => {
    const actor = {
      userId: "user-a",
      userEmail: "user-a@example.com",
      tenantId: "tenant-a",
      seatAgentIds: ["sales"],
      seatSpaceIds: [],
    };
    expect(
      isAgentVisibleToGovernanceScope({
        agent: agents[2],
        scope: { kind: "self", ownerId: "user-a" },
        employeeActor: actor,
        ownershipRecords,
      }),
    ).toBe(false);
  });
});
