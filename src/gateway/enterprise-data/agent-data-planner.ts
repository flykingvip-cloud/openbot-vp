// Agent Data Planner + Context Broker — core.
// Spec: .kiro/specs/agent-data-planner/{requirements,design,tasks}.md
//
// The missing "task → query the metadata catalog → generate an authorized Data Plan"
// step. Given a task intent and a resolved seat context, planDataAccess grounds the
// intent in the Semantic Object Catalog + Data Capability Catalog + seat grants and
// produces an authorization-aware fetch plan (WHAT to fetch). It NEVER executes a
// connector action. executeDataPlan delegates to invokeDataCapabilityWithContext,
// which fail-closes with knowledge-object-only. The Context Broker
// (buildAgentContextPack) bundles identity + plan + authorized capabilities +
// relevant knowledge projections for one agent turn.

import type { GatewayClient } from "../server-methods/types.js";
import { resolveControlPlaneStorePathForClient } from "../tenant-context.js";
import { TENANT_ENTERPRISE_DATA_FILE } from "../tenant-store-paths.js";
import type {
  AgentContextCapabilityRef,
  AgentContextIdentity,
  AgentContextPack,
  AgentKnowledgeProjectionRef,
  DataPlan,
  DataPlanFieldSelection,
  DataPlanRequest,
  DataPlanStep,
  DataPlanSummary,
  DataPlanUnresolvedReason,
  PlannerSeatContext,
} from "./agent-data-plan-types.js";
import {
  type CapabilityDataInvocationOutcome,
  invokeDataCapabilityWithContext,
} from "./capability-agent-invoke-runtime.js";
import { isCapabilityGrantedForSeat } from "./capability-grant-resolver.js";
import { findDataCapability, listDataCapabilities } from "./data-capability-store.js";
import { listDataSources } from "./data-source-store.js";
import {
  resolveTrustedEnterpriseDataExecutionContext,
  type TrustedEnterpriseDataExecutionContext,
} from "./enterprise-data-seat-context.js";
import { listEnterpriseKnowledgeProjectionSpecs } from "./projection-spec-store.js";
import { ensureEnterpriseDataCatalogSeeded } from "./seeds.js";
import { listSemanticObjects, loadSemanticObjectStore } from "./semantic-object-store.js";
import type {
  SemanticObject,
  SemanticObjectSourceBinding,
  SemanticObjectStore,
} from "./semantic-object-types.js";
import { loadEnterpriseDataStore } from "./store.js";
import {
  buildConnectorActionRefKey,
  type DataCapability,
  type DataClassification,
  type EnterpriseDataStore,
  type EnterpriseKnowledgeProjectionCategory,
} from "./types.js";

const CLASSIFICATION_RANK: Record<DataClassification, number> = {
  PUBLIC: 0,
  INTERNAL: 1,
  CONFIDENTIAL: 2,
  RESTRICTED: 3,
};

/** Default ceiling keeps all non-RESTRICTED fields (R4.2). */
const DEFAULT_CLASSIFICATION_CEILING: DataClassification = "CONFIDENTIAL";

/** Semantic object kind → knowledge projection category, for context-pack relevance. */
const OBJECT_KIND_TO_PROJECTION_CATEGORY: Partial<
  Record<SemanticObject["kind"], EnterpriseKnowledgeProjectionCategory>
> = {
  customer: "customer",
  order: "sales",
  product: "inventory",
  inventory: "inventory",
  contract: "finance",
  invoice: "finance",
};

// ─────────────────────────────────────────────────────────────────────────────
// Relevance (D2 — deterministic, hint-driven; no hidden LLM)
// ─────────────────────────────────────────────────────────────────────────────

/** True when the task text mentions the object (by key/name/kind or any field name). */
function objectMatchesTask(object: SemanticObject, taskLower: string): boolean {
  const needles = [
    object.objectKey,
    object.displayName,
    object.kind,
    ...object.fields.flatMap((field) => [field.fieldKey, field.displayName]),
  ];
  return needles.some((needle) => needle.length > 0 && taskLower.includes(needle.toLowerCase()));
}

function resolveRelevantObjects(
  store: SemanticObjectStore,
  tenantId: string,
  request: DataPlanRequest,
): SemanticObject[] {
  let objects = listSemanticObjects({
    store,
    tenantId,
    lifecycle: request.includeInactive ? undefined : "active",
  });
  if (request.objectKeys?.length) {
    const wanted = new Set(request.objectKeys);
    objects = objects.filter((object) => wanted.has(object.objectKey));
  } else if (request.objectKinds?.length) {
    const wanted = new Set(request.objectKinds);
    objects = objects.filter((object) => wanted.has(object.kind));
  } else if (request.task?.trim()) {
    const taskLower = request.task.toLowerCase();
    objects = objects.filter((object) => objectMatchesTask(object, taskLower));
  }
  if (request.maxObjects != null && request.maxObjects >= 0) {
    objects = objects.slice(0, request.maxObjects);
  }
  return objects;
}

