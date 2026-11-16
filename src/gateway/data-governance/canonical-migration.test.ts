import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  prepareCanonicalMigration,
  confirmCanonicalMigration,
} from "./canonical-migration-plan.js";
import { migrateCanonicalWorkspace } from "./canonical-migration.js";
import { createFileDataGovernanceCatalogStore } from "./catalog-store.js";
import type { CatalogRecord } from "./types.js";
const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) {
    fs.rmSync(r, { recursive: true, force: true });
  }
});
async function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "canonical-real-migration-"));
  roots.push(root);
  const source = path.join(root, "source");
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, "report.md"), "actual artifact");
  const store = createFileDataGovernanceCatalogStore({
    storePath: path.join(root, "catalog.json"),
  });
  const owner = { kind: "user" as const, userId: "owner" };
  const record: CatalogRecord = {
    envelope: {
      resourceId: "resource",
      resourceType: "workspace",
      schemaVersion: 1,
      tenantId: "tenant",
      owner,
      scope: { kind: "tenant", tenantId: "tenant" },
      classification: "internal",
      lifecycleState: "active",
      governanceVersion: 1,
      canonicalBindingId: "old",
      createdAt: "2026-11-15T00:00:00.000Z",
      updatedAt: "2026-11-15T00:00:00.000Z",
    },
    bindings: [
      {
        bindingId: "old",
        resourceId: "resource",
        role: "canonical",
        state: "active",
        storageKind: "filesystem",
        locator: source,
        contentVersion: "old-version",
      },
    ],
  };
  await store.put(record);
  return {
    tenantId: "tenant",
    authorizedTenantId: "tenant",
    resourceId: "resource",
    expectedGovernanceVersion: 1,
    destination: path.join(root, "destination"),
    authorizationIdentity: "verified-owner-authorization",
    proof: { owner, scope: { kind: "tenant" as const, tenantId: "tenant" } },
    store,
    receiptDir: path.join(root, "receipts"),
  };
}
it("official copy, CAS and M3 produce complete evidence without a changes argument", async () => {
  const p = await fixture();
  const result = await migrateCanonicalWorkspace(p);
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error("verify failed");
  }
  const receipt = result.receipts[0];
  expect(receipt.passed).toBe(true);
  expect(receipt.fromBindingId).toBe("old");
  expect(receipt.toBindingId).not.toBe("old");
  expect(receipt.artifactSet).toEqual([
    { artifactId: "report.md", checksum: expect.stringMatching(/^sha256:[a-f0-9]{64}$/) },
  ]);
  expect(fs.readFileSync(path.join(p.destination, "report.md"), "utf8")).toBe("actual artifact");
  expect(
    (await p.store.get("resource"))?.bindings.filter(
      (b) => b.role === "canonical" && b.state === "active",
    ),
  ).toHaveLength(1);
});
it("refuses stale version, foreign tenant and an existing destination without overwriting", async () => {
  const p = await fixture();
  await expect(migrateCanonicalWorkspace({ ...p, expectedGovernanceVersion: 9 })).rejects.toThrow(
    "identity_or_version",
  );
  await expect(migrateCanonicalWorkspace({ ...p, authorizedTenantId: "foreign" })).rejects.toThrow(
    "authorization_required",
  );
  fs.mkdirSync(p.destination);
  fs.writeFileSync(path.join(p.destination, "keep"), "keep");
  await expect(migrateCanonicalWorkspace(p)).rejects.toThrow("destination_invalid");
  expect(fs.readFileSync(path.join(p.destination, "keep"), "utf8")).toBe("keep");
});

it("persisted signed prepare-confirm uses tenant placement and rejects stale replay", async () => {
  const p = await fixture();
  const tenantRoot = path.dirname(p.destination);
  const planRoot = path.join(tenantRoot, "plans");
  const plan = await prepareCanonicalMigration({
    tenantId: p.tenantId,
    adminId: "admin",
    resourceId: p.resourceId,
    store: p.store,
    tenantRoot,
    planRoot,
  });
  expect(fs.existsSync(plan.target)).toBe(false);
  const args = {
    tenantId: p.tenantId,
    adminId: "admin",
    planId: plan.id,
    store: p.store,
    tenantRoot,
    planRoot,
    receiptDir: p.receiptDir,
  };
  await expect(confirmCanonicalMigration({ ...args, adminId: "other" })).rejects.toThrow(
    "authorization_or_expiry",
  );
  const result = await confirmCanonicalMigration(args);
  expect(result.ok).toBe(true);
  expect(fs.readFileSync(path.join(plan.target, "report.md"), "utf8")).toBe("actual artifact");
  await expect(confirmCanonicalMigration(args)).rejects.toThrow("stale");
});
