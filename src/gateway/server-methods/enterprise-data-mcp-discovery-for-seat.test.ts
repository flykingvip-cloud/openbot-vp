// @vitest-environment node
import fs from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EnterpriseDataStoreError } from "../enterprise-data/connector-action-store.js";
import { GOVERNANCE_ADMIN_REQUIRED_MESSAGE } from "../enterprise-data/enterprise-data-seat-context.js";
import { upsertMcpToolMapping } from "../enterprise-data/mcp-mapping.js";
import { upsertSeatActionGrant } from "../enterprise-data/seat-action-grant-store.js";
import {
  loadEnterpriseDataStore,
  normalizeEnterpriseDataStore,
  saveEnterpriseDataStore,
} from "../enterprise-data/store.js";
import { authorizeOperatorScopesForMethod } from "../method-scopes.js";
import { getRequiredDomain, guardSessionDomain } from "../platform-auth/session-domain.js";
import type { GatewayRequestHandler, GatewayRequestHandlerOptions } from "./types.js";

const { enterpriseDataHandlers } = await import("./enterprise-data.js");

const testPaths = vi.hoisted(() => ({
  tmpDir: `/tmp/openbot-mcp-discovery-for-seat-${Date.now()}`,
}));

vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return {
    ...actual,
    CONFIG_DIR: testPaths.tmpDir,
  };
});

const resolveBillingScopeMock = vi.hoisted(() => vi.fn());
const resolveSeatMock = vi.hoisted(() => vi.fn());

vi.mock("../billing/scope.js", () => ({
  resolveBillingScope: resolveBillingScopeMock,
}));

vi.mock("../enterprise-data/enterprise-data-seat-context.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../enterprise-data/enterprise-data-seat-context.js")>();
  return {
    ...actual,
    resolveTrustedEnterpriseDataExecutionContext: resolveSeatMock,
  };
});

const tenantId = "tenant-acme";
const nowIso = "2026-10-16T00:00:00.000Z";
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
const memberSeat = {
  tenantId,
  seatId: "seat-self",
  employeeId: "emp-member-001",
  userId: "emp-member-001",
  trustAttestation: "server-session-v1" as const,
};
const adminSeat = {
  tenantId,
  seatId: "seat-admin",
  employeeId: "emp-admin-001",
  userId: "emp-admin-001",
  trustAttestation: "server-session-v1" as const,
};

type InvokeResult = {
  ok: boolean;
  payload?: Record<string, unknown>;
  error?: { message?: string; code?: string; details?: { code?: string } };
};

async function seedStore() {
  const store = normalizeEnterpriseDataStore(null);
  const hubspot = upsertMcpToolMapping({
    store,
    tenantId,
    nowIso,
    input: { mcpServer: "hubspot", mcpTool: "list_leads", displayName: "线索列表" },
  });
  const linear = upsertMcpToolMapping({
    store,
    tenantId,
    nowIso,
    input: { mcpServer: "linear", mcpTool: "list_issues", displayName: "议题" },
  });
  const secret = upsertMcpToolMapping({
    store,
    tenantId: "tenant-other",
    nowIso,
    input: { mcpServer: "secret-crm", mcpTool: "dump_tokens", displayName: "密钥导出" },
  });
  const grantRef = {
    connectorId: hubspot.action.connectorId,
    actionKey: hubspot.action.actionKey,
    version: hubspot.action.version,
  };
  upsertSeatActionGrant({ store, tenantId, seatId: "seat-other", ...grantRef, nowIso });
  upsertSeatActionGrant({ store, tenantId, seatId: "seat-admin", ...grantRef, nowIso });
  upsertSeatActionGrant({
    store,
    tenantId: "tenant-other",
    seatId: "seat-self",
    connectorId: secret.action.connectorId,
    actionKey: secret.action.actionKey,
    version: secret.action.version,
    nowIso,
  });
  void linear;
  await saveEnterpriseDataStore(store);
}

