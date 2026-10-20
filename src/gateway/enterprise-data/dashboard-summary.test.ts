// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  listAccessGovernanceMatrix,
  resolveAccessGovernanceOverview,
} from "./access-governance-store.js";
import { resolveCapabilityOverview } from "./capability-governance-store.js";
import { resolveDataCapabilityUsageRows } from "./dashboard-capability-rows-store.js";
import { resolveDataCapabilityDashboardSummary } from "./dashboard-summary-store.js";
import { listDataCapabilities } from "./data-capability-store.js";
import { listEnterpriseKnowledgeProjectionBindings } from "./enterprise-knowledge-projection-binding-store.js";
import { resolveGovernanceApprovalCenterOverview } from "./governance-approval-store.js";
import { resolveKnowledgeSupplyOverview } from "./knowledge-supply-store.js";
import { runProjectionMaterialization } from "./projection-materializer.js";
import { seedEnterpriseDataCatalog } from "./seeds.js";
import { normalizeEnterpriseDataStore } from "./store.js";

const tenantId = "tenant-acme";
const nowIso = "2026-06-05T12:00:00.000Z";

describe("dashboard summary aggregation", () => {
  it("maps each field to its authoritative resolver output (no cross-wiring)", async () => {
    const store = normalizeEnterpriseDataStore(null);
    seedEnterpriseDataCatalog({ store, tenantId, nowIso });

    const summary = resolveDataCapabilityDashboardSummary({ store, tenantId, nowIso });

    const access = resolveAccessGovernanceOverview({ store, tenantId });
    const capability = resolveCapabilityOverview({ store, tenantId });
    const supply = resolveKnowledgeSupplyOverview({ store, tenantId, nowIso });
    const approvals = resolveGovernanceApprovalCenterOverview({ store, tenantId });
    const departmentEntries = listAccessGovernanceMatrix({
      store,
      tenantId,
      dimension: "department",
    });

    // Each KPI must come from its own source, not a sibling overview field.
    expect(summary.totalDataSources).toBe(access.dataSourceCount);
    expect(summary.totalCapabilities).toBe(capability.capabilityCount);
    expect(summary.totalDepartments).toBe(departmentEntries.length);
    expect(summary.knowledgeObjectCount).toBe(supply.feedItemCount);
    expect(summary.enabledBindingCount).toBe(supply.enabledBindingCount);
    expect(summary.pendingApprovals).toBe(approvals.totalPending);
  });

  it("tracks knowledgeObjectCount against feed items after materialization", async () => {
    const store = normalizeEnterpriseDataStore(null);
    seedEnterpriseDataCatalog({ store, tenantId, nowIso });

    const before = resolveDataCapabilityDashboardSummary({ store, tenantId, nowIso });
    expect(before.knowledgeObjectCount).toBe(0);

    const binding = listEnterpriseKnowledgeProjectionBindings({ store, tenantId }).find(
      (item) => store.enterpriseKnowledgeProjectionSpecs[item.projectionId]?.lifecycle === "active",
    );
    expect(binding).toBeTruthy();
    await runProjectionMaterialization({
      store,
      tenantId,
      bindingId: binding!.bindingId,
      nowIso,
    });

    const after = resolveDataCapabilityDashboardSummary({ store, tenantId, nowIso });
    // feedItemCount is produced-object count, so it must rise after a materialization.
    expect(after.knowledgeObjectCount).toBe(
      resolveKnowledgeSupplyOverview({ store, tenantId, nowIso }).feedItemCount,
    );
    expect(after.knowledgeObjectCount).toBeGreaterThan(before.knowledgeObjectCount);
  });

  it("counts distinct department targets, not raw policies", async () => {
    const store = normalizeEnterpriseDataStore(null);
    seedEnterpriseDataCatalog({ store, tenantId, nowIso });

    const summary = resolveDataCapabilityDashboardSummary({ store, tenantId, nowIso });
    const departmentEntries = listAccessGovernanceMatrix({
      store,
      tenantId,
      dimension: "department",
    });
    const distinctIds = new Set(departmentEntries.map((entry) => entry.targetId));
    // Matrix already dedupes per targetId; summary must equal the distinct count.
    expect(summary.totalDepartments).toBe(distinctIds.size);
  });
});

describe("dashboard capability rows aggregation", () => {
  it("aggregates per-capability sources/targets/knowledge counts from in-store data", async () => {
    const store = normalizeEnterpriseDataStore(null);
    seedEnterpriseDataCatalog({ store, tenantId, nowIso });

    const rows = resolveDataCapabilityUsageRows({ store, tenantId });
    expect(rows.length).toBeGreaterThan(0);

    const capabilities = listDataCapabilities({ store, tenantId });
    expect(rows.length).toBeLessThanOrEqual(capabilities.length);

    for (const row of rows) {
      const capability = capabilities.find((c) => c.capabilityId === row.capabilityId);
      expect(capability).toBeTruthy();
      // sourceNames count matches the capability's resolvable sources.
      expect(row.sourceNames.length).toBe(capability!.sourceIds.length);
      expect(row.enabled).toBe(capability!.enabled);
      // targetLabels are deduped human labels (no raw targetId leakage as a count).
      expect(new Set(row.targetLabels).size).toBe(row.targetLabels.length);
      expect(row.knowledgeObjectCount).toBeGreaterThanOrEqual(0);
      // lastRunAt is either null (never run) or an ISO timestamp string.
      expect(row.lastRunAt === null || typeof row.lastRunAt === "string").toBe(true);
    }
  });

  it("sorts by knowledgeObjectCount desc and respects the limit", async () => {
    const store = normalizeEnterpriseDataStore(null);
    seedEnterpriseDataCatalog({ store, tenantId, nowIso });

    // Materialize one active projection so at least one capability has knowledge objects.
    const binding = listEnterpriseKnowledgeProjectionBindings({ store, tenantId }).find(
      (item) => store.enterpriseKnowledgeProjectionSpecs[item.projectionId]?.lifecycle === "active",
    );
    expect(binding).toBeTruthy();
    await runProjectionMaterialization({ store, tenantId, bindingId: binding!.bindingId, nowIso });

    const rows = resolveDataCapabilityUsageRows({ store, tenantId, limit: 2 });
    expect(rows.length).toBeLessThanOrEqual(2);
    for (let i = 1; i < rows.length; i += 1) {
      expect(rows[i - 1].knowledgeObjectCount).toBeGreaterThanOrEqual(rows[i].knowledgeObjectCount);
    }
  });
});
