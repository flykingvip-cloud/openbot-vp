import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { GatewayBrowserClient } from "../../../gateway.ts";
import "../../../../styles/platform-monitor-task.css";
import {
  applyMonitorSchedule,
  describeMonitorTask,
  emptyMonitorSnapshot,
  getMonitorJobReport,
  inferRunTrigger,
  monitorErrorMessage,
  pauseMonitorTask,
  resumeMonitorTask,
  runMonitorTask,
  type MonitorScheduleInput,
  type MonitorTaskSnapshot,
} from "./api.ts";
import {
  downloadTextFile,
  monitorReportFilename,
  monitorReportFromJob,
  renderMonitorMachineYaml,
  renderMonitorReportMarkdown,
  renderMonitorReportYaml,
  type MonitorReportDocument,
} from "./monitor-report.ts";
import {
  renderPlatformMonitorTask,
  type MonitorAgentOption,
  type MonitorDraft,
  type MonitorGroupOption,
  type MonitorTenantOption,
  type PlatformMonitorTaskState,
} from "./view.ts";

@customElement("openbot-platform-monitor-task")
export class OpenBotPlatformMonitorTask extends LitElement {
  @property({ attribute: false }) client: GatewayBrowserClient | null = null;
  @property({ attribute: false }) tenants: MonitorTenantOption[] = [];
  @property({ attribute: false }) agents: MonitorAgentOption[] = [];
  @property({ attribute: false }) groups: MonitorGroupOption[] = [];

  @state() private tenantQuery = "";
  @state() private tenantMenuOpen = false;
  @state() private selectedTenantId: string | null = null;
  @state() private loadedAgents: MonitorAgentOption[] = [];
  @state() private loadedGroups: MonitorGroupOption[] = [];
  @state() private agentQuery = "";
  @state() private snapshot: MonitorTaskSnapshot | null = null;
  @state() private mode: PlatformMonitorTaskState["mode"] = "overview";
  @state() private draft: MonitorDraft = emptyDraft();
  @state() private report: MonitorReportDocument | null = null;
  @state() private notice: string | null = null;
  @state() private permission: PlatformMonitorTaskState["permission"] = "allowed";
  @state() private busy = false;
  @state() private manualRunIds: string[] = [];

  createRenderRoot() {
    return this;
  }

  private agentOptions(): MonitorAgentOption[] {
    return this.agents.length > 0 ? this.agents : this.loadedAgents;
  }

  private groupOptions(): MonitorGroupOption[] {
    return this.groups.length > 0 ? this.groups : this.loadedGroups;
  }

  private selectedRoundId(): string | null {
    const groupId = this.draft.groupId;
    if (!groupId) {
      return null;
    }
    return this.groupOptions().find((row) => row.groupId === groupId)?.roundId ?? null;
  }

  private scheduleInput(): MonitorScheduleInput | null {
    if (!this.selectedTenantId) {
      return null;
    }
    const useAgents = this.draft.scopeAgents;
    const useGroup = this.draft.scopeGroups;
    return {
      tenantId: this.selectedTenantId,
      cadence: this.draft.cadence,
      agentIds: useAgents ? this.draft.agentIds : [],
      groupId: useGroup ? this.draft.groupId : null,
      roundId: useGroup ? this.selectedRoundId() : null,
      failureMinCount: this.draft.failureMinCount,
      efficiencyMaxTotalMs: this.draft.efficiencyMaxTotalMs,
    };
  }

  private async reload() {
    const client = this.client;
    const tenantId = this.selectedTenantId;
    if (!client?.connected || !tenantId) {
      this.snapshot = tenantId ? emptyMonitorSnapshot() : null;
      return;
    }
    try {
      const described = await describeMonitorTask(client, tenantId);
      this.snapshot = described;
      this.draft = draftFromSnapshot(described);
      this.permission = "allowed";
      await this.loadRoster(client, tenantId);
    } catch (err) {
      this.applyError(err);
    }
  }

  private async loadRoster(client: GatewayBrowserClient, tenantId: string) {
    if (this.agents.length > 0 && this.groups.length > 0) {
      return;
    }
    try {
      const payload = await client.request<{
        agents?: Array<{
          id?: string;
          name?: string | null;
          identity?: { name?: string | null } | null;
        }>;
      }>("mesh.ownership.list", { tenantId });
      if (this.agents.length === 0) {
        this.loadedAgents = (payload.agents ?? [])
          .map((row) => {
            const agentId = row.id?.trim() ?? "";
            if (!agentId) {
              return null;
            }
            return {
              agentId,
              label: row.identity?.name?.trim() || row.name?.trim() || agentId,
            };
          })
          .filter((row): row is MonitorAgentOption => row != null);
      }
    } catch {
      if (this.agents.length === 0) {
        this.loadedAgents = [];
      }
    }
  }

