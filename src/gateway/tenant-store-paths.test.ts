import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveDataRoot } from "../config/data-space.js";
import type { OpenBotConfig } from "../config/types.js";
import type { TenantContext } from "./tenant-context.js";
import {
  assertSafeTenantId,
  assertWithinTenantRoot,
  loadTenantSeatAssetsStore,
  resolveControlPlaneStorePathForContext,
  resolveDataRootForContext,
  resolveTenantAgentDirForContext,
  resolveTenantAgentSessionsDirForContext,
  resolveTenantControlPlaneDir,
  resolveTenantControlPlaneStorePath,
  resolveTenantRuntimeStateRootForContext,
  resolveTenantSessionStorePathForContext,
  TENANT_SEAT_ASSETS_FILE,
} from "./tenant-store-paths.js";

describe("tenant-store-paths (K-07 per-tenant store reader)", () => {
  let scratch = "";
  let tenantsRoot = "";

  beforeEach(async () => {
    scratch = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-tsp-"));
    tenantsRoot = path.join(scratch, "tenants");
    process.env.OPENBOT_TENANTS_ROOT = tenantsRoot;
  });

  afterEach(async () => {
    delete process.env.OPENBOT_TENANTS_ROOT;
    await fs.rm(scratch, { recursive: true, force: true });
  });

  it("resolves the per-tenant control-plane store path", () => {
    expect(resolveTenantControlPlaneStorePath("acme", TENANT_SEAT_ASSETS_FILE)).toBe(
      path.join(tenantsRoot, "acme", "control-plane", "seat-assets.json"),
    );
  });

  it("loads an imported seat-assets slice through the real store API", async () => {
    const cpDir = resolveTenantControlPlaneDir("acme");
    await fs.mkdir(cpDir, { recursive: true });
    // A control-plane slice as committed by tenant-import (a real seat-assets store shape).
    await fs.writeFile(
      path.join(cpDir, TENANT_SEAT_ASSETS_FILE),
      JSON.stringify({ version: 4, seats: { "seat-1": { seatId: "seat-1", tenantId: "acme" } } }),
    );
    const store = await loadTenantSeatAssetsStore("acme");
    expect(store.seats["seat-1"]?.seatId).toBe("seat-1");
  });

  it("returns a normalized default store when the tenant has no control-plane file", async () => {
    const store = await loadTenantSeatAssetsStore("globex");
    expect(store.seats).toEqual({});
    expect(typeof store.version).toBe("number");
  });

  it("isolates tenants: a slice written for one tenant is not visible to another", async () => {
    const cpDir = resolveTenantControlPlaneDir("acme");
    await fs.mkdir(cpDir, { recursive: true });
    await fs.writeFile(
      path.join(cpDir, TENANT_SEAT_ASSETS_FILE),
      JSON.stringify({ version: 4, seats: { "seat-1": { seatId: "seat-1", tenantId: "acme" } } }),
    );
    expect((await loadTenantSeatAssetsStore("acme")).seats["seat-1"]).toBeDefined();
    expect((await loadTenantSeatAssetsStore("globex")).seats["seat-1"]).toBeUndefined();
  });

  it("rejects an unsafe tenant id (path traversal)", () => {
    expect(() => assertSafeTenantId("../evil")).toThrow();
    expect(() => resolveTenantControlPlaneStorePath("../evil", TENANT_SEAT_ASSETS_FILE)).toThrow();
  });
});

