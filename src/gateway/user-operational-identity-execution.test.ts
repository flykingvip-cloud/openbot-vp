import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../config/config.js";
import { executeUserOperationalIdentityAction } from "./user-operational-identity-execution.js";
import { normalizeUserOperationalIdentityStore } from "./user-operational-identity-persistence.js";
import { executeUserOperationalIdentityRuntimeAction } from "./user-operational-identity-runtime.js";
import * as secretsModule from "./user-operational-identity-secrets.js";
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
      { id: "agent-owned-1", scope: "self" },
      { id: "agent-shared-1", scope: "shared" },
      { id: "main", scope: "self" },
    ],
  })),
}));

vi.mock("./user-operational-identity-session.js", () => ({
  resolveOperationalIdentityActorUserId: vi.fn(async ({ client }: { client: { user?: string } }) =>
    client.user?.trim() ? "user-1" : null,
  ),
  resolveTrustedPlatformAuthUserId: vi.fn(async ({ client }: { client: { user?: string } }) =>
    client.user?.trim() ? "user-1" : null,
  ),
}));

describe("user operational identity execution", () => {
  const nowIso = "2026-06-06T12:00:00.000Z";
  const ownerId = "user-1";
  const ownedAgentId = "agent-owned-1";
  const sharedAgentId = "agent-shared-1";
  const handleId = "cred-github-1";

  beforeEach(() => {
    vi.mocked(loadConfig).mockReturnValue({});
    vi.restoreAllMocks();
    vi.spyOn(
      secretsModule,
      "loadUserOperationalIdentityCredentialSecretForHandle",
    ).mockResolvedValue({
      handleId,
      ownerId,
      provider: "github-personal",
      kind: "simulated",
      accessToken: "simulated:github-personal:user-1",
      accountLabel: "octocat",
      createdAt: nowIso,
      updatedAt: nowIso,
    });
  });

  function seedIdentity(store: ReturnType<typeof normalizeUserOperationalIdentityStore>) {
    const created = registerUserOperationalIdentity({
      store,
      ownerId,
      displayName: "My GitHub",
      provider: "github-personal",
      credentialHandleId: handleId,
      nowIso,
      credentialVerified: true,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      throw new Error("seed failed");
    }
    return created.identity;
  }

  it("executes simulated github create_issue without exposing accessToken", async () => {
    const store = normalizeUserOperationalIdentityStore(null);
    const identity = seedIdentity(store);
    const result = await executeUserOperationalIdentityAction({
      store,
      identity,
      provider: "github-personal",
      action: "create_issue",
      payload: {
        owner: "octocat",
        repo: "hello-world",
        title: "Bug report",
        body: "Something broke",
      },
      ownerId,
      agentId: ownedAgentId,
      nowIso,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.simulated).toBe(true);
    expect(result.output.issueNumber).toBeTypeOf("number");
    expect(result.output.htmlUrl).toContain("github.com/octocat/hello-world/issues/");
    expect(result.credential.simulated).toBe(true);
    expect(JSON.stringify(result)).not.toContain("simulated:github-personal");
    expect(JSON.stringify(result)).not.toContain("accessToken");
  });

  it("denies execution when credential secret is missing", async () => {
    vi.mocked(secretsModule.loadUserOperationalIdentityCredentialSecretForHandle).mockResolvedValue(
      null,
    );
    const store = normalizeUserOperationalIdentityStore(null);
    const identity = seedIdentity(store);
    const result = await executeUserOperationalIdentityAction({
      store,
      identity,
      provider: "github-personal",
      action: "create_issue",
      payload: { owner: "octocat", repo: "hello-world", title: "Bug report" },
      ownerId,
      agentId: ownedAgentId,
      nowIso,
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.code).toBe("USER_IDENTITY_CREDENTIAL_SECRET_MISSING");
    expect(Object.values(store.usageEvents)).toHaveLength(1);
    expect(Object.values(store.usageEvents)[0]?.result).toBe("denied");
  });

  it("runtime execute denies shared agent without grant", async () => {
    const store = normalizeUserOperationalIdentityStore(null);
    seedIdentity(store);
    const persistence = await import("./user-operational-identity-persistence.js");
    vi.spyOn(persistence, "loadUserOperationalIdentityStore").mockResolvedValue(store);
    vi.spyOn(persistence, "withUserOperationalIdentityStoreWriteLock").mockImplementation(
      async (fn) => fn(store),
    );
    vi.spyOn(persistence, "withUserOperationalIdentityStoreWriteLockForOwner").mockImplementation(
      async (_params, fn) => fn(store),
    );

    const result = await executeUserOperationalIdentityRuntimeAction({
      client: { connect: {} as never, user: "user@example.com", sessionDomain: "platform" },
      provider: "github-personal",
      action: "create_issue",
      payload: { owner: "octocat", repo: "hello-world", title: "Bug report" },
      agentId: sharedAgentId,
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.needsGrantConfirmation).toBe(true);
  });

  it("runtime execute succeeds for owned agent with simulated secret", async () => {
    const store = normalizeUserOperationalIdentityStore(null);
    seedIdentity(store);
    const persistence = await import("./user-operational-identity-persistence.js");
    vi.spyOn(persistence, "loadUserOperationalIdentityStore").mockResolvedValue(store);
    vi.spyOn(persistence, "withUserOperationalIdentityStoreWriteLock").mockImplementation(
      async (fn) => fn(store),
    );
    vi.spyOn(persistence, "withUserOperationalIdentityStoreWriteLockForOwner").mockImplementation(
      async (_params, fn) => fn(store),
    );

    const result = await executeUserOperationalIdentityRuntimeAction({
      client: { connect: {} as never, user: "user@example.com", sessionDomain: "platform" },
      provider: "github-personal",
      action: "create_issue",
      payload: { owner: "octocat", repo: "hello-world", title: "Ship it" },
      agentId: ownedAgentId,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.execution.simulated).toBe(true);
    expect(result.execution.output.title).toBe("Ship it");
    expect(Object.values(store.usageEvents).some((event) => event.result === "allowed")).toBe(true);
  });

  it("runtime execute allows shared agent after explicit grant", async () => {
    const store = normalizeUserOperationalIdentityStore(null);
    const identity = seedIdentity(store);
    upsertUserOperationalIdentityGrant({
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
    const persistence = await import("./user-operational-identity-persistence.js");
    vi.spyOn(persistence, "loadUserOperationalIdentityStore").mockResolvedValue(store);
    vi.spyOn(persistence, "withUserOperationalIdentityStoreWriteLock").mockImplementation(
      async (fn) => fn(store),
    );
    vi.spyOn(persistence, "withUserOperationalIdentityStoreWriteLockForOwner").mockImplementation(
      async (_params, fn) => fn(store),
    );

    const result = await executeUserOperationalIdentityRuntimeAction({
      client: { connect: {} as never, user: "user@example.com", sessionDomain: "platform" },
      provider: "github-personal",
      action: "create_issue",
      payload: { owner: "octocat", repo: "hello-world", title: "Shared agent issue" },
      agentId: sharedAgentId,
    });
    expect(result.ok).toBe(true);
  });

  it("executes personal-email via smtp credential kind", async () => {
    vi.spyOn(
      secretsModule,
      "loadUserOperationalIdentityCredentialSecretForHandle",
    ).mockResolvedValue({
      handleId,
      ownerId,
      provider: "personal-email",
      kind: "smtp",
      accessToken: "app-password",
      accountLabel: "user@example.com",
      metadata: { source: "platform_env" },
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    const smtpModule = await import("./user-operational-identity-smtp.js");
    vi.spyOn(smtpModule, "sendUserOperationalIdentityEmail").mockResolvedValue({
      messageId: "msg-123",
      from: "user@example.com",
      status: "sent",
      attachmentCount: 0,
    });
    const store = normalizeUserOperationalIdentityStore(null);
    const identity = registerUserOperationalIdentity({
      store,
      ownerId,
      displayName: "Mailbox",
      provider: "personal-email",
      credentialHandleId: handleId,
      nowIso,
      credentialVerified: true,
    });
    expect(identity.ok).toBe(true);
    if (!identity.ok) {
      return;
    }
    const result = await executeUserOperationalIdentityAction({
      store,
      identity: identity.identity,
      provider: "personal-email",
      action: "send_email",
      payload: {
        to: "team@example.com",
        subject: "Hello",
        message: "Body",
      },
      ownerId,
      agentId: ownedAgentId,
      nowIso,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.simulated).toBe(false);
    expect(result.output.status).toBe("sent");
    expect(result.output.attachmentCount).toBe(0);
    const recorded = Object.values(store.usageEvents).find(
      (event) => event.action === "send_email",
    );
    expect(recorded?.summary).toMatchObject({
      headline: "team@example.com · Hello",
      recipients: ["team@example.com"],
      subject: "Hello",
    });
  });

  it("passes decoded send_email attachments to smtp", async () => {
    vi.spyOn(
      secretsModule,
      "loadUserOperationalIdentityCredentialSecretForHandle",
    ).mockResolvedValue({
      handleId,
      ownerId,
      provider: "personal-email",
      kind: "smtp",
      accessToken: "app-password",
      accountLabel: "user@example.com",
      metadata: { source: "platform_env" },
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    const smtpModule = await import("./user-operational-identity-smtp.js");
    const sendSpy = vi.spyOn(smtpModule, "sendUserOperationalIdentityEmail").mockResolvedValue({
      messageId: "msg-att",
      from: "user@example.com",
      status: "sent",
      attachmentCount: 1,
    });
    const store = normalizeUserOperationalIdentityStore(null);
    const identity = registerUserOperationalIdentity({
      store,
      ownerId,
      displayName: "Mailbox",
      provider: "personal-email",
      credentialHandleId: handleId,
      nowIso,
      credentialVerified: true,
    });
    expect(identity.ok).toBe(true);
    if (!identity.ok) {
      return;
    }
    const bytes = Buffer.from("deck-bytes");
    const result = await executeUserOperationalIdentityAction({
      store,
      identity: identity.identity,
      provider: "personal-email",
      action: "send_email",
      payload: {
        to: "hedon@example.com",
        subject: "Deck",
        message: "See attached",
        filename: "OpenBot_投资介绍.pptx",
        buffer: bytes.toString("base64"),
      },
      ownerId,
      agentId: ownedAgentId,
      nowIso,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(sendSpy).toHaveBeenCalledOnce();
    const sent = sendSpy.mock.calls[0]?.[0];
    expect(sent?.attachments).toHaveLength(1);
    expect(sent?.attachments?.[0]?.filename).toBe("OpenBot_投资介绍.pptx");
    expect(sent?.attachments?.[0]?.content.equals(bytes)).toBe(true);
    expect(result.output.attachmentCount).toBe(1);
  });
});
