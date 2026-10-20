import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Isolate resolveTenantContext's logic from platform-auth I/O by mocking the membership seam it
// resolves the authoritative tenant/user from. Note it deliberately does NOT go through the
// hint-tainted resolveTrustedAttribution — these tests prove the hint can never become the
// authority (expert review 高危2).
const {
  loadConfigMock,
  resolvePlatformAuthConfigMock,
  loadPlatformAuthStoreMock,
  findUserByEmailMock,
  findUserByIdMock,
  findMembershipByUserIdMock,
} = vi.hoisted(() => ({
  loadConfigMock: vi.fn(),
  resolvePlatformAuthConfigMock: vi.fn(),
  loadPlatformAuthStoreMock: vi.fn(),
  findUserByEmailMock: vi.fn(),
  findUserByIdMock: vi.fn(),
  findMembershipByUserIdMock: vi.fn(),
}));
vi.mock("../config/config.js", () => ({ loadConfig: loadConfigMock }));
vi.mock("./platform-auth.js", () => ({
  resolvePlatformAuthConfig: resolvePlatformAuthConfigMock,
  loadPlatformAuthStore: loadPlatformAuthStoreMock,
  findUserByEmail: findUserByEmailMock,
  findUserById: findUserByIdMock,
  findMembershipByUserId: findMembershipByUserIdMock,
}));

import { resolveStorePath } from "../config/sessions.js";
import type { OpenBotConfig } from "../config/types.js";
import type { GatewayClient } from "./server-methods/types.js";
import {
  requireTenantContext,
  resolveControlPlaneStorePathForClient,
  resolveDataRootForClient,
  resolveDataRootForSessionHint,
  resolveAgentDirForClient,
  resolveAgentWorkspaceDirForClient,
  buildSessionStorePathResolver,
  resolveConnectorOAuthSessionStorePathForTenantId,
  resolveSessionStorePathForInboundMessage,
  promoteGlobalSessionEntryIfNewer,
  resolveTenantContext,
  resolveTenantContextForSessionStore,
  sessionDomainFromPlatformSessionKind,
  sessionOwnershipFromTenantContext,
  TenantContextError,
  toGatewayClientFromSessionHint,
} from "./tenant-context.js";
import { TENANT_ENTERPRISE_DATA_FILE, TENANT_SEAT_ASSETS_FILE } from "./tenant-store-paths.js";

function client(partial: Partial<GatewayClient>): GatewayClient {
  return { connect: {} as never, user: "a@acme.com", ...partial } as GatewayClient;
}

/** Point the mocked platform-auth store at a given user + (optional) membership enterprise. */
function withMembership(opts: { userId?: string | null; enterpriseId?: string | null }): void {
  findUserByEmailMock.mockReturnValue(
    opts.userId === null ? undefined : { id: opts.userId ?? "u1", email: "a@acme.com" },
  );
  findUserByIdMock.mockReturnValue(
    opts.userId === null ? undefined : { id: opts.userId ?? "u1", email: "a@acme.com" },
  );
  findMembershipByUserIdMock.mockReturnValue(
    opts.enterpriseId ? { enterpriseId: opts.enterpriseId } : undefined,
  );
}

beforeEach(() => {
  loadConfigMock.mockReturnValue({
    gateway: { auth: { trustedProxy: {} } },
    data: { mode: "managed" },
  });
  // D5: per-tenant addressing is gated by OPENBOT_MULTITENANT in addition to managed mode.
  process.env.OPENBOT_MULTITENANT = "1";
  resolvePlatformAuthConfigMock.mockReturnValue({ enabled: true });
  loadPlatformAuthStoreMock.mockResolvedValue({});
  findUserByEmailMock.mockReset();
  findUserByIdMock.mockReset();
  findMembershipByUserIdMock.mockReset();
});

afterEach(() => {
  delete process.env.OPENBOT_MULTITENANT;
});

describe("resolveTenantContext", () => {
  it("returns null for the platform domain (no implicit tenant, R1.3)", async () => {
    withMembership({ userId: "u1", enterpriseId: "acme" });
    expect(await resolveTenantContext(client({ sessionDomain: "platform" }))).toBeNull();
  });

  it("returns null when the session has no domain", async () => {
    expect(await resolveTenantContext(client({}))).toBeNull();
    expect(await resolveTenantContext(null)).toBeNull();
  });

  it("resolves an employee/enterprise context from membership", async () => {
    withMembership({ userId: "u1", enterpriseId: "acme" });
    expect(await resolveTenantContext(client({ sessionDomain: "employee" }))).toEqual({
      tenantId: "acme",
      userId: "u1",
      domain: "employee",
    });
  });

  it("rejects a session tenant hint that disagrees with the membership tenant (R1.2)", async () => {
    withMembership({ userId: "u1", enterpriseId: "acme" });
    await expect(
      resolveTenantContext(client({ sessionDomain: "employee", sessionTenantId: "globex" })),
    ).rejects.toMatchObject({ code: "hint_mismatch" });
  });

  it("accepts a matching tenant hint", async () => {
    withMembership({ userId: "u1", enterpriseId: "acme" });
    const ctx = await resolveTenantContext(
      client({ sessionDomain: "enterprise", sessionTenantId: "acme" }),
    );
    expect(ctx?.tenantId).toBe("acme");
  });

  it("fails closed for a membership-less session — a forged hint never becomes authority (高危2)", async () => {
    // User exists but has NO membership; a forged sessionTenantId must NOT grant a tenant.
    withMembership({ userId: "u1", enterpriseId: null });
    await expect(
      resolveTenantContext(client({ sessionDomain: "employee", sessionTenantId: "globex" })),
    ).rejects.toMatchObject({ code: "unresolved_tenant" });
  });

  it("throws unresolved_tenant when the user is unknown", async () => {
    withMembership({ userId: null });
    await expect(
      resolveTenantContext(client({ sessionDomain: "enterprise" })),
    ).rejects.toMatchObject({ code: "unresolved_tenant" });
  });

  it("throws unresolved_user when membership resolves but the user id is empty", async () => {
    findUserByEmailMock.mockReturnValue({ id: "", email: "a@acme.com" });
    findMembershipByUserIdMock.mockReturnValue({ enterpriseId: "acme" });
    await expect(resolveTenantContext(client({ sessionDomain: "employee" }))).rejects.toMatchObject(
      { code: "unresolved_user" },
    );
  });
});

