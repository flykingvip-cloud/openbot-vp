import { describe, expect, it } from "vitest";
import type { EnterpriseOrgDepartmentNode } from "../../ports/enterprise/views/enterprise-org-tree-model.ts";
import {
  addSeatMemberSelections,
  buildAssignedSeatUserIdSet,
  collectAssignableMembersFromDepartment,
  findEnterpriseOrgDepartment,
  isSeatMemberAssignable,
  listSeatMemberSelections,
  parseSeatAssignUserIds,
  pruneAssignedSeatSelections,
  removeSeatMemberSelection,
  toggleSeatMemberSelection,
} from "./cost-budget-seat-selection.ts";

function sampleDepartment(): EnterpriseOrgDepartmentNode {
  return {
    kind: "department",
    label: "销售部",
    fullPath: "销售部",
    pathKey: "销售部",
    level: 0,
    childDepartments: [
      {
        kind: "department",
        label: "华东区",
        fullPath: "销售部/华东区",
        pathKey: "销售部/华东区",
        level: 1,
        childDepartments: [],
        positions: [
          {
            kind: "position",
            seatId: "seat-east",
            seatTitle: "销售助理",
            teamLabel: "销售部/华东区",
            seatStatus: "occupied",
            roleCode: null,
            member: {
              kind: "member",
              user: "bob@example.com",
              displayLabel: "Bob",
              membershipRole: "member",
              status: "active",
            },
          },
        ],
        orderedChildren: [],
      },
    ],
    positions: [
      {
        kind: "position",
        seatId: "seat-west",
        seatTitle: "销售经理",
        teamLabel: "销售部",
        seatStatus: "occupied",
        roleCode: null,
        member: {
          kind: "member",
          user: "alice@example.com",
          displayLabel: "Alice",
          membershipRole: "member",
          status: "active",
        },
      },
    ],
    orderedChildren: [],
  };
}

describe("cost-budget-seat-selection", () => {
  it("toggles members in and out of the selection map", () => {
    let selected = new Map<string, string>();
    selected = toggleSeatMemberSelection(selected, "a@example.com", "Alice");
    expect([...selected.keys()]).toEqual(["a@example.com"]);
    selected = toggleSeatMemberSelection(selected, "b@example.com", "Bob");
    expect(listSeatMemberSelections(selected)).toEqual([
      { userId: "a@example.com", displayLabel: "Alice" },
      { userId: "b@example.com", displayLabel: "Bob" },
    ]);
    selected = toggleSeatMemberSelection(selected, "a@example.com", "Alice");
    expect([...selected.keys()]).toEqual(["b@example.com"]);
  });

  it("does not toggle members who already have billing seats", () => {
    const assigned = buildAssignedSeatUserIdSet([{ userId: "bob@example.com" }]);
    const selected = toggleSeatMemberSelection(new Map(), "bob@example.com", "Bob", assigned);
    expect(selected.size).toBe(0);
  });

  it("removes a single member without affecting others", () => {
    const selected = removeSeatMemberSelection(
      new Map([
        ["a@example.com", "Alice"],
        ["b@example.com", "Bob"],
      ]),
      "a@example.com",
    );
    expect([...selected.keys()]).toEqual(["b@example.com"]);
  });

  it("parses batch user ids and skips assigned members", () => {
    const assigned = buildAssignedSeatUserIdSet([{ userId: "bob@example.com" }]);
    expect(
      parseSeatAssignUserIds("a@example.com, bob@example.com\na@example.com", assigned),
    ).toEqual(["a@example.com"]);
  });

  it("collects assignable members from a department subtree", () => {
    const assigned = buildAssignedSeatUserIdSet([{ userId: "bob@example.com" }]);
    const department = sampleDepartment();
    expect(collectAssignableMembersFromDepartment(department, assigned)).toEqual([
      { userId: "alice@example.com", displayLabel: "Alice" },
    ]);
  });

  it("adds department members without removing existing selections", () => {
    const selected = addSeatMemberSelections(new Map([["keep@example.com", "Keep"]]), [
      { userId: "alice@example.com", displayLabel: "Alice" },
    ]);
    expect([...selected.keys()]).toEqual(["keep@example.com", "alice@example.com"]);
  });

  it("prunes assigned members from the current selection", () => {
    const assigned = buildAssignedSeatUserIdSet([{ userId: "bob@example.com" }]);
    const pruned = pruneAssignedSeatSelections(
      new Map([
        ["alice@example.com", "Alice"],
        ["bob@example.com", "Bob"],
      ]),
      assigned,
    );
    expect([...pruned.keys()]).toEqual(["alice@example.com"]);
  });

  it("finds nested departments by full path", () => {
    const department = findEnterpriseOrgDepartment([sampleDepartment()], "销售部/华东区");
    expect(department?.label).toBe("华东区");
    expect(isSeatMemberAssignable("Bob@Example.com", buildAssignedSeatUserIdSet([]))).toBe(true);
  });
});
