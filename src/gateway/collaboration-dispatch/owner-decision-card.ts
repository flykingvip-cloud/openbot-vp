/**
 * Owner decision card (FINAL v3 human gate reachability).
 *
 * After proposeTodolist, emit a structured card into the group conversation so
 * the confirmer (主答 / lead / coordinator) can confirm or revise from chat.
 * Does not weaken ACL — confirm/revise still require a bound platform session.
 *
 * UI chrome mirrors steward-confirm-card; payload shape is intentional and
 * stable for Control UI parsing (see ui/src/ui/chat/owner-decision-card.ts).
 */

export const OWNER_DECISION_KIND = "todolist_confirm" as const;
export const OWNER_DECISION_FENCE = "owner-decision";

export type OwnerDecisionOptionId = "confirm" | "revise" | "later";

export type OwnerDecisionOption = {
  id: OwnerDecisionOptionId;
  label: string;
  style: "primary" | "default" | "ghost";
};

export type OwnerDecisionCard = {
  kind: typeof OWNER_DECISION_KIND;
  decisionId: string;
  groupId: string;
  taskId: string;
  boardItemId: string;
  todolistId: string;
  title: string;
  summary: string[];
  options: OwnerDecisionOption[];
  mentionMemberIds: string[];
  /** Parallel @ labels for mentionMemberIds; never email when a real name exists. */
  mentionLabels?: string[];
  supplementHint?: string;
  expiresAtMs?: number;
  version?: number;
};

export type OwnerDecisionBuildInput = {
  groupId: string;
  taskId: string;
  boardItemId: string;
  todolistId: string;
  steps: ReadonlyArray<{ title?: string | null; detail?: string | null }>;
  mentionMemberIds: readonly string[];
  /** Optional display labels parallel to mentionMemberIds (fallback: id). */
  mentionDisplayNames?: ReadonlyArray<string | null | undefined>;
  version?: number;
  decisionId?: string;
  title?: string;
  supplementHint?: string;
  expiresAtMs?: number;
  nowMs?: number;
};

const DEFAULT_OPTIONS: OwnerDecisionOption[] = [
  { id: "confirm", label: "确认计划", style: "primary" },
  { id: "revise", label: "退回修订", style: "default" },
  { id: "later", label: "稍后", style: "ghost" },
];

function compact(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True when value looks like an email address (must not appear in @mentions). */
export function looksLikeEmailAddress(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed.includes("@")) {
    return false;
  }
  const at = trimmed.lastIndexOf("@");
  const domain = trimmed.slice(at + 1);
  return domain.includes(".") && domain.length > 2;
}

/**
 * Prefer a real display name for @mentions. Never return an email string.
 * Falls back to a short role label when only an email id is available.
 */
export function resolveOwnerDecisionMentionLabel(
  memberId: string,
  preferred?: string | null,
): string {
  const preferredLabel = compact(preferred);
  if (preferredLabel && !looksLikeEmailAddress(preferredLabel)) {
    return preferredLabel;
  }
  const id = compact(memberId);
  if (!id) {
    return "确认人";
  }
  if (id.startsWith("human:")) {
    return "成员";
  }
  if (looksLikeEmailAddress(id)) {
    return "主答";
  }
  // Opaque bot/agent ids without a roster name stay as-is (not an email).
  return id;
}

/** Ensure each numbered plan line ends with a Chinese semicolon. */
export function ensurePlanStepSemicolon(line: string): string {
  const trimmed = line.trimEnd();
  if (!trimmed) {
    return trimmed;
  }
  if (/[；。！？]$/.test(trimmed)) {
    return trimmed;
  }
  if (trimmed.endsWith(";")) {
    return `${trimmed.slice(0, -1)}；`;
  }
  return `${trimmed}；`;
}

function summarizeSteps(
  steps: ReadonlyArray<{ title?: string | null; detail?: string | null }>,
): string[] {
  const lines: string[] = [];
  for (let i = 0; i < steps.length; i += 1) {
    const title = compact(steps[i]?.title);
    if (!title) {
      continue;
    }
    const detail = compact(steps[i]?.detail);
    const raw = detail ? `${i + 1}. ${title} — ${detail}` : `${i + 1}. ${title}`;
    lines.push(ensurePlanStepSemicolon(raw));
  }
  return lines;
}

