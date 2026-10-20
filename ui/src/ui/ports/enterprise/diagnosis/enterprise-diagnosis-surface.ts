import { html, nothing, type TemplateResult } from "lit";
import { t } from "../../../../i18n/index.ts";
import { renderEnterpriseModuleHeader } from "../../../views/enterprise-module-header.ts";
import type { DiagnoseReportActionChip } from "../../diagnosis/diagnosis-conversation-action.ts";
import {
  ALL_DIAGNOSIS_TARGET_ID,
  isAllDiagnosisTarget,
  type DiagnosisTargetOption,
} from "../../diagnosis/diagnosis-targets.ts";
import { renderEnterpriseDiagnosisReport } from "./enterprise-diagnosis-report.ts";

export type DiagnosisViewConversationEntry = {
  signalId?: string;
  caseId?: string;
  targetRef?: { targetType: string; targetId: string; tenantId: string | null };
  tenantId: string | null;
};

export type DiagnosisViewModel = {
  role: "platform" | "enterprise" | "employee";
  tenantScope: string | null;
  redactionProfile: string;
  permissionState:
    | "allowed"
    | "redacted"
    | "hidden"
    | "forbidden"
    | "expired"
    | "unavailable"
    | "empty";
  health: {
    tone: "ok" | "watch" | "degraded" | "inconclusive" | "empty" | "error" | "expired";
    label: string;
    openP0: number;
    openP1: number;
    inconclusive: number;
    expired: number;
  };
  cases: Array<{
    caseId: string;
    severity: "P0" | "P1" | "P2" | "P3" | "P4" | null;
    status: string;
    tenantId: string | null;
  }>;
  drilldown: Array<{
    layer: "enterprise" | "agent" | "skill" | "tool";
    id: string;
    status: string;
    tenantId: string | null;
  }>;
  timeline: {
    events: Array<{ kind: string; timestamp: string; ref: { id: string; type: string } }>;
  };
  trend: {
    window: { from: string; to: string };
    completeness: "complete" | "partial" | "empty" | "unavailable";
    buckets: Array<{ at: string; sampleCount: number; present: boolean }>;
    missingBuckets: string[];
  };
  graph: {
    nodes: Array<{ id: string; kind: string; label: string }>;
    edges: Array<{ fromId: string; toId: string; relation: string }>;
  };
  authorizations: {
    rows: Array<{
      grantId: string;
      status: string;
      targetTenant: string | null;
      dataScope: string[];
      actions: string[];
      expiresAt: string;
      risk?: string;
    }>;
    pendingApprovals: Array<{
      grantId: string;
      targetTenant: string | null;
      targetPrincipal?: string;
      dataScope: string[];
      actions: string[];
      expiresAt: string;
      risk?: string;
    }>;
  };
  remediations: Array<{
    remediationId: string;
    status: string;
    verdict?: string;
  }>;
  conversationEntries: DiagnosisViewConversationEntry[];
  reportExport: { action: "export_existing_report"; exporter: string };
  loadError?: string;
  production?: {
    apiLoadState: "idle" | "loading" | "ready" | "unavailable" | "forbidden" | "stale";
    permissionState:
      | "allowed"
      | "redacted"
      | "hidden"
      | "forbidden"
      | "expired"
      | "unavailable"
      | "empty";
    auditState: "recorded" | "missing" | "unavailable";
    freshness: {
      observedAt: string | null;
      maxAgeMs: number;
      stale: boolean;
      completeness: "complete" | "partial" | "empty" | "unavailable";
    };
  };
};

export type DiagnosisRunNote = {
  kind: "no_session" | "need_target" | "denied" | "failed" | "disconnected" | "done" | "partial";
  findingCount?: number;
  scanned?: number;
  requestedCount?: number;
  skipped?: number;
  deliveryClosed?: boolean;
  deliveryReason?: string;
  deliveryDelivered?: boolean;
  reportText?: string;
};

export type EnterpriseDiagnosisHandlers = {
  onOpenConversation?: (entry: DiagnosisViewConversationEntry) => void;
  onAuthorizationDecision?: (input: {
    grantId: string;
    decision: "approve" | "deny";
    refresh: "p6_p7";
  }) => void;
  onDiagnoseNow?: () => void;
  onRefresh?: () => void;
  refreshing?: boolean;
  diagnosing?: boolean;
  lastDiagnose?: DiagnosisRunNote | null;
  targets?: DiagnosisTargetOption[];
  selectedTargetId?: string | null;
  onSelectTarget?: (id: string) => void;
  observationWindow?: "24h" | "7d";
  diagnoseMode?: "TARGETED" | "FULL";
  cadence?: "off" | "daily" | "tick";
  deliverToAdmin?: boolean;
  deliverToOwners?: boolean;
  onObservationWindow?: (value: "24h" | "7d") => void;
  onDiagnoseMode?: (value: "TARGETED" | "FULL") => void;
  onCadence?: (value: "off" | "daily" | "tick") => void;
  onDeliverToAdmin?: (value: boolean) => void;
  onDeliverToOwners?: (value: boolean) => void;
  onRunConversationAction?: (action: DiagnoseReportActionChip) => void;
  daibaiDeliveryEnabled?: boolean;
  decisionNote?: string | null;
};

