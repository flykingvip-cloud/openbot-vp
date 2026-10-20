/**
 * Stage 4 tenant store shard isolation E3 (managed_enterprise / shared addressing).
 *
 * Proposition (§5.3 租户隔离): under managed + MULTITENANT, chase a write to a
 * shard key (tenantId / userId / agentId); new store lands on tenant path or
 * explicit L0; missing context fails closed — not Stage 4 overall PASS.
 * Pin 单拍 / knowledge archive remain open. stage8_eligible stays false.
 *
 * Companion product tests: `src/gateway/tenant-store-paths.test.ts`.
 * Addressing guard: `pnpm check:tenant-addressing` (seat-tenant-index dual-layout
 * residual allowlisted with rationale).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../../src/config/types.js";
import type { TenantContext } from "../../src/gateway/tenant-context.js";
import {
  assertWithinTenantRoot,
  loadTenantSeatAssetsStore,
  resolveControlPlaneStorePathForContext,
  resolveDataRootForContext,
  resolveTenantControlPlaneDir,
  resolveTenantRuntimeStateRootForContext,
  resolveTenantSessionStorePathForContext,
  TENANT_SEAT_ASSETS_FILE,
} from "../../src/gateway/tenant-store-paths.js";

const managedCfg = { data: { mode: "managed" } } as OpenBotConfig;

describe("Stage 4 tenant store shard isolation (E3)", () => {
  let scratch = "";
  let tenantsRoot = "";
  const prev: Record<string, string | undefined> = {};

  beforeEach(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "stage4-tenant-shard-"));
    tenantsRoot = path.join(scratch, "tenants");
    for (const key of [
      "OPENBOT_TENANTS_ROOT",
      "OPENBOT_MULTITENANT",
      "OPENBOT_DATA_MODE",
      "OPENCLAW_DATA_MODE",
    ]) {
      prev[key] = process.env[key];
    }
    process.env.OPENBOT_TENANTS_ROOT = tenantsRoot;
    process.env.OPENBOT_MULTITENANT = "1";
    delete process.env.OPENBOT_DATA_MODE;
    delete process.env.OPENCLAW_DATA_MODE;
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  it("writes a control-plane store under tenants/<tid>/control-plane (shard key = tenantId)", async () => {
    const ctx: TenantContext = { tenantId: "acme", userId: "u-1", domain: "employee" };
    const storePath = resolveControlPlaneStorePathForContext(ctx, TENANT_SEAT_ASSETS_FILE);
    expect(storePath.replaceAll("\\", "/")).toBe(
      path
        .join(tenantsRoot, "acme", "control-plane", TENANT_SEAT_ASSETS_FILE)
        .replaceAll("\\", "/"),
    );

    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    fs.writeFileSync(
      storePath,
      JSON.stringify({
        version: 4,
        seats: { "seat-1": { seatId: "seat-1", tenantId: "acme" } },
      }),
    );

    const loaded = await loadTenantSeatAssetsStore("acme");
    expect(loaded.seats["seat-1"]?.seatId).toBe("seat-1");
    // Cross-tenant isolation: peer tenant does not see the write.
    expect((await loadTenantSeatAssetsStore("globex")).seats["seat-1"]).toBeUndefined();
    expect(fs.existsSync(resolveTenantControlPlaneDir("globex"))).toBe(false);
  });

  it("session store path shards by tenantId + userId + agentId", () => {
    const ctx: TenantContext = { tenantId: "acme", userId: "u-42", domain: "employee" };
    const sessions = resolveTenantSessionStorePathForContext(ctx, "agent-alpha");
    const stateRoot = resolveTenantRuntimeStateRootForContext(ctx);
    expect(sessions.replaceAll("\\", "/")).toBe(
      path
        .join(
          tenantsRoot,
          "acme",
          "users",
          "u-42",
          "state",
          "agents",
          "agent-alpha",
          "sessions",
          "sessions.json",
        )
        .replaceAll("\\", "/"),
    );
    expect(sessions.startsWith(stateRoot)).toBe(true);
    expect(() => assertWithinTenantRoot(ctx, sessions)).not.toThrow();
    expect(() =>
      assertWithinTenantRoot(ctx, path.join(tenantsRoot, "other", "users", "u-42", "state")),
    ).toThrow();
  });

  it("fail-closed: managed + MULTITENANT without tenant context refuses global fallback", () => {
    expect(() => resolveDataRootForContext(null, managedCfg)).toThrow(
      /fail-closed|tenant context/i,
    );
  });

  it("data root for context is tenants/<tid>/users/<uid>/OpenBot (L2 shard)", () => {
    const ctx: TenantContext = { tenantId: "acme", userId: "u-1", domain: "employee" };
    expect(resolveDataRootForContext(ctx, managedCfg).replaceAll("\\", "/")).toBe(
      path.join(tenantsRoot, "acme", "users", "u-1", "OpenBot").replaceAll("\\", "/"),
    );
  });
});
