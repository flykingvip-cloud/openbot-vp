/**
 * Deterministic heuristics for controlled discuss→task entry.
 * Model may assist extraction later; classification here does not grant authority.
 */

export type DiscussToTaskClassification =
  | { kind: "discussion"; reason: "ordinary_discussion" }
  | {
      kind: "needs_clarification";
      reason: "ambiguous_delegation" | "missing_acceptance" | "multi_goal_unclear";
    }
  | {
      kind: "explicit_delegation";
      reason: "explicit_team_task";
      titleHint: string;
      goalHint: string;
      acceptanceHints: string[];
    };

const EXPLICIT_VERBS =
  /(?:请|麻烦|帮我|拜托)?(?:正式)?(?:建立|创建|启动|开展|执行|完成|交付|撰写|编写|研究|整理|汇总|产出|生成|制作)\s*(?:一个|一份|一篇)?/;
const TEAM_MARKERS = /(?:两名|两位|两个|多名|多位|团队|成员|协作|分工|认领|看板|正式任务|工作项)/;
const ACCEPTANCE_MARKERS =
  /(?:验收|验收标准|交付物|交付标准|完成标准|必须包含|要求：|要求:|acceptance)/i;
const MULTI_GOAL = /(?:另外|其次|同时(?:还要|也要)|第一[，,].*第二|一方面.*另一方面)/;
const AMBIGUOUS = /(?:看看|聊聊|讨论一下|随便|帮我想想|有什么建议|怎么样|如何是好)/;

function compact(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function firstLineTitle(message: string): string {
  const line =
    message
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find(Boolean) ?? message;
  return compact(line).slice(0, 80) || "未命名任务";
}

function extractAcceptance(message: string): string[] {
  const lines = message
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const fromBullets = lines
    .filter((l) => /^[-*•]/.test(l) || /^\d+[.)]/.test(l))
    .map((l) =>
      l
        .replace(/^[-*•]\s*/, "")
        .replace(/^\d+[.)]\s*/, "")
        .trim(),
    )
    .filter((l) => l.length >= 2);
  if (fromBullets.length > 0) {
    return fromBullets.slice(0, 8);
  }
  if (ACCEPTANCE_MARKERS.test(message)) {
    const after = message.split(ACCEPTANCE_MARKERS)[1] ?? "";
    const clause = compact(after).slice(0, 200);
    return clause ? [clause] : [];
  }
  return [];
}

/**
 * Classify an authenticated inbound user message for formal-task entry.
 * Ordinary chat → discussion; vague / multi-goal / missing acceptance → clarify;
 * clear team task ask with acceptance → explicit_delegation.
 */
export function classifyDiscussToTaskIntent(message: string): DiscussToTaskClassification {
  const text = compact(message);
  if (!text) {
    return { kind: "discussion", reason: "ordinary_discussion" };
  }
  const hasExplicit = EXPLICIT_VERBS.test(text);
  const hasTeam = TEAM_MARKERS.test(text);
  const acceptance = extractAcceptance(text);
  const looksAmbiguous = AMBIGUOUS.test(text) && !hasExplicit;

  if (looksAmbiguous || (!hasExplicit && !hasTeam)) {
    return { kind: "discussion", reason: "ordinary_discussion" };
  }
  if (hasExplicit && MULTI_GOAL.test(text) && acceptance.length < 2) {
    return { kind: "needs_clarification", reason: "multi_goal_unclear" };
  }
  if (hasExplicit && hasTeam && acceptance.length === 0) {
    return { kind: "needs_clarification", reason: "missing_acceptance" };
  }
  if (hasExplicit && !hasTeam && acceptance.length === 0 && text.length < 40) {
    return { kind: "needs_clarification", reason: "ambiguous_delegation" };
  }
  if (hasExplicit && (hasTeam || acceptance.length > 0)) {
    if (acceptance.length === 0) {
      return { kind: "needs_clarification", reason: "missing_acceptance" };
    }
    return {
      kind: "explicit_delegation",
      reason: "explicit_team_task",
      titleHint: firstLineTitle(text),
      goalHint: text.slice(0, 240),
      acceptanceHints: acceptance,
    };
  }
  if (hasExplicit) {
    return { kind: "needs_clarification", reason: "ambiguous_delegation" };
  }
  return { kind: "discussion", reason: "ordinary_discussion" };
}
