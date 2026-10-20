// @vitest-environment jsdom
import { html, render } from "lit";
import { afterEach, describe, expect, it } from "vitest";
import type { Meeting } from "../../../capability/meeting-lifecycle/endpoints.ts";
import "./employee-meeting-minutes-center.ts";
import { renderModuleContentPage } from "./workbench-stage-module.ts";

const inProgress = {
  id: "m1",
  organizerUserId: "user-1",
  spaceId: "space-a",
  title: "周会",
  startAtMs: 1,
  timezone: "UTC",
  status: "in_progress",
  attendees: [
    { userId: "user-1", role: "organizer" },
    { userId: "user-2", role: "required" },
  ],
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
} as Meeting;

const minuted = {
  ...inProgress,
  status: "minuted",
  updatedAt: "2026-07-01T01:00:00.000Z",
  minutes: {
    kind: "minutes_draft",
    summary: "ship v1",
    decisions: ["ship"],
    actionItems: [{ kind: "task", title: "draft spec", assigneeUserId: "user-2" }],
  },
} as Meeting;

afterEach(() => {
  document.body.innerHTML = "";
});

function clientFor(meetings: Meeting[]) {
  const calls: Array<{ method: string; params: unknown }> = [];
  const client = {
    request: async (method: string, params: unknown) => {
      calls.push({ method, params });
      if (method === "meeting.list") {
        return { meetings };
      }
      if (method === "meeting.minute") {
        return { meeting: { ...inProgress, status: "minuted" } };
      }
      if (method === "meeting.distribute") {
        return { meeting: { ...minuted, status: "distributed" }, taskCount: 1, scheduledCount: 0 };
      }
      if (method === "meeting.generate-minutes") {
        return { status: "unavailable", reason: "model runner not configured" };
      }
      throw new Error(`unexpected ${method}`);
    },
  };
  return { client, calls };
}

async function mount(meetings: Meeting[]) {
  const { client, calls } = clientFor(meetings);
  const host = document.createElement("div");
  document.body.append(host);
  render(
    html`<employee-meeting-minutes-center
      .minutesProps=${{ client }}
    ></employee-meeting-minutes-center>`,
    host,
  );
  const el = host.querySelector("employee-meeting-minutes-center");
  if (!el) {
    throw new Error("minutes center missing");
  }
  for (let i = 0; i < 5; i += 1) {
    await (el as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return { el, calls };
}

describe("employee meeting minutes center", () => {
  it("records action items for an in-progress meeting", async () => {
    const { el, calls } = await mount([inProgress]);
    const summary = el.querySelector('input[name="summary"]') as HTMLInputElement;
    summary.value = "ship v1";
    summary.dispatchEvent(new Event("input", { bubbles: true }));
    const title = el.querySelector('input[name="action-title"]') as HTMLInputElement;
    title.value = "draft spec";
    title.dispatchEvent(new Event("input", { bubbles: true }));
    const assignee = el.querySelector('select[name="action-assignee"]') as HTMLSelectElement;
    assignee.value = "user-2";
    assignee.dispatchEvent(new Event("change", { bubbles: true }));
    await (el as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
    const button = [...el.querySelectorAll("button")].find((node) =>
      node.textContent?.includes("记录纪要"),
    );
    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    for (let i = 0; i < 5; i += 1) {
      await (el as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const minute = calls.find((call) => call.method === "meeting.minute");
    expect(minute?.params).toMatchObject({
      id: "m1",
      minutes: {
        summary: "ship v1",
        actionItems: [{ title: "draft spec", assigneeUserId: "user-2", kind: "task" }],
      },
    });
  });

  it("distributes minuted action items", async () => {
    const { el, calls } = await mount([minuted]);
    const button = [...el.querySelectorAll("button")].find((node) =>
      node.textContent?.includes("分发到待我处理"),
    );
    expect(button).toBeTruthy();
    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    for (let i = 0; i < 5; i += 1) {
      await (el as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(calls.some((call) => call.method === "meeting.distribute")).toBe(true);
    expect(el.textContent).toContain("已分发 1 条行动项");
  });
});

describe("tasks module minutes tab", () => {
  it("shows the minutes tab and the assigned badge", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const onTasksSubTabChange = () => undefined;
    render(
      html`${renderModuleContentPage(
        {
          settings: {
            tasksSubTab: "assigned",
            onTasksSubTabChange,
            myTasksLaneCounts: { assignedCount: 2, cronCount: 0, supervisedCount: 0 },
            assignedTasksProps: { client: null },
          },
        } as never,
        { primaryModule: "tasks" } as never,
        "我的任务",
        "",
      )}`,
      host,
    );
    expect(host.textContent).toContain("会议纪要");
    expect(host.textContent).toContain("待我处理");
    expect(host.querySelector(".employee-workbench__tasks-module-tab-badge")?.textContent).toBe(
      "2",
    );
  });
});
