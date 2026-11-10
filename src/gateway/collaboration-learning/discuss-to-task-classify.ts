/**
 * Deterministic understanding and field validation for controlled discuss→task
 * entry. Interaction understanding proposes structured goal, deliverables, and
 * acceptance from the original message (format markers may assist). Rules then
 * validate required fields and do not grant authority. Regex / marker lists
 * must not independently veto a complete natural-language delegation. Model may
 * assist extraction later.
 */

export type DiscussToTaskMissingField = "goal" | "deliverables_or_acceptance" | "delegation_focus";

export type DiscussToTaskClassification =
  | { kind: "discussion"; reason: "ordinary_discussion" }
  | {
      kind: "needs_clarification";
      reason: "ambiguous_delegation" | "missing_acceptance" | "multi_goal_unclear";
      titleHint?: string;
      goalHint?: string;
      deliverables?: string[];
      acceptanceHints?: string[];
      missingFields?: DiscussToTaskMissingField[];
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
/** Assistive section markers used to slice clauses — not a veto. */
const SECTION_MARKERS =
  /(?:验收标准|验收条件|验收：|验收:|验收|交付物：|交付物:|交付物|交付标准|完成标准|必须包含|要求：|要求:|交付：|交付:|acceptance\s*[:：]?)/i;
const MULTI_GOAL = /(?:另外|其次|同时(?:还要|也要)|第一[，,].*第二|一方面.*另一方面)/;
const AMBIGUOUS = /(?:看看|聊聊|讨论一下|随便|帮我想想|有什么建议|怎么样|如何是好)/;
const ARTIFACT_ITEM =
  /[一二三四五六七八九十两几若干\d]+\s*(?:份|篇|页|张|个|套|本|组)\s*[^，,。；;\n、与和以及]{1,40}/g;
const ACCEPTANCE_CLAUSE =
  /(?:必须|须由|不得|不要|严禁|应当|应该|完成审核|审核后再|使用附件|不访问|所有数字)/;

function compact(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function uniqueItems(items: string[], limit = 12): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of items) {
    const item = compact(raw);
    if (item.length < 2) {
      continue;
    }
    const key = item.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(item);
    if (out.length >= limit) {
      break;
    }
  }
  return out;
}

function firstLineTitle(message: string): string {
  const line =
    message
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find(Boolean) ?? message;
  return compact(line).slice(0, 80) || "未命名任务";
}

function firstSentence(message: string): string {
  const line =
    message
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find(Boolean) ?? message.trim();
  const sentence = line.split(/[。！？!?]/)[0]?.trim() || line;
  return compact(sentence);
}

function splitSentences(message: string): string[] {
  return message
    .split(/(?<=[。！？!?；;])\s*|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function extractBullets(message: string): string[] {
  const lines = message
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return lines
    .filter((l) => /^[-*•]/.test(l) || /^\d+[.)]/.test(l))
    .map((l) =>
      l
        .replace(/^[-*•]\s*/, "")
        .replace(/^\d+[.)]\s*/, "")
        .trim(),
    )
    .filter((l) => l.length >= 2);
}

function splitList(clause: string): string[] {
  return clause
    .split(/[，,、]|(?:\s*(?:以及|及)\s*)/)
    .map((s) => compact(s).replace(/^(?:以及|及|和)\s*/, "").trim())
    .filter((s) => s.length >= 2);
}

function extractMarkedClauses(message: string): string[] {
  if (!SECTION_MARKERS.test(message)) {
    return [];
  }
  const parts = message.split(SECTION_MARKERS).slice(1);
  const clauses: string[] = [];
  for (const part of parts) {
    const prose = part
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !/^[-*•]/.test(l) && !/^\d+[.)]/.test(l));
    if (prose[0]) {
      const sentence = prose[0].split(/[。！？!?]/)[0] ?? prose[0];
      clauses.push(compact(sentence).slice(0, 200));
    }
  }
  return clauses;
}

function extractListedDeliverables(scope: string): string[] {
  const fromColon = scope.match(/(?:交付|产出|提交|需要)[：:]\s*([^。！？!?\n]+)/);
  const listed = fromColon?.[1] ? splitList(fromColon[1]) : [];
  const artifacts = scope.match(new RegExp(ARTIFACT_ITEM.source, "g")) ?? [];
  return [...listed, ...artifacts.map((item) => compact(item))];
}

function extractIncludesDetails(message: string): string[] {
  const matches = message.match(/[^。！？!?\n]{1,40}包括[^。！？!?\n]+/g) ?? [];
  return matches.map((item) => compact(item));
}

function extractAcceptanceClauses(message: string): string[] {
  const out: string[] = [];
  for (const sentence of splitSentences(message)) {
    if (/^(?:交付|产出|提交|需要)[：:]/.test(sentence) && !ACCEPTANCE_CLAUSE.test(sentence)) {
      continue;
    }
    if (!ACCEPTANCE_CLAUSE.test(sentence)) {
      continue;
    }
    const bits = sentence
      .split(/[，,、]/)
      .map((bit) => compact(bit))
      .filter((bit) => ACCEPTANCE_CLAUSE.test(bit));
    if (bits.length > 0) {
      out.push(...bits);
    } else {
      out.push(compact(sentence));
    }
  }
  return out;
}

function endOfFirstSentence(message: string): number {
  const match = message.match(/[。！？!?\n]/);
  if (!match || match.index === undefined) {
    return message.length;
  }
  return match.index + 1;
}

