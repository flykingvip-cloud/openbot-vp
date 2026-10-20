// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildAgentContextPack, executeDataPlan, planDataAccess } from "./agent-data-planner.js";
import { listDataCapabilities } from "./data-capability-store.js";
import { createTrustedExecutionContextForTest } from "./enterprise-data-seat-context.js";
import { seedEnterpriseDataCatalog } from "./seeds.js";
import { normalizeSemanticObjectStore, upsertSemanticObject } from "./semantic-object-store.js";
import type { SemanticObjectStore } from "./semantic-object-types.js";
import { normalizeEnterpriseDataStore } from "./store.js";
import type { DataCapability, EnterpriseDataStore } from "./types.js";

const mockedConfigDir = path.join(os.tmpdir(), "openbot-agent-data-planner-test");

vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return {
    ...actual,
    CONFIG_DIR: path.join(os.tmpdir(), "openbot-agent-data-planner-test"),
  };
});

const tenantId = "tenant-acme";
const nowIso = "2026-07-12T12:00:00.000Z";

function seededEnterpriseStore(): EnterpriseDataStore {
  const store = normalizeEnterpriseDataStore(null);
  seedEnterpriseDataCatalog({ store, tenantId, nowIso });
  return store;
}

function capabilityByKey(store: EnterpriseDataStore, capabilityKey: string): DataCapability {
  const capability = listDataCapabilities({ store, tenantId }).find(
    (item) => item.capabilityKey === capabilityKey,
  );
  if (!capability) {
    throw new Error(`missing seeded capability ${capabilityKey}`);
  }
  return capability;
}

/**
 * Semantic catalog for planning tests:
 *  - customer  → bound to customer.profile via capabilityId (granted for seat-sales-mgr-east)
 *  - sales-order → bound to order.status via action only (D3 action-match; NOT granted)
 *  - product   → no source binding (unbindable)
 */
function seededSemanticStore(enterpriseStore: EnterpriseDataStore): SemanticObjectStore {
  const store = normalizeSemanticObjectStore(null);
  const customerCap = capabilityByKey(enterpriseStore, "customer.profile");
  const orderCap = capabilityByKey(enterpriseStore, "order.status");
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
      fields: [
        { fieldKey: "customerId", displayName: "客户ID", type: "id", required: true },
        { fieldKey: "phone", displayName: "电话", type: "string", classification: "CONFIDENTIAL" },
        { fieldKey: "ssn", displayName: "证件号", type: "string", classification: "RESTRICTED" },
      ],
      sourceBindings: [
        {
          sourceId: customerCap.sourceIds[0] ?? "",
          action: customerCap.actionRefs[0] ?? {
            connectorId: "",
            actionKey: "",
            version: "",
          },
          fieldMappings: [],
          capabilityId: customerCap.capabilityId,
          primary: true,
        },
      ],
    },
  });
  upsertSemanticObject({
    store,
    tenantId,
    nowIso,
    object: {
      objectKey: "sales-order",
      displayName: "订单",
      kind: "order",
      description: "销售订单",
      lifecycle: "active",
      fields: [{ fieldKey: "orderId", displayName: "订单ID", type: "id", required: true }],
      sourceBindings: [
        {
          sourceId: orderCap.sourceIds[0] ?? "",
          action: orderCap.actionRefs[0] ?? { connectorId: "", actionKey: "", version: "" },
          fieldMappings: [],
        },
      ],
    },
  });
  upsertSemanticObject({
    store,
    tenantId,
    nowIso,
    object: {
      objectKey: "product",
      displayName: "产品",
      kind: "product",
      description: "产品主数据",
      lifecycle: "active",
      fields: [{ fieldKey: "productId", displayName: "产品ID", type: "id", required: true }],
    },
  });
  return store;
}