  private applyError(err: unknown) {
    const message = monitorErrorMessage(err);
    if (
      message.includes("forged_tenant") ||
      message.includes("unauthorized") ||
      message.includes("membership_required") ||
      message.includes("无权")
    ) {
      this.permission = "forbidden";
      this.notice = "无权该租户";
      return;
    }
    if (message.includes("paused_blocks_new_run")) {
      this.notice = "任务已暂停";
      return;
    }
    if (message.includes("report_not_found")) {
      this.notice = "报告不存在";
      return;
    }
    this.notice = message || "操作没有完成";
  }

  private async selectTenant(tenantId: string) {
    if (!this.tenants.some((row) => row.tenantId === tenantId)) {
      return;
    }
    this.selectedTenantId = tenantId;
    this.tenantMenuOpen = false;
    this.tenantQuery = "";
    this.mode = "overview";
    this.report = null;
    this.notice = null;
    this.permission = "allowed";
    this.manualRunIds = [];
    await this.reload();
  }

  private async save() {
    const client = this.client;
    const input = this.scheduleInput();
    if (!client?.connected || !input) {
      this.notice = client?.connected ? "先选租户" : "未连接";
      return;
    }
    this.busy = true;
    try {
      await applyMonitorSchedule(client, input);
      await this.reload();
      this.mode = "overview";
      this.notice = null;
    } catch (err) {
      this.applyError(err);
    } finally {
      this.busy = false;
    }
  }

  private async pauseOrResume(kind: "pause" | "resume") {
    const client = this.client;
    const tenantId = this.selectedTenantId;
    if (!client?.connected || !tenantId) {
      return;
    }
    this.busy = true;
    try {
      if (kind === "pause") {
        await pauseMonitorTask(client, tenantId);
      } else {
        await resumeMonitorTask(client, tenantId);
      }
      await this.reload();
      this.notice = null;
    } catch (err) {
      this.applyError(err);
    } finally {
      this.busy = false;
    }
  }

  private async runNow() {
    const client = this.client;
    const input = this.scheduleInput();
    if (!client?.connected || !input || !this.snapshot?.hasDefinition) {
      this.notice = "先保存监测任务";
      return;
    }
    if (this.snapshot.paused) {
      this.notice = "任务已暂停";
      return;
    }
    this.busy = true;
    try {
      const started = await runMonitorTask(client, input);
      if (started) {
        this.manualRunIds = [...this.manualRunIds, started.runId];
      }
      await this.reload();
      this.notice = null;
    } catch (err) {
      this.applyError(err);
    } finally {
      this.busy = false;
    }
  }

  private async openReport(runId: string) {
    const client = this.client;
    const tenantId = this.selectedTenantId;
    const run = this.snapshot?.runs.find((row) => row.runId === runId);
    if (!client?.connected || !tenantId || !run?.reportId || !this.snapshot) {
      this.notice = "报告不存在";
      return;
    }
    this.busy = true;
    try {
      const report = await getMonitorJobReport(client, tenantId, run.reportId);
      const tenantLabel = this.tenants.find((row) => row.tenantId === tenantId)?.label ?? tenantId;
      this.report = monitorReportFromJob({
        tenantLabel,
        cadence: this.snapshot.cadence,
        trigger: inferRunTrigger(this.snapshot.cadence, new Set(this.manualRunIds), runId),
        roundId: this.selectedRoundId(),
        window: { start: run.startedAt, end: run.finishedAt ?? run.startedAt },
        report,
      });
      this.mode = "report";
      this.notice = null;
    } catch (err) {
      this.applyError(err);
    } finally {
      this.busy = false;
    }
  }

  private exportReport(format: "md" | "yaml") {
    const doc = this.report;
    if (!doc) {
      return;
    }
    const contents =
      format === "md" ? renderMonitorReportMarkdown(doc) : renderMonitorReportYaml(doc);
    const mime = format === "md" ? "text/markdown;charset=utf-8" : "application/yaml;charset=utf-8";
    downloadTextFile(monitorReportFilename(doc, format), contents, mime);
  }

  private async copyMachine() {
    const doc = this.report;
    if (!doc) {
      return;
    }
    const text = renderMonitorMachineYaml(doc);
    try {
      await navigator.clipboard.writeText(text);
      this.notice = "已复制机器可读块";
    } catch {
      this.notice = "复制失败";
    }
  }

