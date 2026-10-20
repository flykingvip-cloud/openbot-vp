/**
 * cost.ts — cost tracking + costLimit enforcement (R11).
 *
 * Reuses the existing billing/usage pipeline via an injected `UsageIngestPort`
 * (mapped onto the gateway `usage-ingest` / AOR `billing-ingest`); Fabric does
 * NOT build its own billing engine (R11.3). It only:
 *  - decides, at compile time, whether an estimated cost exceeds a constraint's
 *    `costLimit` (so the pipeline can DENY/abort, R11.2), and
 *  - reports the actual spend of a completed execution to the usage port (R11.1).
 *
 * Design: `.kiro/specs/openbot-fabric/design.md` §3.10.
 */

import type { ExecutionConstraints, ToolExecutionResult, ToolRequest } from "./contract.js";

/** Narrow port onto the existing usage/billing ingest (no new billing engine). */
export interface UsageIngestPort {
  ingest(usage: FabricUsage): Promise<void> | void;
}

/** A single usage event reported after execution. */
export interface FabricUsage {
  correlationId: string;
  sessionId: string;
  tenantId?: string;
  userId?: string;
  tool: string;
  costUsd: number;
  occurredAt: string;
}

/**
 * Whether an estimated cost exceeds the decision's costLimit. Returns true when
 * a limit is set AND the estimate meets/exceeds it (the pipeline should then
 * deny or abort). No limit ⇒ never over.
 */
export function exceedsCostLimit(
  constraints: ExecutionConstraints | undefined,
  estimatedCostUsd: number,
): boolean {
  const limit = constraints?.costLimit;
  return typeof limit === "number" && estimatedCostUsd >= limit;
}

/** Build a usage event from a completed execution + its actual spend. */
export function buildUsage(
  request: ToolRequest,
  result: ToolExecutionResult,
  costUsd: number,
  occurredAt: string = new Date().toISOString(),
): FabricUsage {
  return {
    correlationId: request.trace.correlationId,
    sessionId: request.trace.sessionId,
    tenantId: request.source.tenantId,
    userId: request.source.userId,
    tool: request.tool.name,
    costUsd,
    occurredAt,
  };
}

/**
 * Report actual spend to the usage port. Best-effort: ingest failures never
 * break the caller (cost reporting must not fail an otherwise-complete run).
 */
export async function reportUsage(
  port: UsageIngestPort,
  usage: FabricUsage,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await port.ingest(usage);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
