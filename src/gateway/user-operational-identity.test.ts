import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../config/config.js";
import {
  completeUserOperationalIdentityBindingRequest,
  createUserOperationalIdentityBindingRequest,
} from "./user-operational-identity-binding-request.js";
import { normalizeUserOperationalIdentityStore } from "./user-operational-identity-persistence.js";
import {
  registerUserOperationalIdentity,
  reauthorizeUserOperationalIdentity,
  recordUserOperationalIdentityUsageEvent,
  revokeUserOperationalIdentity,
  summarizeUserOperationalIdentitySnapshot,
  upsertUserOperationalIdentityGrant,
  listUserOperationalIdentityLifecycleEvents,
  listUserOperationalIdentityUsageEvents,
} from "./user-operational-identity-store.js";

vi.mock("../config/config.js", () => ({
  loadConfig: vi.fn(() => ({})),
}));

vi.mock("./collaboration-learning/shared.js", () => ({
  readConfiguredAgentOwnership: vi.fn(() => null),
}));

vi.mock("./session-utils.js", () => ({
  listAgentsForGateway: vi.fn(() => ({
    agents: [{ id: "main", scope: "self" }],
  })),
}));

describe("user operational identity store", () => {
  const nowIso = "2026-06-06T12:00:00.000Z";
  const ownerId = "user-1";

  beforeEach(() => {
    vi.mocked(loadConfig).mockReturnValue({});
  });

  it("registers pilot provider identity for user owner", () => {
    const store = normalizeUserOperationalIdentityStore(null);
    const result = registerUserOperationalIdentity({
      store,
      ownerId,
      displayName: "My GitHub",
      provider: "github-personal",
      credentialHandleId: "cred-github-1",
      nowIso,
      credentialVerified: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.identity.ownerType).toBe("user");
    expect(result.identity.ownerId).toBe(ownerId);
    expect(result.identity.status).toBe("active");
  });

  it("rejects non-pilot provider registration", () => {
    const store = normalizeUserOperationalIdentityStore(null);
    const result = registerUserOperationalIdentity({
      store,
      ownerId,
      displayName: "Feishu Personal",
      provider: "feishu-personal",
      credentialHandleId: "cred-feishu-1",
      nowIso,
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.code).toBe("USER_IDENTITY_PROVIDER_NOT_READY");
  });

  it("registers personal wechat-official identity when credential is verified", () => {
    const store = normalizeUserOperationalIdentityStore(null);
    const result = registerUserOperationalIdentity({
      store,
      ownerId,
      displayName: "微信公众号",
      provider: "wechat-official",
      credentialHandleId: "cred-oa-1",
      externalAccountId: "wx1234567890abcdef",
      nowIso,
      credentialVerified: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.identity.provider).toBe("wechat-official");
    expect(result.identity.externalAccountId).toBe("wx1234567890abcdef");
  });

  it("revokes and reauthorizes identity", () => {
    const store = normalizeUserOperationalIdentityStore(null);
    const created = registerUserOperationalIdentity({
      store,
      ownerId,
      displayName: "Mailbox",
      provider: "personal-email",
      credentialHandleId: "cred-mail-1",
      nowIso,
      credentialVerified: true,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }
    const revoked = revokeUserOperationalIdentity({
      store,
      ownerId,
      identityId: created.identity.identityId,
      nowIso,
    });
    expect(revoked.ok).toBe(true);
    const reauth = reauthorizeUserOperationalIdentity({
      store,
      ownerId,
      identityId: created.identity.identityId,
      nowIso: "2026-06-06T13:00:00.000Z",
    });
    expect(reauth.ok).toBe(false);
  });

  it("rejects binding request completion before identity is bound", () => {
    const store = normalizeUserOperationalIdentityStore(null);
    const created = createUserOperationalIdentityBindingRequest({
      store,
      ownerId,
      agentId: "main",
      agentScope: "owned",
      provider: "github-personal",
      requestedAction: "create_issue",
      nowIso,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }
    const denied = completeUserOperationalIdentityBindingRequest({
      store,
      ownerId,
      requestId: created.request.requestId,
      nowIso,
    });
    expect(denied.ok).toBe(false);

    registerUserOperationalIdentity({
      store,
      ownerId,
      displayName: "GitHub",
      provider: "github-personal",
      credentialHandleId: "cred-1",
      nowIso,
      credentialVerified: true,
    });
    const completed = completeUserOperationalIdentityBindingRequest({
      store,
      ownerId,
      requestId: created.request.requestId,
      nowIso,
    });
    expect(completed.ok).toBe(true);
  });

  it("summarizes the snapshot into the data the dashboard cards aggregate", () => {
    const store = normalizeUserOperationalIdentityStore(null);
    const identity = registerUserOperationalIdentity({
      store,
      ownerId,
      displayName: "My GitHub",
      provider: "github-personal",
      credentialHandleId: "cred-dash-1",
      nowIso,
      credentialVerified: true,
    });
    expect(identity.ok).toBe(true);
    if (!identity.ok) {
      return;
    }
    const identityId = identity.identity.identityId;

    // Owned agent auto-grant + shared agent explicit grant (the risky one).
    upsertUserOperationalIdentityGrant({
      store,
      ownerId,
      identityId,
      agentId: "agent-owned-1",
      agentScope: "owned",
      grantMode: "auto",
      allowedActions: ["create_issue"],
      nowIso,
    });
    upsertUserOperationalIdentityGrant({
      store,
      ownerId,
      identityId,
      agentId: "agent-shared-1",
      agentScope: "shared",
      grantMode: "explicit",
      allowedActions: ["create_issue"],
      confirmExplicit: true,
      nowIso,
    });

    recordUserOperationalIdentityUsageEvent({
      store,
      ownerId,
      identityId,
      provider: "github-personal",
      agentId: "agent-owned-1",
      action: "create_issue",
      result: "allowed",
      nowIso,
    });
    recordUserOperationalIdentityUsageEvent({
      store,
      ownerId,
      identityId,
      provider: "github-personal",
      agentId: "agent-shared-1",
      action: "create_issue",
      result: "denied",
      denialCode: "USER_IDENTITY_GRANT_REQUIRED",
      nowIso,
    });

    const snapshot = summarizeUserOperationalIdentitySnapshot({ store, ownerId, nowIso });

    // Mirror the client-side aggregation in
    // ui/src/ui/ports/employee/views/workbench-operational-identity-section.ts.
    const activeGrants = snapshot.grants.filter((grant) => grant.status === "active");
    const dashboard = {
      totalIdentities: snapshot.identities.length,
      authorizedAgents: new Set(activeGrants.map((grant) => grant.agentId)).size,
      recentUsages: snapshot.usageHistory.length,
      pendingReauths: snapshot.identities.filter(
        (item) => item.status === "reauth_required" || item.status === "expired",
      ).length,
      riskyAuthorizations: activeGrants.filter((grant) => grant.agentScope !== "owned").length,
    };

    expect(dashboard).toEqual({
      totalIdentities: 1,
      authorizedAgents: 2,
      recentUsages: 2,
      pendingReauths: 0,
      riskyAuthorizations: 1,
    });
    // Per-identity grant count powers the "授权机器人" figure on each card.
    expect(snapshot.identities[0]?.grantCount).toBe(2);
  });

  it("keeps usage history scoped per identity so a busy mailbox cannot starve other hubs", () => {
    const store = normalizeUserOperationalIdentityStore(null);
    const github = registerUserOperationalIdentity({
      store,
      ownerId,
      displayName: "My GitHub",
      provider: "github-personal",
      credentialHandleId: "cred-github-scope",
      nowIso,
      credentialVerified: true,
    });
    const email = registerUserOperationalIdentity({
      store,
      ownerId,
      displayName: "个人邮箱",
      provider: "personal-email",
      credentialHandleId: "cred-email-scope",
      nowIso,
      credentialVerified: true,
    });
    expect(github.ok && email.ok).toBe(true);
    if (!github.ok || !email.ok) {
      return;
    }

    for (let index = 0; index < 12; index += 1) {
      recordUserOperationalIdentityUsageEvent({
        store,
        ownerId,
        identityId: email.identity.identityId,
        provider: "personal-email",
        agentId: "main",
        action: "send_email",
        result: "allowed",
        nowIso: `2026-08-01T00:${String(index).padStart(2, "0")}:00.000Z`,
      });
    }
    recordUserOperationalIdentityUsageEvent({
      store,
      ownerId,
      identityId: github.identity.identityId,
      provider: "github-personal",
      agentId: "main",
      action: "create_issue",
      result: "allowed",
      nowIso: "2026-07-01T00:00:00.000Z",
    });

    const snapshot = summarizeUserOperationalIdentitySnapshot({ store, ownerId, nowIso });
    expect(
      snapshot.usageHistory.some(
        (event) =>
          event.identityId === github.identity.identityId && event.action === "create_issue",
      ),
    ).toBe(true);
    expect(
      snapshot.usageHistory.filter((event) => event.identityId === email.identity.identityId),
    ).toHaveLength(12);

    expect(
      listUserOperationalIdentityUsageEvents(store, ownerId, 20, {
        identityId: github.identity.identityId,
      }),
    ).toEqual([
      expect.objectContaining({
        identityId: github.identity.identityId,
        action: "create_issue",
      }),
    ]);
  });

  it("records append-only lifecycle audit events for create / reauthorize / revoke (Task 2.5)", () => {
    const store = normalizeUserOperationalIdentityStore(null);
    const created = registerUserOperationalIdentity({
      store,
      ownerId,
      displayName: "My GitHub",
      provider: "github-personal",
      credentialHandleId: "cred-lifecycle-1",
      nowIso,
      credentialVerified: true,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }
    const identityId = created.identity.identityId;

    reauthorizeUserOperationalIdentity({ store, ownerId, identityId, nowIso });
    revokeUserOperationalIdentity({ store, ownerId, identityId, nowIso });

    const events = listUserOperationalIdentityLifecycleEvents(store, ownerId);
    const actions = events.map((event) => event.action).toSorted();
    expect(actions).toEqual(["created", "reauthorized", "revoked"]);
    for (const event of events) {
      expect(event.ownerId).toBe(ownerId);
      expect(event.identityId).toBe(identityId);
      expect(event.provider).toBe("github-personal");
    }
  });
});
