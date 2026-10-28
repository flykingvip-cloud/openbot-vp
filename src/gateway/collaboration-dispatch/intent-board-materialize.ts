/**
 * P1/S1 — Intent → shared board draft / publish (no second orchestrator).
 *
 * Detects long goals or explicit deliverable+deadline utterances and builds a
 * GroupBoardClaim publish draft (Goal / Acceptance / Constraints / Due /
 * suggested claimant). Default path asks for human confirm before publish.
 * Oral chat alone never becomes a board fact (`oralDispatchCreatesBoardFact`).
 *
 * FINAL v3 §C / S1 quality gate:
 * - Intent materialize yields a **draft** only; missing key fields → needs_confirm.
 * - Do **not** fake a complete contract with generic default Acceptance text.
 * - Fuzzy due words → duePendingConfirm (hint only), never silent exact deadline.
 * - challengeWindow ON → needs_challenge before publish (reuse challenge-window).
 */
import type { OpenBotConfig } from "../../config/types.js";
import { isCollabTaskChallengeWindowEnabled } from "./challenge-window.js";
import {
  isCollabTaskClaimContractEnabled,
  oralDispatchCreatesBoardFact,
  publishBoardItem,
  type GroupBoardClaimItem,
  type PublishBoardItemInput,
} from "./claim-contract.js";
import type { RuntimeAuthority } from "./runtime-authority.js";

const DELIVERABLE_RE =
  /交付|报告|PPT|稿件|方案|清单|纪要|调研|复盘|说明|成果|连通|charter|deliverables?\/|\.md\b|deliverable|report|deck|slide/iu;
const DEADLINE_RE =
  /截止|今晚|明天|后天|本周|下周|小时内|今晚前|之前完成|今日|今天|due\b|deadline|by\s+\d/iu;
const TASK_VERB_RE =
  /请|需要|负责|认领|完成|提交|整理|撰写|产出|跟进|落地|执行|研发|分析|写入|落盘|创建|写\s/u;
/** Path-shaped short tasks (e.g. F4 charter.md → deliverables/) count as board-worthy. */
const DELIVERABLE_PATH_RE = /deliverables?\/|\bcharter\.md\b|团队成果目录/iu;
/** Soft platform reminders — never enough alone to pass Constraints quality. */
const SOFT_CONSTRAINT_DEFAULTS = ["不得用口头派工代替看板事实", "外发/终裁仍须人确认"] as const;
/** Generic Acceptance fillers that must not masquerade as a verified contract. */
const GENERIC_ACCEPTANCE_RE = /^(产出满足目标：|主答可按 Acceptance 判定完成)/u;

export type BoardContractQualityIssue =
  | "goal_not_delivery"
  | "acceptance_missing"
  | "acceptance_non_verifiable"
  | "constraints_thin"
  | "due_unreliable";

export type BoardContractQuality = {
  ok: boolean;
  issues: BoardContractQualityIssue[];
  duePendingConfirm: boolean;
};

export type BoardPublishDraft = {
  groupId: string;
  taskId: string;
  title: string;
  goal: string;
  remainingWork: string;
  /** Explicit / human-provided Acceptance only — never auto-filled generics. */
  acceptanceCriteria: string[];
  /**
   * Soft UI hints when Acceptance is missing. NOT part of the board contract
   * and must not be published as acceptanceCriteria.
   */
  suggestedAcceptanceHints?: string[];
  constraints: string[];
  /** Exact due only when caller supplied dueAtMs. */
  dueAtMs?: number;
  /** Fuzzy-inferred hint; requires confirm (FINAL v3 §C). */
  dueSuggestedMs?: number;
  duePendingConfirm: boolean;
  intendedClaimantIds: string[];
  suggestedRole?: string;
  publishedBy: string;
  requiresHumanConfirm: boolean;
  reason: string;
  quality: BoardContractQuality;
};

export type BoardIntentMaterializeInput = {
  message: string;
  groupId: string;
  taskId: string;
  publishedBy: string;
  title?: string;
  /** Optional explicit delivery goal (preferred over raw chat as Goal). */
  goal?: string;
  suggestedClaimantIds?: readonly string[];
  suggestedRole?: string;
  constraints?: readonly string[];
  acceptanceCriteria?: readonly string[];
  dueAtMs?: number;
  /** Default true — return needs_confirm unless humanConfirmed. */
  requireHumanConfirm?: boolean;
  humanConfirmed?: boolean;
  nowMs?: number;
  /**
   * P5/S1: when challengeWindow flag ON, pass a resolved|skipped window id
   * (or set skipChallengeWindow) before publish.
   */
  challengeWindowId?: string;
  /** P5 per-item 可关. */
  skipChallengeWindow?: boolean;
};

