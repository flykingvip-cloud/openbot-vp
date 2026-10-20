// @vitest-environment jsdom
import { render } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  RuntimeAgent,
  RuntimeCapabilityBinding,
} from "../../../capability/runtime-canonical/index.ts";
import type { PlatformSurfaceProps } from "../shared/surface.ts";
import {
  canMutateRuntimeBindings,
  disableBindingMutation,
  promoteBindingMutation,
  requestBindingRowMutation,
  BINDING_PRIMARY_ROUTING_PRIORITY,
  BINDING_UPDATE_PRIORITY_METHOD,
  BINDING_UPDATE_STATE_METHOD,
  BINDING_UPDATE_STRATEGY_METHOD,
} from "./binding-row-mutations.ts";
import { renderPlatformAgentsSurface, resetPlatformAgentsBindingUiForTest } from "./page.ts";

const NOW = Date.parse("2026-10-11T00:00:00.000Z");

function agent(): RuntimeAgent {
  return {
    runtimeAgentId: "rt-aegis-1",
    name: "Aegis",
    runtimeVersion: "2026.3.9",
    lifecycle: "deployed",
    health: "healthy",
    tenantCoverage: ["acme"],
    boundCapabilityCount: 2,
    activeSessionCount: 1,
    resourceUsage: { cpuPercent: 1, memoryPercent: 1, tokenBudgetUsedPercent: 1 },
    deployedAt: NOW,
    lastActiveAt: NOW,
  };
}

