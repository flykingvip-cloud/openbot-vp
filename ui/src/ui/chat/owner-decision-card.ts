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

/** Read structured ownerDecision from a chat history message. */
export function readOwnerDecision(message: unknown): OwnerDecisionCardView | null {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return null;
  }
  const row = message as { ownerDecision?: unknown; content?: unknown };
  const fromField = parseOwnerDecisionCard(row.ownerDecision);
  if (fromField) {
    return fromField;
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
    return parseOwnerDecisionCard(JSON.parse(fence) as unknown);
  } catch {
    return null;
  }
}

const dismissedDecisionIds = new Set<string>();
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

/** Statuses that may still call confirmTodolist / reviseTodolist. */
export const OWNER_DECISION_ACTIONABLE_STATUSES = new Set(["proposed", "revise_requested"]);

const OWNER_DECISION_STATUS_COPY: Record<string, string> = {
  confirmed: "执行计划已确认",
  superseded: "计划已更新，当前卡片已过期。",
  revise_requested: "计划已退回修订。",
  accepted: "计划已接受。",
  closed: "计划已关闭。",
};

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

/** Superseded cards are stale lookalikes — collapse instead of leaving chrome up. */
export function shouldAutoCollapseOwnerDecisionStatus(status: string | null | undefined): boolean {
  const key = String(status ?? "")
    .trim()
    .toLowerCase();
  return key === "superseded";
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
 * Same boardItemId can accumulate multiple propose messages (re-propose / races).
 * Keep the highest version (then last message order); dismiss the rest so the
 * user does not see three identical-looking cards.
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
      dismissOwnerDecisionCard(prev.card.decisionId);
      bestByBoard.set(boardId, { card, index });
    } else {
      dismissOwnerDecisionCard(card.decisionId);
    }
  });
  const kept = [...bestByBoard.values()]
    .toSorted((a, b) => a.index - b.index)
    .map((row) => row.card);
  return [...withoutBoard, ...kept];
}

export type OwnerDecisionHydrationTarget = {
  decisionId: string;
  groupId: string;
  taskId: string;
  todolistId: string;
};

/** Todolist ids we already attempted to hydrate this page session. */
const hydratedTodolistIds = new Set<string>();

/** Collect cards whose lifecycle status is still unknown (need getTodolist). */
export function collectOwnerDecisionHydrationTargets(
  cards: OwnerDecisionCardView[],
): OwnerDecisionHydrationTarget[] {
  const out: OwnerDecisionHydrationTarget[] = [];
  const seen = new Set<string>();
  for (const card of cards) {
    const todolistId = card.todolistId.trim();
    if (!todolistId || seen.has(todolistId) || hydratedTodolistIds.has(todolistId)) {
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
export function clearOwnerDecisionDismissalsForTest(): void {
  dismissedDecisionIds.clear();
  actionErrorsByDecisionId.clear();
  reviseExpandedByDecisionId.clear();
  reviseDraftByDecisionId.clear();
  todolistStatusById.clear();
  todolistIdByDecisionId.clear();
  boardItemIdByDecisionId.clear();
  hydratedTodolistIds.clear();
}

export function dismissOwnerDecisionCard(decisionId: string): void {
  const id = decisionId.trim();
  if (id) {
    dismissedDecisionIds.add(id);
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
  return dismissedDecisionIds.has(decisionId.trim());
}

export function setOwnerDecisionActionError(decisionId: string, message: string): void {
  const id = decisionId.trim();
  const text = message.trim();
  if (!id || !text) {
    return;
  }
  const gated = parseOwnerDecisionStatusGateError(text);
  const todolistId = todolistIdByDecisionId.get(id);
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
  } = {},
): TemplateResult | typeof nothing {
  const pending = messages
    .map((message) => readOwnerDecision(message))
    .filter((row): row is OwnerDecisionCardView => row !== null)
    .filter((row) => {
      todolistIdByDecisionId.set(row.decisionId, row.todolistId);
      boardItemIdByDecisionId.set(row.decisionId, row.boardItemId);
      if (isOwnerDecisionDismissed(row.decisionId)) {
        return false;
      }
      // Superseded lookalikes: do not render actionable chrome at all.
      const status = getOwnerDecisionTodolistStatus(row.todolistId);
      if (shouldAutoCollapseOwnerDecisionStatus(status)) {
        dismissOwnerDecisionCard(row.decisionId);
        return false;
      }
      return true;
    });
  // Deduplicate by decisionId (keep last).
  const byId = new Map<string, OwnerDecisionCardView>();
  for (const row of pending) {
    byId.set(row.decisionId, row);
  }
  // Same boardItemId → only the newest version (re-propose / race lookalikes).
  const cards = selectLatestOwnerDecisionPerBoardItem([...byId.values()]);
  const hydrateTargets = collectOwnerDecisionHydrationTargets(cards);
  if (hydrateTargets.length > 0) {
    opts.onHydrateStatuses?.(hydrateTargets);
  }
  if (cards.length === 0) {
    return nothing;
  }
  const busy = Boolean(opts.busy);
  return html`
    ${cards.map((card) => {
      todolistIdByDecisionId.set(card.decisionId, card.todolistId);
      boardItemIdByDecisionId.set(card.decisionId, card.boardItemId);
      const mentionHint = formatOwnerDecisionMentionHint(card);
      const actionError = getOwnerDecisionActionError(card.decisionId);
      const todolistStatus = getOwnerDecisionTodolistStatus(card.todolistId);
      const actionable = isOwnerDecisionTodolistActionable(todolistStatus);
      const statusCopy =
        todolistStatus && !actionable ? formatOwnerDecisionStatusCopy(todolistStatus) : null;
      const reviseExpanded = actionable && isOwnerDecisionReviseExpanded(card.decisionId);
      const reviseDraft = getOwnerDecisionReviseDraft(card.decisionId);
      // Confirmed / other terminal review: no action buttons (incl. 稍后).
      // 稍后 stays only while proposed|revise_requested.
      const visibleOptions = actionable ? card.options : [];
      return html`
        <div
          class="employee-workbench__assistant-prelude chat-bubble employee-workbench__assistant-prelude-bubble employee-workbench__steward-confirm-card"
          role="group"
          aria-label=${card.title}
          data-owner-decision=${card.decisionId}
          data-todolist-id=${card.todolistId}
          data-owner-decision-status=${todolistStatus ?? nothing}
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
                  class=${ownerDecisionStatusCalloutClass(todolistStatus)}
                  data-owner-decision-status-copy
                  style="margin: 0.35rem 0 0.5rem"
                >
                  ${statusCopy}
                </div>`
              : actionError
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
    })}
  `;
}

// Re-export for tests that assert email sanitization helpers.
export { ensurePlanStepSemicolon, looksLikeEmailAddress, resolveOwnerDecisionMentionLabel };
