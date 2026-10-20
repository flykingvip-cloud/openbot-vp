import { html, nothing } from "lit";
import { renderIcon } from "../../../icons.ts";
import type { PlatformSurfaceProps } from "../shared/surface.ts";
import type {
  EnterpriseSubmissionDetail,
  EnterpriseSubmissionListItem,
  EnterpriseSubmissionStatus,
} from "./enterprise-submissions-types.ts";

export type EnterpriseSubmissionsSectionHost = {
  props: PlatformSurfaceProps;
  requestRerender: () => void;
  onShowActionMessage: (kind: "success" | "error", text: string) => void;
  onOpenCapabilityDistribution: (capabilityId: string) => void;
};

type SectionState = {
  loaded: boolean;
  loading: boolean;
  error: string | null;
  items: EnterpriseSubmissionListItem[];
  pendingCount: number;
  reviewingCount: number;
  selectedSubmissionId: string | null;
  detail: EnterpriseSubmissionDetail | null;
  detailLoading: boolean;
  actionBusy: boolean;
  noteDraft: string;
  noteMode: "reject" | "return" | null;
};

const sectionState: SectionState = {
  loaded: false,
  loading: false,
  error: null,
  items: [],
  pendingCount: 0,
  reviewingCount: 0,
  selectedSubmissionId: null,
  detail: null,
  detailLoading: false,
  actionBusy: false,
  noteDraft: "",
  noteMode: null,
};

/** Test helper: reset module state between browser tests. */
export function resetEnterpriseSubmissionsSectionState(): void {
  sectionState.loaded = false;
  sectionState.loading = false;
  sectionState.error = null;
  sectionState.items = [];
  sectionState.pendingCount = 0;
  sectionState.reviewingCount = 0;
  sectionState.selectedSubmissionId = null;
  sectionState.detail = null;
  sectionState.detailLoading = false;
  sectionState.actionBusy = false;
  sectionState.noteDraft = "";
  sectionState.noteMode = null;
}

export function enterpriseSubmissionsTabCount(): number {
  return sectionState.pendingCount + sectionState.reviewingCount;
}

export async function ensureEnterpriseSubmissionsLoaded(
  host: EnterpriseSubmissionsSectionHost,
): Promise<void> {
  if (sectionState.loading) {
    return;
  }
  if (sectionState.loaded) {
    return;
  }
  await refreshEnterpriseSubmissions(host);
}

export async function refreshEnterpriseSubmissions(
  host: EnterpriseSubmissionsSectionHost,
): Promise<void> {
  const actions = host.props.actions.capabilities;
  if (!actions.onRefreshEnterpriseSubmissions) {
    sectionState.error = "企业提交操作未接线。";
    sectionState.loaded = true;
    host.requestRerender();
    return;
  }
  sectionState.loading = true;
  sectionState.error = null;
  host.requestRerender();
  try {
    const result = await actions.onRefreshEnterpriseSubmissions();
    sectionState.items = result?.submissions ?? [];
    sectionState.pendingCount = result?.pendingCount ?? 0;
    sectionState.reviewingCount = result?.reviewingCount ?? 0;
    sectionState.loaded = true;
    sectionState.error = null;
  } catch (error) {
    sectionState.error = error instanceof Error ? error.message : "加载企业提交失败。";
    sectionState.loaded = true;
  } finally {
    sectionState.loading = false;
    host.requestRerender();
  }
}

async function loadSubmissionDetail(
  host: EnterpriseSubmissionsSectionHost,
  submissionId: string,
): Promise<void> {
  const actions = host.props.actions.capabilities;
  if (!actions.onReviewEnterpriseSubmission) {
    return;
  }
  sectionState.selectedSubmissionId = submissionId;
  sectionState.detailLoading = true;
  sectionState.noteMode = null;
  sectionState.noteDraft = "";
  host.requestRerender();
  try {
    sectionState.detail = await actions.onReviewEnterpriseSubmission(submissionId);
  } catch (error) {
    host.onShowActionMessage(
      "error",
      error instanceof Error ? error.message : "加载提交详情失败。",
    );
    sectionState.detail = null;
    sectionState.selectedSubmissionId = null;
  } finally {
    sectionState.detailLoading = false;
    host.requestRerender();
  }
}

function closeSubmissionDrawer(host: EnterpriseSubmissionsSectionHost): void {
  sectionState.selectedSubmissionId = null;
  sectionState.detail = null;
  sectionState.noteMode = null;
  sectionState.noteDraft = "";
  host.requestRerender();
}

