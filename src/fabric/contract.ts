/**
 * contract.ts — OpenBot Fabric control-plane contract (single source of types).
 *
 * The ONE authoritative, serializable, schema-validated contract for the Tool
 * Execution Control Plane. All subsystems (Loom / TOL / AOR) are adapted onto
 * these types via explicit mappers (see `mappers.ts`); subsystem-internal types
 * never leak as Fabric public fields (R1.5).
 *
 * Design: `.kiro/specs/openbot-fabric/design.md` (Data Models).
 * Requirements: R1 (contract), R16 (decisionTrace), R20/R21 (projection graph).
 *
 * Architecture invariants reflected here:
 *  - decisionTrace is bound to PolicyDecision (not ExecutionGraphState) — R21.6.
 *  - RuntimeNode/ExecutionGraphState are a PROJECTION of an AOR plan; Fabric does
 *    not build/reorder graphs — R20. Structure comes from AOR, never from intent.
 */

import { z } from "zod";

/** Reusable open metadata slot (never holds credentials/secrets — R9.5/R13.3). */
const Metadata = z.record(z.string(), z.unknown());

// ─────────────────────────────────────────────────────────────────────────────
// ToolRequest (R1.2, R1.3)
// ─────────────────────────────────────────────────────────────────────────────

/** Known invocation sources. Extensible: unknown sources accepted as free string. */
export const SourceType = z.enum([
  "cursor",
  "kiro",
  "codex",
  "windsurf",
  "devin-desktop",
  "claude-code",
  "openbot",
]);
export type SourceType = z.infer<typeof SourceType>;

/** Unified tool invocation request normalized from any source. */
export const ToolRequest = z.object({
  id: z.string().min(1),
  source: z.object({
    type: SourceType.or(z.string().min(1)),
    userId: z.string().optional(),
    tenantId: z.string().optional(),
  }),
  tool: z.object({ name: z.string().min(1), version: z.string().optional() }),
  input: z
    .object({
      args: z.array(z.string()).optional(),
      cwd: z.string().optional(),
      env: z.record(z.string(), z.string()).optional(),
    })
    .default({}),
  context: z
    .object({
      repoRoot: z.string().optional(),
      networkAccess: z.boolean().optional(),
      fileScope: z.array(z.string()).optional(),
    })
    .default({}),
  trace: z.object({
    sessionId: z.string().min(1),
    taskId: z.string().optional(),
    correlationId: z.string().min(1),
  }),
});
export type ToolRequest = z.infer<typeof ToolRequest>;

// ─────────────────────────────────────────────────────────────────────────────
// ExecutionConstraints (R4)
// ─────────────────────────────────────────────────────────────────────────────

/** Abstract execution boundary; mapped onto TOL controls by `constraints.ts`. */
export const ExecutionConstraints = z.object({
  allowedPaths: z.array(z.string()).optional(),
  blockedPaths: z.array(z.string()).optional(),
  allowNetwork: z.boolean().optional(),
  timeoutMs: z.number().int().positive().optional(),
  sandboxMode: z.enum(["none", "restricted", "strict"]).optional(),
  costLimit: z.number().nonnegative().optional(),
});
export type ExecutionConstraints = z.infer<typeof ExecutionConstraints>;

// ─────────────────────────────────────────────────────────────────────────────
// PolicyDecision + decisionTrace (R3, R16) — decisionTrace bound here (R21.6)
// ─────────────────────────────────────────────────────────────────────────────

/** One evaluation stage in the explainability graph. */
export const DecisionTraceEntry = z.object({
  stage: z.enum([
    "loom.attribution",
    "scope.domain",
    "exec.allowlist",
    "exec.approval",
    "sandbox.constraint",
    "cost.threshold",
    "risk.score",
  ]),
  hit: z.boolean(),
  detail: z.string().optional(), // human-readable; never contains credentials
  effect: z.enum(["allow", "deny", "modify", "neutral"]).default("neutral"),
});
export type DecisionTraceEntry = z.infer<typeof DecisionTraceEntry>;

