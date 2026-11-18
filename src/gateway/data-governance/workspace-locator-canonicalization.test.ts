import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { canonicalizeWorkspaceCatalogCommand } from "../../commands/canonicalize-workspace-catalog.js";
import { buildBuiltinStewardWorkspaceResourceId } from "../workspace-resolver/builders.js";
import { resolveDataGovernanceCatalogPath } from "./paths.js";
import { resetSharedDataGovernanceCatalogForTests } from "./runtime-catalog.js";
import type { CatalogRecord } from "./types.js";
import {
  applyWorkspaceCatalogCanonicalization,
  backupGovernanceCatalogFile,
  canonicalizeWorkspaceLocator,
  planWorkspaceCatalogCanonicalization,
  restoreOwnerWriteBit,
} from "./workspace-locator-canonicalization.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    try {
      fs.chmodSync(root, 0o755);
    } catch {
      // directory may already be writable
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function record(params: {
  resourceId: string;
  locator: string;
  userId?: string;
  lifecycleState?: CatalogRecord["envelope"]["lifecycleState"];
}): CatalogRecord {
  const userId = params.userId ?? "user-1";
  return {
    envelope: {
      resourceId: params.resourceId,
      resourceType: "workspace",
      schemaVersion: 1,
      tenantId: "001",
      owner: { kind: "user", userId },
      scope: { kind: "tenant", tenantId: "001" },
      lifecycleState: params.lifecycleState ?? "active",
      classification: "internal",
      governanceVersion: 1,
      canonicalBindingId: "binding",
      createdAt: "2026-11-18T00:00:00.000Z",
      updatedAt: "2026-11-18T00:00:00.000Z",
    },
    bindings: [
      {
        bindingId: "binding",
        resourceId: params.resourceId,
        role: "canonical",
        state: "active",
        locator: params.locator,
        storageKind: "filesystem",
        contentVersion: "1",
      },
    ],
  };
}

it("rewrites historical /root/.openbot onto STATE_DIR and never onto operators", () => {
  const stateDir = "/var/lib/openbot/t247-a-gateway";
  const rewritten = canonicalizeWorkspaceLocator(
    "/root/.openbot/tenants/001/users/user-1/OpenBot/agents/main/workspace",
    { stateDir, tenantsRoot: path.join(stateDir, "tenants") },
  );
  expect(rewritten).toEqual({
    changed: true,
    locator: `${stateDir}/tenants/001/users/user-1/OpenBot/agents/main/workspace`,
  });
  expect(rewritten.locator).not.toContain("/operators/");
});

it("rewrites historical /root/openbot-tenants onto TENANTS_ROOT", () => {
  const rewritten = canonicalizeWorkspaceLocator("/root/openbot-tenants/001/users/user-1", {
    stateDir: "/var/lib/openbot/state",
    tenantsRoot: "/var/lib/openbot/t247-a-tenants",
  });
  expect(rewritten.locator).toBe("/var/lib/openbot/t247-a-tenants/001/users/user-1");
});

it("plans locator rewrite, short-id retirement, and owner-write restore", () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "canon-plan-"));
  roots.push(stateDir);
  const officialLocator = path.join(
    stateDir,
    "tenants/001/users/user-1/OpenBot/agents/main/workspace",
  );
  fs.mkdirSync(officialLocator, { recursive: true });
  fs.chmodSync(officialLocator, 0o555);
  const userId = "user-1";
  const officialId = buildBuiltinStewardWorkspaceResourceId({ tenantId: "001", userId });
  const actions = planWorkspaceCatalogCanonicalization({
    records: [
      record({
        resourceId: `ws:001:user:${userId}:steward`,
        locator: `/root/.openbot/tenants/001/users/${userId}/OpenBot/agents/main/workspace`,
        userId,
      }),
    ],
    roots: { stateDir, tenantsRoot: path.join(stateDir, "tenants") },
  });
  expect(actions).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: "rewrite_locator",
        to: officialLocator,
      }),
      expect.objectContaining({
        kind: "retire_short_steward",
        officialResourceId: officialId,
        mintOfficial: true,
      }),
      expect.objectContaining({
        kind: "restore_owner_write",
        locator: officialLocator,
        mode: "555",
      }),
    ]),
  );
  fs.chmodSync(officialLocator, 0o755);
});

