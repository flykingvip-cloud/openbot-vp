import { resolveBotCollaborationRole } from "./contribution-roles.js";
import type { CollaborationPolicyV1 } from "./policy.js";
import type { RuntimeFacts } from "./runtime-authority.js";
import { scoreRelevanceBot } from "./tier1b-relevance-engine.js";
import type { CollaborationBotTarget } from "./types.js";

export type SuppressionReason =
  | "low_relevance"
  | "duplicate"
  | "low_increment"
  | "role_mismatch"
  | "budget_limit"
  | "visible_limit"
  | "policy_disabled";

export type CheapGateResult =
  | { decision: "DROP"; reason: SuppressionReason; relevance?: number }
  | { decision: "KEEP"; reason: string; relevance?: number }
  | { decision: "REVIEW"; reason: string; relevance?: number };

const CLEARLY_IRRELEVANT = 18;
const CLEARLY_RELEVANT = 40;

export function evaluateCheapGate(params: {
  facts: RuntimeFacts;
  bot: CollaborationBotTarget;
  message: string;
  policy: CollaborationPolicyV1;
  responseMode?: string;
  keptCount: number;
  /** review_driven / preserveConflict — reviewers may challenge without debate mode. */
  preserveConflict?: boolean;
  /** Same-round edge kinds targeting this bot (challenge/request_review bypass role drop). */
  edgeKinds?: readonly string[];
  /**
   * The human explicitly invited this bot (@name or @所有人 broadcast). Invited bots
   * are never dropped for low_relevance / role / supplement budget; the caller still
   * bounds them by the visible-reply cap.
   */
  invited?: boolean;
}): CheapGateResult {
  const edgeKinds = new Set(params.edgeKinds ?? []);
  const edgeInvited =
    edgeKinds.has("challenge") ||
    edgeKinds.has("request_review") ||
    edgeKinds.has("peer_ask") ||
    edgeKinds.has("handoff");
  const invited = params.invited === true;
  if (!params.policy.supplement.enabled) {
    return { decision: "DROP", reason: "policy_disabled" };
  }
  // single_owner suppresses unsolicited supplements, not a primary's explicit edge.
  if (params.responseMode === "single_owner" && !edgeInvited) {
    return { decision: "DROP", reason: "policy_disabled" };
  }
  if (params.keptCount >= params.policy.supplement.maxSupplementBots && !edgeInvited && !invited) {
    return { decision: "DROP", reason: "budget_limit" };
  }

  const role = resolveBotCollaborationRole(params.facts, params.bot);
  if (
    role === "coordinator" &&
    params.responseMode !== "decision_to_executor" &&
    !edgeInvited &&
    !invited
  ) {
    return { decision: "DROP", reason: "role_mismatch" };
  }
  const reviewerAllowed =
    invited ||
    params.responseMode === "debate_or_brainstorm" ||
    params.preserveConflict === true ||
    edgeKinds.has("challenge") ||
    edgeKinds.has("request_review");
  if (role === "reviewer" && !reviewerAllowed) {
    return { decision: "DROP", reason: "role_mismatch" };
  }

  const relevance = scoreRelevanceBot({
    facts: params.facts,
    bot: params.bot,
    message: params.message,
  });
  if (edgeInvited) {
    return { decision: "KEEP", reason: "edge_invited", relevance };
  }
  if (invited) {
    return { decision: "KEEP", reason: "explicitly_invited", relevance };
  }
  if (relevance < CLEARLY_IRRELEVANT) {
    return { decision: "DROP", reason: "low_relevance", relevance };
  }
  if (relevance >= CLEARLY_RELEVANT) {
    return { decision: "KEEP", reason: "clearly_relevant", relevance };
  }
  return { decision: "REVIEW", reason: "uncertain_relevance", relevance };
}

export function shouldDispatchCheapGate(result: CheapGateResult) {
  return result.decision === "KEEP" || result.decision === "REVIEW";
}

const INVITE_INPUT_RE =
  /(?:请|欢迎|麻烦|邀请|期待)[^。\n]{0,12}(?:补充|指正|把关|评估|看看|确认|发表|意见|视角)|其他(?:成员|同事|伙伴)|各位|大家(?:可以|来|一起|也)?(?:补充|看看|说说|聊聊)|(?:还需要|需要)[^。\n]{0,8}(?:补充|配合|协助)/u;

/**
 * The primary reply explicitly asks for others' input: names another group bot,
 * or uses an invitation phrase (「请…补充」「其他成员」「各位」…).
 */
export function primaryInvitesSupplementInput(params: {
  text: string;
  bots: readonly CollaborationBotTarget[];
  excludeAgentIds?: ReadonlySet<string>;
}): boolean {
  const text = params.text.trim();
  if (!text) {
    return false;
  }
  const namesPeer = params.bots.some((bot) => {
    if (params.excludeAgentIds?.has(bot.agentId.trim().toLowerCase())) {
      return false;
    }
    const name = bot.name?.trim();
    return Boolean(name && name.length >= 2 && text.includes(name));
  });
  return namesPeer || INVITE_INPUT_RE.test(text);
}
