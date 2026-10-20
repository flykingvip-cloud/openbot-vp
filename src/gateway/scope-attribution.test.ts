import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  filterRecordsByScope,
  isRecordVisibleToScope,
  resolveQueryScope,
  type QueryScope,
  type RecordOwnership,
} from "./scope-attribution.js";

const resolveBillingScopeMock = vi.hoisted(() => vi.fn());
const isPersonalWorkbenchClientMock = vi.hoisted(() => vi.fn());
const resolveEmployeeWorkbenchActorMock = vi.hoisted(() => vi.fn());
const resolvePlatformAuthConfigMock = vi.hoisted(() => vi.fn());
const loadConfigMock = vi.hoisted(() => vi.fn());

vi.mock("./billing/scope.js", () => ({
  resolveBillingScope: resolveBillingScopeMock,
}));
vi.mock("./employee-workbench-scope.js", () => ({
  isPersonalWorkbenchClient: isPersonalWorkbenchClientMock,
  resolveEmployeeWorkbenchActor: resolveEmployeeWorkbenchActorMock,
}));
vi.mock("./platform-auth/config.js", () => ({
  resolvePlatformAuthConfig: resolvePlatformAuthConfigMock,
}));
vi.mock("../config/config.js", () => ({
  loadConfig: loadConfigMock,
}));

// Defaults reproduce production behavior for the pre-existing cases; individual
// tests override as needed.
beforeEach(() => {
  resolveBillingScopeMock.mockReset();
  isPersonalWorkbenchClientMock.mockReset();
  resolveEmployeeWorkbenchActorMock.mockReset();
  resolvePlatformAuthConfigMock.mockReset();
  loadConfigMock.mockReset();
  // Mirror the real predicate: personal-workbench = employee | enterprise ports.
  isPersonalWorkbenchClientMock.mockImplementation(
    (client: { sessionDomain?: string } | null | undefined) =>
      client?.sessionDomain === "employee" || client?.sessionDomain === "enterprise",
  );
  // No workbench actor unless a test opts in.
  resolveEmployeeWorkbenchActorMock.mockResolvedValue(null);
  // Platform auth disabled by default (local single-operator mode).
  resolvePlatformAuthConfigMock.mockReturnValue(null);
  loadConfigMock.mockReturnValue({});
});

type Rec = { id: string; ownership?: RecordOwnership };

const records: Rec[] = [
  { id: "platform-legacy" }, // unattributed
  { id: "a1", ownership: { tenantId: "tenant-a", ownerId: "user-1" } },
  { id: "a2", ownership: { tenantId: "tenant-a", ownerId: "user-2" } },
  { id: "b1", ownership: { tenantId: "tenant-b", ownerId: "user-3" } },
];

const ownershipOf = (r: Rec) => r.ownership;

describe("isRecordVisibleToScope", () => {
  it("platform scope sees everything including unattributed", () => {
    const scope: QueryScope = { kind: "platform" };
    for (const r of records) {
      expect(isRecordVisibleToScope(r.ownership, scope)).toBe(true);
    }
  });

  it("tenant scope sees only its own tenant records, never unattributed", () => {
    const scope: QueryScope = { kind: "tenant", tenantId: "tenant-a" };
    expect(isRecordVisibleToScope(undefined, scope)).toBe(false);
    expect(isRecordVisibleToScope({ tenantId: "tenant-a" }, scope)).toBe(true);
    expect(isRecordVisibleToScope({ tenantId: "tenant-b" }, scope)).toBe(false);
  });

  it("self scope sees only the owner's records", () => {
    const scope: QueryScope = { kind: "self", ownerId: "user-1" };
    expect(isRecordVisibleToScope({ ownerId: "user-1" }, scope)).toBe(true);
    expect(isRecordVisibleToScope({ ownerId: "user-2" }, scope)).toBe(false);
    expect(isRecordVisibleToScope(undefined, scope)).toBe(false);
  });

  it("none scope (fail-closed) sees nothing at all", () => {
    const scope: QueryScope = { kind: "none" };
    expect(isRecordVisibleToScope(undefined, scope)).toBe(false);
    expect(isRecordVisibleToScope({ ownerId: "user-1" }, scope)).toBe(false);
    expect(isRecordVisibleToScope({ tenantId: "tenant-a" }, scope)).toBe(false);
    expect(isRecordVisibleToScope({ tenantId: "tenant-a", ownerId: "user-1" }, scope)).toBe(false);
  });
});

describe("filterRecordsByScope", () => {
  it("platform returns all", () => {
    const out = filterRecordsByScope(records, ownershipOf, { kind: "platform" });
    expect(out.map((r) => r.id)).toEqual(["platform-legacy", "a1", "a2", "b1"]);
  });

  it("tenant-a returns only tenant-a records (no leak, no unattributed)", () => {
    const out = filterRecordsByScope(records, ownershipOf, {
      kind: "tenant",
      tenantId: "tenant-a",
    });
    expect(out.map((r) => r.id)).toEqual(["a1", "a2"]);
  });

  it("self user-1 returns only user-1 records", () => {
    const out = filterRecordsByScope(records, ownershipOf, { kind: "self", ownerId: "user-1" });
    expect(out.map((r) => r.id)).toEqual(["a1"]);
  });

  it("none returns empty (fail-closed)", () => {
    const out = filterRecordsByScope(records, ownershipOf, { kind: "none" });
    expect(out).toEqual([]);
  });

  // Property: cross-tenant intersection is empty.
  it("Property: tenant-a and tenant-b views are disjoint", () => {
    const a = filterRecordsByScope(records, ownershipOf, { kind: "tenant", tenantId: "tenant-a" });
    const b = filterRecordsByScope(records, ownershipOf, { kind: "tenant", tenantId: "tenant-b" });
    const aIds = new Set(a.map((r) => r.id));
    expect(b.some((r) => aIds.has(r.id))).toBe(false);
  });
});

