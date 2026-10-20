import { html, nothing, type TemplateResult } from "lit";
import type { MonitorTaskSnapshot } from "./api.ts";
import type { MonitorCadence, MonitorReportDocument } from "./monitor-report.ts";

export type MonitorTenantOption = { tenantId: string; label: string };
export type MonitorAgentOption = { agentId: string; label: string };
export type MonitorGroupOption = { groupId: string; label: string; roundId: string | null };

export type MonitorDraft = {
  cadence: MonitorCadence;
  scopeAll: boolean;
  scopeAgents: boolean;
  scopeGroups: boolean;
  agentIds: string[];
  groupId: string | null;
  failureMinCount: number | null;
  efficiencyMaxTotalMs: number | null;
};

export type MonitorRunView = MonitorTaskSnapshot["runs"][number] & {
  trigger: "manual" | "daily" | "tick";
};

export type PlatformMonitorTaskState = {
  tenants: MonitorTenantOption[];
  tenantQuery: string;
  tenantMenuOpen: boolean;
  selectedTenantId: string | null;
  agents: MonitorAgentOption[];
  groups: MonitorGroupOption[];
  agentQuery: string;
  snapshot: MonitorTaskSnapshot | null;
  runs: MonitorRunView[];
  mode: "overview" | "edit" | "report";
  draft: MonitorDraft;
  report: MonitorReportDocument | null;
  notice: string | null;
  permission: "allowed" | "forbidden";
  busy: boolean;
};

export type PlatformMonitorTaskHandlers = {
  onTenantQuery: (value: string) => void;
  onTenantMenu: (open: boolean) => void;
  onSelectTenant: (tenantId: string) => void;
  onClearTenant: () => void;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSave: () => void;
  onCadence: (value: MonitorCadence) => void;
  onToggleScope: (scope: "all" | "agents" | "groups") => void;
  onAgentQuery: (value: string) => void;
  onToggleAgent: (agentId: string) => void;
  onGroup: (groupId: string) => void;
  onFailureThreshold: (value: number | null) => void;
  onEfficiencyThreshold: (value: number | null) => void;
  onPause: () => void;
  onResume: () => void;
  onRun: () => void;
  onOpenReport: (runId: string) => void;
  onCloseReport: () => void;
  onExport: (format: "md" | "yaml") => void;
  onCopyMachine: () => void;
};

export function renderPlatformMonitorTask(
  state: PlatformMonitorTaskState,
  handlers: PlatformMonitorTaskHandlers,
): TemplateResult {
  const selected = state.tenants.find((row) => row.tenantId === state.selectedTenantId) ?? null;
  return html`
    <section class="platform-monitor" data-testid="platform-monitor-task" data-port="platform">
      ${tenantSelect(state, selected, handlers)}
      ${
        state.permission === "forbidden"
          ? html`
              <p class="platform-monitor__notice" data-testid="monitor-forbidden">无权该租户</p>
            `
          : nothing
      }
      ${
        state.notice
          ? html`<p class="platform-monitor__notice" data-testid="monitor-notice">${state.notice}</p>`
          : nothing
      }
      ${
        state.mode === "report" && state.report
          ? reportView(state.report, handlers)
          : state.mode === "edit"
            ? editView(state, handlers, !selected)
            : overview(state, selected, handlers)
      }
    </section>
  `;
}

