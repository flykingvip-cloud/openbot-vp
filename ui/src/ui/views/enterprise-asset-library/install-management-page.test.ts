// @vitest-environment jsdom
import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import type {
  InstallRelation,
  PaginationState,
} from "../../capability/enterprise-capability/types.ts";
import {
  renderInstallManagementPage,
  type InstallManagementPageProps,
} from "./install-management-page.ts";

function createItems(): InstallRelation[] {
  return [
    {
      id: "rel-1",
      capabilityId: "cap-1",
      capabilityName: "weather",
      robotId: "robot-1",
      robotName: "Aegis Runtime",
      robotOwnerEmployeeName: "张三",
      robotPositionTitle: "销售",
      robotTeamLabel: "一组",
      installedAt: new Date("2026-05-18T18:31:00").getTime(),
      source: "管理员推送",
      status: "正常运行",
    },
    {
      id: "rel-2",
      capabilityId: "cap-2",
      capabilityName: "xurl",
      robotId: "robot-1",
      robotName: "Aegis Runtime",
      robotOwnerEmployeeName: "张三",
      robotPositionTitle: "销售",
      robotTeamLabel: "一组",
      installedAt: new Date("2026-05-18T18:31:00").getTime(),
      source: "员工自主安装",
      status: "待更新",
    },
  ];
}

function createProps(overrides?: Partial<InstallManagementPageProps>): InstallManagementPageProps {
  const pagination: PaginationState = {
    currentPage: 1,
    pageSize: 10,
    totalItems: 2,
  };
  return {
    items: createItems(),
    loading: false,
    error: null,
    pagination,
    filters: {
      capabilityNameQuery: "",
      robotNameQuery: "",
      installedAfter: null,
      installedBefore: null,
      source: null,
      status: null,
    },
    summary: {
      adminPushCount: 1,
      employeeSelfInstallCount: 1,
      coveredRobotCount: 1,
      coveredCapabilityCount: 2,
      coveredPositionCount: 1,
    },
    viewMode: "byRobot",
    pendingUninstallId: null,
    uninstalling: false,
    uninstallError: null,
    onFilterChange: vi.fn(),
    onViewModeChange: vi.fn(),
    onPageChange: vi.fn(),
    onBeginUninstall: vi.fn(),
    onConfirmUninstall: vi.fn(),
    onCancelUninstall: vi.fn(),
    onBack: vi.fn(),
    ...overrides,
  };
}

function renderToContainer(props: InstallManagementPageProps): HTMLElement {
  const container = document.createElement("div");
  render(renderInstallManagementPage(props), container);
  return container;
}

describe("renderInstallManagementPage", () => {
  it("renders view mode switch inside the filter bar", () => {
    const container = renderToContainer(createProps());
    const switcher = container.querySelector(".install-management-page__mode-switch");
    expect(switcher).not.toBeNull();
    expect(switcher?.textContent).toContain("查看维度");
    expect(container.querySelector(".install-management-page__view-tabs")).toBeNull();
  });

  it("renders collapsible groups with summary text", () => {
    const container = renderToContainer(createProps());
    const details = container.querySelector(".install-management-page__group");
    expect(details).not.toBeNull();
    expect(details?.tagName.toLowerCase()).toBe("details");
    expect(details?.querySelector("summary")).not.toBeNull();
    expect(details?.textContent).toContain("展开查看明细");
  });

  it("uses capability-focused copy when viewMode is byCapability", () => {
    const container = renderToContainer(createProps({ viewMode: "byCapability" }));
    expect(container.textContent).toContain("按能力查看");
    expect(container.textContent).toContain("已被 1 个机器人安装");
  });

  it("calls onViewModeChange when mode switch is clicked", () => {
    const onViewModeChange = vi.fn();
    const container = renderToContainer(createProps({ onViewModeChange }));
    const buttons = container.querySelectorAll(".install-management-page__mode-switch-btn");
    (buttons[1] as HTMLButtonElement).click();
    expect(onViewModeChange).toHaveBeenCalledWith("byCapability");
  });
});
