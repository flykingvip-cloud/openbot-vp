import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import type { AppViewState } from "../app-view-state.ts";
import type {
  SecureFormFieldTargetUi,
  SecureFormHandoffActiveUi,
  SecureFormOfferedUi,
  SecureFormReceiptUi,
} from "../gateway-subscriptions/secure-form.ts";

function inputTypeFor(kind: SecureFormFieldTargetUi["kind"]): "text" | "password" {
  return kind === "password" || kind === "otp" ? "password" : "text";
}

function receiptReasonLabel(code?: string, detail?: string): string {
  if (code === "domain_mismatch") {
    return t("chat.secureFormReasonDomainMismatch");
  }
  if (code === "user_declined") {
    return t("chat.secureFormReasonDeclined");
  }
  if (code === "cancelled_by_takeover") {
    return t("chat.secureFormReasonTakeover");
  }
  if (code === "user_timeout") {
    return t("chat.secureFormReasonTimeout");
  }
  if (code === "browser_unavailable") {
    return t("chat.secureFormReasonBrowser");
  }
  if (detail?.trim()) {
    return detail.trim();
  }
  return code?.trim() || t("chat.secureFormReasonUnknown");
}

const THREAD_CARD_CLASS =
  "employee-workbench__assistant-prelude chat-bubble employee-workbench__assistant-prelude-bubble employee-workbench__steward-confirm-card";

export type SecureFormThreadCardProps = {
  sessionKey: string;
  offered?: SecureFormOfferedUi | null;
  handoff?: SecureFormHandoffActiveUi | null;
  receipt?: SecureFormReceiptUi | null;
  values?: Record<string, string>;
  busy?: boolean;
  error?: string | null;
  onFieldInput?: (fieldId: string, value: string) => void;
  onSubmit?: () => void;
  onClose?: () => void;
  onUseComputer?: () => void;
  /** Optional rare manual handback (computer chrome). Handoff card no longer requires it. */
  onHandBack?: () => void;
  /** Hide the reminder card only; auto-resume still runs. */
  onHandoffDismiss?: () => void;
};

/**
 * Conversation-inline Secure Form + Chrome handoff cards.
 * Same steward-confirm chrome as login / Grok-style auth cards — never a
 * fullscreen exec-approval overlay that jumps Control UI off the transcript.
 */
export function renderSecureFormThreadCards(props: SecureFormThreadCardProps) {
  const sessionKey = props.sessionKey.trim();
  const offered = props.offered && props.offered.sessionKey === sessionKey ? props.offered : null;
  const handoff = props.handoff && props.handoff.sessionKey === sessionKey ? props.handoff : null;
  const receipt = !offered && !handoff ? (props.receipt ?? null) : null;
  const busy = Boolean(props.busy);
  const values = props.values ?? {};

  if (!offered && !handoff && !receipt) {
    return nothing;
  }

  if (receipt) {
    const msg =
      receipt.status === "filled"
        ? t("chat.secureFormFilled")
        : t("chat.secureFormFailed", {
            reason: receiptReasonLabel(receipt.code, receipt.detail),
          });
    return html`
      <div
        class=${THREAD_CARD_CLASS}
        data-surface="secure-form"
        data-placement="conversation"
        role="status"
        aria-live="polite"
      >
        <div class="employee-workbench__assistant-prelude-title">${msg}</div>
      </div>
    `;
  }

  if (handoff) {
    // Auto-resume QR/SMS gate: chat already carries a short reminder; do not
    // duplicate a conversation handoff card (title / long body / 收起卡片).
    // Handoff state is still stored so handoff_returned can clear it; Secure
    // Form password fill (offered) and receipts stay on separate paths.
    return nothing;
  }

  if (!offered) {
    return nothing;
  }

  return html`
    <div
      class=${THREAD_CARD_CLASS}
      data-surface="secure-form"
      data-placement="conversation"
      role="group"
      aria-live="polite"
      aria-label=${t("chat.secureFormTitle")}
    >
      <div class="employee-workbench__assistant-prelude-title">${t("chat.secureFormTitle")}</div>
      <div class="employee-workbench__assistant-prelude-copy">${t("chat.secureFormSubtitle")}</div>
      <div class="exec-approval-meta" style="margin:0.5rem 0;">
        <div class="exec-approval-meta-row">
          <span>${t("chat.secureFormDomain", { host: offered.domain.host })}</span>
        </div>
      </div>
      <div
        class="secure-form-fields"
        style="display:flex;flex-direction:column;gap:0.75rem;margin:0.5rem 0 0.75rem;"
      >
        ${offered.fields.map(
          (field) => html`
            <label style="display:flex;flex-direction:column;gap:0.25rem;">
              <span>${field.label}</span>
              <input
                class="input"
                type=${inputTypeFor(field.kind)}
                autocomplete="off"
                spellcheck="false"
                .value=${values[field.fieldId] ?? ""}
                ?disabled=${busy}
                @input=${(e: Event) => {
                  const target = e.target as HTMLInputElement;
                  props.onFieldInput?.(field.fieldId, target.value);
                }}
              />
            </label>
          `,
        )}
      </div>
      ${props.error ? html`<div class="exec-approval-error">${props.error}</div>` : nothing}
      <div class="employee-workbench__assistant-prelude-toolbar">
        <button
          type="button"
          class="btn btn--sm primary"
          ?disabled=${busy}
          @click=${() => props.onSubmit?.()}
        >
          ${t("chat.secureFormSubmit")}
        </button>
        <button
          type="button"
          class="btn btn--sm"
          ?disabled=${busy}
          @click=${() => props.onUseComputer?.()}
        >
          ${t("chat.secureFormUseComputer")}
        </button>
        <button
          type="button"
          class="btn btn--sm"
          ?disabled=${busy}
          @click=${() => props.onClose?.()}
        >
          ${t("chat.secureFormClose")}
        </button>
      </div>
    </div>
  `;
}

/**
 * @deprecated Overlay placement removed — cards live in the chat thread.
 * Kept as a no-op so legacy app-render call sites stay safe until cleaned up.
 */
export function renderSecureFormCard(_state: AppViewState) {
  return nothing;
}

/** Test helper: build thread cards from AppViewState (mirrors chat wiring). */
export function renderSecureFormCardFromState(state: AppViewState) {
  return renderSecureFormThreadCards({
    sessionKey: state.sessionKey,
    offered: state.secureFormOffered,
    handoff: state.secureFormHandoff,
    receipt: state.secureFormReceipt,
    values: state.secureFormValues,
    busy: state.secureFormBusy,
    error: state.secureFormError,
    onFieldInput: (fieldId, value) => state.handleSecureFormFieldInput(fieldId, value),
    onSubmit: () => void state.handleSecureFormSubmit(),
    onClose: () => void state.handleSecureFormClose(),
    onUseComputer: () => void state.handleSecureFormUseComputer(),
    onHandBack: () => void state.handleSecureFormHandoffReturn?.(),
    onHandoffDismiss: () => state.handleSecureFormHandoffDismiss(),
  });
}
