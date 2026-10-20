import { describe, expect, it } from "vitest";
import {
  buildDefaultChildOrderKeys,
  buildDirectChildOrderKeysFromReadModel,
  buildOrderedChildren,
  finalizeReorderKeysForServer,
  mergeOrganizationChildOrderKeys,
  organizationChildDepartmentKey,
  organizationChildSeatKey,
  reorderOrganizationChildKeys,
} from "./enterprise-org-child-order.ts";
import type { EnterpriseOrgDepartmentNode } from "./enterprise-org-tree-model.ts";

function createDepartment(
  partial: Partial<EnterpriseOrgDepartmentNode>,
): EnterpriseOrgDepartmentNode {
  return {
    kind: "department",
    label: "销售部",
    fullPath: "销售部",
    pathKey: "销售部",
    level: 1,
    childDepartments: [],
    positions: [],
    orderedChildren: [],
    ...partial,
  };
}

describe("mergeOrganizationChildOrderKeys", () => {
  it("keeps saved order and appends new nodes", () => {
    const defaults = [
      organizationChildSeatKey("seat-a"),
      organizationChildDepartmentKey("销售部/一部"),
    ];
    expect(
      mergeOrganizationChildOrderKeys(
        [organizationChildDepartmentKey("销售部/一部"), organizationChildSeatKey("seat-a")],
        defaults,
      ),
    ).toEqual([organizationChildDepartmentKey("销售部/一部"), organizationChildSeatKey("seat-a")]);
  });
});

describe("reorderOrganizationChildKeys", () => {
  it("moves a position above a child department within the same parent", () => {
    const current = [
      organizationChildDepartmentKey("销售部/一部"),
      organizationChildSeatKey("seat-manager"),
    ];
    expect(
      reorderOrganizationChildKeys({
        currentKeys: current,
        dragKey: organizationChildSeatKey("seat-manager"),
        targetKey: organizationChildDepartmentKey("销售部/一部"),
        insertBefore: true,
      }),
    ).toEqual([
      organizationChildSeatKey("seat-manager"),
      organizationChildDepartmentKey("销售部/一部"),
    ]);
  });
});

describe("buildOrderedChildren", () => {
  it("interleaves departments and positions from saved order", () => {
    const childDepartment = createDepartment({
      label: "一部",
      fullPath: "销售部/一部",
      pathKey: "销售部/一部",
      level: 2,
    });
    const parent = createDepartment({
      childDepartments: [childDepartment],
      positions: [
        {
          kind: "position",
          seatId: "seat-manager",
          seatTitle: "销售经理",
          teamLabel: "销售部",
          seatStatus: "occupied",
          roleCode: null,
          member: null,
        },
      ],
    });
    const ordered = buildOrderedChildren(parent, {
      销售部: [
        organizationChildSeatKey("seat-manager"),
        organizationChildDepartmentKey("销售部/一部"),
      ],
    });
    expect(ordered.map((entry) => entry.kind)).toEqual(["position", "department"]);
    expect(buildDefaultChildOrderKeys(parent)).toEqual([
      organizationChildDepartmentKey("销售部/一部"),
      organizationChildSeatKey("seat-manager"),
    ]);
  });
});

describe("buildDirectChildOrderKeysFromReadModel", () => {
  it("aligns root and nested child keys with backend expectations", () => {
    const keys = buildDirectChildOrderKeysFromReadModel("", {
      organizationDepartmentPaths: ["管理层", "销售部", "销售部/一部"],
      seatSummaries: [
        { seatId: "seat-ceo", teamLabel: "管理层" },
        { seatId: "seat-manager", teamLabel: "管理层" },
      ],
    });
    expect(keys).toEqual([
      organizationChildDepartmentKey("管理层"),
      organizationChildDepartmentKey("销售部"),
    ]);
    expect(
      buildDirectChildOrderKeysFromReadModel("管理层", {
        organizationDepartmentPaths: ["管理层", "销售部", "销售部/一部"],
        seatSummaries: [
          { seatId: "seat-ceo", teamLabel: "管理层" },
          { seatId: "seat-manager", teamLabel: "管理层" },
        ],
      }),
    ).toEqual([organizationChildSeatKey("seat-ceo"), organizationChildSeatKey("seat-manager")]);
  });
});

describe("finalizeReorderKeysForServer", () => {
  it("appends hidden keys after a partial visible reorder", () => {
    const allKeys = [
      organizationChildDepartmentKey("管理层"),
      organizationChildDepartmentKey("销售部"),
      organizationChildDepartmentKey("upbeyond"),
    ];
    expect(
      finalizeReorderKeysForServer(
        [organizationChildDepartmentKey("销售部"), organizationChildDepartmentKey("管理层")],
        allKeys,
      ),
    ).toEqual([
      organizationChildDepartmentKey("销售部"),
      organizationChildDepartmentKey("管理层"),
      organizationChildDepartmentKey("upbeyond"),
    ]);
  });
});