describe("requireTenantContext", () => {
  it("throws TenantContextError when the context would be null", async () => {
    withMembership({ userId: "u1", enterpriseId: "acme" });
    await expect(
      requireTenantContext(client({ sessionDomain: "platform" })),
    ).rejects.toBeInstanceOf(TenantContextError);
  });
});

describe("resolveTenantContextForSessionStore", () => {
  it("keeps R1.3 for control-plane resolveTenantContext but infers enterprise for session store", async () => {
    withMembership({ userId: "u1", enterpriseId: "acme" });
    expect(await resolveTenantContext(client({ sessionDomain: "platform" }))).toBeNull();
    expect(
      await resolveTenantContextForSessionStore(client({ sessionDomain: "platform" })),
    ).toEqual({
      tenantId: "acme",
      userId: "u1",
      domain: "enterprise",
    });
  });

  it("resolves session-store tenant from platformUserId when email is absent", async () => {
    withMembership({ userId: "u1", enterpriseId: "acme" });
    findUserByEmailMock.mockReturnValue(undefined);
    expect(
      await resolveTenantContextForSessionStore(client({ user: undefined, platformUserId: "u1" })),
    ).toEqual({
      tenantId: "acme",
      userId: "u1",
      domain: "enterprise",
    });
    expect(findUserByIdMock).toHaveBeenCalled();
  });

  it("infers from membership when domain is missing (CLI / trusted-proxy)", async () => {
    withMembership({ userId: "u1", enterpriseId: "acme" });
    expect(await resolveTenantContextForSessionStore(client({}))).toEqual({
      tenantId: "acme",
      userId: "u1",
      domain: "enterprise",
    });
  });

  it("returns null when membership is absent", async () => {
    withMembership({ userId: "u1", enterpriseId: null });
    expect(
      await resolveTenantContextForSessionStore(client({ sessionDomain: "platform" })),
    ).toBeNull();
  });
});

describe("resolveControlPlaneStorePathForClient (P1 L1 store seam)", () => {
  const tenantsRoot = path.join(os.tmpdir(), "openbot-tctx-seam-tenants");
  const managedCfg = { data: { mode: "managed" } } as OpenBotConfig;
  const localCfg = { data: { mode: "local" } } as OpenBotConfig;

  beforeEach(() => {
    process.env.OPENBOT_TENANTS_ROOT = tenantsRoot;
  });
  afterEach(() => {
    delete process.env.OPENBOT_TENANTS_ROOT;
  });

  it("local/self-hosted → undefined (global default) without resolving membership (R2 zero-change)", async () => {
    const resolved = await resolveControlPlaneStorePathForClient(
      client({ sessionDomain: "employee" }),
      TENANT_SEAT_ASSETS_FILE,
      localCfg,
    );
    expect(resolved).toBeUndefined();
    // Short-circuits before any auth I/O: single-tenant deploys with no platform-auth are untouched.
    expect(findUserByEmailMock).not.toHaveBeenCalled();
  });

  it("managed + authoritative membership → per-tenant control-plane store path", async () => {
    withMembership({ userId: "u1", enterpriseId: "acme" });
    const resolved = await resolveControlPlaneStorePathForClient(
      client({ sessionDomain: "employee" }),
      TENANT_SEAT_ASSETS_FILE,
      managedCfg,
    );
    expect(resolved).toBe(path.join(tenantsRoot, "acme", "control-plane", "seat-assets.json"));
  });

  it("fail-closed: managed + membership-less session throws, never the global store (高危1/高危2)", async () => {
    withMembership({ userId: "u1", enterpriseId: null });
    await expect(
      resolveControlPlaneStorePathForClient(
        client({ sessionDomain: "employee", sessionTenantId: "globex" }),
        TENANT_SEAT_ASSETS_FILE,
        managedCfg,
      ),
    ).rejects.toBeInstanceOf(TenantContextError);
  });

  it("isolates tenants: two managed sessions address distinct per-tenant stores (P1 leakage gate)", async () => {
    findUserByEmailMock.mockImplementation((_store: unknown, email: string) =>
      email === "a@acme.com"
        ? { id: "uA", email }
        : email === "b@globex.com"
          ? { id: "uB", email }
          : undefined,
    );
    findMembershipByUserIdMock.mockImplementation((_store: unknown, userId: string) =>
      userId === "uA"
        ? { enterpriseId: "acme" }
        : userId === "uB"
          ? { enterpriseId: "globex" }
          : undefined,
    );

    const pathA = await resolveControlPlaneStorePathForClient(
      client({ user: "a@acme.com", sessionDomain: "employee" }),
      TENANT_SEAT_ASSETS_FILE,
      managedCfg,
    );
    const pathB = await resolveControlPlaneStorePathForClient(
      client({ user: "b@globex.com", sessionDomain: "employee" }),
      TENANT_SEAT_ASSETS_FILE,
      managedCfg,
    );

    expect(pathA).toBe(path.join(tenantsRoot, "acme", "control-plane", "seat-assets.json"));
    expect(pathB).toBe(path.join(tenantsRoot, "globex", "control-plane", "seat-assets.json"));
    expect(pathA).not.toBe(pathB);
    // Each session's L1 store path stays inside its own tenant tree — never the other's.
    expect(pathA).not.toContain(`${path.sep}globex${path.sep}`);
    expect(pathB).not.toContain(`${path.sep}acme${path.sep}`);

    const dataA = await resolveControlPlaneStorePathForClient(
      client({ user: "a@acme.com", sessionDomain: "employee" }),
      TENANT_ENTERPRISE_DATA_FILE,
      managedCfg,
    );
    const dataB = await resolveControlPlaneStorePathForClient(
      client({ user: "b@globex.com", sessionDomain: "employee" }),
      TENANT_ENTERPRISE_DATA_FILE,
      managedCfg,
    );
    expect(dataA).toBe(path.join(tenantsRoot, "acme", "control-plane", "enterprise-data.json"));
    expect(dataB).toBe(path.join(tenantsRoot, "globex", "control-plane", "enterprise-data.json"));
    expect(dataA).not.toBe(dataB);
  });
});

