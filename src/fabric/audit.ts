/**
 * audit.ts — Fabric execution audit records: who/why/what/where + decision +
 * trace + cost, queryable and JSON-exportable (R9).
 *
 * Reuses the AOR cost view (`fromAorAuditRecord`) and is designed to sit on top
 * of `control-plane-audit.ts` (gateway) as the store; this module owns the
 * Fabric-facing record shape, redaction, the replay INPUT SNAPSHOT, and
 * tenant/session/correlation queries.
 *
 * Redaction (R9.5): env/args secret values are referenced by KEY NAME only; the
 * record never carries plaintext credentials. The record also carries enough
 * input to re-run the decision (replay snapshot, R17.1) — see `replay.ts`.
 *
 * Design: `.kiro/specs/openbot-fabric/design.md` §3.7.
 */

import type { PolicyDecision, ToolExecutionResult, ToolRequest } from "./contract.js";
import type { OwnershipMetadata } from "./mappers.js";
import type { PolicyInputs } from "./policy-runtime.js";

/** Heuristic: env/arg keys whose VALUES must never be stored. */
const SECRET_KEY_PATTERN =
  /(token|secret|password|passwd|api[_-]?key|credential|auth|cookie|session[_-]?key)/i;

/** Replace secret-looking values with a `[redacted:<key>]` reference (R9.5). */
export function redactEnv(
  env: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!env) {
    return undefined;
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    out[key] = SECRET_KEY_PATTERN.test(key) ? `[redacted:${key}]` : value;
  }
  return out;
}

/** Redact `--token=xyz` / `--secret xyz` style argv values, keeping flag names. */
export function redactArgs(args: string[] | undefined): string[] | undefined {
  if (!args) {
    return undefined;
  }
  return args.map((arg) => {
    const eq = arg.indexOf("=");
    if (arg.startsWith("--") && eq > 0) {
      const flag = arg.slice(2, eq);
      if (SECRET_KEY_PATTERN.test(flag)) {
        return `--${flag}=[redacted]`;
      }
    }
    return arg;
  });
}

/** A redacted snapshot of the request sufficient to re-decide (replay, R17.1). */
export interface RequestSnapshot {
  id: string;
  source: ToolRequest["source"];
  tool: ToolRequest["tool"];
  input: { args?: string[]; cwd?: string; env?: Record<string, string> };
  context: ToolRequest["context"];
  trace: ToolRequest["trace"];
}

/** Build a redacted request snapshot (no plaintext secrets). */
export function snapshotRequest(req: ToolRequest): RequestSnapshot {
  return {
    id: req.id,
    source: req.source,
    tool: req.tool,
    input: { args: redactArgs(req.input.args), cwd: req.input.cwd, env: redactEnv(req.input.env) },
    context: req.context,
    trace: req.trace,
  };
}

/** Immutable Fabric execution audit record (who/why/what/where + decision + cost). */
export interface FabricExecutionRecord {
  /** Correlation/trace identity. */
  correlationId: string;
  sessionId: string;
  taskId?: string;
  tenantId?: string;
  /** who: source + ownership (Loom-derived, compile-time). */
  who: { source: ToolRequest["source"]; ownership?: OwnershipMetadata };
  /** what: tool + redacted input snapshot. */
  what: RequestSnapshot;
  /** decision: includes matchedRules + decisionTrace (explainability). */
  decision: PolicyDecision;
  /** Compile-time policy inputs (hard signals) — replay snapshot (R17.1). */
  policyInputs?: PolicyInputs;
  /** result: terminal status + redacted output summary. */
  result: { status: ToolExecutionResult["status"]; exitCode?: number; stdoutHash?: string };
  timing: { start: number; end: number };
  /** cost: optional AOR-derived spend in USD. */
  costUsd?: number;
  occurredAt: string;
}

/** Cheap, stable hash for stdout (avoids storing raw output). */
export function hashStdout(stdout: string | undefined): string | undefined {
  if (stdout === undefined) {
    return undefined;
  }
  let h = 5381;
  for (let i = 0; i < stdout.length; i += 1) {
    h = (h * 33) ^ stdout.charCodeAt(i);
  }
  return `djb2:${(h >>> 0).toString(16)}`;
}

/** Assemble an immutable audit record from a completed execution. */
export function buildExecutionRecord(params: {
  request: ToolRequest;
  decision: PolicyDecision;
  result: ToolExecutionResult;
  ownership?: OwnershipMetadata;
  policyInputs?: PolicyInputs;
  costUsd?: number;
  occurredAt?: string;
}): FabricExecutionRecord {
  const { request, decision, result } = params;
  return {
    correlationId: request.trace.correlationId,
    sessionId: request.trace.sessionId,
    taskId: request.trace.taskId,
    tenantId: request.source.tenantId,
    who: { source: request.source, ownership: params.ownership },
    what: snapshotRequest(request),
    decision,
    policyInputs: params.policyInputs,
    result: {
      status: result.status,
      exitCode: result.exitCode,
      stdoutHash: hashStdout(result.output?.stdout),
    },
    timing: result.timing,
    costUsd: params.costUsd,
    occurredAt: params.occurredAt ?? new Date().toISOString(),
  };
}

/** Query predicate over the canonical correlation/session/tenant keys (R9.4). */
export interface AuditQuery {
  tenantId?: string;
  sessionId?: string;
  correlationId?: string;
}

/** Filter records by tenant/session/correlation (all provided fields must match). */
export function queryRecords(
  records: readonly FabricExecutionRecord[],
  query: AuditQuery,
): FabricExecutionRecord[] {
  return records.filter(
    (r) =>
      (query.tenantId === undefined || r.tenantId === query.tenantId) &&
      (query.sessionId === undefined || r.sessionId === query.sessionId) &&
      (query.correlationId === undefined || r.correlationId === query.correlationId),
  );
}

/** Structured JSON export (compliance-export basis, R9.4). */
export function exportRecordsJson(records: readonly FabricExecutionRecord[]): string {
  return JSON.stringify(records, null, 2);
}

/**
 * Format a record as a single canonical control-plane audit line (R9).
 *
 * This is the audit STORE in this codebase: the gateway's unified log. The line
 * is stable and parseable (key=value), redaction-safe (no plaintext secrets —
 * only the stdout hash and the tool name), and aligned with the other
 * control-plane audit lines (`config.patch write …`, `update.run completed …`).
 * The caller prefixes actor/connection context (`formatControlPlaneActor`).
 */
export function formatFabricAuditLine(record: FabricExecutionRecord): string {
  const parts = [
    "fabric.tool.execute",
    `decision=${record.decision.decision}`,
    `status=${record.result.status}`,
    `tool=${record.what.tool.name}`,
    `corr=${record.correlationId}`,
    `session=${record.sessionId}`,
    `tenant=${record.tenantId ?? "-"}`,
    `owner=${record.who.ownership?.owner ?? "-"}`,
  ];
  if (record.result.exitCode !== undefined) {
    parts.push(`exit=${record.result.exitCode}`);
  }
  if (record.costUsd !== undefined) {
    parts.push(`costUsd=${record.costUsd}`);
  }
  if (record.result.stdoutHash) {
    parts.push(`stdout=${record.result.stdoutHash}`);
  }
  if (record.decision.decision === "DENY" && record.decision.reason) {
    parts.push(`reason=${record.decision.reason}`);
  }
  parts.push(`durMs=${record.timing.end - record.timing.start}`);
  return parts.join(" ");
}
