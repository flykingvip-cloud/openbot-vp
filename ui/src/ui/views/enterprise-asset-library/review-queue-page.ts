/**
 * 审核队列页面（ReviewQueuePage）
 *
 * 展示待审核/审核中的能力提交，供企业管理员进行安全与质量审核。
 *
 * 验证需求：14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8, 14.9, 19.2
 *
 * 样式：完全使用 enterprise-foundation.css + enterprise-components.css 的 class
 * 体系，不再使用 inline style。响应主题切换。
 */

import { html, nothing, type TemplateResult } from "lit";
import type { ReviewQueueItemWithAssessment } from "../../capability/enterprise-capability/endpoints.ts";
import type {
  PaginationState,
  ReviewApprovalPayload,
  ReviewRecord,
} from "../../capability/enterprise-capability/types.ts";
import { CAPABILITY_DOMAINS } from "../../capability/enterprise-capability/types.ts";
import { renderPagination } from "./pagination.ts";

export type ReviewQueuePageProps = {
  items: ReviewQueueItemWithAssessment[];
  loading: boolean;
  error: string | null;
  pagination: PaginationState;
  filters: { status: "待审核" | "审核中" | null; searchQuery: string };
  submitting: boolean;
  submitError: string | null;
  lastReviewRecord: ReviewRecord | null;
  lastEmployeeFeedbackNotice: string | null;
  onFilterChange: (key: "status" | "searchQuery", value: string | null) => void;
  onPageChange: (page: number) => void;
  onApprove: (reviewTaskId: string, opinion: string, approval: ReviewApprovalPayload) => void;
  onReject: (reviewTaskId: string, opinion: string) => void;
  onRequestModification: (reviewTaskId: string, opinion: string) => void;
  onBack: () => void;
};

type ReviewFormField =
  | "opinion"
  | "scopeKind"
  | "scopeValue"
  | "domain"
  | "executionMode"
  | "needsEnterpriseSecrets"
  | "promoteToIncubation";

function readField(root: ParentNode, field: ReviewFormField): string {
  const target = root.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
    `[data-review-field="${field}"]`,
  );
  return target?.value ?? "";
}

function isChecked(root: ParentNode, field: ReviewFormField): boolean {
  return Boolean(root.querySelector<HTMLInputElement>(`[data-review-field="${field}"]`)?.checked);
}

function toScopePayload(kind: string, value: string): ReviewApprovalPayload["applicableScope"] {
  const trimmed = value.trim();
  switch (kind) {
    case "department":
      return { kind: "department", id: trimmed, name: trimmed };
    case "group":
      return { kind: "group", id: trimmed, name: trimmed };
    case "role":
      return { kind: "role", id: trimmed, name: trimmed };
    case "enterprise":
    default:
      return { kind: "enterprise" };
  }
}

function renderAssessment(entry: ReviewQueueItemWithAssessment): TemplateResult {
  return html`
    <div class="enterprise-content-card__meta">
      安全性：敏感信息 ${entry.assessment.security.sensitiveInfo ? "有" : "无"} ·
      危险操作 ${entry.assessment.security.dangerousOps ? "有" : "无"} ·
      外部调用 ${entry.assessment.security.externalCalls ? "有" : "无"}
    </div>
    <div class="enterprise-content-card__meta">
      质量：近 30 天成功率 ${entry.assessment.quality.successRate30d}% ·
      复用员工 ${entry.assessment.quality.employeeCount} 人 ·
      命名规范 ${entry.assessment.quality.namingCompliant ? "符合" : "待整理"}
    </div>
  `;
}