function tenantSelect(
  state: PlatformMonitorTaskState,
  selected: MonitorTenantOption | null,
  handlers: PlatformMonitorTaskHandlers,
): TemplateResult {
  const query = state.tenantQuery.trim().toLowerCase();
  const options = state.tenants.filter((row) => {
    if (!query) {
      return true;
    }
    return row.label.toLowerCase().includes(query) || row.tenantId.toLowerCase().includes(query);
  });
  return html`
    <section class="platform-monitor__tenant" data-testid="monitor-tenant">
      <div class="platform-monitor__label">租户</div>
      <div class="platform-monitor__tenant-row">
        ${
          selected
            ? html`
                <div class="platform-monitor__tenant-chip" data-testid="monitor-tenant-selected">
                  <span>${selected.label}</span>
                  <span class="platform-monitor__id" data-testid="monitor-tenant-id"
                    >${selected.tenantId}</span
                  >
                  <button
                    type="button"
                    class="platform-monitor__icon-btn"
                    data-testid="monitor-tenant-clear"
                    @click=${() => handlers.onClearTenant()}
                  >
                    ×
                  </button>
                </div>
              `
            : nothing
        }
        <div class="platform-monitor__combo">
          <input
            type="search"
            class="platform-monitor__search"
            data-testid="monitor-tenant-search"
            placeholder="搜索租户"
            .value=${state.tenantQuery}
            @focus=${() => handlers.onTenantMenu(true)}
            @input=${(event: Event) => {
              handlers.onTenantQuery((event.target as HTMLInputElement).value);
              handlers.onTenantMenu(true);
            }}
          />
          ${
            state.tenantMenuOpen
              ? html`
                  <ul class="platform-monitor__menu" data-testid="monitor-tenant-menu" role="listbox">
                    ${
                      options.length === 0
                        ? html`
                            <li class="platform-monitor__menu-empty">没有匹配的租户</li>
                          `
                        : options.map(
                            (row) => html`
                              <li>
                                <button
                                  type="button"
                                  class="platform-monitor__option"
                                  data-testid="monitor-tenant-option"
                                  data-tenant-id=${row.tenantId}
                                  @click=${() => handlers.onSelectTenant(row.tenantId)}
                                >
                                  <span>${row.label}</span>
                                  <span class="platform-monitor__id">${row.tenantId}</span>
                                </button>
                              </li>
                            `,
                          )
                    }
                  </ul>
                `
              : nothing
          }
        </div>
        ${
          selected
            ? html`
                <span class="platform-monitor__readonly">只读</span>
              `
            : html`
                <span class="platform-monitor__readonly">先选租户</span>
              `
        }
      </div>
    </section>
  `;
}

function overview(
  state: PlatformMonitorTaskState,
  selected: MonitorTenantOption | null,
  handlers: PlatformMonitorTaskHandlers,
): TemplateResult {
  const snapshot = state.snapshot;
  const paused = snapshot?.paused === true;
  const hasDefinition = snapshot?.hasDefinition === true;
  const locked = !selected || state.permission === "forbidden";
  const cadence = snapshot?.cadence ?? "off";
  const running = state.runs.some((run) => run.status === "running");
  const status = !selected
    ? "未选择"
    : paused
      ? "已暂停"
      : running || cadence !== "off"
        ? "运行中"
        : "未启用";
  const runDisabled = locked || paused || !hasDefinition || state.busy;
  const runTitle = paused
    ? "任务已暂停"
    : !hasDefinition
      ? "先保存监测任务"
      : "立即跑一次，不改 cadence";
  return html`
    <section class="platform-monitor__task" data-testid="monitor-overview" ?data-locked=${locked}>
      <h2 class="platform-monitor__title">监测任务</h2>
      <div class="platform-monitor__toolbar">
        <div class="platform-monitor__status">
          <span class="platform-monitor__badge" data-testid="monitor-status">${status}</span>
          <span data-testid="monitor-cadence">cadence = ${cadence}</span>
        </div>
        <div class="platform-monitor__actions">
          <button
            type="button"
            class="btn"
            data-testid="monitor-edit"
            ?disabled=${locked || state.busy}
            @click=${() => handlers.onEdit()}
          >
            编辑
          </button>
          ${
            paused
              ? html`
                  <button
                    type="button"
                    class="btn btn--primary"
                    data-testid="monitor-resume"
                    ?disabled=${locked || !hasDefinition || state.busy}
                    @click=${() => handlers.onResume()}
                  >
                    恢复
                  </button>
                `
              : html`
                  <button
                    type="button"
                    class="btn btn--primary"
                    data-testid="monitor-pause"
                    ?disabled=${locked || !hasDefinition || state.busy}
                    @click=${() => handlers.onPause()}
                  >
                    暂停
                  </button>
                `
          }
          <button
            type="button"
            class="btn"
            data-testid="monitor-run"
            title=${runTitle}
            ?disabled=${runDisabled}
            @click=${() => handlers.onRun()}
          >
            立即跑
          </button>
        </div>
      </div>
      ${
        paused
          ? html`
              <p class="platform-monitor__hint" data-testid="monitor-paused">
                无法创建 Run：任务已暂停。暂停后本 Run 仍跑完。
              </p>
            `
          : html`
              <p class="platform-monitor__hint">暂停后本 Run 仍跑完。立即跑不改 cadence。</p>
            `
      }
      <div class="platform-monitor__split">
        <div class="platform-monitor__scope" data-testid="monitor-scope">
          <h3>范围</h3>
          <ul>
            <li>${state.draft.scopeAll || !snapshot ? "全部入口" : "入口已收窄"}</li>
            <li>机器人：${agentScopeLabel(state)}</li>
            <li>协作小组：${groupScopeLabel(state)}</li>
            <li>阈值：${thresholdLabel(snapshot)}</li>
          </ul>
        </div>
        <div class="platform-monitor__runs">
          <h3>最近 Run</h3>
          ${runTable(state.runs, handlers, locked)}
        </div>
      </div>
      <p class="platform-monitor__footnote">企业端本期无本分区 · 立即诊断 ≠ 立即跑</p>
    </section>
  `;
}

