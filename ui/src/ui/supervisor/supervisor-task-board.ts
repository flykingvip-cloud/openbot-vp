/**
 * supervisor-task-board.ts — shared Development Supervisor task dashboard (M4.1).
 *
 * Self-fetches via gateway methods and listens for `supervisor.task.event` WS
 * frames relayed as `openbot:supervisor-task-event` on `window`.
 */

import { LitElement, html, nothing } from "lit";
import { property, state } from "lit/decorators.js";
import { formatRelativeTimestamp } from "../format.ts";
import type { GatewayBrowserClient } from "../gateway.ts";
import { GatewayRequestError } from "../gateway.ts";
import { isGatewayReady, resolvePanelError, whenGatewayReady } from "./supervisor-gateway-utils.ts";
import {
  SUPERVISOR_TASK_EVENT,
  type SupervisedTaskSnapshot,
  type SupervisorAuditResponse,
  type SupervisorTaskEventPayload,
  type SupervisorTaskTemplate,
  type SupervisorWorkerDescriptor,
  type SupervisorWorkerHealthRow,
  formatWorkerHealthSummary,
  type SupervisorAcceptanceStep,
  type SupervisorRunnerStatusSnapshot,
  formatSupervisorState,
  formatSupervisorIterationProgress,
  resolveSupervisorStageChip,
  isTerminalSupervisorState,
} from "./supervisor-types.ts";

const MAX_LIVE_EVENTS = 120;

function parseSupervisorTimestampMs(value: string | undefined | null): number | null {
  if (!value?.trim()) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatSupervisorTimestamp(value: string | undefined | null): string {
  const parsed = parseSupervisorTimestampMs(value);
  if (parsed == null) {
    return "—";
  }
  return formatRelativeTimestamp(parsed, { dateFallback: true, fallback: "—" });
}

function formatSupervisorAbsoluteTimestamp(value: string | undefined | null): string {
  const parsed = parseSupervisorTimestampMs(value);
  if (parsed == null) {
    return "—";
  }
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date(parsed));
  } catch {
    return new Date(parsed).toLocaleString();
  }
}

function resolveTaskExecutionTimestamp(task: SupervisedTaskSnapshot): string | undefined {
  const last = task.iterations.at(-1);
  if (isTerminalSupervisorState(task.state)) {
    return last?.endedAt ?? last?.startedAt ?? task.updatedAt ?? task.createdAt;
  }
  return last?.startedAt ?? task.updatedAt ?? task.createdAt;
}

function truncateTaskId(taskId: string): string {
  if (taskId.length <= 18) {
    return taskId;
  }
  return `${taskId.slice(0, 10)}…${taskId.slice(-6)}`;
}

function partitionTasks(tasks: SupervisedTaskSnapshot[]): {
  active: SupervisedTaskSnapshot[];
  history: SupervisedTaskSnapshot[];
} {
  const active: SupervisedTaskSnapshot[] = [];
  const history: SupervisedTaskSnapshot[] = [];
  for (const task of tasks) {
    if (isTerminalSupervisorState(task.state)) {
      history.push(task);
    } else {
      active.push(task);
    }
  }
  return { active, history };
}

function formatTaskRoundLabel(task: SupervisedTaskSnapshot): string {
  return formatSupervisorIterationProgress({
    state: task.state,
    usedRounds: task.iterations.length,
    maxIterations: task.budget.maxIterations,
  });
}

function renderStageChip(state: string) {
  const chip = resolveSupervisorStageChip(state);
  const toneClass =
    chip.tone === "active"
      ? "tone-active"
      : chip.tone === "warn"
        ? "tone-warn"
        : chip.tone === "ok"
          ? "tone-ok"
          : chip.tone === "danger"
            ? "tone-danger"
            : chip.tone === "muted"
              ? "tone-muted"
              : "tone-neutral";
  return html`
    <span class="employee-supervisor-center__stage-chip ${toneClass}" data-stage=${chip.id}>
      ${chip.label}
    </span>
  `;
}

