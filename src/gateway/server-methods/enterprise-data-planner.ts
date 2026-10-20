// Enterprise Data Capability Center — Agent Data Planner + Context Broker read RPCs.
// Spec: .kiro/specs/agent-data-planner/{design,tasks}.md (Task 7)
//
// Read-only. Resolves the CALLER'S OWN seat context server-side (never client-forged),
// then grounds the task intent in the semantic catalog + capability catalog + grants to
// produce an authorization-aware Data Plan (or full context pack). Kept in a dedicated
// file (not enterprise-data-m6.ts / enterprise-data.ts core) to avoid attribution
// conflicts on owned/shared files.

import type {
  DataPlanRequest,
  PlannerSeatContext,
} from "../enterprise-data/agent-data-plan-types.js";
import { buildAgentContextPack, planDataAccess } from "../enterprise-data/agent-data-planner.js";
import { resolveTrustedEnterpriseDataExecutionContext } from "../enterprise-data/enterprise-data-seat-context.js";
import { ensureEnterpriseDataCatalogSeeded } from "../enterprise-data/seeds.js";
import { loadSemanticObjectStore } from "../enterprise-data/semantic-object-store.js";
import type { SemanticObjectKind } from "../enterprise-data/semantic-object-types.js";
import { loadEnterpriseDataStore } from "../enterprise-data/store.js";
import type { DataClassification, EnterpriseDataStore } from "../enterprise-data/types.js";
import { resolveControlPlaneStorePathForClient } from "../tenant-context.js";
import { TENANT_ENTERPRISE_DATA_FILE } from "../tenant-store-paths.js";
import { respondInvalid, respondUnavailable, stringValue } from "./billing-helpers.js";
import type { GatewayClient, GatewayRequestHandlers } from "./types.js";

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

const DATA_CLASSIFICATIONS: ReadonlySet<DataClassification> = new Set([
  "PUBLIC",
  "INTERNAL",
  "CONFIDENTIAL",
  "RESTRICTED",
]);

function parseStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const items = value.filter((item): item is string => typeof item === "string" && item.length > 0);
  return items.length > 0 ? items : undefined;
}

function parseDataPlanRequest(params: Record<string, unknown>): DataPlanRequest {
  const objectKinds = parseStringArray(params.objectKinds)?.filter(
    (kind): kind is SemanticObjectKind => SEMANTIC_OBJECT_KINDS.has(kind as SemanticObjectKind),
  );
  const ceilingRaw = stringValue(params.classificationCeiling);
  const maxObjects = typeof params.maxObjects === "number" ? params.maxObjects : undefined;
  return {
    task: stringValue(params.task) || undefined,
    objectKeys: parseStringArray(params.objectKeys),
    objectKinds: objectKinds?.length ? objectKinds : undefined,
    classificationCeiling:
      ceilingRaw && DATA_CLASSIFICATIONS.has(ceilingRaw as DataClassification)
        ? (ceilingRaw as DataClassification)
        : undefined,
    includeInactive: params.includeInactive === true,
    maxObjects,
  };
}

/**
 * @param deps.loadEnterpriseStore Injectable enterprise-data store loader (tests).
 * @param deps.loadSemanticStore Injectable semantic object store loader (tests).
 * @param deps.resolveContext Injectable seat-context resolver; defaults to the trusted
 *   session resolver (caller's own seat).
 * @param deps.now Injectable clock (tests).
 */
export function createEnterpriseDataPlannerHandlers(deps?: {
  loadEnterpriseStore?: (client: GatewayClient | null) => Promise<EnterpriseDataStore>;
  loadSemanticStore?: () => Promise<Awaited<ReturnType<typeof loadSemanticObjectStore>>>;
  resolveContext?: (client: GatewayClient | null) => Promise<PlannerSeatContext>;
  now?: () => string;
}): GatewayRequestHandlers {
  const loadEnterpriseStore =
    deps?.loadEnterpriseStore ??
    (async (client: GatewayClient | null) =>
      loadEnterpriseDataStore(
        await resolveControlPlaneStorePathForClient(client, TENANT_ENTERPRISE_DATA_FILE),
      ));
  const loadSemanticStore = deps?.loadSemanticStore ?? (() => loadSemanticObjectStore());
  const resolveContext =
    deps?.resolveContext ??
    ((client: GatewayClient | null) => resolveTrustedEnterpriseDataExecutionContext(client));
  const now = deps?.now ?? (() => new Date().toISOString());

  async function resolveInputs(client: GatewayClient | null): Promise<{
    context: PlannerSeatContext;
    enterpriseStore: EnterpriseDataStore;
    semanticStore: Awaited<ReturnType<typeof loadSemanticObjectStore>>;
    nowIso: string;
  } | null> {
    let context: PlannerSeatContext;
    try {
      context = await resolveContext(client);
    } catch {
      return null;
    }
    const enterpriseStore = await loadEnterpriseStore(client);
    const nowIso = now();
    // Read-only path: seed only in-memory for a consistent catalog view, never persist.
    ensureEnterpriseDataCatalogSeeded({
      store: enterpriseStore,
      tenantId: context.tenantId,
      nowIso,
    });
    const semanticStore = await loadSemanticStore();
    return { context, enterpriseStore, semanticStore, nowIso };
  }

  return {
    "enterprise-data.planner.plan": async ({ client, params, respond }) => {
      const inputs = await resolveInputs(client);
      if (!inputs) {
        respondInvalid(respond, "No enterprise seat context resolved for the current session.");
        return;
      }
      try {
        const plan = planDataAccess({
          enterpriseStore: inputs.enterpriseStore,
          semanticStore: inputs.semanticStore,
          context: inputs.context,
          request: parseDataPlanRequest(params),
          nowIso: inputs.nowIso,
        });
        respond(true, { tenantId: inputs.context.tenantId, seatId: inputs.context.seatId, plan });
      } catch (error) {
        respondUnavailable(respond, error);
      }
    },

    "enterprise-data.planner.context": async ({ client, params, respond }) => {
      const inputs = await resolveInputs(client);
      if (!inputs) {
        respondInvalid(respond, "No enterprise seat context resolved for the current session.");
        return;
      }
      try {
        const contextPack = buildAgentContextPack({
          enterpriseStore: inputs.enterpriseStore,
          semanticStore: inputs.semanticStore,
          context: inputs.context,
          request: parseDataPlanRequest(params),
          nowIso: inputs.nowIso,
        });
        respond(true, {
          tenantId: inputs.context.tenantId,
          seatId: inputs.context.seatId,
          contextPack,
        });
      } catch (error) {
        respondUnavailable(respond, error);
      }
    },
  };
}
