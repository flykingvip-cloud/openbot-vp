// @vitest-environment jsdom
import { render } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../../../../i18n/index.ts";
import { renderPlatformAdvancedSurface } from "./page.ts";

function noop() {
  return undefined;
}

async function flushDom() {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function mountAdvancedSurface(
  props: ReturnType<typeof createProps>,
  hash: string,
): Promise<{ container: HTMLDivElement }> {
  window.history.replaceState({}, "", hash);
  const container = document.createElement("div");
  document.body.appendChild(container);
  render(renderPlatformAdvancedSurface(props), container);
  await flushDom();
  return { container };
}

function createProps() {
  return {
    tab: "platformAdvanced" as const,
    basePath: "",
    client: null,
    readModel: {
      channelCount: 1,
      connectedAccountCount: 1,
      accountCount: 1,
      presenceCount: 0,
      runtimeHosts: [],
      totalTokens: 0,
      totalCost: 0,
      missingCostEntries: 0,
      nodeCount: 1,
      sessionsCount: 2,
      tenantDirectory: [],
      providerIds: [],
    } as never,
    channelsProps: {
      connected: true,
      loading: false,
      snapshot: {
        channelMeta: [
          {
            id: "wecom",
            label: "企业微信",
            description: "企业微信连接器已开通，由平台统一治理通路。",
          },
        ],
        channelOrder: ["wecom"],
        channelLabels: { wecom: "企业微信" },
        channelAccounts: { wecom: [{ accountId: "corp-main", configured: true, running: true }] },
        channels: {
          wecom: {
            configured: true,
            running: true,
            connected: true,
          },
        },
      },
      lastError: null,
      lastSuccessAt: Date.now(),
      whatsappMessage: null,
      whatsappQrDataUrl: null,
      whatsappConnected: null,
      whatsappBusy: false,
      configSchema: {
        type: "object",
        properties: {
          channels: {
            type: "object",
          },
        },
      },
      configSchemaLoading: false,
      configForm: {
        channels: {
          wecom: {
            corpId: "wx-test",
          },
        },
      },
      configUiHints: {},
      configSaving: false,
      configFormDirty: false,
      nostrProfileFormState: null,
      nostrProfileAccountId: null,
      onRefresh: noop,
      onWhatsAppStart: noop,
      onWhatsAppWait: noop,
      onWhatsAppLogout: noop,
      onConfigPatch: noop,
      onConfigSave: noop,
      onConfigReload: noop,
      onNostrProfileEdit: noop,
      onNostrProfileCancel: noop,
      onNostrProfileFieldChange: noop,
      onNostrProfileSave: noop,
      onNostrProfileImport: noop,
      onNostrProfileToggleAdvanced: noop,
    },
    nodesProps: {
      loading: false,
      nodes: [{ nodeId: "node-a", connected: true }],
      devicesLoading: false,
      devicesError: null,
      devicesList: {
        pending: [{ requestId: "req-1", deviceId: "ios-1", role: "mobile" }],
        paired: [{ deviceId: "mac-1", roles: ["desktop"], scopes: ["operator.admin"] }],
      },
      configForm: {},
      configLoading: false,
      configSaving: false,
      configDirty: false,
      configFormMode: "form",
      execApprovalsLoading: false,
      execApprovalsSaving: false,
      execApprovalsDirty: false,
      execApprovalsSnapshot: null,
      execApprovalsForm: null,
      execApprovalsSelectedAgent: null,
      execApprovalsTarget: "gateway",
      execApprovalsTargetNodeId: null,
      canManageDevices: true,
      canManageBindings: true,
      canManageExecApprovals: true,
      readOnlyReason: null,
      onRefresh: noop,
      onDevicesRefresh: noop,
      onDeviceApprove: noop,
      onDeviceReject: noop,
      onDeviceRotate: noop,
      onDeviceRevoke: noop,
      onLoadConfig: noop,
      onLoadExecApprovals: noop,
      onBindDefault: noop,
      onBindAgent: noop,
      onSaveBindings: noop,
      onExecApprovalsTargetChange: noop,
      onExecApprovalsSelectAgent: noop,
      onExecApprovalsPatch: noop,
      onExecApprovalsRemove: noop,
      onSaveExecApprovals: noop,
    },
    sessionsProps: {
      loading: false,
      result: {
        count: 2,
        path: "/tmp/openbot-sessions.json",
        sessions: [
          { key: "main", kind: "direct", updatedAt: Date.now(), label: "Main" },
          { key: "agent:alpha:main", kind: "group", updatedAt: Date.now(), label: "Alpha" },
        ],
      } as never,
      error: null,
      activeMinutes: "",
      limit: "120",
      includeGlobal: true,
      includeUnknown: false,
      basePath: "",
      onFiltersChange: noop,
      onRefresh: noop,
      onPatch: noop,
      onDelete: noop,
    },
    logsProps: {
      loading: false,
      error: null,
      file: "/tmp/openbot.log",
      entries: [
        {
          raw: '{"message":"tenant boot complete"}',
          message: "tenant boot complete",
          level: "info",
          subsystem: "gateway",
        },
      ],
      filterText: "",
      levelFilters: {
        trace: true,
        debug: true,
        info: true,
        warn: true,
        error: true,
        fatal: true,
      },
      autoFollow: false,
      truncated: false,
      onFilterTextChange: noop,
      onLevelToggle: noop,
      onToggleAutoFollow: noop,
      onRefresh: noop,
      onExport: noop,
      onScroll: noop,
    },
    instancesProps: null,
    authPanelProps: null,
    pageViewModels: undefined,
    actions: {
      advanced: {
        onRefreshChannels: vi.fn(),
        onRefreshDevices: vi.fn(),
        onRefreshNodes: vi.fn(),
        onRefreshInstances: vi.fn(),
        onRefreshUsage: vi.fn(),
        onRefreshSessions: vi.fn(),
        onRefreshLogs: vi.fn(),
        onPatchSession: vi.fn(),
        onDeleteSession: vi.fn(),
        onDeviceApprove: vi.fn(),
        onDeviceReject: vi.fn(),
        onDeviceRotate: vi.fn(),
        onDeviceRevoke: vi.fn(),
        onLoadBindingsConfig: vi.fn(),
        onBindDefaultNode: vi.fn(),
        onBindAgentNode: vi.fn(),
        onSaveBindings: vi.fn(),
        onLoadExecApprovals: vi.fn(),
        onExecApprovalsTargetChange: vi.fn(),
        onExecApprovalsSelectAgent: vi.fn(),
        onExecApprovalsPatch: vi.fn(),
        onExecApprovalsRemove: vi.fn(),
        onSaveExecApprovals: vi.fn(),
      },
    } as never,
  } as unknown as Parameters<typeof renderPlatformAdvancedSurface>[0];
}

beforeEach(async () => {
  await i18n.setLocale("en");
});

afterEach(() => {
  document.body.innerHTML = "";
  window.history.replaceState({}, "", "/");
});

describe("renderPlatformAdvancedSurface channels governance", () => {
  it("keeps platform advanced channels in governance mode without tenant credential form", async () => {
    const props = createProps();
    const { container } = await mountAdvancedSurface(props, "/#platform-advanced:channels");

    const expand = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("查看治理"),
    );
    expect(expand).toBeDefined();
    expand?.click();
    window.dispatchEvent(new PopStateEvent("popstate"));
    render(renderPlatformAdvancedSurface(props), container);
    await flushDom();

    expect(container.textContent).toContain("企业租户的具体凭证配置已迁移至企业端");
    expect(container.textContent).toContain("治理详情");
    expect(container.textContent).not.toContain("保存");
    expect(container.textContent).not.toContain("API 密钥");
    expect(container.textContent).not.toContain("企业微信 CorpID");
    expect(container.querySelector("input")).toBeNull();
  });

  it("renders a platform devices governance tab with shared node management view", async () => {
    const props = createProps();
    const { container } = await mountAdvancedSurface(props, "/#platform-advanced:devices");

    expect(container.textContent).toContain("设备与节点治理");
    expect(container.textContent).toContain("待审批");
    expect(container.textContent).toContain("已配对");
    expect(container.textContent).toContain("节点");
    expect(container.textContent).toContain("ios-1");
    expect(container.textContent).toContain("mac-1");
    // Devices tab shows pairing/governance only; exec approvals live elsewhere.
  });

  it("renders a platform sessions operations tab with shared sessions view", async () => {
    const props = createProps();
    const { container } = await mountAdvancedSurface(props, "/#platform-advanced:sessions");

    expect(container.textContent).toContain("会话运维");
    expect(container.textContent).toContain("main");
    expect(container.textContent).toContain("agent:alpha:main");
    expect(container.textContent).toContain("/tmp/openbot-sessions.json");
  });

  it("renders a platform logs operations tab with shared logs view", async () => {
    const props = createProps();
    const { container } = await mountAdvancedSurface(props, "/#platform-advanced:logs");

    expect(container.textContent).toContain("日志与排障");
    expect(container.textContent).toContain("tenant boot complete");
    expect(container.textContent).toContain("/tmp/openbot.log");
  });

  it("renders cliBackend and supervisor as separate tab bodies", async () => {
    const props = createProps();
    const cliMount = await mountAdvancedSurface(props, "/#platform-advanced:cliBackend");
    expect(cliMount.container.innerHTML).toContain("cli-backend-admin-section");
    expect(cliMount.container.innerHTML).not.toContain("supervisor-governance-section");

    const supervisorMount = await mountAdvancedSurface(props, "/#platform-advanced:supervisor");
    expect(supervisorMount.container.innerHTML).toContain("supervisor-governance-section");
    expect(supervisorMount.container.innerHTML).not.toContain("cli-backend-admin-section");
  });

  it("renders the management governance tab as an isolated advanced panel", async () => {
    const props = createProps();
    const { container } = await mountAdvancedSurface(props, "/#platform-advanced:governance");
    expect(container.textContent).toContain("权限与审计");
    expect(container.querySelector("management-governance-section")).toBeTruthy();
    expect(container.querySelector("fabric-governance-section")).toBeFalsy();
  });

  it("drops cli backend panel after switching hash to supervisor on the same container", async () => {
    const props = createProps();
    const container = document.createElement("div");
    document.body.appendChild(container);
    window.history.replaceState({}, "", "/#platform-advanced:cliBackend");
    render(renderPlatformAdvancedSurface(props), container);
    await flushDom();
    expect(container.querySelector("cli-backend-admin-section")).toBeTruthy();

    window.history.replaceState({}, "", "/#platform-advanced:supervisor");
    render(renderPlatformAdvancedSurface(props), container);
    await flushDom();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await flushDom();
    expect(container.querySelector("cli-backend-admin-section")).toBeFalsy();
    expect(container.querySelector("supervisor-governance-section")).toBeTruthy();
    container.remove();
  });

  it("switches tab when clicking module tab in isolated render", async () => {
    const props = createProps();
    const { container } = await mountAdvancedSurface(props, "/#platform-advanced:channels");
    const devicesTab = Array.from(
      container.querySelectorAll<HTMLAnchorElement>(".platform-module-tab"),
    ).find((tab) => tab.textContent?.trim() === "设备");
    expect(devicesTab).toBeDefined();
    const popSpy = vi.fn();
    window.addEventListener("popstate", popSpy);
    devicesTab!.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }),
    );
    window.removeEventListener("popstate", popSpy);
    expect(popSpy).not.toHaveBeenCalled();
    expect(window.location.hash).toBe("#platform-advanced:devices");
  });
});
