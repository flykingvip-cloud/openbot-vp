import { html, type TemplateResult } from "lit";
import {
  sortDecisionHistory,
  getDecisionResultDisplay,
  type PromotionDecisionRecord,
} from "../../controllers/enterprise-incubation/promotion-decision.ts";
import {
  INCUBATION_CARD_FLAT,
  INCUBATION_SECTION_TITLE,
  INCUBATION_BADGE_GREEN,
  INCUBATION_BADGE_BLUE,
  INCUBATION_BADGE_RED,
  INCUBATION_TEXT_MUTED,
  INCUBATION_TEXT_BODY,
  INCUBATION_EMPTY_STATE,
  INCUBATION_EMPTY_TITLE,
  INCUBATION_EMPTY_DESCRIPTION,
} from "./shared/styles.css.ts";

/**
 * DecisionHistory 组件属性。
 *
 * Validates: Requirements 3.5, 3.6
 */
export type DecisionHistoryProps = {
  /** 决策历史记录（未排序，组件内部排序） */
  decisions: PromotionDecisionRecord[];
};

/** 决策结果到徽章样式的映射 */
const DECISION_BADGE_MAP: Record<string, string> = {
  "decision-recommend": INCUBATION_BADGE_GREEN,
  "decision-continue": INCUBATION_BADGE_BLUE,
  "decision-not-suitable": INCUBATION_BADGE_RED,
};

/**
 * 渲染决策历史列表。
 *
 * 按时间倒序展示历史决策记录，每条记录包含：
 * - 决策时间
 * - 决策结果（颜色编码徽章）
 * - 决策理由
 *
 * **Validates: Requirements 3.5, 3.6**
 */
export function renderDecisionHistory(props: DecisionHistoryProps): TemplateResult {
  const sorted = sortDecisionHistory(props.decisions);

  return html`
    <section class="${INCUBATION_CARD_FLAT}" aria-label="决策历史">
      <h3 class="${INCUBATION_SECTION_TITLE}">决策历史</h3>
      ${sorted.length === 0 ? renderEmptyState() : renderDecisionList(sorted)}
    </section>
  `;
}

/** 渲染空状态 */
function renderEmptyState(): TemplateResult {
  return html`
    <div class="${INCUBATION_EMPTY_STATE}">
      <p class="${INCUBATION_EMPTY_TITLE}">暂无决策记录</p>
      <p class="${INCUBATION_EMPTY_DESCRIPTION}">对该能力做出晋升决策后，记录将显示在此处。</p>
    </div>
  `;
}

/** 渲染决策记录列表 */
function renderDecisionList(decisions: PromotionDecisionRecord[]): TemplateResult {
  return html`
    <ul class="flex flex-col gap-3" role="list" aria-label="决策记录列表">
      ${decisions.map((decision) => renderDecisionItem(decision))}
    </ul>
  `;
}

/** 渲染单条决策记录 */
function renderDecisionItem(decision: PromotionDecisionRecord): TemplateResult {
  const display = getDecisionResultDisplay(decision.result);
  const badgeClass = DECISION_BADGE_MAP[display.styleClass] ?? INCUBATION_BADGE_BLUE;
  const timeStr = formatDecisionTime(decision.decidedAt);

  return html`
    <li class="border border-gray-200 rounded-md p-3">
      <div class="flex items-center justify-between mb-2">
        <time class="${INCUBATION_TEXT_MUTED}" datetime="${new Date(decision.decidedAt).toISOString()}">
          ${timeStr}
        </time>
        <span class="${badgeClass}" role="status" aria-label="决策结果：${display.label}">
          ${display.label}
        </span>
      </div>
      <p class="${INCUBATION_TEXT_BODY}">${decision.reason}</p>
    </li>
  `;
}

/** 格式化决策时间为可读字符串 */
function formatDecisionTime(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}
