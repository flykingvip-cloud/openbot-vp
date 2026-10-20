// Feature: shared-agent-identity-access-control-plane

import { describe, expect, it } from "vitest";
import type { AuthoritativeEnterpriseScope } from "../platform-auth/active-membership-scope.js";
import { resolveAgentCreateOwnership } from "./agent-create-ownership.js";

const canonicalize = (value: string | null | undefined): string | null =>
  value?.trim().toLowerCase() || null;

function authoritative(enterpriseId = "ent-a"): AuthoritativeEnterpriseScope {
  return {
    kind: "authoritative",
    enterpriseId,
    user: { id: "user-1" },
    membership: { id: "membership-1", enterpriseId },
  } as unknown as AuthoritativeEnterpriseScope;
}

function denied(): AuthoritativeEnterpriseScope {
  return { kind: "deny", reason: "membership-ambiguous" };
}

/** Seats that exist, keyed by id, with the tenant each belongs to. */
const SEATS: Record<string, string> = { "seat-1": "ent-a", "seat-b1": "ent-b" };

function resolve(params: {
  scope: AuthoritativeEnterpriseScope;
  tenantId?: string | null;
  ownerUserId?: string | null;
  ownerPositionId?: string | null;
  seats?: Record<string, string>;
}) {
  const seats = params.seats ?? SEATS;
  return resolveAgentCreateOwnership({
    scope: params.scope,
    client: { user: "member@example.com" },
    requestedTenantId: params.tenantId ?? null,
    requestedOwnerUserId: params.ownerUserId ?? null,
    requestedOwnerPositionId: params.ownerPositionId ?? null,
    canonicalize,
    isSeatInTenant: ({ tenantId, seatId }) => seats[seatId] === tenantId,
  });
}

describe("agent create ownership resolution", () => {
  it("takes the tenant from the session, not the request body", () => {
    expect(
      resolve({ scope: authoritative(), tenantId: "ent-a", ownerPositionId: "seat-1" }),
    ).toEqual({
      kind: "enterprise",
      tenantId: "ent-a",
      actorUserId: "user-1",
      actorMembershipId: "membership-1",
      ownerPositionId: "seat-1",
    });
  });

  it("rejects a requested tenant that is not the authenticated one", () => {
    expect(
      resolve({ scope: authoritative(), tenantId: "ent-b", ownerPositionId: "seat-1" }),
    ).toMatchObject({ kind: "reject", code: "TENANT_MISMATCH" });
  });

  it("refuses to record another user as the audit actor", () => {
    expect(
      resolve({
        scope: authoritative(),
        tenantId: "ent-a",
        ownerUserId: "user-someone-else",
        ownerPositionId: "seat-1",
      }),
    ).toMatchObject({ kind: "reject", code: "OWNER_ACTOR_MISMATCH" });
  });

  it("accepts the caller's own id as ownerUserId", () => {
    expect(
      resolve({
        scope: authoritative(),
        tenantId: "ent-a",
        ownerUserId: "user-1",
        ownerPositionId: "seat-1",
      }),
    ).toMatchObject({ kind: "enterprise", actorUserId: "user-1" });
  });

  it("requires a seat for an enterprise agent", () => {
    expect(resolve({ scope: authoritative(), tenantId: "ent-a" })).toMatchObject({
      kind: "reject",
      code: "POSITION_REQUIRED",
    });
  });

  it("derives the tenant when only a seat is requested", () => {
    expect(resolve({ scope: authoritative(), ownerPositionId: "seat-1" })).toMatchObject({
      kind: "enterprise",
      tenantId: "ent-a",
      ownerPositionId: "seat-1",
    });
  });

  it("keeps a bare create local even for an enterprise member", () => {
    expect(resolve({ scope: authoritative() })).toEqual({ kind: "local" });
  });

  it("refuses a seat id that does not exist", () => {
    // Regression: the seat id was taken from the request body unverified, so a client could
    // write ownership pointing at a phantom seat.
    expect(
      resolve({
        scope: authoritative(),
        tenantId: "ent-a",
        ownerPositionId: "seat-does-not-exist",
      }),
    ).toMatchObject({ kind: "reject", code: "POSITION_NOT_IN_TENANT" });
  });

  it("refuses a real seat that belongs to another enterprise", () => {
    // The seat exists, so an existence check alone is not enough; it has to be the
    // authoritative enterprise's seat.
    expect(
      resolve({ scope: authoritative(), tenantId: "ent-a", ownerPositionId: "seat-b1" }),
    ).toMatchObject({ kind: "reject", code: "POSITION_NOT_IN_TENANT" });
  });

  it("verifies the seat against the session enterprise, not the requested one", () => {
    // A caller authenticated for ent-b cannot borrow ent-a's seat by omitting tenantId.
    expect(resolve({ scope: authoritative("ent-b"), ownerPositionId: "seat-1" })).toMatchObject({
      kind: "reject",
      code: "POSITION_NOT_IN_TENANT",
    });
    expect(resolve({ scope: authoritative("ent-b"), ownerPositionId: "seat-b1" })).toMatchObject({
      kind: "enterprise",
      tenantId: "ent-b",
      ownerPositionId: "seat-b1",
    });
  });

  it("refuses a tenant when the session has no authoritative enterprise", () => {
    const result = resolve({ scope: denied(), tenantId: "ent-a", ownerPositionId: "seat-1" });
    expect(result).toMatchObject({
      kind: "reject",
      code: "NO_AUTHORITATIVE_TENANT",
      scopeKind: "deny",
      denyReason: "membership-ambiguous",
    });
    if (result.kind === "reject") {
      expect(result.message).toContain("deny/membership-ambiguous");
      expect(result.message).toContain("重新登录");
    }
  });

  it("still allows a local create without a platform session", () => {
    expect(resolve({ scope: { kind: "no-platform-identity", claimedIdentity: false } })).toEqual({
      kind: "local",
    });
  });
});
