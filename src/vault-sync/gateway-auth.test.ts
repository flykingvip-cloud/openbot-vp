import { describe, expect, it } from "vitest";
import {
  assertVaultSyncActorMatches,
  resolveVaultSyncActor,
  VAULT_SYNC_LOCAL_OPERATOR,
  VaultSyncAuthError,
} from "./gateway-auth.js";

describe("vault-sync gateway auth", () => {
  it("uses client.user when authenticated", () => {
    expect(resolveVaultSyncActor({ user: "alice@acme.test" })).toBe("alice@acme.test");
  });

  it("falls back to local-operator when unauthenticated", () => {
    expect(resolveVaultSyncActor(null)).toBe(VAULT_SYNC_LOCAL_OPERATOR);
  });

  it("rejects forged param account when session user is set", () => {
    expect(() =>
      assertVaultSyncActorMatches({ user: "alice@acme.test" }, "bob@acme.test", "ownerAccountId"),
    ).toThrow(VaultSyncAuthError);
  });

  it("allows matching param account", () => {
    expect(
      assertVaultSyncActorMatches({ user: "alice@acme.test" }, "alice@acme.test", "actorAccountId"),
    ).toBe("alice@acme.test");
  });
});
