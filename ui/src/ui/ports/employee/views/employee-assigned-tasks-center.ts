/**
 * employee-assigned-tasks-center — 「我的任务 → 待我处理」.
 *
 * Lists human-assignee TaskAssignments via task.list (hard assignee match) and
 * exposes accept / complete. Reuses supervisor-center visual classes for parity.
 */

import { html, nothing } from "lit";
import { LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type {
  TaskAssignment,
  TaskAssignmentStatus,
} from "../../../capability/meeting-lifecycle/endpoints.ts";
import {
  createMeetingLifecycleGateway,
  type MeetingLifecycleGateway,
} from "../../../capability/meeting-lifecycle/gateway-client.ts";
import type { GatewayBrowserClient } from "../../../gateway.ts";

export type EmployeeAssignedTasksCenterProps = {
  client: GatewayBrowserClient | null;
};

const STATUS_LABEL: Record<TaskAssignmentStatus, string> = {
  pending: "待接受",
  accepted: "已接受",
  running: "进行中",
  completed: "已完成",
  rejected: "已拒绝",
};

function statusTone(status: TaskAssignmentStatus): string {
  switch (status) {
    case "pending":
      return "tone-warn";
    case "accepted":
    case "running":
      return "tone-ok";
    case "completed":
      return "tone-muted";
    case "rejected":
      return "tone-warn";
    default:
      return "tone-muted";
  }
}

function formatDue(dueAt?: string): string {
  if (!dueAt?.trim()) {
    return "";
  }
  try {
    return new Date(dueAt).toLocaleString();
  } catch {
    return dueAt;
  }
}

@customElement("employee-assigned-tasks-center")
export class EmployeeAssignedTasksCenter extends LitElement {
  protected createRenderRoot() {
    return this;
  }

  @property({ attribute: false }) assignedProps: EmployeeAssignedTasksCenterProps | null = null;
  @state() private tasks: TaskAssignment[] = [];
  @state() private loading = false;
  @state() private error: string | null = null;
  @state() private notice: string | null = null;
  @state() private busyId: string | null = null;

  private loadedForClient: GatewayBrowserClient | null = null;

  connectedCallback() {
    super.connectedCallback();
    void this.refresh();
  }

  updated(changed: Map<string, unknown>) {
    if (changed.has("assignedProps")) {
      void this.refresh();
    }
  }

  private gateway(): MeetingLifecycleGateway | null {
    const client = this.assignedProps?.client ?? null;
    if (!client) {
      return null;
    }
    return createMeetingLifecycleGateway(client);
  }

  private async refresh() {
    const gw = this.gateway();
    const client = this.assignedProps?.client ?? null;
    if (!gw || !client) {
      this.tasks = [];
      this.loadedForClient = null;
      return;
    }
    this.loading = true;
    this.error = null;
    try {
      const res = await gw.listTasks();
      this.tasks = Array.isArray(res.tasks) ? res.tasks : [];
      this.loadedForClient = client;
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
      this.tasks = [];
    } finally {
      this.loading = false;
    }
  }

  private async accept(task: TaskAssignment) {
    const gw = this.gateway();
    if (!gw || this.busyId) {
      return;
    }
    this.busyId = task.id;
    this.error = null;
    this.notice = null;
    try {
      await gw.acceptTask({ organizationId: task.organizationId, id: task.id });
      this.notice = "已接受任务";
      await this.refresh();
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    } finally {
      this.busyId = null;
    }
  }

  private async complete(task: TaskAssignment) {
    const gw = this.gateway();
    if (!gw || this.busyId) {
      return;
    }
    this.busyId = task.id;
    this.error = null;
    this.notice = null;
    try {
      await gw.completeTask({ organizationId: task.organizationId, id: task.id });
      this.notice = "已完成任务";
      await this.refresh();
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    } finally {
      this.busyId = null;
    }
  }

  private renderRow(task: TaskAssignment) {
    const busy = this.busyId === task.id;
    const due = formatDue(task.dueAt);
    const source =
      task.sourceRef?.kind === "meeting" ? `会议 ${task.sourceRef.id}` : task.organizationId;
    const canAccept = task.status === "pending";
    const canComplete = task.status === "accepted" || task.status === "running";
    return html`
      <li class="employee-supervisor-center__list-item is-active">
        <span class="employee-supervisor-center__status ${statusTone(task.status)}">
          <span class="employee-supervisor-center__status-dot"></span>
          <span class="employee-supervisor-center__status-text"
            >${STATUS_LABEL[task.status] ?? task.status}</span
          >
        </span>
        <span class="employee-supervisor-center__list-copy">
          <strong>${task.title}</strong>
          <span class="employee-supervisor-center__muted"
            >${source}${due ? ` · 截止 ${due}` : ""}</span
          >
        </span>
        <span class="employee-supervisor-center__list-side">
          ${
            canAccept
              ? html`
                  <button
                    type="button"
                    class="btn primary"
                    ?disabled=${busy}
                    @click=${() => void this.accept(task)}
                  >
                    ${busy ? "处理中…" : "接受"}
                  </button>
                `
              : nothing
          }
          ${
            canComplete
              ? html`
                  <button
                    type="button"
                    class="btn"
                    ?disabled=${busy}
                    @click=${() => void this.complete(task)}
                  >
                    ${busy ? "处理中…" : "完成"}
                  </button>
                `
              : nothing
          }
        </span>
      </li>
    `;
  }

  render() {
    const client = this.assignedProps?.client ?? null;
    if (!client) {
      return html`
        <div class="employee-workbench__settings-manage-empty">
          待我处理任务视图不可用（未连接 Gateway）。
        </div>
      `;
    }

    const open = this.tasks.filter(
      (task) =>
        task.status === "pending" || task.status === "accepted" || task.status === "running",
    );
    const done = this.tasks.filter(
      (task) => task.status === "completed" || task.status === "rejected",
    );

    return html`
      <div class="employee-supervisor-center">
        <header class="employee-supervisor-center__toolbar">
          <p class="employee-supervisor-center__toolbar-copy">
            会议与协作指派给你的任务（仅本人可见，需接受后完成）。
          </p>
          <button type="button" class="btn" ?disabled=${this.loading} @click=${() => void this.refresh()}>
            ${this.loading ? "刷新中…" : "刷新"}
          </button>
        </header>
        ${
          this.error
            ? html`<div class="employee-supervisor-center__banner is-error">${this.error}</div>`
            : nothing
        }
        ${
          this.notice
            ? html`<div class="employee-supervisor-center__banner is-success">${this.notice}</div>`
            : nothing
        }
        ${
          this.loading && this.loadedForClient !== client
            ? html`
                <p class="employee-supervisor-center__muted">加载中…</p>
              `
            : nothing
        }
        ${
          !this.loading && this.tasks.length === 0
            ? html`
                <div class="employee-workbench__settings-manage-empty">
                  暂无指派给你的任务。会议纪要分发后，行动项会出现在这里。
                </div>
              `
            : nothing
        }
        ${
          open.length > 0
            ? html`
                <section class="employee-supervisor-center__section">
                  <span class="employee-supervisor-center__section-label">进行中</span>
                  <ul class="employee-supervisor-center__list">
                    ${open.map((task) => this.renderRow(task))}
                  </ul>
                </section>
              `
            : nothing
        }
        ${
          done.length > 0
            ? html`
                <section class="employee-supervisor-center__section">
                  <span class="employee-supervisor-center__section-label">已结束</span>
                  <ul class="employee-supervisor-center__list">
                    ${done.map((task) => this.renderRow(task))}
                  </ul>
                </section>
              `
            : nothing
        }
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "employee-assigned-tasks-center": EmployeeAssignedTasksCenter;
  }
}

export function renderEmployeeAssignedTasksCenter(props: EmployeeAssignedTasksCenterProps) {
  return html`<employee-assigned-tasks-center
    .assignedProps=${props}
  ></employee-assigned-tasks-center>`;
}
