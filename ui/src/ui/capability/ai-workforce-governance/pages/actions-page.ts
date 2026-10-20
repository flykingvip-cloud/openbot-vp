/**
 * Governance Actions Page
 * Displays auto-governance action records.
 */

import { LitElement, html, css } from "lit";
import { customElement, state } from "lit/decorators.js";
import {
  approvePatternCandidate,
  applyEvolutionLimit,
  applyEvolutionRedirect,
  cancelSkillAutoInstall,
  clearEvolutionLimit,
  clearEvolutionRedirect,
  enrollSkillAutoInstall,
  executePendingAction,
  fetchEvolutionGovernanceSnapshot,
  fetchEvolutionPendingApprovals,
  fetchEvolutionSurfaces,
  fetchGovernanceActions,
  fetchPatternCandidatesForAgents,
  fetchWorkingStyleEffects,
  humanHoldEvolutionAgent,
  humanResumeEvolutionAgent,
  publishPatternDraftSkill,
  rejectPatternCandidate,
  resolveEvolutionApproval,
  setEvolutionKillSwitch,
  type EvolutionGovernanceSnapshot,
  type EvolutionPendingApproval,
  type PatternCandidateGovernanceRow,
  type SkillAutoInstallJobRow,
} from "../services/governanceApi.ts";
import type { GovernanceActionRecord, GovernanceActionStatus } from "../types/index.ts";
import "./evolution-lineage-panel.ts";

const SKILL_AUTO_ACTIVE_STAGES = new Set([
  "pending_publish",
  "draft_created",
  "finalized",
  "failed",
  "health_watch",
]);

@customElement("governance-actions-page")
export class GovernanceActionsPage extends LitElement {
  @state() private actions: GovernanceActionRecord[] = [];
  @state() private filterStatus: GovernanceActionStatus | null = null;
  @state() private isLoading = false;
  @state() private evolution: EvolutionGovernanceSnapshot | null = null;
  @state() private pendingApprovals: EvolutionPendingApproval[] = [];
  @state() private patternCandidates: PatternCandidateGovernanceRow[] = [];
  @state() private patternActionBusyKey: string | null = null;
  @state() private approveWithAutoInstall = false;
  @state() private killSwitchBusy = false;
  @state() private manualRuntimeAgentId = "";
  @state() private manualRedirectTarget = "";
  @state() private manualActionMessage: string | null = null;

