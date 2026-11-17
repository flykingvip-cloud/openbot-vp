import { CONTEXT_WINDOW_HARD_MIN_TOKENS, type ContextWindowInfo } from "../../policy/index.js";
import {
  selectPersonalContextCap,
  type ContextCapSelectionResult,
  type PersonalContextCapSelectionPort,
} from "./context-cap-selection.js";

export type ComplexRuleDecisionMode = "legacy" | "dynamic";
export type ComplexRuleDecision = {
  domain: "context_window";
  mode: ComplexRuleDecisionMode;
  decisionId: string;
  effectiveTokens: number;
  source: string;
  outcome: ContextCapSelectionResult["outcome"];
  selection: ContextCapSelectionResult;
};
export type ComplexRuleDecisionProvider = {
  decide(input: {
    original: ContextWindowInfo;
    port?: PersonalContextCapSelectionPort;
    decisionId: string;
  }): ComplexRuleDecision;
};
export function createLegacyContextWindowDecisionProvider(): ComplexRuleDecisionProvider {
  return {
    decide(input) {
      const r = selectPersonalContextCap({ original: input.original, port: input.port });
      return {
        domain: "context_window",
        mode: "legacy",
        decisionId: input.decisionId,
        effectiveTokens: "tokens" in r ? r.tokens : r.originalTokens,
        source: "legacy-context-cap",
        outcome: r.outcome,
        selection: r,
      };
    },
  };
}
export function selectComplexRuleProvider(
  mode: ComplexRuleDecisionMode = "legacy",
): ComplexRuleDecisionMode {
  return mode;
}

/** Trusted pre-execution port. Implementations must validate and CAS before returning. */
export type ConfirmedContextWindowDecision = {
  domain: "context_window";
  ruleId: "model.context_window.guard";
  decisionId: string;
  effectiveTokens: number;
  originalTokens: number;
  sourceVersion: string;
  policyHash: string;
};
export type ContextWindowDecisionSwitch = {
  mode: ComplexRuleDecisionMode;
  snapshot?: ConfirmedContextWindowDecision;
  revalidate?: () => boolean;
  fallback: "legacy" | "block";
};

/** Consumes confirmed data only. Never starts a model call during preparation. */
export function consumeContextWindowDecision(input: {
  original: ContextWindowInfo;
  port?: PersonalContextCapSelectionPort;
  decisionId: string;
  policy?: ContextWindowDecisionSwitch;
}): ComplexRuleDecision {
  if (!input.policy || input.policy.mode === "legacy") {
    return createLegacyContextWindowDecisionProvider().decide(input);
  }
  const snapshot = input.policy.snapshot;
  if (
    snapshot &&
    input.policy.revalidate?.() === true &&
    snapshot.domain === "context_window" &&
    snapshot.ruleId === "model.context_window.guard" &&
    snapshot.decisionId === input.decisionId &&
    snapshot.sourceVersion &&
    snapshot.policyHash &&
    snapshot.originalTokens === input.original.tokens &&
    Number.isSafeInteger(snapshot.effectiveTokens) &&
    snapshot.effectiveTokens >= CONTEXT_WINDOW_HARD_MIN_TOKENS &&
    snapshot.effectiveTokens <= input.original.tokens
  ) {
    const selection: ContextCapSelectionResult = {
      outcome: "applied",
      mode: "dynamic_run",
      source: "dynamic_run",
      originalTokens: input.original.tokens,
      tokens: snapshot.effectiveTokens,
    };
    return {
      domain: "context_window",
      mode: "dynamic",
      decisionId: input.decisionId,
      effectiveTokens: snapshot.effectiveTokens,
      source: "confirmed-dynamic-snapshot",
      outcome: "applied",
      selection,
    };
  }
  if (input.policy.fallback === "legacy") {
    const result = createLegacyContextWindowDecisionProvider().decide(input);
    return { ...result, source: "explicit-dynamic-fallback" };
  }
  throw new Error("Dynamic context-window decision is missing, stale or invalid");
}
