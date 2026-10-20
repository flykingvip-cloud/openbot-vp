// Enterprise Data Capability Center — Semantic Object Catalog read RPCs.
// Spec: .kiro/specs/semantic-object-catalog/{design,tasks}.md (Task 6)
//
// Read-only. Tenant is resolved server-side (never client-forged), mirroring the
// enterprise-data-m6 handlers. Kept in a dedicated file (not enterprise-data-m6.ts)
// to avoid attribution conflicts on that owned file.

import { requireResolvedEnterpriseAdminTenantId } from "../enterprise-data/enterprise-data-seat-context.js";
import {
  findSemanticObject,
  findSemanticObjectByKey,
  listSemanticObjects,
  loadSemanticObjectStore,
} from "../enterprise-data/semantic-object-store.js";
import type {
  SemanticObjectKind,
  SemanticObjectLifecycle,
  SemanticObjectStore,
} from "../enterprise-data/semantic-object-types.js";
import { respondInvalid, respondUnavailable, stringValue } from "./billing-helpers.js";
import type { GatewayRequestHandlers } from "./types.js";

const SEMANTIC_OBJECT_KINDS: ReadonlySet<SemanticObjectKind> = new Set([
  "customer",
  "order",
  "product",
  "inventory",
  "employee",
  "contract",
  "invoice",
  "custom",
]);

const SEMANTIC_OBJECT_LIFECYCLES: ReadonlySet<SemanticObjectLifecycle> = new Set([
  "draft",
  "active",
  "deprecated",
]);

/**
 * @param deps.loadStore Injectable loader for tests; defaults to the on-disk store.
 */
export function createEnterpriseDataSemanticHandlers(deps?: {
  loadStore?: () => Promise<SemanticObjectStore>;
}): GatewayRequestHandlers {
  const loadStore = deps?.loadStore ?? (() => loadSemanticObjectStore());
  return {
    "enterprise-data.semantic-objects.list": async ({ client, params, respond }) => {
      const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
      if (!tenantId) {
        return;
      }
      try {
        const store = await loadStore();
        const kindRaw = stringValue(params.kind);
        const lifecycleRaw = stringValue(params.lifecycle);
        const objects = listSemanticObjects({
          store,
          tenantId,
          kind:
            kindRaw && SEMANTIC_OBJECT_KINDS.has(kindRaw as SemanticObjectKind)
              ? (kindRaw as SemanticObjectKind)
              : undefined,
          lifecycle:
            lifecycleRaw && SEMANTIC_OBJECT_LIFECYCLES.has(lifecycleRaw as SemanticObjectLifecycle)
              ? (lifecycleRaw as SemanticObjectLifecycle)
              : undefined,
        });
        respond(true, { tenantId, objects });
      } catch (error) {
        respondUnavailable(respond, error);
      }
    },

    "enterprise-data.semantic-objects.get": async ({ client, params, respond }) => {
      const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
      if (!tenantId) {
        return;
      }
      const objectId = stringValue(params.objectId);
      const objectKey = stringValue(params.objectKey);
      if (!objectId && !objectKey) {
        respondInvalid(respond, "objectId or objectKey is required");
        return;
      }
      try {
        const store = await loadStore();
        const object = objectId
          ? findSemanticObject(store, tenantId, objectId)
          : objectKey
            ? findSemanticObjectByKey(store, tenantId, objectKey)
            : null;
        if (!object) {
          respondInvalid(respond, "SemanticObject not found");
          return;
        }
        respond(true, { tenantId, object });
      } catch (error) {
        respondUnavailable(respond, error);
      }
    },
  };
}