function formatStatusLabel(status: EnterpriseSubmissionStatus): string {
  switch (status) {
    case "pending-review":
      return "待审核";
    case "reviewing":
      return "审核中";
    case "published":
      return "已发布";
    case "rejected":
      return "已拒绝";
    case "returned-for-modification":
      return "退回修改";
    case "enterprise-only":
      return "仅企业内";
  }
}

function statusTone(status: EnterpriseSubmissionStatus): string {
  switch (status) {
    case "pending-review":
    case "reviewing":
      return "warn";
    case "published":
      return "ok";
    case "enterprise-only":
      return "ok";
    case "rejected":
      return "danger";
    case "returned-for-modification":
      return "warn";
  }
}

function formatTimestamp(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) {
    return "—";
  }
  return new Date(ms).toLocaleString("zh-CN");
}

function isActionable(status: EnterpriseSubmissionStatus): boolean {
  return status === "pending-review" || status === "reviewing";
}

async function runSubmissionAction(
  host: EnterpriseSubmissionsSectionHost,
  action: () => Promise<unknown>,
  successMessage: string,
  options?: { openDistributionForCapabilityId?: string },
): Promise<void> {
  sectionState.actionBusy = true;
  host.requestRerender();
  try {
    await action();
    host.onShowActionMessage("success", successMessage);
    sectionState.loaded = false;
    await refreshEnterpriseSubmissions(host);
    if (options?.openDistributionForCapabilityId) {
      host.onOpenCapabilityDistribution(options.openDistributionForCapabilityId);
    }
    closeSubmissionDrawer(host);
  } catch (error) {
    host.onShowActionMessage(
      "error",
      error instanceof Error ? error.message : "操作失败，请稍后重试。",
    );
  } finally {
    sectionState.actionBusy = false;
    host.requestRerender();
  }
}

function renderSubmissionList(host: EnterpriseSubmissionsSectionHost) {
  if (sectionState.loading && sectionState.items.length === 0) {
    return html`
      <div class="platform-capabilities__empty">正在加载企业提交…</div>
    `;
  }
  if (sectionState.error) {
    return html`
      <div class="platform-capabilities__empty">
        <div class="platform-capabilities__empty-title">加载失败</div>
        <div class="platform-capabilities__empty-sub">${sectionState.error}</div>
        <button
          class="platform-capabilities__hero-button"
          type="button"
          @click=${() => {
            sectionState.loaded = false;
            void refreshEnterpriseSubmissions(host);
          }}
        >
          重试
        </button>
      </div>
    `;
  }
  if (sectionState.items.length === 0) {
    return html`
      <div class="platform-capabilities__empty is-ok">
        ${renderIcon("checkCircle", "platform-capabilities__empty-icon is-ok")}
        <div class="platform-capabilities__empty-copy">
          <div class="platform-capabilities__empty-title">暂无企业提交</div>
          <div class="platform-capabilities__empty-sub">
            企业孵化中心完成脱敏并提交后，会出现在这里等待平台审核。
          </div>
        </div>
      </div>
    `;
  }
  return html`
    <div class="platform-capabilities__discovery-list">
      ${sectionState.items
        .toSorted((a, b) => b.submittedAt - a.submittedAt)
        .map(
          (item) => html`
            <article class="platform-capabilities__discovery-item">
              <span class="platform-capabilities__discovery-icon">
                ${renderIcon("building", "platform-capabilities__discovery-icon-svg")}
              </span>
              <div class="platform-capabilities__discovery-copy">
                <div class="platform-capabilities__discovery-title-row">
                  <span class="platform-capabilities__discovery-title">${item.capabilityName}</span>
                  <span class="platform-capabilities__chip is-${statusTone(item.status)}">
                    ${formatStatusLabel(item.status)}
                  </span>
                </div>
                <div class="platform-capabilities__discovery-sub">
                  ${item.enterpriseName} · ${item.capabilityId}
                </div>
                <div class="platform-capabilities__discovery-meta">
                  <span class="platform-capabilities__chip">
                    ${item.sanitized ? "已脱敏" : "未脱敏"}
                  </span>
                  <span class="platform-capabilities__chip">
                    ${item.sanitizationFindings} 项脱敏记录
                  </span>
                  <span class="platform-capabilities__chip"
                    >${formatTimestamp(item.submittedAt)}</span
                  >
                </div>
              </div>
              <div class="platform-capabilities__discovery-actions">
                <button
                  class="platform-capabilities__inline-action is-primary"
                  type="button"
                  @click=${() => void loadSubmissionDetail(host, item.submissionId)}
                >
                  审核
                </button>
              </div>
            </article>
          `,
        )}
    </div>
  `;
}