it("applies official mint, retires the short id, and restores owner write", async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "canon-apply-"));
  roots.push(stateDir);
  const officialLocator = path.join(
    stateDir,
    "tenants/001/users/user-1/OpenBot/agents/main/workspace",
  );
  fs.mkdirSync(officialLocator, { recursive: true });
  fs.chmodSync(officialLocator, 0o555);
  const userId = "user-1";
  const officialId = buildBuiltinStewardWorkspaceResourceId({ tenantId: "001", userId });
  const short = record({
    resourceId: `ws:001:user:${userId}:steward`,
    locator: `/root/.openbot/tenants/001/users/${userId}/OpenBot/agents/main/workspace`,
    userId,
  });
  const store = new Map<string, CatalogRecord>([[short.envelope.resourceId, short]]);
  const catalog = {
    get: async (id: string) => store.get(id),
    put: async (row: CatalogRecord) => {
      store.set(row.envelope.resourceId, row);
    },
  };
  const actions = planWorkspaceCatalogCanonicalization({
    records: [short],
    roots: { stateDir, tenantsRoot: path.join(stateDir, "tenants") },
  });
  const report = await applyWorkspaceCatalogCanonicalization({
    catalog,
    actions,
    applyPermissions: true,
  });
  expect(report.errors).toEqual([]);
  expect(store.get(officialId)?.envelope.resourceId).toBe(officialId);
  expect(store.get(officialId)?.bindings[0]?.locator).toBe(officialLocator);
  expect(store.get(short.envelope.resourceId)?.envelope.lifecycleState).toBe("retired");
  expect((fs.statSync(officialLocator).mode & 0o777).toString(8)).toBe("755");
  expect(restoreOwnerWriteBit(officialLocator)).toBe(false);
  fs.chmodSync(officialLocator, 0o755);
});

it("backs up the on-disk governance catalog file", () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "canon-backup-"));
  roots.push(stateDir);
  const catalogPath = resolveDataGovernanceCatalogPath(stateDir);
  fs.mkdirSync(path.dirname(catalogPath), { recursive: true });
  const payload = `${JSON.stringify({ schemaVersion: 1, revision: 1, records: {} }, null, 2)}\n`;
  fs.writeFileSync(catalogPath, payload);
  const backup = backupGovernanceCatalogFile(stateDir, new Date("2026-11-18T02:50:00.000Z"));
  expect(backup).toBe(`${catalogPath}.bak-2026-11-18T025000000Z`);
  expect(fs.readFileSync(backup, "utf8")).toBe(payload);
  expect(fs.readFileSync(catalogPath, "utf8")).toBe(payload);
});

it("on --yes, backs up catalog.json before rewriting locators", async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "canon-yes-"));
  roots.push(stateDir);
  const officialLocator = path.join(
    stateDir,
    "tenants/001/users/user-1/OpenBot/agents/main/workspace",
  );
  fs.mkdirSync(officialLocator, { recursive: true });
  const userId = "user-1";
  const officialId = buildBuiltinStewardWorkspaceResourceId({ tenantId: "001", userId });
  const historical = `/root/.openbot/tenants/001/users/${userId}/OpenBot/agents/main/workspace`;
  const row = record({ resourceId: officialId, locator: historical, userId });
  const catalogPath = resolveDataGovernanceCatalogPath(stateDir);
  fs.mkdirSync(path.dirname(catalogPath), { recursive: true });
  const original = {
    schemaVersion: 1,
    revision: 1,
    records: { [officialId]: row },
  };
  fs.writeFileSync(catalogPath, `${JSON.stringify(original, null, 2)}\n`);
  const prevStateDir = process.env.OPENBOT_STATE_DIR;
  const prevTenantsRoot = process.env.OPENBOT_TENANTS_ROOT;
  process.env.OPENBOT_STATE_DIR = stateDir;
  delete process.env.OPENBOT_TENANTS_ROOT;
  resetSharedDataGovernanceCatalogForTests();
  try {
    await canonicalizeWorkspaceCatalogCommand({ yes: true });
  } finally {
    if (prevStateDir === undefined) {
      delete process.env.OPENBOT_STATE_DIR;
    } else {
      process.env.OPENBOT_STATE_DIR = prevStateDir;
    }
    if (prevTenantsRoot === undefined) {
      delete process.env.OPENBOT_TENANTS_ROOT;
    } else {
      process.env.OPENBOT_TENANTS_ROOT = prevTenantsRoot;
    }
    resetSharedDataGovernanceCatalogForTests();
  }
  const backups = fs
    .readdirSync(path.dirname(catalogPath))
    .filter((name) => name.startsWith("catalog.json.bak-"));
  expect(backups).toHaveLength(1);
  const backed = JSON.parse(
    fs.readFileSync(path.join(path.dirname(catalogPath), backups[0]), "utf8"),
  );
  expect(backed.records[officialId].bindings[0].locator).toBe(historical);
  const updated = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
  expect(updated.records[officialId].bindings[0].locator).toBe(officialLocator);
});
