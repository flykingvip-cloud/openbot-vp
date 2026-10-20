import { describe, expect, it, vi } from "vitest";
import {
  applyIdentityOperationalRobotGrants,
  type UserOperationalIdentityHost,
  type UserOperationalIdentitySnapshot,
} from "./user-operational-identity.ts";

function createHost(
  snapshot: UserOperationalIdentitySnapshot,
  request: (method: string, params?: unknown) => Promise<unknown>,
): UserOperationalIdentityHost {
  return {
    client: { request } as UserOperationalIdentityHost["client"],
    connected: true,
    userOperationalIdentities: snapshot,
    userOperationalIdentityBusy: false,
    userOperationalIdentityError: null,
    userOperationalIdentityNotice: null,
    userOperationalIdentityNav: "grants",
    userOperationalIdentityEditorOpen: false,
    userOperationalIdentityEditorProvider: "",
    userOperationalIdentityEditorDisplayName: "",
    userOperationalIdentityEditorCredentialHandleId: "",
    userOperationalIdentityEditorAppId: "",
    userOperationalIdentityEditorAppSecret: "",
    userOperationalIdentityEditorSmtpHost: "",
    userOperationalIdentityEditorSmtpPort: "",
    userOperationalIdentityEditorSmtpUser: "",
    userOperationalIdentityEditorImapHost: "",
    userOperationalIdentityEditorImapPort: "993",
    userOperationalIdentityEditorImapUser: "",
    userOperationalIdentityEditorUsePlatformSmtp: false,
    userOperationalIdentityEditorIdentityId: null,
    wechatPersonalQrWorkerOnline: null,
    wechatPersonalQrStatus: "idle",
    wechatPersonalQrDataUrl: null,
    wechatPersonalQrMessage: null,
    wechatPersonalQrWxid: null,
    userOperationalIdentityOAuthSessionId: null,
    userOperationalIdentityReturnSessionKey: null,
    userOperationalIdentityReturnModule: null,
    userOperationalIdentityContinuationToken: null,
    userOperationalIdentityContinuationNotice: null,
  };
}

const baseSnapshot: UserOperationalIdentitySnapshot = {
  identities: [
    {
      identityId: "id-gh",
      provider: "github-personal",
      providerLabel: "GitHub",
      displayName: "octocat",
      status: "active",
      grantCount: 0,
      createdAt: "2026-06-01T00:00:00.000Z",
      updatedAt: "2026-06-01T00:00:00.000Z",
    },
  ],
  grants: [],
  usageHistory: [],
  pendingBindingRequests: [],
  providerCatalog: [
    {
      provider: "github-personal",
      label: "GitHub",
      category: "developer",
      rolloutTier: "pilot",
      registrationReady: true,
      operationalActions: [
        { action: "create_issue", label: "创建 Issue" },
        { action: "comment", label: "评论" },
      ],
      reauthHint: "",
      degradedHint: null,
    },
  ],
};