describe("resolveDataRootForClient (P2 L2 data seam)", () => {
  const tenantsRoot = path.join(os.tmpdir(), "openbot-tctx-l2-tenants");
  const managedCfg = { data: { mode: "managed" } } as OpenBotConfig;

  beforeEach(() => {
    process.env.OPENBOT_TENANTS_ROOT = tenantsRoot;
    process.env.OPENBOT_MULTITENANT = "1";
  });
  afterEach(() => {
    delete process.env.OPENBOT_TENANTS_ROOT;
    delete process.env.OPENBOT_MULTITENANT;
  });

  it("local/self-hosted → resolveDataRoot(cfg) without membership I/O (R2 zero-change)", async () => {
    const localRoot = path.join(os.tmpdir(), "openbot-tctx-local-root");
    const localCfg = { data: { mode: "local", root: localRoot } } as OpenBotConfig;
    delete process.env.OPENBOT_MULTITENANT;
    const root = await resolveDataRootForClient(client({ sessionDomain: "employee" }), localCfg);
    expect(root).toBe(path.resolve(localRoot));
    expect(findUserByEmailMock).not.toHaveBeenCalled();
  });

  it("managed + membership → users/<userId>/OpenBot under tenant live root", async () => {
    withMembership({ userId: "u1", enterpriseId: "acme" });
    const root = await resolveDataRootForClient(client({ sessionDomain: "employee" }), managedCfg);
    expect(root).toBe(path.join(tenantsRoot, "acme", "users", "u1", "OpenBot"));
  });

  it("isolates users: same tenant, different sessions → distinct user data roots (P2 L2 gate)", async () => {
    findUserByEmailMock.mockImplementation((_store: unknown, email: string) =>
      email === "a@acme.com"
        ? { id: "uA", email }
        : email === "b@acme.com"
          ? { id: "uB", email }
          : undefined,
    );
    findMembershipByUserIdMock.mockImplementation((_store: unknown, userId: string) =>
      userId === "uA" || userId === "uB" ? { enterpriseId: "acme" } : undefined,
    );

    const rootA = await resolveDataRootForClient(
      client({ user: "a@acme.com", sessionDomain: "employee" }),
      managedCfg,
    );
    const rootB = await resolveDataRootForClient(
      client({ user: "b@acme.com", sessionDomain: "employee" }),
      managedCfg,
    );

    expect(rootA).toBe(path.join(tenantsRoot, "acme", "users", "uA", "OpenBot"));
    expect(rootB).toBe(path.join(tenantsRoot, "acme", "users", "uB", "OpenBot"));
    expect(rootA).not.toBe(rootB);
    expect(rootA).not.toContain(`${path.sep}uB${path.sep}`);
    expect(rootB).not.toContain(`${path.sep}uA${path.sep}`);
  });

  it("isolates tenants: cross-tenant sessions never share a data root (P2 L2 gate)", async () => {
    findUserByEmailMock.mockImplementation((_store: unknown, email: string) =>
      email === "a@acme.com"
        ? { id: "uA", email }
        : email === "b@globex.com"
          ? { id: "uB", email }
          : undefined,
    );
    findMembershipByUserIdMock.mockImplementation((_store: unknown, userId: string) =>
      userId === "uA"
        ? { enterpriseId: "acme" }
        : userId === "uB"
          ? { enterpriseId: "globex" }
          : undefined,
    );

    const rootA = await resolveDataRootForClient(
      client({ user: "a@acme.com", sessionDomain: "employee" }),
      managedCfg,
    );
    const rootB = await resolveDataRootForClient(
      client({ user: "b@globex.com", sessionDomain: "employee" }),
      managedCfg,
    );

    expect(rootA).toContain(`${path.sep}acme${path.sep}`);
    expect(rootB).toContain(`${path.sep}globex${path.sep}`);
    expect(rootA).not.toContain(`${path.sep}globex${path.sep}`);
    expect(rootB).not.toContain(`${path.sep}acme${path.sep}`);
  });

  it("fail-closed: managed + membership-less session throws (never global data root)", async () => {
    withMembership({ userId: "u1", enterpriseId: null });
    await expect(
      resolveDataRootForClient(client({ sessionDomain: "employee" }), managedCfg),
    ).rejects.toBeInstanceOf(TenantContextError);
  });
});

