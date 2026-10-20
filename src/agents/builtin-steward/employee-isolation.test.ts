import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assessForeignStewardCall,
  buildEmployeeBuiltinStewardSessionKey,
  extractEmployeeStewardUserIdFromSessionKey,
  isGlobalBuiltinStewardSessionKey,
  resolveEmployeeBuiltinStewardSessionKey,
  sessionKeysForChatHistoryActiveRun,
  resolveEmployeeBuiltinStewardWorkspaceDir,
  resolveStewardDispatchRank,
  shouldForceEmployeeStewardToolFsWorkspaceOnly,
} from "./employee-isolation.js";

describe("employee steward isolation", () => {
  it("builds a per-user steward session key", () => {
    expect(buildEmployeeBuiltinStewardSessionKey("user-elle")).toBe(
      "agent:main:employee:user-elle",
    );
  });

  it("extracts the platform user id from employee steward session keys", () => {
    expect(extractEmployeeStewardUserIdFromSessionKey("agent:main:employee:user-elle")).toBe(
      "user-elle",
    );
    expect(extractEmployeeStewardUserIdFromSessionKey("agent:main:main")).toBeNull();
  });

  it("detects global steward sessions", () => {
    expect(isGlobalBuiltinStewardSessionKey("main")).toBe(true);
    expect(isGlobalBuiltinStewardSessionKey("agent:main")).toBe(true);
    expect(isGlobalBuiltinStewardSessionKey("agent:main:main")).toBe(true);
    expect(isGlobalBuiltinStewardSessionKey("agent:main:employee:user-elle")).toBe(false);
  });

  it("maps main aliases to the current employee steward session", () => {
    expect(
      resolveEmployeeBuiltinStewardSessionKey({
        rawSessionKey: "main",
        platformUserId: "user-elle",
      }),
    ).toBe("agent:main:employee:user-elle");
    expect(
      resolveEmployeeBuiltinStewardSessionKey({
        rawSessionKey: "agent:main",
        platformUserId: "user-elle",
      }),
    ).toBe("agent:main:employee:user-elle");
    expect(
      resolveEmployeeBuiltinStewardSessionKey({
        rawSessionKey: "agent:main:employee:user-elle",
        platformUserId: "user-elle",
      }),
    ).toBe("agent:main:employee:user-elle");
  });

  it("does not rewrite another person's steward into the caller", () => {
    expect(
      resolveEmployeeBuiltinStewardSessionKey({
        rawSessionKey: "agent:main:employee:user-daniel",
        platformUserId: "user-elle",
      }),
    ).toBe("agent:main:employee:user-daniel");
  });

  it("refuses a non-admin opening another user's steward", () => {
    expect(
      assessForeignStewardCall({
        callerUserId: "user-elle",
        targetUserId: "user-daniel",
        rank: "member",
        callerTenantId: "acme",
        targetTenantIds: ["acme"],
      }).disposition,
    ).toBe("forbidden");
    expect(
      resolveStewardDispatchRank({
        sessionDomain: "employee",
        sessionKind: "member",
        platformRole: null,
        enterpriseAdminMembership: false,
      }),
    ).toBe("member");
  });

  it("does not rank a non-admin enterprise session as enterprise admin", () => {
    const rank = resolveStewardDispatchRank({
      sessionDomain: "enterprise",
      sessionKind: "member",
      platformRole: null,
      enterpriseAdminMembership: false,
    });
    expect(rank).toBe("member");
    expect(
      assessForeignStewardCall({
        callerUserId: "user-elle",
        targetUserId: "user-daniel",
        rank,
        callerTenantId: "acme",
        targetTenantIds: ["acme"],
      }).disposition,
    ).toBe("forbidden");
  });

  it("does not treat sessionKind enterprise-admin as a stored membership", () => {
    expect(
      resolveStewardDispatchRank({
        sessionDomain: "enterprise",
        sessionKind: "enterprise-admin",
        platformRole: null,
        enterpriseAdminMembership: false,
      }),
    ).toBe("member");
  });

  it("does not rank a platform session without a store role as platform admin", () => {
    expect(
      resolveStewardDispatchRank({
        sessionDomain: "platform",
        sessionKind: "platform-super-admin",
        platformRole: null,
        enterpriseAdminMembership: false,
      }),
    ).not.toBe("platform_admin");
    expect(
      resolveStewardDispatchRank({
        sessionDomain: "platform",
        sessionKind: "platform-admin",
        platformRole: null,
      }),
    ).toBe("member");
  });

  it("ranks platform and enterprise admins only from stored roles", () => {
    expect(
      resolveStewardDispatchRank({
        sessionDomain: "employee",
        sessionKind: "member",
        platformRole: "admin",
        enterpriseAdminMembership: false,
      }),
    ).toBe("platform_admin");
    expect(
      resolveStewardDispatchRank({
        sessionDomain: "employee",
        platformRole: "super-admin",
      }),
    ).toBe("platform_admin");
    expect(
      resolveStewardDispatchRank({
        sessionDomain: "employee",
        sessionKind: "member",
        platformRole: null,
        enterpriseAdminMembership: true,
      }),
    ).toBe("enterprise_admin");
  });

  it("lets a platform admin request anyone's steward only as pending authorization", () => {
    const assessed = assessForeignStewardCall({
      callerUserId: "platform-admin",
      targetUserId: "enterprise-admin",
      rank: "platform_admin",
    });
    expect(assessed).toMatchObject({
      disposition: "needs_authorization",
      roleLabel: "平台管理员",
      prompt: "平台管理员需要与你发起对话，是否同意？",
      actions: ["同意", "不同意"],
    });
  });

  it("lets an enterprise admin request only stewards inside that enterprise", () => {
    expect(
      assessForeignStewardCall({
        callerUserId: "ent-admin",
        targetUserId: "employee-1",
        rank: "enterprise_admin",
        callerTenantId: "acme",
        targetTenantIds: ["acme"],
      }),
    ).toMatchObject({
      roleLabel: "企业管理员",
      prompt: "企业管理员需要与你发起对话，是否同意？",
    });
    expect(
      assessForeignStewardCall({
        callerUserId: "ent-admin",
        targetUserId: "outsider",
        rank: "enterprise_admin",
        callerTenantId: "acme",
        targetTenantIds: ["other"],
      }).disposition,
    ).toBe("forbidden");
  });

  it("keeps non-steward session keys untouched", () => {
    expect(
      resolveEmployeeBuiltinStewardSessionKey({
        rawSessionKey: "agent:market:main",
        platformUserId: "user-elle",
      }),
    ).toBe("agent:market:main");
  });

  it("keeps organization inboxes off the employee steward thread", () => {
    expect(
      resolveEmployeeBuiltinStewardSessionKey({
        rawSessionKey: "agent:main:org:upbeyond",
        platformUserId: "user-elle",
      }),
    ).toBe("agent:main:org:upbeyond");
  });

  it("keeps collaboration space sessions off the employee steward thread", () => {
    expect(isGlobalBuiltinStewardSessionKey("agent:main:space:grp-1")).toBe(false);
    expect(
      resolveEmployeeBuiltinStewardSessionKey({
        rawSessionKey: "agent:main:space:grp-hrqb-163-com-team",
        platformUserId: "user-elle",
      }),
    ).toBe("agent:main:space:grp-hrqb-163-com-team");
    expect(
      resolveEmployeeBuiltinStewardSessionKey({
        rawSessionKey: "space:grp-1",
        platformUserId: "user-elle",
      }),
    ).toBe("space:grp-1");
  });

  it("resolves an isolated employee steward workspace directory", () => {
    const workspace = resolveEmployeeBuiltinStewardWorkspaceDir("user-elle");
    expect(workspace).toContain("/agents/main/employees/user-elle/workspace");
  });

  it("accepts a cutover workspaceDirOverride for D1e target", () => {
    const override = "/tmp/tenants/t1/users/user-elle/OpenBot/agents/main/workspace";
    expect(
      resolveEmployeeBuiltinStewardWorkspaceDir("user-elle", {
        workspaceDirOverride: override,
      }),
    ).toBe(path.resolve(override));
  });

  it("adopts the employee session run and skips the global steward alias", () => {
    const own = "agent:main:employee:user-elle";
    expect(
      sessionKeysForChatHistoryActiveRun({
        resolvedSessionKey: own,
        rawSessionKey: "agent:main:main",
      }),
    ).toEqual([own]);
    expect(
      sessionKeysForChatHistoryActiveRun({
        resolvedSessionKey: own,
        rawSessionKey: "main",
      }),
    ).toEqual([own]);
    expect(
      sessionKeysForChatHistoryActiveRun({
        resolvedSessionKey: "agent:bot-2:main",
        rawSessionKey: "agent:bot-2:main",
      }),
    ).toEqual(["agent:bot-2:main"]);
    expect(
      sessionKeysForChatHistoryActiveRun({
        resolvedSessionKey: "agent:main:main",
        rawSessionKey: "main",
      }),
    ).toEqual(["agent:main:main", "main"]);
  });

  it("forces workspace-only tools only for employee steward sessions", () => {
    expect(
      shouldForceEmployeeStewardToolFsWorkspaceOnly({
        sessionKey: "agent:main:employee:user-elle",
        agentId: "main",
      }),
    ).toBe(true);
    expect(
      shouldForceEmployeeStewardToolFsWorkspaceOnly({
        sessionKey: "agent:main:main",
        agentId: "main",
      }),
    ).toBe(false);
  });
});
