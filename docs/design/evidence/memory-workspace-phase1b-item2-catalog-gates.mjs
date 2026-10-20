/**
 * Phase 1B item 2 §5.4 authority Catalog gates.
 * Shared by fixture Stage B and production evidence persist. Not unlock.
 */
export const CONFLICT_UNKNOWN_CATALOG_WRITE_BLOCKED = true;

export function measureAuthorityCatalogGates(params) {
  const records = Object.values(params.catalog?.records ?? {}).filter(
    (row) => row?.envelope?.resourceType === "workspace",
  );
  const catalogIds = new Set(records.map((row) => row.envelope?.resourceId).filter(Boolean));
  const classified = (params.candidate?.candidates ?? []).filter(
    (row) => row.classification === "classified",
  );
  const byKind = (kind) => classified.filter((row) => row.workspaceKind === kind);
  const allInCatalog = (rows) =>
    rows.length > 0 && rows.every((row) => row.resourceId && catalogIds.has(row.resourceId));
  const employee = byKind("employee_private");
  const agent = byKind("agent_primary");
  const group = byKind("group_shared");
  const quarantined = params.persist?.quarantined ?? [];
  const stewardContractDefined =
    employee.length > 0 &&
    employee.every((row) => String(row.resourceId ?? "").endsWith(":steward"));
  const conflictInCatalog = quarantined.filter(
    (row) => "resourceId" in row && catalogIds.has(String(row.resourceId ?? "")),
  ).length;
  const gates = {
    employee_private: {
      required: "100% Catalog records",
      classifiedAuthority: employee.length,
      persistentCatalog: employee.filter((row) => row.resourceId && catalogIds.has(row.resourceId))
        .length,
      stewardContractDefined,
      gate: stewardContractDefined && allInCatalog(employee) ? "pass" : "fail",
    },
    agent_primary: {
      required: "100% exact agentAssetId",
      classifiedAuthority: agent.length,
      persistentCatalog: agent.filter((row) => row.resourceId && catalogIds.has(row.resourceId))
        .length,
      gate: allInCatalog(agent) ? "pass" : "fail",
    },
    group_shared: {
      required: "100% tenant-scoped group binding",
      classifiedAuthority: group.length,
      persistentCatalog: group.filter((row) => row.resourceId && catalogIds.has(row.resourceId))
        .length,
      gate: allInCatalog(group) ? "pass" : "fail",
    },
    conflict_or_unknown: {
      required: "100% write-blocked and listed",
      listed: quarantined.length,
      inCatalog: conflictInCatalog,
      blockedInProduction: CONFLICT_UNKNOWN_CATALOG_WRITE_BLOCKED,
      gate:
        quarantined.length > 0 && CONFLICT_UNKNOWN_CATALOG_WRITE_BLOCKED && conflictInCatalog === 0
          ? "pass"
          : "fail",
    },
  };
  return {
    catalogIds: [...catalogIds],
    recordCount: records.length,
    gates,
    authorityCatalogGatesPass: Object.values(gates).every((gate) => gate.gate === "pass"),
  };
}