const LAYER_LABEL: Record<DiagnosisViewModel["drilldown"][number]["layer"], string> = {
  enterprise: "企业",
  agent: "数字人",
  skill: "技能",
  tool: "工具",
};

const KIND_LABEL: Record<string, string> = {
  signal: "信号",
  case: "案例",
  finding: "发现",
  evidence: "证据引用",
  mission: "任务",
  grant: "授权",
  proposal: "提案",
  remediation: "修复",
  verification: "验证",
};

function healthCopy(model: DiagnosisViewModel): string {
  if (model.loadError) {
    return loadErrorCopy(model.loadError);
  }
  if (model.permissionState === "forbidden") {
    return "权限不足";
  }
  return model.health.label;
}

function loadErrorCopy(error: string): string {
  switch (error) {
    case "gateway_unavailable":
      return "网关不可用";
    case "forbidden":
    case "redaction_forbidden":
      return "权限不足";
    default:
      return "加载失败";
  }
}

function deliverySuffix(note: DiagnosisRunNote): string {
  if (note.deliveryDelivered || note.deliveryReason === "conversation_accepted") {
    return " 报告已投送到指定大白对话区。";
  }
  if (note.deliveryReason === "conversation_unavailable") {
    return " 报告已生成，但未能写入指定大白对话区。";
  }
  if (
    note.deliveryClosed ||
    note.deliveryReason === "daibai_delivery_gate_closed" ||
    note.deliveryReason === "tick_suppressed"
  ) {
    return " 大白投送未执行：通道尚未对企业开放。";
  }
  return "";
}

function diagnoseCopy(note: DiagnosisRunNote): { title: string; detail: string } {
  const suffix = deliverySuffix(note);
  switch (note.kind) {
    case "need_target":
      return {
        title: "请先选择诊断对象",
        detail: "立即诊断需要指定企业里的一个数字人、一个协作小组，或全部对象的配额抽检。",
      };
    case "no_session":
      return {
        title: "没有可诊断的会话",
        detail: `当前没有可观察的运行记录，立即诊断不会产生报告，也不能当作已恢复。${suffix}`,
      };
    case "denied":
      return {
        title: "权限不足",
        detail: "这次诊断被拒绝，不能当作已执行。",
      };
    case "disconnected":
      return {
        title: "网关未连接",
        detail: "诊断请求没有发出，请连接后再试。",
      };
    case "failed":
      return {
        title: "诊断未完成",
        detail: "这次诊断没有成功落盘，不能当作已恢复。",
      };
    case "partial":
      return {
        title: "抽检未覆盖全部对象",
        detail: `已评估 ${note.scanned ?? 0}/${note.requestedCount ?? 0} 个对象（配额上限 8），未评估对象不能当作正常。${suffix}`,
      };
    case "done":
      return {
        title: "诊断已执行",
        detail:
          (note.findingCount && note.findingCount > 0
            ? `已写入报告，发现 ${note.findingCount} 项，仍按证据不足失败关闭。`
            : "已执行一次诊断，但没有形成可展示发现，不能当作正常。") + suffix,
      };
  }
}

function completenessCopy(value: string): string {
  switch (value) {
    case "complete":
      return "完整";
    case "partial":
      return "不完整";
    case "empty":
      return "无样本";
    case "unavailable":
      return "不可用";
    default:
      return value;
  }
}

function apiLoadCopy(value: string): string {
  switch (value) {
    case "idle":
      return "未开始";
    case "loading":
      return "加载中";
    case "ready":
      return "已就绪";
    case "unavailable":
      return "不可用";
    case "forbidden":
      return "无权限";
    case "stale":
      return "已过期";
    default:
      return value;
  }
}

function auditCopy(value: string): string {
  switch (value) {
    case "recorded":
      return "已记录";
    case "missing":
      return "缺失";
    case "unavailable":
      return "不可用";
    default:
      return value;
  }
}

function permissionCopy(value: string): string {
  switch (value) {
    case "allowed":
      return "已授权";
    case "redacted":
      return "已脱敏";
    case "hidden":
      return "已隐藏";
    case "forbidden":
      return "权限不足";
    case "expired":
      return "已过期";
    case "unavailable":
      return "不可用";
    case "empty":
      return "无样本";
    default:
      return value;
  }
}