function grantedContext() {
  return createTrustedExecutionContextForTest({
    tenantId,
    seatId: "seat-sales-mgr-east",
    employeeId: "emp-mgr-001",
    userId: "emp-mgr-001",
  });
}

function ungrantedContext() {
  return createTrustedExecutionContextForTest({
    tenantId,
    seatId: "seat-unknown",
    employeeId: "emp-unknown",
    userId: "emp-unknown",
  });
}

function cleanStore() {
  fs.rmSync(mockedConfigDir, { recursive: true, force: true });
  fs.mkdirSync(mockedConfigDir, { recursive: true });
}

describe("planDataAccess (authorization-aware Data Plan)", () => {
  it("resolves capabilities, tags granted/requestable, and surfaces unbindable objects", () => {
    const enterpriseStore = seededEnterpriseStore();
    const semanticStore = seededSemanticStore(enterpriseStore);
    const plan = planDataAccess({
      enterpriseStore,
      semanticStore,
      context: grantedContext(),
      nowIso,
    });

    expect(plan.tenantId).toBe(tenantId);
    expect(plan.seatId).toBe("seat-sales-mgr-east");
    expect(plan.summary).toEqual({
      totalObjects: 3,
      resolved: 2,
      granted: 1,
      requestable: 1,
      unresolved: 1,
    });

    const customer = plan.steps.find((step) => step.objectKey === "customer");
    expect(customer?.status).toBe("resolved");
    expect(customer?.accessState).toBe("granted");
    expect(customer?.capabilityKey).toBe("customer.profile");
    expect(customer?.bindingId).toBeTruthy();
    expect(customer?.actionRefs?.[0]?.actionKey).toBe("crm.customer.read_summary");

    // sales-order resolves via the action-match path (binding has no capabilityId).
    const order = plan.steps.find((step) => step.objectKey === "sales-order");
    expect(order?.status).toBe("resolved");
    expect(order?.capabilityKey).toBe("order.status");
    expect(order?.accessState).toBe("requestable");

    const product = plan.steps.find((step) => step.objectKey === "product");
    expect(product?.status).toBe("unbindable");
    expect(product?.reason).toBe("no-binding");
  });

  it("excludes RESTRICTED fields by default and tags CONFIDENTIAL fields", () => {
    const enterpriseStore = seededEnterpriseStore();
    const semanticStore = seededSemanticStore(enterpriseStore);
    const plan = planDataAccess({
      enterpriseStore,
      semanticStore,
      context: grantedContext(),
      request: { objectKeys: ["customer"] },
      nowIso,
    });
    const [customer] = plan.steps;
    const fieldKeys = customer?.fields.map((field) => field.fieldKey);
    expect(fieldKeys).toEqual(["customerId", "phone"]); // ssn (RESTRICTED) excluded
    const phone = customer?.fields.find((field) => field.fieldKey === "phone");
    expect(phone?.classification).toBe("CONFIDENTIAL");
  });

  it("applies a classificationCeiling for least-privilege planning", () => {
    const enterpriseStore = seededEnterpriseStore();
    const semanticStore = seededSemanticStore(enterpriseStore);
    const plan = planDataAccess({
      enterpriseStore,
      semanticStore,
      context: grantedContext(),
      request: { objectKeys: ["customer"], classificationCeiling: "INTERNAL" },
      nowIso,
    });
    const fieldKeys = plan.steps[0]?.fields.map((field) => field.fieldKey);
    expect(fieldKeys).toEqual(["customerId"]); // phone (CONFIDENTIAL) + ssn (RESTRICTED) excluded
  });

  it("marks a capability as requestable for an ungranted seat", () => {
    const enterpriseStore = seededEnterpriseStore();
    const semanticStore = seededSemanticStore(enterpriseStore);
    const plan = planDataAccess({
      enterpriseStore,
      semanticStore,
      context: ungrantedContext(),
      request: { objectKeys: ["customer"] },
      nowIso,
    });
    expect(plan.steps[0]?.accessState).toBe("requestable");
    expect(plan.summary.granted).toBe(0);
    expect(plan.summary.requestable).toBe(1);
  });

  it("resolves relevant objects from a free-text task (deterministic keyword match)", () => {
    const enterpriseStore = seededEnterpriseStore();
    const semanticStore = seededSemanticStore(enterpriseStore);
    const plan = planDataAccess({
      enterpriseStore,
      semanticStore,
      context: grantedContext(),
      request: { task: "帮我看看这个客户的画像" },
      nowIso,
    });
    expect(plan.steps.map((step) => step.objectKey)).toEqual(["customer"]);
    expect(plan.taskHint).toBe("帮我看看这个客户的画像");
  });

  it("filters by objectKinds and caps with maxObjects", () => {
    const enterpriseStore = seededEnterpriseStore();
    const semanticStore = seededSemanticStore(enterpriseStore);
    const byKind = planDataAccess({
      enterpriseStore,
      semanticStore,
      context: grantedContext(),
      request: { objectKinds: ["order"] },
      nowIso,
    });
    expect(byKind.steps.map((step) => step.objectKey)).toEqual(["sales-order"]);

    const capped = planDataAccess({
      enterpriseStore,
      semanticStore,
      context: grantedContext(),
      request: { maxObjects: 1 },
      nowIso,
    });
    // Objects are sorted by objectKey: customer < product < sales-order.
    expect(capped.steps.map((step) => step.objectKey)).toEqual(["customer"]);
  });
});

