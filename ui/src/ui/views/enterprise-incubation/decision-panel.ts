import { html, nothing, type TemplateResult } from "lit";
import {
  validateDecisionReason,
  getDecisionResultDisplay,
  type DecisionResult,
  type DecisionSubmitState,
} from "../../controllers/enterprise-incubation/promotion-decision.ts";
import {
  INCUBATION_CARD_FLAT,
  INCUBATION_SECTION_TITLE,
  INCUBATION_BTN_PRIMARY,
  INCUBATION_BTN_SECONDARY,
  INCUBATION_BTN_WARNING,
  INCUBATION_TEXT_MUTED,
  INCUBATION_TEXT_LINK,
  INCUBATION_FLEX_COL,
} from "./shared/styles.css.ts";

/**
 * DecisionPanel 组件属性。
 *
 * Validates: Requirements 3.1, 3.2, 3.5, 14.3
 */
export type DecisionPanelProps = {
  /** 当前能力 ID */
  capabilityId: string;
  /** 决策理由文本 */
  reason: string;
  /** 决策提交状态 */
  submitState: DecisionSubmitState;
  /** 最近一次决策结果（用于显示"立即上报"快捷入口） */
  lastDecisionResult: DecisionResult | null;
  /** 理由输入变更回调 */
  onReasonChange: (reason: string) => void;
  /** 决策提交回调 */
  onDecisionSubmit: (result: DecisionResult, reason: string) => void;
  /** "立即上报"点击回调 */
  onNavigateToUpload?: (capabilityId: string) => void;
};

const REASON_MIN = 10;
const REASON_MAX = 500;

/**
 * 渲染晋升决策面板。
 *
 * 包含三个决策按钮 + 理由输入 + 字符计数 + 验证提示。
 * 当最近决策为"推荐上报平台"时，显示"立即上报"快捷入口。
 *
 * **Validates: Requirements 3.1, 3.2, 3.5, 14.3**
 */
export function renderDecisionPanel(props: DecisionPanelProps): TemplateResult {
  const { reason, submitState, onReasonChange, onDecisionSubmit } = props;
  const validation = validateDecisionReason(reason);
  const charCount = reason.length;
  const isSubmitting = submitState.loading;

  return html`
    <section class="${INCUBATION_CARD_FLAT}" aria-label="晋升决策面板">
      <h3 class="${INCUBATION_SECTION_TITLE}">晋升决策</h3>

      <!-- 决策理由输入 -->
      <div class="${INCUBATION_FLEX_COL} gap-2 mb-4">
        <label for="decision-reason" class="text-sm font-medium text-gray-700">
          决策理由 <span class="text-red-500">*</span>
        </label>
        <textarea
          id="decision-reason"
          class="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-y min-h-[80px]"
          placeholder="请输入决策理由（${REASON_MIN}-${REASON_MAX} 字符）"
          .value="${reason}"
          ?disabled="${isSubmitting}"
          @input="${(e: InputEvent) => {
            const target = e.target as HTMLTextAreaElement;
            onReasonChange(target.value);
          }}"
          aria-describedby="reason-char-count reason-error"
          aria-required="true"
        ></textarea>
        <div class="flex items-center justify-between">
          <span
            id="reason-char-count"
            class="${charCount > REASON_MAX ? "text-xs text-red-500" : INCUBATION_TEXT_MUTED}"
          >
            ${charCount}/${REASON_MAX} 字符
          </span>
          ${
            !validation.valid && charCount > 0
              ? html`<span id="reason-error" class="text-xs text-red-500" role="alert">
                  ${validation.error}
                </span>`
              : nothing
          }
        </div>
      </div>

      <!-- 决策按钮组 -->
      <div class="flex flex-wrap gap-3 mb-4" role="group" aria-label="决策操作">
        <button
          type="button"
          class="${INCUBATION_BTN_PRIMARY}"
          ?disabled="${!validation.valid || isSubmitting}"
          @click="${() => onDecisionSubmit("recommend_upload", reason)}"
          aria-label="${getDecisionResultDisplay("recommend_upload").label}"
        >
          ${isSubmitting ? "提交中…" : "推荐上报平台"}
        </button>
        <button
          type="button"
          class="${INCUBATION_BTN_SECONDARY}"
          ?disabled="${!validation.valid || isSubmitting}"
          @click="${() => onDecisionSubmit("continue_incubation", reason)}"
          aria-label="${getDecisionResultDisplay("continue_incubation").label}"
        >
          继续孵化
        </button>
        <button
          type="button"
          class="${INCUBATION_BTN_WARNING}"
          ?disabled="${!validation.valid || isSubmitting}"
          @click="${() => onDecisionSubmit("not_suitable", reason)}"
          aria-label="${getDecisionResultDisplay("not_suitable").label}"
        >
          不适合晋升
        </button>
      </div>

      <!-- 提交状态反馈 -->
      ${renderSubmitFeedback(submitState)}

      <!-- "立即上报"快捷入口（仅在最近决策为"推荐上报平台"时显示） -->
      ${renderUploadQuickEntry(props)}
    </section>
  `;
}

/** 渲染提交状态反馈 */
function renderSubmitFeedback(state: DecisionSubmitState): TemplateResult | typeof nothing {
  if (state.error) {
    return html`<p class="text-sm text-red-600 mb-2" role="alert">${state.error}</p>`;
  }
  if (state.success) {
    return html`
      <p class="text-sm text-green-600 mb-2" role="status">决策已提交成功</p>
    `;
  }
  return nothing;
}

/** 渲染"立即上报"快捷入口（Requirement 14.3） */
function renderUploadQuickEntry(props: DecisionPanelProps): TemplateResult | typeof nothing {
  if (props.lastDecisionResult !== "recommend_upload" || !props.onNavigateToUpload) {
    return nothing;
  }
  return html`
    <div class="mt-3 pt-3 border-t border-gray-200">
      <button
        type="button"
        class="${INCUBATION_TEXT_LINK}"
        @click="${() => props.onNavigateToUpload!(props.capabilityId)}"
        aria-label="立即上报此能力到平台"
      >
        → 立即上报
      </button>
      <span class="${INCUBATION_TEXT_MUTED} ml-2">点击进入上报表单，自动填充能力信息</span>
    </div>
  `;
}
