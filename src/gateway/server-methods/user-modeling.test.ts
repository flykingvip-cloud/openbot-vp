import { describe, expect, it, vi } from "vitest";
import { userModelingHandlers } from "./user-modeling.js";

vi.mock("../tenant-context.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../tenant-context.js")>();
  return {
    ...actual,
    resolveAuthoritativeMembership: vi.fn(async (client: { user?: string } | null) => {
      const email = client?.user?.trim().toLowerCase();
      if (email === "alice@acme.com") {
        return { tenantId: "acme", userId: "u-alice" };
      }
      return { tenantId: null, userId: null };
    }),
  };
});

vi.mock("../user-modeling/user-profile-store.js", () => ({
  readUserProfileOrDefault: vi.fn(async () => ({
    preferredOutputFormat: "concise",
    preferredTone: "neutral",
    confirmationPreference: "confirm_first",
    verbosity: "terse",
    observations: { preferredOutputFormat: 1 },
  })),
  resetUserProfile: vi.fn(async () => undefined),
  readUserProfileByHash: vi.fn(async () => null),
  resetUserProfileByHash: vi.fn(async () => undefined),
}));

vi.mock("../user-modeling/user-key.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../user-modeling/user-key.js")>();
  return {
    ...actual,
    resolveUserModelingKeyForClient: vi.fn(async (client: { user?: string } | null) => {
      if (!client?.user) {
        return null;
      }
      return {
        canonicalId: "webchat:alice@acme.com",
        tenantId: "acme",
      };
    }),
  };
});

function mkRespond() {
  let payload: { ok: boolean; result?: unknown; error?: unknown } | null = null;
  const respond = (ok: boolean, result?: unknown, error?: unknown) => {
    payload = { ok, result, error };
  };
  return { respond, get: () => payload };
}

describe("user-modeling RPC", () => {
  it("returns sanitized profile without echoing canonical id", async () => {
    const { respond, get } = mkRespond();
    await userModelingHandlers["user-modeling.get-profile"]({
      respond,
      client: { user: "alice@acme.com", sessionDomain: "employee" },
      params: {},
    } as never);

    expect(get()?.ok).toBe(true);
    const result = get()?.result as {
      userKeyHash: string;
      profile: { preferredOutputFormat: string };
    };
    expect(result.profile.preferredOutputFormat).toBe("concise");
    expect(JSON.stringify(result)).not.toContain("alice@acme.com");
    expect(result.userKeyHash.length).toBe(32);
  });

  it("requires identity for reset-profile", async () => {
    const { respond, get } = mkRespond();
    await userModelingHandlers["user-modeling.reset-profile"]({
      respond,
      client: null,
      params: {},
    } as never);
    expect(get()?.ok).toBe(false);
  });

  it("blocks admin read without enterprise session", async () => {
    const { respond, get } = mkRespond();
    await userModelingHandlers["user-modeling.admin.get-profile"]({
      respond,
      client: { user: "alice@acme.com", sessionDomain: "platform" },
      params: { userKeyHash: "abc123" },
    } as never);
    expect(get()?.ok).toBe(false);
  });
});
