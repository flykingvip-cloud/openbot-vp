import { buildExecutionPreflight } from "../../agents/execution-preflight/resolve.js";
import { isTruthyEnvValue } from "../../infra/env.js";
import { logWarn } from "../../logger.js";
import { recordCapabilityInvokeShadow } from "../governance/adapters/capability-invoke-adapter.js";
import {
  countCapabilityInvocations,
  recordCapabilityInvocation,
} from "../knowledge/capability-invocation-store.js";
import { listKnowledgeSourceBindings } from "../knowledge/sources/source-binding-store.js";
import type { GatewayClient } from "../server-methods/types.js";
import { resolveControlPlaneStorePathForClient } from "../tenant-context.js";
import { TENANT_ENTERPRISE_DATA_FILE } from "../tenant-store-paths.js";
import { isCapabilityGrantedForSeat } from "./capability-grant-resolver.js";
import { findDataCapability, listDataCapabilities } from "./data-capability-store.js";
import { listDataSources } from "./data-source-store.js";
import {
  resolveTrustedEnterpriseDataExecutionContext,
  type TrustedEnterpriseDataExecutionContext,
} from "./enterprise-data-seat-context.js";
import { parseEnterpriseDataSourceLocator } from "./kb-bound-source-fetch.js";
import { ensureEnterpriseDataCatalogSeeded } from "./seeds.js";
import { loadEnterpriseDataStore, saveEnterpriseDataStore } from "./store.js";
import type { EnterpriseDataStore } from "./types.js";

/**
 * Agent-facing capability catalog and a fail-closed invoke gate.
 *
 * EDGSC §5.4 / §12 red line 5: Agent Runtime consumes Knowledge Objects. It does
 * not request ConnectorAction. Employee execution stays on enterprise-data.invoke.
 * Supply stays on runProjectionMaterialization. This module must not import the
 * data gateway.
 *
 * `invokeDataCapabilityWithContext` still checks seat, grant, and quota, then
 * returns `knowledge-object-only` without fetching connector rows. Observe-only
 * preflight may record a trace when its flag is on; it never applies a tool allow-list.
 */

const DEFAULT_INVOCATION_QUOTA = 200;
const DEFAULT_QUOTA_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Observe-only. Unset/off keeps capability invoke on today's seat, grant, and
 * quota path. Truthy values match isTruthyEnvValue (1, true, yes, on).
 */
export const ENTERPRISE_CAPABILITY_INVOKE_PREFLIGHT_OBSERVE_ENV =
  "OPENBOT_ENTERPRISE_CAPABILITY_INVOKE_PREFLIGHT_OBSERVE";

export function isEnterpriseCapabilityInvokePreflightObserveEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isTruthyEnvValue(env[ENTERPRISE_CAPABILITY_INVOKE_PREFLIGHT_OBSERVE_ENV]);
}

/** Process-local trace key. Not a completion, ledger, or authorization id. */
export function enterpriseCapabilityInvokeObserveTaskId(params: {
  tenantId: string;
  seatId: string;
  capabilityId: string;
}): string {
  return `enterprise-capability-invoke:${params.tenantId}:${params.seatId}:${params.capabilityId}`;
}

function capabilityActionObserveName(ref: {
  connectorId: string;
  actionKey: string;
  version: string;
}): string {
  return `${ref.connectorId}.${ref.actionKey}@${ref.version}`;
}

function observeEnterpriseCapabilityInvokePreflight(params: {
  tenantId: string;
  seatId: string;
  capabilityId: string;
  actionNames: string[];
}): void {
  if (!isEnterpriseCapabilityInvokePreflightObserveEnabled()) {
    return;
  }
  try {
    // Record the existing preflight trace only. The returned tool set is unused.
    buildExecutionPreflight({
      taskId: enterpriseCapabilityInvokeObserveTaskId(params),
      sessionId: `${params.tenantId}:${params.seatId}`,
      message: params.capabilityId,
      skills: [],
      policyToolNames: params.actionNames,
      catalogToolNames: params.actionNames,
    });
  } catch (err) {
    logWarn(`enterprise-capability-invoke: observe preflight failed: ${String(err)}`);
  }
}

