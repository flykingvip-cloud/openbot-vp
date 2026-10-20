/* @vitest-environment jsdom */

import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import type { CronJob } from "../../../types.ts";
import type { CronProps } from "../../../views/cron.ts";
import "./employee-personal-cron-center.ts";
import { renderPersonalCronCenter } from "./employee-personal-cron-center.ts";

function createCronProps(overrides: Partial<CronProps> = {}): CronProps {
  return {
    basePath: "",
    loading: false,
    jobsLoadingMore: false,
    status: null,
    jobs: [],
    jobsTotal: 0,
    jobsHasMore: false,
    jobsQuery: "",
    jobsEnabledFilter: "all",
    jobsScheduleKindFilter: "all",
    jobsLastStatusFilter: "all",
    jobsSortBy: "nextRunAtMs",
    jobsSortDir: "asc",
    error: null,
    busy: false,
    form: {
      name: "",
      description: "",
      scheduleKind: "cron",
      scheduleAt: "",
      everyAmount: "1",
      everyUnit: "hours",
      cronExpr: "0 9 * * *",
      cronTz: "Asia/Shanghai",
      staggerAmount: "",
      staggerUnit: "minutes",
      scheduleExact: false,
      agentId: "",
      sessionKey: "",
      clearAgent: false,
      enabled: true,
      deleteAfterRun: false,
      sessionTarget: "main",
      wakeMode: "now",
      payloadKind: "agentTurn",
      payloadText: "",
      payloadModel: "",
      payloadThinking: "",
      timeoutSeconds: "",
      deliveryMode: "none",
      deliverySurfaces: [],
      deliveryChannel: "",
      deliveryTo: "",
      deliveryAccountId: "",
      deliveryBestEffort: false,
      payloadLightContext: false,
      failureAlertMode: "disabled",
      failureAlertAfter: "",
      failureAlertCooldownSeconds: "",
      failureAlertChannel: "",
      failureAlertTo: "",
      failureAlertDeliveryMode: "announce",
      failureAlertAccountId: "",
    },
    fieldErrors: {},
    canSubmit: true,
    canManageJobs: true,
    canRunJobs: true,
    readOnlyReason: null,
    editingJobId: null,
    channels: [],
    channelLabels: {},
    channelMeta: [],
    runsJobId: null,
    runs: [],
    runsTotal: 0,
    runsHasMore: false,
    runsLoadingMore: false,
    runsScope: "all",
    runsStatuses: [],
    runsDeliveryStatuses: [],
    runsStatusFilter: "all",
    runsQuery: "",
    runsSortDir: "desc",
    agentSuggestions: [],
    modelSuggestions: [],
    thinkingSuggestions: [],
    timezoneSuggestions: [],
    deliveryToSuggestions: [],
    accountSuggestions: [],
    onFormChange: vi.fn(),
    onRefresh: vi.fn(),
    onAdd: vi.fn(),
    onEdit: vi.fn(),
    onClone: vi.fn(),
    onCancelEdit: vi.fn(),
    onToggle: vi.fn(),
    onRun: vi.fn(),
    onRemove: vi.fn(),
    onLoadRuns: vi.fn(),
    onLoadMoreJobs: vi.fn(),
    onJobsFiltersChange: vi.fn(),
    onJobsFiltersReset: vi.fn(),
    onLoadMoreRuns: vi.fn(),
    onRunsFiltersChange: vi.fn(),
    ...overrides,
  };
}

