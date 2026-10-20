/**
 * Expert recommendation #4: explicit knowledge recovery entry for collaboration.
 *
 * Phrases like「按前面约定」「继续上次任务」prefer retrieve of the current group
 * task + group-authorized materials. Private long-term memory still requires
 * explicit promote into GROUP_PUBLIC (P3 invariant).
 *
 * Flag collaboration.explicitKnowledgeRecovery default OFF — does not break
 * group minimal safety when unset.
 */

import type { OpenBotConfig } from "../../config/config.js";

const RECOVERY_INTENT_RE =
  /按前面约定|按上次约定|按约定(?:继续|执行|做)|继续上次任务|继续上次|按上次(?:的)?(?:任务|约定|方案)|沿用上次|as previously agreed|continue(?:\s+the)?\s+last\s+task|per(?:\s+our)?\s+agreement|follow(?:\s+the)?\s+prior\s+agreement/iu;

export function isCollaborationExplicitKnowledgeRecoveryEnabled(
  cfg?: OpenBotConfig | null,
): boolean {
  if (cfg?.collaboration?.explicitKnowledgeRecovery === true) {
    return true;
  }
  const raw = process.env.OPENBOT_COLLAB_EXPLICIT_KNOWLEDGE_RECOVERY?.trim().toLowerCase();
  if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") {
    return true;
  }
  return false;
}

/** True when the user utterance asks to recover prior agreement / last task. */
export function detectExplicitCollabKnowledgeRecoveryIntent(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }
  return RECOVERY_INTENT_RE.test(trimmed);
}

/**
 * Soft UI / system hint: retrieve & share stay explicit; private memory needs promote.
 */
export function formatCollaborationKnowledgeRecoveryHint(): string {
  return "已识别「按前面约定／继续上次任务」：将优先检索当前群任务与群授权资料。私有长期记忆仍须显式 promote 后才会进入群共享。";
}