function riskCopy(value?: string): string {
  switch (value) {
    case "low":
      return "低";
    case "medium":
      return "中";
    case "high":
      return "高";
    case "unknown":
    case undefined:
      return "未知";
    default:
      return value;
  }
}

function grantStatusCopy(status: string): string {
  switch (status) {
    case "APPROVED":
      return "已批准";
    case "DENIED":
      return "已拒绝";
    case "PENDING":
      return "待审批";
    case "EXPIRED":
      return "已过期";
    case "REVOKED":
      return "已撤销";
    case "SUSPENDED":
      return "已挂起";
    case "CONSUMED":
      return "已消耗";
    default:
      return status;
  }
}

function remediationCopy(status: string): string {
  switch (status) {
    case "PREVIEWED":
      return "已预览";
    case "APPROVED":
      return "已批准";
    case "DENIED":
      return "已拒绝";
    case "VERIFIED":
      return "已验证";
    default:
      return status;
  }
}

function layerStatusCopy(status: string): string {
  switch (status) {
    case "observed":
      return "已观察";
    case "open":
      return "未关闭";
    case "closed":
      return "已关闭";
    default:
      return status;
  }
}

function joinOrUnknown(values: string[]): string {
  return values.length ? values.join("、") : "未声明";
}

function emptyState(copy: string, testid?: string): TemplateResult {
  return html`
    <p class="enterprise-diagnosis__empty" data-testid=${testid ?? ""}>${copy}</p>
  `;
}

function kvRows(items: Array<{ label: string; value: string; mono?: boolean }>): TemplateResult {
  return html`
    <dl class="enterprise-diagnosis__kv">
      ${items.map(
        (item) => html`
          <div class="enterprise-diagnosis__kv-row">
            <dt class="enterprise-diagnosis__label">${item.label}</dt>
            <dd class="enterprise-diagnosis__value ${item.mono ? "mono" : ""}">${item.value}</dd>
          </div>
        `,
      )}
    </dl>
  `;
}

function group(title: string, content: TemplateResult): TemplateResult {
  return html`
    <section class="enterprise-diagnosis__group">
      <h2 class="enterprise-diagnosis__group-title">${title}</h2>
      <div class="enterprise-diagnosis__group-body">${content}</div>
    </section>
  `;
}

function block(testid: string, title: string | null, content: TemplateResult): TemplateResult {
  return html`
    <div class="enterprise-diagnosis__block" data-testid=${testid}>
      ${title ? html`<h3 class="enterprise-diagnosis__subhead">${title}</h3>` : nothing}
      ${content}
    </div>
  `;
}

function targetPicker(handlers: EnterpriseDiagnosisHandlers): TemplateResult | typeof nothing {
  const targets = handlers.targets ?? [];
  if (!handlers.onDiagnoseNow) {
    return nothing;
  }
  const selectedId = handlers.selectedTargetId ?? "";
  const diagnoseDisabled = Boolean(handlers.diagnosing) || !selectedId;
  const agents = targets.filter((row) => row.kind === "agent");
  const groups = targets.filter((row) => row.kind === "group");
  return html`
    <div class="enterprise-diagnosis__target" data-testid="diagnosis-target-picker">
      <label class="enterprise-diagnosis__target-label" for="diagnosis-target-select">诊断对象</label>
      <select
        id="diagnosis-target-select"
        class="enterprise-diagnosis__target-select"
        data-testid="diagnosis-target-select"
        ?disabled=${Boolean(handlers.diagnosing)}
        .value=${selectedId}
        @change=${(event: Event) => {
          const value = (event.target as HTMLSelectElement).value;
          handlers.onSelectTarget?.(value);
        }}
      >
        <option value="">选择数字人或协作小组</option>
        <option value=${ALL_DIAGNOSIS_TARGET_ID}>全部数字人与协作小组</option>
        ${
          agents.length > 0
            ? html`<optgroup label="数字人">
                ${agents.map((row) => html`<option value=${row.id}>${row.label}</option>`)}
              </optgroup>`
            : nothing
        }
        ${
          groups.length > 0
            ? html`<optgroup label="协作小组">
                ${groups.map((row) => html`<option value=${row.id}>${row.label}</option>`)}
              </optgroup>`
            : nothing
        }
      </select>
      <button
        type="button"
        class="btn btn--sm btn--primary"
        data-testid="diagnosis-run-now"
        ?disabled=${diagnoseDisabled}
        title=${
          selectedId
            ? selectedId === ALL_DIAGNOSIS_TARGET_ID
              ? "对名单做最多 8 个对象的只读抽检"
              : "对所选数字人或协作小组执行只读诊断"
            : "请先选择数字人、协作小组或全部"
        }
        @click=${() => handlers.onDiagnoseNow?.()}
      >
        ${handlers.diagnosing ? "诊断中…" : "立即诊断"}
      </button>
      ${
        !selectedId && !handlers.diagnosing
          ? html`
              <p class="enterprise-diagnosis__target-hint">请先选择数字人、协作小组，或「全部」后再诊断。</p>
            `
          : nothing
      }
    </div>
  `;
}

