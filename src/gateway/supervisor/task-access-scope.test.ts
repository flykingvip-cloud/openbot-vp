import { describe, expect, it, vi } from "vitest";
import type { SupervisorTaskActor } from "./task-access-scope.js";
import {
  actorOwnsSupervisedTask,
  isSupervisedTaskVisibleToScope,
  matchesLegacySupervisorTaskFilter,
  resolveSupervisedTaskCreateIdentity,
  resolveSupervisorTaskAccessScope,
} from "./task-access-scope.js";

const resolveTrustedAttributionMock = vi.hoisted(() => vi.fn());

vi.mock("../scope-attribution.js", () => ({
  resolveTrustedAttribution: resolveTrustedAttributionMock,
}));

const ACTOR: SupervisorTaskActor = {
  userId: "user-self",
  userEmail: "self@test.com",
  tenantId: "tenant-1",
};

describe("supervisor task access scope", () => {
  it("owns tasks stamped with platform user id or legacy email", () => {
    expect(actorOwnsSupervisedTask({ userId: "user-self", tenantId: "tenant-1" }, ACTOR)).toBe(
      true,
    );
    expect(actorOwnsSupervisedTask({ userId: "self@test.com", tenantId: "tenant-1" }, ACTOR)).toBe(
      true,
    );
    expect(actorOwnsSupervisedTask({ userId: "user-colleague", tenantId: "tenant-1" }, ACTOR)).toBe(
      false,
    );
    expect(actorOwnsSupervisedTask({ tenantId: "tenant-1" }, ACTOR)).toBe(false);
    expect(actorOwnsSupervisedTask({ userId: "user-self", tenantId: "tenant-other" }, ACTOR)).toBe(
      false,
    );
  });

  it("session scope hides orphan and colleague tasks", () => {
    const scope = { kind: "session" as const, actor: ACTOR };
    expect(
      isSupervisedTaskVisibleToScope({ userId: "user-self", tenantId: "tenant-1" }, scope),
    ).toBe(true);
    expect(isSupervisedTaskVisibleToScope({ userId: "user-colleague" }, scope)).toBe(false);
    expect(isSupervisedTaskVisibleToScope({ tenantId: "tenant-1" }, scope)).toBe(false);
  });

  it("legacy soft filter keeps prior tenant/user semantics including orphans", () => {
    expect(
      matchesLegacySupervisorTaskFilter(
        { userId: "u2", tenantId: "t1" },
        { tenantId: "t1", userId: "u2" },
      ),
    ).toBe(true);
    expect(
      matchesLegacySupervisorTaskFilter({ tenantId: "t1" }, { tenantId: "t1", userId: "u2" }),
    ).toBe(true);
    expect(
      matchesLegacySupervisorTaskFilter(
        { userId: "u1", tenantId: "t1" },
        { tenantId: "t1", userId: "u2" },
      ),
    ).toBe(false);
  });

  it("create identity prefers session actor over client-supplied userId", () => {
    expect(
      resolveSupervisedTaskCreateIdentity({
        scope: { kind: "session", actor: ACTOR },
        requestedTenantId: "forged-tenant",
        requestedUserId: "forged-user",
      }),
    ).toEqual({ userId: "user-self", tenantId: "tenant-1" });
  });

  it("resolves session scope for personal workbench clients", async () => {
    resolveTrustedAttributionMock.mockResolvedValueOnce({
      ownerId: "user-self",
      tenantId: "tenant-1",
    });
    const scope = await resolveSupervisorTaskAccessScope({
      client: { sessionDomain: "employee", user: "self@test.com" } as never,
      requestedUserId: "forged-user",
    });
    expect(scope).toEqual({
      kind: "session",
      actor: {
        userId: "user-self",
        userEmail: "self@test.com",
        tenantId: "tenant-1",
      },
    });
  });

  it("fails closed when personal workbench actor cannot be resolved", async () => {
    resolveTrustedAttributionMock.mockResolvedValueOnce({});
    const scope = await resolveSupervisorTaskAccessScope({
      client: { sessionDomain: "employee", user: "self@test.com" } as never,
    });
    expect(scope).toBeNull();
  });

  it("falls back to legacy soft filter without a personal session", async () => {
    const scope = await resolveSupervisorTaskAccessScope({
      client: null,
      requestedTenantId: "t1",
      requestedUserId: "u2",
    });
    expect(scope).toEqual({ kind: "legacy", tenantId: "t1", userId: "u2" });
  });
});