describe("buildAgentContextPack (Context Broker)", () => {
  it("bundles identity, granted capabilities, and relevant knowledge projections", () => {
    const enterpriseStore = seededEnterpriseStore();
    const semanticStore = seededSemanticStore(enterpriseStore);
    const pack = buildAgentContextPack({
      enterpriseStore,
      semanticStore,
      context: grantedContext(),
      nowIso,
    });

    expect(pack.identity.tenantId).toBe(tenantId);
    expect(pack.identity.seatId).toBe("seat-sales-mgr-east");

    // Only granted capabilities appear (customer.profile); order.status is requestable.
    expect(pack.authorizedCapabilities).toHaveLength(1);
    expect(pack.authorizedCapabilities[0]?.capabilityKey).toBe("customer.profile");
    expect(pack.authorizedCapabilities[0]?.sourceSystems).toEqual(["Salesforce CRM"]);

    // Plan touches customer (→customer) + order (→sales) kinds → both seeded projections.
    const projectionKeys = pack.knowledgeProjections.map((ref) => ref.projectionKey).toSorted();
    expect(projectionKeys).toEqual(["customer.profile", "sales.churn-risk"]);
  });
});

describe("executeDataPlan (delegates to the W5 bridge)", () => {
  beforeEach(cleanStore);
  afterEach(cleanStore);

  it("refuses granted steps instead of requesting connector actions", async () => {
    const enterpriseStore = seededEnterpriseStore();
    const semanticStore = seededSemanticStore(enterpriseStore);
    const context = grantedContext();
    const plan = planDataAccess({ enterpriseStore, semanticStore, context, nowIso });
    const execution = await executeDataPlan({
      store: enterpriseStore,
      context,
      plan,
      nowIso,
    });

    const customer = execution.results.find((result) => result.objectKey === "customer");
    expect(customer?.executed).toBe(true);
    expect(customer?.outcome?.ok).toBe(false);
    expect(customer?.outcome?.reason).toBe("knowledge-object-only");
    expect(customer?.outcome?.results).toBeUndefined();

    const order = execution.results.find((result) => result.objectKey === "sales-order");
    expect(order?.executed).toBe(false);
    expect(order?.skippedReason).toBe("requestable");

    const product = execution.results.find((result) => result.objectKey === "product");
    expect(product?.executed).toBe(false);
    expect(product?.skippedReason).toBe("unresolved");
  });
});