function renderSubmissionDrawer(host: EnterpriseSubmissionsSectionHost) {
  if (!sectionState.selectedSubmissionId) {
    return nothing;
  }
  const detail = sectionState.detail;
  const busy = sectionState.actionBusy || sectionState.detailLoading;
  const actions = host.props.actions.capabilities;

  return html`
    <div class="model-assets-drawer__backdrop" @click=${() => closeSubmissionDrawer(host)}></div>
    <aside class="model-assets-drawer" role="dialog" aria-label="企业提交审核">
      <div class="model-assets-drawer__header">
        <div>
          <div class="model-assets-drawer__eyebrow">企业脱敏提交</div>
          <div class="model-assets-drawer__title">${detail?.capabilityName ?? "加载中…"}</div>
        </div>
        <button
          class="btn btn--ghost btn--sm"
          type="button"
          @click=${() => closeSubmissionDrawer(host)}
        >
          ${renderIcon("x")}
        </button>
      </div>
      <div class="model-assets-drawer__body">
        ${
          sectionState.detailLoading
            ? html`
                <div class="platform-capabilities__empty">正在加载详情…</div>
              `
            : detail
              ? html`
                  <section class="model-assets-drawer__section">
                    <div class="card-title">提交信息</div>
                    <div class="platform-capabilities__detail-list">
                      <div class="platform-capabilities__detail-list-item">
                        <span>企业</span><strong>${detail.enterpriseName}</strong>
                      </div>
                      <div class="platform-capabilities__detail-list-item">
                        <span>能力 ID</span><strong>${detail.capabilityId}</strong>
                      </div>
                      <div class="platform-capabilities__detail-list-item">
                        <span>状态</span><strong>${formatStatusLabel(detail.status)}</strong>
                      </div>
                      <div class="platform-capabilities__detail-list-item">
                        <span>提交时间</span><strong>${formatTimestamp(detail.submittedAt)}</strong>
                      </div>
                      <div class="platform-capabilities__detail-list-item">
                        <span>脱敏</span><strong>${detail.sanitized ? "已完成" : "未完成"}</strong>
                      </div>
                      <div class="platform-capabilities__detail-list-item">
                        <span>脱敏项</span><strong>${detail.sanitizationFindings}</strong>
                      </div>
                      <div class="platform-capabilities__detail-list-item">
                        <span>产物哈希</span><strong>${detail.artifactHash ?? "—"}</strong>
                      </div>
                      <div class="platform-capabilities__detail-list-item">
                        <span>来源</span><strong>${detail.sourceProvenance || "—"}</strong>
                      </div>
                    </div>
                  </section>

                  ${
                    !detail.sanitized
                      ? html`
                          <div class="callout danger">该提交未完成脱敏，无法发布到平台。请退回企业重新走脱敏流程。</div>
                        `
                      : nothing
                  }
                  ${
                    detail.rejectionReason
                      ? html`
                          <div class="callout danger">拒绝原因：${detail.rejectionReason}</div>
                        `
                      : nothing
                  }
                  ${
                    isActionable(detail.status)
                      ? html`
                          <section class="model-assets-drawer__section">
                            <div class="card-title">审核操作</div>
                            ${
                              sectionState.noteMode
                                ? html`
                                    <label class="field">
                                      <span
                                        >${
                                          sectionState.noteMode === "reject"
                                            ? "拒绝原因"
                                            : "退回说明"
                                        }</span
                                      >
                                      <textarea
                                        rows="3"
                                        .value=${sectionState.noteDraft}
                                        @input=${(event: Event) => {
                                          sectionState.noteDraft = (
                                            event.currentTarget as HTMLTextAreaElement
                                          ).value;
                                          host.requestRerender();
                                        }}
                                      ></textarea>
                                    </label>
                                    <div class="platform-capabilities__detail-actions">
                                      <button
                                        class="platform-capabilities__hero-button"
                                        type="button"
                                        ?disabled=${busy || !sectionState.noteDraft.trim()}
                                        @click=${async () => {
                                          const note = sectionState.noteDraft.trim();
                                          if (!note) {
                                            return;
                                          }
                                          if (sectionState.noteMode === "reject") {
                                            await runSubmissionAction(
                                              host,
                                              async () => {
                                                if (!actions.onRejectEnterpriseSubmission) {
                                                  throw new Error("拒绝操作未接线");
                                                }
                                                await actions.onRejectEnterpriseSubmission(
                                                  detail.submissionId,
                                                  note,
                                                );
                                              },
                                              `已拒绝提交：${detail.capabilityName}`,
                                            );
                                            return;
                                          }
                                          await runSubmissionAction(
                                            host,
                                            async () => {
                                              if (!actions.onReturnEnterpriseSubmission) {
                                                throw new Error("退回操作未接线");
                                              }
                                              await actions.onReturnEnterpriseSubmission(
                                                detail.submissionId,
                                                note,
                                              );
                                            },
                                            `已退回修改：${detail.capabilityName}`,
                                          );
                                        }}
                                      >
                                        确认${sectionState.noteMode === "reject" ? "拒绝" : "退回"}
                                      </button>
                                      <button
                                        class="platform-capabilities__hero-button"
                                        type="button"
                                        ?disabled=${busy}
                                        @click=${() => {
                                          sectionState.noteMode = null;
                                          sectionState.noteDraft = "";
                                          host.requestRerender();
                                        }}
                                      >
                                        取消
                                      </button>
                                    </div>
                                  `
                                : html`
                                    <div class="platform-capabilities__detail-actions">
                                      <button
                                        class="platform-capabilities__hero-button"
                                        type="button"
                                        ?disabled=${busy || !detail.sanitized}
                                        @click=${async () => {
                                          await runSubmissionAction(
                                            host,
                                            async () => {
                                              if (!actions.onPublishEnterpriseSubmission) {
                                                throw new Error("发布操作未接线");
                                              }
                                              await actions.onPublishEnterpriseSubmission(
                                                detail.submissionId,
                                              );
                                            },
                                            `已发布到平台：${detail.capabilityName}。默认仅对提交企业可见，请配置全租户分发。`,
                                            {
                                              openDistributionForCapabilityId: detail.capabilityId,
                                            },
                                          );
                                        }}
                                      >
                                        ${busy ? "处理中…" : "发布到平台"}
                                      </button>
                                      <button
                                        class="platform-capabilities__hero-button"
                                        type="button"
                                        ?disabled=${busy}
                                        @click=${async () => {
                                          await runSubmissionAction(
                                            host,
                                            async () => {
                                              if (!actions.onApproveEnterpriseOnlySubmission) {
                                                throw new Error("企业内批准操作未接线");
                                              }
                                              await actions.onApproveEnterpriseOnlySubmission(
                                                detail.submissionId,
                                              );
                                            },
                                            `已批准仅供企业内部使用：${detail.capabilityName}`,
                                          );
                                        }}
                                      >
                                        仅企业内使用
                                      </button>
                                      <button
                                        class="platform-capabilities__inline-action is-muted"
                                        type="button"
                                        ?disabled=${busy}
                                        @click=${() => {
                                          sectionState.noteMode = "return";
                                          sectionState.noteDraft = "";
                                          host.requestRerender();
                                        }}
                                      >
                                        退回修改
                                      </button>
                                      <button
                                        class="platform-capabilities__inline-action is-muted"
                                        type="button"
                                        ?disabled=${busy}
                                        @click=${() => {
                                          sectionState.noteMode = "reject";
                                          sectionState.noteDraft = "";
                                          host.requestRerender();
                                        }}
                                      >
                                        拒绝
                                      </button>
                                    </div>
                                    <div class="platform-capabilities__detail-copy card-follow--xs">
                                      发布后默认仅对提交企业租户可见。如需全平台分发，请在发布后立即配置「租户分发」。
                                    </div>
                                  `
                            }
                          </section>
                        `
                      : nothing
                  }
                `
              : html`
                  <div class="platform-capabilities__empty">未找到提交详情。</div>
                `
        }
      </div>
    </aside>
  `;
}

export function renderEnterpriseSubmissionsSection(host: EnterpriseSubmissionsSectionHost) {
  void ensureEnterpriseSubmissionsLoaded(host);
  return html`
    <section class="platform-capabilities__directory">
      <div class="platform-capabilities__notice card-lead">
        <div>
          此处审核来自企业孵化中心的脱敏上报（路径
          A）。员工直接「提交企业审核」的提案请在「待审阅」tab 处理。
        </div>
        <button
          class="btn btn--ghost btn--sm"
          type="button"
          ?disabled=${sectionState.loading}
          @click=${() => {
            sectionState.loaded = false;
            void refreshEnterpriseSubmissions(host);
          }}
        >
          刷新
        </button>
      </div>
      ${renderSubmissionList(host)} ${renderSubmissionDrawer(host)}
    </section>
  `;
}
