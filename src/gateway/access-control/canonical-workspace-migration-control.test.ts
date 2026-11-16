import { expect, it, vi } from "vitest";
const s = vi.hoisted(() => ({
  prepare: vi.fn(async (input) => input),
  confirm: vi.fn(async (input) => input),
}));
vi.mock("../../config/paths.js", () => ({ resolveStateDir: () => "/state" }));
vi.mock("../tenant-store-paths.js", () => ({ resolveTenantsRoot: () => "/tenants" }));
vi.mock("../tenant-context.js", () => ({
  requireTenantContext: async () => ({ tenantId: "tenant", userId: "admin" }),
}));
vi.mock("../data-governance/catalog-store.js", () => ({
  getOrCreateFileDataGovernanceCatalogStore: () => ({}),
}));
vi.mock("../data-governance/canonical-migration-plan.js", () => ({
  prepareCanonicalMigration: s.prepare,
  confirmCanonicalMigration: s.confirm,
}));
import { controlCanonicalWorkspaceMigration } from "./canonical-workspace-migration-control.js";
const client = { sessionDomain: "enterprise", sessionKind: "enterprise-admin" } as Parameters<
  typeof controlCanonicalWorkspaceMigration
>[0];
it("requires trusted admin before planning", async () => {
  await expect(
    controlCanonicalWorkspaceMigration(null, { action: "prepare", resourceId: "r" }),
  ).rejects.toThrow("admin_required");
});
it("uses only server roots and trusted actor to prepare", async () => {
  await controlCanonicalWorkspaceMigration(client, { action: "prepare", resourceId: "r" });
  expect(s.prepare).toHaveBeenCalledWith(
    expect.objectContaining({
      tenantId: "tenant",
      adminId: "admin",
      resourceId: "r",
      tenantRoot: "/tenants/tenant",
      planRoot: "/state/data-governance/canonical-migration-plans/tenant",
    }),
  );
});
it("confirms by plan identity with server receipt destination", async () => {
  await controlCanonicalWorkspaceMigration(client, { action: "confirm", planId: "p" });
  expect(s.confirm).toHaveBeenCalledWith(
    expect.objectContaining({
      planId: "p",
      tenantId: "tenant",
      adminId: "admin",
      receiptDir: "/state/data-governance/migration-receipts/tenant",
    }),
  );
});
it("rejects missing plan or resource", async () => {
  await expect(controlCanonicalWorkspaceMigration(client, { action: "confirm" })).rejects.toThrow(
    "plan_required",
  );
  await expect(controlCanonicalWorkspaceMigration(client, { action: "prepare" })).rejects.toThrow(
    "resource_required",
  );
});
