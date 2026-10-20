import { resolveTrustedCollaborationTenantId } from "../collaboration-learning/trusted-tenant.js";
import { readCollaborationLedgerArchive } from "../collaboration-ledger/reader.js";
import type { GatewayRequestHandlers } from "../server-methods/types.js";
import { loadContextScopeCatalog } from "./catalog.js";

export const contextScopeHandlers: GatewayRequestHandlers = {
  "context.scope.sources.catalog": async ({ client, respond }) => {
    const sources = await loadContextScopeCatalog({ client });
    respond(true, { sources });
  },
  "context.scope.audit.list": async ({ client, params, respond }) => {
    const tenantId = await resolveTrustedCollaborationTenantId(client);
    if (!tenantId) {
      respond(true, { records: [], source: "collaboration_ledger" });
      return;
    }
    const groupId = typeof params.groupId === "string" ? params.groupId.trim() : "";
    if (!groupId) {
      respond(true, { records: [], source: "collaboration_ledger" });
      return;
    }
    const limit = typeof params.limit === "number" ? params.limit : undefined;
    const archive = await readCollaborationLedgerArchive({
      groupId,
      tenantId,
      kinds: ["context_scope"],
      ...(limit != null ? { limit } : {}),
    });
    respond(true, {
      records: archive.records,
      source: "collaboration_ledger",
    });
  },
};
