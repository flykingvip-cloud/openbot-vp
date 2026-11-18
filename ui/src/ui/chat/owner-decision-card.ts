/**
 * Owner decision card for collaboration human gates (todolist confirm).
 * Same chrome as steward-call / meeting confirm cards.
 *
 * Confirm / revise call collaboration.task.* with the logged-in session actor.
 * "稍后" only dismisses locally on proposed|revise_requested — does not weaken
 * ACL or auto-confirm. Confirmed review cards keep status + plan list only
 * (no action buttons).
 */
import { html, nothing, type TemplateResult } from "lit";
import {
  ensurePlanStepSemicolon,
  extractOwnerDecisionFenceBody,
  looksLikeEmailAddress,
  parseOwnerDecisionCard,
  resolveOwnerDecisionMentionLabel,
  type OwnerDecisionCard,
  type OwnerDecisionOptionId,
} from "../../../../src/gateway/collaboration-dispatch/owner-decision-card.js";
/** Browser-safe delivery copy/types (do not import owner-decision-delivery.ts — it pulls Node spawn). */
export const OWNER_DECISION_USER_FACING = [
  "waiting_confirmation",
  "delivery_failed_retryable",
  "stale_version",
  "consumed",
  "peer_confirmed",
  "skipped",
  "tracked",
] as const;

export type OwnerDecisionUserFacing = (typeof OWNER_DECISION_USER_FACING)[number];

const OWNER_DECISION_DELIVERY_COPY: Record<
  "waiting_confirmation" | "delivery_failed_retryable" | "stale_version",
  string
> = {
  waiting_confirmation: "等待确认",
  delivery_failed_retryable: "确认请求发送失败，可重试",
  stale_version: "旧版本已失效",
};

export type OwnerDecisionCardDelivery = {
  ok: boolean;
  stage: string;
  reason?: string;
  message?: string;
  historyReloadable: boolean;
  deliveryTracked: boolean;
  clientPresented: false;
  retryable: boolean;
  userFacing: OwnerDecisionUserFacing;
  groupId: string;
  taskId: string;
  boardItemId: string;
  todolistId: string;
  version: number;
  messageId?: string;
  idempotencyKey?: string;
  card?: OwnerDecisionCard;
};

export function ownerDecisionDeliveryStatusCopy(
  userFacing: OwnerDecisionUserFacing | null | undefined,
): string | null {
  if (
    userFacing === "waiting_confirmation" ||
    userFacing === "delivery_failed_retryable" ||
    userFacing === "stale_version"
  ) {
    return OWNER_DECISION_DELIVERY_COPY[userFacing];
  }
  return null;
}

export type OwnerDecisionAction = OwnerDecisionOptionId;

export type OwnerDecisionCardView = OwnerDecisionCard;

function extractTextFromContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((block) => {
      if (!block || typeof block !== "object") {
        return "";
      }
      const row = block as { type?: string; text?: string };
      return row.type === "text" && typeof row.text === "string" ? row.text : "";
    })
    .filter(Boolean)
    .join("\n");
}

export type OwnerDecisionRead = {
  card: OwnerDecisionCardView;
  /**
   * `structured` is the server-written field. `fence` is a display fallback only
   * and does not prove the card was issued.
   */
  authority: "structured" | "fence";
};

/** Read structured ownerDecision from a chat history message. */
export function readOwnerDecisionRow(message: unknown): OwnerDecisionRead | null {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return null;
  }
  const row = message as { ownerDecision?: unknown; content?: unknown };
  const fromField = parseOwnerDecisionCard(row.ownerDecision);
  if (fromField) {
    return { card: fromField, authority: "structured" };
  }
  const text = extractTextFromContent(row.content);
  if (!text) {
    return null;
  }
  const fence = extractOwnerDecisionFenceBody(text);
  if (!fence) {
    return null;
  }
  try {
    const card = parseOwnerDecisionCard(JSON.parse(fence) as unknown);
    return card ? { card, authority: "fence" } : null;
  } catch {
    return null;
  }
}

/** Read structured ownerDecision from a chat history message. */
export function readOwnerDecision(message: unknown): OwnerDecisionCardView | null {
  return readOwnerDecisionRow(message)?.card ?? null;
}

const dismissedDecisionIds = new Set<string>();
const DISMISSED_DECISION_PREFIX = "openbot.owner-decision.dismissed.v1:";

// Presentation preference only: never changes plan approval or task state.
function storedDecisionDismissal(id: string): boolean {
  try {
    return globalThis.localStorage?.getItem(DISMISSED_DECISION_PREFIX + id) === "1";
  } catch {
    return false;
  }
}
const actionErrorsByDecisionId = new Map<string, string>();
/** Decision ids currently showing the in-card revise reason textarea. */
const reviseExpandedByDecisionId = new Set<string>();
const reviseDraftByDecisionId = new Map<string, string>();
/**
 * Todolist lifecycle learned from successful confirm/revise or status-gate RPC
 * errors. Keyed by todolistId so superseded/confirmed cards stop offering
 * confirm/revise even before history refresh.
 */
const todolistStatusById = new Map<string, string>();
/** decisionId → todolistId, filled while a card is rendered. */
const todolistIdByDecisionId = new Map<string, string>();
const deliveryByTodolistVersion = new Map<string, OwnerDecisionUserFacing>();
const recoveryCards: OwnerDecisionCardView[] = [];

