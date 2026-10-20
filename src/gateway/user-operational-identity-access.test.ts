import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../config/config.js";
import { resolveUserOperationalIdentity } from "./user-operational-identity-access.js";
import { normalizeUserOperationalIdentityStore } from "./user-operational-identity-persistence.js";
import {
  listUserOperationalIdentityGrantsForAgent,
  registerUserOperationalIdentity,
  upsertUserOperationalIdentityGrant,
} from "./user-operational-identity-store.js";

vi.mock("../config/config.js", () => ({
  loadConfig: vi.fn(() => ({})),
}));

vi.mock("./collaboration-learning/shared.js", () => ({
  readConfiguredAgentOwnership: vi.fn(() => null),
}));

vi.mock("./session-utils.js", () => ({
  listAgentsForGateway: vi.fn(() => ({
    agents: [
      { id: "agent-owned-1", scope: "self" },
      { id: "agent-shared-1", scope: "shared" },
      { id: "main", scope: "self" },
    ],
  })),
}));

describe("user operational identity access", () => {
  const nowIso = "2026-06-06T12:00:00.000Z";
  const ownerId = "user-1";
  const ownedAgentId = "agent-owned-1";
  const sharedAgentId = "agent-shared-1";
  const groupSessionKey = "space:team-alpha";

  beforeEach(() => {
    vi.mocked(loadConfig).mockReturnValue({});
  });

  function seedIdentity(store: ReturnType<typeof normalizeUserOperationalIdentityStore>) {
    const created = registerUserOperationalIdentity({
      store,
      ownerId,
      displayName: "My GitHub",
      provider: "github-personal",
      credentialHandleId: "cred-github-1",
      nowIso,
      credentialVerified: true,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      throw new Error("seed failed");
    }
    return created.identity;
  }

  it("auto-grants owned agent on first resolve", () => {
    const store = normalizeUserOperationalIdentityStore(null);
    seedIdentity(store);
    const result = resolveUserOperationalIdentity({
      store,
      provider: "github-personal",
      action: "create_issue",
      currentUserId: ownerId,
      currentAgentId: ownedAgentId,
      nowIso,
    });
    expect(result.allowed).toBe(true);
  });

  it("does not elevate shared agent when client forges ownedAgentIds", () => {
    const store = normalizeUserOperationalIdentityStore(null);
    seedIdentity(store);
    const result = resolveUserOperationalIdentity({
      store,
      provider: "github-personal",
      action: "create_issue",
      currentUserId: ownerId,
      currentAgentId: sharedAgentId,
      ownedAgentIds: [sharedAgentId],
      nowIso,
    });
    expect(result.allowed).toBe(false);
    if (result.allowed) {
      return;
    }
    expect(result.needsGrantConfirmation).toBe(true);
  });

  it("denies shared agent until explicit grant confirmation", () => {
    const store = normalizeUserOperationalIdentityStore(null);
    const identity = seedIdentity(store);
    const denied = resolveUserOperationalIdentity({
      store,
      provider: "github-personal",
      action: "create_issue",
      currentUserId: ownerId,
      currentAgentId: sharedAgentId,
      nowIso,
    });
    expect(denied.allowed).toBe(false);
    if (denied.allowed) {
      return;
    }
    expect(denied.needsGrantConfirmation).toBe(true);

    const grant = upsertUserOperationalIdentityGrant({
      store,
      ownerId,
      identityId: identity.identityId,
      agentId: sharedAgentId,
      agentScope: "shared",
      grantMode: "explicit",
      allowedActions: ["create_issue"],
      confirmExplicit: true,
      nowIso,
    });
    expect(grant.ok).toBe(true);
    const allowed = resolveUserOperationalIdentity({
      store,
      provider: "github-personal",
      action: "create_issue",
      currentUserId: ownerId,
      currentAgentId: sharedAgentId,
      nowIso,
    });
    expect(allowed.allowed).toBe(true);
  });

  it("denies group session by default", () => {
    const store = normalizeUserOperationalIdentityStore(null);
    seedIdentity(store);
    const result = resolveUserOperationalIdentity({
      store,
      provider: "github-personal",
      action: "create_issue",
      currentUserId: ownerId,
      currentAgentId: sharedAgentId,
      sessionKey: groupSessionKey,
      nowIso,
    });
    expect(result.allowed).toBe(false);
    if (result.allowed) {
      return;
    }
    expect(result.code).toBe("USER_IDENTITY_GRANT_CONFIRMATION_REQUIRED");
  });

  it("records usage history for allow and deny", () => {
    const store = normalizeUserOperationalIdentityStore(null);
    seedIdentity(store);
    resolveUserOperationalIdentity({
      store,
      provider: "github-personal",
      action: "create_issue",
      currentUserId: ownerId,
      currentAgentId: ownedAgentId,
      nowIso,
    });
    resolveUserOperationalIdentity({
      store,
      provider: "github-personal",
      action: "create_issue",
      currentUserId: ownerId,
      currentAgentId: sharedAgentId,
      sessionKey: groupSessionKey,
      nowIso: "2026-06-06T12:01:00.000Z",
    });
    const events = Object.values(store.usageEvents);
    expect(events.some((event) => event.result === "allowed")).toBe(true);
    expect(events.some((event) => event.result === "denied")).toBe(true);
  });

  it("lists active grants for any agent without requiring a user session", () => {
    const store = normalizeUserOperationalIdentityStore(null);
    const identity = seedIdentity(store);
    upsertUserOperationalIdentityGrant({
      store,
      ownerId,
      identityId: identity.identityId,
      agentId: sharedAgentId,
      agentScope: "shared",
      allowedActions: ["create_issue"],
      grantMode: "explicit",
      confirmExplicit: true,
      nowIso,
    });
    expect(
      listUserOperationalIdentityGrantsForAgent(store, { agentId: sharedAgentId }).map(
        (grant) => grant.agentId,
      ),
    ).toEqual([sharedAgentId]);
    expect(listUserOperationalIdentityGrantsForAgent(store, { agentId: "other-bot" })).toEqual([]);
  });
});
