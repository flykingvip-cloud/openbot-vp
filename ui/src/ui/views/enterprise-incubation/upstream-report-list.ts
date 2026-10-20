/**
 * 上报记录列表（UpstreamReportList）
 *
 * 展示所有已上报能力的列表及其当前审批状态，每条记录包含：
 * - 能力名称
 * - 上报时间
 * - 当前审批状态（颜色编码徽章）
 * - "查看能力详情"跳转链接
 *
 * 颜色编码规则（Requirement 6.3）：
 * - 待审批 → 灰色
 * - 审批中 → 蓝色
 * - 已通过 → 绿色
 * - 已拒绝 → 红色
 * - 需补充材料 → 橙色
 *
 * 验证需求：5.8, 6.1, 6.3, 6.4, 6.5, 14.4
 *
 * @module upstream-report-list
 */

import { html, type TemplateResult } from "lit";
import {
  getProposalStatusDisplay,
  type ProposalStatus,
} from "../../controllers/enterprise-incubation/upstream-report.ts";
import {
  INCUBATION_CARD_FLAT,
  INCUBATION_SECTION_TITLE,
  INCUBATION_TEXT_MUTED,
  INCUBATION_TEXT_LINK,
  INCUBATION_TEXT_STRONG,
  INCUBATION_EMPTY_STATE,
  INCUBATION_EMPTY_TITLE,
  INCUBATION_EMPTY_DESCRIPTION,
  PROPOSAL_STATUS_BADGE,
} from "./shared/styles.css.ts";

// ─── 类型定义 ────────────────────────────────────────────────────────────────

/** 上报记录列表项 */
export type UpstreamReportListItem = {
  /** 上报记录 ID */
  reportId: string;
  /** 能力 ID（用于跳转详情） */
  capabilityId: string;
  /** 能力名称 */
  capabilityName: string;
  /** 上报时间（Unix 时间戳 ms） */
  uploadedAt: number;
  /** 当前审批状态 */
  proposalStatus: ProposalStatus;
};

/** UpstreamReportList 组件属性 */
export type UpstreamReportListProps = {
  /** 上报记录列表 */
  reports: UpstreamReportListItem[];
  /** 点击"查看能力详情"时的回调 */
  onNavigateToCapability: (capabilityId: string) => void;
  /** 点击记录行时的回调（可选，用于进入详情页查看时间线） */
  onNavigateToDetail?: (reportId: string) => void;
};

// ─── 渲染函数 ────────────────────────────────────────────────────────────────

/**
 * 渲染上报记录列表。
 *
 * 展示所有已上报能力及其审批状态，支持跳转至能力详情页。
 *
 * **Validates: Requirements 5.8, 6.1, 6.3, 6.4, 6.5, 14.4**
 */
export function renderUpstreamReportList(props: UpstreamReportListProps): TemplateResult {
  const { reports } = props;

  return html`
    <section class="${INCUBATION_CARD_FLAT}" aria-label="上报记录列表">
      <h3 class="${INCUBATION_SECTION_TITLE}">上报记录</h3>
      ${reports.length === 0 ? renderEmptyState() : renderReportList(props)}
    </section>
  `;
}

/** 渲染空状态 */
function renderEmptyState(): TemplateResult {
  return html`
    <div class="${INCUBATION_EMPTY_STATE}">
      <p class="${INCUBATION_EMPTY_TITLE}">暂无上报记录</p>
      <p class="${INCUBATION_EMPTY_DESCRIPTION}">
        将候选能力推荐上报到平台后，记录将显示在此处。
      </p>
    </div>
  `;
}

/** 渲染记录列表 */
function renderReportList(props: UpstreamReportListProps): TemplateResult {
  return html`
    <ul class="enterprise-incubation-report-list" role="list" aria-label="上报记录">
      ${props.reports.map((report) => renderReportItem(report, props))}
    </ul>
  `;
}

/** 渲染单条上报记录 */
function renderReportItem(
  report: UpstreamReportListItem,
  props: UpstreamReportListProps,
): TemplateResult {
  const statusDisplay = getProposalStatusDisplay(report.proposalStatus);
  const badgeClass = PROPOSAL_STATUS_BADGE[mapStatusToStyleKey(report.proposalStatus)] ?? "";
  const timeStr = formatUploadTime(report.uploadedAt);

  return html`
    <li class="enterprise-incubation-report-item">
      <div class="enterprise-incubation-report-item__header">
        <!-- 能力名称 -->
        <span class="${INCUBATION_TEXT_STRONG}">${report.capabilityName}</span>
        <!-- 状态徽章 -->
        <span
          class="${badgeClass}"
          role="status"
          aria-label="审批状态：${statusDisplay.label}"
        >${statusDisplay.label}</span>
      </div>
      <div class="enterprise-incubation-report-item__meta">
        <!-- 上报时间 -->
        <time
          class="${INCUBATION_TEXT_MUTED}"
          datetime="${new Date(report.uploadedAt).toISOString()}"
        >上报时间：${timeStr}</time>
        <!-- 查看能力详情链接 (Requirement 14.4) -->
        <a
          class="${INCUBATION_TEXT_LINK}"
          href="#"
          @click=${(e: Event) => {
            e.preventDefault();
            props.onNavigateToCapability(report.capabilityId);
          }}
        >查看能力详情</a>
      </div>
      ${report.proposalStatus === "approved" ? renderApprovedBadge() : ""}
    </li>
  `;
}

/**
 * 渲染"已晋升为平台标准能力"标识（Requirement 6.4）。
 */
function renderApprovedBadge(): TemplateResult {
  return html`
    <div class="enterprise-incubation-report-item__approved">
      <span class="enterprise-incubation-approved-badge">
        <svg
          class="enterprise-incubation-approved-badge__icon"
          fill="currentColor"
          viewBox="0 0 20 20"
          aria-hidden="true"
        >
          <path
            fill-rule="evenodd"
            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
            clip-rule="evenodd"
          />
        </svg>
        已晋升为平台标准能力
      </span>
    </div>
  `;
}

// ─── 辅助函数 ────────────────────────────────────────────────────────────────

/**
 * 将 ProposalStatus 映射到 PROPOSAL_STATUS_BADGE 的 key。
 *
 * 控制器中 ProposalStatus 使用 "supplement"，
 * 而 PROPOSAL_STATUS_BADGE 使用 "supplement_required"。
 */
function mapStatusToStyleKey(status: ProposalStatus): string {
  if (status === "supplement") {
    return "supplement_required";
  }
  return status;
}

/** 格式化上报时间为可读字符串 */
function formatUploadTime(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}
