// @vitest-environment node
import fs from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GOVERNANCE_ADMIN_REQUIRED_MESSAGE } from "../enterprise-data/enterprise-data-seat-context.js";
import {
  ensureEnterpriseDataCatalogSeeded,
  seedEnterpriseDataCatalog,
} from "../enterprise-data/seeds.js";
import {
  loadEnterpriseDataStore,
  normalizeEnterpriseDataStore,
  saveEnterpriseDataStore,
} from "../enterprise-data/store.js";
import type { GatewayRequestHandler, GatewayRequestHandlerOptions } from "./types.js";

const { createEnterpriseDataM2Handlers } = await import("./enterprise-data-m2.js");
const { enterpriseDataHandlers } = await import("./enterprise-data.js");

const testPaths = vi.hoisted(() => ({
  tmpDir: `/tmp/openbot-enterprise-data-m2-handler-test-${Date.now()}`,
}));

vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return {
    ...actual,
    CONFIG_DIR: testPaths.tmpDir,
  };
});

const resolveBillingScopeMock = vi.hoisted(() => vi.fn());

vi.mock("../billing/scope.js", () => ({
  resolveBillingScope: resolveBillingScopeMock,
}));

vi.mock("../protocol/index.js", () => ({
  ErrorCodes: { INVALID_REQUEST: "INVALID_REQUEST" },
  errorShape: (code: string, message: string, extra?: { code?: string }) => ({
    code,
    message,
    ...extra,
  }),
}));

const tenantId = "tenant-acme";
const nowIso = "2026-06-05T12:00:00.000Z";
const adminScope = {
  enterpriseId: tenantId,
  user: { id: "emp-admin-001" },
  membership: null,
  isEnterpriseAdmin: true,
  permissions: new Set(["operator"]),
};
const memberScope = {
  enterpriseId: tenantId,
  user: { id: "emp-member-001" },
  membership: null,
  isEnterpriseAdmin: false,
  permissions: new Set(["operator"]),
};

type InvokeResult = {
  ok: boolean;
  payload?: Record<string, unknown>;
  error?: { message?: string; code?: string };
  responseCount: number;
};

async function withEnterpriseDataStore<T>(
  runTenantId: string,
  _client: unknown,
  run: (store: Awaited<ReturnType<typeof loadEnterpriseDataStore>>) => Promise<T> | T,
): Promise<T> {
  const store = await loadEnterpriseDataStore();
  ensureEnterpriseDataCatalogSeeded({
    store,
    tenantId: runTenantId,
    nowIso: new Date().toISOString(),
  });
  const result = await run(store);
  await saveEnterpriseDataStore(store);
  return result;
}

const m2Handlers = createEnterpriseDataM2Handlers(withEnterpriseDataStore);

function cleanStore() {
  fs.rmSync(testPaths.tmpDir, { recursive: true, force: true });
  fs.mkdirSync(testPaths.tmpDir, { recursive: true });
}

async function seedCatalog() {
  const store = normalizeEnterpriseDataStore(null);
  seedEnterpriseDataCatalog({ store, tenantId, nowIso });
  await saveEnterpriseDataStore(store);
}

async function invokeFrom(
  handlers: Record<string, GatewayRequestHandler>,
  method: string,
  params: Record<string, unknown> = {},
  options: { admin?: boolean } = {},
): Promise<InvokeResult> {
  const handler = handlers[method];
  if (!handler) {
    throw new Error(`missing handler ${method}`);
  }
  resolveBillingScopeMock.mockImplementation(async () =>
    options.admin === false ? memberScope : adminScope,
  );
  let response: InvokeResult | null = null;
  await handler({
    req: { type: "req", id: "test", method, params },
    params,
    client: {
      connect: {} as never,
      user: "admin@acme.test",
    },
    isWebchatConnect: () => false,
    respond: (ok, payload, error) => {
      response = {
        ok,
        payload: payload as Record<string, unknown> | undefined,
        error: error as { message?: string; code?: string } | undefined,
        responseCount: (response?.responseCount ?? 0) + 1,
      };
    },
    context: {} as GatewayRequestHandlerOptions["context"],
  });
  if (!response) {
    throw new Error(`handler ${method} did not respond`);
  }
  return response;
}

async function invoke(
  method: string,
  params: Record<string, unknown> = {},
  options: { admin?: boolean } = {},
): Promise<InvokeResult> {
  return invokeFrom(m2Handlers, method, params, options);
}

