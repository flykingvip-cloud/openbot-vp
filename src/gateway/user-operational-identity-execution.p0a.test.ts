// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeUserOperationalIdentityAction } from "./user-operational-identity-execution.js";
import { normalizeUserOperationalIdentityStore } from "./user-operational-identity-persistence.js";
import * as secretsModule from "./user-operational-identity-secrets.js";
import * as socialExecution from "./user-operational-identity-social-execution.js";
import { registerUserOperationalIdentity } from "./user-operational-identity-store.js";

vi.mock("../config/config.js", () => ({
  loadConfig: vi.fn(() => ({})),
}));

describe("P0a execution caller must not record unsupported as success", () => {
  const nowIso = "2026-10-26T03:00:00.000Z";
  const ownerId = "user-1";
  const agentId = "agent-1";
  const handleId = "cred-x-1";

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(
      secretsModule,
      "loadUserOperationalIdentityCredentialSecretForHandle",
    ).mockResolvedValue({
      handleId,
      ownerId,
      provider: "x-twitter",
      kind: "oauth_token",
      accessToken: "tok",
      createdAt: nowIso,
      updatedAt: nowIso,
      metadata: { scope: "tweet.write" },
    });
  });

  it("returns ok:false and audits denied for unsupported social actions", async () => {
    vi.spyOn(socialExecution, "executeUserOperationalIdentitySocialAction").mockResolvedValue({
      unsupported: true,
      simulated: false,
      provider: "x-twitter",
      action: "search_tweets",
      code: "USER_IDENTITY_ACTION_UNSUPPORTED",
      message: "Action search_tweets is not supported for x-twitter.",
    });

    const store = normalizeUserOperationalIdentityStore(null);
    const created = registerUserOperationalIdentity({
      store,
      ownerId,
      displayName: "X",
      provider: "x-twitter",
      credentialHandleId: handleId,
      nowIso,
      credentialVerified: true,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      throw new Error("seed failed");
    }

    const result = await executeUserOperationalIdentityAction({
      store,
      identity: created.identity,
      provider: "x-twitter",
      action: "search_tweets",
      payload: { message: "q" },
      ownerId,
      agentId,
      nowIso,
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected failure");
    }
    expect(result.code).toBe("USER_IDENTITY_ACTION_UNSUPPORTED");

    const events = Object.values(store.usageEvents);
    expect(events.length).toBeGreaterThan(0);
    const last = events[events.length - 1];
    expect(last?.result).toBe("denied");
    expect(last?.denialCode).toBe("USER_IDENTITY_ACTION_UNSUPPORTED");
  });
});