  static styles = css`
    :host {
      display: block;
      padding: 24px;
      font-family: var(--font-body);
      color: var(--text);
    }

    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 24px;
    }

    h1 {
      margin: 0;
      font-size: 24px;
      font-weight: 600;
      color: var(--text-strong);
    }

    .filters {
      margin-bottom: 20px;
    }

    select {
      padding: 8px 12px;
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      background: var(--card);
      color: var(--text);
      font-size: 14px;
    }

    .action-list {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .action-card {
      display: flex;
      align-items: center;
      padding: 16px 20px;
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
    }

    .status-badge {
      padding: 4px 10px;
      border-radius: var(--radius-lg);
      font-size: 12px;
      font-weight: 500;
      margin-right: 16px;
      text-transform: uppercase;
    }

    .status-badge.pending {
      background: color-mix(in srgb, var(--warn) 15%, transparent);
      color: var(--warn);
    }

    .status-badge.executed {
      background: color-mix(in srgb, var(--ok) 15%, transparent);
      color: var(--ok);
    }

    .status-badge.failed {
      background: color-mix(in srgb, var(--danger) 15%, transparent);
      color: var(--danger);
    }

    .action-info {
      flex: 1;
    }

    .action-title {
      font-weight: 500;
      margin-bottom: 4px;
      color: var(--text-strong);
    }

    .action-meta {
      font-size: 13px;
      color: var(--muted);
    }

    .trigger-badge {
      padding: 2px 8px;
      border-radius: var(--radius-sm);
      font-size: 11px;
      margin-left: 8px;
    }

    .trigger-badge.auto {
      background: color-mix(in srgb, var(--info) 15%, transparent);
      color: var(--info);
    }

    .trigger-badge.manual {
      background: var(--secondary);
      color: var(--muted);
    }

    .action-btn {
      padding: 6px 12px;
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      background: var(--card);
      color: var(--text);
      cursor: pointer;
      font-size: 13px;
    }

    .action-btn:hover {
      background: var(--bg-hover);
    }

    .auto-notice {
      padding: 12px 16px;
      background: color-mix(in srgb, var(--info) 12%, transparent);
      border: 1px solid color-mix(in srgb, var(--info) 30%, transparent);
      border-radius: var(--radius-md);
      margin-bottom: 20px;
      font-size: 14px;
      color: var(--info);
    }

    .evolution-panel {
      margin-bottom: 24px;
      padding: 16px;
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      background: var(--card);
    }

    .evolution-panel h2 {
      margin: 0 0 12px;
      font-size: 16px;
    }

    .evo-meta {
      font-size: 13px;
      color: var(--muted);
      margin-bottom: 12px;
    }

    .evo-row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      padding: 10px 0;
      border-top: 1px solid var(--border);
    }

    .evo-row:first-of-type {
      border-top: none;
    }

    .manual-controls {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      margin: 12px 0;
    }

    .manual-controls input {
      min-width: 160px;
      padding: 6px 10px;
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      background: var(--card);
      color: var(--text);
      font-size: 13px;
    }

    .manual-note {
      margin-bottom: 12px;
      font-size: 12px;
      color: var(--muted);
    }

    .checkbox-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 8px 0 12px;
      font-size: 13px;
      color: var(--text);
    }

    .checkbox-row input {
      margin: 0;
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    void this.loadActions();
  }

  private async loadActions() {
    this.isLoading = true;
    const statusFilter = this.filterStatus || undefined;
    const [actions, evolution, pendingApprovals, workingStyleEffects] = await Promise.all([
      fetchGovernanceActions({ status: statusFilter }),
      fetchEvolutionGovernanceSnapshot(),
      fetchEvolutionPendingApprovals(),
      fetchWorkingStyleEffects(),
      fetchEvolutionSurfaces(),
    ]);
    const agentIds = [
      ...workingStyleEffects.map((item) => item.agentId),
      ...pendingApprovals.map((item) => item.runtimeAgentId),
      ...Object.values(evolution?.skillAutoJobs ?? {}).map((job) => job.agentId),
    ];
    const patternCandidates = await fetchPatternCandidatesForAgents(agentIds);
    this.actions = actions;
    this.evolution = evolution;
    this.pendingApprovals = pendingApprovals;
    this.patternCandidates = patternCandidates;
    this.isLoading = false;
  }

  private async onApprovePattern(row: PatternCandidateGovernanceRow) {
    const key = `approve:${row.agentId}:${row.candidateId}`;
    this.patternActionBusyKey = key;
    await approvePatternCandidate({
      agentId: row.agentId,
      candidateId: row.candidateId,
      autoInstallIntent: this.approveWithAutoInstall,
    });
    await this.loadActions();
    this.patternActionBusyKey = null;
  }

  private async onEnrollSkillAuto(row: PatternCandidateGovernanceRow) {
    const key = `enroll:${row.agentId}:${row.candidateId}`;
    this.patternActionBusyKey = key;
    await enrollSkillAutoInstall({
      candidateId: row.candidateId,
      agentId: row.agentId,
    });
    await this.loadActions();
    this.patternActionBusyKey = null;
  }

  private async onCancelSkillAuto(candidateId: string) {
    const key = `cancel-auto:${candidateId}`;
    this.patternActionBusyKey = key;
    await cancelSkillAutoInstall({ candidateId, reason: "ui-cancel" });
    await this.loadActions();
    this.patternActionBusyKey = null;
  }

  private async onToggleKillSwitch() {
    if (!this.evolution || this.killSwitchBusy) {
      return;
    }
    this.killSwitchBusy = true;
    const next = !this.evolution.killSwitch;
    const ok = await setEvolutionKillSwitch(next);
    this.manualActionMessage = ok
      ? `Kill switch 已${next ? "开启" : "关闭"}`
      : "Kill switch 切换失败（需平台管理员 operator.admin）";
    await this.loadActions();
    this.killSwitchBusy = false;
  }

  private skillAutoJobEntries(): SkillAutoInstallJobRow[] {
    const jobs = this.evolution?.skillAutoJobs ?? {};
    return Object.values(jobs).toSorted((a, b) =>
      String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")),
    );
  }

  private async onRejectPattern(row: PatternCandidateGovernanceRow) {
    const key = `reject:${row.agentId}:${row.candidateId}`;
    this.patternActionBusyKey = key;
    await rejectPatternCandidate({ agentId: row.agentId, candidateId: row.candidateId });
    await this.loadActions();
    this.patternActionBusyKey = null;
  }

  private async onPublishPatternDraft(row: PatternCandidateGovernanceRow) {
    const key = `publish:${row.agentId}:${row.candidateId}`;
    this.patternActionBusyKey = key;
    await publishPatternDraftSkill({
      agentId: row.agentId,
      candidateId: row.candidateId,
      sourceAgentId: row.agentId,
    });
    await this.loadActions();
    this.patternActionBusyKey = null;
  }

  private async onResolveApproval(
    agentId: string,
    decision: "resume" | "hold" | "clear_limit" | "clear_redirect",
  ) {
    await resolveEvolutionApproval(agentId, decision, `ui:${decision}`);
    await this.loadActions();
  }

  private async onHumanResume(agentId: string) {
    await humanResumeEvolutionAgent(agentId, "ui-human-resume");
    await this.loadActions();
  }

  private async onHumanHold(agentId: string) {
    await humanHoldEvolutionAgent(agentId, "ui-human-hold");
    await this.loadActions();
  }

  private async onClearLimit(agentId: string) {
    await clearEvolutionLimit(agentId);
    await this.loadActions();
  }

  private async onClearRedirect(agentId: string) {
    await clearEvolutionRedirect(agentId);
    await this.loadActions();
  }

  private async onApplyManualLimit() {
    const agentId = this.manualRuntimeAgentId.trim();
    if (!agentId) {
      this.manualActionMessage = "请输入 runtimeAgentId";
      return;
    }
    const ok = await applyEvolutionLimit(agentId, "ui-manual-limit");
    this.manualActionMessage = ok
      ? `已对 ${agentId} 施加限流`
      : `限流失败（需 operator.approvals）`;
    await this.loadActions();
  }

  private async onApplyManualRedirect() {
    const agentId = this.manualRuntimeAgentId.trim();
    const target = this.manualRedirectTarget.trim();
    if (!agentId || !target) {
      this.manualActionMessage = "请输入 runtimeAgentId 与目标 Agent";
      return;
    }
    const ok = await applyEvolutionRedirect(agentId, target, "ui-manual-redirect");
    this.manualActionMessage = ok
      ? `已将 ${agentId} 重定向到 ${target}`
      : `重定向失败（需 operator.approvals）`;
    await this.loadActions();
  }

  private setFilter(status: GovernanceActionStatus | null) {
    this.filterStatus = status;
    void this.loadActions();
  }

  private async executeAction(actionId: string) {
    await executePendingAction(actionId);
    await this.loadActions();
  }

  private getActionLabel(action: string): string {
    const labels: Record<string, string> = {
      pause: "暂停",
      resume: "恢复",
      limit: "限制",
      redirect: "重定向",
      notify_admin: "通知管理员",
      mark_risk: "标记风险",
      recommend_optimization: "推荐优化",
    };
    return labels[action] || action;
  }

  private renderEvolutionPanel() {
    const evo = this.evolution;
    if (!evo) {
      return html`
        <div class="evolution-panel">
          <h2>Evolution 运行时治理</h2>
          <div class="evo-meta">未连接 Gateway 或 evolution-governance.snapshot 不可用</div>
        </div>
      `;
    }
    const openEffects = (evo.effectVerifications ?? []).filter((e) => e.status === "open");
    const limitKeys = Object.keys(evo.limits ?? {});
    const redirectEntries = Object.entries(evo.redirects ?? {});
    const writeDenied = new Set(evo.sharedAgentWriteDenied ?? []);
    const attr = evo.attribution;
    return html`
      <div class="evolution-panel">
        <h2>Evolution 运行时治理</h2>
        <div class="evo-meta">
          <span class="status-badge ${evo.mode === "off" ? "failed" : "executed"}"
            >mode=${evo.mode ?? "assist"}</span
          >
          <span
            class="status-badge ${(evo as { skillAutoEvolution?: boolean }).skillAutoEvolution === true ? "executed" : "failed"}"
            >skill-auto=${
              (evo as { skillAutoEvolution?: boolean }).skillAutoEvolution === true ? "on" : "off"
            }</span
          >
          · killSwitch=${evo.killSwitch ? "ON" : "OFF"}
          · skill-auto jobs=${Object.keys(evo.skillAutoJobs ?? {}).length}
          · open effects=${openEffects.length}
          · pending approvals=${this.pendingApprovals.length}
          · limits=${limitKeys.length}
          · redirects=${redirectEntries.length}
          ${
            attr
              ? html` · attribution ${attr.totalAttributed}/${attr.totalAttributed + attr.totalUnattributed}`
              : ""
          }
        </div>
        <div class="manual-controls">
          <button
            class="action-btn"
            ?disabled=${this.killSwitchBusy}
            @click=${() => void this.onToggleKillSwitch()}
          >
            ${evo.killSwitch ? "关闭 Kill Switch" : "开启 Kill Switch"}
          </button>
          <span class="evo-meta">mode / skill-auto 由环境变量控制（只读）</span>
        </div>
        ${
          redirectEntries.length > 0
            ? html`
                <div class="auto-notice">
                  🔀 重定向生效中：入站会改写到目标 Agent（旧会话历史不迁移）。详见
                  docs/design/evolution-runtime-ops-runbook-2026-07-20.md
                </div>
              `
            : ""
        }
        ${this.renderSkillAutoJobsPanel()}
        <div class="manual-controls">
          <input
            placeholder="runtimeAgentId"
            .value=${this.manualRuntimeAgentId}
            @input=${(event: Event) => {
              this.manualRuntimeAgentId = (event.target as HTMLInputElement).value;
            }}
          />
          <input
            placeholder="redirect targetAgentId"
            .value=${this.manualRedirectTarget}
            @input=${(event: Event) => {
              this.manualRedirectTarget = (event.target as HTMLInputElement).value;
            }}
          />
          <button class="action-btn" @click=${() => void this.onApplyManualLimit()}>施加限流</button>
          <button class="action-btn" @click=${() => void this.onApplyManualRedirect()}>
            施加重定向
          </button>
        </div>
        ${
          this.manualActionMessage
            ? html`<div class="manual-note">${this.manualActionMessage}</div>`
            : ""
        }
        ${this.pendingApprovals.map(
          (item) => html`
            <div class="evo-row">
              <strong>${item.runtimeAgentId}</strong>
              <span class="evo-meta">${item.kind} · ${item.reason}</span>
              ${
                item.requiresPlatformAdmin
                  ? html`
                      <span class="evo-meta">共享 Agent · 需平台管理员</span>
                    `
                  : ""
              }
              ${
                item.actions.includes("human-resume") || item.actions.includes("resume")
                  ? html`<button
                    class="action-btn"
                    @click=${() => this.onResolveApproval(item.runtimeAgentId, "resume")}
                  >
                    批准恢复
                  </button>`
                  : ""
              }
              ${
                item.actions.includes("human-hold") || item.actions.includes("hold")
                  ? html`<button
                    class="action-btn"
                    @click=${() => this.onResolveApproval(item.runtimeAgentId, "hold")}
                  >
                    保持
                  </button>`
                  : ""
              }
              ${
                item.actions.includes("clear-limit")
                  ? html`<button
                    class="action-btn"
                    @click=${() => this.onResolveApproval(item.runtimeAgentId, "clear_limit")}
                  >
                    清除限流
                  </button>`
                  : ""
              }
              ${
                item.actions.includes("clear-redirect")
                  ? html`<button
                    class="action-btn"
                    @click=${() => this.onResolveApproval(item.runtimeAgentId, "clear_redirect")}
                  >
                    取消重定向
                  </button>`
                  : ""
              }
            </div>
          `,
        )}
        ${openEffects.map(
          (effect) => html`
            <div class="evo-row">
              <strong>${effect.runtimeAgentId}</strong>
              <span class="evo-meta">${effect.reason} · ${effect.status}</span>
              ${
                writeDenied.has(effect.runtimeAgentId)
                  ? html`
                      <span class="evo-meta">共享 Agent · 需平台管理员</span>
                    `
                  : html`
                      <button class="action-btn" @click=${() => this.onHumanResume(effect.runtimeAgentId)}>
                        恢复
                      </button>
                      <button class="action-btn" @click=${() => this.onHumanHold(effect.runtimeAgentId)}>
                        保持暂停
                      </button>
                      ${
                        effect.reason.startsWith("limit:")
                          ? html`<button
                              class="action-btn"
                              @click=${() => this.onClearLimit(effect.runtimeAgentId)}
                            >
                              清除限流
                            </button>`
                          : ""
                      }
                    `
              }
            </div>
          `,
        )}
        ${limitKeys.map(
          (agentId) => html`
            <div class="evo-row">
              <strong>${agentId}</strong>
              <span class="evo-meta">限流中</span>
              ${
                writeDenied.has(agentId)
                  ? html`
                      <span class="evo-meta">共享 Agent · 需平台管理员</span>
                    `
                  : html`<button class="action-btn" @click=${() => this.onClearLimit(agentId)}>
                      清除限流
                    </button>`
              }
            </div>
          `,
        )}
        ${redirectEntries.map(
          ([from, rec]) => html`
            <div class="evo-row">
              <strong>${from}</strong>
              <span class="evo-meta">→ ${rec.targetAgentId} · ${rec.reason}</span>
              ${
                writeDenied.has(from)
                  ? html`
                      <span class="evo-meta">共享 Agent · 需平台管理员</span>
                    `
                  : html`<button class="action-btn" @click=${() => this.onClearRedirect(from)}>
                      取消重定向
                    </button>`
              }
            </div>
          `,
        )}
      </div>
    `;
  }

  private renderSkillAutoJobsPanel() {
    const jobs = this.skillAutoJobEntries();
    if (jobs.length === 0) {
      return html``;
    }
    return html`
      <div class="evo-meta" style="margin-top: 8px">Skill-auto 作业</div>
      ${jobs.map(
        (job) => html`
          <div class="evo-row" data-skill-auto-job=${job.candidateId}>
            <strong>${job.candidateId}</strong>
            <span class="evo-meta"
              >${job.agentId} · ${job.stage}${job.skillId ? ` · skill=${job.skillId}` : ""}</span
            >
            ${job.lastError ? html`<span class="evo-meta">err=${job.lastError}</span>` : ""}
            ${job.updatedAt ? html`<span class="evo-meta">${job.updatedAt}</span>` : ""}
            ${
              SKILL_AUTO_ACTIVE_STAGES.has(job.stage) && job.stage !== "health_watch"
                ? html`
                    <button
                      class="action-btn"
                      ?disabled=${this.patternActionBusyKey !== null}
                      @click=${() => void this.onCancelSkillAuto(job.candidateId)}
                    >
                      取消自动安装
                    </button>
                  `
                : ""
            }
          </div>
        `,
      )}
    `;
  }

  private renderPatternCandidatesPanel() {
    const rows = this.patternCandidates;
    const jobByCandidate = new Map(
      this.skillAutoJobEntries().map((job) => [job.candidateId, job] as const),
    );
    if (rows.length === 0) {
      return html`
        <div class="evolution-panel">
          <h2>模式候选 · 技能孵化</h2>
          <div class="evo-meta">暂无待审批的模式候选（需跨独立任务重复证据）</div>
        </div>
      `;
    }
    return html`
      <div class="evolution-panel">
        <h2>模式候选 · 技能孵化</h2>
        <div class="evo-meta">
          人工门：批准（可选自动安装意图）→ enroll / draft · 共 ${rows.length} 条。安装仍需
          skill-auto=on 且 governance=auto。
        </div>
        <label class="checkbox-row">
          <input
            type="checkbox"
            data-testid="approve-with-auto-install"
            .checked=${this.approveWithAutoInstall}
            @change=${(event: Event) => {
              this.approveWithAutoInstall = (event.target as HTMLInputElement).checked;
            }}
          />
          批准后自动安装（autoInstallIntent）
        </label>
        ${rows.map(
          (row) => html`
            <div class="evo-row">
              <strong>${row.suggestedName}</strong>
              <span class="evo-meta"
                >${row.agentId} · ${row.status} · conf=${(row.overallConfidence * 100).toFixed(0)}%
                · n=${row.sampleCount}</span
              >
              <span class="evo-meta">${row.suggestedSummary}</span>
              ${
                row.status === "candidate"
                  ? html`
                      <button
                        class="action-btn"
                        ?disabled=${this.patternActionBusyKey !== null}
                        @click=${() => this.onApprovePattern(row)}
                      >
                        批准
                      </button>
                      <button
                        class="action-btn"
                        ?disabled=${this.patternActionBusyKey !== null}
                        @click=${() => this.onRejectPattern(row)}
                      >
                        驳回
                      </button>
                    `
                  : ""
              }
              ${
                row.status === "approved"
                  ? html`
                      <button
                        class="action-btn"
                        ?disabled=${this.patternActionBusyKey !== null}
                        @click=${() => this.onPublishPatternDraft(row)}
                      >
                        发布 Draft Skill
                      </button>
                      <button
                        class="action-btn"
                        ?disabled=${this.patternActionBusyKey !== null}
                        @click=${() => void this.onEnrollSkillAuto(row)}
                      >
                        登记自动安装
                      </button>
                    `
                  : ""
              }
              ${(() => {
                const job = jobByCandidate.get(row.candidateId);
                if (
                  !job ||
                  !SKILL_AUTO_ACTIVE_STAGES.has(job.stage) ||
                  job.stage === "health_watch"
                ) {
                  return job?.stage ? html`<span class="evo-meta">job=${job.stage}</span>` : html``;
                }
                return html`
                    <button
                      class="action-btn"
                      ?disabled=${this.patternActionBusyKey !== null}
                      @click=${() => void this.onCancelSkillAuto(row.candidateId)}
                    >
                      取消自动安装
                    </button>
                  `;
              })()}
            </div>
          `,
        )}
      </div>
    `;
  }

  render() {
    const autoActions = this.actions.filter((a) => a.trigger === "auto_governance");
    const hasAutoExecuted = autoActions.some((a) => a.status === "executed");

    return html`
      <div class="header">
        <h1>⚙️ 治理操作记录</h1>
      </div>

