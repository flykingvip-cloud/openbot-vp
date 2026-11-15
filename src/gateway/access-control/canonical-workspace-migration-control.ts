import path from "node:path";
import { resolveStateDir } from "../../config/paths.js";
import {
  prepareCanonicalMigration,
  confirmCanonicalMigration,
} from "../data-governance/canonical-migration-plan.js";
import { getOrCreateFileDataGovernanceCatalogStore } from "../data-governance/catalog-store.js";
import { resolveDataGovernanceCatalogPath } from "../data-governance/paths.js";
import type { GatewayClient } from "../server-methods/types.js";
import { requireTenantContext } from "../tenant-context.js";
import { resolveTenantsRoot } from "../tenant-store-paths.js";

export async function controlCanonicalWorkspaceMigration(
  client: GatewayClient | null,
  request: { action: "prepare" | "confirm"; resourceId?: string; planId?: string },
) {
  if (client?.sessionDomain !== "enterprise" || client.sessionKind !== "enterprise-admin") {
    throw new Error("migration:enterprise_admin_required");
  }
  const actor = await requireTenantContext(client);
  if (!/^[a-zA-Z0-9_-]+$/.test(actor.tenantId)) {
    throw new Error("migration:invalid_trusted_tenant");
  }
  const stateDir = resolveStateDir();
  const store = getOrCreateFileDataGovernanceCatalogStore({
    storePath: resolveDataGovernanceCatalogPath(stateDir),
  });
  const common = {
    tenantId: actor.tenantId,
    adminId: actor.userId,
    store,
    tenantRoot: path.join(resolveTenantsRoot(), actor.tenantId),
    planRoot: path.join(stateDir, "data-governance", "canonical-migration-plans", actor.tenantId),
  };
  if (request.action === "prepare") {
    if (!request.resourceId?.trim()) {
      throw new Error("migration:resource_required");
    }
    return prepareCanonicalMigration({ ...common, resourceId: request.resourceId });
  }
  if (!request.planId?.trim()) {
    throw new Error("migration:plan_required");
  }
  return confirmCanonicalMigration({
    ...common,
    planId: request.planId,
    receiptDir: path.join(stateDir, "data-governance", "migration-receipts", actor.tenantId),
  });
}