function fingerprint(store: Awaited<ReturnType<typeof loadEnterpriseDataStore>>) {
  return JSON.stringify({
    grants: Object.values(store.seatActionGrants)
      .map((grant) => `${grant.tenantId}:${grant.seatId}:${grant.actionKey}`)
      .toSorted(),
    actions: Object.keys(store.connectorActions).toSorted(),
    capabilities: Object.keys(store.dataCapabilities).toSorted(),
    registry: Object.keys(store.connectorRuntimeRegistry).toSorted(),
  });
}

async function invoke(
  method: string,
  params: Record<string, unknown>,
  options: {
    admin?: boolean;
    seat?: (typeof memberSeat & { roleCode?: string }) | null;
    explode?: Error;
  } = {},
): Promise<InvokeResult> {
  const handler = enterpriseDataHandlers[method] as GatewayRequestHandler | undefined;
  if (!handler) {
    throw new Error(`missing handler ${method}`);
  }
  resolveBillingScopeMock.mockImplementation(async () =>
    options.admin === false ? memberScope : adminScope,
  );
  if (options.explode) {
    resolveSeatMock.mockRejectedValue(options.explode);
  } else if (options.seat === null) {
    resolveSeatMock.mockRejectedValue(
      new EnterpriseDataStoreError("NO_CURRENT_SEAT", "Active seat binding not found."),
    );
  } else {
    resolveSeatMock.mockResolvedValue(options.seat ?? memberSeat);
  }
  let response: InvokeResult | null = null;
  await handler({
    req: { type: "req", id: "test", method, params },
    params,
    client: {
      connect: {} as never,
      user: options.admin === false ? "member@acme.test" : "admin@acme.test",
    },
    isWebchatConnect: () => false,
    respond: (ok, payload, error) => {
      response = {
        ok,
        payload: payload as Record<string, unknown> | undefined,
        error: error as InvokeResult["error"],
      };
    },
    context: {} as GatewayRequestHandlerOptions["context"],
  });
  if (!response) {
    throw new Error(`handler ${method} did not respond`);
  }
  return response;
}