export type CapabilityDataAccessState = "granted" | "requestable" | "unknown";

export type CapabilityDataInvocationReason =
  | "not-authorized"
  | "not-found"
  | "disabled"
  | "no-tenant"
  | "no-seat"
  | "quota-exceeded"
  | "handler-error"
  | "knowledge-object-only";

/** One governed action result within a capability invocation. */
export type CapabilityDataActionResult = {
  connectorId: string;
  actionKey: string;
  version: string;
  ok: boolean;
  /** Governed, scope-filtered, masked data payload (present only when ok). */
  data?: unknown;
  recordCount?: number;
  scopeApplied?: string;
  maskedFields?: string[];
  /** Enterprise-data gateway trace id — the durable audit anchor for this action. */
  traceId: string;
  code?: string;
  message?: string;
};

export type CapabilityDataInvocationOutcome = {
  ok: boolean;
  capabilityId: string;
  accessState: CapabilityDataAccessState;
  reason?: CapabilityDataInvocationReason;
  title?: string;
  results?: CapabilityDataActionResult[];
  /** Capability-level audit ledger id. */
  auditId?: string;
};

export type AgentDataCapabilityListItem = {
  capabilityId: string;
  title: string;
  summary: string;
  sourceSystems: string[];
  accessState: CapabilityDataAccessState;
};

export type AgentDataCapabilityListing = {
  ok: boolean;
  reason?: "no-tenant" | "no-seat";
  tenantId?: string;
  seatId?: string;
  /** Present when the listing was filtered to a knowledge-base binding allowlist. */
  knowledgeBaseId?: string;
  boundSourceIds?: string[];
  capabilities: AgentDataCapabilityListItem[];
};

/**
 * Resolve enterprise-data sourceIds bound to a knowledge base (active external
 * endpoints only). Empty set means "no bound sources" — callers should treat
 * that as an empty allowlist when knowledgeBaseId was requested.
 */
export function resolveKnowledgeBaseBoundEnterpriseSourceIds(
  knowledgeBaseId: string,
  bindingsStorePath?: string,
): string[] {
  const kbId = knowledgeBaseId.trim();
  if (!kbId) {
    return [];
  }
  const sourceIds = new Set<string>();
  for (const binding of listKnowledgeSourceBindings({ knowledgeBaseId: kbId }, bindingsStorePath)) {
    if (binding.kind !== "external" && binding.kind !== "api" && binding.kind !== "capability") {
      continue;
    }
    const locator = parseEnterpriseDataSourceLocator(binding.endpoint);
    if (locator?.sourceId) {
      sourceIds.add(locator.sourceId);
    }
  }
  return [...sourceIds].toSorted();
}

function capabilityMatchesBoundSources(
  sourceIds: readonly string[],
  allowedSourceIds: ReadonlySet<string>,
): boolean {
  if (allowedSourceIds.size === 0) {
    return false;
  }
  return sourceIds.some((sourceId) => allowedSourceIds.has(sourceId));
}

/**
 * Opt-in governance shadow. Flag off returns the same object with no sink I/O.
 * The invoke result is the original outcome.
 */
function publishDataCapabilityInvokeShadow(
  outcome: CapabilityDataInvocationOutcome,
  ids: { tenantId?: string; seatId?: string; agentId?: string },
): CapabilityDataInvocationOutcome {
  const agentId = ids.agentId?.trim();
  void recordCapabilityInvokeShadow({
    outcome: {
      entry: "E11",
      ok: outcome.ok,
      reason: outcome.reason,
      capabilityId: outcome.capabilityId,
      auditId: outcome.auditId,
      tenantId: ids.tenantId,
      seatId: ids.seatId,
      ...(agentId ? { actorId: `agent:${agentId}` } : {}),
    },
  });
  return outcome;
}