function renderDeliveryLanePanel(task: SupervisedTaskSnapshot) {
  const proj = task.laneProjection;
  if (!proj) {
    return nothing;
  }
  const missing =
    proj.missingKeys?.length > 0 ? proj.missingKeys.join("、") : "无（双钥+match-head 齐全）";
  const weakNote = proj.acceptSealWeak
    ? html`
        <span class="employee-supervisor-center__chip" data-testid="delivery-lane-weak"
          >acceptSeal=weak（单机）</span
        >
      `
    : nothing;
  return html`
    <div
      class="employee-supervisor-center__detail-row"
      data-testid="delivery-lane-panel"
    >
      <dt>交付看板</dt>
      <dd>
        <div class="employee-supervisor-center__chips" style="margin-bottom: 0.35rem">
          <span class="employee-supervisor-center__chip" data-testid="delivery-lane-stage"
            >stage=${proj.stage}</span
          >
          ${
            proj.tipSha
              ? html`<span class="employee-supervisor-center__chip mono" data-testid="delivery-lane-tipsha"
                  >tip ${proj.tipSha.slice(0, 12)}</span
                >`
              : html`
                  <span class="employee-supervisor-center__muted">未绑定 tipSha</span>
                `
          }
          ${weakNote}
        </div>
        <div data-testid="delivery-lane-missing">缺钥：${missing}</div>
        ${
          proj.focusSummary
            ? html`<div
                class="employee-supervisor-center__muted"
                data-testid="delivery-lane-focus"
                style="margin-top: 0.35rem"
              >
                ${proj.focusSummary}
              </div>`
            : nothing
        }
        <div class="employee-supervisor-center__muted" style="margin-top: 0.25rem">
          此为交付阶段投影，≠对话焦点看板（session-task-board）。
        </div>
      </dd>
    </div>
  `;
}

export class SupervisorTaskBoard extends LitElement {
  protected createRenderRoot() {
    return this;
  }

  @property({ attribute: false }) client: GatewayBrowserClient | null = null;
  @property({ type: String }) tenantId = "";
  @property({ type: String }) userId = "";
  @property({ type: String }) seatId = "";
  @property({ type: Boolean }) showCreateForm = false;
  @property({ type: String }) title = "开发监督任务";
  /** When true, connection errors are shown once by the parent shell. */
  @property({ type: Boolean }) connectionManaged = false;
  /** Prefills repo path in the create form (employee default workspace). */
  @property({ type: String }) defaultRepoRoot = "";
  /** Deep-link: auto-select this task after list load. */
  @property({ type: String }) initialTaskId = "";
  @property({ attribute: false })
  onOpenDaibaiForDevTask: (() => void | Promise<void>) | null = null;

  @state() private tasks: SupervisedTaskSnapshot[] = [];
  @state() private selectedId: string | null = null;
  @state() private selectedTask: SupervisedTaskSnapshot | null = null;
  @state() private liveEvents: SupervisorTaskEventPayload[] = [];
  @state() private audit: SupervisorAuditResponse | null = null;
  @state() private auditOpen = false;
  @state() private loading = false;
  @state() private detailLoading = false;
  @state() private auditLoading = false;
  @state() private aborting = false;
  @state() private creating = false;
  @state() private unavailable = false;
  @state() private error: string | null = null;
  @state() private notice: string | null = null;

  @state() private createGoal = "";
  @state() private createRepoRoot = "";
  @state() private createWorkerBackendId = "";
  @state() private createWorkerModel = "";
  @state() private createTemplateId = "repo-auto";
  @state() private createCriteriaConfirmed = false;
  @state() private templates: SupervisorTaskTemplate[] = [];
  @state() private repoAutoTemplateId = "repo-auto";
  @state() private workers: SupervisorWorkerDescriptor[] = [];
  @state() private workerHealth: SupervisorWorkerHealthRow[] = [];
  @state() private createMetaLoading = false;
  @state() private runnerStatus: SupervisorRunnerStatusSnapshot | null = null;

  private loadedOnce = false;
  private createMetaLoaded = false;
  private pollTimer: number | null = null;
  private onSupervisorEvent = (event: Event) => {
    const payload = (event as CustomEvent<SupervisorTaskEventPayload>).detail;
    if (!payload?.taskId) {
      return;
    }
    if (this.selectedId && payload.taskId === this.selectedId) {
      const selected = this.selectedTask;
      const activeRunId =
        selected?.activeRun?.runId?.trim() || selected?.iterations.at(-1)?.runId?.trim() || "";
      const eventRunId = payload.runId?.trim() || payload.progress?.runId?.trim() || "";
      // Drop stale-round events when we already know the authoritative run id.
      if (activeRunId && eventRunId && eventRunId !== activeRunId) {
        return;
      }
      this.liveEvents = [...this.liveEvents, payload].slice(-MAX_LIVE_EVENTS);
    }
    this.tasks = this.tasks.map((task) =>
      task.taskId === payload.taskId
        ? {
            ...task,
            state: (payload.state as SupervisedTaskSnapshot["state"]) ?? task.state,
            updatedAt: payload.at,
          }
        : task,
    );
  };

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener(SUPERVISOR_TASK_EVENT, this.onSupervisorEvent);
    if (this.client) {
      void this.loadList();
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener(SUPERVISOR_TASK_EVENT, this.onSupervisorEvent);
    this.stopPolling();
  }

