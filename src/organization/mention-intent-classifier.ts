import type { IntentSuggestion, MentionIntent, MentionMetadata } from "./mention-types.js";

export interface MentionIntentClassifierInput {
  messageText: string;
  mention: MentionMetadata;
}

const INTENT_PATTERNS: Array<{
  intent: Exclude<MentionIntent, "attention">;
  confidence: number;
  pattern: RegExp;
  reasoning: string;
}> = [
  {
    intent: "approval_request",
    confidence: 0.84,
    pattern: /(approve|approval|sign off|批准|审批|确认一下|同意|拍板)/i,
    reasoning: "Message asks for approval or sign-off.",
  },
  {
    intent: "review_request",
    confidence: 0.8,
    pattern: /(review|look over|检查|审核|评审|看一下|过目|验收)/i,
    reasoning: "Message asks a mentioned member to review something.",
  },
  {
    intent: "handoff",
    confidence: 0.78,
    pattern: /(handoff|hand off|transfer|交接|移交|转给|接手)/i,
    reasoning: "Message indicates a handoff or ownership transfer.",
  },
  {
    intent: "notification",
    confidence: 0.68,
    pattern: /(FYI|for your information|通知|同步|提醒|告知)/i,
    reasoning: "Message appears to notify the mentioned member.",
  },
  {
    intent: "task_assignment",
    confidence: 0.86,
    pattern:
      /(please|pls|请|麻烦|帮忙|负责|处理|完成|跟进|实现|修复|做一下|安排).{0,32}(@|\b)|(@.{0,32})(please|pls|请|麻烦|帮忙|负责|处理|完成|跟进|实现|修复|做一下|安排)/i,
    reasoning: "Message contains assignment-oriented wording near a mention.",
  },
];

function mentionWindow(input: MentionIntentClassifierInput): string {
  const start = Math.max(0, input.mention.offset - 48);
  const end = Math.min(input.messageText.length, input.mention.offset + input.mention.length + 96);
  return input.messageText.slice(start, end);
}

function normalizeSuggestion(suggestion: IntentSuggestion): IntentSuggestion {
  if (suggestion.confidence < 0.6) {
    return {
      intent: "attention",
      confidence: suggestion.confidence,
      reasoning: suggestion.reasoning,
    };
  }
  return suggestion;
}

export function classify(input: MentionIntentClassifierInput): IntentSuggestion {
  const window = mentionWindow(input);
  for (const entry of INTENT_PATTERNS) {
    if (entry.pattern.test(window) || entry.pattern.test(input.messageText)) {
      return normalizeSuggestion({
        intent: entry.intent,
        confidence: entry.confidence,
        reasoning: entry.reasoning,
      });
    }
  }
  return {
    intent: "attention",
    confidence: 0.5,
    reasoning: "No high-confidence action intent detected.",
  };
}

export const IntentClassifier = { classify };
