import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { EmployeeWorkbenchActor } from "../employee-workbench-scope.js";
import { resolveManagedGroupMembersPath } from "./group-acl.js";
import {
  actorMayProvisionManagedGroupMembers,
  buildAuthoritativeMembersFromCatalogSpace,
  managedGroupMembersNeedC5Materialize,
  provisionManagedGroupMembersForListedSpaces,
  provisionManagedGroupMembersFromCatalog,
  resolveCatalogIdentityToUserId,
} from "./managed-group-members-provision.js";

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function withTenantsRoot(): string {
  const tenantsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "c5-provision-"));
  tempDirs.push(tenantsRoot);
  return tenantsRoot;
}

const ownerA: EmployeeWorkbenchActor = {
  userId: "90fed19a-1c8b-4420-87e0-bcc6165e32fa",
  userEmail: "owner-a@example.com",
  tenantId: "acme",
  seatAgentIds: [],
  seatSpaceIds: [],
};

const ownerB: EmployeeWorkbenchActor = {
  userId: "11111111-2222-3333-4444-555555555555",
  userEmail: "owner-b@example.com",
  tenantId: "acme",
  seatAgentIds: [],
  seatSpaceIds: [],
};

const memberOnB: EmployeeWorkbenchActor = {
  userId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  userEmail: "member-b@example.com",
  tenantId: "acme",
  seatAgentIds: [],
  seatSpaceIds: [],
};

const stranger: EmployeeWorkbenchActor = {
  userId: "00000000-0000-0000-0000-000000000000",
  userEmail: "stranger@example.com",
  tenantId: "acme",
  seatAgentIds: [],
  seatSpaceIds: [],
};

function spaceOwnedBy(
  groupId: string,
  owner: EmployeeWorkbenchActor,
  extraHumans: Array<{ userId: string; email?: string; status?: string }> = [],
) {
  return {
    id: `space:${groupId}`,
    groupId,
    title: groupId,
    ownerUserId: owner.userId,
    members: {
      humans: [
        { userId: owner.userId, email: owner.userEmail, name: owner.userEmail, status: "active" },
        ...extraHumans.map((human) => ({
          userId: human.userId,
          email: human.email,
          status: human.status ?? "active",
        })),
      ],
      bots: [],
    },
    invites: { humans: [], bots: [] },
  };
}