describe("resolveDataRootForSessionHint (HTTP/bootstrap seam)", () => {
  const tenantsRoot = path.join(os.tmpdir(), "openbot-tctx-http-tenants");
  const managedCfg = { data: { mode: "managed" } } as OpenBotConfig;

  beforeEach(() => {
    process.env.OPENBOT_TENANTS_ROOT = tenantsRoot;
    process.env.OPENBOT_MULTITENANT = "1";
  });
  afterEach(() => {
    delete process.env.OPENBOT_TENANTS_ROOT;
    delete process.env.OPENBOT_MULTITENANT;
  });

  it("maps platform sessionKind to tenant context domain", () => {
    expect(sessionDomainFromPlatformSessionKind("member")).toBe("employee");
    expect(sessionDomainFromPlatformSessionKind("enterprise-admin")).toBe("enterprise");
    expect(sessionDomainFromPlatformSessionKind("platform-admin")).toBeUndefined();
  });

  it("resolves per-user data root from platform session hint", async () => {
    withMembership({ userId: "u1", enterpriseId: "acme" });
    const root = await resolveDataRootForSessionHint(
      {
        user: "a@acme.com",
        sessionDomain: sessionDomainFromPlatformSessionKind("member"),
      },
      managedCfg,
    );
    expect(root).toBe(path.join(tenantsRoot, "acme", "users", "u1", "OpenBot"));
  });
});

describe("P3 L3 session + agent dir seams", () => {
  const tenantsRoot = path.join(os.tmpdir(), "openbot-tctx-p3-tenants");
  const managedCfg = { data: { mode: "managed" } } as OpenBotConfig;

  beforeEach(() => {
    process.env.OPENBOT_TENANTS_ROOT = tenantsRoot;
    process.env.OPENBOT_MULTITENANT = "1";
    findUserByEmailMock.mockImplementation((_store: unknown, email: string) =>
      email === "a@acme.com"
        ? { id: "uA", email }
        : email === "b@acme.com"
          ? { id: "uB", email }
          : undefined,
    );
    findMembershipByUserIdMock.mockImplementation((_store: unknown, userId: string) =>
      userId === "uA" || userId === "uB" ? { enterpriseId: "acme" } : undefined,
    );
  });
  afterEach(() => {
    delete process.env.OPENBOT_TENANTS_ROOT;
    delete process.env.OPENBOT_MULTITENANT;
  });

  it("buildSessionStorePathResolver returns one conversation store path regardless of tenant/user", async () => {
    const resolveA = await buildSessionStorePathResolver(
      client({ user: "a@acme.com", sessionDomain: "employee" }),
      managedCfg,
    );
    const resolveB = await buildSessionStorePathResolver(
      client({ user: "b@acme.com", sessionDomain: "employee" }),
      managedCfg,
    );
    const pathA = resolveA("main");
    const pathB = resolveB("main");
    const expected = resolveStorePath(undefined, { agentId: "main" });
    expect(pathA).toBe(expected);
    expect(pathB).toBe(expected);
    expect(pathA).toBe(pathB);
    expect(pathA).not.toContain(`${path.sep}tenants${path.sep}`);
    expect(pathA).not.toContain(`${path.sep}users${path.sep}`);
  });

  it("resolveAgentDirForClient isolates auth-profiles agent dirs (P3 4.2)", async () => {
    const dirA = await resolveAgentDirForClient(
      client({ user: "a@acme.com", sessionDomain: "employee" }),
      "main",
      managedCfg,
    );
    const dirB = await resolveAgentDirForClient(
      client({ user: "b@acme.com", sessionDomain: "employee" }),
      "main",
      managedCfg,
    );
    expect(dirA).toBe(
      path.join(tenantsRoot, "acme", "users", "uA", "state", "agents", "main", "agent"),
    );
    expect(dirB).toBe(
      path.join(tenantsRoot, "acme", "users", "uB", "state", "agents", "main", "agent"),
    );
    expect(dirA).not.toBe(dirB);
  });

  it("P3 4.1 dual-user clients share one conversation store path (ownership on record)", async () => {
    const resolveA = await buildSessionStorePathResolver(
      client({ user: "a@acme.com", sessionDomain: "employee" }),
      managedCfg,
    );
    const resolveB = await buildSessionStorePathResolver(
      client({ user: "b@acme.com", sessionDomain: "employee" }),
      managedCfg,
    );
    const storePathA = resolveA("main");
    const storePathB = resolveB("main");
    expect(storePathA).toBe(storePathB);
    const ownershipA = sessionOwnershipFromTenantContext(
      { tenantId: "acme", userId: "uA", domain: "employee" },
      "main",
    );
    const ownershipB = sessionOwnershipFromTenantContext(
      { tenantId: "acme", userId: "uB", domain: "employee" },
      "main",
    );
    expect(ownershipA.ownerUserId).toBe("uA");
    expect(ownershipB.ownerUserId).toBe("uB");
    expect(ownershipA.ownerBotId).toBe("main");
  });

  it("P3 4.1 cross-tenant clients share one conversation store path (ownership on record)", async () => {
    findUserByEmailMock.mockImplementation((_store: unknown, email: string) =>
      email === "a@acme.com"
        ? { id: "uA", email }
        : email === "b@globex.com"
          ? { id: "uB", email }
          : undefined,
    );
    findMembershipByUserIdMock.mockImplementation((_store: unknown, userId: string) =>
      userId === "uA"
        ? { enterpriseId: "acme" }
        : userId === "uB"
          ? { enterpriseId: "globex" }
          : undefined,
    );
    const resolveAcme = await buildSessionStorePathResolver(
      client({ user: "a@acme.com", sessionDomain: "employee" }),
      managedCfg,
    );
    const resolveGlobex = await buildSessionStorePathResolver(
      client({ user: "b@globex.com", sessionDomain: "employee" }),
      managedCfg,
    );
    const storePathAcme = resolveAcme("main");
    const storePathGlobex = resolveGlobex("main");
    expect(storePathAcme).toBe(storePathGlobex);
    expect(storePathAcme).not.toContain(`${path.sep}tenants${path.sep}`);
    expect(
      sessionOwnershipFromTenantContext({ tenantId: "acme", userId: "uA", domain: "employee" })
        .ownerTenantId,
    ).toBe("acme");
    expect(
      sessionOwnershipFromTenantContext({ tenantId: "globex", userId: "uB", domain: "employee" })
        .ownerTenantId,
    ).toBe("globex");
  });
});