  updated(changed: Map<string, unknown>) {
    if (changed.has("client") && this.client && !this.loadedOnce) {
      void this.loadList();
    }
    if (changed.has("client") && isGatewayReady(this.client) && this.loadedOnce) {
      void this.loadList();
    }
    if (changed.has("client") && this.client && this.showCreateForm && !this.createMetaLoaded) {
      void this.loadCreateMeta();
    }
    if (
      changed.has("showCreateForm") &&
      this.showCreateForm &&
      this.client &&
      !this.createMetaLoaded
    ) {
      void this.loadCreateMeta();
    }
    if (changed.has("selectedId")) {
      if (this.selectedId) {
        void this.loadDetail(this.selectedId);
        this.startPolling();
      } else {
        this.stopPolling();
        this.selectedTask = null;
        this.liveEvents = [];
        this.audit = null;
      }
    }
    if (changed.has("initialTaskId") && this.initialTaskId.trim() && this.tasks.length > 0) {
      this.applyInitialTaskSelection();
    }
  }

  private applyInitialTaskSelection() {
    const taskId = this.initialTaskId.trim();
    if (!taskId) {
      return;
    }
    if (this.tasks.some((task) => task.taskId === taskId)) {
      this.selectedId = taskId;
    }
  }

  private startPolling() {
    this.stopPolling();
    if (!this.selectedId || !this.client) {
      return;
    }
    this.pollTimer = window.setInterval(() => {
      if (this.selectedId && !isTerminalSupervisorState(this.selectedTask?.state ?? "")) {
        void this.loadDetail(this.selectedId, { quiet: true });
      }
    }, 8000);
  }

