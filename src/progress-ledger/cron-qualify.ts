/**
 * Deterministic long-horizon qualification for ordinary cron text.
 * No model and no network: structured sections win, otherwise one acceptance
 * line is derived only when the text names a concrete deliverable.
 */

export type QualifiedCronIntent = {
  goal: string;
  acceptanceRules: string[];
};

const PLACEHOLDER_ACCEPTANCE =
  /^(?:（未设置.*|（请根据.*|\(未设置.*|见执行指令.*|见下方.*|见 cron payload.*|待补充|待定|暂无|无|tbd|todo|n\/a|none)$/i;

const VAGUE_REMINDER =
  /^(?:请)?(?:每天|每日|定时)?(?:记得|提醒(?:我|一下)?|别忘了|不要忘记|remind(?:\s+me)?|ping|喝水|站会|开会)(?:一下|我)?[。.!！\s]*$/i;

const DELIVERABLE_ZH =
  /(?:生成|产出|写出|撰写|编写|整理成|汇总成|保存为|导出|写入|交付|写下|输出一[份个篇张])(?:一[份个篇张])?[^。\n]{0,48}?(?:[\u4e00-\u9fffA-Za-z0-9_-]{0,30}(?:报告|日报|周报|月报|纪要|会议纪要|摘要|文档|表格|清单|列表|价差表|比价表|对比表|文件|草稿|方案|复盘)|readme\b|[\w./-]+\.(?:md|csv|xlsx|xls|docx|pdf|json|txt)\b)/i;

const DELIVERABLE_EN =
  /\b(?:write|generate|produce|export|save|deliver|create|compile)\b[^.\n]{0,80}\b(?:[\w./-]+\.(?:md|csv|xlsx|xls|docx|pdf|json|txt)\b|report|summary|spreadsheet|readme)\b/i;

const LABELED_DELIVERABLE = /^(?:交付物|成果|产出)\s*[:：]\s*(.+)$/;

type SectionKind = "goal" | "acceptance" | "instruction" | "other";

function clip(text: string, max = 180): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) {
    return normalized;
  }
  return `${normalized.slice(0, max - 1).trim()}…`;
}

function normalizeAcceptanceLine(line: string): string {
  return line
    .trim()
    .replace(/^\d+\s*[.、)）]\s*/, "")
    .replace(/^[-*•]\s*(?:\[[ xX]\]\s*)?/, "")
    .trim();
}

function isPlaceholderGoal(text: string): boolean {
  const trimmed = text.trim();
  return (
    /^（(?:请根据|未设置)/.test(trimmed) ||
    /^(?:tbd|todo|n\/a)$/i.test(trimmed) ||
    trimmed.length < 2
  );
}

export function isConcreteAcceptanceLine(line: string): boolean {
  const text = normalizeAcceptanceLine(line);
  if (text.length < 2) {
    return false;
  }
  if (PLACEHOLDER_ACCEPTANCE.test(text)) {
    return false;
  }
  if (/请确保输出满足定时说明/.test(text)) {
    return false;
  }
  if (VAGUE_REMINDER.test(text)) {
    return false;
  }
  return true;
}

