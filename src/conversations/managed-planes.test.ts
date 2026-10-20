/**
 * Managed / multi-tenant plane discovery + retention cron multi-plane tick.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildSystemPlaneContext,
  computeManagedDataPlaneId,
  createConversation,
  listRetentionPlaneTargets,
  listTenantIdsFromVolume,
  resolveCatalogPathForPlane,
  resolveConversationDataRoot,
  resetConversationCatalogCache,
  runConversationRetentionCronTick,
  SqliteConversationCatalog,
} from "./index.js";

describe("managed planes + enterprise retention cron", () => {
  const roots: string[] = [];
  const prev: Record<string, string | undefined> = {};

  function saveEnv(keys: string[]) {
    for (const k of keys) {
      prev[k] = process.env[k];
    }
  }
  function restoreEnv() {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
  }

  afterEach(async () => {
    resetConversationCatalogCache();
    restoreEnv();
    for (const r of roots.splice(0)) {
      await fs.rm(r, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("lists tenant ids from volume and builds managed plane targets", async () => {
    const tenantsRoot = path.join(os.tmpdir(), `tenants-${Date.now()}`);
    roots.push(tenantsRoot);
    await fs.mkdir(path.join(tenantsRoot, "acme-corp"), { recursive: true });
    await fs.mkdir(path.join(tenantsRoot, "beta-inc"), { recursive: true });
    await fs.mkdir(path.join(tenantsRoot, ".hidden"), { recursive: true });
    await fs.writeFile(path.join(tenantsRoot, "not-a-dir"), "x");

    saveEnv(["OPENBOT_TENANTS_ROOT", "OPENBOT_DATA_MODE", "OPENBOT_MULTITENANT"]);
    process.env.OPENBOT_TENANTS_ROOT = tenantsRoot;
    process.env.OPENBOT_DATA_MODE = "managed";
    process.env.OPENBOT_MULTITENANT = "1";

    const ids = listTenantIdsFromVolume();
    expect(ids).toEqual(["acme-corp", "beta-inc"]);

    const cfg = { data: { mode: "managed" as const } };
    const planes = listRetentionPlaneTargets({ cfg });
    expect(planes).toHaveLength(2);
    expect(
      planes.map((p) => p.tenantId).toSorted((a, b) => (a ?? "").localeCompare(b ?? "")),
    ).toEqual(["acme-corp", "beta-inc"]);
    expect(planes[0]?.mode).toBe("managed");
    expect(planes[0]?.dataPlaneId).toBe(computeManagedDataPlaneId(planes[0].tenantId!));
    expect(planes[0]?.dataRoot).toContain("acme-corp");

    const ctx = buildSystemPlaneContext({
      cfg,
      tenantId: "acme-corp",
      mode: "managed",
    });
    expect(ctx.mode).toBe("managed");
    expect(ctx.tenantId).toBe("acme-corp");
    expect(ctx.roles).toContain("admin");
  });

  it("filters managed tenants via allow-list", async () => {
    const tenantsRoot = path.join(os.tmpdir(), `tenants-filter-${Date.now()}`);
    roots.push(tenantsRoot);
    await fs.mkdir(path.join(tenantsRoot, "keep-me"), { recursive: true });
    await fs.mkdir(path.join(tenantsRoot, "skip-me"), { recursive: true });

    saveEnv([
      "OPENBOT_TENANTS_ROOT",
      "OPENBOT_DATA_MODE",
      "OPENBOT_MULTITENANT",
      "OPENBOT_CONVERSATION_RETENTION_TENANT_IDS",
    ]);
    process.env.OPENBOT_TENANTS_ROOT = tenantsRoot;
    process.env.OPENBOT_DATA_MODE = "managed";
    process.env.OPENBOT_MULTITENANT = "1";
    process.env.OPENBOT_CONVERSATION_RETENTION_TENANT_IDS = "keep-me";

    const planes = listRetentionPlaneTargets({
      cfg: { data: { mode: "managed" } },
    });
    expect(planes).toHaveLength(1);
    expect(planes[0]?.tenantId).toBe("keep-me");
  });

  it("managed single-tenant uses OPENBOT_DEFAULT_TENANT_ID", () => {
    saveEnv([
      "OPENBOT_DATA_MODE",
      "OPENBOT_MULTITENANT",
      "OPENBOT_DEFAULT_TENANT_ID",
      "OPENBOT_TENANTS_ROOT",
    ]);
    const tenantsRoot = path.join(os.tmpdir(), `tenants-single-${Date.now()}`);
    roots.push(tenantsRoot);
    process.env.OPENBOT_TENANTS_ROOT = tenantsRoot;
    process.env.OPENBOT_DATA_MODE = "managed";
    delete process.env.OPENBOT_MULTITENANT;
    process.env.OPENBOT_DEFAULT_TENANT_ID = "solo-tenant";

    const planes = listRetentionPlaneTargets({
      cfg: { data: { mode: "managed" } },
    });
    expect(planes).toHaveLength(1);
    expect(planes[0]?.tenantId).toBe("solo-tenant");
  });

  it("runs retention tick across two managed tenant catalogs", async () => {
    const tenantsRoot = path.join(os.tmpdir(), `tenants-tick-${Date.now()}`);
    const stateDir = path.join(os.tmpdir(), `tenants-state-${Date.now()}`);
    roots.push(tenantsRoot, stateDir);
    await fs.mkdir(path.join(tenantsRoot, "t-a"), { recursive: true });
    await fs.mkdir(path.join(tenantsRoot, "t-b"), { recursive: true });

    saveEnv([
      "OPENBOT_TENANTS_ROOT",
      "OPENBOT_DATA_MODE",
      "OPENBOT_MULTITENANT",
      "OPENCLAW_STATE_DIR",
    ]);
    process.env.OPENBOT_TENANTS_ROOT = tenantsRoot;
    process.env.OPENBOT_DATA_MODE = "managed";
    process.env.OPENBOT_MULTITENANT = "1";
    process.env.OPENCLAW_STATE_DIR = stateDir;

    const cfg = { data: { mode: "managed" as const, schemaVersion: 1 } };

    // Seed a conversation in tenant A catalog
    const planeA = listRetentionPlaneTargets({ cfg }).find((p) => p.tenantId === "t-a")!;
    const ctxA = buildSystemPlaneContext({
      cfg,
      tenantId: "t-a",
      mode: "managed",
    });
    const catalogA = new SqliteConversationCatalog({
      path: resolveCatalogPathForPlane({
        dataRoot: planeA.dataRoot,
        mode: "managed",
        tenantId: "t-a",
      }),
    });
    await createConversation({
      deps: {
        cfg,
        ctx: { ...ctxA, dataPlaneId: planeA.dataPlaneId },
        catalog: catalogA,
        dataRoot: planeA.dataRoot,
      },
      surfaceType: "AGENT",
      agentId: "helper",
      title: "Tenant A chat",
    });
    catalogA.close();

    const result = await runConversationRetentionCronTick({
      cfg,
      enforce: false,
      migrateCold: false,
      limit: 50,
    });

    expect(result.planes.length).toBe(2);
    expect(result.planes.every((p) => p.ok)).toBe(true);
    const a = result.planes.find((p) => p.tenantId === "t-a");
    expect(a?.evaluated).toBeGreaterThanOrEqual(1);
    expect(result.evaluated).toBeGreaterThanOrEqual(1);
  });

  it("resolveConversationDataRoot isolates tenants", () => {
    saveEnv(["OPENBOT_TENANTS_ROOT", "OPENBOT_DATA_MODE"]);
    const tenantsRoot = path.join(os.tmpdir(), `tenants-root-${Date.now()}`);
    roots.push(tenantsRoot);
    process.env.OPENBOT_TENANTS_ROOT = tenantsRoot;
    process.env.OPENBOT_DATA_MODE = "managed";

    const a = resolveConversationDataRoot({
      cfg: { data: { mode: "managed" } },
      tenantId: "acme",
      mode: "managed",
    });
    const b = resolveConversationDataRoot({
      cfg: { data: { mode: "managed" } },
      tenantId: "beta",
      mode: "managed",
    });
    expect(a).not.toBe(b);
    expect(a).toContain(`${path.sep}acme`);
    expect(b).toContain(`${path.sep}beta`);
  });
});
