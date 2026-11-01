/**
 * Human-attention takeover card (watchdog / heartbeat).
 * Renders ```human-attention``` / structured humanAttention rows with
 * failure-kind-gated action buttons. side_effect_unknown never offers blind retry.
 */
import { html, nothing, type TemplateResult } from "lit";
import {
  parseHumanAttentionCard,
  parseHumanAttentionFence,
  assertsNoBlindRetryOption,
  type HumanAttentionCard,
  type HumanAttentionOptionId,
} from "../../../../src/gateway/collaboration-dispatch/human-attention-card.js";

export type HumanAttentionCardView = HumanAttentionCard;
export type HumanAttentionAction = HumanAttentionOptionId;

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

export type HumanAttentionRead = {
  card: HumanAttentionCardView;
  authority: "structured" | "fence";
};

export function readHumanAttentionRow(message: unknown): HumanAttentionRead | null {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return null;
  }
  const row = message as { humanAttention?: unknown; content?: unknown };
  const fromField = parseHumanAttentionCard(row.humanAttention);
  if (fromField && assertsNoBlindRetryOption(fromField)) {
    return { card: fromField, authority: "structured" };
  }
  const text = extractTextFromContent(row.content);
  if (!text) {
    return null;
  }
  const fromFence = parseHumanAttentionFence(text);
  if (fromFence && assertsNoBlindRetryOption(fromFence)) {
    return { card: fromFence, authority: "fence" };
  }
  return null;
}

export type HumanAttentionActDetail = {
  note?: string;
  transferOwnerId?: string;
};

export type RenderHumanAttentionCardsOpts = {
  busy?: boolean;
  onAct?: (
    action: HumanAttentionAction,
    card: HumanAttentionCardView,
    detail?: HumanAttentionActDetail,
  ) => void;
};

/** Sticky pile: latest card per todoId wins. */
export function renderHumanAttentionCards(
  history: unknown[],
  opts: RenderHumanAttentionCardsOpts = {},
): TemplateResult | typeof nothing {
  const byTodo = new Map<string, HumanAttentionRead>();
  for (const message of history) {
    const read = readHumanAttentionRow(message);
    if (!read) {
      continue;
    }
    byTodo.set(read.card.todoId, read);
  }
  const cards = [...byTodo.values()];
  if (cards.length === 0) {
    return nothing;
  }
  return html`
    <div class="employee-workbench__human-attention-stack" data-human-attention-stack>
      ${cards.map(({ card, authority }) => renderOneCard(card, authority, opts))}
    </div>
  `;
}

function renderOneCard(
  card: HumanAttentionCardView,
  authority: "structured" | "fence",
  opts: RenderHumanAttentionCardsOpts,
): TemplateResult {
  const resolved =
    card.status === "resolved" ||
    card.status === "recovered" ||
    // Legacy cards without status: empty options imply terminal.
    (card.status == null && Boolean(card.resolution) && card.options.length === 0);
  return html`
    <div
      class="employee-workbench__assistant-prelude chat-bubble employee-workbench__assistant-prelude-bubble employee-workbench__steward-confirm-card employee-workbench__human-attention-card"
      data-human-attention=${card.todoId}
      data-human-attention-version=${card.version}
      data-human-attention-fingerprint=${card.fingerprint}
      data-human-attention-kind=${card.failureKind}
      data-human-attention-authority=${authority}
      ?data-human-attention-terminal=${resolved}
    >
      <div class="employee-workbench__steward-confirm-title">${card.title}</div>
      <ul class="employee-workbench__human-attention-summary">
        ${card.summary.map((line) => html`<li>${line}</li>`)}
      </ul>
      <div class="employee-workbench__human-attention-hint">恢复建议：${card.recoveryHint}</div>
      ${
        resolved
          ? html`<div class="employee-workbench__human-attention-resolution" data-human-attention-resolution>
              处理人：${card.resolution!.actorId} · ${card.resolution!.result}
            </div>`
          : html`
              <div class="employee-workbench__steward-confirm-actions" data-human-attention-actions>
                ${card.options.map(
                  (opt) => html`
                    <button
                      type="button"
                      class="employee-workbench__steward-confirm-action"
                      data-human-attention-action=${opt.id}
                      data-style=${opt.style}
                      ?disabled=${Boolean(opts.busy)}
                      @click=${() => {
                        if (!opts.onAct || opts.busy) {
                          return;
                        }
                        if (opt.id === "release_after_verify") {
                          const note =
                            typeof window !== "undefined"
                              ? window.prompt("请填写副作用核实说明（必填）", "")
                              : "";
                          if (!note || !note.trim()) {
                            return;
                          }
                          opts.onAct(opt.id, card, { note: note.trim() });
                          return;
                        }
                        if (opt.id === "transfer") {
                          const transferOwnerId =
                            typeof window !== "undefined"
                              ? window.prompt("转交给（责任人 ID）", "")
                              : "";
                          if (!transferOwnerId || !transferOwnerId.trim()) {
                            return;
                          }
                          opts.onAct(opt.id, card, {
                            transferOwnerId: transferOwnerId.trim(),
                          });
                          return;
                        }
                        opts.onAct(opt.id, card);
                      }}
                    >
                      ${opt.label}
                    </button>
                  `,
                )}
              </div>
            `
      }
    </div>
  `;
}