function editView(
  state: PlatformMonitorTaskState,
  handlers: PlatformMonitorTaskHandlers,
  locked: boolean,
): TemplateResult {
  const draft = state.draft;
  const agentQuery = state.agentQuery.trim().toLowerCase();
  const agents = state.agents.filter((row) => {
    if (!agentQuery) {
      return true;
    }
    return (
      row.label.toLowerCase().includes(agentQuery) || row.agentId.toLowerCase().includes(agentQuery)
    );
  });
  return html`
    <form
      class="platform-monitor__edit"
      data-testid="monitor-edit-form"
      @submit=${(event: Event) => {
        event.preventDefault();
        handlers.onSave();
      }}
    >
      <section class="platform-monitor__block">
        <h3>1. cadence</h3>
        <div class="platform-monitor__radios" data-testid="monitor-cadence-radios">
          ${(["off", "daily", "tick"] as const).map(
            (value) => html`
              <label>
                <input
                  type="radio"
                  name="monitor-cadence"
                  value=${value}
                  .checked=${draft.cadence === value}
                  ?disabled=${locked}
                  @change=${() => handlers.onCadence(value)}
                />
                ${value}${value === draft.cadence ? " ←" : ""}
              </label>
            `,
          )}
        </div>
        <p class="platform-monitor__hint">暂停 / 立即跑不改 cadence</p>
      </section>
      <section class="platform-monitor__block">
        <h3>2. 范围</h3>
        <div class="platform-monitor__chips">
          ${scopeChip("全部入口", draft.scopeAll, locked, () => handlers.onToggleScope("all"))}
          ${scopeChip("指定机器人", draft.scopeAgents, locked, () => handlers.onToggleScope("agents"))}
          ${scopeChip("指定协作小组", draft.scopeGroups, locked, () => handlers.onToggleScope("groups"))}
        </div>
        <div class="platform-monitor__field">
          <div class="platform-monitor__label">机器人</div>
          <input
            type="search"
            class="platform-monitor__search"
            data-testid="monitor-agent-search"
            placeholder="搜索机器人"
            ?disabled=${locked || !draft.scopeAgents}
            .value=${state.agentQuery}
            @input=${(event: Event) =>
              handlers.onAgentQuery((event.target as HTMLInputElement).value)}
          />
          <ul class="platform-monitor__checks" data-testid="monitor-agent-list">
            ${
              agents.length === 0
                ? html`
                    <li class="platform-monitor__menu-empty">该租户没有可选机器人</li>
                  `
                : agents.map(
                    (row) => html`
                      <li>
                        <label>
                          <input
                            type="checkbox"
                            data-testid="monitor-agent-option"
                            data-agent-id=${row.agentId}
                            .checked=${draft.agentIds.includes(row.agentId)}
                            ?disabled=${locked || !draft.scopeAgents}
                            @change=${() => handlers.onToggleAgent(row.agentId)}
                          />
                          <span>${row.label}</span>
                          <span class="platform-monitor__id">${row.agentId}</span>
                        </label>
                      </li>
                    `,
                  )
            }
          </ul>
        </div>
        <div class="platform-monitor__field">
          <div class="platform-monitor__label">协作小组</div>
          <select
            class="platform-monitor__select"
            data-testid="monitor-group-select"
            ?disabled=${locked || !draft.scopeGroups}
            .value=${draft.groupId ?? ""}
            @change=${(event: Event) => handlers.onGroup((event.target as HTMLSelectElement).value)}
          >
            <option value="">全部（未指定）</option>
            ${state.groups.map((row) => html`<option value=${row.groupId}>${row.label}</option>`)}
          </select>
          <span class="platform-monitor__readonly">groupId / roundId 由选项带出</span>
          ${
            draft.groupId
              ? html`<span class="platform-monitor__id" data-testid="monitor-group-id"
                  >${draft.groupId}${groupRound(state, draft.groupId)}</span
                >`
              : nothing
          }
        </div>
      </section>
      <section class="platform-monitor__block">
        <h3>3. 阈值</h3>
        <label class="platform-monitor__threshold">
          <span>失败</span>
          ${thresholdSelect(
            "monitor-failure-threshold",
            draft.failureMinCount,
            [
              ["1", "1"],
              ["3", "3"],
              ["5", "5"],
            ],
            locked,
            handlers.onFailureThreshold,
          )}
        </label>
        <label class="platform-monitor__threshold">
          <span>效率</span>
          ${thresholdSelect(
            "monitor-efficiency-threshold",
            draft.efficiencyMaxTotalMs,
            [
              ["30000", "30s"],
              ["60000", "60s"],
              ["120000", "120s"],
            ],
            locked,
            handlers.onEfficiencyThreshold,
          )}
        </label>
      </section>
      <div class="platform-monitor__edit-actions">
        <button type="button" class="btn" data-testid="monitor-cancel" @click=${() => handlers.onCancelEdit()}>
          取消
        </button>
        <button type="submit" class="btn btn--primary" data-testid="monitor-save" ?disabled=${locked || state.busy}>
          保存
        </button>
      </div>
    </form>
  `;
}