function deliveryKey(todolistId: string, version?: number): string {
  const versionPart =
    typeof version === "number" && Number.isFinite(version) ? `:v${Math.floor(version)}` : "";
  return `${todolistId.trim()}${versionPart}`;
}

export function noteOwnerDecisionDelivery(
  todolistId: string,
  userFacing: OwnerDecisionUserFacing,
  version?: number,
): void {
  const id = todolistId.trim();
  if (!id) {
    return;
  }
  deliveryByTodolistVersion.set(deliveryKey(id, version), userFacing);
  deliveryByTodolistVersion.set(deliveryKey(id), userFacing);
}

export function getOwnerDecisionDelivery(
  todolistId: string,
  version?: number,
): OwnerDecisionUserFacing | null {
  return (
    deliveryByTodolistVersion.get(deliveryKey(todolistId, version)) ??
    deliveryByTodolistVersion.get(deliveryKey(todolistId)) ??
    null
  );
}

/** Merge server delivery rows that history may not currently show. Returns whether the set changed. */
export function noteOwnerDecisionRecoveries(
  deliveries: ReadonlyArray<
    Pick<OwnerDecisionCardDelivery, "card" | "userFacing" | "todolistId" | "version">
  >,
): boolean {
  let changed = false;
  for (const row of deliveries) {
    if (row.todolistId) {
      noteOwnerDecisionDelivery(row.todolistId, row.userFacing, row.version);
      changed = true;
    }
    if (!row.card) {
      continue;
    }
    if (recoveryCards.some((card) => card.decisionId === row.card?.decisionId)) {
      continue;
    }
    recoveryCards.push(row.card);
    changed = true;
  }
  return changed;
}

export function clearOwnerDecisionDeliveryStateForTest(): void {
  deliveryByTodolistVersion.clear();
  recoveryCards.splice(0, recoveryCards.length);
}

/** Statuses that may still call confirmTodolist / reviseTodolist. */
export const OWNER_DECISION_ACTIONABLE_STATUSES = new Set(["proposed", "revise_requested"]);

/** Human-side compact copy for bot↔bot peer confirmation (no plan body). */
export const OWNER_DECISION_PEER_ACK_COPY = "收到，并确认";

/** True when delivery marks bot↔bot peer auto-confirm (not human gate). */

/** Format post-plan autoAdvance for UI — confirm stays; failures visible by stage. */
export function formatPostPlanConfirmAdvanceUserMessage(
  advance:
    | {
        wakeRecorded?: boolean;
        wakeConsumed?: boolean;
        dispatched?: boolean;
        reason?: string;
      }
    | null
    | undefined,
): string | null {
  if (!advance) {
    return null;
  }
  const reason = String(advance.reason ?? "").trim();
  if (!reason) {
    return null;
  }
  if (advance.dispatched === true) {
    return null;
  }
  const wakeRecorded = advance.wakeRecorded === true;
  const wakeConsumed = advance.wakeConsumed === true;
  if (!wakeRecorded) {
    return `计划已确认，但自动推进未开始：${reason}`;
  }
  if (wakeRecorded && !wakeConsumed) {
    return `计划已确认，推进已排队但未消费：${reason}`;
  }
  // wake recorded + consumed, not dispatched
  const blockedLike =
    /self_advance_not_execute|dispatch_readiness_not_ready|mode_b_dispatcher_unbound|gray|not_allowed|blocked/i.test(
      reason,
    );
  const dispatchFailed =
    /dispatch_failed|execute_collaboration_round_failed|plan_revised_before_dispatch|plan_revalidate/i.test(
      reason,
    );
  if (dispatchFailed) {
    return `计划已确认，但派发失败：${reason}`;
  }
  if (blockedLike) {
    return `计划已确认，推进受阻：${reason}`;
  }
  return `计划已确认，推进未完成：${reason}`;
}

export function isOwnerDecisionPeerConfirmed(
  userFacing: OwnerDecisionUserFacing | null | undefined,
): boolean {
  return userFacing === "peer_confirmed";
}

const OWNER_DECISION_STATUS_COPY: Record<string, string> = {
  confirmed: "执行计划已确认",
  superseded: "旧版本已失效",
  revise_requested: "计划已退回修订。",
  accepted: "计划已接受。",
  closed: "计划已关闭。",
};

const OWNER_DECISION_VERSION_REFUSALS = [
  "stale_version",
  "version_mismatch",
  "card_invalid",
  "expected_version_required",
  "confirmation_consumed",
] as const;

export type OwnerDecisionVersionRefusal = (typeof OWNER_DECISION_VERSION_REFUSALS)[number];

/** Parse confirm/revise version-gate messages. Codes stay distinct; copy reuses batch 2. */
export function parseOwnerDecisionVersionRefusal(
  message: string,
): OwnerDecisionVersionRefusal | null {
  const text = String(message ?? "");
  for (const code of OWNER_DECISION_VERSION_REFUSALS) {
    if (text.includes(code)) {
      return code;
    }
  }
  return null;
}

/** Parse `todolist status is X; expected proposed|revise_requested` RPC errors. */
export function parseOwnerDecisionStatusGateError(message: string): string | null {
  const text = String(message ?? "").trim();
  if (!text) {
    return null;
  }
  const match = /todolist status is ([a-z_]+)\s*;\s*expected\s+proposed\|revise_requested/i.exec(
    text,
  );
  return match?.[1]?.toLowerCase() ?? null;
}