describe("P4 5.4 same-process dual-tenant addressing gate", () => {
  const tenantsRoot = path.join(os.tmpdir(), "openbot-tctx-e2e-tenants");
  const managedCfg = { data: { mode: "managed" } } as OpenBotConfig;

  beforeEach(() => {
    process.env.OPENBOT_TENANTS_ROOT = tenantsRoot;
    process.env.OPENBOT_MULTITENANT = "1";
    findUserByEmailMock.mockImplementation((_store: unknown, email: string) =>
      email === "a@acme.com"
        ? { id: "uA", email }
        : email === "b@globex.com"
          ? { id: "uB", email }
          : undefined,
    );
    findMembershipByUserIdMock.mockImplementation((_store: unknown, userId: string) =>
      userId === "uA"
        ? { enterpriseId: "acme" }
        : userId === "uB"
          ? { enterpriseId: "globex" }
          : undefined,
    );
  });
  afterEach(() => {
    delete process.env.OPENBOT_TENANTS_ROOT;
    delete process.env.OPENBOT_MULTITENANT;
  });

  it("L1+L2 paths isolate two tenants in one process (addressing-layer E2E)", async () => {
    const clientA = toGatewayClientFromSessionHint({
      user: "a@acme.com",
      sessionDomain: "employee",
    });
    const clientB = toGatewayClientFromSessionHint({
      user: "b@globex.com",
      sessionDomain: "employee",
    });

    const seatA = await resolveControlPlaneStorePathForClient(
      clientA,
      TENANT_SEAT_ASSETS_FILE,
      managedCfg,
    );
    const seatB = await resolveControlPlaneStorePathForClient(
      clientB,
      TENANT_SEAT_ASSETS_FILE,
      managedCfg,
    );
    const dataA = await resolveDataRootForClient(clientA, managedCfg);
    const dataB = await resolveDataRootForClient(clientB, managedCfg);

    expect(seatA).toBe(path.join(tenantsRoot, "acme", "control-plane", "seat-assets.json"));
    expect(seatB).toBe(path.join(tenantsRoot, "globex", "control-plane", "seat-assets.json"));
    expect(dataA).toBe(path.join(tenantsRoot, "acme", "users", "uA", "OpenBot"));
    expect(dataB).toBe(path.join(tenantsRoot, "globex", "users", "uB", "OpenBot"));

    const allPaths = [seatA, seatB, dataA, dataB].filter(Boolean) as string[];
    expect(new Set(allPaths).size).toBe(4);
    expect(seatA).not.toContain(`${path.sep}globex${path.sep}`);
    expect(seatB).not.toContain(`${path.sep}acme${path.sep}`);
    expect(dataA).not.toContain(`${path.sep}uB${path.sep}`);
    expect(dataB).not.toContain(`${path.sep}uA${path.sep}`);
  });
});