  render() {
    const manual = new Set(this.manualRunIds);
    const snapshot = this.snapshot;
    const runs = (snapshot?.runs ?? []).map((run) => ({
      ...run,
      trigger: inferRunTrigger(snapshot?.cadence ?? "off", manual, run.runId),
    }));
    return html`
      ${renderPlatformMonitorTask(
        {
          tenants: this.tenants,
          tenantQuery: this.tenantQuery,
          tenantMenuOpen: this.tenantMenuOpen,
          selectedTenantId: this.selectedTenantId,
          agents: this.agentOptions(),
          groups: this.groupOptions(),
          agentQuery: this.agentQuery,
          snapshot,
          runs,
          mode: this.mode,
          draft: this.draft,
          report: this.report,
          notice: this.notice,
          permission: this.permission,
          busy: this.busy,
        },
        {
          onTenantQuery: (value) => {
            this.tenantQuery = value;
          },
          onTenantMenu: (open) => {
            this.tenantMenuOpen = open;
          },
          onSelectTenant: (tenantId) => {
            void this.selectTenant(tenantId);
          },
          onClearTenant: () => {
            this.selectedTenantId = null;
            this.snapshot = null;
            this.mode = "overview";
            this.report = null;
            this.draft = emptyDraft();
            this.notice = null;
          },
          onEdit: () => {
            if (this.snapshot) {
              this.draft = draftFromSnapshot(this.snapshot);
            }
            this.mode = "edit";
          },
          onCancelEdit: () => {
            if (this.snapshot) {
              this.draft = draftFromSnapshot(this.snapshot);
            }
            this.mode = "overview";
          },
          onSave: () => {
            void this.save();
          },
          onCadence: (value) => {
            this.draft = { ...this.draft, cadence: value };
          },
          onToggleScope: (scope) => {
            if (scope === "all") {
              this.draft = { ...this.draft, scopeAll: !this.draft.scopeAll };
            } else if (scope === "agents") {
              this.draft = { ...this.draft, scopeAgents: !this.draft.scopeAgents };
            } else {
              this.draft = { ...this.draft, scopeGroups: !this.draft.scopeGroups };
            }
          },
          onAgentQuery: (value) => {
            this.agentQuery = value;
          },
          onToggleAgent: (agentId) => {
            if (!this.agentOptions().some((row) => row.agentId === agentId)) {
              return;
            }
            const has = this.draft.agentIds.includes(agentId);
            this.draft = {
              ...this.draft,
              scopeAgents: true,
              agentIds: has
                ? this.draft.agentIds.filter((id) => id !== agentId)
                : [...this.draft.agentIds, agentId],
            };
          },
          onGroup: (groupId) => {
            if (groupId && !this.groupOptions().some((row) => row.groupId === groupId)) {
              return;
            }
            this.draft = { ...this.draft, groupId: groupId || null };
          },
          onFailureThreshold: (value) => {
            this.draft = { ...this.draft, failureMinCount: value };
          },
          onEfficiencyThreshold: (value) => {
            this.draft = { ...this.draft, efficiencyMaxTotalMs: value };
          },
          onPause: () => {
            void this.pauseOrResume("pause");
          },
          onResume: () => {
            void this.pauseOrResume("resume");
          },
          onRun: () => {
            void this.runNow();
          },
          onOpenReport: (runId) => {
            void this.openReport(runId);
          },
          onCloseReport: () => {
            this.mode = "overview";
            this.report = null;
          },
          onExport: (format) => this.exportReport(format),
          onCopyMachine: () => {
            void this.copyMachine();
          },
        },
      )}
    `;
  }
}

function emptyDraft(): MonitorDraft {
  return {
    cadence: "off",
    scopeAll: true,
    scopeAgents: false,
    scopeGroups: false,
    agentIds: [],
    groupId: null,
    failureMinCount: null,
    efficiencyMaxTotalMs: null,
  };
}

function draftFromSnapshot(snapshot: MonitorTaskSnapshot): MonitorDraft {
  return {
    cadence: snapshot.cadence,
    scopeAll: true,
    scopeAgents: snapshot.agentIds.length > 0,
    scopeGroups: Boolean(snapshot.groupId),
    agentIds: [...snapshot.agentIds],
    groupId: snapshot.groupId,
    failureMinCount: snapshot.failureMinCount,
    efficiencyMaxTotalMs: snapshot.efficiencyMaxTotalMs,
  };
}

declare global {
  interface HTMLElementTagNameMap {
    "openbot-platform-monitor-task": OpenBotPlatformMonitorTask;
  }
}
