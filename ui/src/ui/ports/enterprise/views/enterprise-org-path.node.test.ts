import { describe, expect, it } from "vitest";
import {
  collectOrganizationStructurePrefixPaths,
  composeOrganizationTeamPath,
  matchesOrganizationTeamPath,
  organizationPathKey,
  resolveOrganizationDepartmentDropAction,
  splitOrganizationPath,
} from "./enterprise-org-path.ts";

describe("splitOrganizationPath", () => {
  it("splits hierarchical labels with common separators", () => {
    expect(splitOrganizationPath("销售部/华东区")).toEqual(["销售部", "华东区"]);
    expect(splitOrganizationPath("销售部 > 市场部")).toEqual(["销售部", "市场部"]);
  });
});

describe("composeOrganizationTeamPath", () => {
  it("joins parent and child team labels", () => {
    expect(
      composeOrganizationTeamPath({
        teamLabel: "华东区",
        parentTeamLabel: "销售部",
      }),
    ).toBe("销售部/华东区");
  });

  it("keeps explicit hierarchical team labels untouched", () => {
    expect(
      composeOrganizationTeamPath({
        teamLabel: "销售部/市场部",
        parentTeamLabel: "集团",
      }),
    ).toBe("销售部/市场部");
  });
});

describe("matchesOrganizationTeamPath", () => {
  it("matches exact and descendant team paths", () => {
    expect(matchesOrganizationTeamPath("销售部/华东区", "销售部")).toBe(true);
    expect(matchesOrganizationTeamPath("销售部/华东区", "销售部/华东区")).toBe(true);
    expect(matchesOrganizationTeamPath("销售部/华东区", "市场部")).toBe(false);
    expect(organizationPathKey(splitOrganizationPath("销售部/华东区"))).toBe("销售部/华东区");
  });
});

describe("resolveOrganizationDepartmentDropAction", () => {
  it("moves departments across branches and to root", () => {
    expect(resolveOrganizationDepartmentDropAction("销售部/华东区", "市场部")).toBe("move");
    expect(resolveOrganizationDepartmentDropAction("销售部", "")).toBe("move");
  });

  it("merges when dropping onto parent or sibling", () => {
    expect(resolveOrganizationDepartmentDropAction("销售部/华东区", "销售部")).toBe("merge");
    expect(resolveOrganizationDepartmentDropAction("销售部/华东区", "销售部/华北区")).toBe("merge");
    expect(resolveOrganizationDepartmentDropAction("销售部", "市场部")).toBe("merge");
  });

  it("rejects invalid drops", () => {
    expect(resolveOrganizationDepartmentDropAction("销售部", "销售部")).toBeNull();
    expect(resolveOrganizationDepartmentDropAction("销售部", "销售部/华东区")).toBeNull();
  });
});

describe("collectOrganizationStructurePrefixPaths", () => {
  it("collects all intermediate department prefixes", () => {
    expect(collectOrganizationStructurePrefixPaths(["销售部/华东区/一组", "运营部"])).toEqual([
      "销售部",
      "销售部/华东区",
      "销售部/华东区/一组",
      "运营部",
    ]);
  });
});