function targetHint(handlers: EnterpriseDiagnosisHandlers): TemplateResult | typeof nothing {
  if (isAllDiagnosisTarget(handlers.selectedTargetId)) {
    return html`
      <p class="enterprise-diagnosis__hint" data-testid="diagnosis-target-hint">
        全部对象按企业名单抽检，最多 8 个；未抽到的不能当作正常。不会读取一年聊天，也不会发送修复指令。
      </p>
    `;
  }
  const selected = (handlers.targets ?? []).find((row) => row.id === handlers.selectedTargetId);
  if (!selected) {
    return nothing;
  }
  if (selected.kind === "group") {
    return html`
      <p class="enterprise-diagnosis__hint" data-testid="diagnosis-target-hint">
        协作小组由${selected.steward ? "大白管家" : "指定数字人"}协调。本次只读诊断该小组会话，不会发送修复指令。
      </p>
    `;
  }
  if (selected.steward) {
    return html`
      <p class="enterprise-diagnosis__hint" data-testid="diagnosis-target-hint">
        ${
          handlers.daibaiDeliveryEnabled
            ? "正在诊断大白管家自己的运行记录。勾选投送后，报告会像定时任务一样写入指定大白对话区。"
            : "正在诊断大白管家自己的运行记录。诊断结果不会自动发到大白聊天，投送通道尚未对企业开放。"
        }
      </p>
    `;
  }
  return html`
    <p class="enterprise-diagnosis__hint" data-testid="diagnosis-target-hint">
      正在诊断「${selected.label}」的主会话。没有运行记录时仍会落盘一份失败关闭报告，不能当作已恢复。
    </p>
  `;
}

function diagnoseControls(handlers: EnterpriseDiagnosisHandlers): TemplateResult | typeof nothing {
  if (!handlers.onDiagnoseNow) {
    return nothing;
  }
  const windowId = handlers.observationWindow ?? "24h";
  const mode = handlers.diagnoseMode ?? "TARGETED";
  const cadence = handlers.cadence ?? "off";
  const disabled = Boolean(handlers.diagnosing);
  return html`
    <div class="enterprise-diagnosis__controls" data-testid="diagnosis-controls">
      <label class="enterprise-diagnosis__control">
        <span class="enterprise-diagnosis__target-label">观察窗</span>
        <select
          class="enterprise-diagnosis__target-select"
          data-testid="diagnosis-window-select"
          ?disabled=${disabled}
          .value=${windowId}
          @change=${(event: Event) => {
            const value = (event.target as HTMLSelectElement).value === "7d" ? "7d" : "24h";
            handlers.onObservationWindow?.(value);
          }}
        >
          <option value="24h">近 24 小时</option>
          <option value="7d">近 7 天</option>
        </select>
      </label>
      <label class="enterprise-diagnosis__control">
        <span class="enterprise-diagnosis__target-label">模式</span>
        <select
          class="enterprise-diagnosis__target-select"
          data-testid="diagnosis-mode-select"
          ?disabled=${disabled}
          .value=${mode}
          @change=${(event: Event) => {
            const value =
              (event.target as HTMLSelectElement).value === "FULL" ? "FULL" : "TARGETED";
            handlers.onDiagnoseMode?.(value);
          }}
        >
          <option value="TARGETED">定向</option>
          <option value="FULL">全面</option>
        </select>
      </label>
      <label class="enterprise-diagnosis__control">
        <span class="enterprise-diagnosis__target-label">定期监测</span>
        <select
          class="enterprise-diagnosis__target-select"
          data-testid="diagnosis-cadence-select"
          ?disabled=${disabled}
          .value=${cadence}
          @change=${(event: Event) => {
            const raw = (event.target as HTMLSelectElement).value;
            const value = raw === "daily" || raw === "tick" ? raw : "off";
            handlers.onCadence?.(value);
          }}
        >
          <option value="off">关闭</option>
          <option value="daily">每天一次</option>
          <option value="tick">每 15 分钟</option>
        </select>
      </label>
      <label class="enterprise-diagnosis__check">
        <input
          type="checkbox"
          data-testid="diagnosis-deliver-admin"
          ?disabled=${disabled}
          .checked=${Boolean(handlers.deliverToAdmin)}
          @change=${(event: Event) => {
            handlers.onDeliverToAdmin?.((event.target as HTMLInputElement).checked);
          }}
        />
        投送到企业管理员大白对话
      </label>
      <label class="enterprise-diagnosis__check">
        <input
          type="checkbox"
          data-testid="diagnosis-deliver-owners"
          ?disabled=${disabled}
          .checked=${Boolean(handlers.deliverToOwners)}
          @change=${(event: Event) => {
            handlers.onDeliverToOwners?.((event.target as HTMLInputElement).checked);
          }}
        />
        投送到相关数字人负责人大白对话
      </label>
    </div>
  `;
}