describe("R7.2 dual-tenant provision → import → session isolation gate", () => {
  const tenantsRoot = path.join(os.tmpdir(), "openbot-tctx-r72-tenants");
  const managedCfg = { data: { mode: "managed" } } as OpenBotConfig;

  beforeEach(() => {
    process.env.OPENBOT_TENANTS_ROOT = tenantsRoot;
    process.env.OPENBOT_MULTITENANT = "1";
    findUserByEmailMock.mockImplementation((_store: unknown, email: string) =>
      email === "a@acme.com"
        ? { id: "uA", email }
        : email === "b@globex.com"
          ? { id: "uB", email }
          : undefined,
    );
    findMembershipByUserIdMock.mockImplementation((_store: unknown, userId: string) =>
      userId === "uA"
        ? { enterpriseId: "acme" }
        : userId === "uB"
          ? { enterpriseId: "globex" }
          : undefined,
    );
  });
  afterEach(() => {
    delete process.env.OPENBOT_TENANTS_ROOT;
    delete process.env.OPENBOT_MULTITENANT;
  });

  it("writes and reads disjoint L1+L2+L3 stores for two tenants (runtime E2E)", async () => {
    const clientAcme = client({ user: "a@acme.com", sessionDomain: "employee" });
    const clientGlobex = client({ user: "b@globex.com", sessionDomain: "employee" });

    const seatPathAcme = await resolveControlPlaneStorePathForClient(
      clientAcme,
      TENANT_SEAT_ASSETS_FILE,
      managedCfg,
    );
    const seatPathGlobex = await resolveControlPlaneStorePathForClient(
      clientGlobex,
      TENANT_SEAT_ASSETS_FILE,
      managedCfg,
    );
    const dataRootAcme = await resolveDataRootForClient(clientAcme, managedCfg);
    const dataRootGlobex = await resolveDataRootForClient(clientGlobex, managedCfg);
    const resolveAcmeSessions = await buildSessionStorePathResolver(clientAcme, managedCfg);
    const resolveGlobexSessions = await buildSessionStorePathResolver(clientGlobex, managedCfg);
    const sessionPathAcme = resolveAcmeSessions("main");
    const sessionPathGlobex = resolveGlobexSessions("main");
    const workspaceAcme = await resolveAgentWorkspaceDirForClient(clientAcme, "main", managedCfg);
    const workspaceGlobex = await resolveAgentWorkspaceDirForClient(
      clientGlobex,
      "main",
      managedCfg,
    );
    const oauthPathAcme = resolveConnectorOAuthSessionStorePathForTenantId("acme", managedCfg);
    const oauthPathGlobex = resolveConnectorOAuthSessionStorePathForTenantId("globex", managedCfg);

    await fs.mkdir(path.dirname(seatPathAcme!), { recursive: true });
    await fs.mkdir(path.dirname(seatPathGlobex!), { recursive: true });
    await fs.mkdir(dataRootAcme, { recursive: true });
    await fs.mkdir(dataRootGlobex, { recursive: true });
    await fs.mkdir(path.dirname(sessionPathAcme), { recursive: true });
    await fs.mkdir(path.dirname(sessionPathGlobex), { recursive: true });
    await fs.mkdir(workspaceAcme, { recursive: true });
    await fs.mkdir(workspaceGlobex, { recursive: true });
    await fs.mkdir(path.dirname(oauthPathAcme!), { recursive: true });
    await fs.mkdir(path.dirname(oauthPathGlobex!), { recursive: true });

    await fs.writeFile(seatPathAcme!, JSON.stringify({ version: 1, seats: { "seat-acme": {} } }));
    await fs.writeFile(
      seatPathGlobex!,
      JSON.stringify({ version: 1, seats: { "seat-globex": {} } }),
    );
    await fs.writeFile(path.join(dataRootAcme, "imported.txt"), "acme-import");
    await fs.writeFile(path.join(dataRootGlobex, "imported.txt"), "globex-import");
    // L3 session store is conversation-following (shared path); ownership is metadata.
    expect(sessionPathAcme).toBe(sessionPathGlobex);
    await fs.writeFile(
      sessionPathAcme,
      JSON.stringify({
        "agent:main:work": {
          sessionId: "shared-session",
          ownerTenantId: "acme",
          ownerUserId: "uA",
          ownerBotId: "main",
        },
      }),
    );
    await fs.writeFile(path.join(workspaceAcme, "BOOT.md"), "acme-boot");
    await fs.writeFile(path.join(workspaceGlobex, "BOOT.md"), "globex-boot");

    const seatAcmeContent = await fs.readFile(seatPathAcme!, "utf8");
    const seatGlobexContent = await fs.readFile(seatPathGlobex!, "utf8");
    const importAcme = await fs.readFile(path.join(dataRootAcme, "imported.txt"), "utf8");
    const importGlobex = await fs.readFile(path.join(dataRootGlobex, "imported.txt"), "utf8");
    const sessionShared = await fs.readFile(sessionPathAcme, "utf8");

    expect(seatAcmeContent).toContain("seat-acme");
    expect(seatGlobexContent).toContain("seat-globex");
    expect(importAcme).toBe("acme-import");
    expect(importGlobex).toBe("globex-import");
    expect(sessionShared).toContain("shared-session");
    expect(sessionShared).toContain('"ownerTenantId":"acme"');
    expect(seatAcmeContent).not.toContain("seat-globex");
    expect(seatGlobexContent).not.toContain("seat-acme");
    expect(workspaceAcme).not.toContain(`${path.sep}globex${path.sep}`);
    expect(workspaceGlobex).not.toContain(`${path.sep}acme${path.sep}`);
    expect(oauthPathAcme).not.toBe(oauthPathGlobex);
  });
});