export type MaterializeIntentResult =
  | { status: "skipped"; reason: string }
  | {
      status: "needs_confirm";
      draft: BoardPublishDraft;
      qualityIssues: BoardContractQualityIssue[];
    }
  | { status: "needs_challenge"; draft: BoardPublishDraft; reason: string }
  | { status: "published"; draft: BoardPublishDraft; item: GroupBoardClaimItem }
  | { status: "flag_off"; draft: BoardPublishDraft; reason: string };

function compact(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function unique(values: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values ?? []) {
    const id = compact(value);
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** True when message looks like a board-worthy intent (not chitchat). */
export function detectBoardMaterializeCandidate(message: string): boolean {
  const text = compact(message);
  if (!text) {
    return false;
  }
  const hasDeliverable = DELIVERABLE_RE.test(text);
  const hasDeadline = DEADLINE_RE.test(text);
  const hasTaskVerb = TASK_VERB_RE.test(text);
  const hasDeliverablePath = DELIVERABLE_PATH_RE.test(text);
  const longGoal = text.length >= 40 && hasTaskVerb;
  const pathTask = hasDeliverablePath && (hasTaskVerb || text.length >= 24);
  return (hasDeliverable && hasDeadline) || (hasDeliverable && hasTaskVerb) || longGoal || pathTask;
}

/**
 * Pull explicit Acceptance lines from the intent text when the caller omitted
 * acceptanceCriteria. Never invents generic fillers (§C).
 */
export function extractExplicitAcceptanceFromMessage(message: string): string[] {
  const text = compact(message);
  if (!text) {
    return [];
  }
  const out: string[] = [];
  const push = (value: string) => {
    const v = compact(value);
    if (!v || GENERIC_ACCEPTANCE_RE.test(v) || out.includes(v)) {
      return;
    }
    out.push(v);
  };
  for (const line of text.split(/\n+/)) {
    const m = line.match(/(?:验收|Acceptance)\s*[：:]\s*(.+)$/iu);
    if (m?.[1]) {
      push(m[1]);
    }
  }
  if (/writtenToGroupDir\s*=\s*true/iu.test(text)) {
    push("charter/交付物落入团队成果目录且 writtenToGroupDir=true，可 sha 核对");
  } else if (/可\s*sha\s*核对/iu.test(text) && DELIVERABLE_PATH_RE.test(text)) {
    push("交付物落在团队成果目录（或正式 locator），可 sha 核对");
  }
  return out;
}

/** Soft constraint lines already stated in the intent (禁止… / Constraints：…). */
export function extractExplicitConstraintsFromMessage(message: string): string[] {
  const text = compact(message);
  if (!text) {
    return [];
  }
  const out: string[] = [];
  const push = (value: string) => {
    const v = compact(value);
    if (!v || out.includes(v)) {
      return;
    }
    out.push(v);
  };
  for (const line of text.split(/\n+/)) {
    const labeled = line.match(/(?:Constraints|约束)\s*[：:]\s*(.+)$/iu);
    if (labeled?.[1]) {
      push(labeled[1]);
      continue;
    }
    if (line.trim().startsWith("禁止") || /不扩权|不要外发|不要改无关/.test(line)) {
      push(line.trim());
    }
  }
  // Compact inline 禁止 A/B/C clauses.
  const inline = text.match(/禁止[^。\n]{2,80}/gu);
  if (inline) {
    for (const clause of inline) {
      push(clause);
    }
  }
  return out;
}

function inferDueAtMs(message: string, nowMs: number): number | undefined {
  const text = message;
  if (/今晚|今天晚上|tonight|今日|今天(?!晚上)/iu.test(text)) {
    const d = new Date(nowMs);
    d.setHours(23, 59, 0, 0);
    return d.getTime();
  }
  if (/明天|tomorrow/iu.test(text)) {
    return nowMs + 24 * 60 * 60 * 1000;
  }
  if (/后天/u.test(text)) {
    return nowMs + 48 * 60 * 60 * 1000;
  }
  if (/本周|this\s*week/iu.test(text)) {
    return nowMs + 7 * 24 * 60 * 60 * 1000;
  }
  if (/下周|next\s*week/iu.test(text)) {
    return nowMs + 14 * 24 * 60 * 60 * 1000;
  }
  const hours = text.match(/(\d+)\s*小时内/);
  if (hours) {
    return nowMs + Number(hours[1]) * 60 * 60 * 1000;
  }
  return undefined;
}

/** Soft hints only — never written into acceptanceCriteria. */
function suggestedAcceptanceHintsFor(goal: string): string[] {
  return [`产出满足目标：${goal.slice(0, 80)}`, "主答可按 Acceptance 判定完成（非草稿闲聊）"];
}

function softConstraintDefaults(message: string): string[] {
  const out: string[] = [...SOFT_CONSTRAINT_DEFAULTS];
  if (/来源|引用|citation|source/iu.test(message)) {
    out.push("必须带来源/引用");
  }
  if (/PPT|幻灯|deck|slide/iu.test(message)) {
    out.push("交付物须为 PPT/幻灯格式");
  }
  return out;
}

function draftTitle(goal: string, explicit?: string): string {
  const t = compact(explicit);
  if (t) {
    return t.slice(0, 120);
  }
  const firstLine = goal.split(/[\n。！？!?]/u)[0]?.trim() || goal;
  return firstLine.slice(0, 80);
}

/**
 * FINAL v3 §C — draft quality. Missing / generic / fuzzy fields fail closed
 * into needs_confirm; never treat soft defaults as a complete contract.
 */
export function assessBoardContractQuality(params: {
  goal: string;
  message: string;
  acceptanceCriteria: readonly string[];
  constraints: readonly string[];
  dueAtMs?: number;
  duePendingConfirm: boolean;
  /** True when Goal was taken from raw chat without an explicit goal override. */
  goalFromRawChat: boolean;
}): BoardContractQuality {
  const issues: BoardContractQualityIssue[] = [];
  const goal = compact(params.goal);
  if (!goal || (!DELIVERABLE_RE.test(goal) && params.goalFromRawChat)) {
    // Raw chat without a clear deliverable noun is not a delivery Goal.
    if (!DELIVERABLE_RE.test(goal)) {
      issues.push("goal_not_delivery");
    }
  }
  const acceptance = unique(params.acceptanceCriteria);
  if (acceptance.length === 0) {
    issues.push("acceptance_missing");
  } else if (acceptance.every((a) => GENERIC_ACCEPTANCE_RE.test(a))) {
    issues.push("acceptance_non_verifiable");
  }
  const constraints = unique(params.constraints);
  const softOnly = constraints.every((c) =>
    (SOFT_CONSTRAINT_DEFAULTS as readonly string[]).includes(c),
  );
  if (softOnly) {
    issues.push("constraints_thin");
  }
  if (
    params.duePendingConfirm ||
    (DEADLINE_RE.test(params.message) && params.dueAtMs === undefined)
  ) {
    issues.push("due_unreliable");
  }
  return {
    ok: issues.length === 0,
    issues,
    duePendingConfirm: params.duePendingConfirm,
  };
}

/**
 * Build a publish draft from human/organizer intent text.
 * Returns null when the utterance should stay Mode A discussion.
 * Does **not** inject generic Acceptance into the contract fields.
 */
export function buildBoardPublishDraftFromIntent(
  input: BoardIntentMaterializeInput,
): BoardPublishDraft | null {
  const message = compact(input.message);
  const groupId = compact(input.groupId);
  const taskId = compact(input.taskId);
  const publishedBy = compact(input.publishedBy);
  if (!message || !groupId || !taskId || !publishedBy) {
    return null;
  }
  const explicitContract =
    Boolean(compact(input.goal)) && unique(input.acceptanceCriteria).length > 0;
  if (!detectBoardMaterializeCandidate(message) && !explicitContract) {
    return null;
  }
  // Freeze: oral path never invents a board fact by itself.
  void oralDispatchCreatesBoardFact();
  const nowMs = input.nowMs ?? Date.now();
  const explicitGoal = compact(input.goal);
  const goalFromRawChat = !explicitGoal;
  const goal = explicitGoal || message.replace(/\s+/g, " ").trim();
  const acceptance = unique(
    (input.acceptanceCriteria?.length ?? 0) > 0
      ? input.acceptanceCriteria
      : extractExplicitAcceptanceFromMessage(message),
  );
  const explicitConstraints = unique(
    (input.constraints?.length ?? 0) > 0
      ? input.constraints
      : extractExplicitConstraintsFromMessage(message),
  );
  const constraints =
    explicitConstraints.length > 0 ? explicitConstraints : softConstraintDefaults(message);
  const explicitDue =
    typeof input.dueAtMs === "number" && Number.isFinite(input.dueAtMs) ? input.dueAtMs : undefined;
  const fuzzyDue = explicitDue === undefined ? inferDueAtMs(message, nowMs) : undefined;
  const duePendingConfirm = explicitDue === undefined && fuzzyDue !== undefined;
  const requiresHumanConfirm = input.requireHumanConfirm !== false;
  const quality = assessBoardContractQuality({
    goal,
    message,
    acceptanceCriteria: acceptance,
    constraints,
    dueAtMs: explicitDue,
    duePendingConfirm,
    goalFromRawChat,
  });
  return {
    groupId,
    taskId,
    title: draftTitle(goal, input.title),
    goal,
    remainingWork: goal,
    acceptanceCriteria: acceptance,
    suggestedAcceptanceHints:
      acceptance.length === 0 ? suggestedAcceptanceHintsFor(goal) : undefined,
    constraints,
    dueAtMs: explicitDue,
    dueSuggestedMs: fuzzyDue,
    duePendingConfirm,
    intendedClaimantIds: unique(input.suggestedClaimantIds),
    suggestedRole: compact(input.suggestedRole) || undefined,
    publishedBy,
    requiresHumanConfirm,
    reason:
      DELIVERABLE_RE.test(message) && DEADLINE_RE.test(message)
        ? "deliverable_and_deadline"
        : "long_goal_or_task_verb",
    quality,
  };
}

export function draftToPublishInput(
  draft: BoardPublishDraft,
  extras?: { challengeWindowId?: string; skipChallengeWindow?: boolean },
): PublishBoardItemInput {
  return {
    groupId: draft.groupId,
    taskId: draft.taskId,
    title: draft.title,
    remainingWork: draft.remainingWork,
    acceptanceCriteria: draft.acceptanceCriteria,
    goal: draft.goal,
    constraints: draft.constraints,
    dueAtMs: draft.dueAtMs,
    suggestedRole: draft.suggestedRole,
    intendedClaimantIds: draft.intendedClaimantIds,
    publishedBy: draft.publishedBy,
    challengeWindowId: extras?.challengeWindowId,
    skipChallengeWindow: extras?.skipChallengeWindow,
  };
}

/**
 * Materialize intent → draft → quality/confirm → (optional challenge) → publish.
 * Skips when not a candidate; needs_confirm when confirm gate or §C quality fails;
 * flag_off when claimContract / allowlist closed for the group.
 */
export async function materializeIntentToBoardItem(params: {
  authority: RuntimeAuthority;
  input: BoardIntentMaterializeInput;
  cfg?: OpenBotConfig;
}): Promise<MaterializeIntentResult> {
  let draft = buildBoardPublishDraftFromIntent(params.input);
  if (!draft) {
    return { status: "skipped", reason: "not_a_board_candidate" };
  }
  const requireConfirm = draft.requiresHumanConfirm;
  const confirmed = params.input.humanConfirmed === true;
  // humanConfirmed on activate means the board-publish contract (incl. fuzzy Due)
  // was already accepted; promote suggested due so quality can pass without
  // inventing Acceptance. Todolist card remains the human gate for execution.
  if (
    confirmed &&
    draft.dueAtMs === undefined &&
    typeof draft.dueSuggestedMs === "number" &&
    Number.isFinite(draft.dueSuggestedMs)
  ) {
    draft = {
      ...draft,
      dueAtMs: draft.dueSuggestedMs,
      duePendingConfirm: false,
      quality: assessBoardContractQuality({
        goal: draft.goal,
        message: compact(params.input.message),
        acceptanceCriteria: draft.acceptanceCriteria,
        constraints: draft.constraints,
        dueAtMs: draft.dueSuggestedMs,
        duePendingConfirm: false,
        goalFromRawChat: !compact(params.input.goal),
      }),
    };
  }
  // Human confirm gate OR incomplete contract quality → needs_confirm (FINAL v3 §C).
  if ((requireConfirm && !confirmed) || !draft.quality.ok) {
    return {
      status: "needs_confirm",
      draft,
      qualityIssues: draft.quality.issues,
    };
  }
  if (!isCollabTaskClaimContractEnabled(params.cfg, draft.groupId, params.authority.tenantId)) {
    return {
      status: "flag_off",
      draft,
      reason: "claimContract off for group (global false and not on allowlist)",
    };
  }
  const skipChallenge = params.input.skipChallengeWindow === true;
  const challengeWindowId = compact(params.input.challengeWindowId) || undefined;
  if (
    isCollabTaskChallengeWindowEnabled(params.cfg, draft.groupId, params.authority.tenantId) &&
    !skipChallenge &&
    !challengeWindowId
  ) {
    return {
      status: "needs_challenge",
      draft,
      reason:
        "challengeWindow ON: open 1 challenger (蓝) → critique → lead resolve, or skipChallengeWindow",
    };
  }
  if (draft.acceptanceCriteria.length === 0) {
    // Defense in depth — publishBoardItem also rejects empty Acceptance.
    return {
      status: "needs_confirm",
      draft,
      qualityIssues: draft.quality.issues.includes("acceptance_missing")
        ? draft.quality.issues
        : [...draft.quality.issues, "acceptance_missing"],
    };
  }
  const published = await publishBoardItem(
    params.authority,
    draftToPublishInput(draft, { challengeWindowId, skipChallengeWindow: skipChallenge }),
    {
      cfg: params.cfg,
      nowMs: params.input.nowMs,
    },
  );
  if (!published.ok) {
    if (published.reason === "flag_off") {
      return { status: "flag_off", draft, reason: published.message };
    }
    return { status: "skipped", reason: `${published.reason}: ${published.message}` };
  }
  return { status: "published", draft, item: published.value };
}