export function formatOwnerDecisionStatusCopy(status: string): string {
  const key = status.trim().toLowerCase();
  if (!key) {
    return "计划状态已变更，当前无法确认或退回。";
  }
  return OWNER_DECISION_STATUS_COPY[key] ?? `计划状态为「${key}」，当前无法确认或退回。`;
}

/** Confirmed review uses success callout; other terminal statuses stay neutral. */
export function ownerDecisionStatusCalloutClass(status: string | null | undefined): string {
  const key = String(status ?? "")
    .trim()
    .toLowerCase();
  return key === "confirmed" ? "callout success" : "callout";
}

export function isOwnerDecisionTodolistActionable(status: string | null | undefined): boolean {
  if (status == null || !String(status).trim()) {
    // Unknown: keep buttons enabled until RPC/history teaches us otherwise.
    return true;
  }
  return OWNER_DECISION_ACTIONABLE_STATUSES.has(String(status).trim().toLowerCase());
}

/** Terminal plan statuses — sticky pile should not keep these (ghost wall / bury chat). */
export const OWNER_DECISION_TERMINAL_STATUSES = new Set([
  "confirmed",
  "superseded",
  "accepted",
  "closed",
]);

export function isOwnerDecisionTodolistTerminal(status: string | null | undefined): boolean {
  if (status == null || !String(status).trim()) {
    return false;
  }
  return OWNER_DECISION_TERMINAL_STATUSES.has(String(status).trim().toLowerCase());
}

/**
 * Sticky owner-decision pile: one card per board item.
 * - Actionable / unknown (pending hydrate) stay.
 * - Terminal (confirmed/…) keep at most one review card so a long group
 *   transcript cannot bury chat under dozens of ghosts.
 * - confirmation_consumed / stale delivery rows are dropped entirely.
 */
export function selectStickyOwnerDecisionCards(
  cards: OwnerDecisionCardView[],
): OwnerDecisionCardView[] {
  const latest = selectLatestOwnerDecisionPerBoardItem(cards);
  const active: OwnerDecisionCardView[] = [];
  const terminals: OwnerDecisionCardView[] = [];
  for (const card of latest) {
    // Explicit expiry is authoritative; never infer expiry from message age.
    if (typeof card.expiresAtMs === "number" && card.expiresAtMs <= Date.now()) {
      continue;
    }
    const facing = getOwnerDecisionDelivery(card.todolistId, card.version);
    if (facing === "consumed" || facing === "skipped") {
      continue;
    }
    // Invalid historical versions belong to history, never the action stack.
    // Each history message may render independently, so a per-call terminal
    // budget alone cannot prevent a wall of old cards.
    if (
      facing === "stale_version" ||
      isOwnerDecisionVersionStale(card.decisionId) ||
      getOwnerDecisionTodolistStatus(card.todolistId) === "superseded"
    ) {
      continue;
    }
    if (isOwnerDecisionTodolistTerminal(getOwnerDecisionTodolistStatus(card.todolistId))) {
      terminals.push(card);
      continue;
    }
    active.push(card);
  }
  const terminalKeep = terminals.length > 0 ? [terminals[terminals.length - 1]] : [];
  return [...active, ...terminalKeep];
}

/**
 * History residual for human confirm (not sticky).
 * Sticky/todo drops consumed (#137); chat history still shows a compact
 * 「执行计划已确认」receipt. Peer uses dedicated「收到，并确认」via sticky
 * peer_confirmed path — never this helper.
 */
export function selectHumanConfirmReceiptCards(
  cards: OwnerDecisionCardView[],
): OwnerDecisionCardView[] {
  const latest = selectLatestOwnerDecisionPerBoardItem(cards);
  const receipts: OwnerDecisionCardView[] = [];
  for (const card of latest) {
    const facing = getOwnerDecisionDelivery(card.todolistId, card.version);
    if (facing !== "consumed") {
      continue;
    }
    const status = String(getOwnerDecisionTodolistStatus(card.todolistId) ?? "")
      .trim()
      .toLowerCase();
    if (status !== "confirmed") {
      continue;
    }
    receipts.push(card);
  }
  return receipts;
}

export function setOwnerDecisionTodolistStatus(todolistId: string, status: string): void {
  const id = todolistId.trim();
  const value = status.trim().toLowerCase();
  if (!id || !value) {
    return;
  }
  todolistStatusById.set(id, value);
}

export function getOwnerDecisionTodolistStatus(todolistId: string): string | null {
  return todolistStatusById.get(todolistId.trim()) ?? null;
}

export function clearOwnerDecisionTodolistStatus(todolistId: string): void {
  todolistStatusById.delete(todolistId.trim());
}

/**
 * Confirmed human cards fold away after success (SoT stays confirmed — never
 * roll back to proposed). Stale/superseded stay visible with「旧版本已失效」.
 */
export function shouldAutoCollapseOwnerDecisionStatus(
  status: string | null | undefined,
  opts?: { peerConfirmed?: boolean },
): boolean {
  const key = String(status ?? "")
    .trim()
    .toLowerCase();
  // Peer mutual-ack residuals stay visible as「收到，并确认」; human confirm folds away.
  if (opts?.peerConfirmed) {
    return false;
  }
  return key === "confirmed";
}