function renderAssetPackage(entry: ReviewQueueItemWithAssessment): TemplateResult | typeof nothing {
  const pkg = entry.item.enterpriseAssetPackage;
  if (!pkg) {
    return nothing;
  }
  return html`
    <div class="enterprise-content-card__meta">
      资产包：${pkg.packageTitle} · ${pkg.assetPackageType} · ${pkg.executionMode}
    </div>
    ${
      pkg.businessScenario
        ? html`
            <div class="enterprise-content-card__meta">
              业务场景：${pkg.businessScenario}
            </div>
          `
        : nothing
    }
    ${
      pkg.targetTeams.length > 0
        ? html`
            <div class="enterprise-content-card__meta">
              适用团队：${pkg.targetTeams.join("、")}
            </div>
          `
        : nothing
    }
    ${
      pkg.dependencies.length > 0
        ? html`
            <div class="enterprise-content-card__meta">
              依赖项：${pkg.dependencies.join("、")}
            </div>
          `
        : nothing
    }
    ${
      pkg.riskTags.length > 0
        ? html`
            <div class="enterprise-content-card__meta">
              风险标签：${pkg.riskTags.join("、")}
            </div>
          `
        : nothing
    }
    <div class="enterprise-content-card__meta">
      凭证依赖：${pkg.needsEnterpriseSecrets ? "需要企业托管" : "无需企业托管"} ·
      生产验证：${pkg.verifiedInProduction ? "已验证" : "未验证"}
    </div>
  `;
}

function renderReviewForm(
  entry: ReviewQueueItemWithAssessment,
  props: ReviewQueuePageProps,
): TemplateResult {
  // Proposal IDs contain ":" and "@" (e.g. proposal:urn:openclaw:skill:foo@1.0.2).
  // Those characters make `#id` querySelector throw, so clicks look dead.
  // Read fields by data-review-field within the form root instead.

  return html`
    <div class="review-queue-page__form">
      ${
        props.submitError
          ? html`<div class="review-queue-page__submit-error">${props.submitError}</div>`
          : nothing
      }
      <textarea
        data-review-field="opinion"
        class="enterprise-filter-bar__input"
        placeholder="填写审核意见；拒绝/需修改至少 10 个字符"
      ></textarea>
      <div class="enterprise-filter-bar">
        <select data-review-field="scopeKind" class="enterprise-filter-bar__select">
          <option value="enterprise">全企业</option>
          <option value="department">部门</option>
          <option value="group">协作组</option>
          <option value="role">角色</option>
        </select>
        <input
          data-review-field="scopeValue"
          type="text"
          class="enterprise-filter-bar__input"
          placeholder="部门/协作组/角色名称"
        />
        <select data-review-field="domain" class="enterprise-filter-bar__select">
          ${CAPABILITY_DOMAINS.map((domain) => html`<option value=${domain}>${domain}</option>`)}
        </select>
      </div>
      <div class="enterprise-filter-bar">
        <select data-review-field="executionMode" class="enterprise-filter-bar__select">
          <option value="">默认执行方式</option>
          <option value="assistive">仅辅助使用</option>
          <option value="semi_automatic">半自动执行</option>
          <option value="automatic">允许自动执行</option>
        </select>
        <label class="enterprise-content-card__meta">
          <input data-review-field="needsEnterpriseSecrets" type="checkbox" />
          要求企业托管凭证
        </label>
        <label class="enterprise-content-card__meta">
          <input data-review-field="promoteToIncubation" type="checkbox" />
          加入孵化候选
        </label>
      </div>
      <div class="enterprise-content-card__actions">
        <button
          type="button"
          class="enterprise-btn enterprise-btn--success"
          .disabled=${props.submitting}
          @click=${(event: Event) => {
            const root = (event.currentTarget as HTMLElement).closest(".review-queue-page__form");
            if (!root) {
              return;
            }
            const executionMode = readField(
              root,
              "executionMode",
            ) as ReviewApprovalPayload["executionMode"];
            props.onApprove(entry.item.id, readField(root, "opinion"), {
              applicableScope: toScopePayload(
                readField(root, "scopeKind"),
                readField(root, "scopeValue"),
              ),
              domain: readField(root, "domain") as ReviewApprovalPayload["domain"],
              ...(executionMode ? { executionMode } : {}),
              needsEnterpriseSecrets: isChecked(root, "needsEnterpriseSecrets"),
              promoteToIncubation: isChecked(root, "promoteToIncubation"),
            });
          }}
        >
          ${props.submitting ? "提交中..." : "通过"}
        </button>
        <button
          type="button"
          class="enterprise-btn enterprise-btn--danger"
          .disabled=${props.submitting}
          @click=${(event: Event) => {
            const root = (event.currentTarget as HTMLElement).closest(".review-queue-page__form");
            if (!root) {
              return;
            }
            props.onReject(entry.item.id, readField(root, "opinion"));
          }}
        >
          拒绝
        </button>
        <button
          type="button"
          class="enterprise-btn enterprise-btn--warning"
          .disabled=${props.submitting}
          @click=${(event: Event) => {
            const root = (event.currentTarget as HTMLElement).closest(".review-queue-page__form");
            if (!root) {
              return;
            }
            props.onRequestModification(entry.item.id, readField(root, "opinion"));
          }}
        >
          需修改
        </button>
      </div>
    </div>
  `;
}