function bannerMark(kind: "watch" | "danger"): TemplateResult {
  return html`<span class="enterprise-diagnosis__banner-mark" aria-hidden="true"
    >${kind === "watch" ? "△" : "!"}</span
  >`;
}

function confirmAuthorization(decision: "approve" | "deny"): boolean {
  if (typeof window === "undefined" || typeof window.confirm !== "function") {
    return true;
  }
  return window.confirm(
    decision === "approve"
      ? "确认批准这条会诊授权？批准后按当前范围生效。"
      : "确认拒绝这条会诊授权？拒绝后该申请不会生效。",
  );
}

function banner(
  model: DiagnosisViewModel,
  lastDiagnose?: DiagnosisRunNote | null,
): TemplateResult | typeof nothing {
  if (lastDiagnose) {
    const copy = diagnoseCopy(lastDiagnose);
    const kind =
      lastDiagnose.kind === "done" || lastDiagnose.kind === "partial" ? "watch" : "danger";
    return html`
      <div
        class="enterprise-diagnosis__banner enterprise-diagnosis__banner--${kind}"
        data-testid="enterprise-diagnosis-banner"
      >
        <strong data-testid="enterprise-health">${bannerMark(kind)} ${copy.title}</strong>
        <p data-testid="diagnosis-run-note">${copy.detail}</p>
      </div>
    `;
  }
  const kind =
    model.loadError ||
    model.health.tone === "error" ||
    model.health.tone === "empty" ||
    model.health.tone === "inconclusive" ||
    model.health.tone === "expired" ||
    model.health.tone === "degraded"
      ? "danger"
      : model.health.tone === "watch"
        ? "watch"
        : null;
  if (!kind) {
    return nothing;
  }
  const detail =
    model.health.tone === "inconclusive"
      ? "证据不足，不能标为已恢复。"
      : model.health.tone === "expired"
        ? "数据已过期，不能标为正常。"
        : "暂无数据，不能当作正常或已恢复。";
  return html`
    <div
      class="enterprise-diagnosis__banner enterprise-diagnosis__banner--${kind}"
      data-testid="enterprise-diagnosis-banner"
    >
      <strong data-testid="enterprise-health">${bannerMark(kind)} ${healthCopy(model)}</strong>
      ${
        model.loadError
          ? html`
              <p class="enterprise-diagnosis__sr-only" data-testid="diagnosis-load-error">
                加载失败：${loadErrorCopy(model.loadError)}
              </p>
            `
          : nothing
      }
      ${
        model.health.tone === "empty" || model.loadError
          ? html`<p data-testid="diagnosis-empty">${detail}</p>`
          : nothing
      }
      ${
        model.health.tone === "inconclusive"
          ? html`<p data-testid="diagnosis-inconclusive">${detail}</p>`
          : nothing
      }
      ${
        model.health.tone === "expired"
          ? html`<p data-testid="diagnosis-expired">${detail}</p>`
          : nothing
      }
    </div>
  `;
}

function observation(
  model: DiagnosisViewModel,
  handlers: EnterpriseDiagnosisHandlers,
): TemplateResult {
  const layersEmpty = model.drilldown.length === 0;
  const timelineEmpty = model.timeline.events.length === 0;
  const allEmpty = layersEmpty && timelineEmpty;
  return group(
    "观察",
    html`
      <div data-testid="enterprise-status-layers">
        ${
          allEmpty
            ? emptyState("还没有可观察的信号或事件。", "status-layers-empty")
            : layersEmpty
              ? html`
                  <h3 class="enterprise-diagnosis__subhead">状态层</h3>
                  ${emptyState("还没有可观察的状态层。", "status-layers-empty")}
                `
              : html`
                  <h3 class="enterprise-diagnosis__subhead">状态层</h3>
                  <ul class="enterprise-diagnosis__list">
                    ${model.drilldown.map(
                      (row) => html`
                        <li
                          class="enterprise-diagnosis__row"
                          data-layer=${row.layer}
                          data-id=${row.id}
                        >
                          <span class="enterprise-diagnosis__label">${LAYER_LABEL[row.layer]}</span>
                          <span class="enterprise-diagnosis__value mono">${row.id}</span>
                          <span class="enterprise-diagnosis__meta">${layerStatusCopy(row.status)}</span>
                        </li>
                      `,
                    )}
                  </ul>
                `
        }
      </div>
      <div class="enterprise-diagnosis__block" data-testid="enterprise-timeline">
        ${
          allEmpty
            ? html`
                <p class="enterprise-diagnosis__sr-only" data-testid="timeline-empty">还没有可追溯事件。</p>
              `
            : timelineEmpty
              ? emptyState("还没有可追溯事件。", "timeline-empty")
              : html`
                  <h3 class="enterprise-diagnosis__subhead">时间线</h3>
                  <div class="enterprise-diagnosis__timeline">
                    ${model.timeline.events.map(
                      (event) => html`
                        <article
                          class="enterprise-diagnosis__row"
                          data-kind=${event.kind}
                          data-ref=${event.ref.id}
                        >
                          <span class="enterprise-diagnosis__label">${KIND_LABEL[event.kind] ?? event.kind}</span>
                          <span class="enterprise-diagnosis__value mono">${event.ref.id}</span>
                          <span class="enterprise-diagnosis__meta">${event.timestamp}</span>
                        </article>
                      `,
                    )}
                  </div>
                `
        }
      </div>
      ${conversations(model, handlers)}
    `,
  );
}

