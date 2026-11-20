import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { isolatedRoot } = vi.hoisted(() => ({
  isolatedRoot: `${process.env.TMPDIR || "/tmp"}/openbot-tctx-live-path-${process.pid}`,
}));

const {
  loadConfigMock,
  resolvePlatformAuthConfigMock,
  loadPlatformAuthStoreMock,
  findUserByEmailMock,
  findMembershipByUserIdMock,
} = vi.hoisted(() => ({
  loadConfigMock: vi.fn(),
  resolvePlatformAuthConfigMock: vi.fn(),
  loadPlatformAuthStoreMock: vi.fn(),
  findUserByEmailMock: vi.fn(),
  findMembershipByUserIdMock: vi.fn(),
}));

vi.mock("../config/config.js", () => ({ loadConfig: loadConfigMock }));
vi.mock("./platform-auth.js", () => ({
  resolvePlatformAuthConfig: resolvePlatformAuthConfigMock,
  loadPlatformAuthStore: loadPlatformAuthStoreMock,
  findUserByEmail: findUserByEmailMock,
  findMembershipByUserId: findMembershipByUserIdMock,
  findUniqueMembershipByUserId: findMembershipByUserIdMock,
  findMembershipByIdForUser: vi.fn(),
}));
vi.mock("../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils.js")>();
  return { ...actual, CONFIG_DIR: isolatedRoot };
});

import type { OpenBotConfig } from "../config/types.js";
import { createFileDataGovernanceCatalogStore } from "./data-governance/catalog-store.js";
import { resetSharedDataGovernanceCatalogForTests } from "./data-governance/runtime-catalog.js";
import { GOVERNANCE_ENVELOPE_SCHEMA_VERSION, type CatalogRecord } from "./data-governance/types.js";
import type { GatewayClient } from "./server-methods/types.js";
import { resolveAgentWorkspaceDirForClient, resolveDataRootForClient } from "./tenant-context.js";
import * as toolCwd from "./workspace-resolver/tool-cwd.js";

function client(partial: Partial<GatewayClient>): GatewayClient {
  return { connect: {} as never, user: "a@example.com", ...partial } as GatewayClient;
}

function workspaceRecord(params: {
  resourceId: string;
  tenantId: string;
  userId: string;
  locator: string;
}): CatalogRecord {
  return {
    envelope: {
      resourceId: params.resourceId,
      resourceType: "workspace",
      schemaVersion: GOVERNANCE_ENVELOPE_SCHEMA_VERSION,
      tenantId: params.tenantId,
      owner: { kind: "user", userId: params.userId },
      scope: { kind: "user", userId: params.userId },
      lifecycleState: "active",
      classification: "internal",
      governanceVersion: 1,
      canonicalBindingId: `bind:${params.resourceId}`,
      createdAt: "2026-08-18T00:00:00.000Z",
      updatedAt: "2026-08-18T00:00:00.000Z",
    },
    bindings: [
      {
        bindingId: `bind:${params.resourceId}`,
        resourceId: params.resourceId,
        role: "canonical",
        storageKind: "filesystem",
        locator: params.locator,
        state: "active",
        contentVersion: "v1",
      },
    ],
  };
}

function writeRegistry(assetId: string, legacyAgentId: string): void {
  fs.writeFileSync(
    path.join(isolatedRoot, "openbot-agent-registry.json"),
    `${JSON.stringify({
      version: 1,
      assets: {
        [assetId]: {
          agentAssetId: assetId,
          enterpriseId: "tenant-1",
          agentSlug: "sales",
          displayName: "sales",
          status: "active",
          legacyAgentId,
          createdAt: "2026-08-18T00:00:00.000Z",
          updatedAt: "2026-08-18T00:00:00.000Z",
        },
      },
      deployments: {},
      revisions: {},
      ownerBindings: {},
      quarantine: {},
    })}\n`,
  );
}