describe("employee-personal-cron-center", () => {
  it("opens the create-task drawer when clicking + 新建任务", async () => {
    const onCancelEdit = vi.fn();
    const props = createCronProps({ onCancelEdit });
    const container = document.createElement("div");
    document.body.appendChild(container);
    render(renderPersonalCronCenter(props), container);

    const center = container.querySelector("employee-personal-cron-center");
    expect(center).not.toBeNull();
    await (center as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;

    const createButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("新建任务"),
    );
    expect(createButton).toBeTruthy();
    createButton!.click();
    await center!.updateComplete;

    expect(center!.querySelector(".employee-cron-center__panel")).not.toBeNull();
    expect(document.body.textContent).toContain("创建方式");
    expect(onCancelEdit).not.toHaveBeenCalled();

    container.remove();
  });

  it("renders the editor in-place (no full-screen drawer overlay) with a back-to-list anchor", async () => {
    const props = createCronProps();
    const container = document.createElement("div");
    document.body.appendChild(container);
    render(renderPersonalCronCenter(props), container);

    const center = container.querySelector("employee-personal-cron-center");
    await (center as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;

    const createButton = Array.from(center!.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("新建任务"),
    );
    createButton!.click();
    await (center as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;

    // No fixed overlay backdrop, no body scroll lock, no body portal — strictly in-place.
    expect(document.body.querySelector(".employee-cron-center__drawer-backdrop")).toBeNull();
    expect(document.body.querySelector(".employee-cron-center__portal-root")).toBeNull();
    expect(document.body.style.overflow).not.toBe("hidden");
    // The panel lives inside the component and offers a return anchor.
    expect(center!.querySelector(".employee-cron-center__panel")).not.toBeNull();
    const backButton = Array.from(center!.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("返回任务列表"),
    );
    expect(backButton).toBeTruthy();

    backButton!.click();
    await (center as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
    expect(center!.querySelector(".employee-cron-center__panel")).toBeNull();

    container.remove();
  });

  it("opens template mode when clicking 任务模板", async () => {
    const props = createCronProps();
    const container = document.createElement("div");
    document.body.appendChild(container);
    render(renderPersonalCronCenter(props), container);

    const center = container.querySelector("employee-personal-cron-center");
    await (center as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
    const templateButton = Array.from(center!.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("任务模板"),
    );
    expect(templateButton).toBeTruthy();
    templateButton!.click();
    await (center as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;

    expect(center!.querySelector(".employee-cron-center__panel")).not.toBeNull();
    expect(center!.textContent).toContain("任务模板");

    container.remove();
  });

  it("clears edit mode via onCancelEdit when opening a fresh form while editing", async () => {
    const onCancelEdit = vi.fn();
    const props = createCronProps({ onCancelEdit, editingJobId: "job-1" });
    const container = document.createElement("div");
    document.body.appendChild(container);
    render(renderPersonalCronCenter(props), container);

    const center = container.querySelector("employee-personal-cron-center");
    await (center as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;

    const createButton = Array.from(center!.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("新建任务"),
    );
    createButton!.click();
    await (center as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;

    expect(onCancelEdit).toHaveBeenCalledTimes(1);
    expect(center!.querySelector(".employee-cron-center__panel")).not.toBeNull();

    container.remove();
  });

  it("pins the row overflow menu with position:fixed so list overflow cannot clip it", async () => {
    const job = {
      id: "job-price",
      name: "竞品价格巡检",
      enabled: true,
      createdAtMs: Date.now(),
      updatedAtMs: Date.now(),
      schedule: { kind: "cron", expr: "0 9 * * 1", tz: "Asia/Shanghai" },
      sessionTarget: "isolated",
      wakeMode: "now",
      payload: { kind: "agentTurn", message: "巡检竞品价格" },
    } as CronJob;
    const props = createCronProps({ jobs: [job], jobsTotal: 1 });
    const container = document.createElement("div");
    document.body.appendChild(container);
    render(renderPersonalCronCenter(props), container);

    const center = container.querySelector("employee-personal-cron-center") as HTMLElement & {
      updateComplete: Promise<unknown>;
    };
    await center.updateComplete;

    const details = center.querySelector<HTMLDetailsElement>(
      ".employee-cron-center__task-menu details",
    );
    expect(details).not.toBeNull();
    const panel = details!.querySelector<HTMLElement>(".employee-cron-center__menu-panel");
    expect(panel).not.toBeNull();

    details!.querySelector("summary")?.click();
    if (!details!.open) {
      details!.open = true;
    }
    details!.dispatchEvent(new Event("toggle"));
    await Promise.resolve();

    expect(panel!.style.position).toBe("fixed");
    expect(panel!.style.right).toBe("auto");
    expect(panel!.style.zIndex).toBe("80");
    expect(panel!.style.top).toMatch(/px$/);
    expect(panel!.style.left).toMatch(/px$/);

    container.remove();
  });
});
