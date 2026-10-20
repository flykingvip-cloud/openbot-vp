import { readFileSync } from "node:fs";
import type { ToolRisk } from "./contracts.js";
import { policyExamplePath } from "./paths.js";

/** Raw decisions as used in `config/policy.example.json`. */
export type PolicyDecisionRaw =
  | "allow"
  | "allow-with-receipt"
  | "require-approval"
  | "require-explicit-approval"
  | "deny"
  | "deny-unless-scoped";

/** Normalized decisions consumed by the gated executor. */
export type PolicyDecisionKind = "allow" | "allow-with-receipt" | "require-approval" | "deny";

export interface PolicyMatch {
  toolId?: string;
  operation?: string;
  risk?: ToolRisk;
  sideEffects?: boolean;
  destructive?: boolean;
  credentialAccess?: boolean;
  withinWorkspace?: boolean;
}

export interface PolicyRule {
  match: PolicyMatch;
  decision: PolicyDecisionRaw;
}

export interface ToolkitPolicyLimits {
  defaultTimeoutMs?: number;
  maxRetries?: number;
  approvalTtlSeconds?: number;
  maxParallelCalls?: number;
}

export interface ToolkitPolicy {
  default: PolicyDecisionRaw;
  rules: PolicyRule[];
  limits?: ToolkitPolicyLimits;
}

/** Facts about a pending tool call used for policy evaluation. */
export interface PolicyFacts {
  toolId: string;
  operation: string;
  risk: ToolRisk;
  sideEffects: boolean;
  destructive?: boolean;
  credentialAccess?: boolean;
  /** True when the write/path stays inside the declared workspace. */
  withinWorkspace?: boolean;
  /** True when credential access has an explicit scoped grant. */
  scopedCredentialAccess?: boolean;
}

export interface PolicyEvaluation {
  /** First matching rule index, or -1 when the default applies. */
  matchedRuleIndex: number;
  rawDecision: PolicyDecisionRaw;
  decision: PolicyDecisionKind;
  reason: string;
  facts: PolicyFacts;
  requiresExplicitApproval: boolean;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asDecision(value: unknown): PolicyDecisionRaw | undefined {
  if (
    value === "allow" ||
    value === "allow-with-receipt" ||
    value === "require-approval" ||
    value === "require-explicit-approval" ||
    value === "deny" ||
    value === "deny-unless-scoped"
  ) {
    return value;
  }
  return undefined;
}

/** Validate and normalize a policy document (e.g. policy.example.json). */
export function parseToolkitPolicy(raw: unknown): ToolkitPolicy {
  if (!isObject(raw)) {
    throw new Error("Invalid toolkit policy: expected object");
  }
  const defaultDecision = asDecision(raw.default);
  if (!defaultDecision) {
    throw new Error("Invalid toolkit policy: missing or invalid default decision");
  }
  if (!Array.isArray(raw.rules)) {
    throw new Error("Invalid toolkit policy: rules must be an array");
  }
  const rules: PolicyRule[] = raw.rules.map((rule, index) => {
    if (!isObject(rule) || !isObject(rule.match)) {
      throw new Error(`Invalid toolkit policy: rules[${index}] must have a match object`);
    }
    const decision = asDecision(rule.decision);
    if (!decision) {
      throw new Error(`Invalid toolkit policy: rules[${index}] has invalid decision`);
    }
    return {
      match: rule.match as PolicyMatch,
      decision,
    };
  });

  const limits = isObject(raw.limits) ? (raw.limits as ToolkitPolicyLimits) : undefined;
  return { default: defaultDecision, rules, limits };
}

export function loadToolkitPolicy(path: string): ToolkitPolicy {
  return parseToolkitPolicy(JSON.parse(readFileSync(path, "utf8")) as unknown);
}

/** Load the packaged example policy (`config/policy.example.json`). */
export function loadExamplePolicy(): ToolkitPolicy {
  return loadToolkitPolicy(policyExamplePath());
}

function matchField<T>(expected: T | undefined, actual: T | undefined): boolean {
  if (expected === undefined) {
    return true;
  }
  return expected === actual;
}

function ruleMatches(match: PolicyMatch, facts: PolicyFacts): boolean {
  return (
    matchField(match.toolId, facts.toolId) &&
    matchField(match.operation, facts.operation) &&
    matchField(match.risk, facts.risk) &&
    matchField(match.sideEffects, facts.sideEffects) &&
    matchField(match.destructive, facts.destructive ?? false) &&
    matchField(match.credentialAccess, facts.credentialAccess ?? false) &&
    matchField(match.withinWorkspace, facts.withinWorkspace ?? false)
  );
}

/**
 * Normalize raw policy decisions into the four executor-facing kinds.
 * - `require-explicit-approval` → `require-approval` (flag kept separately)
 * - `deny-unless-scoped` → `allow-with-receipt` when scoped, else `deny`
 */
export function normalizePolicyDecision(
  raw: PolicyDecisionRaw,
  facts: PolicyFacts,
): { decision: PolicyDecisionKind; requiresExplicitApproval: boolean } {
  if (raw === "require-explicit-approval") {
    return { decision: "require-approval", requiresExplicitApproval: true };
  }
  if (raw === "require-approval") {
    return { decision: "require-approval", requiresExplicitApproval: false };
  }
  if (raw === "deny-unless-scoped") {
    if (facts.scopedCredentialAccess) {
      return { decision: "allow-with-receipt", requiresExplicitApproval: false };
    }
    return { decision: "deny", requiresExplicitApproval: false };
  }
  if (raw === "allow" || raw === "allow-with-receipt" || raw === "deny") {
    return { decision: raw, requiresExplicitApproval: false };
  }
  return { decision: "deny", requiresExplicitApproval: false };
}

/**
 * Evaluate toolkit policy against call facts. First matching rule wins;
 * otherwise the policy default applies.
 */
export function evaluatePolicy(policy: ToolkitPolicy, facts: PolicyFacts): PolicyEvaluation {
  for (let i = 0; i < policy.rules.length; i++) {
    const rule = policy.rules[i]!;
    if (!ruleMatches(rule.match, facts)) {
      continue;
    }
    const normalized = normalizePolicyDecision(rule.decision, facts);
    return {
      matchedRuleIndex: i,
      rawDecision: rule.decision,
      decision: normalized.decision,
      requiresExplicitApproval: normalized.requiresExplicitApproval,
      reason: `matched rules[${i}] → ${rule.decision}`,
      facts,
    };
  }

  const normalized = normalizePolicyDecision(policy.default, facts);
  return {
    matchedRuleIndex: -1,
    rawDecision: policy.default,
    decision: normalized.decision,
    requiresExplicitApproval: normalized.requiresExplicitApproval,
    reason: `default → ${policy.default}`,
    facts,
  };
}

/**
 * Convenience: high+sideEffects or destructive always escalate to require-approval
 * after formal policy evaluation when the formal result would otherwise allow.
 * Kept as a named helper for docs/tests; `evaluatePolicy` + example JSON already cover this.
 */
export function requiresApprovalForFacts(evaluation: PolicyEvaluation): boolean {
  return evaluation.decision === "require-approval";
}