function reportView(
  doc: MonitorReportDocument,
  handlers: PlatformMonitorTaskHandlers,
): TemplateResult {
  const machine = [
    "tenantId, runId, agentId, groupId, roundId,",
    "cadence, trigger, window.{start,end},",
    "metrics.failure|efficiency.{value,threshold,breached},",
    "violations[].{ruleId, severity, evidence, symptom}",
  ].join(" ");
  return html`
    <section class="platform-monitor__report" data-testid="monitor-report">
      <p class="platform-monitor__report-meta" data-testid="monitor-report-meta">
        ${doc.tenantLabel} · ${doc.runId} · ${doc.cadence} · ${doc.window.start} → ${doc.window.end}
      </p>
      <div class="platform-monitor__export">
        <button
          type="button"
          class="btn btn--primary"
          data-testid="monitor-export-md"
          @click=${() => handlers.onExport("md")}
        >
          导出 Markdown
        </button>
        <button
          type="button"
          class="btn btn--primary"
          data-testid="monitor-export-yaml"
          @click=${() => handlers.onExport("yaml")}
        >
          导出 YAML
        </button>
        <button type="button" class="btn" data-testid="monitor-copy" @click=${() => handlers.onCopyMachine()}>
          复制机器可读
        </button>
        <span class="platform-monitor__readonly">次要</span>
      </div>
      <section class="platform-monitor__block">
        <h3>机器可读（字段清单）</h3>
        <pre class="platform-monitor__pre" data-testid="monitor-machine-fields">${machine}</pre>
      </section>
      <section class="platform-monitor__block">
        <h3>中文摘要</h3>
        <p data-testid="monitor-summary">${doc.summary}</p>
      </section>
      <section class="platform-monitor__block">
        <h3>修复指引（每条 violation）</h3>
        ${
          doc.guidance.length === 0
            ? html`
                <p data-testid="monitor-guidance-empty">本窗没有 violation。</p>
              `
            : doc.guidance.map(
                (row) => html`
                  <article data-testid="monitor-guidance" data-rule-id=${row.ruleId}>
                    <strong>${row.ruleId}</strong>
                    <p>${row.symptom}</p>
                    <ul>
                      <li>建议改哪里：${row.where}</li>
                      <li>复现步骤：${row.reproduce}</li>
                      <li>验收标准：${row.accept}</li>
                    </ul>
                  </article>
                `,
              )
        }
      </section>
      <p class="platform-monitor__footnote">
        导出文件 = 机器可读 + 中文摘要 + 修复指引 · m1-monitor-{tenantId}-{runId}.{md|yaml}
      </p>
      <p class="platform-monitor__footnote">无正确性打分 · 无确认或自进化按钮</p>
      <button type="button" class="btn" data-testid="monitor-report-back" @click=${() => handlers.onCloseReport()}>
        返回
      </button>
    </section>
  `;
}