/** Ordered explainability graph attached to every decision. */
export const DecisionTrace = z.array(DecisionTraceEntry);
export type DecisionTrace = z.infer<typeof DecisionTrace>;

/** Compile-time policy decision (ALLOW | DENY | MODIFY) with explainability. */
export const PolicyDecision = z.discriminatedUnion("decision", [
  z.object({
    decision: z.literal("ALLOW"),
    constraints: ExecutionConstraints.optional(),
    matchedRules: z.array(z.string()).default([]),
    decisionTrace: DecisionTrace.default([]),
  }),
  z.object({
    decision: z.literal("DENY"),
    reason: z.string().min(1),
    matchedRules: z.array(z.string()).default([]),
    decisionTrace: DecisionTrace.default([]),
  }),
  z.object({
    decision: z.literal("MODIFY"),
    constraints: ExecutionConstraints,
    matchedRules: z.array(z.string()).default([]),
    decisionTrace: DecisionTrace.default([]),
  }),
]);
export type PolicyDecision = z.infer<typeof PolicyDecision>;

// ─────────────────────────────────────────────────────────────────────────────
// ToolExecutionResult + ExecutionEvent + ToolAdapter (R5, R12, R8)
// ─────────────────────────────────────────────────────────────────────────────

/** Terminal result of executing one tool node. */
export const ToolExecutionResult = z.object({
  id: z.string().min(1),
  status: z.enum(["success", "failed", "denied"]),
  output: z.object({ stdout: z.string().optional(), stderr: z.string().optional() }).optional(),
  exitCode: z.number().int().optional(),
  timing: z.object({ start: z.number(), end: z.number() }),
  trace: z.object({ policyDecisionId: z.string(), executionId: z.string() }),
});
export type ToolExecutionResult = z.infer<typeof ToolExecutionResult>;

/** Streamed execution event (reuses gateway tool-events transport, R12). */
export const ExecutionEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("stdout"), data: z.string() }),
  z.object({ type: z.literal("stderr"), data: z.string() }),
  z.object({ type: z.literal("status"), state: z.enum(["running", "done"]) }),
  z.object({ type: z.literal("policy"), decision: PolicyDecision }),
]);
export type ExecutionEvent = z.infer<typeof ExecutionEvent>;

/** Declarative adapter mapping tool names to an executable command (R8). */
export const ToolAdapter = z.object({
  id: z.string().min(1),
  match: z.object({ toolNames: z.array(z.string().min(1)).min(1) }),
  execute: z.object({
    command: z.string().min(1),
    argsTemplate: z.array(z.string()).optional(),
  }),
  capabilities: z
    .object({
      fs: z.boolean().optional(),
      network: z.boolean().optional(),
      streaming: z.boolean().optional(),
    })
    .default({}),
});
export type ToolAdapter = z.infer<typeof ToolAdapter>;

// ─────────────────────────────────────────────────────────────────────────────
// Projection graph (R20, R21) — projected from an AOR plan; Fabric NEVER builds
// or reorders structure. A single tool call is a trivial 1-node graph.
// ─────────────────────────────────────────────────────────────────────────────

const RuntimeNodeBase = z.object({
  id: z.string().min(1),
  // Deterministic dependencies only (from AOR plan); never derived from intent.
  dependsOn: z.array(z.string()).default([]),
  status: z.enum(["pending", "ready", "running", "done", "failed"]).default("pending"),
});

/** Executable tool node; `policy` is filled by the compile-time Policy Gate. */
export const ToolNode = RuntimeNodeBase.extend({
  type: z.literal("tool"),
  request: ToolRequest,
  constraints: ExecutionConstraints.optional(),
  policy: PolicyDecision.optional(),
});
/** Executable agent (cognitive) node; also gated at compile time. */
export const AgentNode = RuntimeNodeBase.extend({
  type: z.literal("agent"),
  request: ToolRequest,
  policy: PolicyDecision.optional(),
});
/** Record-only node for explainability; absence NEVER means "no gate" (R21.2). */
export const PolicyNode = RuntimeNodeBase.extend({
  type: z.literal("policy"),
  source: z.enum(["loom", "fabric"]),
  decision: PolicyDecision,
  scope: z.object({ nodeIds: z.array(z.string()).default([]) }),
});
export const AdapterNode = RuntimeNodeBase.extend({
  type: z.literal("adapter"),
  adapterId: z.string().min(1),
});
export const AuditNode = RuntimeNodeBase.extend({
  type: z.literal("audit"),
  recordRef: z.string().optional(),
});
export const ForkNode = RuntimeNodeBase.extend({
  type: z.literal("fork"),
  branches: z.array(z.string()).min(1),
});
export const MergeNode = RuntimeNodeBase.extend({
  type: z.literal("merge"),
  strategy: z.enum(["all", "any", "majority"]).default("all"),
});

