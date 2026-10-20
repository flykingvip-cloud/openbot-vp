import { describe, expect, it } from "vitest";
import { buildModelAuthorizationDirectory } from "./model-authorization-directory.ts";

const roster = {
  departmentPaths: [] as string[],
  seats: [
    {
      seatId: "seat-1",
      title: "Sales Lead",
      teamLabel: "销售一组",
      status: "occupied",
      roleCode: "OPS-L2-001",
      occupantLabel: "Owner",
      occupantUser: "owner@example.com",
    },
  ],
  members: [
    {
      user: "owner@example.com",
      displayLabel: "Owner",
      membershipRole: "enterprise-admin",
      status: "active",
      seatTitle: "Sales Lead",
      seatTeamLabel: "销售一组",
    },
  ],
};

describe("buildModelAuthorizationDirectory", () => {
  it("places org occupants under their department and keeps unknown grants aside", () => {
    const entries = buildModelAuthorizationDirectory({
      orgRoster: roster,
      grants: [
        {
          tenantId: "t",
          subjectType: "seat",
          subjectId: "seat-1",
          grantedModelIds: ["p/a", "p/b"],
          status: "active",
          updatedAt: "x",
        },
        {
          tenantId: "t",
          subjectType: "seat",
          subjectId: "seat-orphan",
          grantedModelIds: ["p/a"],
          status: "active",
          updatedAt: "x",
        },
      ],
    });
    const owner = entries.find((entry) => entry.key === "seat:seat-1");
    expect(owner).toMatchObject({
      label: "Owner",
      meta: "Sales Lead",
      roleLabel: "OPS-L2-001",
      grantedCount: 2,
    });
    expect(entries.some((entry) => entry.kind === "group" && entry.label === "销售一组")).toBe(
      true,
    );
    expect(entries.some((entry) => entry.label === "未挂到组织的授权")).toBe(true);
    expect(entries.some((entry) => entry.key === "seat:seat-orphan")).toBe(true);
  });

  it("does not count platform models hidden from the authorization list", () => {
    const entries = buildModelAuthorizationDirectory({
      orgRoster: roster,
      hiddenModelIds: ["removed/ghost"],
      grants: [
        {
          tenantId: "t",
          subjectType: "seat",
          subjectId: "seat-1",
          grantedModelIds: ["removed/ghost", "ent/private/qwen", "live/vision"],
          status: "active",
          updatedAt: "x",
        },
      ],
    });
    expect(entries.find((entry) => entry.key === "seat:seat-1")?.grantedCount).toBe(2);
  });

  it("filters the org directory by person or seat title", () => {
    const entries = buildModelAuthorizationDirectory({
      orgRoster: roster,
      grants: [],
      query: "owner",
    });
    expect(entries.some((entry) => entry.key === "seat:seat-1")).toBe(true);
    expect(
      buildModelAuthorizationDirectory({
        orgRoster: roster,
        grants: [],
        query: "不存在",
      }).some((entry) => entry.kind === "subject"),
    ).toBe(false);
  });

  it("does not stamp a teamless member onto every seat that shares a title", () => {
    const entries = buildModelAuthorizationDirectory({
      orgRoster: {
        departmentPaths: [],
        seats: [
          {
            seatId: "seat-a",
            title: "工程师",
            teamLabel: "销售一组",
            status: "occupied",
            roleCode: null,
            occupantLabel: "甲",
            occupantUser: "jia@example.com",
          },
          {
            seatId: "seat-b",
            title: "工程师",
            teamLabel: "销售二组",
            status: "occupied",
            roleCode: null,
            occupantLabel: "乙",
            occupantUser: "yi@example.com",
          },
        ],
        members: [
          {
            user: "jia@example.com",
            displayLabel: "甲",
            membershipRole: "member",
            status: "active",
            seatTitle: "工程师",
            seatTeamLabel: null,
          },
        ],
      },
      grants: [],
    });
    expect(entries.find((entry) => entry.key === "seat:seat-a")).toMatchObject({
      label: "甲",
      meta: "工程师",
    });
    expect(entries.find((entry) => entry.key === "seat:seat-b")).toMatchObject({
      label: "乙",
      meta: "工程师",
    });
  });

  it("keeps an exact-team member when a teamless member also shares the title", () => {
    const entries = buildModelAuthorizationDirectory({
      orgRoster: {
        departmentPaths: [],
        seats: [
          {
            seatId: "seat-a",
            title: "工程师",
            teamLabel: "销售一组",
            status: "occupied",
            roleCode: null,
            occupantLabel: "甲",
            occupantUser: "jia@example.com",
          },
          {
            seatId: "seat-b",
            title: "工程师",
            teamLabel: "销售二组",
            status: "occupied",
            roleCode: null,
            occupantLabel: "乙",
            occupantUser: "yi@example.com",
          },
        ],
        members: [
          {
            user: "jia@example.com",
            displayLabel: "甲",
            membershipRole: "member",
            status: "active",
            seatTitle: "工程师",
            seatTeamLabel: null,
          },
          {
            user: "bing@example.com",
            displayLabel: "丙",
            membershipRole: "member",
            status: "active",
            seatTitle: "工程师",
            seatTeamLabel: "销售二组",
          },
        ],
      },
      grants: [],
    });
    expect(entries.find((entry) => entry.key === "seat:seat-a")?.label).toBe("甲");
    expect(entries.find((entry) => entry.key === "seat:seat-b")?.label).toBe("丙");
  });

  it("falls back to seat options when the org roster is empty", () => {
    const entries = buildModelAuthorizationDirectory({
      grants: [],
      seatOptions: [{ id: "seat-9", label: "Finance" }],
    });
    expect(entries.find((entry) => entry.key === "seat:seat-9")).toMatchObject({
      label: "Finance",
      subjectType: "seat",
    });
  });
});
