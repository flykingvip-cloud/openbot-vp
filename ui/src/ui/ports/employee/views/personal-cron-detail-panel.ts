import { html, nothing } from "lit";
import { splitTaskOutcomeFromAgentOutput } from "../../../../../../src/cron/task-deliverable-extract.ts";
import type { CronJob, CronRunLogEntry } from "../../../types.ts";
import type { CronProps } from "../../../views/cron.ts";
import {
  formatPersonalCronCreatedAt,
  formatPersonalCronNextRunLabel,
  formatPersonalCronScheduleLabel,
  formatPersonalCronExecutionLabel,
  isCronDeliveryOnlyFailure,
  PERSONAL_CRON_STATUS_LABELS,
  resolvePersonalCronDisplayStatus,
  resolvePersonalCronResultChatTargets,
} from "./personal-cron-center.helpers.ts";
import { renderProgressLedgerDetail } from "./personal-cron-progress.ts";
import {
  categoryLabel,
  priorityLabel,
  resolvePersonalCronTaskMeta,
  resolvePersonalCronVisibleDescription,
} from "./personal-cron-task-meta.ts";

export type CronRunLogSplit = {
  hasDeliverable: boolean;
  processText: string;
  deliverableText: string | null;
};

/** Split cron run log body into process narration vs tagged deliverable envelopes. */
export function splitCronRunLogBody(raw: string): CronRunLogSplit {
  const split = splitTaskOutcomeFromAgentOutput(raw);
  return {
    hasDeliverable: split.hasDeliverable,
    processText: split.processText,
    deliverableText: split.hasDeliverable ? split.deliverableMarkdown : null,
  };
}

function excerptRunReason(entry: { summary?: string; error?: string }): string | null {
  const summary = entry.summary?.trim();
  if (summary) {
    const compact = summary.replace(/\s+/g, " ");
    return compact.length > 220 ? `${compact.slice(0, 220)}…` : compact;
  }
  const error = entry.error?.trim();
  return error || null;
}

function formatRunDuration(ms?: number): string {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) {
    return "—";
  }
  const sec = Math.round(ms / 1000);
  if (sec < 60) {
    return `${sec}s`;
  }
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return rem > 0 ? `${min}m${rem}s` : `${min}m`;
}

function formatRunTimestamp(ts?: number): string {
  if (ts == null || !Number.isFinite(ts)) {
    return "—";
  }
  return new Date(ts).toLocaleString();
}

function resolveRunStatusLabel(entry: { status?: string; error?: string; summary?: string }): {
  label: string;
  tone: "ok" | "warn" | "error";
} {
  if (entry.status === "ok") {
    return { label: "成功", tone: "ok" };
  }
  if (isCronDeliveryOnlyFailure(entry)) {
    return { label: "执行成功 · 通知未送达", tone: "warn" };
  }
  if (entry.status === "skipped") {
    return { label: "已跳过", tone: "warn" };
  }
  return { label: "失败", tone: "error" };
}

function renderRunLogEntry(
  entry: CronRunLogEntry,
  onOpenExecutionChat?: (sessionKey: string) => void,
) {
  const status = resolveRunStatusLabel(entry);
  const summary = entry.summary?.trim() || entry.error?.trim() || "无摘要";
  const deliveryNote =
    entry.deliveryError?.trim() || (isCronDeliveryOnlyFailure(entry) ? entry.error : "");
  return html`
    <article class="employee-cron-panel__run-log">
      <header class="employee-cron-panel__run-log-head">
        <span class="employee-cron-panel__run-status is-${status.tone}">${status.label}</span>
        <span class="employee-cron-panel__run-meta">
          ${formatRunTimestamp(entry.runAtMs ?? entry.ts)} · 耗时 ${formatRunDuration(entry.durationMs)}
        </span>
      </header>
      <pre class="employee-cron-panel__run-log-body">${summary}</pre>
      ${
        deliveryNote
          ? html`<p class="employee-cron-panel__run-log-error">通知：${deliveryNote}</p>`
          : nothing
      }
      ${
        entry.error && !isCronDeliveryOnlyFailure(entry)
          ? html`<p class="employee-cron-panel__run-log-error">${entry.error}</p>`
          : nothing
      }
      ${
        entry.sessionKey && onOpenExecutionChat
          ? html`
              <button
                type="button"
                class="btn btn--sm"
                @click=${() => onOpenExecutionChat(entry.sessionKey!)}
              >
                在对话中查看此次执行
              </button>
            `
          : nothing
      }
    </article>
  `;
}

function renderDetailSection(title: string, content: unknown) {
  return html`
    <section class="employee-cron-panel__section">
      <div class="employee-cron-panel__section-title">${title}</div>
      <div class="employee-cron-panel__section-body">${content}</div>
    </section>
  `;
}

function renderDetailField(label: string, value: unknown) {
  return html`
    <div class="employee-cron-panel__field">
      <div class="employee-cron-panel__field-label">${label}</div>
      <div class="employee-cron-panel__field-value">${value}</div>
    </div>
  `;
}

