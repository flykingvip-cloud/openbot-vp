import { describe, expect, it } from "vitest";
import {
  getCachedGroupChatAcl,
  refreshGroupChatAclCache,
  resetGroupChatAclCacheForTests,
  upsertAuthorizedGroupChatAclMember,
} from "./chat-group-acl-cache.js";

describe("chat-group-acl-cache", () => {
  it("keeps chat.send seeds when listSpaces omits tenantId", async () => {
    resetGroupChatAclCacheForTests();
    upsertAuthorizedGroupChatAclMember({
      tenantId: "tenant-a",
      groupId: "grp-cod7432-gmail-com-测试组",
      memberUserId: "90fed19a-1c8b-4420-87e0-bcc6165e32fa",
    });

    await refreshGroupChatAclCache({
      force: true,
      listSpaces: (async () => ({
        spaces: [
          {
            id: "grp-cod7432-gmail-com-测试组",
            groupId: "grp-cod7432-gmail-com-测试组",
            title: "测试组",
          },
        ],
      })) as never,
    });

    const acl = getCachedGroupChatAcl("tenant-a", "grp-cod7432-gmail-com-测试组");
    expect(acl?.memberUserIds.has("90fed19a-1c8b-4420-87e0-bcc6165e32fa")).toBe(true);
  });

  it("unions send seeds into a later catalog refresh for the same tenant group", async () => {
    resetGroupChatAclCacheForTests();
    upsertAuthorizedGroupChatAclMember({
      tenantId: "tenant-a",
      groupId: "grp-ops",
      memberUserId: "alice",
    });

    await refreshGroupChatAclCache({
      force: true,
      listSpaces: (async () => ({
        spaces: [
          {
            id: "grp-ops",
            groupId: "grp-ops",
            tenantId: "tenant-a",
            ownerUserId: "owner",
            members: { humans: [{ userId: "bob", status: "active" }] },
          },
        ],
      })) as never,
    });

    const acl = getCachedGroupChatAcl("tenant-a", "grp-ops");
    expect(acl?.memberUserIds.has("alice")).toBe(true);
    expect(acl?.memberUserIds.has("bob")).toBe(true);
    expect(acl?.memberUserIds.has("owner")).toBe(true);
  });

  it("preserves a seed upserted while listSpaces is in flight", async () => {
    resetGroupChatAclCacheForTests();
    let releaseList: (() => void) | undefined;
    const listed = new Promise<{ spaces: Array<{ groupId: string; title: string }> }>((resolve) => {
      releaseList = () =>
        resolve({
          spaces: [{ groupId: "grp-ops", title: "ops" }],
        });
    });

    const refresh = refreshGroupChatAclCache({
      force: true,
      listSpaces: (async () => listed) as never,
    });
    upsertAuthorizedGroupChatAclMember({
      tenantId: "tenant-a",
      groupId: "grp-ops",
      memberUserId: "alice",
    });
    releaseList?.();
    await refresh;

    expect(getCachedGroupChatAcl("tenant-a", "grp-ops")?.memberUserIds.has("alice")).toBe(true);
  });
});