describe("tenant-store-paths context-aware resolution (P0)", () => {
  const ctx: TenantContext = { tenantId: "acme", userId: "u-1", domain: "employee" };
  const localCfg = {
    data: { mode: "local", root: path.join(os.tmpdir(), "OpenBot-local-x") },
  } as OpenBotConfig;
  const managedCfg = { data: { mode: "managed" } } as OpenBotConfig;

  let scratch = "";
  let tenantsRoot = "";

  beforeEach(async () => {
    scratch = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-tspctx-"));
    tenantsRoot = path.join(scratch, "tenants");
    process.env.OPENBOT_TENANTS_ROOT = tenantsRoot;
    // Keep mode resolution driven by cfg (not ambient env) so the fallback assertions are exact.
    delete process.env.OPENBOT_DATA_MODE;
    delete process.env.OPENCLAW_DATA_MODE;
    // D5: shared multi-tenant addressing requires OPENBOT_MULTITENANT.
    process.env.OPENBOT_MULTITENANT = "1";
  });

  afterEach(async () => {
    delete process.env.OPENBOT_TENANTS_ROOT;
    delete process.env.OPENBOT_MULTITENANT;
    await fs.rm(scratch, { recursive: true, force: true });
  });

  it("R2 fallback: null ctx resolves byte-identical to resolveDataRoot(cfg)", () => {
    expect(resolveDataRootForContext(null, localCfg)).toBe(resolveDataRoot(localCfg));
    expect(resolveDataRootForContext(null, undefined)).toBe(resolveDataRoot(undefined));
  });

  it("R2 fallback: non-managed mode falls back even with a ctx present", () => {
    expect(resolveDataRootForContext(ctx, localCfg)).toBe(resolveDataRoot(localCfg));
  });

  it("D5: managed without MULTITENANT falls back to single-root resolveDataRoot", () => {
    delete process.env.OPENBOT_MULTITENANT;
    expect(resolveDataRootForContext(ctx, managedCfg)).toBe(resolveDataRoot(managedCfg));
    expect(resolveDataRootForContext(null, managedCfg)).toBe(resolveDataRoot(managedCfg));
  });

  it("fail-closed: shared multi-tenant with a missing context throws (no global fallback, 高危1)", () => {
    expect(() => resolveDataRootForContext(null, managedCfg)).toThrow();
  });

  it("managed + ctx resolves to the per-tenant per-user OpenBot root", () => {
    expect(resolveDataRootForContext(ctx, managedCfg)).toBe(
      path.join(tenantsRoot, "acme", "users", "u-1", "OpenBot"),
    );
  });

  it("rejects an unsafe user segment in managed mode (path traversal)", () => {
    const badCtx = { tenantId: "acme", userId: "../evil", domain: "employee" } as TenantContext;
    expect(() => resolveDataRootForContext(badCtx, managedCfg)).toThrow();
  });

  it("resolveControlPlaneStorePathForContext maps to the tenant control-plane file", () => {
    expect(resolveControlPlaneStorePathForContext(ctx, TENANT_SEAT_ASSETS_FILE)).toBe(
      path.join(tenantsRoot, "acme", "control-plane", "seat-assets.json"),
    );
  });

  it("assertWithinTenantRoot allows in-root paths and rejects escapes", () => {
    const within = resolveDataRootForContext(ctx, managedCfg);
    expect(() => assertWithinTenantRoot(ctx, within)).not.toThrow();
    expect(() =>
      assertWithinTenantRoot(ctx, path.join(tenantsRoot, "other-tenant", "x")),
    ).toThrow();
    expect(() => assertWithinTenantRoot(ctx, "/etc/passwd")).toThrow();
  });

  it("resolveTenantRuntimeStateRootForContext maps to users/<uid>/state (P3 L3)", () => {
    const stateRoot = resolveTenantRuntimeStateRootForContext(ctx, process.env);
    expect(stateRoot).toBe(path.join(tenantsRoot, "acme", "users", "u-1", "state"));
    expect(resolveTenantAgentSessionsDirForContext(ctx, "main", process.env)).toBe(
      path.join(stateRoot, "agents", "main", "sessions"),
    );
    expect(resolveTenantAgentDirForContext(ctx, "main", process.env)).toBe(
      path.join(stateRoot, "agents", "main", "agent"),
    );
    expect(resolveTenantSessionStorePathForContext(ctx, "main", process.env)).toBe(
      path.join(stateRoot, "agents", "main", "sessions", "sessions.json"),
    );
    expect(() => assertWithinTenantRoot(ctx, stateRoot, process.env)).not.toThrow();
  });
});
