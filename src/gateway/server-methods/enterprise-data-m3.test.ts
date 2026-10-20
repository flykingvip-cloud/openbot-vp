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

const testPaths = vi.hoisted(() => ({
  tmpDir: `/tmp/openbot-enterprise-data-m3-handler-test-${Date.now()}`,
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

const { createEnterpriseDataM3Handlers } = await import("./enterprise-data-m3.js");
const { enterpriseDataHandlers } = await import("./enterprise-data.js");

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

const m3Handlers = createEnterpriseDataM3Handlers(withEnterpriseDataStore);

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
    client: { connect: {} as never, user: "admin@acme.test" },
    isWebchatConnect: () => false,
    respond: (ok, payload, error) => {
      response = {
        ok,
        payload: payload as Record<string, unknown> | undefined,
        error: error as { message?: string } | undefined,
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
  return invokeFrom(m3Handlers, method, params, options);
}

describe("enterprise-data M3 gateway handlers", () => {
  beforeEach(async () => {
    cleanStore();
    resolveBillingScopeMock.mockReset();
    await seedCatalog();
  });

  it("rejects member on capabilities.governance-view", async () => {
    const capabilityId = await getCustomerProfileCapabilityId();
    const response = await invoke(
      "enterprise-data.capabilities.governance-view",
      { tenantId, capabilityId },
      { admin: false },
    );
    expect(response.ok).toBe(false);
    expect(response.responseCount).toBe(1);
    expect(response.error?.message).toBe(GOVERNANCE_ADMIN_REQUIRED_MESSAGE);
  });

  it("does not replace admin rejection on capabilities.grant-seat", async () => {
    const capabilityId = await getCustomerProfileCapabilityId();
    const response = await invokeFrom(
      enterpriseDataHandlers,
      "enterprise-data.capabilities.grant-seat",
      { tenantId, seatId: "seat-sales-mgr-east", capabilityId },
      { admin: false },
    );
    expect(response.responseCount).toBe(1);
    expect(response.error?.message).toBe(GOVERNANCE_ADMIN_REQUIRED_MESSAGE);
  });

  it("requires seatId and capabilityId for grant-seat only after the admin gate passes", async () => {
    const response = await invokeFrom(
      enterpriseDataHandlers,
      "enterprise-data.capabilities.grant-seat",
      { tenantId },
    );
    expect(response.responseCount).toBe(1);
    expect(response.error?.message).toContain("seatId and capabilityId are required");
  });

  it("returns governance view for admin", async () => {
    const capabilityId = await getCustomerProfileCapabilityId();
    const response = await invoke("enterprise-data.capabilities.governance-view", {
      tenantId,
      capabilityId,
    });
    expect(response.ok).toBe(true);
    const view = response.payload?.view as {
      actionMappings: unknown[];
      accessScope: { activeGrants: unknown[] };
    };
    expect(view.actionMappings.length).toBeGreaterThan(0);
    expect(view.accessScope.activeGrants.length).toBeGreaterThan(0);
  });

  it("rejects forged tenantId on capabilities.overview", async () => {
    const response = await invoke("enterprise-data.capabilities.overview", {
      tenantId: "tenant-evil",
    });
    expect(response.ok).toBe(false);
    expect(response.error?.message).toContain("tenantId must match authenticated enterprise scope");
  });

  it("returns source and action mappers for admin", async () => {
    const capabilityId = await getCustomerProfileCapabilityId();
    const sources = await invoke("enterprise-data.capabilities.map-sources", {
      tenantId,
      capabilityId,
    });
    const actions = await invoke("enterprise-data.capabilities.map-actions", {
      tenantId,
      capabilityId,
    });
    expect(sources.ok).toBe(true);
    expect(actions.ok).toBe(true);
    expect((sources.payload?.sourceMappings as unknown[])?.length).toBeGreaterThan(0);
    expect((actions.payload?.actionMappings as unknown[])?.length).toBeGreaterThan(0);
  });

  it("resolves capabilities by action ref", async () => {
    const response = await invoke("enterprise-data.capabilities.resolve-by-action", {
      tenantId,
      connectorId: "crm-salesforce",
      actionKey: "crm.customer.read_summary",
      version: "v1",
    });
    expect(response.ok).toBe(true);
    const capabilities = response.payload?.capabilities as Array<{ capabilityKey: string }>;
    expect(capabilities.some((item) => item.capabilityKey === "customer.profile")).toBe(true);
  });

  it("rejects capabilities.upsert with misaligned source and action", async () => {
    const crmSourceId = await getCrmSourceId();
    const response = await invoke("enterprise-data.capabilities.upsert", {
      tenantId,
      capabilityKey: "bad.mapping",
      displayName: "Bad Mapping",
      sourceIds: [crmSourceId],
      actionRefs: [
        {
          connectorId: "erp-sap",
          actionKey: "erp.order.read_status",
          version: "v1",
        },
      ],
    });
    expect(response.ok).toBe(false);
    expect(response.error?.message).toContain("align with a linked DataSource");
  });

  it("archives capability for admin", async () => {
    const capabilityId = await getCustomerProfileCapabilityId();
    const response = await invoke("enterprise-data.capabilities.archive", {
      tenantId,
      capabilityId,
    });
    expect(response.ok).toBe(true);
    const capability = response.payload?.capability as { enabled?: boolean };
    expect(capability.enabled).toBe(false);
  });
});

async function getCustomerProfileCapabilityId(): Promise<string> {
  const store = await loadEnterpriseDataStore();
  const capability = Object.values(store.dataCapabilities).find(
    (item) => item.tenantId === tenantId && item.capabilityKey === "customer.profile",
  );
  if (!capability) {
    throw new Error("seeded customer.profile capability not found");
  }
  return capability.capabilityId;
}

async function getCrmSourceId(): Promise<string> {
  const store = await loadEnterpriseDataStore();
  const source = Object.values(store.dataSources).find(
    (item) => item.tenantId === tenantId && item.sourceKey === "crm-salesforce",
  );
  if (!source) {
    throw new Error("seeded CRM source not found");
  }
  return source.sourceId;
}