/** decisionId → boardItemId, filled while a card is rendered. */
const boardItemIdByDecisionId = new Map<string, string>();

/** Collapse every rendered card for a todolist (used when status becomes superseded). */
export function collapseOwnerDecisionCardsForTodolist(todolistId: string): void {
  const id = todolistId.trim();
  if (!id) {
    return;
  }
  for (const [decisionId, mapped] of todolistIdByDecisionId.entries()) {
    if (mapped === id) {
      dismissOwnerDecisionCard(decisionId);
    }
  }
}

/**
 * Collapse cards for a board item. Pass keepDecisionId after a successful confirm
 * so the confirmed card stays visible for review (status + plan; no actions).
 */
export function collapseOwnerDecisionCardsForBoardItem(
  boardItemId: string,
  opts?: { keepDecisionId?: string },
): void {
  const id = boardItemId.trim();
  if (!id) {
    return;
  }
  const keep = String(opts?.keepDecisionId ?? "").trim();
  for (const [decisionId, mapped] of boardItemIdByDecisionId.entries()) {
    if (mapped === id && decisionId !== keep) {
      dismissOwnerDecisionCard(decisionId);
    }
  }
}

/**
 * Highest version per board item. Older cards are not dismissed; render them
 * as「旧版本已失效」via staleOwnerDecisionDecisionIds.
 */
export function selectLatestOwnerDecisionPerBoardItem(
  cards: OwnerDecisionCardView[],
): OwnerDecisionCardView[] {
  const bestByBoard = new Map<string, { card: OwnerDecisionCardView; index: number }>();
  const withoutBoard: OwnerDecisionCardView[] = [];
  cards.forEach((card, index) => {
    const boardId = String(card.boardItemId ?? "").trim();
    if (!boardId) {
      withoutBoard.push(card);
      return;
    }
    const version =
      typeof card.version === "number" && Number.isFinite(card.version) ? card.version : 0;
    const prev = bestByBoard.get(boardId);
    if (!prev) {
      bestByBoard.set(boardId, { card, index });
      return;
    }
    const prevVersion =
      typeof prev.card.version === "number" && Number.isFinite(prev.card.version)
        ? prev.card.version
        : 0;
    if (version > prevVersion || (version === prevVersion && index >= prev.index)) {
      bestByBoard.set(boardId, { card, index });
    }
  });
  const kept = [...bestByBoard.values()]
    .toSorted((a, b) => a.index - b.index)
    .map((row) => row.card);
  return [...withoutBoard, ...kept];
}

/** Decision ids that are an older version of the same board item. */
export function staleOwnerDecisionDecisionIds(cards: OwnerDecisionCardView[]): Set<string> {
  const bestVersion = new Map<string, number>();
  for (const card of cards) {
    const boardId = String(card.boardItemId ?? "").trim();
    if (!boardId) {
      continue;
    }
    const version =
      typeof card.version === "number" && Number.isFinite(card.version) ? card.version : 0;
    const prev = bestVersion.get(boardId) ?? Number.NEGATIVE_INFINITY;
    if (version > prev) {
      bestVersion.set(boardId, version);
    }
  }
  const stale = new Set<string>();
  for (const card of cards) {
    const boardId = String(card.boardItemId ?? "").trim();
    if (!boardId) {
      continue;
    }
    const version =
      typeof card.version === "number" && Number.isFinite(card.version) ? card.version : 0;
    const best = bestVersion.get(boardId) ?? version;
    if (version < best) {
      stale.add(card.decisionId);
    }
  }
  return stale;
}

export type OwnerDecisionHydrationTarget = {
  decisionId: string;
  groupId: string;
  taskId: string;
  todolistId: string;
  version?: number;
};

/** Decision ids whose card version was refused or no longer matches the live plan. */
const versionStaleDecisionIds = new Set<string>();

export function noteOwnerDecisionVersionRefusal(decisionId: string): void {
  const id = decisionId.trim();
  if (id) {
    versionStaleDecisionIds.add(id);
  }
}

export function isOwnerDecisionVersionStale(decisionId: string): boolean {
  return versionStaleDecisionIds.has(decisionId.trim());
}

/** Todolist ids we already attempted to hydrate this page session. */
const hydratedTodolistIds = new Set<string>();
const hydrationRetryAfter = new Map<string, number>();

/** A failed read is not authority. Allow retry after backoff without a render loop. */
export function releaseOwnerDecisionHydrationAttempt(todolistId: string): void {
  hydratedTodolistIds.delete(todolistId.trim());
  hydrationRetryAfter.set(todolistId.trim(), Date.now() + 5_000);
}

/** Collect cards whose lifecycle status is still unknown (need getTodolist). */
export function collectOwnerDecisionHydrationTargets(
  cards: OwnerDecisionCardView[],
): OwnerDecisionHydrationTarget[] {
  const out: OwnerDecisionHydrationTarget[] = [];
  const seen = new Set<string>();
  for (const card of cards) {
    const todolistId = card.todolistId.trim();
    if (
      !todolistId ||
      seen.has(todolistId) ||
      hydratedTodolistIds.has(todolistId) ||
      (hydrationRetryAfter.get(todolistId) ?? 0) > Date.now()
    ) {
      continue;
    }
    if (getOwnerDecisionTodolistStatus(todolistId) != null) {
      hydratedTodolistIds.add(todolistId);
      continue;
    }
    seen.add(todolistId);
    out.push({
      decisionId: card.decisionId,
      groupId: card.groupId,
      taskId: card.taskId,
      todolistId,
      ...(typeof card.version === "number" ? { version: card.version } : {}),
    });
  }
  return out;
}