/**
 * Core governed capability invoke over an already-resolved trusted context and
 * store. Kept context-injectable (no client / no persistence) so it is unit
 * testable with `createTrustedExecutionContextForTest` + a seeded store.
 */
export async function invokeDataCapabilityWithContext(params: {
  store: EnterpriseDataStore;
  context: TrustedEnterpriseDataExecutionContext;
  capabilityId: string;
  input?: Record<string, unknown>;
  nowIso: string;
  quotaLimit?: number;
  quotaWindowMs?: number;
  auditStorePath?: string;
}): Promise<CapabilityDataInvocationOutcome> {
  const { store, context } = params;
  const capabilityId = params.capabilityId.trim();
  const tenantId = context.tenantId;
  const seatId = context.seatId;
  const publish = (outcome: CapabilityDataInvocationOutcome) =>
    publishDataCapabilityInvokeShadow(outcome, {
      tenantId,
      seatId,
      agentId: context.agentId,
    });
  if (!tenantId) {
    return publish({ ok: false, capabilityId, accessState: "unknown", reason: "no-tenant" });
  }
  if (!seatId) {
    return publish({ ok: false, capabilityId, accessState: "unknown", reason: "no-seat" });
  }

  const capability = findDataCapability(store, tenantId, capabilityId);
  if (!capability) {
    return publish({ ok: false, capabilityId, accessState: "unknown", reason: "not-found" });
  }
  if (!capability.enabled) {
    return publish({
      ok: false,
      capabilityId,
      accessState: "unknown",
      reason: "disabled",
      title: capability.displayName,
    });
  }

  if (!isCapabilityGrantedForSeat({ store, context, capability })) {
    const denied = recordCapabilityInvocation(
      { tenantId, seatId, capabilityId, ok: false, reason: "not-authorized" },
      params.auditStorePath,
    );
    return publish({
      ok: false,
      capabilityId,
      accessState: "requestable",
      reason: "not-authorized",
      title: capability.displayName,
      auditId: denied.id,
    });
  }

  const quota = params.quotaLimit ?? DEFAULT_INVOCATION_QUOTA;
  const windowMs = params.quotaWindowMs ?? DEFAULT_QUOTA_WINDOW_MS;
  const used = countCapabilityInvocations(
    { tenantId, seatId, capabilityId, sinceMs: Date.now() - windowMs, okOnly: true },
    params.auditStorePath,
  );
  if (used >= quota) {
    const blocked = recordCapabilityInvocation(
      { tenantId, seatId, capabilityId, ok: false, reason: "quota-exceeded" },
      params.auditStorePath,
    );
    return publish({
      ok: false,
      capabilityId,
      accessState: "granted",
      reason: "quota-exceeded",
      title: capability.displayName,
      auditId: blocked.id,
    });
  }

  observeEnterpriseCapabilityInvokePreflight({
    tenantId,
    seatId,
    capabilityId,
    actionNames: capability.actionRefs.map(capabilityActionObserveName),
  });

  // Red line 5: do not request ConnectorAction. Supply materializes FeedItems;
  // employees execute through enterprise-data.invoke.
  const audit = recordCapabilityInvocation(
    { tenantId, seatId, capabilityId, ok: false, reason: "knowledge-object-only" },
    params.auditStorePath,
  );
  return publish({
    ok: false,
    capabilityId,
    accessState: "granted",
    reason: "knowledge-object-only",
    title: capability.displayName,
    auditId: audit.id,
  });
}

/**
 * Agent-facing governed invoke: resolves the trusted seat context from the
 * signed-in session, loads + persists the enterprise-data store (so audit rows
 * survive), and delegates to {@link invokeDataCapabilityWithContext}. The agentId
 * (when known) is stamped onto the execution context for audit attribution.
 */
