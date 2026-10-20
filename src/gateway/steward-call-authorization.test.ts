import { describe, expect, it, beforeEach } from "vitest";
import { assessForeignStewardCall } from "../agents/builtin-steward/employee-isolation.js";
import type { PlatformAuthUser } from "./platform-auth/store-types.js";
import {
  __clearStewardCallAuthorizationsForTest,
  decideStewardCallAuthorization,
  issuePendingStewardCall,
  resolveStewardChatCallerRank,
  stewardCallAuthorizationHistoryEntries,
} from "./steward-call-authorization.js";

describe("steward cross-call authorization", () => {
  beforeEach(() => {
    __clearStewardCallAuthorizationsForTest();
  });

  it("keeps the pending authorization off the transcript and on the confirm card", () => {
    const pending = issuePendingStewardCall({
      callerUserId: "platform-admin",
      targetUserId: "employee-1",
      callerRank: "platform_admin",
      roleLabel: "平台管理员",
      prompt: "平台管理员需要与你发起对话，是否同意？",
      message: "你好",
      title: "大白管家对话",
      targetSessionKey: "agent:main:employee:employee-1",
      requesterSessionKey: "agent:main:employee:platform-admin",
    });
    const history = stewardCallAuthorizationHistoryEntries("employee-1");
    expect(history).toEqual([
      {
        role: "assistant",
        content: [],
        stewardCallAuthorization: {
          id: pending.id,
          prompt: "平台管理员需要与你发起对话，是否同意？",
          actions: ["同意", "不同意"],
          roleLabel: "平台管理员",
        },
      },
    ]);
    expect(JSON.stringify(history[0]?.content ?? "")).not.toContain("平台管理员需要与你发起对话");
    expect(history[0]).not.toMatchObject({ content: [{ type: "text", text: "你好" }] });
  });

  it("refuses the call when the target chooses 不同意", () => {
    issuePendingStewardCall({
      callerUserId: "ent-admin",
      targetUserId: "employee-1",
      callerRank: "enterprise_admin",
      roleLabel: "企业管理员",
      callerTenantId: "acme",
      targetTenantIds: ["acme"],
      prompt: "企业管理员需要与你发起对话，是否同意？",
      message: "请处理",
      title: "大白管家对话",
      targetSessionKey: "agent:main:employee:employee-1",
      requesterSessionKey: "agent:main:employee:ent-admin",
    });
    expect(
      decideStewardCallAuthorization({ targetUserId: "employee-1", decision: "不同意" }),
    ).toMatchObject({ outcome: "refused" });
    expect(stewardCallAuthorizationHistoryEntries("employee-1")).toEqual([]);
  });

  it("releases the held message only after 同意", () => {
    issuePendingStewardCall({
      callerUserId: "platform-admin",
      targetUserId: "ent-admin",
      callerRank: "platform_admin",
      roleLabel: "平台管理员",
      prompt: "平台管理员需要与你发起对话，是否同意？",
      message: "需要同步一件事",
      title: "大白管家对话",
      targetSessionKey: "agent:main:employee:ent-admin",
      requesterSessionKey: "agent:main:employee:platform-admin",
    });
    const agreed = decideStewardCallAuthorization({
      targetUserId: "ent-admin",
      decision: "同意",
    });
    expect(agreed).toMatchObject({
      outcome: "agreed",
      pending: { message: "需要同步一件事", roleLabel: "平台管理员" },
    });
  });

  it("forbids an enterprise session whose membership is not enterprise-admin", () => {
    const rank = resolveStewardChatCallerRank({
      user: { platformRole: undefined, platformAdmin: false } as PlatformAuthUser,
      memberships: [{ membershipRole: "member", enterpriseId: "acme" }],
      tenantId: "acme",
      sessionDomain: "enterprise",
      sessionKind: "member",
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

  it("does not rank a platform session with no platform role as platform admin", () => {
    expect(
      resolveStewardChatCallerRank({
        user: { platformAdmin: false } as PlatformAuthUser,
        memberships: [{ membershipRole: "member", enterpriseId: "acme" }],
        tenantId: "acme",
        sessionDomain: "platform",
        sessionKind: "platform-super-admin",
      }),
    ).not.toBe("platform_admin");
    expect(
      resolveStewardChatCallerRank({
        user: { platformRole: "admin" } as PlatformAuthUser,
        sessionDomain: "employee",
        sessionKind: "member",
      }),
    ).toBe("platform_admin");
    expect(
      resolveStewardChatCallerRank({
        user: { platformRole: "super-admin" } as PlatformAuthUser,
        sessionDomain: "employee",
        sessionKind: "member",
      }),
    ).toBe("platform_admin");
    expect(
      resolveStewardChatCallerRank({
        user: null,
        memberships: [{ membershipRole: "enterprise-admin", enterpriseId: "acme" }],
        tenantId: "acme",
        sessionDomain: "employee",
        sessionKind: "member",
      }),
    ).toBe("enterprise_admin");
  });
});
