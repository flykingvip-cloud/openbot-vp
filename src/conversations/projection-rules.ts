/**
 * Rule-based signal extraction for Conversation Projection (CL-P2-02).
 * Prefer deterministic extraction over model summaries. Every retained
 * decision/task/constraint must carry evidenceRefs when marked APPROVED.
 */
import { createHash } from "node:crypto";

export type ExtractedDecision = {
  id: string;
  text: string;
  status: "PROPOSED" | "APPROVED" | "REJECTED" | "SUPERSEDED";
  evidenceRefs: string[];
};

export type ExtractedConstraint = { text: string; evidenceRefs: string[] };
export type ExtractedTask = {
  text: string;
  ownerId: string | null;
  dueAt: string | null;
  evidenceRefs: string[];
};
export type ExtractedImportant = { text: string; evidenceRefs: string[] };

export type ProjectionSignals = {
  goal: string | null;
  shortSummary: string;
  decisions: ExtractedDecision[];
  constraints: ExtractedConstraint[];
  pendingTasks: ExtractedTask[];
  importantContext: ExtractedImportant[];
};

const DECISION_RE =
  /\b(decided|decision|we will|we'll|同意|决定|确认|approved|agreed)\b[:\s]+(.{8,160})/gi;
const TASK_RE =
  /\b(todo|task|action item|follow[- ]?up|请|需要|待办|remember to|must)\b[:\s]+(.{8,160})/gi;
const CONSTRAINT_RE =
  /\b(must not|cannot|don't|do not|never|禁止|不得|约束|constraint|hard limit)\b[:\s]+(.{8,160})/gi;
const DATE_RE =
  /\b(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}(\/\d{2,4})?|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|周一|周二|周三|周四|周五|周六|周日|明天|下周|this week|next week|by Friday|by Monday)\b/gi;
const MONEY_RE =
  /(?:USD|CNY|RMB|\$|¥|€)\s?[\d,]+(?:\.\d+)?|\b\d+(?:\.\d+)?\s?(?:usd|cny|rmb|dollars?|yuan)\b/gi;
const ID_RE = /\b(?:conv_|msrc_|req_|ORD-|ID[:\s-]?)[a-zA-Z0-9._-]{4,}\b/g;

function stableId(prefix: string, text: string): string {
  return `${prefix}_${createHash("sha256").update(text).digest("hex").slice(0, 12)}`;
}

function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) {
    return t;
  }
  return `${t.slice(0, max - 3)}...`;
}

function pushUnique(list: Array<{ text: string }>, text: string, max = 8): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized || list.some((x) => x.text.trim().toLowerCase() === normalized)) {
    return false;
  }
  if (list.length >= max) {
    return false;
  }
  return true;
}

/**
 * Extract product signals from user/assistant texts.
 * `evidenceRefs` are source identity ids provided by the caller for this text batch.
 */
export function extractProjectionSignals(params: {
  userTexts: string[];
  assistantTexts?: string[];
  evidenceRefs: string[];
}): ProjectionSignals {
  const refs = [...new Set(params.evidenceRefs.filter(Boolean))];
  const allUser = params.userTexts.map((t) => t.trim()).filter(Boolean);
  const allAsst = (params.assistantTexts ?? []).map((t) => t.trim()).filter(Boolean);
  const corpus = [...allUser, ...allAsst].join("\n");

  const first = allUser[0] ?? allAsst[0] ?? "";
  const goal = first ? clip(first, 120) : null;
  const shortSummary = first ? clip(first, 240) : "No summary yet.";

  const decisions: ExtractedDecision[] = [];
  const constraints: ExtractedConstraint[] = [];
  const pendingTasks: ExtractedTask[] = [];
  const importantContext: ExtractedImportant[] = [];

  const scan = (text: string, evidence: string[]) => {
    let m: RegExpExecArray | null;
    DECISION_RE.lastIndex = 0;
    while ((m = DECISION_RE.exec(text)) !== null) {
      const body = clip(m[2] ?? m[0] ?? "", 160);
      if (!pushUnique(decisions, body)) {
        continue;
      }
      // Rule extractor never auto-APPROVES without explicit "approved/agreed" + evidence.
      const approved =
        /\b(approved|agreed|confirmed|确认|同意)\b/i.test(m[1] ?? "") && evidence.length > 0;
      decisions.push({
        id: stableId("dec", body),
        text: body,
        status: approved ? "APPROVED" : "PROPOSED",
        evidenceRefs: evidence.length > 0 ? evidence : [],
      });
    }
    TASK_RE.lastIndex = 0;
    while ((m = TASK_RE.exec(text)) !== null) {
      const body = clip(m[2] ?? m[0] ?? "", 160);
      if (!pushUnique(pendingTasks, body)) {
        continue;
      }
      const dueMatch = body.match(DATE_RE);
      pendingTasks.push({
        text: body,
        ownerId: null,
        dueAt: dueMatch?.[0] ?? null,
        evidenceRefs: evidence,
      });
    }
    CONSTRAINT_RE.lastIndex = 0;
    while ((m = CONSTRAINT_RE.exec(text)) !== null) {
      const body = clip(m[2] ?? m[0] ?? "", 160);
      if (!pushUnique(constraints, body)) {
        continue;
      }
      constraints.push({ text: body, evidenceRefs: evidence });
    }
  };

  for (const t of allUser) {
    scan(t, refs);
  }
  for (const t of allAsst) {
    scan(t, refs);
  }

  // Important facts: dates, money, ids — only when we have evidence.
  if (refs.length > 0) {
    const dates = corpus.match(DATE_RE) ?? [];
    const monies = corpus.match(MONEY_RE) ?? [];
    const ids = corpus.match(ID_RE) ?? [];
    for (const d of [...new Set(dates)].slice(0, 4)) {
      const text = `Date/deadline: ${d}`;
      if (pushUnique(importantContext, text)) {
        importantContext.push({ text, evidenceRefs: refs });
      }
    }
    for (const money of [...new Set(monies)].slice(0, 3)) {
      const text = `Amount: ${money}`;
      if (pushUnique(importantContext, text)) {
        importantContext.push({ text, evidenceRefs: refs });
      }
    }
    for (const id of [...new Set(ids)].slice(0, 4)) {
      const text = `Identifier: ${id}`;
      if (pushUnique(importantContext, text)) {
        importantContext.push({ text, evidenceRefs: refs });
      }
    }
    if (importantContext.length === 0 && shortSummary !== "No summary yet.") {
      importantContext.push({ text: shortSummary, evidenceRefs: refs });
    }
  }

  // Fail-closed: demote any APPROVED without evidence.
  for (const d of decisions) {
    if (d.status === "APPROVED" && d.evidenceRefs.length === 0) {
      d.status = "PROPOSED";
    }
  }

  return {
    goal,
    shortSummary,
    decisions: decisions.slice(0, 8),
    constraints: constraints.slice(0, 8),
    pendingTasks: pendingTasks.slice(0, 8),
    importantContext: importantContext.slice(0, 12),
  };
}