export function markOwnerDecisionHydrationAttempted(todolistId: string): void {
  const id = todolistId.trim();
  if (id) {
    hydratedTodolistIds.add(id);
  }
}

/** Test helper. */
export function clearOwnerDecisionDismissalsForTest(preserveStorage = false): void {
  if (!preserveStorage) {
    try {
      const storage = globalThis.localStorage;
      for (const key of Object.keys(storage ?? {})) {
        if (key.startsWith(DISMISSED_DECISION_PREFIX)) {
          storage.removeItem(key);
        }
      }
    } catch {
      // Test environments may disable browser storage.
    }
  }
  dismissedDecisionIds.clear();
  actionErrorsByDecisionId.clear();
  reviseExpandedByDecisionId.clear();
  reviseDraftByDecisionId.clear();
  todolistStatusById.clear();
  todolistIdByDecisionId.clear();
  boardItemIdByDecisionId.clear();
  hydratedTodolistIds.clear();
  hydrationRetryAfter.clear();
  versionStaleDecisionIds.clear();
}

export function dismissOwnerDecisionCard(decisionId: string): void {
  const id = decisionId.trim();
  if (id) {
    dismissedDecisionIds.add(id);
    try {
      globalThis.localStorage?.setItem(DISMISSED_DECISION_PREFIX + id, "1");
    } catch {
      // Storage may be unavailable; in-memory dismissal still works.
    }
    actionErrorsByDecisionId.delete(id);
    reviseExpandedByDecisionId.delete(id);
    reviseDraftByDecisionId.delete(id);
    todolistIdByDecisionId.delete(id);
    boardItemIdByDecisionId.delete(id);
  }
}

export function isOwnerDecisionReviseExpanded(decisionId: string): boolean {
  return reviseExpandedByDecisionId.has(decisionId.trim());
}

export function setOwnerDecisionReviseExpanded(decisionId: string, expanded: boolean): void {
  const id = decisionId.trim();
  if (!id) {
    return;
  }
  if (expanded) {
    reviseExpandedByDecisionId.add(id);
    if (!reviseDraftByDecisionId.has(id)) {
      reviseDraftByDecisionId.set(id, "");
    }
  } else {
    reviseExpandedByDecisionId.delete(id);
    reviseDraftByDecisionId.delete(id);
  }
}

export function getOwnerDecisionReviseDraft(decisionId: string): string {
  return reviseDraftByDecisionId.get(decisionId.trim()) ?? "";
}

export function setOwnerDecisionReviseDraft(decisionId: string, draft: string): void {
  const id = decisionId.trim();
  if (!id) {
    return;
  }
  reviseDraftByDecisionId.set(id, draft);
}

export function isOwnerDecisionDismissed(decisionId: string): boolean {
  const id = decisionId.trim();
  return dismissedDecisionIds.has(id) || storedDecisionDismissal(id);
}

export function setOwnerDecisionActionError(decisionId: string, message: string): void {
  const id = decisionId.trim();
  const text = message.trim();
  if (!id || !text) {
    return;
  }
  const versionRefusal = parseOwnerDecisionVersionRefusal(text);
  const todolistId = todolistIdByDecisionId.get(id);
  if (versionRefusal === "confirmation_consumed") {
    if (todolistId) {
      setOwnerDecisionTodolistStatus(todolistId, "confirmed");
      noteOwnerDecisionDelivery(todolistId, "consumed");
    }
    actionErrorsByDecisionId.delete(id);
    return;
  }
  if (
    versionRefusal === "stale_version" ||
    versionRefusal === "version_mismatch" ||
    versionRefusal === "card_invalid"
  ) {
    noteOwnerDecisionVersionRefusal(id);
    if (versionRefusal === "card_invalid" && todolistId) {
      setOwnerDecisionTodolistStatus(todolistId, "superseded");
    }
    actionErrorsByDecisionId.delete(id);
    return;
  }
  if (versionRefusal === "expected_version_required") {
    actionErrorsByDecisionId.set(id, "确认必须绑定计划版本");
    return;
  }
  const gated = parseOwnerDecisionStatusGateError(text);
  if (gated && todolistId) {
    setOwnerDecisionTodolistStatus(todolistId, gated);
    // Prefer status banner over raw RPC gate sentence.
    actionErrorsByDecisionId.delete(id);
    if (shouldAutoCollapseOwnerDecisionStatus(gated)) {
      collapseOwnerDecisionCardsForTodolist(todolistId);
    }
    return;
  }
  // Even without a mapped todolistId, avoid leaving a raw gate sentence if we can parse it.
  if (gated) {
    actionErrorsByDecisionId.set(id, formatOwnerDecisionStatusCopy(gated));
    return;
  }
  actionErrorsByDecisionId.set(id, text);
}

export function clearOwnerDecisionActionError(decisionId: string): void {
  actionErrorsByDecisionId.delete(decisionId.trim());
}

export function getOwnerDecisionActionError(decisionId: string): string | null {
  return actionErrorsByDecisionId.get(decisionId.trim()) ?? null;
}