describe("enterprise-data.mcp-discovery.for-seat", () => {
  beforeEach(async () => {
    fs.rmSync(testPaths.tmpDir, { recursive: true, force: true });
    fs.mkdirSync(testPaths.tmpDir, { recursive: true });
    resolveBillingScopeMock.mockReset();
    resolveSeatMock.mockReset();
    await seedStore();
  });

  it("is readable by members and enterprise admins, not a platform-domain session", () => {
    expect(
      authorizeOperatorScopesForMethod("enterprise-data.mcp-discovery.for-seat", ["operator.read"]),
    ).toEqual({ allowed: true });
    expect(
      authorizeOperatorScopesForMethod("enterprise-data.mcp-discovery.for-seat", [
        "operator.admin",
      ]),
    ).toEqual({ allowed: true });
    expect(getRequiredDomain("enterprise-data.mcp-discovery.for-seat")).toEqual([
      "employee",
      "enterprise",
    ]);
    expect(guardSessionDomain("enterprise-data.mcp-discovery.for-seat", "employee").allowed).toBe(
      true,
    );
    expect(guardSessionDomain("enterprise-data.mcp-discovery.for-seat", "enterprise").allowed).toBe(
      true,
    );
    expect(guardSessionDomain("enterprise-data.mcp-discovery.for-seat", "platform").allowed).toBe(
      false,
    );
  });

  it("lets a member read their own seat and ignores a cross-seat override", async () => {
    const before = fingerprint(await loadEnterpriseDataStore());
    const response = await invoke(
      "enterprise-data.mcp-discovery.for-seat",
      {
        tenantId,
        seatId: "seat-other",
        employeeId: "emp-other",
      },
      { admin: false },
    );
    expect(response.ok).toBe(true);
    expect(response.payload?.seatId).toBe("seat-self");
    expect(response.payload?.tenantId).toBe(tenantId);
    expect(response.payload?.filterApplied).toBe(false);
    expect(response.payload?.emptyReason).toBeNull();
    const items = response.payload?.items as Array<Record<string, unknown>>;
    expect(items.map((item) => item.serverName)).toEqual(["hubspot", "linear"]);
    const hubspot = items.find((item) => item.serverName === "hubspot");
    expect(hubspot).toMatchObject({
      toolName: "list_leads",
      status: "mapped_pending_grant",
      capabilityDisplayName: "线索列表",
    });
    expect(typeof hubspot?.capabilityId).toBe("string");
    expect(hubspot?.capabilityId).not.toBe("");
    const encoded = JSON.stringify(response.payload);
    expect(encoded).not.toContain("seat-other");
    expect(encoded).not.toContain("secret-crm");
    expect(encoded).not.toContain("dump_tokens");
    expect(encoded).not.toContain("actionRef");
    expect(encoded).not.toContain("connectorId");
    expect(encoded).not.toContain("grantId");
    expect(encoded).not.toContain("oauth");
    expect(fingerprint(await loadEnterpriseDataStore())).toBe(before);
  });

  it("prefilters with shared template hints and drops tools that do not match", async () => {
    const store = await loadEnterpriseDataStore();
    upsertMcpToolMapping({
      store,
      tenantId,
      nowIso,
      input: { mcpServer: "gmail", mcpTool: "list_messages", displayName: "收件箱" },
    });
    await saveEnterpriseDataStore(store);
    const before = fingerprint(await loadEnterpriseDataStore());
    const response = await invoke(
      "enterprise-data.mcp-discovery.for-seat",
      { tenantId, catalogId: "email", seatId: "seat-other" },
      { admin: false },
    );
    expect(response.ok).toBe(true);
    expect(response.payload?.filterApplied).toBe(true);
    expect(response.payload?.templateId).toBe("personal_mail_assistant");
    expect(response.payload?.catalogId).toBe("email");
    expect(response.payload?.emptyReason).toBeNull();
    const items = response.payload?.items as Array<Record<string, unknown>>;
    expect(items.map((item) => item.serverName)).toEqual(["gmail"]);
    expect(items[0]).toMatchObject({
      toolName: "list_messages",
      status: "mapped_pending_grant",
    });
    expect(response.payload?.matchedHints).toEqual(expect.arrayContaining(["gmail"]));
    const encoded = JSON.stringify(response.payload);
    expect(encoded).not.toContain("linear");
    expect(encoded).not.toContain("hubspot");
    expect(encoded).not.toContain("secret-crm");
    expect(encoded).not.toContain("actionRef");
    expect(encoded).not.toContain("seat-other");
    expect(fingerprint(await loadEnterpriseDataStore())).toBe(before);
  });

  it("returns an empty no_role projection for generic_worker", async () => {
    const response = await invoke(
      "enterprise-data.mcp-discovery.for-seat",
      { templateId: "generic_worker" },
      { admin: false },
    );
    expect(response.ok).toBe(true);
    expect(response.payload?.filterApplied).toBe(true);
    expect(response.payload?.templateId).toBe("generic_worker");
    expect(response.payload?.emptyReason).toBe("no_role");
    expect(response.payload?.items).toEqual([]);
    expect(JSON.stringify(response.payload)).not.toContain("secret-crm");
    expect(JSON.stringify(response.payload)).not.toContain("hubspot");
  });

  it("uses a known session role binding when the request omits catalog and template", async () => {
    const response = await invoke(
      "enterprise-data.mcp-discovery.for-seat",
      { seatId: "seat-other" },
      { admin: false, seat: { ...memberSeat, roleCode: "sales_assistant" } },
    );
    expect(response.ok).toBe(true);
    expect(response.payload?.filterApplied).toBe(true);
    expect(response.payload?.templateId).toBe("sales_assistant");
    const items = response.payload?.items as Array<{ serverName: string; status: string }>;
    expect(items.map((item) => item.serverName)).toEqual(["hubspot"]);
    expect(items[0]?.status).toBe("mapped_pending_grant");
    expect(JSON.stringify(response.payload)).not.toContain("linear");
    expect(JSON.stringify(response.payload)).not.toContain("seat-other");
  });

  it("lets an admin read their own seat projection, including authorized", async () => {
    const response = await invoke(
      "enterprise-data.mcp-discovery.for-seat",
      { tenantId, seatId: "seat-other" },
      { admin: true, seat: adminSeat },
    );
    expect(response.ok).toBe(true);
    expect(response.payload?.seatId).toBe("seat-admin");
    const items = response.payload?.items as Array<{ serverName: string; status: string }>;
    expect(items.find((item) => item.serverName === "hubspot")?.status).toBe("authorized");
    expect(JSON.stringify(response.payload)).not.toContain("seat-other");
  });

  it("hard-fails when the session has no active seat and does not invent rows", async () => {
    const before = fingerprint(await loadEnterpriseDataStore());
    const response = await invoke(
      "enterprise-data.mcp-discovery.for-seat",
      { tenantId },
      { seat: null },
    );
    expect(response.ok).toBe(false);
    expect(response.payload).toBeUndefined();
    expect(response.error?.message).toBe("当前会话没有可用席位，无法查看 MCP 能力。");
    expect(response.error?.details?.code).toBe("NO_CURRENT_SEAT");
    expect(response.error?.message).not.toContain("Active seat binding");
    expect(fingerprint(await loadEnterpriseDataStore())).toBe(before);
  });

  it("hides connection strings when discovery fails closed", async () => {
    const response = await invoke(
      "enterprise-data.mcp-discovery.for-seat",
      {},
      { explode: new Error("postgres://user:pass@10.0.0.1/db\n    at Client.connect") },
    );
    expect(response.ok).toBe(false);
    expect(response.payload).toBeUndefined();
    expect(response.error?.message).toBe("暂时无法读取本席位的 MCP 能力，请稍后重试。");
    expect(JSON.stringify(response.error)).not.toContain("postgres://");
    expect(JSON.stringify(response.error)).not.toContain("at Client.connect");
  });

  it("rejects a tenantId that does not match the session", async () => {
    const response = await invoke(
      "enterprise-data.mcp-discovery.for-seat",
      { tenantId: "tenant-other", seatId: "seat-self" },
      { admin: false },
    );
    expect(response.ok).toBe(false);
    expect(response.payload).toBeUndefined();
    expect(response.error?.message).toBe("tenantId 必须与当前企业会话一致。");
    expect(response.error?.details?.code).toBe("TENANT_MISMATCH");
  });

  it("keeps admin discovery admin-only and refuses employee mapping or grant writes", async () => {
    const before = fingerprint(await loadEnterpriseDataStore());
    const discovery = await invoke("enterprise-data.mcp-discovery", { tenantId }, { admin: false });
    expect(discovery.ok).toBe(false);
    expect(discovery.error?.message).toBe(GOVERNANCE_ADMIN_REQUIRED_MESSAGE);
    const mapping = await invoke(
      "enterprise-data.mcp-mapping.upsert",
      { tenantId, mcpServer: "hubspot", mcpTool: "list_leads" },
      { admin: false },
    );
    expect(mapping.ok).toBe(false);
    expect(mapping.error?.message).toBe(GOVERNANCE_ADMIN_REQUIRED_MESSAGE);
    const grant = await invoke(
      "enterprise-data.grants.upsert",
      {
        tenantId,
        seatId: "seat-self",
        connectorId: "mcp",
        actionKey: "hubspot.list_leads",
        version: "v1",
      },
      { admin: false },
    );
    expect(grant.ok).toBe(false);
    expect(grant.error?.message).toBe(GOVERNANCE_ADMIN_REQUIRED_MESSAGE);
    expect(fingerprint(await loadEnterpriseDataStore())).toBe(before);
  });
});
