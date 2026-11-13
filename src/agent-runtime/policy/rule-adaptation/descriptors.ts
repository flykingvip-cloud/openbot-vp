/**
 * P1 shadow-candidate field adapters.
 * Reads the existing catalog; does not create a second rule directory
 * and does not change compile or enforcement behavior.
 */
import type { RuntimeRuleDeclaration } from "../../contracts/policy.js";
import { getRuntimeRuleDeclaration } from "../catalog.js";
import { SYSTEM_INVARIANTS } from "../collaboration-rules.js";
import { CONTEXT_WINDOW_HARD_MIN_TOKENS } from "../context-window.js";

export type P1ShadowFieldAdapter = {
  ruleId: string;
  field: string;
  hardMin: number;
  hardCeiling: number | undefined;
  requiresLane: boolean;
  allowedScopeTypes: readonly string[];
  catalogDeclaration: RuntimeRuleDeclaration;
};

const CONTEXT_WINDOW_RULE_ID = "model.context_window.guard";
const CONTEXT_WINDOW_FIELD = "agents.defaults.contextTokens";
const COLLAB_COMPILE_RULE_ID = "collab.policy.compile";
const VISIBLE_REPLIES_FIELD = "maxVisibleBotRepliesPerRound";
const VISIBLE_REPLIES_HARD_MIN = 1;

function requireCatalogDeclaration(ruleId: string): RuntimeRuleDeclaration {
  const declaration = getRuntimeRuleDeclaration(ruleId);
  if (!declaration) {
    throw new Error(`P1 shadow adapter requires existing catalog id ${ruleId}`);
  }
  return declaration;
}

/**
 * The two approved P1 shadow candidates only. Additional fields must not be
 * added without a new authorization. Hard bounds are read from existing
 * policy constants (context-window hard min; SYSTEM_INVARIANTS visible-reply
 * ceiling and the compiler floor of 1). This module does not edit those
 * constants or the compiler.
 */
export function listP1ShadowFieldAdapters(): readonly P1ShadowFieldAdapter[] {
  return [
    {
      ruleId: CONTEXT_WINDOW_RULE_ID,
      field: CONTEXT_WINDOW_FIELD,
      hardMin: CONTEXT_WINDOW_HARD_MIN_TOKENS,
      hardCeiling: undefined,
      requiresLane: false,
      allowedScopeTypes: ["personal"],
      catalogDeclaration: requireCatalogDeclaration(CONTEXT_WINDOW_RULE_ID),
    },
    {
      ruleId: COLLAB_COMPILE_RULE_ID,
      field: VISIBLE_REPLIES_FIELD,
      hardMin: VISIBLE_REPLIES_HARD_MIN,
      hardCeiling: SYSTEM_INVARIANTS.maxVisibleRepliesCeiling,
      requiresLane: true,
      allowedScopeTypes: ["group"],
      catalogDeclaration: requireCatalogDeclaration(COLLAB_COMPILE_RULE_ID),
    },
  ];
}

export function getP1ShadowFieldAdapter(
  ruleId: string,
  field: string,
): P1ShadowFieldAdapter | undefined {
  return listP1ShadowFieldAdapters().find(
    (adapter) => adapter.ruleId === ruleId && adapter.field === field,
  );
}

export function isKnownCatalogRuleId(ruleId: string): boolean {
  return getRuntimeRuleDeclaration(ruleId) !== undefined;
}
