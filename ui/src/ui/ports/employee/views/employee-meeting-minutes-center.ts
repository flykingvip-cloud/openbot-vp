/**
 * employee-meeting-minutes-center — 「我的任务 → 会议纪要」.
 *
 * Organizer path for the post-meeting half: start → attach MinutesDraft action
 * items (`meeting.minute`) → `meeting.distribute`. Fan-out lands on each
 * assignee's「待我处理」only when the meeting has a spaceId and the assignee is
 * an attendee.
 */

import { html, nothing } from "lit";
import { LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { Meeting, MeetingStatus } from "../../../capability/meeting-lifecycle/endpoints.ts";
import {
  createMeetingLifecycleGateway,
  type MeetingLifecycleGateway,
} from "../../../capability/meeting-lifecycle/gateway-client.ts";
import type { GatewayBrowserClient } from "../../../gateway.ts";

export type EmployeeMeetingMinutesCenterProps = {
  client: GatewayBrowserClient | null;
};

type DraftItem = { title: string; assigneeUserId: string; dueAt: string };

const VISIBLE_STATUS = new Set<MeetingStatus>([
  "confirmed",
  "reminded",
  "in_progress",
  "minuted",
  "distributed",
]);

const STATUS_LABEL: Record<string, string> = {
  confirmed: "已确认",
  reminded: "会前提醒",
  in_progress: "进行中",
  minuted: "纪要待分发",
  distributed: "已分发",
};

function emptyItem(assigneeUserId = ""): DraftItem {
  return { title: "", assigneeUserId, dueAt: "" };
}

@customElement("employee-meeting-minutes-center")
export class EmployeeMeetingMinutesCenter extends LitElement {
  protected createRenderRoot() {
    return this;
  }

  @property({ attribute: false }) minutesProps: EmployeeMeetingMinutesCenterProps | null = null;
  @state() private meetings: Meeting[] = [];
  @state() private selectedId: string | null = null;
  @state() private summary = "";
  @state() private decisions = "";
  @state() private transcript = "";
  @state() private items: DraftItem[] = [];
  @state() private loading = false;
  @state() private busy = false;
  @state() private error: string | null = null;
  @state() private notice: string | null = null;

  private seedKey = "";

  connectedCallback() {
    super.connectedCallback();
    void this.refresh();
  }

  updated(changed: Map<string, unknown>) {
    if (changed.has("minutesProps")) {
      void this.refresh();
    }
  }

  private gateway(): MeetingLifecycleGateway | null {
    const client = this.minutesProps?.client ?? null;
    if (!client) {
      return null;
    }
    return createMeetingLifecycleGateway(client);
  }

  private visibleMeetings(): Meeting[] {
    return this.meetings.filter((meeting) => VISIBLE_STATUS.has(meeting.status));
  }

  private selectedMeeting(): Meeting | undefined {
    return this.visibleMeetings().find((meeting) => meeting.id === this.selectedId);
  }

  private seedFrom(meeting: Meeting) {
    this.summary = meeting.minutes?.summary ?? "";
    this.decisions = (meeting.minutes?.decisions ?? []).join("\n");
    const seeded = (meeting.minutes?.actionItems ?? []).map((item) => ({
      title: item.title,
      assigneeUserId: item.assigneeUserId ?? "",
      dueAt: item.dueAt ?? "",
    }));
    if (seeded.length === 0 && meeting.status === "in_progress") {
      const assignee =
        meeting.attendees.find((attendee) => attendee.role !== "organizer")?.userId ??
        meeting.attendees[0]?.userId ??
        "";
      this.items = [emptyItem(assignee)];
    } else {
      this.items = seeded;
    }
    this.transcript = "";
  }

  private syncSelection() {
    const visible = this.visibleMeetings();
    if (!visible.some((meeting) => meeting.id === this.selectedId)) {
      this.selectedId = visible[0]?.id ?? null;
    }
    const meeting = this.selectedMeeting();
    const key = meeting ? `${meeting.id}:${meeting.status}:${meeting.updatedAt}` : "";
    if (key !== this.seedKey) {
      this.seedKey = key;
      if (meeting) {
        this.seedFrom(meeting);
      }
    }
  }

  private async refresh() {
    const gw = this.gateway();
    if (!gw) {
      this.meetings = [];
      this.selectedId = null;
      return;
    }
    this.loading = true;
    this.error = null;
    try {
      const res = await gw.listMeetings();
      this.meetings = Array.isArray(res.meetings) ? res.meetings : [];
      this.syncSelection();
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
      this.meetings = [];
    } finally {
      this.loading = false;
    }
  }

  private select(meeting: Meeting) {
    this.selectedId = meeting.id;
    this.seedKey = "";
    this.notice = null;
    this.error = null;
    this.syncSelection();
  }

  private draftMinutes() {
    const actionItems = this.items
      .map((item) => ({
        title: item.title.trim(),
        assigneeUserId: item.assigneeUserId.trim(),
        dueAt: item.dueAt.trim(),
      }))
      .filter((item) => item.title.length > 0)
      .map((item) => ({
        kind: "task" as const,
        title: item.title,
        ...(item.assigneeUserId ? { assigneeUserId: item.assigneeUserId } : {}),
        ...(item.dueAt ? { dueAt: item.dueAt } : {}),
      }));
    return {
      kind: "minutes_draft" as const,
      summary: this.summary.trim(),
      decisions: this.decisions
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
      actionItems,
    };
  }

  private async start(meeting: Meeting) {
    const gw = this.gateway();
    if (!gw || this.busy) {
      return;
    }
    this.busy = true;
    this.error = null;
    this.notice = null;
    try {
      await gw.startMeeting(meeting.id);
      this.notice = "会议已开始，可以记录纪要。";
      await this.refresh();
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    } finally {
      this.busy = false;
    }
  }

  private async generate(meeting: Meeting) {
    const gw = this.gateway();
    const transcript = this.transcript.trim();
    if (!gw || this.busy || !transcript) {
      return;
    }
    this.busy = true;
    this.error = null;
    this.notice = null;
    try {
      const res = await gw.generateMeetingMinutes({
        meetingId: meeting.id,
        transcript,
      });
      if (res.status === "produced") {
        this.summary = res.draft.summary;
        this.decisions = res.draft.decisions.join("\n");
        this.items = res.draft.actionItems.map((item) => ({
          title: item.title,
          assigneeUserId: item.assigneeUserId ?? "",
          dueAt: item.dueAt ?? "",
        }));
        this.notice = "已生成纪要草案。确认后点「记录纪要」，再分发到待我处理。";
        return;
      }
      if (res.status === "unavailable") {
        this.error = "纪要模型未配置。请直接填写摘要和行动项。";
        return;
      }
      const message = "message" in res ? res.message : undefined;
      this.error = message || "纪要生成没有产出可用草案。";
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    } finally {
      this.busy = false;
    }
  }

  private async minute(meeting: Meeting) {
    const gw = this.gateway();
    const draft = this.draftMinutes();
    const missingAssignee = this.items.some(
      (item) => item.title.trim().length > 0 && !item.assigneeUserId.trim(),
    );
    if (!gw || this.busy || !draft.summary) {
      return;
    }
    if (missingAssignee) {
      this.error = "每条行动项都要选择参会人，否则不会进入待我处理。";
      return;
    }
    this.busy = true;
    this.error = null;
    this.notice = null;
    try {
      await gw.minuteMeeting({ id: meeting.id, minutes: draft });
      this.notice = meeting.spaceId
        ? "纪要已记录。确认行动项后分发，受派人会在「待我处理」看到。"
        : "纪要已记录。此会议没有协作空间，分发不会写入「待我处理」。";
      await this.refresh();
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    } finally {
      this.busy = false;
    }
  }

  private async distribute(meeting: Meeting) {
    const gw = this.gateway();
    if (!gw || this.busy) {
      return;
    }
    this.busy = true;
    this.error = null;
    this.notice = null;
    try {
      const res = await gw.distributeMeeting(meeting.id);
      const count = res.taskCount ?? 0;
      this.notice =
        count > 0
          ? `已分发 ${count} 条行动项。受派人打开「待我处理」即可接受。`
          : "没有写出任务。需要协作空间，且行动项受派人必须是参会人。";
      await this.refresh();
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    } finally {
      this.busy = false;
    }
  }

  private renderItem(meeting: Meeting, index: number) {
    const item = this.items[index];
    if (!item) {
      return nothing;
    }
    const locked = meeting.status !== "in_progress";
    return html`
      <div class="employee-meeting-minutes__row">
        <input
          class="employee-workbench__settings-input"
          name="action-title"
          placeholder="行动项"
          .value=${item.title}
          ?disabled=${locked || this.busy}
          @input=${(event: Event) => {
            const next = [...this.items];
            const row = next[index];
            if (!row) {
              return;
            }
            next[index] = { ...row, title: (event.target as HTMLInputElement).value };
            this.items = next;
          }}
        />
        <select
          class="employee-workbench__settings-input"
          name="action-assignee"
          .value=${item.assigneeUserId}
          ?disabled=${locked || this.busy}
          @change=${(event: Event) => {
            const next = [...this.items];
            const row = next[index];
            if (!row) {
              return;
            }
            next[index] = { ...row, assigneeUserId: (event.target as HTMLSelectElement).value };
            this.items = next;
          }}
        >
          <option value="">受派人</option>
          ${meeting.attendees.map(
            (attendee) => html`
              <option value=${attendee.userId}>${attendee.userId}</option>
            `,
          )}
        </select>
      </div>
    `;
  }

  private renderEditor(meeting: Meeting) {
    const canEdit = meeting.status === "in_progress";
    const rosterNote = meeting.spaceId
      ? `协作空间 ${meeting.spaceId}`
      : "未绑定协作空间，分发不会进入待我处理";
    return html`
      <section class="employee-meeting-minutes__editor">
        <p class="employee-supervisor-center__muted">
          ${meeting.title} · ${STATUS_LABEL[meeting.status] ?? meeting.status} · ${rosterNote}
        </p>
        ${
          meeting.status === "confirmed"
            ? html`
                <p class="employee-supervisor-center__muted">
                  会前提醒发出后可以开始。开始后记录行动项，再分发到参会人的待我处理。
                </p>
              `
            : nothing
        }
        ${
          meeting.status === "reminded"
            ? html`
                <button
                  type="button"
                  class="btn primary"
                  ?disabled=${this.busy}
                  @click=${() => void this.start(meeting)}
                >
                  开始会议
                </button>
              `
            : nothing
        }
        ${
          canEdit
            ? html`
                <label class="employee-meeting-minutes__field">
                  <span class="employee-supervisor-center__muted">会议记录（可选，用于生成草案）</span>
                  <textarea
                    class="employee-workbench__settings-input"
                    name="transcript"
                    rows="3"
                    .value=${this.transcript}
                    ?disabled=${this.busy}
                    @input=${(event: Event) => {
                      this.transcript = (event.target as HTMLTextAreaElement).value;
                    }}
                  ></textarea>
                </label>
                <button
                  type="button"
                  class="btn"
                  ?disabled=${this.busy || !this.transcript.trim()}
                  @click=${() => void this.generate(meeting)}
                >
                  生成纪要草案
                </button>
              `
            : nothing
        }
        ${
          canEdit || meeting.status === "minuted" || meeting.status === "distributed"
            ? html`
                <label class="employee-meeting-minutes__field">
                  <span class="employee-supervisor-center__muted">摘要</span>
                  <input
                    class="employee-workbench__settings-input"
                    name="summary"
                    .value=${this.summary}
                    ?disabled=${!canEdit || this.busy}
                    @input=${(event: Event) => {
                      this.summary = (event.target as HTMLInputElement).value;
                    }}
                  />
                </label>
                <label class="employee-meeting-minutes__field">
                  <span class="employee-supervisor-center__muted">决议（一行一条）</span>
                  <textarea
                    class="employee-workbench__settings-input"
                    name="decisions"
                    rows="2"
                    .value=${this.decisions}
                    ?disabled=${!canEdit || this.busy}
                    @input=${(event: Event) => {
                      this.decisions = (event.target as HTMLTextAreaElement).value;
                    }}
                  ></textarea>
                </label>
                <div class="employee-meeting-minutes__stack">
                  ${this.items.map((_item, index) => this.renderItem(meeting, index))}
                </div>
                ${
                  canEdit
                    ? html`
                        <button
                          type="button"
                          class="btn"
                          ?disabled=${this.busy}
                          @click=${() => {
                            const assignee =
                              meeting.attendees.find((attendee) => attendee.role !== "organizer")
                                ?.userId ?? "";
                            this.items = [...this.items, emptyItem(assignee)];
                          }}
                        >
                          添加行动项
                        </button>
                        <button
                          type="button"
                          class="btn primary"
                          name="minute"
                          ?disabled=${this.busy || !this.summary.trim()}
                          @click=${() => void this.minute(meeting)}
                        >
                          记录纪要
                        </button>
                      `
                    : nothing
                }
              `
            : nothing
        }
        ${
          meeting.status === "minuted"
            ? html`
                <button
                  type="button"
                  class="btn primary"
                  name="distribute"
                  ?disabled=${this.busy}
                  @click=${() => void this.distribute(meeting)}
                >
                  分发到待我处理
                </button>
              `
            : nothing
        }
      </section>
    `;
  }

  render() {
    const client = this.minutesProps?.client ?? null;
    if (!client) {
      return html`
        <div class="employee-workbench__settings-manage-empty">会议纪要视图不可用（未连接 Gateway）。</div>
      `;
    }
    const visible = this.visibleMeetings();
    const selected = this.selectedMeeting();
    return html`
      <div class="employee-meeting-minutes">
        <header class="employee-supervisor-center__toolbar">
          <p class="employee-supervisor-center__toolbar-copy">
            记录会议行动项并分发。受派人必须是参会人，会议需要协作空间，任务才会出现在对方的待我处理。
          </p>
          <button type="button" class="btn" ?disabled=${this.loading} @click=${() => void this.refresh()}>
            ${this.loading ? "刷新中…" : "刷新"}
          </button>
        </header>
        ${this.error ? html`<div class="employee-supervisor-center__banner is-error">${this.error}</div>` : nothing}
        ${this.notice ? html`<div class="employee-supervisor-center__banner is-success">${this.notice}</div>` : nothing}
        ${
          visible.length === 0
            ? html`
                <p class="employee-supervisor-center__muted">
                  ${this.loading ? "加载中…" : "没有可整理纪要的会议。"}
                </p>
              `
            : html`
                <ul class="employee-supervisor-center__list">
                  ${visible.map(
                    (meeting) => html`
                      <li>
                        <button
                          type="button"
                          class="btn ${meeting.id === this.selectedId ? "primary" : ""}"
                          @click=${() => this.select(meeting)}
                        >
                          ${meeting.title} · ${STATUS_LABEL[meeting.status] ?? meeting.status}
                        </button>
                      </li>
                    `,
                  )}
                </ul>
                ${selected ? this.renderEditor(selected) : nothing}
              `
        }
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "employee-meeting-minutes-center": EmployeeMeetingMinutesCenter;
  }
}

export function renderEmployeeMeetingMinutesCenter(props: EmployeeMeetingMinutesCenterProps) {
  return html`<employee-meeting-minutes-center .minutesProps=${props}></employee-meeting-minutes-center>`;
}