  private stopPolling() {
    if (this.pollTimer !== null) {
      window.clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async loadList() {
    if (!this.client) {
      return;
    }
    if (!(await whenGatewayReady(this.client))) {
      return;
    }
    this.loadedOnce = true;
    this.loading = true;
    this.error = null;
    this.unavailable = false;
    try {
      const params: Record<string, string> = {};
      const tenant = this.tenantId.trim();
      const user = this.userId.trim();
      if (tenant) {
        params.tenantId = tenant;
      }
      if (user) {
        params.userId = user;
      }
      const result = await this.client.request<{ tasks: SupervisedTaskSnapshot[] }>(
        "supervisor.task.list",
        params,
      );
      this.tasks = (result.tasks ?? []).toSorted(
        (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
      );
      this.applyInitialTaskSelection();
      await this.loadRunnerStatus();
    } catch (err) {
      if (err instanceof GatewayRequestError && err.gatewayCode === "UNAVAILABLE") {
        this.unavailable = true;
        this.tasks = [];
      } else {
        this.error = resolvePanelError(err, { connectionManaged: this.connectionManaged });
      }
    } finally {
      this.loading = false;
    }
  }

  private async loadRunnerStatus() {
    if (!this.client || this.unavailable) {
      this.runnerStatus = null;
      return;
    }
    try {
      this.runnerStatus = await this.client.request<SupervisorRunnerStatusSnapshot>(
        "supervisor.runner.status",
        {},
      );
    } catch {
      this.runnerStatus = null;
    }
  }

  private async loadCreateMeta() {
    if (!this.client || !this.showCreateForm) {
      return;
    }
    if (!(await whenGatewayReady(this.client))) {
      return;
    }
    this.createMetaLoading = true;
    try {
      const [templateResult, workerResult, healthResult] = await Promise.all([
        this.client.request<{ templates: SupervisorTaskTemplate[]; repoAutoTemplateId: string }>(
          "supervisor.template.list",
          {},
        ),
        this.client.request<{ workers: SupervisorWorkerDescriptor[] }>(
          "supervisor.worker.list",
          {},
        ),
        this.client.request<{ workers: SupervisorWorkerHealthRow[] }>(
          "supervisor.worker.health",
          this.tenantId.trim() ? { tenantId: this.tenantId.trim() } : {},
        ),
      ]);
      this.templates = templateResult.templates ?? [];
      this.repoAutoTemplateId = templateResult.repoAutoTemplateId ?? "repo-auto";
      this.workers = workerResult.workers ?? [];
      this.workerHealth = healthResult.workers ?? [];
      if (!this.createWorkerBackendId && this.workers[0]) {
        this.createWorkerBackendId = this.workers[0].backendId;
        this.createWorkerModel = this.workers[0].models[0] ?? "";
      }
      if (this.createWorkerBackendId) {
        this.emitSelectedWorkerChange(this.createWorkerBackendId);
      }
      if (!this.createTemplateId) {
        this.createTemplateId = this.repoAutoTemplateId;
      }
      if (!this.createRepoRoot.trim() && this.defaultRepoRoot.trim()) {
        this.createRepoRoot = this.defaultRepoRoot.trim();
      }
      this.createMetaLoaded = true;
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    } finally {
      this.createMetaLoading = false;
    }
  }

  private selectedWorker(): SupervisorWorkerDescriptor | null {
    return this.workers.find((w) => w.backendId === this.createWorkerBackendId) ?? null;
  }

  private selectedWorkerHealth(): SupervisorWorkerHealthRow | null {
    return this.workerHealth.find((row) => row.backendId === this.createWorkerBackendId) ?? null;
  }

  private selectedTemplatePreview(): SupervisorAcceptanceStep[] {
    if (this.createTemplateId === this.repoAutoTemplateId) {
      return [];
    }
    return this.templates.find((t) => t.id === this.createTemplateId)?.acceptance.steps ?? [];
  }

  private emitSelectedWorkerChange(backendId: string) {
    this.dispatchEvent(
      new CustomEvent("supervisor-worker-change", {
        detail: { workerBackendId: backendId },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private onWorkerBackendChange(backendId: string) {
    this.createWorkerBackendId = backendId;
    const worker = this.workers.find((w) => w.backendId === backendId);
    this.createWorkerModel = worker?.models[0] ?? "";
    this.emitSelectedWorkerChange(backendId);
  }

  private async loadDetail(taskId: string, opts?: { quiet?: boolean }) {
    if (!this.client) {
      return;
    }
    if (!opts?.quiet) {
      this.detailLoading = true;
    }
    this.error = null;
    try {
      const task = await this.client.request<SupervisedTaskSnapshot>("supervisor.task.get", {
        taskId,
      });
      this.selectedTask = task;
      await this.client.request("supervisor.task.subscribe", { taskId });
      if (!opts?.quiet) {
        this.liveEvents = [];
        this.audit = null;
        this.auditOpen = false;
      }
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    } finally {
      this.detailLoading = false;
    }
  }

  private async loadAudit() {
    if (!this.client || !this.selectedId) {
      return;
    }
    this.auditLoading = true;
    this.error = null;
    try {
      this.audit = await this.client.request<SupervisorAuditResponse>("supervisor.task.audit", {
        taskId: this.selectedId,
        limit: 50,
      });
      this.auditOpen = true;
      this.notice = "审计报告已加载，见下方「审计摘要」。";
      await this.updateComplete;
      this.querySelector(".employee-supervisor-center__audit")?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    } finally {
      this.auditLoading = false;
    }
  }

  private async abortSelected() {
    if (!this.client || !this.selectedId || this.aborting) {
      return;
    }
    if (!window.confirm("确定要中止此监督任务吗？")) {
      return;
    }
    this.aborting = true;
    this.error = null;
    try {
      const next = await this.client.request<SupervisedTaskSnapshot>("supervisor.task.abort", {
        taskId: this.selectedId,
      });
      this.selectedTask = next;
      this.notice = "任务已中止。";
      await this.loadList();
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    } finally {
      this.aborting = false;
    }
  }

  private async createTask() {
    if (!this.client || this.creating) {
      return;
    }
    const goal = this.createGoal.trim();
    const repoRoot = this.createRepoRoot.trim();
    const workerBackendId = this.createWorkerBackendId.trim();
    if (!goal || !repoRoot || !workerBackendId) {
      this.error = "请填写目标、仓库路径并选择 Worker 后端。";
      return;
    }
    if (!this.createCriteriaConfirmed) {
      this.error = "请先确认 AcceptanceCriteria（怎样算完成）。";
      return;
    }
    this.creating = true;
    this.error = null;
    this.notice = null;
    try {
      const created = await this.client.request<SupervisedTaskSnapshot>("supervisor.task.create", {
        goal,
        repoRoot,
        workerBackendId,
        templateId: this.createTemplateId || this.repoAutoTemplateId,
        ...(this.createWorkerModel.trim() ? { workerModel: this.createWorkerModel.trim() } : {}),
        ...(this.tenantId.trim() ? { tenantId: this.tenantId.trim() } : {}),
        ...(this.userId.trim() ? { userId: this.userId.trim() } : {}),
        ...(this.seatId.trim() ? { seatId: this.seatId.trim() } : {}),
      });
      this.notice = `已创建任务 ${created.taskId}`;
      this.createGoal = "";
      await this.loadList();
      this.selectedId = created.taskId;
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    } finally {
      this.creating = false;
    }
  }

  private selectTask(taskId: string) {
    this.selectedId = taskId;
  }

  private closeDetail() {
    this.selectedId = null;
  }

  private renderNotice(error: string | null, notice: string | null) {
    return html`
      ${error ? html`<div class="employee-supervisor-center__banner is-error">${error}</div>` : nothing}
      ${notice ? html`<div class="employee-supervisor-center__banner is-success">${notice}</div>` : nothing}
    `;
  }

  private renderCreateForm() {
    if (!this.showCreateForm) {
      return nothing;
    }
    const worker = this.selectedWorker();
    const workerHealth = this.selectedWorkerHealth();
    const templateSteps = this.selectedTemplatePreview();
    return html`
      <section class="employee-supervisor-center__composer">
        <div class="employee-supervisor-center__composer-head">
          <span class="employee-supervisor-center__section-label">新建</span>
        </div>
        ${
          this.createMetaLoading
            ? html`
                <p class="employee-supervisor-center__muted">加载配置…</p>
              `
            : nothing
        }
        ${
          !this.createMetaLoading && this.workers.length === 0
            ? html`
                <div class="employee-supervisor-center__banner is-warn">
                  未找到可用 Worker 后端。请先在协作工具配置 CLI 后端。
                </div>
              `
            : nothing
        }
        <div class="employee-supervisor-center__form employee-supervisor-center__form-grid">
          <label class="employee-supervisor-center__field employee-supervisor-center__form-span">
            <span>1. 目标</span>
            <textarea
              rows="2"
              placeholder="例如：为用户模块增加分页查询接口"
              .value=${this.createGoal}
              @input=${(e: Event) => {
                this.createGoal = (e.target as HTMLTextAreaElement).value;
              }}
            ></textarea>
          </label>
          <label class="employee-supervisor-center__field">
            <span>2. 怎样算完成（验收模板）</span>
            <select
              .value=${this.createTemplateId}
              @change=${(e: Event) => {
                this.createTemplateId = (e.target as HTMLSelectElement).value;
                this.createCriteriaConfirmed = false;
              }}
            >
              <option value=${this.repoAutoTemplateId}>自动探测（repo scripts）</option>
              ${this.templates.map(
                (template) => html`
                  <option value=${template.id}>${template.label}</option>
                `,
              )}
            </select>
          </label>
          <div class="employee-supervisor-center__acceptance-panel employee-supervisor-center__form-span" data-testid="create-acceptance-criteria">
            <div class="employee-supervisor-center__section-label">AcceptanceCriteria（必确认）</div>
            ${
              templateSteps.length > 0
                ? html`
                    <div class="employee-supervisor-center__chips">
                      ${templateSteps.map(
                        (step) => html`
                          <span class="employee-supervisor-center__chip mono">${step.id}${step.required ? " *" : ""} · ${(step.argv ?? []).join(" ") || "—"}</span>
                        `,
                      )}
                    </div>
                  `
                : html`
                    <p class="employee-supervisor-center__muted">
                      将按仓库
                      <span class="mono">package.json</span> scripts（test/lint/build）自动规划机检步骤；后端拒绝空
                      criteria。
                    </p>
                  `
            }
            <label class="employee-supervisor-center__criteria-confirm">
              <input
                type="checkbox"
                .checked=${this.createCriteriaConfirmed}
                @change=${(e: Event) => {
                  this.createCriteriaConfirmed = (e.target as HTMLInputElement).checked;
                }}
              />
              我确认以上 AcceptanceCriteria 作为唯一验收标准（ValidationReport.passed → accepted）
            </label>
          </div>
          <label class="employee-supervisor-center__field">
            <span>3. 谁来写（Worker）</span>
            <div class="employee-supervisor-center__field-inline">
              <select
                class="mono"
                .value=${this.createWorkerBackendId}
                @change=${(e: Event) => {
                  this.onWorkerBackendChange((e.target as HTMLSelectElement).value);
                }}
              >
                ${this.workers.map(
                  (entry) => html`
                    <option value=${entry.backendId}>${entry.backendId}</option>
                  `,
                )}
              </select>
              ${
                workerHealth
                  ? html`
                      <span class="employee-supervisor-center__chip employee-supervisor-center__chip--health ${workerHealth.auth.authenticated ? "tone-ok" : "tone-warn"}">
                        <span class="employee-supervisor-center__status-dot"></span>
                        ${formatWorkerHealthSummary(workerHealth)}
                      </span>
                    `
                  : nothing
              }
            </div>
          </label>
          ${
            worker && worker.models.length > 0
              ? html`
                  <label class="employee-supervisor-center__field">
                    <span>模型</span>
                    <select
                      class="mono"
                      .value=${this.createWorkerModel}
                      @change=${(e: Event) => {
                        this.createWorkerModel = (e.target as HTMLSelectElement).value;
                      }}
                    >
                      ${worker.models.map(
                        (model) => html`
                          <option value=${model}>${model}</option>
                        `,
                      )}
                    </select>
                  </label>
                `
              : nothing
          }
          <label class="employee-supervisor-center__field employee-supervisor-center__form-span">
            <span>4. 仓库路径 / 边界</span>
            <input
              class="mono"
              .value=${this.createRepoRoot}
              @input=${(e: Event) => {
                this.createRepoRoot = (e.target as HTMLInputElement).value;
              }}
            />
          </label>
        </div>
        <div class="employee-supervisor-center__composer-foot">
          <button
            class="btn btn--primary btn--sm"
            ?disabled=${this.creating || this.workers.length === 0 || !this.createCriteriaConfirmed}
            @click=${() => this.createTask()}
          >
            ${this.creating ? "创建中…" : "创建并启动"}
          </button>
        </div>
      </section>
    `;
  }

  private stateTone(state: string): string {
    const terminal = isTerminalSupervisorState(state);
    if (terminal) {
      return state === "accepted"
        ? "tone-ok"
        : state === "escalated"
          ? "tone-warn"
          : state === "aborted"
            ? "tone-muted"
            : state === "failed"
              ? "tone-danger"
              : "tone-muted";
    }
    return state === "executing" || state === "validating" || state === "fixing"
      ? "tone-active"
      : state === "dispatched"
        ? "tone-warn"
        : "tone-neutral";
  }

  private renderTaskRow(task: SupervisedTaskSnapshot, terminal: boolean) {
    return html`
      <li>
        <button
          type="button"
          class="employee-supervisor-center__list-item ${terminal ? "is-terminal" : "is-active"}"
          @click=${() => this.selectTask(task.taskId)}
        >
          <span class="employee-supervisor-center__status ${this.stateTone(task.state)}">
            <span class="employee-supervisor-center__status-dot"></span>
            <span class="employee-supervisor-center__status-text">${formatSupervisorState(task.state)}</span>
          </span>
          <span class="employee-supervisor-center__list-copy">
            <span class="employee-supervisor-center__list-title">${task.goal}</span>
            <span class="employee-supervisor-center__list-meta mono">
              ${task.worker.backendId} · ${truncateTaskId(task.taskId)}
            </span>
          </span>
          <span class="employee-supervisor-center__list-side">
            ${renderStageChip(task.state)}
            <span class="employee-supervisor-center__list-rounds" data-testid="task-round-label">
              ${formatTaskRoundLabel(task)}
            </span>
            <span class="employee-supervisor-center__list-time" title=${formatSupervisorAbsoluteTimestamp(resolveTaskExecutionTimestamp(task))}>
              ${formatSupervisorTimestamp(resolveTaskExecutionTimestamp(task))}
            </span>
          </span>
        </button>
      </li>
    `;
  }

  private renderTaskGroup(tasks: SupervisedTaskSnapshot[], terminal: boolean) {
    if (tasks.length === 0) {
      return nothing;
    }
    return html`
      <div class="employee-supervisor-center__list-group">
        <ul class="employee-supervisor-center__list">
          ${tasks.map((task) => this.renderTaskRow(task, terminal))}
        </ul>
      </div>
    `;
  }

  private renderTaskList() {
    if (this.unavailable) {
      return html`
        <section class="employee-supervisor-center__empty">
          <div class="employee-supervisor-center__empty-title">
            <svg
              viewBox="0 0 24 24"
              width="40"
              height="40"
              aria-hidden="true"
              class="employee-supervisor-center__empty-icon"
            >
              <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.6" fill="none" />
              <path d="M12 8v4M12 16h0" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
            </svg>
          </div>
          <div class="employee-supervisor-center__empty-title">监督子系统未启用</div>
          <p class="employee-supervisor-center__empty-copy">
            请设置 <span class="mono">OPENBOT_SUPERVISOR_ENABLED=1</span> 或
            <span class="mono">gateway.supervisor.enabled=true</span>，并确保 Fabric 已启用。
          </p>
        </section>
      `;
    }
    if (this.tasks.length === 0 && !this.loading) {
      const emptyHint = this.showCreateForm
        ? "可在上方表单手动创建，或让大白根据开发目标代为发起。"
        : "确认企业岗位并完成环境准备后，即可在这里创建受监督任务。";
      return html`
        <section class="employee-supervisor-center__tasks">
          <header class="employee-supervisor-center__tasks-head">
            <span class="employee-supervisor-center__section-label">任务记录</span>
          </header>
          <div class="employee-supervisor-center__empty employee-supervisor-center__empty--tasks">
            <div class="employee-supervisor-center__empty-title">暂无任务</div>
            <p class="employee-supervisor-center__empty-copy">${emptyHint}</p>
            ${
              this.onOpenDaibaiForDevTask
                ? html`
                    <div class="employee-supervisor-center__empty-actions">
                      <button
                        type="button"
                        class="btn btn--sm btn--primary"
                        @click=${() => void this.onOpenDaibaiForDevTask?.()}
                      >
                        去大白创建
                      </button>
                    </div>
                  `
                : nothing
            }
          </div>
        </section>
      `;
    }
    const { active, history } = partitionTasks(this.tasks);
    return html`
      <section class="employee-supervisor-center__tasks">
        <header class="employee-supervisor-center__tasks-head">
          <span class="employee-supervisor-center__section-label">B2 · 今日监督队列</span>
          <span class="employee-supervisor-center__tasks-count">${active.length}</span>
        </header>
        ${this.renderTaskGroup(active, false)}
        ${
          history.length > 0
            ? html`
                <details class="employee-supervisor-center__history">
                  <summary class="employee-supervisor-center__section-label">
                    D · 历史与审计（${history.length}）
                  </summary>
                  ${this.renderTaskGroup(history, true)}
                </details>
              `
            : nothing
        }
      </section>
    `;
  }

  private renderDetailPanel() {
    if (!this.selectedId) {
      return nothing;
    }
    const task = this.selectedTask;
    return html`
      <section class="employee-workbench__creator-panel employee-supervisor-center__panel">
        <header class="employee-workbench__creator-panel-head">
          <button
            type="button"
            class="employee-workbench__creator-panel-back"
            @click=${() => this.closeDetail()}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M15 5l-7 7 7 7"></path>
            </svg>
            返回任务列表
          </button>
          <div class="employee-workbench__creator-panel-copy">
            <div class="employee-workbench__creator-panel-title">
              ${task?.goal ?? "任务详情"}
            </div>
            ${
              task
                ? html`
                    <div class="employee-supervisor-center__panel-meta">
                      ${renderStageChip(task.state)}
                      <span class="mono">${task.worker.backendId}</span>
                      <span data-testid="task-round-label">${formatTaskRoundLabel(task)}</span>
                      ${
                        task.activeRun?.runId
                          ? html`<span class="mono" title="权威 Run ID">run ${truncateTaskId(task.activeRun.runId)}</span>`
                          : task.iterations.at(-1)?.runId
                            ? html`<span class="mono" title="权威 Run ID">run ${truncateTaskId(task.iterations.at(-1)!.runId!)}</span>`
                            : nothing
                      }
                      <span class="mono">${truncateTaskId(task.taskId)}</span>
                    </div>
                  `
                : html`
                    <div class="employee-workbench__creator-panel-sub mono">${this.selectedId}</div>
                  `
            }
          </div>
          <div class="employee-supervisor-center__panel-actions">
            ${
              task && !isTerminalSupervisorState(task.state)
                ? html`
                    <button
                      class="btn btn--sm btn--danger"
                      ?disabled=${this.aborting}
                      @click=${() => this.abortSelected()}
                    >
                      ${this.aborting ? "中止中…" : "中止"}
                    </button>
                  `
                : nothing
            }
            <button
              class="btn btn--sm"
              ?disabled=${this.auditLoading}
              @click=${() => this.loadAudit()}
            >
              ${this.auditLoading ? "加载审计…" : "审计报告"}
            </button>
          </div>
        </header>
        <div class="employee-workbench__creator-body employee-supervisor-center__panel-body">
          ${
            this.detailLoading && !task
              ? html`
                  <p class="employee-supervisor-center__muted">加载中…</p>
                `
              : task
                ? html`
                    <dl class="employee-supervisor-center__detail-stack">
                      <div class="employee-supervisor-center__detail-row">
                        <dt>仓库</dt>
                        <dd class="mono">${task.repoRoot}</dd>
                      </div>
                      <div class="employee-supervisor-center__detail-row" data-testid="detail-acceptance">
                        <dt>验收标准</dt>
                        <dd>
                          ${
                            task.acceptance?.steps?.length
                              ? html`
                                  <div class="employee-supervisor-center__chips">
                                    ${task.acceptance.steps.map(
                                      (step) => html`
                                        <span class="employee-supervisor-center__chip mono">${step.id}${step.required ? " *" : ""}</span>
                                      `,
                                    )}
                                  </div>
                                `
                              : html`
                                  <span class="employee-supervisor-center__muted">—</span>
                                `
                          }
                        </dd>
                      </div>
                      ${renderDeliveryLanePanel(task)}
                      <div class="employee-supervisor-center__detail-row">
                        <dt>成本</dt>
                        <dd class="employee-supervisor-center__cost">$${task.budget.spentCostUsd.toFixed(4)}</dd>
                      </div>
                      <div class="employee-supervisor-center__detail-row">
                        <dt>创建</dt>
                        <dd title=${formatSupervisorAbsoluteTimestamp(task.createdAt)}>
                          ${formatSupervisorTimestamp(task.createdAt)}
                        </dd>
                      </div>
                      <div class="employee-supervisor-center__detail-row">
                        <dt>最近更新</dt>
                        <dd title=${formatSupervisorAbsoluteTimestamp(task.updatedAt)}>
                          ${formatSupervisorTimestamp(task.updatedAt)}
                        </dd>
                      </div>
                      ${
                        isTerminalSupervisorState(task.state)
                          ? html`
                              <div class="employee-supervisor-center__detail-row">
                                <dt>完成</dt>
                                <dd
                                  title=${formatSupervisorAbsoluteTimestamp(
                                    task.iterations.at(-1)?.endedAt ?? task.updatedAt,
                                  )}
                                >
                                  ${formatSupervisorTimestamp(
                                    task.iterations.at(-1)?.endedAt ?? task.updatedAt,
                                  )}
                                </dd>
                              </div>
                            `
                          : nothing
                      }
                    </dl>
                  `
                : nothing
          }
          <div class="employee-supervisor-center__section-title">实时进度</div>
          <div class="employee-supervisor-center__log mono">
            ${
              this.liveEvents.length === 0
                ? html`
                    <div class="employee-supervisor-center__log-empty">等待进度事件…</div>
                  `
                : this.liveEvents.map(
                    (event) => html`
                      <div class="employee-supervisor-center__log-line">
                        <span class="employee-supervisor-center__log-ts">${event.at}</span>
                        <span class="employee-supervisor-center__log-type">[${event.type}]</span>
                        ${event.summary ? html`<span class="employee-supervisor-center__log-summary"> ${event.summary}</span>` : nothing}
                        ${
                          event.progress?.data
                            ? html`<div class="employee-supervisor-center__log-data">${event.progress.data}</div>`
                            : nothing
                        }
                      </div>
                    `,
                  )
            }
          </div>
          ${
            this.audit
              ? html`
                  <details class="employee-supervisor-center__audit" ?open=${this.auditOpen}>
                    <summary class="employee-supervisor-center__section-title">
                      审计摘要 · ${this.audit.fabricRecords.length + this.audit.usageAttribution.length + this.audit.reportEvents.length} 条
                    </summary>
                    <div class="employee-supervisor-center__audit-chips">
                      <span class="employee-supervisor-center__chip employee-supervisor-center__chip--audit">Fabric ${this.audit.fabricRecords.length}</span>
                      <span class="employee-supervisor-center__chip employee-supervisor-center__chip--audit">Usage ${this.audit.usageAttribution.length}</span>
                      <span class="employee-supervisor-center__chip employee-supervisor-center__chip--audit">Report ${this.audit.reportEvents.length}</span>
                    </div>
                    ${
                      this.audit.reportEvents.length > 0
                        ? html`
                            <div class="employee-supervisor-center__audit-events mono">
                              ${this.audit.reportEvents.map(
                                (event) => html`
                                  <div class="employee-supervisor-center__audit-line">
                                    ${JSON.stringify(event)}
                                  </div>
                                `,
                              )}
                            </div>
                          `
                        : html`
                            <p class="employee-supervisor-center__muted">
                              暂无结构化报告事件；可在上方「实时进度」查看执行轨迹。
                            </p>
                          `
                    }
                  </details>
                `
              : nothing
          }
        </div>
      </section>
    `;
  }

  private renderListShell() {
    return html`
      <section class="employee-supervisor-center__shell">
        <header class="employee-supervisor-center__head">
          <div class="employee-supervisor-center__head-copy">
            <div class="employee-supervisor-center__section-label">${this.title}</div>
            <div class="employee-supervisor-center__muted" data-testid="supervisor-board-kind-hint">
              开发监督任务看板（含可选「交付看板」投影；≠对话焦点看板）
            </div>
          </div>
          <button
            class="btn btn--sm"
            ?disabled=${this.loading || !isGatewayReady(this.client)}
            @click=${() => this.loadList()}
          >
            ${this.loading ? "刷新中…" : "刷新"}
          </button>
        </header>
        ${this.renderNotice(this.error, this.notice)}
        ${this.renderCreateForm()}
        ${this.renderTaskList()}
      </section>
    `;
  }

  render() {
    if (this.selectedId) {
      return html`
        <div class="employee-supervisor-center employee-supervisor-center--panel">
          ${this.renderNotice(this.error, this.notice)}
          ${this.renderDetailPanel()}
        </div>
      `;
    }
    return html`
      <div class="employee-supervisor-center">${this.renderListShell()}</div>
    `;
  }
}

if (!customElements.get("supervisor-task-board")) {
  customElements.define("supervisor-task-board", SupervisorTaskBoard);
}

declare global {
  interface HTMLElementTagNameMap {
    "supervisor-task-board": SupervisorTaskBoard;
  }
}