export async function invokeDataCapabilityForAgent(params: {
  client: GatewayClient | null;
  capabilityId: string;
  input?: Record<string, unknown>;
  agentId?: string;
  /** When set, capability must intersect KB-bound enterprise-data sourceIds. */
  knowledgeBaseId?: string;
  bindingsStorePath?: string;
  quotaLimit?: number;
  quotaWindowMs?: number;
}): Promise<CapabilityDataInvocationOutcome> {
  const capabilityId = params.capabilityId.trim();
  let resolved: TrustedEnterpriseDataExecutionContext;
  try {
    resolved = await resolveTrustedEnterpriseDataExecutionContext(params.client);
  } catch {
    return publishDataCapabilityInvokeShadow(
      { ok: false, capabilityId, accessState: "unknown", reason: "no-seat" },
      {},
    );
  }
  const context: TrustedEnterpriseDataExecutionContext = params.agentId
    ? { ...resolved, agentId: params.agentId }
    : resolved;

  const storePath = await resolveControlPlaneStorePathForClient(
    params.client,
    TENANT_ENTERPRISE_DATA_FILE,
  );
  const store = await loadEnterpriseDataStore(storePath);
  const nowIso = new Date().toISOString();
  ensureEnterpriseDataCatalogSeeded({ store, tenantId: context.tenantId, nowIso });

  const knowledgeBaseId = params.knowledgeBaseId?.trim();
  if (knowledgeBaseId) {
    const boundSourceIds = new Set(
      resolveKnowledgeBaseBoundEnterpriseSourceIds(knowledgeBaseId, params.bindingsStorePath),
    );
    const capability = findDataCapability(store, context.tenantId, capabilityId);
    if (!capability || !capabilityMatchesBoundSources(capability.sourceIds, boundSourceIds)) {
      return publishDataCapabilityInvokeShadow(
        {
          ok: false,
          capabilityId,
          accessState: "unknown",
          reason: "not-authorized",
          title: capability?.displayName,
        },
        { tenantId: context.tenantId, seatId: context.seatId, agentId: context.agentId },
      );
    }
  }

  const outcome = await invokeDataCapabilityWithContext({
    store,
    context,
    capabilityId,
    input: params.input,
    nowIso,
    quotaLimit: params.quotaLimit,
    quotaWindowMs: params.quotaWindowMs,
  });
  // Always persist to the same path we loaded (tenant control-plane when MT=1).
  await saveEnterpriseDataStore(store, storePath);
  return outcome;
}

/**
 * Agent-facing catalog listing: the enabled data capabilities visible to the
 * signed-in seat, each tagged with whether the seat is already authorized
 * (`granted`) or must request access (`requestable`). Read-only.
 */