export const RuntimeNode = z.discriminatedUnion("type", [
  ToolNode,
  AgentNode,
  PolicyNode,
  AdapterNode,
  AuditNode,
  ForkNode,
  MergeNode,
]);
export type RuntimeNode = z.infer<typeof RuntimeNode>;

export const RuntimeEdge = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  kind: z.enum(["data", "control"]).default("control"),
});
export type RuntimeEdge = z.infer<typeof RuntimeEdge>;

// ─────────────────────────────────────────────────────────────────────────────
// Execution state machine + unified projection state (R15, R21.3/R21.7)
// ─────────────────────────────────────────────────────────────────────────────

/** Execution lifecycle phases. `compensating` is reserved for later phases. */
export const RunPhase = z.enum([
  "validated",
  "scheduled",
  "executing",
  "streaming",
  "finalized",
  "failed",
]);
export type RunPhase = z.infer<typeof RunPhase>;

/** One execution-run instance for a node (Trace Layer record). */
export const ToolExecutionRun = z.object({
  id: z.string().min(1),
  nodeId: z.string().min(1),
  phase: RunPhase.default("validated"),
  policyDecisionId: z.string(),
  attempts: z.number().int().nonnegative().default(0),
  metadata: Metadata.default({}),
});
export type ToolExecutionRun = z.infer<typeof ToolExecutionRun>;

/**
 * Unified projection state: a faithful projection of an AOR plan plus a policy
 * overlay and execution trace. Doubles as the replay snapshot (R21.3). Fabric
 * does not build/reorder structure (R20.5).
 */
export const ExecutionGraphState = z.object({
  graphId: z.string().min(1),
  nodes: z.array(RuntimeNode).min(1),
  edges: z.array(RuntimeEdge).default([]),
  runs: z.array(ToolExecutionRun).default([]),
  context: z.object({
    tenantId: z.string().optional(),
    sessionId: z.string().min(1),
    correlationId: z.string().min(1),
    // Loom-derived ownership, mapped at compile time (no runtime Loom lookup).
    ownership: Metadata.default({}),
  }),
});
export type ExecutionGraphState = z.infer<typeof ExecutionGraphState>;

// ─────────────────────────────────────────────────────────────────────────────
// Validation with locatable errors (field + object id) — R1.4
// ─────────────────────────────────────────────────────────────────────────────

export class FabricContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FabricContractError";
  }
}

function describeIssue(raw: unknown, issue: z.core.$ZodIssue): string {
  const fieldPath = issue.path.map((segment) => String(segment)).join(".") || "<root>";
  // Surface a friendly object id when present at the top level.
  const id = raw && typeof raw === "object" ? (raw as { id?: unknown }).id : undefined;
  const ref = typeof id === "string" && id.length > 0 ? `"${id}" ` : "";
  return `${ref}(${fieldPath}): ${issue.message}`;
}

/**
 * Parse + validate a Fabric contract object against a schema, throwing a
 * FabricContractError with a locatable "[id] (field): message" on failure.
 */
export function parseContract<T>(
  schema: z.ZodType<T>,
  raw: unknown,
  label = "Fabric contract object",
): T {
  const result = schema.safeParse(raw);
  if (!result.success) {
    const details = result.error.issues.map((issue) => describeIssue(raw, issue)).join("; ");
    throw new FabricContractError(`Invalid ${label}: ${details}`);
  }
  return result.data;
}