// ─────────────────────────────────────────────────────────────────────────────
// Field selection (D4 — respects classification)
// ─────────────────────────────────────────────────────────────────────────────

function selectFields(object: SemanticObject, ceilingRank: number): DataPlanFieldSelection[] {
  return object.fields
    .filter(
      (field) =>
        field.classification == null || CLASSIFICATION_RANK[field.classification] <= ceilingRank,
    )
    .map((field) => ({
      fieldKey: field.fieldKey,
      displayName: field.displayName,
      type: field.type,
      classification: field.classification,
      referenceObjectKey: field.referenceObjectKey,
    }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Capability binding resolution (D3 — semantic object → executable capability)
// ─────────────────────────────────────────────────────────────────────────────

type ResolvedObjectCapability =
  | { binding: SemanticObjectSourceBinding; capability: DataCapability }
  | { reason: DataPlanUnresolvedReason };

/**
 * Resolve the capability that supplies a semantic object. Prefers the object's
 * primary binding, then explicit binding.capabilityId, then an enabled capability
 * whose actionRefs contain the binding's action. Surfaces (never hides) objects that
 * have no binding or no resolvable capability.
 */
function resolveObjectCapability(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  object: SemanticObject;
  enabledCapabilities: DataCapability[];
}): ResolvedObjectCapability {
  const bindings = params.object.sourceBindings;
  if (bindings.length === 0) {
    return { reason: "no-binding" };
  }
  // Primary binding wins when multiple sources supply the object.
  const ordered = [...bindings].toSorted(
    (left, right) => Number(Boolean(right.primary)) - Number(Boolean(left.primary)),
  );
  let sawDisabled = false;
  for (const binding of ordered) {
    if (binding.capabilityId) {
      const capability = findDataCapability(params.store, params.tenantId, binding.capabilityId);
      if (capability?.enabled) {
        return { binding, capability };
      }
      if (capability && !capability.enabled) {
        sawDisabled = true;
      }
      continue;
    }
    const actionKey = buildConnectorActionRefKey(binding.action);
    const capability = params.enabledCapabilities.find((candidate) =>
      candidate.actionRefs.some((ref) => buildConnectorActionRefKey(ref) === actionKey),
    );
    if (capability) {
      return { binding, capability };
    }
  }
  return { reason: sawDisabled ? "capability-disabled" : "no-capability" };
}

function summarizePlan(steps: DataPlanStep[]): DataPlanSummary {
  const resolved = steps.filter((step) => step.status === "resolved");
  return {
    totalObjects: steps.length,
    resolved: resolved.length,
    granted: resolved.filter((step) => step.accessState === "granted").length,
    requestable: resolved.filter((step) => step.accessState === "requestable").length,
    unresolved: steps.length - resolved.length,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Planner core (pure, context-injectable)
// ─────────────────────────────────────────────────────────────────────────────

export type PlanDataAccessParams = {
  enterpriseStore: EnterpriseDataStore;
  semanticStore: SemanticObjectStore;
  context: PlannerSeatContext;
  request?: DataPlanRequest;
  nowIso: string;
};

/**
 * Produce an authorization-aware Data Plan for a seat. Pure — no I/O, no execution.
 * Every resolved step is tagged granted/requestable via the shared grant resolver;
 * unresolved objects are surfaced with a reason rather than dropped.
 */
export function planDataAccess(params: PlanDataAccessParams): DataPlan {
  const { enterpriseStore, semanticStore, context, nowIso } = params;
  const request = params.request ?? {};
  const relevant = resolveRelevantObjects(semanticStore, context.tenantId, request);
  const enabledCapabilities = listDataCapabilities({
    store: enterpriseStore,
    tenantId: context.tenantId,
    enabled: true,
  });
  const ceilingRank =
    CLASSIFICATION_RANK[request.classificationCeiling ?? DEFAULT_CLASSIFICATION_CEILING];

  const steps: DataPlanStep[] = relevant.map((object) => {
    const fields = selectFields(object, ceilingRank);
    const base = {
      objectKey: object.objectKey,
      objectKind: object.kind,
      displayName: object.displayName,
      fields,
    };
    const resolved = resolveObjectCapability({
      store: enterpriseStore,
      tenantId: context.tenantId,
      object,
      enabledCapabilities,
    });
    if ("reason" in resolved) {
      return {
        ...base,
        status: resolved.reason === "no-binding" ? "unbindable" : "no-capability",
        reason: resolved.reason,
        note:
          resolved.reason === "no-binding"
            ? "该规范对象尚未绑定任何数据源（source binding），无法取数。"
            : resolved.reason === "capability-disabled"
              ? "该对象绑定的数据能力当前被禁用。"
              : "未找到可解析该对象的启用数据能力。",
      };
    }
    const { capability, binding } = resolved;
    const granted = isCapabilityGrantedForSeat({ store: enterpriseStore, context, capability });
    return {
      ...base,
      status: "resolved",
      capabilityId: capability.capabilityId,
      capabilityKey: capability.capabilityKey,
      capabilityTitle: capability.displayName,
      accessState: granted ? "granted" : "requestable",
      bindingId: binding.bindingId,
      sourceIds: [...capability.sourceIds],
      actionRefs: capability.actionRefs.map((ref) => ({ ...ref })),
    };
  });

  return {
    tenantId: context.tenantId,
    seatId: context.seatId,
    taskHint: request.task?.trim() || undefined,
    createdAt: nowIso,
    steps,
    summary: summarizePlan(steps),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Context Broker (D5 of the plan — identity + plan + capabilities + knowledge)
// ─────────────────────────────────────────────────────────────────────────────

function toIdentity(context: PlannerSeatContext): AgentContextIdentity {
  return {
    tenantId: context.tenantId,
    seatId: context.seatId,
    employeeId: context.employeeId,
    roleCode: context.roleCode,
    departmentId: context.departmentId,
    teamLabel: context.teamLabel,
    agentId: context.agentId,
  };
}

/** Granted capabilities the plan touches, with their source-system display names. */
function collectAuthorizedCapabilities(params: {
  enterpriseStore: EnterpriseDataStore;
  tenantId: string;
  plan: DataPlan;
}): AgentContextCapabilityRef[] {
  const sourceNameById = new Map(
    listDataSources({ store: params.enterpriseStore, tenantId: params.tenantId }).map((source) => [
      source.sourceId,
      source.displayName,
    ]),
  );
  const byCapabilityId = new Map<string, AgentContextCapabilityRef>();
  for (const step of params.plan.steps) {
    if (
      step.status !== "resolved" ||
      step.accessState !== "granted" ||
      !step.capabilityId ||
      byCapabilityId.has(step.capabilityId)
    ) {
      continue;
    }
    byCapabilityId.set(step.capabilityId, {
      capabilityId: step.capabilityId,
      capabilityKey: step.capabilityKey ?? step.capabilityId,
      title: step.capabilityTitle ?? step.capabilityKey ?? step.capabilityId,
      accessState: "granted",
      sourceSystems: (step.sourceIds ?? [])
        .map((sourceId) => sourceNameById.get(sourceId))
        .filter((name): name is string => Boolean(name)),
    });
  }
  return [...byCapabilityId.values()];
}

/** Knowledge projection specs whose category matches the plan's object kinds. */
function collectKnowledgeProjections(params: {
  enterpriseStore: EnterpriseDataStore;
  tenantId: string;
  plan: DataPlan;
}): AgentKnowledgeProjectionRef[] {
  const categories = new Set<EnterpriseKnowledgeProjectionCategory>();
  for (const step of params.plan.steps) {
    const category = OBJECT_KIND_TO_PROJECTION_CATEGORY[step.objectKind];
    if (category) {
      categories.add(category);
    }
  }
  if (categories.size === 0) {
    return [];
  }
  return listEnterpriseKnowledgeProjectionSpecs({
    store: params.enterpriseStore,
    tenantId: params.tenantId,
  })
    .filter((spec) => categories.has(spec.category))
    .map((spec) => ({
      projectionId: spec.projectionId,
      projectionKey: spec.projectionKey,
      displayName: spec.displayName,
      category: spec.category,
      objectKind: spec.objectKind,
      lifecycle: spec.lifecycle,
    }));
}

/**
 * Assemble the authorized context bundle for one agent turn: identity + data plan +
 * granted capabilities + relevant knowledge-projection references. Pure — no execution.
 */
export function buildAgentContextPack(params: PlanDataAccessParams): AgentContextPack {
  const dataPlan = planDataAccess(params);
  return {
    identity: toIdentity(params.context),
    dataPlan,
    authorizedCapabilities: collectAuthorizedCapabilities({
      enterpriseStore: params.enterpriseStore,
      tenantId: params.context.tenantId,
      plan: dataPlan,
    }),
    knowledgeProjections: collectKnowledgeProjections({
      enterpriseStore: params.enterpriseStore,
      tenantId: params.context.tenantId,
      plan: dataPlan,
    }),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Optional execution — delegates to the W5 bridge (never re-implements invoke)
// ─────────────────────────────────────────────────────────────────────────────

export type DataPlanStepExecution = {
  objectKey: string;
  capabilityId?: string;
  executed: boolean;
  /** Reason the step was skipped (unresolved or not granted). */
  skippedReason?: "unresolved" | "requestable";
  outcome?: CapabilityDataInvocationOutcome;
};

export type DataPlanExecution = {
  tenantId: string;
  seatId: string;
  executedAt: string;
  results: DataPlanStepExecution[];
};

/**
 * Attempt granted plan steps through the agent capability gate. The gate does not
 * request ConnectorAction; granted steps come back knowledge-object-only.
 * Unresolved or merely-requestable steps are reported as skipped.
 */
export async function executeDataPlan(params: {
  store: EnterpriseDataStore;
  context: TrustedEnterpriseDataExecutionContext;
  plan: DataPlan;
  nowIso: string;
  input?: Record<string, unknown>;
  quotaLimit?: number;
  quotaWindowMs?: number;
}): Promise<DataPlanExecution> {
  const results: DataPlanStepExecution[] = [];
  for (const step of params.plan.steps) {
    if (step.status !== "resolved" || !step.capabilityId) {
      results.push({ objectKey: step.objectKey, executed: false, skippedReason: "unresolved" });
      continue;
    }
    if (step.accessState !== "granted") {
      results.push({
        objectKey: step.objectKey,
        capabilityId: step.capabilityId,
        executed: false,
        skippedReason: "requestable",
      });
      continue;
    }
    const outcome = await invokeDataCapabilityWithContext({
      store: params.store,
      context: params.context,
      capabilityId: step.capabilityId,
      input: params.input,
      nowIso: params.nowIso,
      quotaLimit: params.quotaLimit,
      quotaWindowMs: params.quotaWindowMs,
    });
    results.push({
      objectKey: step.objectKey,
      capabilityId: step.capabilityId,
      executed: true,
      outcome,
    });
  }
  return {
    tenantId: params.plan.tenantId,
    seatId: params.plan.seatId,
    executedAt: params.nowIso,
    results,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent-facing wrappers — resolve the signed-in seat, read stores (no persistence)
// ─────────────────────────────────────────────────────────────────────────────

export type PlanForAgentResult = { ok: true; plan: DataPlan } | { ok: false; reason: "no-seat" };

export type ContextPackForAgentResult =
  | { ok: true; contextPack: AgentContextPack }
  | { ok: false; reason: "no-seat" };

async function resolveAgentPlanningInputs(params: {
  client: GatewayClient | null;
  agentId?: string;
}): Promise<{
  context: TrustedEnterpriseDataExecutionContext;
  enterpriseStore: EnterpriseDataStore;
  semanticStore: SemanticObjectStore;
  nowIso: string;
} | null> {
  let resolved: TrustedEnterpriseDataExecutionContext;
  try {
    resolved = await resolveTrustedEnterpriseDataExecutionContext(params.client);
  } catch {
    return null;
  }
  const context = params.agentId ? { ...resolved, agentId: params.agentId } : resolved;
  const enterpriseStore = await loadEnterpriseDataStore(
    await resolveControlPlaneStorePathForClient(params.client, TENANT_ENTERPRISE_DATA_FILE),
  );
  const nowIso = new Date().toISOString();
  // Read-only path: seed only in-memory for a consistent catalog view, never persist.
  ensureEnterpriseDataCatalogSeeded({ store: enterpriseStore, tenantId: context.tenantId, nowIso });
  const semanticStore = await loadSemanticObjectStore();
  return { context, enterpriseStore, semanticStore, nowIso };
}

/** The signed-in seat's Data Plan for a task. Read-only. */
export async function planDataAccessForAgent(params: {
  client: GatewayClient | null;
  request?: DataPlanRequest;
  agentId?: string;
}): Promise<PlanForAgentResult> {
  const inputs = await resolveAgentPlanningInputs(params);
  if (!inputs) {
    return { ok: false, reason: "no-seat" };
  }
  const plan = planDataAccess({
    enterpriseStore: inputs.enterpriseStore,
    semanticStore: inputs.semanticStore,
    context: inputs.context,
    request: params.request,
    nowIso: inputs.nowIso,
  });
  return { ok: true, plan };
}

/** The signed-in seat's authorized context pack for a task. Read-only. */
export async function buildAgentContextPackForAgent(params: {
  client: GatewayClient | null;
  request?: DataPlanRequest;
  agentId?: string;
}): Promise<ContextPackForAgentResult> {
  const inputs = await resolveAgentPlanningInputs(params);
  if (!inputs) {
    return { ok: false, reason: "no-seat" };
  }
  const contextPack = buildAgentContextPack({
    enterpriseStore: inputs.enterpriseStore,
    semanticStore: inputs.semanticStore,
    context: inputs.context,
    request: params.request,
    nowIso: inputs.nowIso,
  });
  return { ok: true, contextPack };
}