describe("resolveQueryScope", () => {
  it("enterprise session with membership resolves tenant scope", async () => {
    resolveBillingScopeMock.mockResolvedValue({
      enterpriseId: "tenant-acme",
      user: { id: "admin-1" },
      membership: null,
      isEnterpriseAdmin: true,
      permissions: new Set(),
    });
    const scope = await resolveQueryScope({
      connect: {} as never,
      sessionDomain: "enterprise",
    });
    expect(scope).toEqual({ kind: "tenant", tenantId: "tenant-acme" });
  });

  it("enterprise session falls back to sessionTenantId instead of platform", async () => {
    resolveBillingScopeMock.mockImplementation(async (_client, opts) => {
      if (opts?.requestedTenantId) {
        return {
          enterpriseId: "tenant-acme",
          user: null,
          membership: null,
          isEnterpriseAdmin: true,
          permissions: new Set(),
        };
      }
      return {
        enterpriseId: null,
        user: null,
        membership: null,
        isEnterpriseAdmin: false,
        permissions: new Set(),
      };
    });
    const scope = await resolveQueryScope({
      connect: {} as never,
      sessionDomain: "enterprise",
      sessionTenantId: "tenant-acme",
    });
    expect(scope).toEqual({ kind: "tenant", tenantId: "tenant-acme" });
  });

  it("enterprise session without resolvable tenant never widens to platform", async () => {
    resolveBillingScopeMock.mockResolvedValue({
      enterpriseId: null,
      user: null,
      membership: null,
      isEnterpriseAdmin: false,
      permissions: new Set(),
    });
    const scope = await resolveQueryScope({
      connect: {} as never,
      sessionDomain: "enterprise",
    });
    expect(scope.kind).toBe("tenant");
    expect(scope).not.toEqual({ kind: "platform" });
  });

  it("platform session without identity still resolves platform scope", async () => {
    resolveBillingScopeMock.mockResolvedValue({
      enterpriseId: null,
      user: null,
      membership: null,
      isEnterpriseAdmin: false,
      permissions: new Set(),
    });
    const scope = await resolveQueryScope({
      connect: {} as never,
      sessionDomain: "platform",
    });
    expect(scope).toEqual({ kind: "platform" });
  });
});

describe("resolveQueryScope employee isolation (fail-closed)", () => {
  it("employee with a billing-resolved owner → self scope", async () => {
    resolveBillingScopeMock.mockResolvedValue({
      enterpriseId: "tenant-acme",
      user: { id: "user-1" },
      membership: null,
      isEnterpriseAdmin: false,
      permissions: new Set(),
    });
    const scope = await resolveQueryScope({
      connect: {} as never,
      sessionDomain: "employee",
    });
    expect(scope).toEqual({ kind: "self", ownerId: "user-1" });
  });

  it("employee without enterprise membership resolves owner via workbench actor → self scope", async () => {
    // Billing scope yields no user (no enterprise membership)...
    resolveBillingScopeMock.mockResolvedValue({
      enterpriseId: null,
      user: null,
      membership: null,
      isEnterpriseAdmin: false,
      permissions: new Set(),
    });
    // ...but the membership-independent workbench actor resolves the user id.
    resolveEmployeeWorkbenchActorMock.mockResolvedValue({
      userId: "user-7",
      userEmail: "e@example.com",
      seatAgentIds: [],
      seatSpaceIds: [],
    });
    const scope = await resolveQueryScope({
      connect: {} as never,
      sessionDomain: "employee",
      user: "e@example.com",
    });
    expect(scope).toEqual({ kind: "self", ownerId: "user-7" });
  });

  it("employee with NO resolvable identity under platform auth → none (never leaks others)", async () => {
    resolveBillingScopeMock.mockResolvedValue({
      enterpriseId: null,
      user: null,
      membership: null,
      isEnterpriseAdmin: false,
      permissions: new Set(),
    });
    resolveEmployeeWorkbenchActorMock.mockResolvedValue(null);
    // Platform (multi-tenant) auth ENABLED → must fail closed.
    resolvePlatformAuthConfigMock.mockReturnValue({ enabled: true });
    loadConfigMock.mockReturnValue({
      gateway: { auth: { trustedProxy: { platformAuth: { enabled: true } } } },
    });
    const scope = await resolveQueryScope({
      connect: {} as never,
      sessionDomain: "employee",
    });
    expect(scope).toEqual({ kind: "none" });
  });

  it("employee with no identity in local single-operator mode → platform (not locked out)", async () => {
    resolveBillingScopeMock.mockResolvedValue({
      enterpriseId: null,
      user: null,
      membership: null,
      isEnterpriseAdmin: false,
      permissions: new Set(),
    });
    resolveEmployeeWorkbenchActorMock.mockResolvedValue(null);
    // Platform auth DISABLED (default) → local operator keeps seeing everything.
    resolvePlatformAuthConfigMock.mockReturnValue(null);
    const scope = await resolveQueryScope({
      connect: {} as never,
      sessionDomain: "employee",
    });
    expect(scope).toEqual({ kind: "platform" });
  });
});