export async function listDataCapabilitiesForAgent(params: {
  client: GatewayClient | null;
  /** When set, only capabilities intersecting KB-bound enterprise-data sourceIds. */
  knowledgeBaseId?: string;
  bindingsStorePath?: string;
}): Promise<AgentDataCapabilityListing> {
  let context: TrustedEnterpriseDataExecutionContext;
  try {
    context = await resolveTrustedEnterpriseDataExecutionContext(params.client);
  } catch {
    return { ok: false, reason: "no-seat", capabilities: [] };
  }

  const store = await loadEnterpriseDataStore(
    await resolveControlPlaneStorePathForClient(params.client, TENANT_ENTERPRISE_DATA_FILE),
  );
  const nowIso = new Date().toISOString();
  // Read-only path (runs on every inbound message when building the prompt hint):
  // seed only in-memory for a consistent catalog view, never persist here. The
  // invoke path owns seeding + persistence.
  ensureEnterpriseDataCatalogSeeded({ store, tenantId: context.tenantId, nowIso });

  const knowledgeBaseId = params.knowledgeBaseId?.trim() || undefined;
  const boundSourceIds = knowledgeBaseId
    ? resolveKnowledgeBaseBoundEnterpriseSourceIds(knowledgeBaseId, params.bindingsStorePath)
    : undefined;
  const allowedSourceIds = boundSourceIds ? new Set(boundSourceIds) : null;

  const sourcesById = new Map(
    listDataSources({ store, tenantId: context.tenantId }).map((source) => [
      source.sourceId,
      source,
    ]),
  );
  const capabilities = listDataCapabilities({
    store,
    tenantId: context.tenantId,
    enabled: true,
  })
    .filter((capability) =>
      allowedSourceIds
        ? capabilityMatchesBoundSources(capability.sourceIds, allowedSourceIds)
        : true,
    )
    .map((capability) => {
      const granted = isCapabilityGrantedForSeat({ store, context, capability });
      const sourceSystems = capability.sourceIds
        .map((sourceId) => sourcesById.get(sourceId)?.displayName)
        .filter((value): value is string => Boolean(value));
      return {
        capabilityId: capability.capabilityId,
        title: capability.displayName,
        summary: capability.description,
        sourceSystems,
        accessState: (granted ? "granted" : "requestable") as CapabilityDataAccessState,
      };
    });

  return {
    ok: true,
    tenantId: context.tenantId,
    seatId: context.seatId,
    ...(knowledgeBaseId ? { knowledgeBaseId, boundSourceIds } : {}),
    capabilities,
  };
}

/** Max capability lines to inject into the agent prompt (guards prompt bloat). */
const MAX_PROMPT_CAPABILITIES = 12;

/**
 * Format the seat's data-capability catalog into a compact system-prompt hint.
 * The catalog is orientation only. Agent Runtime must consume Knowledge Objects
 * and must not invoke ConnectorAction. Returns undefined when there is nothing
 * to surface (no seat / no enabled capabilities).
 */
export function formatAgentDataCapabilityRuntimePrompt(
  listing: AgentDataCapabilityListing,
): string | undefined {
  if (!listing.ok || listing.capabilities.length === 0) {
    return undefined;
  }
  const granted = listing.capabilities.filter((item) => item.accessState === "granted");
  const requestable = listing.capabilities.filter((item) => item.accessState === "requestable");
  const lines: string[] = [];
  for (const capability of granted) {
    if (lines.length >= MAX_PROMPT_CAPABILITIES) {
      break;
    }
    const sources = capability.sourceSystems.length
      ? `, sources=${capability.sourceSystems.join("/")}`
      : "";
    lines.push(
      `- ${capability.title} (capabilityId=${capability.capabilityId}${sources}): authorized`,
    );
  }
  for (const capability of requestable) {
    if (lines.length >= MAX_PROMPT_CAPABILITIES) {
      break;
    }
    lines.push(
      `- ${capability.title} (capabilityId=${capability.capabilityId}): not yet authorized — ask the user to request access in the workbench`,
    );
  }
  if (lines.length === 0) {
    return undefined;
  }
  const kbScope =
    listing.knowledgeBaseId && listing.boundSourceIds
      ? [
          `Current knowledge-space scope: knowledgeBaseId=${listing.knowledgeBaseId}. Only capabilities bound to this space's external sources are listed (boundSourceIds=${listing.boundSourceIds.join(",") || "none"}). Stay inside that allowlist. Use action=list with knowledgeBaseId set. Do not invoke connector actions.`,
        ]
      : [];
  return [
    "Enterprise data capabilities (catalog only — never fabricate or guess this data, and never request ConnectorAction):",
    ...kbScope,
    ...lines,
    "Agent Runtime consumes Knowledge Objects (knowledge search or knowledge.cognitive.bundle). `data_capability` action=invoke is closed and returns knowledge-object-only. action=list refreshes this catalog. Employee execution remains enterprise-data.invoke; supply remains ProjectionMaterializer.",
    "If a needed capability is not yet authorized, tell the user to request access in the workbench instead of inventing values.",
  ].join("\n");
}