/** Build a validated owner-decision card payload (pure). */
export function buildOwnerDecisionCard(input: OwnerDecisionBuildInput): OwnerDecisionCard | null {
  const groupId = compact(input.groupId);
  const taskId = compact(input.taskId);
  const boardItemId = compact(input.boardItemId);
  const todolistId = compact(input.todolistId);
  if (!groupId || !taskId || !boardItemId || !todolistId) {
    return null;
  }
  const mentionMemberIds = [
    ...new Set(input.mentionMemberIds.map((id) => compact(id)).filter(Boolean)),
  ];
  if (mentionMemberIds.length === 0) {
    return null;
  }
  const nameHints = input.mentionDisplayNames ?? [];
  // Rebuild labels in mentionMemberIds order (Set may have reordered uniquely).
  const labelById = new Map<string, string>();
  for (let i = 0; i < input.mentionMemberIds.length; i += 1) {
    const rawId = compact(input.mentionMemberIds[i]);
    if (!rawId || labelById.has(rawId)) {
      continue;
    }
    labelById.set(rawId, resolveOwnerDecisionMentionLabel(rawId, nameHints[i]));
  }
  const mentionLabels = mentionMemberIds.map(
    (id) => labelById.get(id) ?? resolveOwnerDecisionMentionLabel(id),
  );
  const summary = summarizeSteps(input.steps);
  if (summary.length === 0) {
    summary.push("（执行者已提交计划，请主答确认后再推进交付）");
  }
  const title = compact(input.title) || "请确认执行计划";
  // Stable id for the same todolist version so re-propose emit is idempotent.
  const decisionId =
    compact(input.decisionId) ||
    `owner-decision-${todolistId}-v${
      typeof input.version === "number" && Number.isFinite(input.version) && input.version > 0
        ? Math.floor(input.version)
        : 1
    }`;
  const card: OwnerDecisionCard = {
    kind: OWNER_DECISION_KIND,
    decisionId,
    groupId,
    taskId,
    boardItemId,
    todolistId,
    title,
    summary,
    options: DEFAULT_OPTIONS.map((opt) => ({ ...opt })),
    mentionMemberIds,
    mentionLabels,
  };
  const hint = compact(input.supplementHint);
  if (hint) {
    card.supplementHint = hint;
  }
  if (typeof input.expiresAtMs === "number" && Number.isFinite(input.expiresAtMs)) {
    card.expiresAtMs = input.expiresAtMs;
  }
  if (typeof input.version === "number" && Number.isFinite(input.version) && input.version > 0) {
    card.version = Math.floor(input.version);
  }
  return card;
}

