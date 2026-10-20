import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../config/config.js";
import {
  completeOAuthForUserOperationalIdentityContinuation,
  createUserOperationalIdentityContinuation,
  refreshUserOperationalIdentityContinuations,
  resumeUserOperationalIdentityContinuation,
} from "./user-operational-identity-continuation.js";
import { normalizeUserOperationalIdentityStore } from "./user-operational-identity-persistence.js";
import {
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
      { id: "main", scope: "self" },
      { id: "shared-main", scope: "shared" },
    ],
  })),
}));

describe("user operational identity continuation", () => {
  beforeEach(() => {
    vi.mocked(loadConfig).mockReturnValue({});
  });

  it("marks continuation ready after binding, oauth, and auto-resumes task", () => {
    const nowIso = "2026-06-06T12:00:00.000Z";
    const store = normalizeUserOperationalIdentityStore(null);
    const ownerId = "user-1";

    const created = createUserOperationalIdentityContinuation({
      store,
      ownerId,
      agentId: "main",
      agentScope: "owned",
      provider: "github-personal",
      requestedAction: "create_issue",
      sessionKey: "agent:main:main",
      workbenchModule: "assistant",
      resumeMessage: "请继续发布 release notes",
      autoResume: true,
      nowIso,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }

    registerUserOperationalIdentity({
      store,
      ownerId,
      displayName: "GitHub",
      provider: "github-personal",
      credentialHandleId: "cred-1",
      nowIso,
      credentialVerified: true,
    });
    completeOAuthForUserOperationalIdentityContinuation({
      store,
      ownerId,
      continuationToken: created.continuation.continuationToken,
      provider: "github-personal",
      nowIso,
    });

    refreshUserOperationalIdentityContinuations({
      store,
      ownerId,
      nowIso,
    });
    expect(created.continuation.status).toBe("ready_to_resume");

    const resumed = resumeUserOperationalIdentityContinuation({
      store,
      ownerId,
      continuationToken: created.continuation.continuationToken,
      nowIso,
    });
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) {
      return;
    }
    expect(resumed.resume.autoResume).toBe(true);
    expect(resumed.resume.resumeMessage).toContain("继续发布");
    expect(resumed.continuation.status).toBe("resumed");
  });

  it("tracks multi-provider orchestration before resume", () => {
    const nowIso = "2026-06-06T12:00:00.000Z";
    const store = normalizeUserOperationalIdentityStore(null);
    const ownerId = "user-1";

    const created = createUserOperationalIdentityContinuation({
      store,
      ownerId,
      agentId: "shared-main",
      agentScope: "shared",
      provider: "github-personal",
      requestedAction: "create_issue",
      requiredProviders: ["github-personal", "personal-email"],
      resumeMessage: "multi-provider publish",
      nowIso,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }

    registerUserOperationalIdentity({
      store,
      ownerId,
      displayName: "GitHub",
      provider: "github-personal",
      credentialHandleId: "cred-1",
      nowIso,
      credentialVerified: true,
    });
    completeOAuthForUserOperationalIdentityContinuation({
      store,
      ownerId,
      continuationToken: created.continuation.continuationToken,
      provider: "github-personal",
      nowIso,
    });
    refreshUserOperationalIdentityContinuations({
      store,
      ownerId,
      nowIso,
    });
    expect(created.continuation.status).toBe("pending_binding");

    registerUserOperationalIdentity({
      store,
      ownerId,
      displayName: "Email",
      provider: "personal-email",
      credentialHandleId: "cred-2",
      nowIso,
      credentialVerified: true,
    });
    completeOAuthForUserOperationalIdentityContinuation({
      store,
      ownerId,
      continuationToken: created.continuation.continuationToken,
      provider: "personal-email",
      nowIso,
    });
    const identity = Object.values(store.identities).find(
      (entry) => entry.provider === "github-personal",
    );
    if (!identity) {
      throw new Error("missing github identity");
    }
    upsertUserOperationalIdentityGrant({
      store,
      ownerId,
      identityId: identity.identityId,
      agentId: "shared-main",
      agentScope: "shared",
      grantMode: "explicit",
      allowedActions: ["create_issue"],
      confirmExplicit: true,
      nowIso,
    });
    refreshUserOperationalIdentityContinuations({
      store,
      ownerId,
      nowIso,
    });
    expect(created.continuation.status).toBe("ready_to_resume");
  });
});