function actions(model: DiagnosisViewModel, handlers: EnterpriseDiagnosisHandlers): TemplateResult {
  const consultEmpty = model.authorizations.rows.length === 0;
  const approvalsEmpty = model.authorizations.pendingApprovals.length === 0;
  const remediationsEmpty = model.remediations.length === 0;
  const allEmpty = consultEmpty && approvalsEmpty && remediationsEmpty;
  return group(
    "处置",
    html`
      ${block(
        "enterprise-approvals",
        allEmpty ? null : "待企业审批",
        approvalsEmpty
          ? allEmpty
            ? html`
                <p class="enterprise-diagnosis__empty">当前没有待审批或修复项。</p>
                <p class="enterprise-diagnosis__sr-only">当前没有待审批项。</p>
              `
            : html`
                <p class="enterprise-diagnosis__empty">
                  ${
                    handlers.onAuthorizationDecision
                      ? "没有待审批的授权，不能批准或拒绝。"
                      : "当前没有待审批项。"
                  }
                </p>
              `
          : html`
              <div class="enterprise-diagnosis__stack-rows">
                ${model.authorizations.pendingApprovals.map(
                  (row) => html`
                    <article
                      class="enterprise-diagnosis__item"
                      data-testid="pending-approval"
                      data-grant-id=${row.grantId}
                    >
                      ${kvRows([
                        {
                          label: "目标",
                          value: `${row.targetTenant ?? "未声明"} / ${row.targetPrincipal ?? "未声明"}`,
                        },
                        { label: "范围", value: joinOrUnknown(row.dataScope) },
                        { label: "动作", value: joinOrUnknown(row.actions) },
                        { label: "有效期", value: row.expiresAt || "未声明", mono: true },
                        { label: "风险", value: riskCopy(row.risk) },
                      ])}
                      ${
                        handlers.onAuthorizationDecision
                          ? nothing
                          : html`
                              <p class="enterprise-diagnosis__hint">
                                审批尚未接入，不能在此直接生效。批准或拒绝不会改变授权状态。
                              </p>
                            `
                      }
                      <div class="enterprise-diagnosis__actions">
                        <button
                          type="button"
                          class="btn btn--sm btn--primary"
                          data-testid="approve-grant"
                          ?disabled=${!handlers.onAuthorizationDecision}
                          title=${
                            handlers.onAuthorizationDecision
                              ? "批准这条会诊授权"
                              : "审批尚未接入，不能在此直接生效"
                          }
                          @click=${() => {
                            if (!handlers.onAuthorizationDecision) {
                              return;
                            }
                            if (!confirmAuthorization("approve")) {
                              return;
                            }
                            handlers.onAuthorizationDecision({
                              grantId: row.grantId,
                              decision: "approve",
                              refresh: "p6_p7",
                            });
                          }}
                        >
                          批准
                        </button>
                        <button
                          type="button"
                          class="btn btn--sm"
                          data-testid="deny-grant"
                          ?disabled=${!handlers.onAuthorizationDecision}
                          title=${
                            handlers.onAuthorizationDecision
                              ? "拒绝这条会诊授权"
                              : "审批尚未接入，不能在此直接生效"
                          }
                          @click=${() => {
                            if (!handlers.onAuthorizationDecision) {
                              return;
                            }
                            if (!confirmAuthorization("deny")) {
                              return;
                            }
                            handlers.onAuthorizationDecision({
                              grantId: row.grantId,
                              decision: "deny",
                              refresh: "p6_p7",
                            });
                          }}
                        >
                          拒绝
                        </button>
                      </div>
                    </article>
                  `,
                )}
              </div>
            `,
      )}
      ${block(
        "enterprise-consult",
        allEmpty ? null : "会诊授权",
        consultEmpty
          ? allEmpty
            ? html`
                <p class="enterprise-diagnosis__sr-only" data-testid="consult-empty">还没有会诊授权。</p>
              `
            : emptyState("还没有会诊授权。", "consult-empty")
          : html`
              <div class="enterprise-diagnosis__stack-rows">
                ${model.authorizations.rows.map(
                  (row) => html`
                    <article class="enterprise-diagnosis__item" data-testid="grant-row" data-grant-id=${row.grantId}>
                      ${kvRows([
                        { label: "状态", value: grantStatusCopy(row.status) },
                        { label: "范围", value: joinOrUnknown(row.dataScope) },
                        { label: "动作", value: joinOrUnknown(row.actions) },
                        { label: "有效期", value: row.expiresAt || "未声明", mono: true },
                        { label: "风险", value: riskCopy(row.risk) },
                      ])}
                    </article>
                  `,
                )}
              </div>
            `,
      )}
      ${block(
        "enterprise-remediation",
        allEmpty ? null : "修复预览",
        remediationsEmpty
          ? allEmpty
            ? html`
                <p class="enterprise-diagnosis__sr-only" data-testid="remediation-empty">还没有修复预览。</p>
              `
            : emptyState("还没有修复预览。", "remediation-empty")
          : html`
              <ul class="enterprise-diagnosis__list">
                ${model.remediations.map(
                  (row) => html`
                    <li class="enterprise-diagnosis__row" data-remediation-id=${row.remediationId}>
                      <span class="enterprise-diagnosis__label">${remediationCopy(row.status)}</span>
                      <span class="enterprise-diagnosis__value mono">${row.remediationId}</span>
                      <span class="enterprise-diagnosis__meta">${row.verdict ?? "待验证"}</span>
                    </li>
                  `,
                )}
              </ul>
            `,
      )}
    `,
  );
}