describe("enterprise-data M2 gateway handlers", () => {
  beforeEach(async () => {
    cleanStore();
    resolveBillingScopeMock.mockReset();
    await seedCatalog();
  });

  it("rejects member on sources.governance-view", async () => {
    const crmSourceId = await getCrmSourceId();
    const response = await invoke(
      "enterprise-data.sources.governance-view",
      { tenantId, sourceId: crmSourceId },
      { admin: false },
    );
    expect(response.ok).toBe(false);
    expect(response.error?.message).toBe(GOVERNANCE_ADMIN_REQUIRED_MESSAGE);
  });

  it("allows admin on sources.governance-view with seeded catalog", async () => {
    const crmSourceId = await getCrmSourceId();
    const response = await invoke("enterprise-data.sources.governance-view", {
      tenantId,
      sourceId: crmSourceId,
    });
    expect(response.ok).toBe(true);
    const view = response.payload?.view as Record<string, unknown>;
    expect(view?.source).toBeTruthy();
    expect((view?.capabilities as unknown[])?.length).toBeGreaterThan(0);
  });

  it("rejects forged tenantId on access-governance.overview", async () => {
    const response = await invoke("enterprise-data.access-governance.overview", {
      tenantId: "tenant-evil",
    });
    expect(response.ok).toBe(false);
    expect(response.error?.message).toContain("tenantId must match authenticated enterprise scope");
  });

  it("rejects member on access-governance.overview", async () => {
    const response = await invoke(
      "enterprise-data.access-governance.overview",
      { tenantId },
      { admin: false },
    );
    expect(response.ok).toBe(false);
    expect(response.error?.message).toBe(GOVERNANCE_ADMIN_REQUIRED_MESSAGE);
  });

  it("returns overview metrics for admin", async () => {
    const response = await invoke("enterprise-data.access-governance.overview", { tenantId });
    expect(response.ok).toBe(true);
    const overview = response.payload?.overview as Record<string, number>;
    expect(overview.dataSourceCount).toBeGreaterThan(0);
    expect(overview.accessPolicyCount).toBeGreaterThan(0);
  });

  it("rejects invalid matrix dimension", async () => {
    const response = await invoke("enterprise-data.access-governance.matrix", {
      tenantId,
      dimension: "invalid",
    });
    expect(response.ok).toBe(false);
    expect(response.error?.message).toContain(
      "dimension must be source, seat, department, or role",
    );
  });

  it("resolves seat matrix for admin", async () => {
    const response = await invoke("enterprise-data.access-governance.matrix", {
      tenantId,
      dimension: "seat",
      targetId: "seat-sales-mgr-east",
    });
    expect(response.ok).toBe(true);
    const entries = response.payload?.entries as Array<{
      policies: Array<{ runtimeActionRefs: unknown[] }>;
    }>;
    expect(entries[0]?.policies[0]?.runtimeActionRefs.length).toBeGreaterThan(0);
  });

  it("requires sourceId for sources.archive", async () => {
    const response = await invoke("enterprise-data.sources.archive", { tenantId });
    expect(response.ok).toBe(false);
    expect(response.error?.message).toContain("sourceId is required");
  });

  it("archives DataSource for admin", async () => {
    const crmSourceId = await getCrmSourceId();
    const response = await invoke("enterprise-data.sources.archive", {
      tenantId,
      sourceId: crmSourceId,
    });
    expect(response.ok).toBe(true);
    const source = response.payload?.source as { status?: string };
    expect(source.status).toBe("disconnected");
  });

  it("returns access policy detail for admin", async () => {
    const policyId = await getSeatPolicyId();
    const response = await invoke("enterprise-data.access-policies.get", {
      tenantId,
      policyId,
    });
    expect(response.ok).toBe(true);
    const detail = response.payload?.detail as {
      runtimeActionRefs: unknown[];
      compilationSupported: boolean;
    };
    expect(detail.runtimeActionRefs.length).toBeGreaterThan(0);
    expect(detail.compilationSupported).toBe(true);
  });

  it("archives access policy for admin", async () => {
    const policyId = await getSeatPolicyId();
    const response = await invoke("enterprise-data.access-policies.archive", {
      tenantId,
      policyId,
    });
    expect(response.ok).toBe(true);
    const policy = response.payload?.policy as { enabled?: boolean; compiledGrantIds?: string[] };
    expect(policy.enabled).toBe(false);
    expect(policy.compiledGrantIds).toEqual([]);
  });

  it("rejects member on access-policies.get", async () => {
    const policyId = await getSeatPolicyId();
    const response = await invoke(
      "enterprise-data.access-policies.get",
      { tenantId, policyId },
      { admin: false },
    );
    expect(response.ok).toBe(false);
    expect(response.error?.message).toBe(GOVERNANCE_ADMIN_REQUIRED_MESSAGE);
  });

  it("rejects sources.upsert without required fields", async () => {
    const response = await invoke("enterprise-data.sources.upsert", {
      tenantId,
      sourceKey: "new-source",
    });
    expect(response.ok).toBe(false);
    expect(response.error?.message).toContain(
      "sourceKey, displayName, connectorId, and category are required",
    );
  });

  it("upserts DataSource for admin when connector actions exist", async () => {
    const response = await invoke("enterprise-data.sources.upsert", {
      tenantId,
      sourceKey: "crm-salesforce-secondary",
      displayName: "Salesforce Secondary",
      connectorId: "crm-salesforce",
      category: "crm",
      status: "connected",
    });
    expect(response.ok).toBe(true);
    const source = response.payload?.source as { sourceKey?: string };
    expect(source.sourceKey).toBe("crm-salesforce-secondary");
  });

  it("resolves access-governance target for admin", async () => {
    const response = await invoke("enterprise-data.access-governance.resolve-target", {
      tenantId,
      targetKind: "seat",
      targetId: "seat-sales-mgr-east",
    });
    expect(response.ok).toBe(true);
    const resolved = response.payload?.resolved as {
      runtimeActionRefs: unknown[];
      compiledGrants: unknown[];
    };
    expect(resolved.runtimeActionRefs.length).toBeGreaterThan(0);
    expect(resolved.compiledGrants.length).toBeGreaterThan(0);
  });

  it("does not replace admin rejection with a parameter error on sources.get", async () => {
    const crmSourceId = await getCrmSourceId();
    const response = await invokeFrom(
      enterpriseDataHandlers,
      "enterprise-data.sources.get",
      { tenantId, sourceId: crmSourceId },
      { admin: false },
    );
    expect(response.responseCount).toBe(1);
    expect(response.error?.message).toBe(GOVERNANCE_ADMIN_REQUIRED_MESSAGE);
  });

  it("requires sourceId for sources.get only after the admin gate passes", async () => {
    const response = await invokeFrom(enterpriseDataHandlers, "enterprise-data.sources.get", {
      tenantId,
    });
    expect(response.responseCount).toBe(1);
    expect(response.error?.message).toContain("sourceId is required");
  });

  it("does not replace admin rejection on access-policies.compile", async () => {
    const policyId = await getSeatPolicyId();
    const response = await invokeFrom(
      enterpriseDataHandlers,
      "enterprise-data.access-policies.compile",
      { tenantId, policyId },
      { admin: false },
    );
    expect(response.responseCount).toBe(1);
    expect(response.error?.message).toBe(GOVERNANCE_ADMIN_REQUIRED_MESSAGE);
  });

  it("requires policyId for compile only after the admin gate passes", async () => {
    const response = await invokeFrom(
      enterpriseDataHandlers,
      "enterprise-data.access-policies.compile",
      { tenantId },
    );
    expect(response.responseCount).toBe(1);
    expect(response.error?.message).toContain("policyId is required");
  });

  it("does not replace admin rejection on access-policies.upsert", async () => {
    const response = await invokeFrom(
      enterpriseDataHandlers,
      "enterprise-data.access-policies.upsert",
      {
        tenantId,
        displayName: "Member attempt",
        targetKind: "seat",
        targetId: "seat-sales-mgr-east",
        actionRefs: [
          {
            connectorId: "crm-salesforce",
            actionKey: "crm.customer.read_summary",
            version: "v1",
          },
        ],
      },
      { admin: false },
    );
    expect(response.responseCount).toBe(1);
    expect(response.error?.message).toBe(GOVERNANCE_ADMIN_REQUIRED_MESSAGE);
  });

  it("does not replace admin rejection on access-policies.resolve-actions", async () => {
    const policyId = await getSeatPolicyId();
    const response = await invokeFrom(
      enterpriseDataHandlers,
      "enterprise-data.access-policies.resolve-actions",
      { tenantId, policyId },
      { admin: false },
    );
    expect(response.responseCount).toBe(1);
    expect(response.error?.message).toBe(GOVERNANCE_ADMIN_REQUIRED_MESSAGE);
  });
});

async function getCrmSourceId(): Promise<string> {
  const store = await loadEnterpriseDataStore();
  const crm = Object.values(store.dataSources).find(
    (source) => source.tenantId === tenantId && source.sourceKey === "crm-salesforce",
  );
  if (!crm) {
    throw new Error("seeded CRM source not found");
  }
  return crm.sourceId;
}

async function getSeatPolicyId(): Promise<string> {
  const store = await loadEnterpriseDataStore();
  const policy = Object.values(store.dataAccessPolicies).find(
    (item) => item.tenantId === tenantId && item.targetId === "seat-sales-mgr-east",
  );
  if (!policy) {
    throw new Error("seeded seat policy not found");
  }
  return policy.policyId;
}
