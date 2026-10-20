/**
 * Keyword classification is a discussion-template fallback only.
 * Do not add more routing rules here — P1 selection reads effective.strategy.
 */
import { classifyNumberedDecisionReply } from "./directed-decision-reply.js";
import type { ResolvedVisibleReplyLimit } from "./visible-reply-limit.js";

export type CollaborationResponseMode =
  | "single_owner"
  | "lead_plus_supplement"
  | "debate_or_brainstorm"
  | "decision_to_executor";

function normalizeMessageText(text: string) {
  return text.replace(/\s+/g, "").trim().toLowerCase();
}

export function classifySimpleKnowledgeQuestion(message: string) {
  const normalized = normalizeMessageText(message);
  if (!normalized || normalized.includes("@")) {
    return false;
  }
  const analysisSignals = [
    "分析",
    "比较",
    "讨论一下",
    "方案",
    "如何看",
    "怎么看",
    "评审",
    "头脑风暴",
  ];
  if (analysisSignals.some((signal) => normalized.includes(signal))) {
    return false;
  }
  const questionMarkers = ["?", "？"];
  const knowledgeSignals = [
    "谁知道",
    "是什么",
    "什么是",
    "由来",
    "什么意思",
    "定义",
    "解释一下",
    "有哪些",
    "谁了解",
    "谁知道",
  ];
  const hasQuestionMarker =
    questionMarkers.some((marker) => message.includes(marker)) ||
    knowledgeSignals.some((signal) => normalized.includes(signal));
  return hasQuestionMarker && knowledgeSignals.some((signal) => normalized.includes(signal));
}

export function classifyDebateOrBrainstormMessage(message: string) {
  const normalized = normalizeMessageText(message);
  if (!normalized) {
    return false;
  }
  const signals = [
    "讨论一下",
    "讨论下",
    "怎么看",
    "如何看",
    "头脑风暴",
    "各位意见",
    "大家意见",
    "评评",
    "评审",
    "批判",
    "辩论",
  ];
  return signals.some((signal) => normalized.includes(signal));
}

export function classifyLeadPlusSupplementMessage(message: string) {
  const normalized = normalizeMessageText(message);
  if (!normalized) {
    return false;
  }
  const signals = ["分析", "比较", "建议", "原因", "为什么", "方案", "拆解", "评估"];
  return signals.some((signal) => normalized.includes(signal));
}

export function resolveCollaborationResponseMode(params: {
  message: string;
  visibleLimit: ResolvedVisibleReplyLimit;
}): CollaborationResponseMode {
  if (classifyNumberedDecisionReply(params.message)) {
    return "decision_to_executor";
  }
  if (classifySimpleKnowledgeQuestion(params.message)) {
    return "single_owner";
  }
  if (
    classifyDebateOrBrainstormMessage(params.message) ||
    params.visibleLimit.mode === "group_broadcast"
  ) {
    return "debate_or_brainstorm";
  }
  if (
    classifyLeadPlusSupplementMessage(params.message) ||
    params.visibleLimit.mode === "focused_task"
  ) {
    return "lead_plus_supplement";
  }
  return "lead_plus_supplement";
}

export function resolveCoordinationWindowMs(responseMode: CollaborationResponseMode) {
  switch (responseMode) {
    case "single_owner":
      return 0;
    case "decision_to_executor":
      return 500;
    case "lead_plus_supplement":
      // Lead already awaits completion before supplement starts; extra wait
      // only delayed the first visible reply when live events were dropped.
      return 0;
    case "debate_or_brainstorm":
      return 2_500;
  }
}
