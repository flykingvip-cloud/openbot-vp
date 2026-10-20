import { describe, expect, it } from "vitest";
import { invokeEnterpriseDataAction } from "./data-gateway.js";
import { resolvePolicyBackedSeatActionGrant } from "./policy-backed-grant-resolver.js";
import { seedEnterpriseDataCatalog } from "./seeds.js";
import { normalizeEnterpriseDataStore } from "./store.js";

const tenantId = "tenant-acme";
const nowIso = "2026-06-05T12:00:00.000Z";

describe("resolvePolicyBackedSeatActionGrant", () => {
  it("resolves department and role policies into synthetic runtime grants", async () => {
    const store = normalizeEnterpriseDataStore(null);
    seedEnterpriseDataCatalog({ store, tenantId, nowIso });
    const ref = {
      connectorId: "crm-salesforce",
      actionKey: "crm.customer.read_summary",
      version: "v1",
    };
    const byRole = resolvePolicyBackedSeatActionGrant({
      store,
      tenantId,
      seatId: "seat-without-grants",
      ref,
      roleCode: "sales-mgr",
    });
    expect(byRole?.dataAccessPolicyId).toBeTruthy();
    const byDepartment = resolvePolicyBackedSeatActionGrant({
      store,
      tenantId,
      seatId: "seat-without-grants",
      ref,
      departmentId: "sales-mgr:华东销售",
    });
    expect(byDepartment?.scopePolicyId).toBeTruthy();
  });

  it("allows enterprise data gateway invoke via role policy without seat grants", async () => {
    const store = normalizeEnterpriseDataStore(null);
    seedEnterpriseDataCatalog({ store, tenantId, nowIso });
    const response = await invokeEnterpriseDataAction({
      store,
      context: {
        tenantId,
        seatId: "seat-without-grants",
        employeeId: "employee-2",
        userId: "employee-2",
        roleCode: "sales-mgr",
        departmentId: "sales-mgr:华东销售",
        teamLabel: "华东销售",
        trustAttestation: "server-session-v1",
      },
      ref: {
        connectorId: "crm-salesforce",
        actionKey: "crm.customer.read_summary",
        version: "v1",
      },
      nowIso,
    });
    expect(response.ok).toBe(true);
  });
});