describe("live tenant-context path passes Catalog + agentAssetId", () => {
  const tenantsRoot = path.join(isolatedRoot, "tenants");
  const managedCfg = { data: { mode: "managed" } } as OpenBotConfig;
  const catalogBoundCwd = path.join(isolatedRoot, "catalog-bound-cwd");
  let spy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fs.mkdirSync(isolatedRoot, { recursive: true });
    fs.mkdirSync(catalogBoundCwd, { recursive: true });
    process.env.OPENBOT_STATE_DIR = isolatedRoot;
    process.env.OPENBOT_TENANTS_ROOT = tenantsRoot;
    process.env.OPENBOT_MULTITENANT = "1";
    resetSharedDataGovernanceCatalogForTests();
    loadConfigMock.mockReturnValue({
      gateway: { auth: { trustedProxy: {} } },
      data: { mode: "managed" },
    });
    resolvePlatformAuthConfigMock.mockReturnValue({ enabled: true });
    loadPlatformAuthStoreMock.mockResolvedValue({});
    findUserByEmailMock.mockReturnValue({ id: "user-1", email: "a@example.com" });
    findMembershipByUserIdMock.mockReturnValue({ enterpriseId: "tenant-1" });
    spy = vi.spyOn(toolCwd, "resolveAuthorizedAgentToolWorkspaceCwd");
  });

  afterEach(() => {
    spy.mockRestore();
    resetSharedDataGovernanceCatalogForTests();
    delete process.env.OPENBOT_STATE_DIR;
    delete process.env.OPENBOT_TENANTS_ROOT;
    delete process.env.OPENBOT_MULTITENANT;
    fs.rmSync(path.join(isolatedRoot, "data-governance"), { recursive: true, force: true });
    fs.rmSync(path.join(isolatedRoot, "openbot-agent-registry.json"), { force: true });
  });

  it("forwards registry-resolved Catalog + exact agentAssetId without mocking the loader", async () => {
    const store = createFileDataGovernanceCatalogStore({
      storePath: path.join(isolatedRoot, "data-governance", "catalog.json"),
    });
    await store.put(
      workspaceRecord({
        resourceId: "ws:tenant-1:user:user-1:asset:asset-1",
        tenantId: "tenant-1",
        userId: "user-1",
        locator: path.join(isolatedRoot, "wrong-asset-cwd"),
      }),
    );
    await store.put(
      workspaceRecord({
        resourceId: "ws:tenant-1:user:user-1:asset:asset-2",
        tenantId: "tenant-1",
        userId: "user-1",
        locator: catalogBoundCwd,
      }),
    );
    writeRegistry("asset-2", "sales-bot");

    const workspace = await resolveAgentWorkspaceDirForClient(
      client({ user: "a@example.com", sessionDomain: "employee" }),
      "sales-bot",
      managedCfg,
    );
    const membershipFallback = path.join(
      await resolveDataRootForClient(
        client({ user: "a@example.com", sessionDomain: "employee" }),
        managedCfg,
      ),
      "workspace-sales-bot",
    );

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        agentAssetId: "asset-2",
        agentId: "sales-bot",
        tenantId: "tenant-1",
        userId: "user-1",
      }),
    );
    const forwarded = spy.mock.calls[0]?.[0];
    expect(
      forwarded?.catalog?.getResource("ws:tenant-1:user:user-1:asset:asset-2")?.resourceId,
    ).toBe("ws:tenant-1:user:user-1:asset:asset-2");
    expect(forwarded?.catalog?.getResource("ws:tenant-1:user:user-1:asset:asset-1")).toBeNull();
    expect(workspace).toBe(fs.realpathSync(catalogBoundCwd));
    expect(workspace).not.toBe(membershipFallback);
  });

  it("forwards main steward resourceId + agentAssetId when registry maps main", async () => {
    const store = createFileDataGovernanceCatalogStore({
      storePath: path.join(isolatedRoot, "data-governance", "catalog.json"),
    });
    await store.put(
      workspaceRecord({
        resourceId: "ws:tenant-1:user:user-1:steward",
        tenantId: "tenant-1",
        userId: "user-1",
        locator: path.join(isolatedRoot, "steward-cwd"),
      }),
    );
    await store.put(
      workspaceRecord({
        resourceId: "ws:tenant-1:user:user-1:asset:asset-main",
        tenantId: "tenant-1",
        userId: "user-1",
        locator: catalogBoundCwd,
      }),
    );
    writeRegistry("asset-main", "main");

    const workspace = await resolveAgentWorkspaceDirForClient(
      client({ user: "a@example.com", sessionDomain: "employee" }),
      "main",
      managedCfg,
    );

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        agentAssetId: "asset-main",
        agentId: "main",
        tenantId: "tenant-1",
        userId: "user-1",
      }),
    );
    const forwarded = spy.mock.calls[0]?.[0];
    expect(
      forwarded?.catalog?.getResource("ws:tenant-1:user:user-1:asset:asset-main")?.resourceId,
    ).toBe("ws:tenant-1:user:user-1:asset:asset-main");
    expect(workspace).toBe(fs.realpathSync(catalogBoundCwd));
  });

  it("stays on membership when the live loader finds no Catalog row", async () => {
    const workspace = await resolveAgentWorkspaceDirForClient(
      client({ user: "a@example.com", sessionDomain: "employee" }),
      "sales-bot",
      managedCfg,
    );
    const membershipFallback = path.join(
      await resolveDataRootForClient(
        client({ user: "a@example.com", sessionDomain: "employee" }),
        managedCfg,
      ),
      "workspace-sales-bot",
    );

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "sales-bot",
        tenantId: "tenant-1",
        userId: "user-1",
      }),
    );
    const forwarded = spy.mock.calls[0]?.[0];
    expect(forwarded?.catalog).toBeUndefined();
    expect(forwarded?.agentAssetId).toBeUndefined();
    expect(workspace).toBe(membershipFallback);
  });
});
