/**
 * policy-runtime.ts — Fabric Policy Runtime: the SINGLE, COMPILE-TIME decision
 * point (R3, R14, R21).
 *
 * `decide` is a PURE function: the compile pipeline (task 4.4) probes the
 * existing enforcement points (method-scopes / exec-approvals / allowlist) and
 * Loom (compile-time metadata), then feeds their results here as `PolicyInputs`.
 * This keeps the decision logic deterministic, testable, and decoupled — and
 * makes the "one decision, attached to the node; runtime never re-evaluates"
 * invariant (R21.1/R21.2) structural.
 *
 * Hard rules:
 *  - Hard signals only (scope/allowlist/approval/risk); intent never decides (R3.6).
 *  - Default-safe: anything unresolved → fall back to deny, never default ALLOW (R3.5).
 *  - Loom is informational input (attribution), never the sole deciding effect.
 *  - decisionTrace is bound to the returned PolicyDecision (R21.6).
 *
 * Design: `.kiro/specs/openbot-fabric/design.md` §3.3.
 */

import type { ExecutionConstraints, PolicyDecision, ToolRequest } from "./contract.js";
import { DecisionTraceBuilder } from "./decision-trace.js";
import { attributionTraceEntry, type LoomAttribution } from "./mappers.js";

/** Scope/role/domain probe (from method-scopes.ts / guardSessionDomain). */
export interface ScopeProbe {
  allowed: boolean;
  missingScope?: string;
  domainMismatch?: boolean;
  requiredDomain?: string;
}

/** Command-analysis + allowlist probe (from exec-approvals-allowlist.ts). */
export interface AllowlistProbe {
  /** True for exec/shell-class tools where allowlist applies. */
  applicable: boolean;
  analysisOk: boolean;
  satisfied: boolean;
}

/**
 * exec-approval gate (from requiresExecApproval) with the interactive ask-on-miss
 * already RESOLVED at compile time (R21.4). `resolution` undefined = unresolved.
 */
export interface ApprovalProbe {
  requiresApproval: boolean;
  resolution?: "allow" | "deny";
}

/** Deterministic risk score (v1; learning-based scoring deferred). */
export interface RiskProbe {
  score: number;
  threshold: number;
}

/** Inputs to a single compile-time decision (all hard signals). */
export interface PolicyInputs {
  scope: ScopeProbe;
  allowlist?: AllowlistProbe;
  approval?: ApprovalProbe;
  attribution?: LoomAttribution;
  risk?: RiskProbe;
  /** Tightening-only constraints proposed from context (source/tenant/sandbox). */
  proposedConstraints?: ExecutionConstraints;
}

/** Merge a strict-sandbox tightening into constraints when risk crosses threshold. */
function tightenForRisk(
  base: ExecutionConstraints | undefined,
  risk: RiskProbe,
): ExecutionConstraints | undefined {
  if (risk.score < risk.threshold) {
    return base;
  }
  // High risk → force strict sandbox + no network (tightening only).
  return { ...base, sandboxMode: "strict", allowNetwork: false };
}

/**
 * The single compile-time policy decision. Composes existing enforcement-point
 * results into ALLOW | DENY | MODIFY with an explainability trace.
 */
export function decide(req: ToolRequest, inputs: PolicyInputs): PolicyDecision {
  const trace = new DecisionTraceBuilder();
  const matchedRules: string[] = [];

  // 1) Attribution (informational input; never the sole deciding effect).
  if (inputs.attribution) {
    trace.add(attributionTraceEntry(inputs.attribution));
    matchedRules.push(...(inputs.attribution.matchedRules ?? []));
  }

  // 2) Scope / role / domain — a hard gate.
  const scope = inputs.scope;
  if (!scope.allowed) {
    const reason = scope.domainMismatch
      ? `domain_mismatch: requires ${scope.requiredDomain ?? "<domain>"}`
      : `missing_scope: ${scope.missingScope ?? "<scope>"}`;
    trace.stage("scope.domain", true, { detail: reason, effect: "deny" });
    return { decision: "DENY", reason, matchedRules, decisionTrace: trace.build() };
  }
  trace.stage("scope.domain", false, { detail: "scope/role/domain ok" });

  // 3) Allowlist (explainability + matchedRules; the deny/approval consequence
  //    is carried by the approval probe, which upstream derived via requiresExecApproval).
  if (inputs.allowlist?.applicable) {
    const a = inputs.allowlist;
    trace.stage("exec.allowlist", a.satisfied, {
      detail: a.satisfied
        ? "allowlist satisfied"
        : `allowlist not satisfied (analysisOk=${a.analysisOk})`,
    });
    if (a.satisfied) {
      matchedRules.push("exec.allowlist");
    }
  }

  // 4) exec-approval gate (interactive ask resolved at compile time).
  if (inputs.approval?.requiresApproval) {
    const resolution = inputs.approval.resolution;
    if (resolution === "deny") {
      trace.stage("exec.approval", true, { detail: "approval denied", effect: "deny" });
      return {
        decision: "DENY",
        reason: "exec_approval_denied",
        matchedRules,
        decisionTrace: trace.build(),
      };
    }
    if (resolution !== "allow") {
      // Default-safe: unresolved approval cannot run (R3.5).
      trace.stage("exec.approval", true, { detail: "approval unresolved", effect: "deny" });
      return {
        decision: "DENY",
        reason: "exec_approval_unresolved",
        matchedRules,
        decisionTrace: trace.build(),
      };
    }
    trace.stage("exec.approval", true, { detail: "approval granted" });
    matchedRules.push("exec.approval");
  }

  // 5) Risk score → may tighten into constraints (MODIFY), never relaxes.
  let constraints = inputs.proposedConstraints;
  if (inputs.risk) {
    const high = inputs.risk.score >= inputs.risk.threshold;
    trace.stage("risk.score", high, {
      detail: `risk ${inputs.risk.score} / threshold ${inputs.risk.threshold}`,
      effect: high ? "modify" : "neutral",
    });
    constraints = tightenForRisk(constraints, inputs.risk);
  }

  // 6) Synthesize: any tightening constraint ⇒ MODIFY; otherwise ALLOW.
  if (constraints && Object.keys(constraints).length > 0) {
    trace.stage("sandbox.constraint", true, {
      detail: "dynamic constraints injected",
      effect: "modify",
    });
    return { decision: "MODIFY", constraints, matchedRules, decisionTrace: trace.build() };
  }
  return { decision: "ALLOW", matchedRules, decisionTrace: trace.build() };
}
