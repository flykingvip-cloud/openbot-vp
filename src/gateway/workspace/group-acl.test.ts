import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertGroupMemberAccess,
  loadAuthoritativeGroupMembers,
  persistAuthoritativeGroupMembers,
  resolveManagedGroupMembersPath,
} from "./group-acl.js";

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("group-acl tenant scope (C5)", () => {
  it("isolates membership by tenant for the same groupId", async () => {
    const tenantsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gacl-"));
    tempDirs.push(tenantsRoot);
    const previous = process.env.OPENBOT_TENANTS_ROOT;
    process.env.OPENBOT_TENANTS_ROOT = tenantsRoot;
    try {
      const pathA = resolveManagedGroupMembersPath({ groupId: "g1", tenantId: "t-a" });
      const pathB = resolveManagedGroupMembersPath({ groupId: "g1", tenantId: "t-b" });
      expect(pathA).not.toBe(pathB);
      fs.mkdirSync(path.dirname(pathA), { recursive: true });
      fs.mkdirSync(path.dirname(pathB), { recursive: true });
      fs.writeFileSync(
        pathA,
        JSON.stringify([{ userId: "user-a", status: "active", memberKind: "human" }]),
      );
      fs.writeFileSync(
        pathB,
        JSON.stringify([{ userId: "user-b", status: "active", memberKind: "human" }]),
      );

      expect(
        await assertGroupMemberAccess({
          groupId: "g1",
          userId: "user-a",
          tenantId: "t-a",
          profile: "managed_enterprise",
          cfg: {},
        }),
      ).toBeNull();

      expect(
        await assertGroupMemberAccess({
          groupId: "g1",
          userId: "user-a",
          tenantId: "t-b",
          profile: "managed_enterprise",
          cfg: {},
        }),
      ).toMatch(/not authorized/);

      expect(
        await assertGroupMemberAccess({
          groupId: "g1",
          userId: "user-b",
          tenantId: "t-b",
          profile: "managed_enterprise",
          cfg: {},
        }),
      ).toBeNull();
    } finally {
      if (previous === undefined) {
        delete process.env.OPENBOT_TENANTS_ROOT;
      } else {
        process.env.OPENBOT_TENANTS_ROOT = previous;
      }
    }
  });

  it("accepts a login-email alias when membership stored the email", async () => {
    const tenantsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gacl-alias-"));
    tempDirs.push(tenantsRoot);
    const previous = process.env.OPENBOT_TENANTS_ROOT;
    process.env.OPENBOT_TENANTS_ROOT = tenantsRoot;
    try {
      const membersPath = resolveManagedGroupMembersPath({ groupId: "g1", tenantId: "t-a" });
      fs.mkdirSync(path.dirname(membersPath), { recursive: true });
      fs.writeFileSync(
        membersPath,
        JSON.stringify([{ userId: "daniel.hhd@gmail.com", status: "active", memberKind: "human" }]),
      );

      expect(
        await assertGroupMemberAccess({
          groupId: "g1",
          userId: "90fed19a-1c8b-4420-87e0-bcc6165e32fa",
          tenantId: "t-a",
          profile: "managed_enterprise",
          cfg: {},
        }),
      ).toMatch(/not authorized/);

      expect(
        await assertGroupMemberAccess({
          groupId: "g1",
          userId: "90fed19a-1c8b-4420-87e0-bcc6165e32fa",
          tenantId: "t-a",
          profile: "managed_enterprise",
          cfg: {},
          identityAliases: ["daniel.hhd@gmail.com"],
        }),
      ).toBeNull();
    } finally {
      if (previous === undefined) {
        delete process.env.OPENBOT_TENANTS_ROOT;
      } else {
        process.env.OPENBOT_TENANTS_ROOT = previous;
      }
    }
  });

  it("persists tenant members as a JSON array that write ACL can read", async () => {
    const tenantsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gacl-persist-"));
    tempDirs.push(tenantsRoot);
    const previous = process.env.OPENBOT_TENANTS_ROOT;
    process.env.OPENBOT_TENANTS_ROOT = tenantsRoot;
    try {
      const dest = await persistAuthoritativeGroupMembers({
        groupId: "测试组",
        tenantId: "001",
        profile: "managed_enterprise",
        cfg: {},
        members: [
          {
            memberId: "m-owner",
            userId: "user-a",
            name: "Dang Co",
            status: "active",
            memberKind: "human",
            governanceRole: "owner",
            updatedAtMs: 1,
          },
        ],
      });
      expect(dest).toBe(resolveManagedGroupMembersPath({ groupId: "测试组", tenantId: "001" }));
      const raw = JSON.parse(fs.readFileSync(dest, "utf8")) as unknown;
      expect(Array.isArray(raw)).toBe(true);

      const members = await loadAuthoritativeGroupMembers({
        groupId: "测试组",
        tenantId: "001",
        profile: "managed_enterprise",
        cfg: {},
      });
      expect(members).toHaveLength(1);
      expect(members[0]?.userId).toBe("user-a");
    } finally {
      if (previous === undefined) {
        delete process.env.OPENBOT_TENANTS_ROOT;
      } else {
        process.env.OPENBOT_TENANTS_ROOT = previous;
      }
    }
  });

  it("requires tenant in managed enterprise", async () => {
    const denied = await assertGroupMemberAccess({
      groupId: "g1",
      userId: "u1",
      tenantId: null,
      profile: "managed_enterprise",
      cfg: {},
    });
    expect(denied).toMatch(/trusted tenant/);
  });
});