export type DiscussToTaskProposal = {
  titleHint: string;
  goalHint: string;
  deliverables: string[];
  acceptanceHints: string[];
};

/**
 * Propose structured fields from the original message structure.
 * Newlines are kept for list extraction; compacting is only applied to
 * extracted items and to the title/goal strings.
 */
export function understandDiscussToTaskProposal(message: string): DiscussToTaskProposal {
  const raw = message.replace(/\r\n/g, "\n");
  const titleHint = (firstSentence(raw) || firstLineTitle(raw)).slice(0, 80) || "未命名任务";
  const goalHint = firstSentence(raw).slice(0, 240) || compact(raw).slice(0, 240);
  const remainder = raw.slice(endOfFirstSentence(raw));
  const deliverables = uniqueItems([
    ...extractBullets(raw),
    ...extractMarkedClauses(raw),
    ...extractListedDeliverables(remainder.length > 0 ? remainder : raw),
    ...extractIncludesDetails(raw),
  ]);
  const acceptance = uniqueItems([...deliverables, ...extractAcceptanceClauses(raw)]);
  return {
    titleHint,
    goalHint,
    deliverables,
    acceptanceHints: acceptance,
  };
}

function clarification(
  reason: "ambiguous_delegation" | "missing_acceptance" | "multi_goal_unclear",
  proposal: DiscussToTaskProposal,
  missingFields: DiscussToTaskMissingField[],
): Extract<DiscussToTaskClassification, { kind: "needs_clarification" }> {
  return {
    kind: "needs_clarification",
    reason,
    titleHint: proposal.titleHint || undefined,
    goalHint: proposal.goalHint || undefined,
    deliverables: proposal.deliverables.length > 0 ? proposal.deliverables : undefined,
    acceptanceHints: proposal.acceptanceHints.length > 0 ? proposal.acceptanceHints : undefined,
    missingFields,
  };
}

export function formatDiscussToTaskClarificationMessage(
  classification: Extract<DiscussToTaskClassification, { kind: "needs_clarification" }>,
): string {
  const understood: string[] = [];
  const goal = classification.goalHint?.trim();
  if (goal) {
    understood.push(`目标：${goal.slice(0, 80)}`);
  }
  if (classification.deliverables && classification.deliverables.length > 0) {
    understood.push(`交付物：${classification.deliverables.join("、")}`);
  }
  const extraAcceptance = (classification.acceptanceHints ?? []).filter(
    (item) => !(classification.deliverables ?? []).includes(item),
  );
  if (extraAcceptance.length > 0) {
    understood.push(`验收：${extraAcceptance.join("、")}`);
  }

  const labels: Record<DiscussToTaskMissingField, string> = {
    goal: "目标",
    deliverables_or_acceptance: "交付物或验收条件",
    delegation_focus: "单一委托目标",
  };
  const missing = (classification.missingFields ?? []).map((field) => labels[field]);

  if (understood.length === 0 && missing.length === 0) {
    return "委托意图尚不明确或缺少验收条件，请补充后再建立正式任务。";
  }
  const parts: string[] = [];
  if (understood.length > 0) {
    parts.push(`已理解：${understood.join("；")}。`);
  }
  if (missing.length > 0) {
    parts.push(`还缺少：${missing.join("、")}。请补充后再建立正式任务。`);
  } else {
    parts.push("请补充后再建立正式任务。");
  }
  return parts.join("");
}

/**
 * Classify an authenticated inbound user message for formal-task entry.
 * Ordinary chat → discussion; vague / multi-goal / missing acceptance → clarify;
 * clear team task ask with proposed deliverables or acceptance → explicit_delegation.
 */
export function classifyDiscussToTaskIntent(message: string): DiscussToTaskClassification {
  const raw = message.replace(/\r\n/g, "\n");
  const text = compact(raw);
  if (!text) {
    return { kind: "discussion", reason: "ordinary_discussion" };
  }
  const proposal = understandDiscussToTaskProposal(raw);
  const hasExplicit = EXPLICIT_VERBS.test(text);
  const hasTeam = TEAM_MARKERS.test(text);
  const acceptance = proposal.acceptanceHints;
  const looksAmbiguous = AMBIGUOUS.test(text) && !hasExplicit;

  if (looksAmbiguous || (!hasExplicit && !hasTeam)) {
    return { kind: "discussion", reason: "ordinary_discussion" };
  }
  if (hasExplicit && MULTI_GOAL.test(text) && acceptance.length < 2) {
    return clarification("multi_goal_unclear", proposal, ["delegation_focus"]);
  }
  if (hasExplicit && hasTeam && acceptance.length === 0) {
    return clarification("missing_acceptance", proposal, ["deliverables_or_acceptance"]);
  }
  if (hasExplicit && !hasTeam && acceptance.length === 0 && text.length < 40) {
    return clarification("ambiguous_delegation", proposal, ["deliverables_or_acceptance"]);
  }
  if (hasExplicit && (hasTeam || acceptance.length > 0)) {
    if (acceptance.length === 0) {
      return clarification("missing_acceptance", proposal, ["deliverables_or_acceptance"]);
    }
    return {
      kind: "explicit_delegation",
      reason: "explicit_team_task",
      titleHint: proposal.titleHint || firstLineTitle(raw),
      goalHint: proposal.goalHint || text.slice(0, 240),
      acceptanceHints: acceptance,
    };
  }
  if (hasExplicit) {
    return clarification("ambiguous_delegation", proposal, ["goal"]);
  }
  return { kind: "discussion", reason: "ordinary_discussion" };
}