export function renderReviewQueuePage(props: ReviewQueuePageProps): TemplateResult {
  const { items, loading, error, pagination, filters, onFilterChange, onPageChange, onBack } =
    props;

  return html`
    <div class="review-queue-page enterprise-page">
      <div class="enterprise-page__content">
        <header class="enterprise-page-header-row">
          <button type="button" class="enterprise-back-btn" @click=${onBack}>← 返回</button>
          <div>
            <h1 class="enterprise-page-header-row__title">审核队列</h1>
            <p class="enterprise-page-header-row__subtitle">
              员工提交的资产先在这里完成质量与安全审核；选择“需修改”会退回员工端继续整理。
            </p>
          </div>
        </header>

        <div class="enterprise-filter-bar">
          <select
            class="enterprise-filter-bar__select"
            .value=${filters.status ?? ""}
            @change=${(e: Event) =>
              onFilterChange("status", (e.target as HTMLSelectElement).value || null)}
          >
            <option value="">全部状态</option>
            <option value="待审核">待审核</option>
            <option value="审核中">审核中</option>
          </select>
          <input
            type="text"
            class="enterprise-filter-bar__input"
            style="min-width:200px"
            placeholder="搜索能力名称"
            .value=${filters.searchQuery}
            @input=${(e: Event) =>
              onFilterChange("searchQuery", (e.target as HTMLInputElement).value)}
          />
        </div>

        ${
          props.lastReviewRecord
            ? html`
                <div class="enterprise-success-message">
                  已提交审核结果：${props.lastReviewRecord.result}
                  ${
                    props.lastEmployeeFeedbackNotice
                      ? html`<span> · ${props.lastEmployeeFeedbackNotice}</span>`
                      : nothing
                  }
                </div>
              `
            : nothing
        }
        ${
          props.submitError
            ? html`<div class="review-queue-page__submit-error">${props.submitError}</div>`
            : nothing
        }
        ${
          loading
            ? html`
                <div class="enterprise-empty-message">加载中...</div>
              `
            : error
              ? html`<div class="enterprise-empty-message">${error}</div>`
              : items.length === 0
                ? html`
                    <div class="enterprise-empty-message">暂无待审核能力</div>
                  `
                : items.map(
                    (entry) => html`
                    <article class="enterprise-content-card review-queue-page__item">
                      <div class="enterprise-content-card__title">
                        ${entry.item.capabilityName}
                        ${
                          entry.item.assetType === "mcp"
                            ? html`
                                <span class="review-queue-page__type-badge">MCP</span>
                              `
                            : nothing
                        }
                      </div>
                      <div class="enterprise-content-card__summary">
                        ${entry.item.capabilitySummary}
                      </div>
                      <div class="enterprise-content-card__meta">
                        来源：${entry.item.sourceEmployee.name} · ${entry.item.sourceRobot.name}
                        ${
                          entry.item.assetType === "mcp" && entry.item.mcpServerName
                            ? html` · 服务 ${entry.item.mcpServerName}`
                            : nothing
                        }
                      </div>
                      <div class="enterprise-content-card__meta">
                        使用 ${entry.item.usageCount} 次 · ${entry.item.robotCount} 个机器人
                      </div>
                      ${renderAssetPackage(entry)}
                      ${renderAssessment(entry)}
                      ${renderReviewForm(entry, props)}
                    </article>
                  `,
                  )
        }
        ${
          !loading
            ? renderPagination({
                currentPage: pagination.currentPage,
                pageSize: pagination.pageSize,
                totalItems: pagination.totalItems,
                onPageChange,
                onPageSizeChange: () => {},
              })
            : nothing
        }
      </div>
    </div>
  `;
}