/** Validate unknown JSON as OwnerDecisionCard (UI / transcript parse). */
export function parseOwnerDecisionCard(raw: unknown): OwnerDecisionCard | null {
  if (!isPlainObject(raw)) {
    return null;
  }
  if (raw.kind !== OWNER_DECISION_KIND && raw.kind !== "owner_decision") {
    return null;
  }
  const decisionId = compact(typeof raw.decisionId === "string" ? raw.decisionId : "");
  const groupId = compact(typeof raw.groupId === "string" ? raw.groupId : "");
  const taskId = compact(typeof raw.taskId === "string" ? raw.taskId : "");
  const boardItemId = compact(typeof raw.boardItemId === "string" ? raw.boardItemId : "");
  const todolistId = compact(typeof raw.todolistId === "string" ? raw.todolistId : "");
  const title = compact(typeof raw.title === "string" ? raw.title : "") || "请确认执行计划";
  if (!decisionId || !groupId || !taskId || !boardItemId || !todolistId) {
    return null;
  }
  const mentionMemberIds = Array.isArray(raw.mentionMemberIds)
    ? [
        ...new Set(
          raw.mentionMemberIds
            .map((id) => (typeof id === "string" ? compact(id) : ""))
            .filter(Boolean),
        ),
      ]
    : [];
  if (mentionMemberIds.length === 0) {
    return null;
  }
  const summary = Array.isArray(raw.summary)
    ? raw.summary
        .map((line) => (typeof line === "string" ? ensurePlanStepSemicolon(compact(line)) : ""))
        .filter(Boolean)
    : [];
  const optionsRaw = Array.isArray(raw.options) ? raw.options : [];
  const options: OwnerDecisionOption[] = [];
  for (const entry of optionsRaw) {
    if (!isPlainObject(entry)) {
      continue;
    }
    const id = compact(typeof entry.id === "string" ? entry.id : "");
    const label = compact(typeof entry.label === "string" ? entry.label : "");
    const styleRaw = compact(typeof entry.style === "string" ? entry.style : "");
    if (id !== "confirm" && id !== "revise" && id !== "later") {
      continue;
    }
    if (!label) {
      continue;
    }
    const style =
      styleRaw === "primary" || styleRaw === "ghost" || styleRaw === "default"
        ? styleRaw
        : id === "confirm"
          ? "primary"
          : id === "later"
            ? "ghost"
            : "default";
    options.push({ id, label, style });
  }
  if (options.length === 0) {
    options.push(...DEFAULT_OPTIONS.map((opt) => ({ ...opt })));
  }
  const mentionLabelsRaw = Array.isArray(raw.mentionLabels)
    ? raw.mentionLabels.map((label) => (typeof label === "string" ? compact(label) : ""))
    : [];
  const mentionLabels =
    mentionLabelsRaw.length === mentionMemberIds.length &&
    mentionLabelsRaw.every((label) => Boolean(label) && !looksLikeEmailAddress(label))
      ? mentionLabelsRaw
      : mentionMemberIds.map((id, index) =>
          resolveOwnerDecisionMentionLabel(id, mentionLabelsRaw[index]),
        );
  const card: OwnerDecisionCard = {
    kind: OWNER_DECISION_KIND,
    decisionId,
    groupId,
    taskId,
    boardItemId,
    todolistId,
    title,
    summary: summary.length > 0 ? summary : ["（请确认执行计划）"],
    options,
    mentionMemberIds,
    mentionLabels,
  };
  const hint = compact(typeof raw.supplementHint === "string" ? raw.supplementHint : "");
  if (hint) {
    card.supplementHint = hint;
  }
  if (typeof raw.expiresAtMs === "number" && Number.isFinite(raw.expiresAtMs)) {
    card.expiresAtMs = raw.expiresAtMs;
  }
  if (typeof raw.version === "number" && Number.isFinite(raw.version) && raw.version > 0) {
    card.version = Math.floor(raw.version);
  }
  return card;
}

const OWNER_DECISION_FENCE_RE = /```\s*owner-decision\s*\r?\n([\s\S]*?)```/i;

/** Extract ```owner-decision``` fence body, or null. */
export function extractOwnerDecisionFenceBody(text: string): string | null {
  if (!text || typeof text !== "string") {
    return null;
  }
  const match = OWNER_DECISION_FENCE_RE.exec(text);
  if (!match) {
    return null;
  }
  const body = match[1]?.trim() ?? "";
  return body.length > 0 ? body : null;
}

export function parseOwnerDecisionFence(text: string): OwnerDecisionCard | null {
  const body = extractOwnerDecisionFenceBody(text);
  if (!body) {
    return null;
  }
  try {
    return parseOwnerDecisionCard(JSON.parse(body) as unknown);
  } catch {
    return null;
  }
}

/**
 * Readable transcript body: @mentions + title + summary + optional fence.
 * The fence keeps UI parsing working even if the structured field is stripped.
 */
export function formatOwnerDecisionMessageText(
  card: OwnerDecisionCard,
  opts?: {
    mentionDisplayNames?: ReadonlyArray<string | null | undefined>;
    includeFence?: boolean;
  },
): string {
  const names = opts?.mentionDisplayNames ?? card.mentionLabels ?? [];
  const mentionBits = card.mentionMemberIds.map((id, index) => {
    const label = resolveOwnerDecisionMentionLabel(id, names[index] ?? card.mentionLabels?.[index]);
    return `@${label}`;
  });
  const mentionLine =
    mentionBits.length > 0
      ? `${mentionBits.join(" ")} 需要你确认执行计划（人闸）。`
      : "需要主答确认执行计划（人闸）。";
  // Summary lines are already numbered — do not add markdown bullets.
  const lines = [mentionLine, "", card.title, ...card.summary];
  if (card.supplementHint) {
    lines.push("", `补充说明：${card.supplementHint}`);
  }
  if (opts?.includeFence !== false) {
    lines.push("", "```owner-decision", JSON.stringify(card, null, 2), "```");
  }
  return lines.join("\n");
}

/** Idempotency key so re-propose of the same todolist version does not spam cards. */
export function ownerDecisionIdempotencyKey(card: OwnerDecisionCard): string {
  const version = card.version ?? 0;
  return `owner-decision:${card.todolistId}:v${version}:${card.decisionId}`;
}
