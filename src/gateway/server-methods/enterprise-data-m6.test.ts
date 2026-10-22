// @vitest-environment node
import fs from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

const { createEnterpriseDataM6Handlers } = await import("./enterprise-data-m6.js");

function isRequestInit(value: unknown): value is RequestInit {
  return Boolean(value) && typeof value === "object";
}

function recordedFetch(mock: { mock: { calls: readonly unknown[] } }): [string, RequestInit] {
  const call: unknown = mock.mock.calls[0];
  if (!Array.isArray(call) || typeof call[0] !== "string" || !isRequestInit(call[1])) {
    throw new Error("expected fetch(url, init)");
  }
  return [call[0], call[1]];
}

const testPaths = vi.hoisted(() => ({
  tmpDir: `/tmp/openbot-enterprise-data-m6-handler-test-${Date.now()}`,
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

const m6Handlers = createEnterpriseDataM6Handlers(withEnterpriseDataStore);

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
  const handler = m6Handlers[method] as GatewayRequestHandler | undefined;
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
      };
    },
    context: {} as GatewayRequestHandlerOptions["context"],
  });
  if (!response) {
    throw new Error(`handler ${method} did not respond`);
  }
  return response;
}

describe("enterprise-data M6 dashboard handlers", () => {
  beforeEach(async () => {
    cleanStore();
    resolveBillingScopeMock.mockReset();
    await seedCatalog();
  });

  it("returns dashboard summary counts for admin", async () => {
    const response = await invoke("enterprise-data.dashboard.summary", { tenantId });
    expect(response.ok).toBe(true);
    const summary = response.payload?.summary as Record<string, number>;
    expect(summary.totalDataSources).toBeGreaterThan(0);
    expect(summary.totalCapabilities).toBeGreaterThan(0);
    expect(typeof summary.totalDepartments).toBe("number");
    expect(typeof summary.knowledgeObjectCount).toBe("number");
    expect(typeof summary.enabledBindingCount).toBe("number");
    expect(typeof summary.pendingApprovals).toBe("number");
  });

  it("rejects forged tenantId on dashboard.summary", async () => {
    const response = await invoke("enterprise-data.dashboard.summary", {
      tenantId: "tenant-evil",
    });
    expect(response.ok).toBe(false);
  });

  it("rejects non-admin member on dashboard.summary", async () => {
    const response = await invoke(
      "enterprise-data.dashboard.summary",
      { tenantId },
      { admin: false },
    );
    expect(response.ok).toBe(false);
  });

  it("returns capability usage rows for admin", async () => {
    const response = await invoke("enterprise-data.dashboard.capability-rows", { tenantId });
    expect(response.ok).toBe(true);
    const rows = response.payload?.rows as Array<Record<string, unknown>>;
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
    const first = rows[0];
    expect(typeof first.capabilityId).toBe("string");
    expect(typeof first.displayName).toBe("string");
    expect(Array.isArray(first.sourceNames)).toBe(true);
    expect(Array.isArray(first.targetLabels)).toBe(true);
    expect(typeof first.knowledgeObjectCount).toBe("number");
    expect(typeof first.enabled).toBe("boolean");
  });

  it("respects the limit param on capability-rows", async () => {
    const response = await invoke("enterprise-data.dashboard.capability-rows", {
      tenantId,
      limit: "1",
    });
    expect(response.ok).toBe(true);
    const rows = response.payload?.rows as unknown[];
    expect(rows.length).toBeLessThanOrEqual(1);
  });

  it("rejects forged tenantId on capability-rows", async () => {
    const response = await invoke("enterprise-data.dashboard.capability-rows", {
      tenantId: "tenant-evil",
    });
    expect(response.ok).toBe(false);
  });

  it("returns authorization cards for admin", async () => {
    const response = await invoke("enterprise-data.dashboard.authorization-cards", { tenantId });
    expect(response.ok).toBe(true);
    const cards = response.payload?.cards as Array<Record<string, unknown>>;
    expect(Array.isArray(cards)).toBe(true);
    expect(cards.length).toBeGreaterThan(0);
    const first = cards[0];
    expect(typeof first.sourceId).toBe("string");
    expect(typeof first.displayName).toBe("string");
    expect(Array.isArray(first.targets)).toBe(true);
    expect(
      (first.targets as Array<Record<string, unknown>>).some(
        (target) => target.kind === "department",
      ),
    ).toBe(true);
  });

  it("rejects forged tenantId on authorization-cards", async () => {
    const response = await invoke("enterprise-data.dashboard.authorization-cards", {
      tenantId: "tenant-evil",
    });
    expect(response.ok).toBe(false);
  });

  it("returns the asset landscape graph for admin", async () => {
    const response = await invoke("enterprise-data.asset-landscape.graph", { tenantId });
    expect(response.ok).toBe(true);
    const graph = response.payload?.graph as {
      nodes: unknown[];
      edges: unknown[];
      truncated: boolean;
    };
    expect(Array.isArray(graph.nodes)).toBe(true);
    expect(Array.isArray(graph.edges)).toBe(true);
    expect(graph.nodes.length).toBeGreaterThan(0);
    expect(typeof graph.truncated).toBe("boolean");
  });

  it("rejects forged tenantId on asset-landscape.graph", async () => {
    const response = await invoke("enterprise-data.asset-landscape.graph", {
      tenantId: "tenant-evil",
    });
    expect(response.ok).toBe(false);
  });

  it("returns rich source health rows for admin", async () => {
    const response = await invoke("enterprise-data.dashboard.source-health", { tenantId });
    expect(response.ok).toBe(true);
    const rows = response.payload?.rows as Array<{ status: string }>;
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
    const valid = new Set(["normal", "sync_delayed", "token_expiring", "error", "disconnected"]);
    expect(rows.every((row) => valid.has(row.status))).toBe(true);
  });

  it("rejects forged tenantId on source-health", async () => {
    const response = await invoke("enterprise-data.dashboard.source-health", {
      tenantId: "tenant-evil",
    });
    expect(response.ok).toBe(false);
  });

  it("returns source sync-log events for admin", async () => {
    const store = await loadEnterpriseDataStore();
    const crmSourceId =
      Object.values(store.dataSources).find(
        (source) => source.tenantId === tenantId && source.sourceKey === "crm-salesforce",
      )?.sourceId ?? "";
    const response = await invoke("enterprise-data.sources.sync-log", {
      tenantId,
      sourceId: crmSourceId,
    });
    expect(response.ok).toBe(true);
    const events = response.payload?.events as Array<Record<string, unknown>>;
    expect(Array.isArray(events)).toBe(true);
  });

  it("returns connector catalog for admin", async () => {
    const response = await invoke("enterprise-data.connectors.catalog", { tenantId });
    expect(response.ok).toBe(true);
    const connectors = response.payload?.connectors as Array<{
      connectorId: string;
      ready: boolean;
    }>;
    expect(Array.isArray(connectors)).toBe(true);
    expect(connectors.some((entry) => entry.connectorId === "crm-salesforce")).toBe(true);
  });

  it("probes demo connector connection for admin", async () => {
    const response = await invoke("enterprise-data.sources.test-connection", {
      tenantId,
      connectorId: "crm-salesforce",
    });
    expect(response.ok).toBe(true);
    const probe = response.payload?.probe as { ok: boolean; mode: string };
    expect(probe.ok).toBe(true);
    expect(probe.mode).toBe("mock_smoke_ok");
  });

  it("ensure-demo-package is idempotent when catalog already seeded", async () => {
    const response = await invoke("enterprise-data.connectors.ensure-demo-package", {
      tenantId,
      connectorId: "crm-salesforce",
    });
    expect(response.ok).toBe(true);
    expect(response.payload?.installed).toBe(false);
    expect((response.payload?.actionCount as number) ?? 0).toBeGreaterThan(0);
  });

  it("upserts and lists connector credentials for admin", async () => {
    const upsert = await invoke("enterprise-data.connector-credentials.upsert", {
      tenantId,
      connectorId: "crm-salesforce",
      label: "SF Test",
      instanceUrl: "https://example.salesforce.com",
      apiKey: "token-abcd",
    });
    expect(upsert.ok).toBe(true);
    const credential = upsert.payload?.credential as { credentialId?: string } | undefined;
    const credentialId = credential?.credentialId ?? "";
    expect(credentialId).toBeTruthy();

    const listed = await invoke("enterprise-data.connector-credentials.list", {
      tenantId,
      connectorId: "crm-salesforce",
    });
    expect(listed.ok).toBe(true);
    const credentials = listed.payload?.credentials as Array<{ credentialId: string }>;
    expect(credentials.some((item) => item.credentialId === credentialId)).toBe(true);
  });

  it("rejects member on connector-credentials.upsert", async () => {
    const response = await invoke(
      "enterprise-data.connector-credentials.upsert",
      {
        tenantId,
        connectorId: "crm-salesforce",
        label: "Blocked",
        apiKey: "x",
      },
      { admin: false },
    );
    expect(response.ok).toBe(false);
  });

  it("starts and simulates notion oauth for admin", async () => {
    const started = await invoke("enterprise-data.connector-credentials.oauth.start", {
      tenantId,
      connectorId: "notion",
      label: "Notion OAuth Test",
    });
    expect(started.ok).toBe(true);
    const sessionId = started.payload?.sessionId as string;
    expect(sessionId).toBeTruthy();
    expect(started.payload?.simulateAllowed).toBe(true);

    const status = await invoke("enterprise-data.connector-credentials.oauth.status", {
      tenantId,
      sessionId,
    });
    expect(status.ok).toBe(true);
    expect((status.payload?.session as { status?: string })?.status).toBe("pending");

    const completed = await invoke(
      "enterprise-data.connector-credentials.oauth.simulate-complete",
      {
        tenantId,
        sessionId,
      },
    );
    expect(completed.ok).toBe(true);
    expect(completed.payload?.credentialId).toBeTruthy();
  });

  it("ensure-package installs notion connector actions", async () => {
    const response = await invoke("enterprise-data.connectors.ensure-package", {
      tenantId,
      connectorId: "notion",
    });
    expect(response.ok).toBe(true);
    expect(response.payload?.installed).toBe(true);
    expect(response.payload?.actionCount).toBe(1);
  });

  it("upserts a 用友 T+ credential and probes GetVersionInfo", async () => {
    const installed = await invoke("enterprise-data.connectors.ensure-package", {
      tenantId,
      connectorId: "erp-yonyou-tplus",
    });
    expect(installed.ok).toBe(true);
    expect(installed.payload?.actionCount).toBe(7);

    const catalog = await invoke("enterprise-data.connectors.catalog", { tenantId });
    const connectors = catalog.payload?.connectors as Array<{
      connectorId: string;
      category: string;
      credentialKind: string;
      integrationTier: string;
      ready: boolean;
    }>;
    expect(connectors).toContainEqual(
      expect.objectContaining({
        connectorId: "erp-yonyou-tplus",
        category: "erp",
        credentialKind: "oauth2",
        integrationTier: "production",
        ready: true,
      }),
    );

    const upsert = await invoke("enterprise-data.connector-credentials.upsert", {
      tenantId,
      connectorId: "erp-yonyou-tplus",
      label: "京扇子 T+",
      kind: "oauth2",
      appKey: "ak-test",
      appSecret: "as-test",
      openToken: "open-token-1",
      orgId: "90001198862",
      appName: "tpluscloud",
    });
    expect(upsert.ok).toBe(true);
    const credential = upsert.payload?.credential as { credentialId?: string; kind?: string };
    expect(credential.kind).toBe("oauth2");
    expect(credential.credentialId).toBeTruthy();

    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const probed = await invoke("enterprise-data.sources.test-connection", {
        tenantId,
        connectorId: "erp-yonyou-tplus",
        credentialId: credential.credentialId,
      });
      expect(probed.ok).toBe(true);
      const probe = probed.payload?.probe as { ok: boolean; mode: string };
      expect(probe.ok).toBe(true);
      expect(probe.mode).toBe("live_probe_ok");
    } finally {
      vi.unstubAllGlobals();
    }
    expect(fetchMock).toHaveBeenCalled();
    const [url, init] = recordedFetch(fetchMock);
    expect(url).toContain("/tplus/api/v2/accountAPI/GetVersionInfo");
    expect(init.headers).toMatchObject({
      appKey: "ak-test",
      appSecret: "as-test",
      openToken: "open-token-1",
    });
  });
});
