// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { PlannerSeatContext } from "../enterprise-data/agent-data-plan-types.js";
import { listDataCapabilities } from "../enterprise-data/data-capability-store.js";
import { seedEnterpriseDataCatalog } from "../enterprise-data/seeds.js";
import {
  normalizeSemanticObjectStore,
  upsertSemanticObject,
} from "../enterprise-data/semantic-object-store.js";
import type { SemanticObjectStore } from "../enterprise-data/semantic-object-types.js";
import { normalizeEnterpriseDataStore } from "../enterprise-data/store.js";
import type { EnterpriseDataStore } from "../enterprise-data/types.js";
import type { GatewayRequestHandler, GatewayRequestHandlerOptions } from "./types.js";

vi.mock("../protocol/index.js", () => ({
  ErrorCodes: { INVALID_REQUEST: "INVALID_REQUEST" },
  errorShape: (code: string, message: string, extra?: { code?: string }) => ({
    code,
    message,
    ...extra,
  }),
}));

const { createEnterpriseDataPlannerHandlers } = await import("./enterprise-data-planner.js");

const tenantId = "tenant-acme";
const nowIso = "2026-07-12T12:00:00.000Z";

function seededEnterpriseStore(): EnterpriseDataStore {
  const store = normalizeEnterpriseDataStore(null);
  seedEnterpriseDataCatalog({ store, tenantId, nowIso });
  return store;
}

function seededSemanticStore(enterpriseStore: EnterpriseDataStore): SemanticObjectStore {
  const store = normalizeSemanticObjectStore(null);
  const customerCap = listDataCapabilities({ store: enterpriseStore, tenantId }).find(
    (capability) => capability.capabilityKey === "customer.profile",
  );
  if (!customerCap) {
    throw new Error("missing seeded capability customer.profile");
  }
  upsertSemanticObject({
    store,
    tenantId,
    nowIso,
    object: {
      objectKey: "customer",
      displayName: "客户",
      kind: "customer",
      description: "客户主数据",
      lifecycle: "active",
      fields: [{ fieldKey: "customerId", displayName: "客户ID", type: "id", required: true }],
      sourceBindings: [
        {
          sourceId: customerCap.sourceIds[0] ?? "",
          action: customerCap.actionRefs[0] ?? { connectorId: "", actionKey: "", version: "" },
          fieldMappings: [],
          capabilityId: customerCap.capabilityId,
          primary: true,
        },
      ],
    },
  });
  return store;
}

const grantedSeatContext: PlannerSeatContext = {
  tenantId,
  seatId: "seat-sales-mgr-east",
  employeeId: "emp-mgr-001",
};

function makeHandlers(options?: { resolveContext?: () => Promise<PlannerSeatContext> }) {
  const enterpriseStore = seededEnterpriseStore();
  const semanticStore = seededSemanticStore(enterpriseStore);
  return createEnterpriseDataPlannerHandlers({
    loadEnterpriseStore: async () => enterpriseStore,
    loadSemanticStore: async () => semanticStore,
    resolveContext: options?.resolveContext ?? (async () => grantedSeatContext),
    now: () => nowIso,
  });
}

type InvokeResult = {
  ok: boolean;
  payload?: Record<string, unknown>;
  error?: { message?: string; code?: string };
};

async function invoke(
  handlers: ReturnType<typeof createEnterpriseDataPlannerHandlers>,
  method: string,
  params: Record<string, unknown> = {},
): Promise<InvokeResult> {
  const handler = handlers[method] as GatewayRequestHandler | undefined;
  if (!handler) {
    throw new Error(`missing handler ${method}`);
  }
  let response: InvokeResult | null = null;
  await handler({
    req: { type: "req", id: "test", method, params },
    params,
    client: { connect: {} as never, user: "mgr@acme.test" },
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

describe("enterprise-data planner handlers", () => {
  it("returns an authorization-aware plan for the caller's own seat", async () => {
    const response = await invoke(makeHandlers(), "enterprise-data.planner.plan");
    expect(response.ok).toBe(true);
    expect(response.payload?.seatId).toBe("seat-sales-mgr-east");
    const plan = response.payload?.plan as {
      steps: Array<{ objectKey: string; accessState?: string }>;
    };
    const customer = plan.steps.find((step) => step.objectKey === "customer");
    expect(customer?.accessState).toBe("granted");
  });

  it("filters the plan by objectKeys param", async () => {
    const response = await invoke(makeHandlers(), "enterprise-data.planner.plan", {
      objectKeys: ["customer"],
    });
    expect(response.ok).toBe(true);
    const plan = response.payload?.plan as { steps: Array<{ objectKey: string }> };
    expect(plan.steps.map((step) => step.objectKey)).toEqual(["customer"]);
  });

  it("returns a context pack with identity and granted capabilities", async () => {
    const response = await invoke(makeHandlers(), "enterprise-data.planner.context");
    expect(response.ok).toBe(true);
    const pack = response.payload?.contextPack as {
      identity: { seatId: string };
      authorizedCapabilities: Array<{ capabilityKey: string }>;
    };
    expect(pack.identity.seatId).toBe("seat-sales-mgr-east");
    expect(pack.authorizedCapabilities.map((ref) => ref.capabilityKey)).toEqual([
      "customer.profile",
    ]);
  });

  it("rejects when no seat context resolves for the session", async () => {
    const handlers = makeHandlers({
      resolveContext: async () => {
        throw new Error("no seat");
      },
    });
    const response = await invoke(handlers, "enterprise-data.planner.plan");
    expect(response.ok).toBe(false);
  });
});
