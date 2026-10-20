import { beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeUserOperationalIdentityStore } from "./user-operational-identity-persistence.js";
import {
  registerUserOperationalIdentity,
  upsertUserOperationalIdentityGrant,
} from "./user-operational-identity-store.js";

const loadUserOperationalIdentityStoreMock = vi.hoisted(() => vi.fn());

vi.mock("./user-operational-identity-persistence.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./user-operational-identity-persistence.js")>();
  return {
    ...actual,
    loadUserOperationalIdentityStore: (...args: unknown[]) =>
      loadUserOperationalIdentityStoreMock(...args),
  };
});

vi.mock("./tenant-context.js", () => ({
  resolveUserOperationalIdentityStorePathForClient: vi.fn(async () => undefined),
}));

const { resolveUserOperationalIdentityRuntimeScope, listUserOperationalIdentityRuntimeAccess } =
  await import("./user-operational-identity-runtime.js");

const NOW = "2026-09-19T09:32:08.038Z";
const OWNER_ID = "90fed19a-1c8b-4420-87e0-bcc6165e32fa";

function grantStore() {
  const store = normalizeUserOperationalIdentityStore(null);
  const created = registerUserOperationalIdentity({
    store,
    ownerId: OWNER_ID,
    displayName: "微信公众号",
    provider: "wechat-official",
    credentialHandleId: "cred-wechat-1",
    nowIso: NOW,
    credentialVerified: true,
  });
  if (!created.ok) {
    throw new Error(created.error);
  }
  upsertUserOperationalIdentityGrant({
    store,
    ownerId: OWNER_ID,
    identityId: created.identity.identityId,
    agentId: "bot--agent",
    agentScope: "owned",
    allowedActions: ["verify_credentials", "get_publish_status"],
    grantMode: "auto",
    nowIso: NOW,
  });
  return store;
}

beforeEach(() => {
  vi.clearAllMocks();
  loadUserOperationalIdentityStoreMock.mockResolvedValue(grantStore());
});

describe("resolveUserOperationalIdentityRuntimeScope", () => {
  it("resolves from a unique personal grant when the agent session has no user client", async () => {
    const scope = await resolveUserOperationalIdentityRuntimeScope({
      client: null,
      agentId: "bot--agent",
    });
    expect(scope).toEqual({
      ownerId: OWNER_ID,
      agentId: "bot--agent",
      sessionKey: null,
    });
  });

  it("does not use grant fallback when explicitly disabled", async () => {
    const scope = await resolveUserOperationalIdentityRuntimeScope({
      client: null,
      agentId: "bot--agent",
      allowGrantFallback: false,
    });
    expect(scope).toBeNull();
  });

  it("lists only identities granted to this agent", async () => {
    const access = await listUserOperationalIdentityRuntimeAccess({
      client: null,
      agentId: "bot--agent",
    });
    expect(access?.scope.agentId).toBe("bot--agent");
    expect(access?.entries).toEqual([
      expect.objectContaining({
        provider: "wechat-official",
        hasGrant: true,
        allowedActions: ["verify_credentials", "get_publish_status"],
      }),
    ]);
  });
});