function runTable(
  runs: MonitorRunView[],
  handlers: PlatformMonitorTaskHandlers,
  locked: boolean,
): TemplateResult {
  if (runs.length === 0) {
    return html`
      <p data-testid="monitor-runs-empty">还没有 Run</p>
    `;
  }
  return html`
    <table class="platform-monitor__table" data-testid="monitor-runs">
      <thead>
        <tr>
          <th>Run ID</th>
          <th>触发</th>
          <th>状态</th>
          <th>起止</th>
          <th>报告</th>
        </tr>
      </thead>
      <tbody>
        ${runs.map(
          (run) => html`
            <tr data-testid="monitor-run-row" data-run-id=${run.runId}>
              <td class="platform-monitor__id" title=${run.runId}>${shortId(run.runId)}</td>
              <td>${run.trigger === "manual" ? "手动" : run.trigger}</td>
              <td>${runStatusLabel(run.status)}</td>
              <td>${shortStamp(run.startedAt)} – ${shortStamp(run.finishedAt)}</td>
              <td>
                ${
                  run.reportId
                    ? html`<button
                        type="button"
                        class="btn"
                        data-testid="monitor-open-report"
                        ?disabled=${locked}
                        @click=${() => handlers.onOpenReport(run.runId)}
                      >
                        打开报告
                      </button>`
                    : html`
                        <span>—</span>
                      `
                }
              </td>
            </tr>
          `,
        )}
      </tbody>
    </table>
  `;
}

function scopeChip(
  label: string,
  on: boolean,
  locked: boolean,
  toggle: () => void,
): TemplateResult {
  return html`
    <button
      type="button"
      class="platform-monitor__chip ${on ? "is-on" : ""}"
      data-testid="monitor-scope-chip"
      data-scope=${label}
      aria-pressed=${on ? "true" : "false"}
      ?disabled=${locked}
      @click=${toggle}
    >
      ${label}
    </button>
  `;
}

function thresholdSelect(
  testId: string,
  current: number | null,
  presets: Array<[string, string]>,
  locked: boolean,
  onChange: (value: number | null) => void,
): TemplateResult {
  const value = current == null ? "" : String(current);
  const known = new Set(presets.map(([preset]) => preset));
  return html`
    <select
      class="platform-monitor__select"
      data-testid=${testId}
      ?disabled=${locked}
      .value=${value}
      @change=${(event: Event) => {
        const raw = (event.target as HTMLSelectElement).value;
        onChange(raw ? Number(raw) : null);
      }}
    >
      <option value="">规则默认</option>
      ${value && !known.has(value) ? html`<option value=${value}>${value}</option>` : nothing}
      ${presets.map(([preset, label]) => html`<option value=${preset}>${label}</option>`)}
    </select>
  `;
}

function agentScopeLabel(state: PlatformMonitorTaskState): string {
  const ids = state.snapshot?.agentIds ?? [];
  if (ids.length === 0) {
    return "不限";
  }
  return ids.map((id) => state.agents.find((row) => row.agentId === id)?.label ?? id).join("、");
}

function groupScopeLabel(state: PlatformMonitorTaskState): string {
  const groupId = state.snapshot?.groupId;
  if (!groupId) {
    return "不限";
  }
  return state.groups.find((row) => row.groupId === groupId)?.label ?? groupId;
}

function thresholdLabel(snapshot: MonitorTaskSnapshot | null): string {
  if (!snapshot || (snapshot.failureMinCount == null && snapshot.efficiencyMaxTotalMs == null)) {
    return "规则默认";
  }
  const parts = [];
  if (snapshot.failureMinCount != null) {
    parts.push(`失败 ${snapshot.failureMinCount}`);
  }
  if (snapshot.efficiencyMaxTotalMs != null) {
    parts.push(`效率 ${snapshot.efficiencyMaxTotalMs}ms`);
  }
  return parts.join(" · ");
}

function groupRound(state: PlatformMonitorTaskState, groupId: string): string {
  const roundId = state.groups.find((row) => row.groupId === groupId)?.roundId;
  return roundId ? ` / ${roundId}` : "";
}

function runStatusLabel(status: MonitorRunView["status"]): string {
  if (status === "completed") {
    return "成功";
  }
  if (status === "failed") {
    return "失败";
  }
  return "running";
}

function shortId(value: string): string {
  return value.length > 10 ? `${value.slice(0, 10)}…` : value;
}

function shortStamp(iso: string | null): string {
  if (!iso) {
    return "—";
  }
  const match = iso.match(/(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!match) {
    return iso;
  }
  return `${match[1]}-${match[2]} ${match[3]}:${match[4]}`;
}
