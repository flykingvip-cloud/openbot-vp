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

const { createEnterpriseDataM4Handlers } = await import("./enterprise-data-m4.js");
const { enterpriseDataHandlers } = await import("./enterprise-data.js");

const testPaths = vi.hoisted(() => ({
  tmpDir: `/tmp/openbot-enterprise-data-m4-handler-test-${Date.now()}`,
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

const m4Handlers = createEnterpriseDataM4Handlers(withEnterpriseDataStore);

function cleanStore() {
  fs.rmSync(testPaths.tmpDir, { recursive: true, force: true });
  fs.mkdirSync(testPaths.tmpDir, { recursive: true });
}

async function seedCatalog() {
  const store = normalizeEnterpriseDataStore(null);
  seedEnterpriseDataCatalog({ store, tenantId, nowIso });
  await saveEnterpriseDataStore(store);
}

async function invoke(
  method: string,
  params: Record<string, unknown> = {},
  options: { admin?: boolean } = {},
): Promise<InvokeResult> {
  const handler = (m4Handlers[method] ?? enterpriseDataHandlers[method]) as
    | GatewayRequestHandler
    | undefined;
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

describe("enterprise-data M4 gateway handlers", () => {
  beforeEach(async () => {
    cleanStore();
    resolveBillingScopeMock.mockReset();
    await seedCatalog();
  });

  it("rejects member on projection-materializer.run", async () => {
    const bindingId = await getProfileBindingId();
    const response = await invoke(
      "enterprise-data.projection-materializer.run",
      { tenantId, bindingId },
      { admin: false },
    );
    expect(response.ok).toBe(false);
    expect(response.responseCount).toBe(1);
    expect(response.error?.message).toBe(GOVERNANCE_ADMIN_REQUIRED_MESSAGE);
  });

  it("does not replace admin rejection on projection spec and binding reads", async () => {
    const projectionId = await getProfileProjectionId();
    const bindingId = await getProfileBindingId();
    const spec = await invoke(
      "enterprise-data.projection-specs.get",
      { tenantId, projectionId },
      { admin: false },
    );
    const binding = await invoke(
      "enterprise-data.projection-bindings.get",
      { tenantId, bindingId },
      { admin: false },
    );
    expect(spec.responseCount).toBe(1);
    expect(binding.responseCount).toBe(1);
    expect(spec.error?.message).toBe(GOVERNANCE_ADMIN_REQUIRED_MESSAGE);
    expect(binding.error?.message).toBe(GOVERNANCE_ADMIN_REQUIRED_MESSAGE);
  });

  it("returns explicit sourceActions from projection spec get", async () => {
    const projectionId = await getProfileProjectionId();
    const response = await invoke("enterprise-data.projection-specs.get", {
      tenantId,
      projectionId,
    });
    expect(response.ok).toBe(true);
    const spec = response.payload?.spec as {
      sourceActions?: Array<{ connectorId: string; actionKey: string; version: string }>;
    };
    expect(spec.sourceActions).toEqual([
      {
        connectorId: "crm-salesforce",
        actionKey: "crm.customer.read_summary",
        version: "v1",
      },
    ]);
  });

  it("requires projectionId and bindingId only after the admin gate passes", async () => {
    const spec = await invoke("enterprise-data.projection-specs.get", { tenantId });
    const binding = await invoke("enterprise-data.projection-bindings.get", { tenantId });
    expect(spec.responseCount).toBe(1);
    expect(binding.responseCount).toBe(1);
    expect(spec.error?.message).toContain("projectionId is required");
    expect(binding.error?.message).toContain("bindingId is required");
  });

  it("materializes feed item for admin", async () => {
    const bindingId = await getProfileBindingId();
    const response = await invoke("enterprise-data.projection-materializer.run", {
      tenantId,
      bindingId,
    });
    expect(response.ok).toBe(true);
    const result = response.payload?.result as { feedItem?: { title?: string } };
    expect(result.feedItem?.title).toContain("画像");
  });

  it("rejects forged materializerSeatId and teamLabel on materializer.run", async () => {
    const bindingId = await getProfileBindingId();
    const seatOverride = await invoke("enterprise-data.projection-materializer.run", {
      tenantId,
      bindingId,
      materializerSeatId: "seat-sales-director",
    });
    expect(seatOverride.ok).toBe(false);
    expect(seatOverride.error?.message).toContain("materializerSeatId");

    const teamOverride = await invoke("enterprise-data.projection-materializer.run", {
      tenantId,
      bindingId,
      teamLabel: "华北销售",
    });
    expect(teamOverride.ok).toBe(false);
    expect(teamOverride.error?.message).toContain("teamLabel");
  });

  it("returns knowledge supply overview", async () => {
    const bindingId = await getProfileBindingId();
    await invoke("enterprise-data.projection-materializer.run", {
      tenantId,
      bindingId,
    });
    const response = await invoke("enterprise-data.knowledge-supply.overview", { tenantId });
    expect(response.ok).toBe(true);
    const overview = response.payload?.overview as { feedItemCount?: number };
    expect(overview.feedItemCount).toBe(1);
  });

  it("filters feed items by visibility context", async () => {
    const bindingId = await getProfileBindingId();
    await invoke("enterprise-data.projection-materializer.run", {
      tenantId,
      bindingId,
    });
    const visible = await invoke("enterprise-data.feed-items.list", {
      tenantId,
      seatId: "seat-sales-director",
    });
    const hidden = await invoke("enterprise-data.feed-items.list", {
      tenantId,
      seatId: "seat-unknown",
      teamLabel: "华北销售",
    });
    expect(visible.ok).toBe(true);
    expect((visible.payload?.items as unknown[])?.length).toBe(1);
    expect(hidden.ok).toBe(true);
    expect((hidden.payload?.items as unknown[])?.length).toBe(0);
  });

  it("rejects forged tenantId on knowledge-supply.overview", async () => {
    const response = await invoke("enterprise-data.knowledge-supply.overview", {
      tenantId: "tenant-evil",
    });
    expect(response.ok).toBe(false);
    expect(response.error?.message).toContain("tenantId must match authenticated enterprise scope");
  });

  it("filters feed items by agentType and rejects agentId preview param", async () => {
    const bindingId = await getProfileBindingId();
    await invoke("enterprise-data.projection-materializer.run", { tenantId, bindingId });
    const byType = await invoke("enterprise-data.feed-items.list", {
      tenantId,
      agentType: "employee-agent",
    });
    const byWrongId = await invoke("enterprise-data.feed-items.list", {
      tenantId,
      agentId: "employee-agent",
    });
    expect(byType.ok).toBe(true);
    expect((byType.payload?.items as unknown[])?.length).toBe(1);
    expect(byWrongId.ok).toBe(false);
    expect(byWrongId.error?.message).toContain("agentType");
  });

  it("rejects multi-source projection upsert", async () => {
    const response = await invoke("enterprise-data.projection-specs.upsert", {
      tenantId,
      projectionKey: "multi.source.bad",
      displayName: "Bad Multi Source",
      category: "customer",
      sourceActions: [
        {
          connectorId: "crm-salesforce",
          actionKey: "crm.customer.read_summary",
          version: "v1",
        },
        {
          connectorId: "crm-salesforce",
          actionKey: "crm.customer.read_summary",
          version: "v2",
        },
      ],
      objectKind: "data",
      templateKey: "NormalizeTemplate",
      lifecycle: "active",
    });
    expect(response.ok).toBe(false);
    expect(response.error?.message).toContain("exactly one sourceAction");
  });

  it("rejects projection upsert without explicit sourceActions", async () => {
    const response = await invoke("enterprise-data.projection-specs.upsert", {
      tenantId,
      projectionKey: "implicit.source.bad",
      displayName: "Implicit Source",
      category: "customer",
      capabilityId: await getProfileCapabilityId(),
      objectKind: "data",
      templateKey: "NormalizeTemplate",
      lifecycle: "active",
    });
    expect(response.responseCount).toBe(1);
    expect(response.ok).toBe(false);
    expect(response.error?.message).toContain("sourceActions");
  });

  it("rejects projection templates outside the five declarative keys", async () => {
    const response = await invoke("enterprise-data.projection-specs.upsert", {
      tenantId,
      projectionKey: "sql.template.bad",
      displayName: "SQL Template",
      category: "customer",
      sourceActions: [
        {
          connectorId: "crm-salesforce",
          actionKey: "crm.customer.read_summary",
          version: "v1",
        },
      ],
      objectKind: "data",
      templateKey: "SqlTemplate",
      lifecycle: "draft",
    });
    expect(response.responseCount).toBe(1);
    expect(response.ok).toBe(false);
    expect(response.error?.message).toBe("templateKey is invalid");
  });

  it("rejects sourceActions that are not on the linked capability", async () => {
    const response = await invoke("enterprise-data.projection-specs.upsert", {
      tenantId,
      projectionKey: "capability.mismatch",
      displayName: "Capability Mismatch",
      category: "customer",
      capabilityId: await getProfileCapabilityId(),
      sourceActions: [
        {
          connectorId: "erp-sap",
          actionKey: "erp.order.read_status",
          version: "v1",
        },
      ],
      objectKind: "data",
      templateKey: "NormalizeTemplate",
      lifecycle: "draft",
    });
    expect(response.ok).toBe(false);
    expect(response.error?.message).toContain("align with linked DataCapability");
  });

  it("upserts visibility policy for admin", async () => {
    const projectionId = await getProfileProjectionId();
    const response = await invoke("enterprise-data.visibility-policies.upsert", {
      tenantId,
      projectionId,
      visibleSeats: ["seat-sales-director"],
      visibleTeams: [],
      visibleAgentTypes: [],
    });
    expect(response.ok).toBe(true);
    const policy = response.payload?.policy as { visibleSeats?: string[] };
    expect(policy.visibleSeats).toContain("seat-sales-director");
  });
});

async function getProfileBindingId(): Promise<string> {
  const store = await loadEnterpriseDataStore();
  const binding = Object.values(store.enterpriseKnowledgeProjectionBindings).find((item) => {
    const spec = store.enterpriseKnowledgeProjectionSpecs[item.projectionId];
    return item.tenantId === tenantId && spec?.projectionKey === "customer.profile";
  });
  if (!binding) {
    throw new Error("profile binding not found");
  }
  return binding.bindingId;
}

async function getProfileCapabilityId(): Promise<string> {
  const store = await loadEnterpriseDataStore();
  const capability = Object.values(store.dataCapabilities).find(
    (item) => item.tenantId === tenantId && item.capabilityKey === "customer.profile",
  );
  if (!capability) {
    throw new Error("profile capability not found");
  }
  return capability.capabilityId;
}

async function getProfileProjectionId(): Promise<string> {
  const store = await loadEnterpriseDataStore();
  const spec = Object.values(store.enterpriseKnowledgeProjectionSpecs).find(
    (item) => item.tenantId === tenantId && item.projectionKey === "customer.profile",
  );
  if (!spec) {
    throw new Error("profile projection not found");
  }
  return spec.projectionId;
}