export function renderPersonalCronDetailPanel(params: {
  job: CronJob;
  props: CronProps;
  onEdit: () => void;
  onRun: () => void;
  onToggle: () => void;
  onViewLogs: () => void | Promise<void>;
  showRunLogs?: boolean;
  onOpenExecutionChat?: (sessionKey: string) => void;
  statusBadge: (job: CronJob) => unknown;
}) {
  const {
    job,
    props,
    onEdit,
    onRun,
    onToggle,
    onViewLogs,
    showRunLogs = false,
    onOpenExecutionChat,
    statusBadge,
  } = params;
  const meta = resolvePersonalCronTaskMeta(job);
  const executionLabel = formatPersonalCronExecutionLabel({
    job,
    meta,
    agents: props.executionAgents,
    groups: props.executionGroups,
  });
  const description = resolvePersonalCronVisibleDescription(job);
  const instruction =
    job.payload.kind === "agentTurn"
      ? (job.payload.message?.trim() ?? "")
      : (job.payload.text?.trim() ?? "");
  const runsLoaded = props.runsJobId === job.id;
  const runs = runsLoaded ? props.runs : [];
  const lastRun =
    runs.length > 0
      ? runs[0]
      : job.state?.lastStatus
        ? {
            status: job.state.lastStatus,
            durationMs: job.state.lastDurationMs,
            error: job.state.lastError,
          }
        : null;
  const lastRunStatus = lastRun ? resolveRunStatusLabel(lastRun) : null;
  const lastRunOk = lastRunStatus?.tone === "ok" || lastRunStatus?.tone === "warn";
  const lastRunReason = lastRun ? excerptRunReason(lastRun) : null;
  const displayStatus = resolvePersonalCronDisplayStatus(job);
  const chatTargets = resolvePersonalCronResultChatTargets({
    job,
    agents: props.executionAgents,
    groups: props.executionGroups,
  });

  return html`
    <div class="employee-cron-panel employee-cron-panel--detail">
      <div class="employee-cron-panel__hero">
        <div class="employee-cron-panel__hero-title">${job.name}</div>
        ${statusBadge(job)}
      </div>
      ${renderProgressLedgerDetail(job)}

      <div class="employee-cron-panel__grid">
        ${renderDetailField("任务分类", categoryLabel(meta.category))}
        ${renderDetailField("优先级", priorityLabel(meta.priority))}
        ${renderDetailField("执行对象", executionLabel)}
        ${renderDetailField("执行周期", formatPersonalCronScheduleLabel(job))}
        ${renderDetailField("创建人", meta.creatorLabel || "我")}
        ${renderDetailField("创建时间", formatPersonalCronCreatedAt(job.createdAtMs))}
      </div>

      ${renderDetailSection("任务描述", description || "暂无描述")}
      ${renderDetailSection("定时说明", meta.goal || "未设置定时说明")}
      ${
        meta.acceptanceRules.length > 0
          ? renderDetailSection(
              "验收标准",
              html`
                <ol class="employee-cron-panel__rules">
                  ${meta.acceptanceRules.map((rule) => html`<li>${rule}</li>`)}
                </ol>
              `,
            )
          : renderDetailSection("验收标准", "未设置验收规则")
      }
      ${
        instruction && instruction !== description
          ? renderDetailSection(
              "执行指令",
              html`<pre class="employee-cron-panel__prompt">${instruction}</pre>`,
            )
          : nothing
      }

      ${renderDetailSection(
        "最近执行记录",
        lastRun
          ? html`
              <div class="employee-cron-panel__run">
                <div class="employee-cron-panel__run-head">
                  <span
                    class="employee-cron-panel__run-status ${lastRunOk ? (lastRunStatus?.tone === "warn" ? "is-warn" : "is-ok") : "is-error"}"
                  >
                    ${
                      lastRunStatus?.label ??
                      (lastRunOk ? "成功" : displayStatus === "interrupted" ? "可能中断" : "失败")
                    }
                  </span>
                  <span class="employee-cron-panel__run-meta">
                    耗时 ${formatRunDuration(lastRun.durationMs)}
                  </span>
                </div>
                ${
                  lastRunReason
                    ? html`<p class="employee-cron-panel__run-reason">${lastRunReason}</p>`
                    : nothing
                }
                <button type="button" class="btn btn--sm" @click=${onViewLogs}>
                  ${showRunLogs && runs.length > 0 ? "收起日志" : "查看日志"}
                </button>
              </div>
              ${
                showRunLogs
                  ? runs.length > 0
                    ? html`
                        <div class="employee-cron-panel__run-logs">
                          ${runs.map((entry) => renderRunLogEntry(entry, onOpenExecutionChat))}
                        </div>
                      `
                    : html`
                        <p class="employee-cron-panel__muted employee-cron-panel__run-logs-empty">
                          ${props.busy ? "正在加载执行日志…" : "暂无详细日志"}
                        </p>
                      `
                  : nothing
              }
            `
          : html`
              <div class="employee-cron-panel__muted">暂无执行记录</div>
            `,
      )}

      <p class="employee-cron-panel__muted employee-cron-panel__surface-hint">
        任务完成后，摘要会自动推送到执行机器人对话${
          job.sessionKey ? "及所选协作小组对话" : ""
        }，便于直接追问和跟进。
      </p>

      ${
        chatTargets.length > 0 && onOpenExecutionChat
          ? html`
              <div class="employee-cron-panel__chat-links">
                ${chatTargets.map(
                  (target) => html`
                    <button
                      type="button"
                      class="btn btn--sm"
                      @click=${() => onOpenExecutionChat(target.sessionKey)}
                    >
                      在${target.label}对话中查看
                    </button>
                  `,
                )}
              </div>
            `
          : nothing
      }

      <div class="employee-cron-panel__next">
        ${formatPersonalCronNextRunLabel(job.state?.nextRunAtMs)}
      </div>

      <div class="employee-cron-panel__footer">
        <button type="button" class="btn btn--primary" @click=${onEdit}>编辑任务</button>
        <button type="button" class="btn" @click=${onRun}>立即执行</button>
        <button type="button" class="btn" @click=${onToggle}>
          ${job.enabled ? "暂停任务" : "启用任务"}
        </button>
      </div>
    </div>
  `;
}

export { PERSONAL_CRON_STATUS_LABELS, resolvePersonalCronDisplayStatus };
