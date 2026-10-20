/**
 * mappers.ts — explicit conversions between Fabric contract types and the
 * internal types of the subsystems (Loom / AOR / TOL).
 *
 * Decoupling rule (R1.5, R14.5): subsystem-internal types are converted here
 * into Fabric-side shapes; they NEVER leak as Fabric public contract fields.
 *  - Loom is consumed via a stable Fabric-side read interface (no src→scripts
 *    coupling); attribution is mapped at COMPILE TIME into ownership metadata +
 *    a decisionTrace entry (Loom = compile-time metadata only, Rule #3).
 *  - AOR `AorAuditRecord` is projected into a narrow Fabric cost view.
 *
 * Design: `.kiro/specs/openbot-fabric/design.md` §3.1/§3.3.
 */

import type { AorAuditRecord, TenantContext } from "@openbot/aor-core";
import type {
  DecisionTraceEntry,
  ExecutionConstraints,
  PolicyDecision,
  ToolRequest,
} from "./contract.js";

// ─────────────────────────────────────────────────────────────────────────────
// PolicyDecision → ExecutionConstraints
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract the effective execution constraints from a decision. ALLOW may carry
 * optional constraints; MODIFY always carries them; DENY has none (never runs).
 */
export function constraintsFromDecision(
  decision: PolicyDecision,
): ExecutionConstraints | undefined {
  if (decision.decision === "ALLOW") {
    return decision.constraints;
  }
  if (decision.decision === "MODIFY") {
    return decision.constraints;
  }
  return undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// ToolRequest.source → AOR TenantContext (R6.3, R10)
// ─────────────────────────────────────────────────────────────────────────────

/** Build an AOR tenant context from a Fabric request source. */
export function tenantContextFromSource(source: ToolRequest["source"]): TenantContext {
  const ctx: TenantContext = {};
  if (source.userId) {
    ctx.userId = source.userId;
  }
  if (source.tenantId) {
    ctx.tenantId = source.tenantId;
  }
  return ctx;
}

// ─────────────────────────────────────────────────────────────────────────────
// Loom attribution (compile-time) → ownership metadata + decisionTrace
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Stable Fabric-side read interface for Loom attribution. Fabric depends on
 * THIS shape, not on `scripts/loom/*` types, so there is no src→scripts
 * coupling and Loom can evolve independently. A caller (Policy Runtime) adapts
 * the real Loom output into this shape at compile time.
 */
export interface LoomAttribution {
  owner?: string;
  agent?: string;
  taskId?: string;
  /** Loom static rule ids that matched (for matchedRules / explainability). */
  matchedRules?: string[];
  /** >1 owner matched a path. */
  conflict?: boolean;
  /** No owner matched (identity unrecoverable). */
  unattributed?: boolean;
}

/** Fabric-side ownership view embedded in ExecutionGraphState.context.ownership. */
export interface OwnershipMetadata {
  owner?: string;
  agent?: string;
  taskId?: string;
  conflict: boolean;
  unattributed: boolean;
}

/** Project Loom attribution into Fabric ownership metadata (who). */
export function attributionToOwnership(attr: LoomAttribution): OwnershipMetadata {
  return {
    owner: attr.owner,
    agent: attr.agent,
    taskId: attr.taskId,
    conflict: attr.conflict ?? false,
    unattributed: attr.unattributed ?? false,
  };
}

/** Build the `loom.attribution` decisionTrace entry from attribution. */
export function attributionTraceEntry(attr: LoomAttribution): DecisionTraceEntry {
  const hit = Boolean(attr.owner) && !attr.unattributed;
  const detail = attr.unattributed
    ? "unattributed (no owner matched)"
    : attr.conflict
      ? `conflict: multiple owners matched`
      : attr.owner
        ? `owner=${attr.owner}${attr.taskId ? ` task=${attr.taskId}` : ""}`
        : "no attribution";
  // Attribution is informational input, never the deciding effect by itself.
  return { stage: "loom.attribution", hit, detail, effect: "neutral" };
}

// ─────────────────────────────────────────────────────────────────────────────
// AOR AorAuditRecord → narrow Fabric cost view (no leak of AOR internals)
// ─────────────────────────────────────────────────────────────────────────────

/** The only AOR-derived fields Fabric surfaces in its audit records. */
export interface FabricCostView {
  runId: string;
  occurredAt: string;
  model: string;
  totalTokens: number;
  costUsd?: number;
  latencyMs: number;
}

/** Project an AOR audit record into the narrow Fabric cost view. */
export function fromAorAuditRecord(record: AorAuditRecord): FabricCostView {
  return {
    runId: record.runId,
    occurredAt: record.occurredAt,
    model: record.selection.model,
    totalTokens: record.totalTokens,
    costUsd: record.totalCostUsd,
    latencyMs: record.latencyMs,
  };
}