function evidence(model: DiagnosisViewModel): TemplateResult {
  const windowLabel =
    model.trend.window.from && model.trend.window.to
      ? `${model.trend.window.from} → ${model.trend.window.to}`
      : "未声明";
  const productionBlock = model.production ? production(model.production) : nothing;
  return group(
    "证据",
    html`
      ${block(
        "enterprise-trend",
        "趋势",
        html`
          <p class="enterprise-diagnosis__sr-only" data-testid="trend-window">${windowLabel}</p>
          <p class="enterprise-diagnosis__sr-only" data-testid="trend-completeness">${model.trend.completeness}</p>
          ${kvRows([
            { label: "窗口", value: windowLabel, mono: true },
            { label: "完整性", value: completenessCopy(model.trend.completeness) },
          ])}
          ${
            model.trend.completeness !== "complete"
              ? html`
                  <p class="enterprise-diagnosis__hint" data-testid="trend-missing">
                    采样不完整，缺失桶不得当作正常。
                  </p>
                `
              : nothing
          }
        `,
      )}
      ${productionBlock}
    `,
  );
}

function production(state: NonNullable<DiagnosisViewModel["production"]>): TemplateResult {
  const unhealthy =
    state.freshness.stale || state.auditState !== "recorded" || state.apiLoadState !== "ready";
  return block(
    "enterprise-production-status",
    "生产",
    html`
      ${kvRows([
        { label: "加载", value: apiLoadCopy(state.apiLoadState) },
        { label: "权限", value: permissionCopy(state.permissionState) },
        { label: "审计", value: auditCopy(state.auditState) },
        { label: "新鲜度", value: completenessCopy(state.freshness.completeness) },
      ])}
      <p data-api-load=${state.apiLoadState} class="enterprise-diagnosis__sr-only">${state.apiLoadState}</p>
      <p data-audit-state=${state.auditState} class="enterprise-diagnosis__sr-only">${state.auditState}</p>
      <p
        data-freshness=${state.freshness.stale ? "stale" : "fresh"}
        class="enterprise-diagnosis__sr-only"
      >
        ${state.freshness.completeness}
      </p>
      ${
        unhealthy
          ? html`
              <p class="enterprise-diagnosis__hint" data-testid="production-unhealthy">
                生产数据不完整，不能当作正常。
              </p>
            `
          : nothing
      }
    `,
  );
}

function openableConversation(entry: DiagnosisViewConversationEntry): boolean {
  return Boolean(entry.signalId?.trim() || entry.caseId?.trim());
}

