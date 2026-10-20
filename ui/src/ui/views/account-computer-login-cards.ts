import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import type {
  LoginMethodChoiceUi,
  LoginSaveOfferUi,
} from "../gateway-subscriptions/account-computer-login.ts";

/**
 * Conversation-inline login cards. Same chrome as the steward confirm card:
 * glued under the transcript, not a second channel.
 */
export function renderAccountComputerLoginThreadCards(props: {
  sessionKey: string;
  choice?: LoginMethodChoiceUi | null;
  save?: LoginSaveOfferUi | null;
  busy?: boolean;
  error?: string | null;
  onChoose?: (choiceId: string, method: "password" | "qr") => void;
  onSave?: (saveId: string, save: boolean) => void;
}) {
  const choice = props.choice && props.choice.sessionKey === props.sessionKey ? props.choice : null;
  const save = props.save && props.save.sessionKey === props.sessionKey ? props.save : null;
  if (!choice && !save) {
    return nothing;
  }
  const busy = Boolean(props.busy);
  return html`
    ${
      choice
        ? html`
            <div
              class="employee-workbench__assistant-prelude chat-bubble employee-workbench__assistant-prelude-bubble employee-workbench__steward-confirm-card"
              role="group"
              aria-label=${t("chat.loginChoiceTitle")}
              data-login-choice=${choice.choiceId}
            >
              <div class="employee-workbench__assistant-prelude-title">
                ${t("chat.loginChoiceTitle")}
              </div>
              <div class="employee-workbench__assistant-prelude-copy">
                ${t("chat.loginChoiceBody", { host: choice.host })}
              </div>
              <div class="employee-workbench__assistant-prelude-toolbar">
                ${
                  choice.methods.includes("password")
                    ? html`
                        <button
                          type="button"
                          class="btn btn--sm primary"
                          data-login-method="password"
                          ?disabled=${busy || !props.onChoose}
                          @click=${() => props.onChoose?.(choice.choiceId, "password")}
                        >
                          ${t("chat.loginChoicePassword")}
                        </button>
                      `
                    : nothing
                }
                ${
                  choice.methods.includes("qr")
                    ? html`
                        <button
                          type="button"
                          class="btn btn--sm"
                          data-login-method="qr"
                          ?disabled=${busy || !props.onChoose}
                          @click=${() => props.onChoose?.(choice.choiceId, "qr")}
                        >
                          ${t("chat.loginChoiceQr")}
                        </button>
                      `
                    : nothing
                }
              </div>
            </div>
          `
        : nothing
    }
    ${
      save
        ? html`
            <div
              class="employee-workbench__assistant-prelude chat-bubble employee-workbench__assistant-prelude-bubble employee-workbench__steward-confirm-card"
              role="group"
              aria-label=${t("chat.loginSaveTitle")}
              data-login-save=${save.saveId}
            >
              <div class="employee-workbench__assistant-prelude-title">${t("chat.loginSaveTitle")}</div>
              <div class="employee-workbench__assistant-prelude-copy">
                ${t("chat.loginSaveBody", { host: save.host })}
              </div>
              <div class="employee-workbench__assistant-prelude-toolbar">
                <button
                  type="button"
                  class="btn btn--sm primary"
                  data-login-save="yes"
                  ?disabled=${busy || !props.onSave}
                  @click=${() => props.onSave?.(save.saveId, true)}
                >
                  ${t("chat.loginSaveYes")}
                </button>
                <button
                  type="button"
                  class="btn btn--sm"
                  data-login-save="no"
                  ?disabled=${busy || !props.onSave}
                  @click=${() => props.onSave?.(save.saveId, false)}
                >
                  ${t("chat.loginSaveNo")}
                </button>
              </div>
            </div>
          `
        : nothing
    }
    ${props.error ? html`<div class="exec-approval-error">${props.error}</div>` : nothing}
  `;
}