describe("managed C5 members provision", () => {
  it("needs materialize for empty, wrapper-as-empty, and email-only ids", () => {
    expect(managedGroupMembersNeedC5Materialize([])).toBe(true);
    expect(
      managedGroupMembersNeedC5Materialize([
        {
          memberId: "m1",
          memberKind: "human",
          userId: "owner-a@example.com",
          governanceRole: "owner",
          status: "active",
          updatedAtMs: 1,
        },
      ]),
    ).toBe(true);
    expect(
      managedGroupMembersNeedC5Materialize([
        {
          memberId: "m1",
          memberKind: "human",
          userId: ownerA.userId,
          governanceRole: "owner",
          status: "active",
          updatedAtMs: 1,
        },
      ]),
    ).toBe(false);
  });

  it("converts actor email aliases to the actor UUID", () => {
    expect(resolveCatalogIdentityToUserId("owner-a@example.com", ownerA)).toBe(ownerA.userId);
    expect(resolveCatalogIdentityToUserId(ownerA.userId, ownerA)).toBe(ownerA.userId);
    expect(resolveCatalogIdentityToUserId("other@example.com", ownerA)).toBeNull();
    expect(
      resolveCatalogIdentityToUserId(
        "other@example.com",
        ownerA,
        new Map([["other@example.com", ownerB.userId]]),
      ),
    ).toBe(ownerB.userId);
    expect(resolveCatalogIdentityToUserId("ceo-user", ownerA)).toBe("ceo-user");
  });

  it("does not authorize strangers to provision a space they cannot see", () => {
    const space = spaceOwnedBy("grp-a", ownerA);
    expect(
      actorMayProvisionManagedGroupMembers({
        actor: stranger,
        space,
        existingMembers: [],
        groupId: "grp-a",
      }),
    ).toBe(false);
    expect(
      actorMayProvisionManagedGroupMembers({
        actor: ownerA,
        space,
        existingMembers: [],
        groupId: "grp-a",
      }),
    ).toBe(true);
  });

  it("builds UUID members from mixed-owner catalog rows, dropping raw emails", () => {
    const emailToUserId = new Map([
      [ownerB.userEmail, ownerB.userId],
      [memberOnB.userEmail, memberOnB.userId],
    ]);
    const members = buildAuthoritativeMembersFromCatalogSpace({
      space: {
        groupId: "grp-b",
        ownerUserId: ownerB.userEmail,
        members: {
          humans: [
            { userId: ownerB.userEmail, status: "active" },
            { userId: memberOnB.userEmail, status: "active" },
            { userId: "ghost@example.com", status: "active" },
          ],
          bots: [{ agentId: "bot-b", status: "active" }],
        },
      },
      actor: ownerB,
      emailToUserId,
    });
    const humanIds = members
      .filter((member) => member.memberKind === "human")
      .map((member) => member.userId);
    expect(humanIds).toEqual([ownerB.userId, memberOnB.userId]);
    expect(humanIds.every((id) => id && !id.includes("@"))).toBe(true);
    expect(members.find((member) => member.governanceRole === "owner")?.userId).toBe(ownerB.userId);
    expect(
      members.some((member) => member.memberKind === "bot" && member.agentId === "bot-b"),
    ).toBe(true);
  });

  it("provisions every list-visible space for mixed owners and skips strangers", async () => {
    const tenantsRoot = withTenantsRoot();
    const previous = process.env.OPENBOT_TENANTS_ROOT;
    process.env.OPENBOT_TENANTS_ROOT = tenantsRoot;
    try {
      const spaces = [
        spaceOwnedBy("grp-alpha", ownerA),
        spaceOwnedBy("grp-beta", ownerB, [
          { userId: memberOnB.userId, email: memberOnB.userEmail },
        ]),
        spaceOwnedBy("grp-gamma", ownerB),
      ];
      const wrapperPath = resolveManagedGroupMembersPath({
        groupId: "grp-beta",
        tenantId: "acme",
      });
      fs.mkdirSync(path.dirname(wrapperPath), { recursive: true });
      fs.writeFileSync(
        wrapperPath,
        JSON.stringify({ members: [{ userId: ownerB.userEmail, status: "active" }] }),
      );
      const emailOnlyPath = resolveManagedGroupMembersPath({
        groupId: "grp-gamma",
        tenantId: "acme",
      });
      fs.mkdirSync(path.dirname(emailOnlyPath), { recursive: true });
      fs.writeFileSync(
        emailOnlyPath,
        JSON.stringify([
          {
            memberId: "m-email",
            memberKind: "human",
            userId: ownerB.userEmail,
            governanceRole: "owner",
            status: "active",
            updatedAtMs: 1,
          },
        ]),
      );

      const asOwnerA = await provisionManagedGroupMembersForListedSpaces({
        tenantId: "acme",
        cfg: {},
        spaces,
        actor: ownerA,
      });
      expect(asOwnerA.map((entry) => entry.groupId).toSorted()).toEqual(["grp-alpha"]);
      const alphaRaw = JSON.parse(
        fs.readFileSync(
          resolveManagedGroupMembersPath({ groupId: "grp-alpha", tenantId: "acme" }),
          "utf8",
        ),
      ) as unknown;
      expect(Array.isArray(alphaRaw)).toBe(true);
      expect((alphaRaw as Array<{ userId?: string }>)[0]?.userId).toBe(ownerA.userId);
      expect(
        fs.existsSync(resolveManagedGroupMembersPath({ groupId: "grp-gamma", tenantId: "acme" })),
      ).toBe(true);
      expect(
        JSON.parse(
          fs.readFileSync(
            resolveManagedGroupMembersPath({ groupId: "grp-gamma", tenantId: "acme" }),
            "utf8",
          ),
        ),
      ).toEqual(expect.arrayContaining([expect.objectContaining({ userId: ownerB.userEmail })]));

      const asOwnerB = await provisionManagedGroupMembersForListedSpaces({
        tenantId: "acme",
        cfg: {},
        spaces,
        actor: ownerB,
        emailToUserId: new Map([[ownerB.userEmail, ownerB.userId]]),
      });
      expect(asOwnerB.map((entry) => entry.groupId).toSorted()).toEqual(["grp-beta", "grp-gamma"]);
      for (const groupId of ["grp-beta", "grp-gamma"]) {
        const raw = JSON.parse(
          fs.readFileSync(resolveManagedGroupMembersPath({ groupId, tenantId: "acme" }), "utf8"),
        ) as unknown;
        expect(Array.isArray(raw)).toBe(true);
        expect(raw).not.toEqual(expect.objectContaining({ members: expect.anything() }));
        const ids = (raw as Array<{ userId?: string; memberKind?: string }>)
          .filter((row) => row.memberKind === "human")
          .map((row) => row.userId);
        expect(ids).toContain(ownerB.userId);
        expect(ids.some((id) => id?.includes("@"))).toBe(false);
      }

      const denied = await provisionManagedGroupMembersFromCatalog({
        groupId: "grp-alpha",
        tenantId: "acme",
        cfg: {},
        actor: stranger,
        space: spaces[0],
        existingMembers: [],
      });
      expect(denied).toBeNull();
      const alphaAfterStranger = JSON.parse(
        fs.readFileSync(
          resolveManagedGroupMembersPath({ groupId: "grp-alpha", tenantId: "acme" }),
          "utf8",
        ),
      ) as Array<{ userId?: string }>;
      expect(alphaAfterStranger.some((row) => row.userId === stranger.userId)).toBe(false);
    } finally {
      if (previous === undefined) {
        delete process.env.OPENBOT_TENANTS_ROOT;
      } else {
        process.env.OPENBOT_TENANTS_ROOT = previous;
      }
    }
  });
});