      <evolution-lineage-panel></evolution-lineage-panel>
      ${this.renderEvolutionPanel()}
      ${this.renderPatternCandidatesPanel()}

      ${
        hasAutoExecuted
          ? html`
          <div class="auto-notice">
            🤖 系统自动执行了 ${autoActions.filter((a) => a.status === "executed").length} 项治理操作
          </div>
        `
          : ""
      }

      <div class="filters">
        <select @change=${(e: Event) => this.setFilter(((e.target as HTMLSelectElement).value as GovernanceActionStatus) || null)}>
          <option value="">所有状态</option>
          <option value="pending">待执行</option>
          <option value="executed">已执行</option>
          <option value="failed">失败</option>
        </select>
      </div>

      <div class="action-list">
        ${this.actions.map(
          (action) => html`
            <div class="action-card">
              <span class="status-badge ${action.status}">${action.status}</span>
              <div class="action-info">
                <div class="action-title">
                  ${this.getActionLabel(action.action)} - ${action.assetName}
                  <span class="trigger-badge ${action.trigger === "auto_governance" ? "auto" : "manual"}">
                    ${action.trigger === "auto_governance" ? "自动" : "手动"}
                  </span>
                </div>
                <div class="action-meta">${action.reason}</div>
              </div>
              ${
                action.status === "pending"
                  ? html`
                  <button class="action-btn" @click=${() => this.executeAction(action.id)}>执行</button>
                `
                  : ""
              }
            </div>
          `,
        )}
      </div>
    `;
  }
}