describe("applyIdentityOperationalRobotGrants", () => {
  it("upserts newly selected owned robots and refreshes snapshot", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "user-operational-identity.grants.upsert") {
        return { ok: true };
      }
      if (method === "user-operational-identity.list") {
        return {
          ownerId: "u1",
          identities: baseSnapshot.identities,
          grants: [
            {
              grantId: "g1",
              identityId: "id-gh",
              agentId: "bot-a",
              agentScope: "owned",
              allowedActions: ["create_issue", "comment"],
              grantMode: "auto",
              status: "active",
            },
          ],
          usageHistory: [],
          providerCatalog: baseSnapshot.providerCatalog,
        };
      }
      if (method === "user-operational-identity.binding-request.list-pending") {
        return { requests: [] };
      }
      if (method === "user-operational-identity.continuation.list-pending") {
        return { continuations: [] };
      }
      return {};
    });
    const host = createHost(baseSnapshot, request);

    const ok = await applyIdentityOperationalRobotGrants(host, {
      identityId: "id-gh",
      desiredAgentIds: ["bot-a"],
    });

    expect(ok).toBe(true);
    expect(request).toHaveBeenCalledWith("user-operational-identity.grants.upsert", {
      identityId: "id-gh",
      agentId: "bot-a",
      agentScope: "owned",
      allowedActions: ["create_issue", "comment"],
      sessionKey: undefined,
      grantMode: "auto",
      confirmExplicit: false,
    });
    expect(host.userOperationalIdentityNotice).toContain("新增 1");
    expect(host.userOperationalIdentities?.grants).toHaveLength(1);
  });

  it("upserts seat-owned shared robots with explicit confirmation", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "user-operational-identity.grants.upsert") {
        return { ok: true };
      }
      if (method === "user-operational-identity.list") {
        return {
          ownerId: "u1",
          identities: baseSnapshot.identities,
          grants: [
            {
              grantId: "g-shared",
              identityId: "id-gh",
              agentId: "agt-culture",
              agentScope: "shared",
              allowedActions: ["create_issue", "comment"],
              grantMode: "explicit",
              status: "active",
            },
          ],
          usageHistory: [],
          providerCatalog: baseSnapshot.providerCatalog,
        };
      }
      if (method === "user-operational-identity.binding-request.list-pending") {
        return { requests: [] };
      }
      if (method === "user-operational-identity.continuation.list-pending") {
        return { continuations: [] };
      }
      return {};
    });
    const host = createHost(baseSnapshot, request);

    const ok = await applyIdentityOperationalRobotGrants(host, {
      identityId: "id-gh",
      desiredAgentIds: ["agt-culture"],
      agentScopesById: { "agt-culture": "shared" },
    });

    expect(ok).toBe(true);
    expect(request).toHaveBeenCalledWith("user-operational-identity.grants.upsert", {
      identityId: "id-gh",
      agentId: "agt-culture",
      agentScope: "shared",
      allowedActions: ["create_issue", "comment"],
      sessionKey: undefined,
      grantMode: "explicit",
      confirmExplicit: true,
    });
    expect(host.userOperationalIdentities?.grants?.[0]?.agentScope).toBe("shared");
  });

  it("revokes unchecked owned robots", async () => {
    const snapshot: UserOperationalIdentitySnapshot = {
      ...baseSnapshot,
      grants: [
        {
          grantId: "g-old",
          identityId: "id-gh",
          agentId: "bot-a",
          agentScope: "owned",
          allowedActions: ["create_issue"],
          grantMode: "auto",
          status: "active",
        },
      ],
    };
    const request = vi.fn(async (method: string) => {
      if (method === "user-operational-identity.grants.revoke") {
        return { ok: true };
      }
      if (method === "user-operational-identity.list") {
        return {
          ownerId: "u1",
          identities: snapshot.identities,
          grants: [],
          usageHistory: [],
          providerCatalog: snapshot.providerCatalog,
        };
      }
      if (method === "user-operational-identity.binding-request.list-pending") {
        return { requests: [] };
      }
      if (method === "user-operational-identity.continuation.list-pending") {
        return { continuations: [] };
      }
      return {};
    });
    const host = createHost(snapshot, request);

    const ok = await applyIdentityOperationalRobotGrants(host, {
      identityId: "id-gh",
      desiredAgentIds: [],
    });

    expect(ok).toBe(true);
    expect(request).toHaveBeenCalledWith("user-operational-identity.grants.revoke", {
      grantId: "g-old",
    });
    expect(host.userOperationalIdentityNotice).toContain("取消 1");
  });

  it("no-ops when selection is unchanged", async () => {
    const snapshot: UserOperationalIdentitySnapshot = {
      ...baseSnapshot,
      grants: [
        {
          grantId: "g1",
          identityId: "id-gh",
          agentId: "bot-a",
          agentScope: "owned",
          allowedActions: ["create_issue"],
          grantMode: "auto",
          status: "active",
        },
      ],
    };
    const request = vi.fn(async () => ({}));
    const host = createHost(snapshot, request);

    const ok = await applyIdentityOperationalRobotGrants(host, {
      identityId: "id-gh",
      desiredAgentIds: ["bot-a"],
    });

    expect(ok).toBe(true);
    expect(request).not.toHaveBeenCalled();
    expect(host.userOperationalIdentityNotice).toBe("授权未变化。");
  });
});