function binding(
  over: Partial<RuntimeCapabilityBinding> & Pick<RuntimeCapabilityBinding, "bindingId">,
): RuntimeCapabilityBinding {
  return {
    runtimeAgentId: "rt-aegis-1",
    capabilityId: "urn:openclaw:skill:web-search@1.2.0",
    capabilityVersion: "1.2.0",
    bindingType: "platform-default",
    routingPriority: 90,
    loadStrategy: "lazy",
    bindingState: "active",
    healthStatus: "healthy",
    invocationMetrics: {
      calls7d: 10,
      successRate7d: 0.99,
      avgLatencyMs: 20,
      p95LatencyMs: 40,
      errorCount7d: 0,
      tokenConsumption7d: 1,
    },
    policy: { sandbox: "strict", resourceQuota: "small", hotReloadable: true },
    fallbackBindingId: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

function mount(params: {
  hash: string;
  scopes: string[];
  connected: boolean;
  request: ReturnType<typeof vi.fn>;
  refresh?: ReturnType<typeof vi.fn>;
}) {
  window.location.hash = params.hash;
  const refresh = params.refresh ?? vi.fn(async () => undefined);
  const container = document.createElement("div");
  const props = {
    tab: "platformAgents",
    basePath: "",
    scopes: params.scopes,
    client: { connected: params.connected, request: params.request },
    readModel: {
      shellSnapshotReady: true,
      runtimeAgents: [agent()],
      runtimeBindings: [
        binding({ bindingId: "binding-active", routingPriority: 90, bindingState: "active" }),
        binding({
          bindingId: "binding-primary",
          routingPriority: 120,
          bindingState: "active",
          capabilityId: "urn:openclaw:skill:xurl@1.0.0",
        }),
        binding({ bindingId: "binding-off", bindingState: "disabled", routingPriority: 40 }),
      ],
      runtimeTelemetry: [],
      runtimeOverviewLoading: false,
      runtimeOverviewError: null,
    },
    actions: {
      platformAgents: { onRefresh: refresh },
    },
  } as unknown as PlatformSurfaceProps;
  render(renderPlatformAgentsSurface(props), container);
  return { container, refresh, props };
}

function button(container: ParentNode, bindingId: string, testId: string) {
  return container.querySelector<HTMLButtonElement>(
    `[data-binding-id="${bindingId}"] [data-testid="${testId}"]`,
  );
}

describe("binding row mutation contract", () => {
  it("keeps operator.admin and a connected client as the gate", () => {
    expect(
      canMutateRuntimeBindings({ scopes: ["operator.read"], clientConnected: true }).allowed,
    ).toBe(false);
    expect(
      canMutateRuntimeBindings({ scopes: ["operator.admin"], clientConnected: false }).allowed,
    ).toBe(false);
    expect(
      canMutateRuntimeBindings({ scopes: ["operator.admin"], clientConnected: true }).allowed,
    ).toBe(true);
  });

  it("does not treat a mismatched payload as success", async () => {
    const row = binding({ bindingId: "binding-active" });
    const mutation = disableBindingMutation(row);
    const request = vi.fn(async () => ({ binding: { ...row, bindingState: "active" as const } }));
    const result = await requestBindingRowMutation(request, mutation);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("不一致");
    }
    expect(request).toHaveBeenCalledWith(BINDING_UPDATE_STATE_METHOD, {
      bindingId: "binding-active",
      bindingState: "disabled",
    });
  });

  it("promotes with the single priority method at the primary threshold", () => {
    const mutation = promoteBindingMutation(binding({ bindingId: "binding-active" }));
    expect(mutation.method).toBe(BINDING_UPDATE_PRIORITY_METHOD);
    expect(mutation.params).toEqual({
      bindingId: "binding-active",
      routingPriority: BINDING_PRIMARY_ROUTING_PRIORITY,
    });
  });
});

describe("platform agents binding rows", () => {
  beforeEach(() => {
    resetPlatformAgentsBindingUiForTest();
    vi.stubGlobal(
      "confirm",
      vi.fn(() => true),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("leaves row actions disabled without operator.admin", () => {
    const { container } = mount({
      hash: "#agent-runtime:bindings",
      scopes: ["operator.read"],
      connected: true,
      request: vi.fn(),
    });
    const disable = button(container, "binding-active", "binding-row-disable");
    expect(disable?.disabled).toBe(true);
    expect(disable?.title).toContain("operator.admin");
    for (const testId of [
      "binding-bulk-enable",
      "binding-bulk-disable",
      "binding-bulk-strategy",
      "binding-bulk-upgrade",
    ]) {
      expect(container.querySelector<HTMLButtonElement>(`[data-testid=${testId}]`)?.disabled).toBe(
        true,
      );
    }
  });

  it("calls update-binding-state for one row and refuses a fake success payload", async () => {
    const request = vi.fn(async () => ({
      binding: binding({ bindingId: "binding-active", bindingState: "active" }),
    }));
    const refresh = vi.fn(async () => undefined);
    const { container, props } = mount({
      hash: "#agent-runtime:bindings",
      scopes: ["operator.admin"],
      connected: true,
      request,
      refresh,
    });
    button(container, "binding-active", "binding-row-disable")?.click();
    await vi.waitFor(() => {
      render(renderPlatformAgentsSurface(props), container);
      expect(request).toHaveBeenCalledWith(BINDING_UPDATE_STATE_METHOD, {
        bindingId: "binding-active",
        bindingState: "disabled",
      });
      expect(
        container.querySelector("[data-testid=binding-mutation-notice]")?.textContent,
      ).toContain("不一致");
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("refreshes only after the gateway echoes the requested priority", async () => {
    const request = vi.fn(async () => ({
      binding: binding({
        bindingId: "binding-active",
        routingPriority: BINDING_PRIMARY_ROUTING_PRIORITY,
      }),
    }));
    const refresh = vi.fn(async () => undefined);
    const { container, props } = mount({
      hash: "#agent-runtime:bindings",
      scopes: ["operator.admin"],
      connected: true,
      request,
      refresh,
    });
    button(container, "binding-active", "binding-row-promote")?.click();
    await vi.waitFor(() => {
      render(renderPlatformAgentsSurface(props), container);
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(
        container.querySelector("[data-testid=binding-mutation-notice]")?.textContent,
      ).toContain("网关已接受");
    });
    expect(request).toHaveBeenCalledWith(BINDING_UPDATE_PRIORITY_METHOD, {
      bindingId: "binding-active",
      routingPriority: BINDING_PRIMARY_ROUTING_PRIORITY,
    });
  });

  it("does not call the gateway when confirm is declined", () => {
    vi.stubGlobal(
      "confirm",
      vi.fn(() => false),
    );
    const request = vi.fn();
    const { container } = mount({
      hash: "#agent-runtime:bindings",
      scopes: ["operator.admin"],
      connected: true,
      request,
    });
    button(container, "binding-active", "binding-row-disable")?.click();
    expect(request.mock.calls.some((call) => call[0] === BINDING_UPDATE_STATE_METHOD)).toBe(false);
  });

  it("changes load strategy for one binding from the detail card", async () => {
    const request = vi.fn(async () => ({
      binding: binding({ bindingId: "binding-active", loadStrategy: "eager" }),
    }));
    const { container, props } = mount({
      hash: "#agent-runtime:bindings",
      scopes: ["operator.admin"],
      connected: true,
      request,
    });
    container
      .querySelector<HTMLButtonElement>('[aria-label="查看 Web Search（Aegis）的详情"]')
      ?.click();
    render(renderPlatformAgentsSurface(props), container);
    const select = container.querySelector<HTMLSelectElement>(
      '[data-binding-id="binding-active"] [data-testid="binding-strategy"]',
    );
    expect(select?.disabled).toBe(false);
    select!.value = "eager";
    select!.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.waitFor(() => {
      expect(request).toHaveBeenCalledWith(BINDING_UPDATE_STRATEGY_METHOD, {
        bindingId: "binding-active",
        loadStrategy: "eager",
      });
    });
  });

  it("keeps unconfigured policy fields unlabeled and enables category fix only", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "agent-runtime.policy.get") {
        return {
          loadDefaults: null,
          conflict: null,
          fallback: { mode: null },
          rateLimit: null,
        };
      }
      return {};
    });
    const { container } = mount({
      hash: "#agent-runtime:policy",
      scopes: ["operator.admin"],
      connected: true,
      request,
    });
    expect(container.textContent).toContain("每能力 QPS");
    expect(container.textContent).toContain("次/秒（requests/second）");
    expect(container.textContent).toContain("次/天（requests/day）");
    expect(container.textContent).toContain("fallback.mode");
    expect(container.textContent).toContain("fallbackBindingId");
    expect(container.textContent).toContain("未接入");
    expect(container.textContent).not.toContain("自动切换备用能力");
    expect(container.textContent).not.toContain("按需加载（示意");
    await vi.waitFor(() => {
      expect(request).toHaveBeenCalledWith("agent-runtime.policy.get", {});
    });
    const conflict = container.querySelector<HTMLButtonElement>(
      '[data-testid="governance-fix-capability-conflict"]',
    );
    const zombie = container.querySelector<HTMLButtonElement>(
      '[data-testid="governance-fix-zombie-binding"]',
    );
    const low = container.querySelector<HTMLButtonElement>(
      '[data-testid="governance-fix-low-success"]',
    );
    expect(conflict?.disabled).toBe(false);
    expect(zombie?.disabled).toBe(false);
    expect(low?.disabled).toBe(true);
    expect(low?.title).toContain("低成功率");
    expect(container.textContent).toContain("下面的选项不是当前策略");
    expect(container.querySelector('[data-testid="policy-qps"]')?.textContent).toContain("未接入");
  });

  it("shows batch partial failure from one batch-set-state call", async () => {
    const request = vi.fn(async () => ({
      applied: [binding({ bindingId: "binding-active", bindingState: "disabled" })],
      rejected: [{ bindingId: "binding-off", reason: "unknown binding" }],
    }));
    const { container, props } = mount({
      hash: "#agent-runtime:bindings",
      scopes: ["operator.admin"],
      connected: true,
      request,
    });
    for (const id of ["binding-active", "binding-off"]) {
      const box = container.querySelector<HTMLInputElement>(
        `[data-testid="binding-row-select"][data-binding-id="${id}"]`,
      );
      if (!box) {
        throw new Error(`missing select ${id}`);
      }
      box.checked = true;
      box.dispatchEvent(new Event("change", { bubbles: true }));
    }
    render(renderPlatformAgentsSurface(props), container);
    const bulk = container.querySelector<HTMLButtonElement>('[data-testid="binding-bulk-disable"]');
    expect(bulk?.disabled).toBe(false);
    bulk?.click();
    await vi.waitFor(() => {
      render(renderPlatformAgentsSurface(props), container);
      expect(
        request.mock.calls.filter((call) => call[0] === "agent-runtime.binding.batch-set-state"),
      ).toHaveLength(1);
      expect(container.textContent).toContain("已应用 1 条，拒绝 1 条");
    });
    expect(request).toHaveBeenCalledWith("agent-runtime.binding.batch-set-state", {
      bindingIds: ["binding-active", "binding-off"],
      bindingState: "disabled",
    });
    expect(container.textContent).toContain("unknown binding");
    expect(
      request.mock.calls.filter((call) => call[0] === "agent-runtime.update-binding-state"),
    ).toHaveLength(0);
  });

  it("calls governance.fix once and reports skipped conflicts", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "agent-runtime.policy.get") {
        return {
          loadDefaults: null,
          conflict: null,
          fallback: { mode: null },
          rateLimit: null,
        };
      }
      return {
        dryRun: false,
        applied: [],
        skipped: [{ issueId: "capability-conflict::a", reason: "no safe version target" }],
      };
    });
    const { container, props } = mount({
      hash: "#agent-runtime:policy",
      scopes: ["operator.admin"],
      connected: true,
      request,
    });
    container
      .querySelector<HTMLButtonElement>('[data-testid="governance-fix-capability-conflict"]')
      ?.click();
    await vi.waitFor(() => {
      render(renderPlatformAgentsSurface(props), container);
      expect(request).toHaveBeenCalledWith("agent-runtime.governance.fix", {
        category: "capability-conflict",
        dryRun: false,
      });
      expect(container.textContent).toContain("没有可自动修复的项");
      expect(container.textContent).toContain("no safe version target");
    });
    const fixCalls = request.mock.calls.filter(
      (call) => call[0] === "agent-runtime.governance.fix",
    );
    expect(fixCalls).toHaveLength(1);
    expect(
      request.mock.calls.some((call) => call[0] === "agent-runtime.update-binding-state"),
    ).toBe(false);
  });

  it("upgrades selected bindings in one RPC and shows partial rejection", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "agent-runtime.capability-versions.list") {
        return {
          entries: [
            {
              capabilityId: "urn:openclaw:skill:web-search@1.2.0",
              version: "1.3.0",
              sources: ["registry"],
              registryLifecycle: "active",
              eligible: true,
            },
            {
              capabilityId: "urn:openclaw:skill:web-search@1.2.0",
              version: "1.2.0",
              sources: ["binding"],
              registryLifecycle: null,
              eligible: true,
            },
          ],
        };
      }
      if (method === "agent-runtime.binding.upgrade") {
        return {
          applied: [binding({ bindingId: "binding-active", capabilityVersion: "1.3.0" })],
          rejected: [{ bindingId: "binding-off", reason: "version unknown" }],
        };
      }
      return {};
    });
    const { container, props } = mount({
      hash: "#agent-runtime:bindings",
      scopes: ["operator.admin"],
      connected: true,
      request,
    });
    await vi.waitFor(() => {
      render(renderPlatformAgentsSurface(props), container);
      expect(
        container.querySelector<HTMLSelectElement>('[data-testid="binding-bulk-upgrade-version"]')
          ?.textContent,
      ).toContain("1.3.0");
    });
    for (const id of ["binding-active", "binding-off"]) {
      const box = container.querySelector<HTMLInputElement>(
        `[data-testid="binding-row-select"][data-binding-id="${id}"]`,
      );
      if (!box) {
        throw new Error(`missing select ${id}`);
      }
      box.checked = true;
      box.dispatchEvent(new Event("change", { bubbles: true }));
    }
    const version = container.querySelector<HTMLSelectElement>(
      '[data-testid="binding-bulk-upgrade-version"]',
    );
    if (!version) {
      throw new Error("missing upgrade version select");
    }
    version.value = "1.3.0";
    version.dispatchEvent(new Event("change", { bubbles: true }));
    render(renderPlatformAgentsSurface(props), container);
    const upgrade = container.querySelector<HTMLButtonElement>(
      '[data-testid="binding-bulk-upgrade"]',
    );
    expect(upgrade?.disabled).toBe(false);
    upgrade?.click();
    await vi.waitFor(() => {
      render(renderPlatformAgentsSurface(props), container);
      expect(container.textContent).toContain("已应用 1 条，拒绝 1 条");
      expect(container.textContent).toContain("version unknown");
    });
    expect(request).toHaveBeenCalledWith("agent-runtime.binding.upgrade", {
      bindingIds: ["binding-active", "binding-off"],
      capabilityVersion: "1.3.0",
    });
    expect(
      request.mock.calls.filter((call) => call[0] === "agent-runtime.binding.upgrade"),
    ).toHaveLength(1);
    expect(
      request.mock.calls.some((call) => call[0] === "agent-runtime.update-binding-state"),
    ).toBe(false);
  });

  it("does not upgrade when confirm is declined", async () => {
    const request = vi.fn(async () => ({
      entries: [
        {
          capabilityId: "urn:openclaw:skill:web-search@1.2.0",
          version: "1.3.0",
          sources: ["registry"],
          registryLifecycle: "active",
          eligible: true,
        },
      ],
    }));
    const { container, props } = mount({
      hash: "#agent-runtime:bindings",
      scopes: ["operator.admin"],
      connected: true,
      request,
    });
    await vi.waitFor(() => {
      render(renderPlatformAgentsSurface(props), container);
      expect(
        container.querySelector('[data-testid="binding-bulk-upgrade-version"]')?.textContent,
      ).toContain("1.3.0");
    });
    vi.stubGlobal(
      "confirm",
      vi.fn(() => false),
    );
    const box = container.querySelector<HTMLInputElement>(
      '[data-testid="binding-row-select"][data-binding-id="binding-active"]',
    );
    box!.checked = true;
    box!.dispatchEvent(new Event("change", { bubbles: true }));
    const version = container.querySelector<HTMLSelectElement>(
      '[data-testid="binding-bulk-upgrade-version"]',
    );
    version!.value = "1.3.0";
    version!.dispatchEvent(new Event("change", { bubbles: true }));
    render(renderPlatformAgentsSurface(props), container);
    container.querySelector<HTMLButtonElement>('[data-testid="binding-bulk-upgrade"]')?.click();
    expect(request.mock.calls.some((call) => call[0] === "agent-runtime.binding.upgrade")).toBe(
      false,
    );
  });

  it("saves policy numbers with locked units and global fallback mode", async () => {
    const request = vi.fn(async (method: string, params: unknown) => {
      if (method === "agent-runtime.policy.get") {
        return {
          loadDefaults: null,
          conflict: null,
          fallback: { mode: null },
          rateLimit: null,
        };
      }
      return params;
    });
    const { container, props } = mount({
      hash: "#agent-runtime:policy",
      scopes: ["operator.admin"],
      connected: true,
      request,
    });
    await vi.waitFor(() => {
      render(renderPlatformAgentsSurface(props), container);
      expect(request).toHaveBeenCalledWith("agent-runtime.policy.get", {});
      expect(
        container.querySelector<HTMLButtonElement>('[data-testid="policy-edit"]')?.disabled,
      ).toBe(false);
    });
    expect(container.querySelector("[data-testid=policy-qps]")?.textContent).toContain("未接入");
    expect(container.textContent).toContain("次/秒（requests/second）");
    expect(container.textContent).toContain("次/天（requests/day）");
    container.querySelector<HTMLButtonElement>('[data-testid="policy-edit"]')?.click();
    render(renderPlatformAgentsSurface(props), container);
    const qps = container.querySelector<HTMLInputElement>('[data-testid="policy-qps-input"]');
    const daily = container.querySelector<HTMLInputElement>('[data-testid="policy-daily-input"]');
    const fallback = container.querySelector<HTMLSelectElement>(
      '[data-testid="policy-fallback-mode"]',
    );
    if (!qps || !daily || !fallback) {
      throw new Error("policy editor did not open");
    }
    qps.value = "0.5";
    qps.dispatchEvent(new Event("input", { bubbles: true }));
    daily.value = "40";
    daily.dispatchEvent(new Event("input", { bubbles: true }));
    fallback.value = "auto-standby";
    fallback.dispatchEvent(new Event("change", { bubbles: true }));
    render(renderPlatformAgentsSurface(props), container);
    container.querySelector<HTMLButtonElement>('[data-testid="policy-save"]')?.click();
    await vi.waitFor(() => {
      render(renderPlatformAgentsSurface(props), container);
      expect(request).toHaveBeenCalledWith(
        "agent-runtime.policy.update",
        expect.objectContaining({
          fallback: { mode: "auto-standby" },
          rateLimit: { perCapabilityQps: 0.5, perTenantDailyCap: 40 },
        }),
      );
      expect(container.querySelector("[data-testid=policy-qps]")?.textContent).toContain(
        "0.5 次/秒 · 每个能力",
      );
      expect(container.querySelector("[data-testid=policy-daily-cap]")?.textContent).toContain(
        "40 次/天 · 每个租户",
      );
      expect(container.querySelector("[data-testid=policy-fallback-value]")?.textContent).toContain(
        "auto-standby",
      );
    });
  });
});
