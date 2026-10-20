import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildApprovalContextSnapshot,
  createApprovalRequest,
  decideApprovalRequest,
} from "./approval-workflow.js";
import { getAuditTrace } from "./audit-runtime.js";
import { EnterpriseDataStoreError } from "./connector-action-store.js";
import { invokeEnterpriseDataAction } from "./data-gateway.js";
import { createTrustedExecutionContextForTest } from "./enterprise-data-seat-context.js";
import { previewClassificationMasking } from "./field-classification-store.js";
import { evaluateScopePolicy, findScopePolicy } from "./scope-policy-store.js";
import { findSeatActionGrant } from "./seat-action-grant-store.js";
import { seedEnterpriseDataCatalog } from "./seeds.js";
import { normalizeEnterpriseDataStore } from "./store.js";

vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return {
    ...actual,
    CONFIG_DIR: path.join(os.tmpdir(), "openbot-enterprise-data-gateway-test"),
  };
});

const tenantId = "tenant-acme";
const nowIso = "2026-06-05T12:00:00.000Z";
const mockedConfigDir = path.join(os.tmpdir(), "openbot-enterprise-data-gateway-test");

function trustedContext(overrides: {
  seatId: string;
  employeeId: string;
  teamLabel?: string;
  roleCode?: string;
  departmentId?: string;
}) {
  return createTrustedExecutionContextForTest({
    tenantId,
    seatId: overrides.seatId,
    employeeId: overrides.employeeId,
    userId: overrides.employeeId,
    teamLabel: overrides.teamLabel,
    roleCode: overrides.roleCode,
    departmentId: overrides.departmentId,
  });
}

function cleanStore() {
  fs.rmSync(mockedConfigDir, { recursive: true, force: true });
  fs.mkdirSync(mockedConfigDir, { recursive: true });
}