/** Split "1. body" so wrapped lines hang-indent under the body, not the number. */
export function splitOwnerDecisionPlanStep(line: string): { index: string; body: string } | null {
  const trimmed = line.trim();
  const match = /^(\d+\.)\s+([\s\S]*)$/.exec(trimmed);
  if (!match) {
    return null;
  }
  return { index: match[1] ?? "", body: (match[2] ?? "").trim() };
}

/** Display helper: ensure each plan step ends with ； even for older payloads. */
export function formatOwnerDecisionSummaryLine(line: string): string {
  return ensurePlanStepSemicolon(line);
}

/** Prefer stored mentionLabels; never render an email in the @ hint. */
export function formatOwnerDecisionMentionHint(card: OwnerDecisionCardView): string {
  const ids = card.mentionMemberIds ?? [];
  if (ids.length === 0) {
    return "";
  }
  const labels = card.mentionLabels ?? [];
  return ids
    .map((id, index) => `@${resolveOwnerDecisionMentionLabel(id, labels[index])}`)
    .join(" ");
}

/**
 * Same chrome as `renderStewardCallAuthorizationCards` /
 * `employee-workbench__steward-confirm-card`.
 */
export type OwnerDecisionDetail = {
  reason?: string;
};

export function renderOwnerDecisionCards(
  messages: unknown[],
  opts: {
    busy?: boolean;
    onDecide?: (
      action: OwnerDecisionAction,
      card: OwnerDecisionCardView,
      detail?: OwnerDecisionDetail,
    ) => void;
    /** Re-render host after local expand/collapse (no RPC). */
    onUIChange?: () => void;
    /**
     * Optional: fetch todolist statuses for cards still unknown so confirmed /
     * superseded chrome disables before the user clicks into a gate error.
     */
    onHydrateStatuses?: (targets: OwnerDecisionHydrationTarget[]) => void;
    onRetryDelivery?: (card: OwnerDecisionCardView) => void;
    /** Load server delivery rows so a failed card can be redrawn after refresh. */
    onLoadRecoveries?: () => void;
  } = {},
): TemplateResult | typeof nothing {
  opts.onLoadRecoveries?.();
  const readsRaw = [...messages, ...recoveryCards.map((card) => ({ ownerDecision: card }))]
    .map((message) => readOwnerDecisionRow(message))
    .filter((row): row is OwnerDecisionRead => row !== null);
  // Register id maps for every card (including dismissed) so confirm-fold can
  // still emit history receipts from authoritative confirmed/consumed state.
  for (const row of readsRaw) {
    todolistIdByDecisionId.set(row.card.decisionId, row.card.todolistId);
    boardItemIdByDecisionId.set(row.card.decisionId, row.card.boardItemId);
  }
  // Deduplicate by decisionId. A structured field outranks a fence-only copy.
  const byId = new Map<string, OwnerDecisionRead>();
  for (const row of readsRaw) {
    const prev = byId.get(row.card.decisionId);
    if (!prev || (prev.authority === "fence" && row.authority === "structured")) {
      byId.set(row.card.decisionId, row);
    }
  }
  const reads = [...byId.values()];
  const allCards = reads.map((row) => row.card);
  // Hydrate against the full set so terminal status is learned even for cards
  // we are about to drop from the sticky pile (incl. dismissed confirmed).
  const hydrateTargets = collectOwnerDecisionHydrationTargets(allCards);
  if (hydrateTargets.length > 0) {
    opts.onHydrateStatuses?.(hydrateTargets);
  }
  // Sticky/todo/dialog: dismiss hides confirm chrome (稍后 or post-confirm fold).
  // History compact receipts ignore dismiss — they require confirmed+consumed
  // (ordinary 稍后 dismiss alone never becomes a receipt).
  // Determine old versions before removing dismissed current versions. Otherwise
  // deferring the newest card promotes an obsolete historical card into its slot.
  const staleIds = staleOwnerDecisionDecisionIds(allCards);
  const stickyCandidates = allCards.filter(
    (card) => !isOwnerDecisionDismissed(card.decisionId) && !staleIds.has(card.decisionId),
  );
  const cards = selectStickyOwnerDecisionCards(stickyCandidates);
  const stickyIds = new Set(cards.map((card) => card.decisionId));
  const humanReceipts = selectHumanConfirmReceiptCards(allCards).filter(
    (card) => !stickyIds.has(card.decisionId),
  );
  const authorityById = new Map(reads.map((row) => [row.card.decisionId, row.authority]));
  if (cards.length === 0 && humanReceipts.length === 0) {
    return nothing;
  }
  const busy = Boolean(opts.busy);
  const humanReceiptCopy = formatOwnerDecisionStatusCopy("confirmed");
  return html`
    ${humanReceipts.map((card) => {
      todolistIdByDecisionId.set(card.decisionId, card.todolistId);
      boardItemIdByDecisionId.set(card.decisionId, card.boardItemId);
      const authority = authorityById.get(card.decisionId) ?? "fence";
      return html`
        <div
          class="employee-workbench__assistant-prelude chat-bubble employee-workbench__assistant-prelude-bubble employee-workbench__steward-confirm-card employee-workbench__owner-decision-human-receipt"
          role="status"
          aria-label=${humanReceiptCopy}
          data-owner-decision=${card.decisionId}
          data-todolist-id=${card.todolistId}
          data-owner-decision-status="confirmed"
          data-owner-decision-authority=${authority}
          data-owner-decision-delivery="consumed"
          data-owner-decision-terminal
          data-owner-decision-confirm-source="human"
        >
          <div
            class=${ownerDecisionStatusCalloutClass("confirmed")}
            data-owner-decision-status-copy
          >
            ${humanReceiptCopy}
          </div>
        </div>
      `;
    })}
    ${cards.map((card) => {
      todolistIdByDecisionId.set(card.decisionId, card.todolistId);
      boardItemIdByDecisionId.set(card.decisionId, card.boardItemId);
      const mentionHint = formatOwnerDecisionMentionHint(card);
      const actionError = getOwnerDecisionActionError(card.decisionId);
      const todolistStatus = getOwnerDecisionTodolistStatus(card.todolistId);
      const userFacing = getOwnerDecisionDelivery(card.todolistId, card.version);
      const invalid =
        staleIds.has(card.decisionId) ||
        isOwnerDecisionVersionStale(card.decisionId) ||
        userFacing === "stale_version" ||
        todolistStatus === "superseded";
      const facingTerminal =
        userFacing === "consumed" || userFacing === "stale_version" || userFacing === "skipped";
      const actionable =
        !invalid &&
        !facingTerminal &&
        (!opts.onHydrateStatuses || todolistStatus !== null) &&
        isOwnerDecisionTodolistActionable(todolistStatus);
      const statusCopy =
        opts.onHydrateStatuses && todolistStatus === null
          ? "计划状态尚未核实，暂不能确认或退回。"
          : invalid
            ? ownerDecisionDeliveryStatusCopy("stale_version")
            : todolistStatus && !isOwnerDecisionTodolistActionable(todolistStatus)
              ? formatOwnerDecisionStatusCopy(todolistStatus)
              : null;
      const deliveryFailed = userFacing === "delivery_failed_retryable";
      const authority = authorityById.get(card.decisionId) ?? "fence";
      const deliveryCopy = statusCopy
        ? null
        : deliveryFailed
          ? ownerDecisionDeliveryStatusCopy("delivery_failed_retryable")
          : actionable &&
              !actionError &&
              (authority === "structured" || userFacing === "waiting_confirmation")
            ? ownerDecisionDeliveryStatusCopy("waiting_confirmation")
            : null;
      const reviseExpanded = actionable && isOwnerDecisionReviseExpanded(card.decisionId);
      const reviseDraft = getOwnerDecisionReviseDraft(card.decisionId);
      // Confirmed / stale / other terminal review: no action buttons (incl. 稍后).
      // 稍后 stays only while proposed|revise_requested.
      const visibleOptions = actionable ? card.options : [];
      // Confirmed: peer mutual-ack →「收到，并确认」only; human confirm folds away
      // (dismiss) and any human residual keeps「执行计划已确认」(never peer copy).
      const isConfirmedTerminal =
        !invalid &&
        String(todolistStatus ?? "")
          .trim()
          .toLowerCase() === "confirmed";
      const peerConfirmed = isOwnerDecisionPeerConfirmed(userFacing);
      if (isConfirmedTerminal && peerConfirmed) {
        return html`
          <div
            class="employee-workbench__assistant-prelude chat-bubble employee-workbench__assistant-prelude-bubble employee-workbench__steward-confirm-card employee-workbench__owner-decision-peer-ack"
            role="status"
            aria-label=${OWNER_DECISION_PEER_ACK_COPY}
            data-owner-decision=${card.decisionId}
            data-todolist-id=${card.todolistId}
            data-owner-decision-status="confirmed"
            data-owner-decision-authority=${authority}
            data-owner-decision-delivery=${userFacing ?? nothing}
            data-owner-decision-terminal
            data-owner-decision-peer-ack
            data-owner-decision-confirm-source="peer"
          >
            <div class="employee-workbench__owner-decision-peer-ack-copy">${OWNER_DECISION_PEER_ACK_COPY}</div>
          </div>
        `;
      }
      const cardInner = html`
        <div
          class="employee-workbench__assistant-prelude chat-bubble employee-workbench__assistant-prelude-bubble employee-workbench__steward-confirm-card"
          role="group"
          aria-label=${card.title}
          data-owner-decision=${card.decisionId}
          data-todolist-id=${card.todolistId}
          data-owner-decision-status=${todolistStatus ?? nothing}
          data-owner-decision-authority=${authority}
          data-owner-decision-delivery=${userFacing ?? deliveryCopy ?? nothing}
          ?data-owner-decision-terminal=${Boolean(statusCopy)}
          ?data-owner-decision-revising=${reviseExpanded}
        >
          <div class="employee-workbench__assistant-prelude-title">${card.title}</div>
          ${
            mentionHint
              ? html`<div class="muted" style="margin-bottom: 0.35rem">${mentionHint}</div>`
              : nothing
          }
          <div class="employee-workbench__assistant-prelude-list" role="list">
            ${card.summary.map((line) => {
              const formatted = formatOwnerDecisionSummaryLine(line);
              const split = splitOwnerDecisionPlanStep(formatted);
              if (split) {
                return html`<div
                  class="employee-workbench__owner-decision-step"
                  role="listitem"
                >
                  <span class="employee-workbench__owner-decision-step-index">${split.index}</span>
                  <span class="employee-workbench__owner-decision-step-body">${split.body}</span>
                </div>`;
              }
              return html`<div
                class="employee-workbench__assistant-prelude-list-item"
                role="listitem"
              >
                ${formatted}
              </div>`;
            })}
          </div>
          ${
            card.supplementHint
              ? html`<div class="muted" style="margin: 0.35rem 0 0.5rem">${card.supplementHint}</div>`
              : nothing
          }
          ${
            statusCopy
              ? html`<div
                  class=${invalid ? "callout" : ownerDecisionStatusCalloutClass(todolistStatus)}
                  data-owner-decision-status-copy
                  style="margin: 0.35rem 0 0.5rem"
                >
                  ${statusCopy}
                </div>`
              : deliveryCopy
                ? html`<div
                    class=${deliveryFailed ? "callout danger" : "callout"}
                    data-owner-decision-delivery-copy
                    style="margin: 0.35rem 0 0.5rem"
                  >
                    ${deliveryCopy}
                  </div>`
                : nothing
          }
          ${
            actionError && !statusCopy
              ? html`<div
                  class="callout danger"
                  data-owner-decision-error
                  style="margin: 0.35rem 0 0.5rem"
                >
                  ${actionError}
                </div>`
              : nothing
          }
          ${
            deliveryFailed
              ? html`<div class="employee-workbench__assistant-prelude-toolbar">
                  <button
                    type="button"
                    class="btn btn--sm"
                    ?disabled=${busy || !opts.onRetryDelivery}
                    data-owner-decision-action="retry-delivery"
                    @click=${() => opts.onRetryDelivery?.(card)}
                  >
                    重试发送
                  </button>
                </div>`
              : nothing
          }
          ${
            reviseExpanded
              ? html`
                  <div
                    class="employee-workbench__owner-decision-revise"
                    data-owner-decision-revise
                  >
                    <label class="muted" for=${`owner-decision-revise-${card.decisionId}`}>
                      修订理由（必填）
                    </label>
                    <textarea
                      id=${`owner-decision-revise-${card.decisionId}`}
                      class="employee-workbench__owner-decision-revise-input"
                      rows="3"
                      placeholder="请说明需要怎么改计划…"
                      .value=${reviseDraft}
                      ?disabled=${busy}
                      data-owner-decision-revise-input
                      @input=${(event: Event) => {
                        const target = event.target as HTMLTextAreaElement;
                        setOwnerDecisionReviseDraft(card.decisionId, target.value);
                      }}
                    ></textarea>
                    <div class="employee-workbench__assistant-prelude-toolbar">
                      <button
                        type="button"
                        class="btn btn--sm primary"
                        ?disabled=${busy || !opts.onDecide}
                        data-owner-decision-action="revise-submit"
                        @click=${() => {
                          const reason = getOwnerDecisionReviseDraft(card.decisionId).trim();
                          if (!reason) {
                            setOwnerDecisionActionError(
                              card.decisionId,
                              "请填写修订理由后再提交。",
                            );
                            opts.onUIChange?.();
                            return;
                          }
                          clearOwnerDecisionActionError(card.decisionId);
                          opts.onDecide?.("revise", card, { reason });
                        }}
                      >
                        提交退回
                      </button>
                      <button
                        type="button"
                        class="btn btn--sm btn--ghost"
                        ?disabled=${busy}
                        data-owner-decision-action="revise-cancel"
                        @click=${() => {
                          setOwnerDecisionReviseExpanded(card.decisionId, false);
                          clearOwnerDecisionActionError(card.decisionId);
                          opts.onUIChange?.();
                        }}
                      >
                        取消
                      </button>
                    </div>
                  </div>
                `
              : visibleOptions.length === 0
                ? nothing
                : html`
                  <div class="employee-workbench__assistant-prelude-toolbar">
                    ${visibleOptions.map((option) => {
                      const btnClass =
                        option.style === "primary"
                          ? "btn btn--sm primary"
                          : option.style === "ghost"
                            ? "btn btn--sm btn--ghost"
                            : "btn btn--sm";
                      const decisionDisabled =
                        option.id !== "later" && (!opts.onDecide || !actionable);
                      return html`
                        <button
                          type="button"
                          class=${btnClass}
                          ?disabled=${busy || decisionDisabled}
                          data-owner-decision-action=${option.id}
                          @click=${() => {
                            if (option.id !== "later" && !actionable) {
                              return;
                            }
                            if (option.id === "revise") {
                              setOwnerDecisionReviseExpanded(card.decisionId, true);
                              clearOwnerDecisionActionError(card.decisionId);
                              opts.onUIChange?.();
                              return;
                            }
                            opts.onDecide?.(option.id, card);
                          }}
                        >
                          ${option.label}
                        </button>
                      `;
                    })}
                  </div>
                `
          }
        </div>
      `;
      // Actionable human confirm card → modal/dialog chrome; terminal/stale stay inline.
      if (actionable) {
        return html`
          <div
            class="employee-workbench__owner-decision-overlay"
            role="dialog"
            aria-modal="true"
            aria-label=${card.title}
            data-owner-decision-dialog=${card.decisionId}
          >
            <div class="employee-workbench__owner-decision-dialog">${cardInner}</div>
          </div>
        `;
      }
      return cardInner;
    })}
  `;
}

// Re-export for tests that assert email sanitization helpers.
export { ensurePlanStepSemicolon, looksLikeEmailAddress, resolveOwnerDecisionMentionLabel };