describe("session store path for inbound agent turns (history split-brain)", () => {
  const tenantsRoot = path.join(os.tmpdir(), "openbot-tctx-history-heal");
  const managedCfg = { data: { mode: "managed" } } as OpenBotConfig;

  beforeEach(() => {
    process.env.OPENBOT_TENANTS_ROOT = tenantsRoot;
    process.env.OPENBOT_MULTITENANT = "1";
    loadConfigMock.mockReturnValue({
      gateway: { auth: { trustedProxy: {} } },
      data: { mode: "managed" },
      session: {},
    });
    resolvePlatformAuthConfigMock.mockReturnValue({ enabled: true });
    loadPlatformAuthStoreMock.mockResolvedValue({});
    withMembership({ userId: "u1", enterpriseId: "acme" });
  });
  afterEach(() => {
    delete process.env.OPENBOT_TENANTS_ROOT;
    delete process.env.OPENBOT_MULTITENANT;
  });

  it("resolveSessionStorePathForInboundMessage uses conversation store for webchat users", async () => {
    const userPath = await resolveSessionStorePathForInboundMessage({
      cfg: managedCfg,
      agentId: "main",
      gatewayClientUser: "a@acme.com",
      gatewayClientSessionDomain: "employee",
    });
    const anonPath = await resolveSessionStorePathForInboundMessage({
      cfg: managedCfg,
      agentId: "main",
      gatewayClientUser: null,
      gatewayClientSessionDomain: null,
    });
    expect(userPath).toBe(anonPath);
    expect(userPath).toBe(resolveStorePath(undefined, { agentId: "main" }));
    expect(userPath).not.toContain(`${path.sep}tenants${path.sep}`);
    expect(userPath).not.toContain(`${path.sep}users${path.sep}`);
  });

  it("routes an internal send by platform user id to the conversation store", async () => {
    const storePath = await resolveSessionStorePathForInboundMessage({
      cfg: managedCfg,
      agentId: "bot-2",
      gatewayClientPlatformUserId: "u1",
      gatewayClientSessionDomain: "employee",
    });
    expect(storePath).toBe(resolveStorePath(undefined, { agentId: "bot-2" }));
    expect(storePath).toContain(`${path.sep}bot-2${path.sep}`);
    expect(storePath).not.toContain(`${path.sep}users${path.sep}`);
  });

  it("routes dual-role / domain-less users to the same conversation store", async () => {
    const platformPath = await resolveSessionStorePathForInboundMessage({
      cfg: managedCfg,
      agentId: "main",
      gatewayClientUser: "a@acme.com",
      gatewayClientSessionDomain: "platform",
    });
    const missingDomainPath = await resolveSessionStorePathForInboundMessage({
      cfg: managedCfg,
      agentId: "main",
      gatewayClientUser: "a@acme.com",
      gatewayClientSessionDomain: null,
    });
    const employeePath = await resolveSessionStorePathForInboundMessage({
      cfg: managedCfg,
      agentId: "main",
      gatewayClientUser: "a@acme.com",
      gatewayClientSessionDomain: "employee",
    });
    expect(platformPath).toBe(employeePath);
    expect(missingDomainPath).toBe(employeePath);
    expect(platformPath).toBe(resolveStorePath(undefined, { agentId: "main" }));
    expect(platformPath).not.toContain(`${path.sep}tenants${path.sep}`);
  });

  it("buildSessionStorePathResolver works for platform-domain dual-role clients", async () => {
    const resolve = await buildSessionStorePathResolver(
      client({ user: "a@acme.com", sessionDomain: "platform" }),
      managedCfg,
    );
    const storePath = resolve("main");
    expect(storePath).toBe(resolveStorePath(undefined, { agentId: "main" }));
    expect(storePath).not.toContain(`${path.sep}tenants${path.sep}`);
  });

  it("workspace/agentDir/dataRoot use session-store inference for dual-role platform", async () => {
    withMembership({ userId: "u1", enterpriseId: "acme" });
    const platformClient = client({ user: "a@acme.com", sessionDomain: "platform" });
    const workspace = await resolveAgentWorkspaceDirForClient(platformClient, "main", managedCfg);
    const agentDir = await resolveAgentDirForClient(platformClient, "main", managedCfg);
    const dataRoot = await resolveDataRootForClient(platformClient, managedCfg);
    expect(workspace).toContain(`${path.sep}acme${path.sep}`);
    expect(workspace).toContain("u1");
    expect(agentDir).toContain(`${path.sep}acme${path.sep}`);
    expect(agentDir).toContain("u1");
    expect(dataRoot).toContain(`${path.sep}acme${path.sep}`);
    expect(dataRoot).toContain("u1");
    // Control-plane still refuses implicit tenant on platform (R1.3).
    await expect(requireTenantContext(platformClient)).rejects.toBeInstanceOf(TenantContextError);
  });

  it("ignores legacy global agents.list workspace outside the tenant live root", async () => {
    const employeeClient = client({ user: "a@acme.com", sessionDomain: "employee" });
    const cfg = {
      data: { mode: "managed" },
      agents: {
        list: [
          { id: "main" },
          {
            id: "agt-hrqb",
            workspace: path.join(os.tmpdir(), "openbot-global-workspace", "agents", "agt-hrqb"),
          },
        ],
      },
    } as OpenBotConfig;
    const workspace = await resolveAgentWorkspaceDirForClient(employeeClient, "agt-hrqb", cfg);
    const dataRoot = await resolveDataRootForClient(employeeClient, cfg);
    expect(workspace).toBe(path.join(dataRoot, "agents", "agt-hrqb", "workspace"));
    expect(workspace).toContain(`${path.sep}acme${path.sep}`);
    expect(workspace).not.toContain("openbot-global-workspace");
  });

  it("falls back to global store when multitenant is off", async () => {
    delete process.env.OPENBOT_MULTITENANT;
    loadConfigMock.mockReturnValue({
      gateway: { auth: { trustedProxy: {} } },
      data: { mode: "local" },
      session: {},
    });
    const p1 = await resolveSessionStorePathForInboundMessage({
      cfg: { data: { mode: "local" } } as OpenBotConfig,
      agentId: "main",
      gatewayClientUser: "a@acme.com",
      gatewayClientSessionDomain: "employee",
    });
    const p2 = await resolveSessionStorePathForInboundMessage({
      cfg: { data: { mode: "local" } } as OpenBotConfig,
      agentId: "main",
    });
    expect(p1).toBe(p2);
  });

  it("refuses managed personal-workbench inbound when user identity is missing", async () => {
    await expect(
      resolveSessionStorePathForInboundMessage({
        cfg: managedCfg,
        agentId: "main",
        gatewayClientUser: null,
        gatewayClientSessionDomain: "employee",
      }),
    ).rejects.toMatchObject({ name: "TenantContextError", code: "unresolved_user" });
  });

  it("refuses managed personal-workbench inbound when tenant context cannot resolve", async () => {
    withMembership({ userId: null, enterpriseId: null });
    await expect(
      resolveSessionStorePathForInboundMessage({
        cfg: managedCfg,
        agentId: "main",
        gatewayClientUser: "nobody@missing.com",
        gatewayClientSessionDomain: "employee",
      }),
    ).rejects.toMatchObject({ name: "TenantContextError" });
  });

  it("merges legacy tenant transcript into conversation store when newer", async () => {
    const stateDir = path.join(os.tmpdir(), `openbot-tctx-promote-${Date.now()}`);
    const prevState = process.env.OPENBOT_STATE_DIR;
    process.env.OPENBOT_STATE_DIR = stateDir;
    try {
      const sessionId = "sid-legacy-heal-1";
      const sessionKey = "agent:bot-2:main";
      const conversationDir = path.join(stateDir, "agents", "bot-2", "sessions");
      await fs.mkdir(conversationDir, { recursive: true });
      // Empty / missing conversation-store entry.
      await fs.writeFile(path.join(conversationDir, "sessions.json"), JSON.stringify({}), "utf8");

      const tenantDir = path.join(
        tenantsRoot,
        "acme",
        "users",
        "u1",
        "state",
        "agents",
        "bot-2",
        "sessions",
      );
      await fs.mkdir(tenantDir, { recursive: true });
      const legacyTranscript = path.join(tenantDir, `${sessionId}.jsonl`);
      await fs.writeFile(
        legacyTranscript,
        `${JSON.stringify({
          type: "message",
          message: { role: "user", content: "recover-me" },
        })}\n`,
        "utf8",
      );
      const tenantStorePath = path.join(tenantDir, "sessions.json");
      await fs.writeFile(
        tenantStorePath,
        JSON.stringify({
          [sessionKey]: {
            sessionId,
            updatedAt: 9_000,
            sessionFile: legacyTranscript,
          },
        }),
        "utf8",
      );

      const conversationStorePath = path.join(conversationDir, "sessions.json");
      await promoteGlobalSessionEntryIfNewer({
        sessionKey,
        tenantStorePath,
        resolveAgentStorePath: (agentId) =>
          path.join(stateDir, "agents", agentId, "sessions", "sessions.json"),
        cfg: managedCfg,
        ownership: { ownerTenantId: "acme", ownerUserId: "u1", ownerBotId: "bot-2" },
      });

      const dest = path.join(conversationDir, `${sessionId}.jsonl`);
      const body = await fs.readFile(dest, "utf8");
      expect(body).toContain("recover-me");
      const store = JSON.parse(await fs.readFile(conversationStorePath, "utf8")) as Record<
        string,
        {
          sessionId?: string;
          sessionFile?: string;
          ownerTenantId?: string;
          ownerUserId?: string;
          ownerBotId?: string;
        }
      >;
      expect(store[sessionKey]?.sessionId).toBe(sessionId);
      expect(store[sessionKey]?.sessionFile).toBe(dest);
      expect(store[sessionKey]?.ownerTenantId).toBe("acme");
      expect(store[sessionKey]?.ownerUserId).toBe("u1");
      expect(store[sessionKey]?.ownerBotId).toBe("bot-2");
      // Legacy file must remain (do not delete old locations in this change).
      await expect(fs.access(legacyTranscript)).resolves.toBeUndefined();
      await expect(fs.access(tenantStorePath)).resolves.toBeUndefined();
    } finally {
      if (prevState === undefined) {
        delete process.env.OPENBOT_STATE_DIR;
      } else {
        process.env.OPENBOT_STATE_DIR = prevState;
      }
      await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
      await fs.rm(tenantsRoot, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("skips promote for space: GROUP_PUBLIC session keys", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-promote-space-skip-"));
    const tenantsRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-promote-space-tenants-"));
    const prevState = process.env.OPENBOT_STATE_DIR;
    process.env.OPENBOT_STATE_DIR = stateDir;
    try {
      const sessionKey = "space:grp-no-split";
      const sessionId = "space-deadbeef";
      const globalDir = path.join(stateDir, "agents", "main", "sessions");
      await fs.mkdir(globalDir, { recursive: true });
      const globalTranscript = path.join(globalDir, `${sessionId}.jsonl`);
      await fs.writeFile(globalTranscript, '{"message":{"role":"user","content":"no-split"}}\n');
      await fs.writeFile(
        path.join(globalDir, "sessions.json"),
        JSON.stringify({
          [sessionKey]: {
            sessionId,
            updatedAt: 5_000,
            sessionFile: globalTranscript,
          },
        }),
        "utf8",
      );

      const tenantDir = path.join(
        tenantsRoot,
        "acme",
        "users",
        "u1",
        "state",
        "agents",
        "main",
        "sessions",
      );
      await fs.mkdir(tenantDir, { recursive: true });
      const tenantStorePath = path.join(tenantDir, "sessions.json");
      await fs.writeFile(tenantStorePath, JSON.stringify({}), "utf8");

      await promoteGlobalSessionEntryIfNewer({
        sessionKey,
        tenantStorePath,
        resolveAgentStorePath: () => tenantStorePath,
        cfg: { session: { mainKey: "main" } } as OpenBotConfig,
      });

      const dest = path.join(tenantDir, `${sessionId}.jsonl`);
      await expect(fs.access(dest)).rejects.toThrow();
      const store = JSON.parse(await fs.readFile(tenantStorePath, "utf8")) as Record<
        string,
        unknown
      >;
      expect(store[sessionKey]).toBeUndefined();
    } finally {
      if (prevState === undefined) {
        delete process.env.OPENBOT_STATE_DIR;
      } else {
        process.env.OPENBOT_STATE_DIR = prevState;
      }
      await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
      await fs.rm(tenantsRoot, { recursive: true, force: true }).catch(() => {});
    }
  });
});