describe("enterprise-data M1 gateway", () => {
  beforeEach(() => {
    cleanStore();
  });

  afterEach(() => {
    cleanStore();
  });

  it("evaluates TEAM scope with fail-closed when teamLabel is missing", async () => {
    const store = normalizeEnterpriseDataStore(null);
    seedEnterpriseDataCatalog({ store, tenantId, nowIso });
    const policy = findScopePolicy(store, tenantId, "scope-team-default");
    try {
      evaluateScopePolicy({
        policy: policy!,
        context: {
          tenantId,
          seatId: "seat-sales-director",
          employeeId: "emp-dir-001",
          userId: "emp-dir-001",
        },
      });
      expect.fail("expected TEAM scope without teamLabel to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(EnterpriseDataStoreError);
      expect((error as EnterpriseDataStoreError).code).toBe("SCOPE_CONTEXT_MISSING");
    }
  });

  it("rejects invoke without trusted server attestation", async () => {
    const store = normalizeEnterpriseDataStore(null);
    seedEnterpriseDataCatalog({ store, tenantId, nowIso });
    const result = await invokeEnterpriseDataAction({
      store,
      context: {
        tenantId,
        seatId: "seat-sales-mgr-east",
        employeeId: "emp-mgr-001",
        userId: "emp-mgr-001",
      },
      ref: {
        connectorId: "crm-salesforce",
        actionKey: "crm.customer.read_summary",
        version: "v1",
      },
      nowIso,
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.code).toBe("UNTRUSTED_EXECUTION_CONTEXT");
  });

  it("invokes read_summary with SELF scope and masks confidential fields", async () => {
    const store = normalizeEnterpriseDataStore(null);
    seedEnterpriseDataCatalog({ store, tenantId, nowIso });
    const result = await invokeEnterpriseDataAction({
      store,
      context: trustedContext({
        seatId: "seat-sales-mgr-east",
        employeeId: "emp-mgr-001",
      }),
      ref: {
        connectorId: "crm-salesforce",
        actionKey: "crm.customer.read_summary",
        version: "v1",
      },
      nowIso,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.scopeApplied).toContain("本人");
    expect(result.source).toBe("crm-salesforce");
    expect(result.actionKey).toBe("crm.customer.read_summary");
    expect(result.version).toBe("v1");
    expect(result.generatedAt).toBe(nowIso);
    expect(result.maskedFields).toContain("customer.phone");
    expect(result.maskedFields).toContain("customer.email");
    const customer = (result.data as { customer: { phone: string } }).customer;
    expect(customer.phone).toMatch(/\*\*\*\*/);
    const trace = getAuditTrace({ store, tenantId, traceId: result.traceId });
    expect(trace.invocation?.status).toBe("SUCCESS");
    expect(trace.data?.maskedFields).toContain("customer.phone");
  });

  it("fail-closes unknown v2 fields", async () => {
    const store = normalizeEnterpriseDataStore(null);
    seedEnterpriseDataCatalog({ store, tenantId, nowIso });
    const preview = previewClassificationMasking({
      store,
      tenantId,
      ref: {
        connectorId: "crm-salesforce",
        actionKey: "crm.customer.read_summary",
        version: "v2",
      },
      samplePayload: {
        customer: {
          id: "cust-001",
          name: "测试",
          phone: "13812345678",
          email: "a@example.com",
          segment: "enterprise",
          new_field_v2: "secret",
        },
      },
    });
    expect(preview.unknownFields).toContain("customer.new_field_v2");
    expect(preview.maskedFields).toContain("customer.new_field_v2");
  });

  it("requires approval for export and consumes PER_REQUEST context", async () => {
    const store = normalizeEnterpriseDataStore(null);
    seedEnterpriseDataCatalog({ store, tenantId, nowIso });
    const ref = {
      connectorId: "crm-salesforce",
      actionKey: "crm.customer.export",
      version: "v1",
    };
    const denied = await invokeEnterpriseDataAction({
      store,
      context: trustedContext({
        seatId: "seat-sales-director",
        employeeId: "emp-dir-001",
        teamLabel: "华东销售",
      }),
      ref,
      nowIso,
    });
    expect(denied.ok).toBe(false);
    if (denied.ok) {
      return;
    }
    expect(denied.code).toBe("APPROVAL_REQUIRED");
    const approvalContextId = String(denied.details?.approvalContextId);
    const grant = findSeatActionGrant(store, tenantId, "seat-sales-director", ref)!;
    const request = createApprovalRequest({
      store,
      tenantId,
      seatId: "seat-sales-director",
      employeeId: "emp-dir-001",
      ref,
      approvalPolicyId: grant.approvalPolicyId!,
      approvalContextId,
      reason: "月度报表",
      nowIso,
    });
    decideApprovalRequest({
      store,
      tenantId,
      approvalId: request.approvalId,
      decision: "approved",
      decidedBy: "emp-admin-001",
      contextSnapshot: buildApprovalContextSnapshot({ store, tenantId, grant, ref }),
      nowIso,
    });
    const success = await invokeEnterpriseDataAction({
      store,
      context: trustedContext({
        seatId: "seat-sales-director",
        employeeId: "emp-dir-001",
        teamLabel: "华东销售",
      }),
      ref,
      approvalContextId,
      nowIso: "2026-06-05T12:01:00.000Z",
    });
    expect(success.ok).toBe(true);
    const retry = await invokeEnterpriseDataAction({
      store,
      context: trustedContext({
        seatId: "seat-sales-director",
        employeeId: "emp-dir-001",
        teamLabel: "华东销售",
      }),
      ref,
      approvalContextId,
      nowIso: "2026-06-05T12:02:00.000Z",
    });
    expect(retry.ok).toBe(false);
    if (retry.ok) {
      return;
    }
    expect(retry.code).toBe("APPROVAL_REQUIRED");
  });

  it("fail-closes HIGH risk actions when audit write fails", async () => {
    const store = normalizeEnterpriseDataStore(null);
    seedEnterpriseDataCatalog({ store, tenantId, nowIso });
    const result = await invokeEnterpriseDataAction({
      store,
      context: trustedContext({
        seatId: "seat-sales-director",
        employeeId: "emp-dir-001",
        teamLabel: "华东销售",
      }),
      ref: {
        connectorId: "crm-salesforce",
        actionKey: "crm.customer.export",
        version: "v1",
      },
      approvalContextId: "bypass-not-used",
      nowIso,
      auditOptions: { forceFailure: true },
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.code).toBe("APPROVAL_REQUIRED");
  });

  it("blocks HIGH risk success path when audit write fails after approval", async () => {
    const store = normalizeEnterpriseDataStore(null);
    seedEnterpriseDataCatalog({ store, tenantId, nowIso });
    const ref = {
      connectorId: "crm-salesforce",
      actionKey: "crm.customer.export",
      version: "v1",
    };
    const grant = findSeatActionGrant(store, tenantId, "seat-sales-director", ref)!;
    const approvalContextId = "ctx-test-export";
    const request = createApprovalRequest({
      store,
      tenantId,
      seatId: "seat-sales-director",
      employeeId: "emp-dir-001",
      ref,
      approvalPolicyId: grant.approvalPolicyId!,
      approvalContextId,
      nowIso,
    });
    decideApprovalRequest({
      store,
      tenantId,
      approvalId: request.approvalId,
      decision: "approved",
      decidedBy: "emp-admin-001",
      contextSnapshot: buildApprovalContextSnapshot({ store, tenantId, grant, ref }),
      nowIso,
    });
    const result = await invokeEnterpriseDataAction({
      store,
      context: trustedContext({
        seatId: "seat-sales-director",
        employeeId: "emp-dir-001",
        teamLabel: "华东销售",
      }),
      ref,
      approvalContextId,
      nowIso,
      auditOptions: { forceFailure: true },
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.code).toBe("AUDIT_WRITE_FAILED");
    const trace = getAuditTrace({ store, tenantId, traceId: result.traceId });
    expect(trace.invocation?.status).toBe("FAILED");
    expect(trace.invocation?.denialReason).toBe("AUDIT_WRITE_FAILED");
    expect(
      Object.values(store.invocationAuditEvents).some(
        (event) => event.traceId === result.traceId && event.status === "SUCCESS",
      ),
    ).toBe(false);
  });

  it("narrows SELF scope when employeeId does not own the returned customer", async () => {
    const store = normalizeEnterpriseDataStore(null);
    seedEnterpriseDataCatalog({ store, tenantId, nowIso });
    const result = await invokeEnterpriseDataAction({
      store,
      context: trustedContext({
        seatId: "seat-sales-mgr-east",
        employeeId: "emp-attacker-999",
      }),
      ref: {
        connectorId: "crm-salesforce",
        actionKey: "crm.customer.read_summary",
        version: "v1",
      },
      nowIso,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect((result.data as { customer: unknown }).customer).toBeNull();
  });

  it("applies TEAM scope from server-side teamLabel rather than widening to other teams", async () => {
    const store = normalizeEnterpriseDataStore(null);
    seedEnterpriseDataCatalog({ store, tenantId, nowIso });
    const east = await invokeEnterpriseDataAction({
      store,
      context: trustedContext({
        seatId: "seat-sales-director",
        employeeId: "emp-dir-001",
        teamLabel: "华东销售",
      }),
      ref: {
        connectorId: "crm-salesforce",
        actionKey: "crm.customer.read_summary",
        version: "v1",
      },
      nowIso,
    });
    const north = await invokeEnterpriseDataAction({
      store,
      context: trustedContext({
        seatId: "seat-sales-director",
        employeeId: "emp-dir-001",
        teamLabel: "华北销售",
      }),
      ref: {
        connectorId: "crm-salesforce",
        actionKey: "crm.customer.read_summary",
        version: "v1",
      },
      nowIso: "2026-06-05T12:03:00.000Z",
    });
    expect(east.ok).toBe(true);
    expect(north.ok).toBe(true);
    if (!east.ok || !north.ok) {
      return;
    }
    expect((east.data as { customer: { id: string } | null }).customer?.id).toBe("cust-001");
    expect((north.data as { customer: { id: string } | null }).customer?.id).toBe("cust-003");
  });
});