function conversations(
  model: DiagnosisViewModel,
  handlers: EnterpriseDiagnosisHandlers,
): TemplateResult | typeof nothing {
  if (!model.conversationEntries.length) {
    return html`
      <div class="enterprise-diagnosis__sr-only" data-testid="enterprise-conversations">
        <p class="enterprise-diagnosis__empty">没有可打开的诊断会话。</p>
      </div>
    `;
  }
  return html`
    <div class="enterprise-diagnosis__block" data-testid="enterprise-conversations">
      <h3 class="enterprise-diagnosis__subhead">大白会话</h3>
      ${
        handlers.onOpenConversation
          ? nothing
          : html`
              <p class="enterprise-diagnosis__hint">
                打开大白会话尚未接入，不能从这里打开。这里只有信号或案例编号，没有可打开的会话。
              </p>
            `
      }
      ${
        handlers.decisionNote
          ? html`<p class="enterprise-diagnosis__hint" data-testid="diagnosis-decision-note">${handlers.decisionNote}</p>`
          : nothing
      }
      <div class="enterprise-diagnosis__actions enterprise-diagnosis__actions--wrap">
        ${model.conversationEntries.map((entry) => {
          const openable = openableConversation(entry);
          const disabled = !handlers.onOpenConversation || !openable;
          const title = !handlers.onOpenConversation
            ? "打开大白会话尚未接入"
            : openable
              ? "打开对应的大白诊断会话"
              : "只有目标引用，没有信号或案例编号，不能打开";
          return html`
            <button
              type="button"
              class="btn btn--sm"
              data-testid="open-daibai"
              data-signal-id=${entry.signalId ?? ""}
              data-case-id=${entry.caseId ?? ""}
              ?disabled=${disabled}
              title=${title}
              @click=${() => {
                if (disabled) {
                  return;
                }
                handlers.onOpenConversation?.(entry);
              }}
            >
              从 ${entry.signalId ?? entry.caseId ?? "目标"} 打开
            </button>
          `;
        })}
      </div>
    </div>
  `;
}

export function renderEnterpriseDiagnosisSurface(
  model: DiagnosisViewModel,
  handlers: EnterpriseDiagnosisHandlers = {},
): TemplateResult {
  const openEntry = model.loadError
    ? undefined
    : model.conversationEntries.find((entry) => openableConversation(entry));
  const hasConversationRows = model.conversationEntries.length > 0 && !model.loadError;
  const statusBanner = banner(model, handlers.lastDiagnose);
  return html`
    <section
      class="enterprise-page enterprise-diagnosis"
      data-testid="enterprise-diagnosis"
      data-role="enterprise"
      data-health-tone=${model.health.tone}
      data-permission-state=${model.permissionState}
      data-tenant-scope=${model.tenantScope ?? ""}
      data-redaction-profile=${model.redactionProfile}
    >
      ${renderEnterpriseModuleHeader({
        title: t("tabs.enterpriseDiagnosis"),
        refresh: handlers.onRefresh
          ? { onRefresh: handlers.onRefresh, pending: handlers.refreshing }
          : undefined,
        trailing: html`
          ${
            statusBanner === nothing
              ? html`<span class="enterprise-diagnosis__status" data-testid="enterprise-health">${healthCopy(model)}</span>`
              : nothing
          }
          ${targetPicker(handlers)}
          ${
            openEntry
              ? html`
                  <button
                    type="button"
                    class="btn btn--sm"
                    data-testid="open-daibai-standalone"
                    ?disabled=${!handlers.onOpenConversation}
                    title=${
                      handlers.onOpenConversation
                        ? "打开对应的大白诊断会话"
                        : "打开大白会话尚未接入"
                    }
                    @click=${() => {
                      if (openEntry && handlers.onOpenConversation) {
                        handlers.onOpenConversation(openEntry);
                      }
                    }}
                  >
                    打开大白诊断
                  </button>
                  ${
                    handlers.onOpenConversation
                      ? nothing
                      : html`
                          <span class="enterprise-diagnosis__hint">尚未接入</span>
                        `
                  }
                `
              : html`
                  <button
                    type="button"
                    class="btn btn--sm"
                    data-testid="open-daibai-standalone"
                    disabled
                    title=${
                      hasConversationRows
                        ? "只有目标引用，没有信号或案例编号，不能打开"
                        : handlers.daibaiDeliveryEnabled
                          ? "当前没有可打开的诊断会话"
                          : "大白诊断投送尚未对企业开放"
                    }
                  >
                    打开大白诊断
                  </button>
                `
          }
        `,
      })}
      <div class="enterprise-page__content enterprise-page__content--narrow">
        ${statusBanner}
        ${
          handlers.lastDiagnose?.reportText
            ? renderEnterpriseDiagnosisReport(
                handlers.lastDiagnose.reportText,
                handlers.onRunConversationAction,
              )
            : nothing
        }
        ${targetHint(handlers)}
        ${diagnoseControls(handlers)}
        <div class="enterprise-org-ws enterprise-org-ws--flat enterprise-diagnosis__body">
          ${observation(model, handlers)}
          ${actions(model, handlers)}
          ${evidence(model)}
        </div>
      </div>
    </section>
  `;
}
