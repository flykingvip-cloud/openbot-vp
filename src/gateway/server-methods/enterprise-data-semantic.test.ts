// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  ensureSemanticObjectDemoCatalog,
  normalizeSemanticObjectStore,
} from "../enterprise-data/semantic-object-store.js";
import type { GatewayRequestHandler, GatewayRequestHandlerOptions } from "./types.js";

const testPaths = vi.hoisted(() => ({
  tmpDir: `/tmp/openbot-enterprise-data-semantic-handler-test-${Date.now()}`,
}));

vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return { ...actual, CONFIG_DIR: testPaths.tmpDir };
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

const { createEnterpriseDataSemanticHandlers } = await import("./enterprise-data-semantic.js");

const tenantId = "tenant-acme";
const nowIso = "2026-07-12T12:00:00.000Z";
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

function seededStore() {
  const store = normalizeSemanticObjectStore(null);
  ensureSemanticObjectDemoCatalog({ store, tenantId, nowIso });
  return store;
}

const handlers = createEnterpriseDataSemanticHandlers({
  loadStore: async () => seededStore(),
});

type InvokeResult = {
  ok: boolean;
  payload?: Record<string, unknown>;
  error?: { message?: string; code?: string };
};

async function invoke(
  method: string,
  params: Record<string, unknown> = {},
  options: { admin?: boolean } = {},
): Promise<InvokeResult> {
  const handler = handlers[method] as GatewayRequestHandler | undefined;
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

describe("enterprise-data semantic-object handlers", () => {
  it("lists the seeded semantic objects for an admin", async () => {
    const response = await invoke("enterprise-data.semantic-objects.list", { tenantId });
    expect(response.ok).toBe(true);
    const objects = response.payload?.objects as Array<{ objectKey: string }>;
    expect(objects.map((object) => object.objectKey)).toEqual([
      "customer",
      "inventory",
      "product",
      "sales-order",
    ]);
  });

  it("filters list by kind", async () => {
    const response = await invoke("enterprise-data.semantic-objects.list", {
      tenantId,
      kind: "customer",
    });
    expect(response.ok).toBe(true);
    const objects = response.payload?.objects as Array<{ objectKey: string }>;
    expect(objects).toHaveLength(1);
    expect(objects[0]?.objectKey).toBe("customer");
  });

  it("gets a semantic object by objectKey", async () => {
    const response = await invoke("enterprise-data.semantic-objects.get", {
      tenantId,
      objectKey: "sales-order",
    });
    expect(response.ok).toBe(true);
    const object = response.payload?.object as { objectKey: string; displayName: string };
    expect(object.objectKey).toBe("sales-order");
    expect(object.displayName).toBe("订单");
  });

  it("rejects get without objectId or objectKey", async () => {
    const response = await invoke("enterprise-data.semantic-objects.get", { tenantId });
    expect(response.ok).toBe(false);
  });

  it("rejects a forged tenantId", async () => {
    const response = await invoke("enterprise-data.semantic-objects.list", {
      tenantId: "tenant-evil",
    });
    expect(response.ok).toBe(false);
  });

  it("rejects a non-admin member", async () => {
    const response = await invoke(
      "enterprise-data.semantic-objects.list",
      { tenantId },
      { admin: false },
    );
    expect(response.ok).toBe(false);
  });
});
