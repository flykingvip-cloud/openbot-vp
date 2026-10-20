// @vitest-environment node
import { describe, expect, it } from "vitest";
import { resolveAssetLandscapeGraph } from "./asset-landscape-store.js";
import { normalizeSemanticObjectStore, upsertSemanticObject } from "./semantic-object-store.js";
import type { SemanticObject } from "./semantic-object-types.js";
import { normalizeEnterpriseDataStore } from "./store.js";
import type { DataCapability, DataSource, EnterpriseDataStore } from "./types.js";

const tenantId = "tenant-acme";
const nowIso = "2026-07-12T12:00:00.000Z";

function baseStore(): EnterpriseDataStore {
  const store = normalizeEnterpriseDataStore(null);
  const source: DataSource = {
    sourceId: "src-1",
    tenantId,
    sourceKey: "crm-salesforce",
    displayName: "Salesforce CRM",
    category: "crm",
    status: "connected",
    connectorId: "crm-salesforce",
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  const capability: DataCapability = {
    capabilityId: "cap-1",
    tenantId,
    capabilityKey: "customer-360",
    displayName: "客户360",
    description: "",
    sourceIds: ["src-1"],
    actionRefs: [{ connectorId: "crm-salesforce", actionKey: "listCustomers", version: "v1" }],
    enabled: true,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  store.dataSources[source.sourceId] = source;
  store.dataCapabilities[capability.capabilityId] = capability;
  return store;
}

function semanticObjects(opts: { sourceId: string; capabilityId?: string }): SemanticObject[] {
  const semanticStore = normalizeSemanticObjectStore(null);
  upsertSemanticObject({
    store: semanticStore,
    tenantId,
    object: {
      objectKey: "customer",
      displayName: "客户",
      kind: "customer",
      description: "",
      lifecycle: "active",
      fields: [{ fieldKey: "customerId", displayName: "ID", type: "id" }],
      sourceBindings: [
        {
          sourceId: opts.sourceId,
          action: { connectorId: "crm-salesforce", actionKey: "listCustomers", version: "v1" },
          fieldMappings: [{ fieldKey: "customerId", sourceFieldPath: "records[].Id" }],
          capabilityId: opts.capabilityId,
        },
      ],
    },
    nowIso,
  });
  return Object.values(semanticStore.semanticObjects);
}

describe("resolveAssetLandscapeGraph semantic object integration", () => {
  it("adds an object node plus model and serve edges when semanticObjects are provided", () => {
    const graph = resolveAssetLandscapeGraph({
      store: baseStore(),
      tenantId,
      semanticObjects: semanticObjects({ sourceId: "src-1", capabilityId: "cap-1" }),
    });
    const objectNode = graph.nodes.find((node) => node.kind === "object");
    expect(objectNode?.label).toBe("客户");

    const modelEdge = graph.edges.find((edge) => edge.relation === "model");
    expect(modelEdge?.from).toBe("source:src-1");
    expect(modelEdge?.to).toBe(objectNode?.id);

    const serveEdge = graph.edges.find((edge) => edge.relation === "serve");
    expect(serveEdge?.from).toBe(objectNode?.id);
    expect(serveEdge?.to).toBe("capability:cap-1");
  });

  it("adds no object nodes or edges when semanticObjects are omitted (backward compatible)", () => {
    const graph = resolveAssetLandscapeGraph({ store: baseStore(), tenantId });
    expect(graph.nodes.some((node) => node.kind === "object")).toBe(false);
    expect(graph.edges.some((edge) => edge.relation === "model" || edge.relation === "serve")).toBe(
      false,
    );
  });

  it("skips the model edge when the binding source is not in the graph (no dangling edge)", () => {
    const graph = resolveAssetLandscapeGraph({
      store: baseStore(),
      tenantId,
      semanticObjects: semanticObjects({ sourceId: "src-ghost", capabilityId: "cap-1" }),
    });
    expect(graph.nodes.some((node) => node.kind === "object")).toBe(true);
    expect(graph.edges.some((edge) => edge.relation === "model")).toBe(false);
    // The serve edge (object → included capability) still connects.
    expect(graph.edges.some((edge) => edge.relation === "serve")).toBe(true);
  });
});