function matchSection(line: string): { kind: SectionKind; rank: number; rest: string } | null {
  const trimmed = line.trim();
  const heading = trimmed.match(/^#{1,6}\s*(.+)$/);
  const body = (heading ? heading[1] : trimmed).trim();
  const matched = body.match(
    /^(定时说明|任务目标|目标|goal|执行指令|instruction|验收标准|验收条件|验收|acceptance(?:\s+criteria)?|数据绑定|数据依赖|交付说明)\s*[:：]?\s*(.*)$/i,
  );
  if (!matched) {
    return null;
  }
  const label = matched[1] ?? "";
  const rest = (matched[2] ?? "").trim();
  const hasColon = /[:：]/.test(body.slice(label.length));
  if (!heading && !hasColon && body.toLowerCase() !== label.toLowerCase()) {
    return null;
  }
  const token = label.toLowerCase();
  if (/验收|acceptance/.test(token)) {
    return { kind: "acceptance", rank: 0, rest };
  }
  if (/执行指令|instruction/.test(token)) {
    return { kind: "instruction", rank: 0, rest };
  }
  if (/数据|交付说明/.test(token)) {
    return { kind: "other", rank: 0, rest };
  }
  const rank = /任务目标|^goal$/i.test(label) ? 2 : 1;
  return { kind: "goal", rank, rest };
}

function extractStructured(text: string): {
  goal: string;
  instruction: string;
  acceptance: string[];
} {
  let mode: SectionKind | null = null;
  let goalRank = 0;
  let bestRank = 0;
  let bestGoal: string[] = [];
  let goalLines: string[] = [];
  const instructionLines: string[] = [];
  const acceptance: string[] = [];

  const flushGoal = () => {
    if (goalLines.length === 0) {
      return;
    }
    if (goalRank >= bestRank) {
      bestRank = goalRank;
      bestGoal = goalLines;
    }
    goalLines = [];
  };

  for (const raw of text.split(/\r?\n/)) {
    const section = matchSection(raw);
    if (section) {
      if (mode === "goal") {
        flushGoal();
      }
      mode = section.kind;
      if (section.kind === "goal") {
        goalRank = section.rank;
        goalLines = [];
        if (section.rest) {
          goalLines.push(section.rest);
        }
      } else if (
        section.kind === "acceptance" &&
        section.rest &&
        isConcreteAcceptanceLine(section.rest)
      ) {
        acceptance.push(normalizeAcceptanceLine(section.rest));
      } else if (section.kind === "instruction" && section.rest) {
        instructionLines.push(section.rest);
      }
      continue;
    }
    const line = raw.trim();
    if (!line) {
      continue;
    }
    if (mode === "goal") {
      goalLines.push(line);
    } else if (mode === "instruction") {
      instructionLines.push(line);
    } else if (mode === "acceptance" && isConcreteAcceptanceLine(line)) {
      acceptance.push(normalizeAcceptanceLine(line));
    }
  }
  if (mode === "goal") {
    flushGoal();
  }

  const seen = new Set<string>();
  const uniqueAcceptance = acceptance.filter((line) => {
    if (seen.has(line)) {
      return false;
    }
    seen.add(line);
    return true;
  });
  return {
    goal: clip(bestGoal.join(" "), 200),
    instruction: instructionLines.join("\n").trim(),
    acceptance: uniqueAcceptance,
  };
}

function isNegatedBefore(sentence: string, index: number): boolean {
  const before = sentence.slice(Math.max(0, index - 12), index);
  return /(?:不要|别|无需|不用|禁止|do not|don't|never)\s*$/i.test(before);
}

function deriveAcceptanceLine(text: string): string | null {
  const sentences = text
    .split(/\r?\n|。|；|;/)
    .map((part) => part.trim())
    .filter(Boolean);
  for (const sentence of sentences) {
    if (matchSection(sentence)) {
      continue;
    }
    const labeled = sentence.match(LABELED_DELIVERABLE);
    if (labeled?.[1] && isConcreteAcceptanceLine(labeled[1])) {
      return clip(labeled[1]);
    }
    const zh = sentence.match(DELIVERABLE_ZH);
    const en = zh ? null : sentence.match(DELIVERABLE_EN);
    const found = zh ?? en;
    if (!found || found.index === undefined || isNegatedBefore(sentence, found.index)) {
      continue;
    }
    const line = sentence.length <= 180 ? sentence : found[0];
    if (isConcreteAcceptanceLine(line)) {
      return clip(line);
    }
  }
  return null;
}

function firstSubstantiveLine(text: string): string {
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || matchSection(line) || /^#{1,6}\s/.test(line)) {
      continue;
    }
    const normalized = normalizeAcceptanceLine(line);
    if (!normalized || isPlaceholderGoal(normalized) || VAGUE_REMINDER.test(normalized)) {
      continue;
    }
    return clip(normalized, 120);
  }
  return "";
}

function isVagueReminder(text: string): boolean {
  return VAGUE_REMINDER.test(text.replace(/\s+/g, " ").trim());
}

/**
 * Qualify free-form cron copy.
 * `goalHint` is an already-parsed field (personal meta goal) and wins over
 * inferred goals. Structured 定时说明 / 验收标准 win over deliverable derivation.
 */
export function qualifyOrdinaryCronTexts(
  texts: readonly string[],
  goalHint = "",
): QualifiedCronIntent | null {
  let goal = goalHint.trim();
  let acceptance: string[] = [];
  const instructions: string[] = [];
  for (const text of texts) {
    const trimmed = text.trim();
    if (!trimmed) {
      continue;
    }
    const structured = extractStructured(trimmed);
    if (!goal && structured.goal && !isPlaceholderGoal(structured.goal)) {
      goal = structured.goal;
    }
    if (acceptance.length === 0 && structured.acceptance.length > 0) {
      acceptance = structured.acceptance;
    }
    if (structured.instruction) {
      instructions.push(structured.instruction);
    }
  }
  if (acceptance.length > 0) {
    if (!goal) {
      for (const text of texts) {
        const line = firstSubstantiveLine(text);
        if (line) {
          goal = line;
          break;
        }
      }
    }
    if (goal) {
      return { goal, acceptanceRules: acceptance };
    }
  }

  const derived = deriveAcceptanceLine([...instructions, ...texts].join("\n"));
  if (!derived) {
    return null;
  }
  if (!goal || isVagueReminder(goal) || isPlaceholderGoal(goal)) {
    goal = clip(derived, 120);
  }
  if (!goal) {
    return null;
  }
  return { goal, acceptanceRules: [derived] };
}
