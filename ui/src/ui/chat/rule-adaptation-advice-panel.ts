import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";

export const EMPLOYEE_ADVICE_METHOD = "runtime-rule-adaptation.advice" as const;

export type EmployeeAdviceState =
  | "no_change"
  | "needs_information"
  | "blocked"
  | "adjustment_suggested"
  | "failed";

export type EmployeeAdviceReasonView = {
  code: string;
  message: string;
  path?: string;
};

export type EmployeeAdviceView = {
  state: EmployeeAdviceState;
  label: string;
  notEffective: true;
  notEffectiveLabel: string;
  summary: string;
  reasons: EmployeeAdviceReasonView[];
  proposal?: unknown;
  outcomeCode?: string;
  activationAllowed: false;
  requestId: string;
  modelCalled: boolean;
};

export type RuleAdaptationAdvicePanelModel = {
  status: "idle" | "loading" | "result" | "failed" | "cancelled";
  result: EmployeeAdviceView | null;
  error: string | null;
};

export type RuleAdaptationAdvicePanelProps = {
  advice?: RuleAdaptationAdvicePanelModel | null;
  onRequest?: () => void;
  onCancel?: () => void;
  connected?: boolean;
  compact?: boolean;
};

const STATE_CLASS: Record<EmployeeAdviceState, string> = {
  no_change: "is-no-change",
  needs_information: "is-needs-information",
  blocked: "is-blocked",
  adjustment_suggested: "is-adjustment",
  failed: "is-failed",
};

function formatProposal(proposal: unknown): string | null {
  if (proposal == null) {
    return null;
  }
  try {
    return JSON.stringify(proposal, null, 2);
  } catch {
    return null;
  }
}

export function renderRuleAdaptationAdvicePanel(props: RuleAdaptationAdvicePanelProps) {
  const advice = props.advice;
  if (!advice || advice.status === "idle") {
    return nothing;
  }
  if (advice.status === "cancelled") {
    return html`
      <div
        class="rule-adaptation-advice"
        data-testid="rule-adaptation-advice-panel"
        data-state="cancelled"
      >
        <div class="rule-adaptation-advice__head">
          <strong>${t("chat.ruleAdaptationAdvice.title")}</strong>
          <span class="rule-adaptation-advice__badge">${t("chat.ruleAdaptationAdvice.notEffective")}</span>
        </div>
        <p class="rule-adaptation-advice__summary">${t("chat.ruleAdaptationAdvice.cancelled")}</p>
      </div>
    `;
  }
  if (advice.status === "loading") {
    return html`
      <div
        class="rule-adaptation-advice is-loading"
        data-testid="rule-adaptation-advice-panel"
        data-state="loading"
      >
        <div class="rule-adaptation-advice__head">
          <strong>${t("chat.ruleAdaptationAdvice.title")}</strong>
          <span class="rule-adaptation-advice__badge">${t("chat.ruleAdaptationAdvice.notEffective")}</span>
        </div>
        <p class="rule-adaptation-advice__summary">${t("chat.ruleAdaptationAdvice.loading")}</p>
        ${
          props.onCancel
            ? html`<button
                type="button"
                class="btn btn--sm"
                data-testid="rule-adaptation-advice-cancel"
                @click=${props.onCancel}
              >
                ${t("chat.ruleAdaptationAdvice.cancel")}
              </button>`
            : nothing
        }
      </div>
    `;
  }
  const result = advice.result;
  const state = result?.state ?? "failed";
  const summary = result?.summary ?? advice.error ?? t("chat.ruleAdaptationAdvice.failed");
  const proposalText = formatProposal(result?.proposal);
  const reasons = result?.reasons ?? [];
  return html`
    <div
      class="rule-adaptation-advice ${STATE_CLASS[state] ?? ""}"
      data-testid="rule-adaptation-advice-panel"
      data-state=${state}
    >
      <div class="rule-adaptation-advice__head">
        <strong data-testid="rule-adaptation-advice-label">${result?.label ?? t("chat.ruleAdaptationAdvice.failed")}</strong>
        <span class="rule-adaptation-advice__badge" data-testid="rule-adaptation-advice-not-effective">
          ${result?.notEffectiveLabel ?? t("chat.ruleAdaptationAdvice.notEffective")}
        </span>
      </div>
      <p class="rule-adaptation-advice__summary" data-testid="rule-adaptation-advice-summary">${summary}</p>
      ${
        reasons.length > 0
          ? html`<ul class="rule-adaptation-advice__reasons">
              ${reasons.map((reason) => html`<li>${reason.message}</li>`)}
            </ul>`
          : nothing
      }
      ${
        proposalText
          ? html`<pre class="rule-adaptation-advice__proposal" data-testid="rule-adaptation-advice-proposal">${proposalText}</pre>`
          : nothing
      }
      <p class="rule-adaptation-advice__footnote">${t("chat.ruleAdaptationAdvice.footnote")}</p>
    </div>
  `;
}

export function renderRuleAdaptationAdviceButton(props: RuleAdaptationAdvicePanelProps) {
  const loading = props.advice?.status === "loading";
  const disabled = !props.connected || loading;
  return html`
    <button
      type="button"
      class="btn ${props.compact ? "btn--sm chat-compose__advice-btn" : ""}"
      data-testid="rule-adaptation-advice-trigger"
      ?disabled=${disabled}
      title=${t("chat.ruleAdaptationAdvice.title")}
      aria-label=${t("chat.ruleAdaptationAdvice.title")}
      @click=${() => {
        if (disabled) {
          return;
        }
        props.onRequest?.();
      }}
    >
      ${t("chat.ruleAdaptationAdvice.title")}
    </button>
  `;
}
