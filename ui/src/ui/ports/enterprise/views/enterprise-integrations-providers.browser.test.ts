// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import "./enterprise-integrations-providers.ts";
import type { EnterpriseIntegrationsProviders } from "./enterprise-integrations-providers.ts";

type Call = { method: string; params: Record<string, unknown> };

function connection(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: "acme",
    connectionId: "conn-1",
    providerType: "openai-compatible",
    displayName: "内网推理",
    baseUrl: "http://10.0.0.8:8000/v1",
    protocol: "openai-completions",
    credentialRef: "ref",
    status: "credential_saved",
    healthStatus: "unknown",
    hasCredential: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function clientFor(handlers: Record<string, (params: Record<string, unknown>) => unknown>) {
  const calls: Call[] = [];
  const client = {
    request: vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
      calls.push({ method, params });
      const handler = handlers[method];
      if (!handler) {
        throw new Error(`unexpected method ${method}`);
      }
      return handler(params);
    }),
  };
  return { client, calls };
}

async function settle(el: EnterpriseIntegrationsProviders) {
  for (let i = 0; i < 6; i += 1) {
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function setField(root: ParentNode, testId: string, value: string) {
  const input = root.querySelector(`[data-testid='${testId}']`) as
    | HTMLInputElement
    | HTMLSelectElement;
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("enterprise integrations providers", () => {
  it("registers private models only after the connection probe succeeds", async () => {
    const { client, calls } = clientFor({
      "enterprise-model-provider.list": () => ({ tenantId: "acme", connections: [] }),
      "enterprise-model-catalog.list": () => ({ tenantId: "acme", assets: [] }),
      "enterprise-model-provider.create": () => ({ connection: connection() }),
      "enterprise-model-provider.test": () => ({
        ok: true,
        code: "OK",
        discoveredModels: [],
        connection: connection({ status: "verified" }),
      }),
      "enterprise-model-catalog.register": (params) => ({
        asset: {
          tenantId: "acme",
          assetId: `asset-${String(params.upstreamModelId)}`,
          connectionId: "conn-1",
          runtimeModelId: `conn-1/${String(params.upstreamModelId)}`,
          upstreamModelId: params.upstreamModelId,
          displayName: params.upstreamModelId,
          source: "enterprise",
          billingOwner: "enterprise",
          enabled: true,
          healthStatus: "unknown",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      }),
    });
    const el = document.createElement("enterprise-integrations-providers");
    el.client = client as never;
    el.enterpriseId = "acme";
    el.catalogProviderIds = ["openai"];
    el.catalogModelIds = ["openai/gpt-5.4"];
    document.body.append(el);
    await settle(el);

    expect(el.textContent).toContain("平台提供");
    expect(el.textContent).toContain("Gpt 5.4");
    expect(el.textContent).not.toContain("密钥已配置");
    (el.querySelector("[data-testid='enterprise-add-provider']") as HTMLButtonElement).click();
    await el.updateComplete;
    setField(el, "enterprise-provider-display-name", "内网推理");
    setField(el, "enterprise-provider-type", "openai-compatible");
    setField(el, "enterprise-provider-base-url", "http://10.0.0.8:8000/v1");
    setField(el, "enterprise-provider-api-key", "sk-private");
    setField(el, "enterprise-provider-model-ids", "qwen2.5， deepseek-chat");
    (el.querySelector("[data-testid='enterprise-provider-submit']") as HTMLButtonElement).click();
    await settle(el);

    const methods = calls.map((call) => call.method);
    const createAt = methods.indexOf("enterprise-model-provider.create");
    const testAt = methods.indexOf("enterprise-model-provider.test");
    const registerAt = methods.lastIndexOf("enterprise-model-catalog.register");
    expect(createAt).toBeGreaterThanOrEqual(0);
    expect(testAt).toBeGreaterThan(createAt);
    expect(registerAt).toBeGreaterThan(testAt);
    expect(calls[createAt]?.params).toMatchObject({
      enterpriseId: "acme",
      providerType: "openai-compatible",
      displayName: "内网推理",
      baseUrl: "http://10.0.0.8:8000/v1",
      protocol: "openai-completions",
      apiKey: "sk-private",
    });
    const registered = calls
      .filter((call) => call.method === "enterprise-model-catalog.register")
      .map((call) => call.params.upstreamModelId);
    expect(registered).toEqual(["qwen2.5", "deepseek-chat"]);
    expect(el.textContent).toContain("连接成功，模型已登记。");
  });

  it("does not register models when the private endpoint probe fails", async () => {
    const { client, calls } = clientFor({
      "enterprise-model-provider.list": () => ({ tenantId: "acme", connections: [] }),
      "enterprise-model-catalog.list": () => ({ tenantId: "acme", assets: [] }),
      "enterprise-model-provider.create": () => ({ connection: connection() }),
      "enterprise-model-provider.test": () => ({
        ok: false,
        code: "ENTERPRISE_MODEL_NETWORK_UNREACHABLE",
        message: "连接失败",
        discoveredModels: [],
        connection: connection({ status: "network_unreachable" }),
      }),
    });
    const el = document.createElement("enterprise-integrations-providers");
    el.client = client as never;
    el.enterpriseId = "acme";
    document.body.append(el);
    await settle(el);
    (el.querySelector("[data-testid='enterprise-add-provider']") as HTMLButtonElement).click();
    await el.updateComplete;
    setField(el, "enterprise-provider-display-name", "内网推理");
    setField(el, "enterprise-provider-base-url", "http://10.1.0.9:8000/v1");
    setField(el, "enterprise-provider-api-key", "sk-private");
    setField(el, "enterprise-provider-model-ids", "qwen2.5");
    (el.querySelector("[data-testid='enterprise-provider-submit']") as HTMLButtonElement).click();
    await settle(el);
    expect(calls.some((call) => call.method === "enterprise-model-catalog.register")).toBe(false);
    expect(el.textContent).toContain("连接失败");
  });

  it("wires verify, edit, rotate, and remove for an enterprise connection", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { client, calls } = clientFor({
      "enterprise-model-provider.list": () => ({
        tenantId: "acme",
        connections: [connection({ status: "verified" })],
      }),
      "enterprise-model-catalog.list": () => ({
        tenantId: "acme",
        assets: [
          {
            tenantId: "acme",
            assetId: "asset-1",
            connectionId: "conn-1",
            runtimeModelId: "conn-1/qwen2.5",
            upstreamModelId: "qwen2.5",
            displayName: "qwen2.5",
            source: "enterprise",
            billingOwner: "enterprise",
            enabled: true,
            healthStatus: "healthy",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      }),
      "enterprise-model-provider.test": () => ({
        ok: true,
        code: "OK",
        discoveredModels: [],
        connection: connection({ status: "verified" }),
      }),
      "enterprise-model-provider.update": () => ({
        connection: connection({ status: "verified" }),
      }),
      "enterprise-model-provider.rotate-credential": () => ({
        connection: connection({ status: "verified" }),
        discoveredModels: [],
      }),
      "enterprise-model-provider.delete": () => ({
        deleted: true,
        connectionId: "conn-1",
        removedAssets: 1,
      }),
    });
    const onOpenAuthorization = vi.fn();
    const el = document.createElement("enterprise-integrations-providers");
    el.client = client as never;
    el.enterpriseId = "acme";
    el.onOpenAuthorization = onOpenAuthorization;
    document.body.append(el);
    await settle(el);
    expect(el.textContent).toContain("Qwen2.5");
    (
      el.querySelector(
        "[data-testid='enterprise-model-name'][data-supply='enterprise']",
      ) as HTMLButtonElement
    ).click();
    await el.updateComplete;
    expect(el.querySelector("[data-testid='enterprise-provider-editor']")).not.toBeNull();
    (el.querySelector("[data-testid='enterprise-provider-cancel']") as HTMLButtonElement).click();
    await el.updateComplete;
    expect(el.querySelector("[data-testid='enterprise-byok-authorize-hint']")).not.toBeNull();
    (
      el.querySelector("[data-testid='enterprise-open-model-authorization']") as HTMLButtonElement
    ).click();
    expect(onOpenAuthorization).toHaveBeenCalledTimes(1);

    (el.querySelector("[data-testid='enterprise-provider-verify']") as HTMLButtonElement).click();
    await settle(el);
    expect(calls.some((call) => call.method === "enterprise-model-provider.test")).toBe(true);

    (el.querySelector("[data-testid='enterprise-provider-edit']") as HTMLButtonElement).click();
    await el.updateComplete;
    expect(el.querySelector("[data-testid='enterprise-provider-editor']")).not.toBeNull();
    expect(
      (el.querySelector("[data-testid='enterprise-provider-display-name']") as HTMLInputElement)
        .value,
    ).toBe("内网推理");
    (el.querySelector("[data-testid='enterprise-provider-cancel']") as HTMLButtonElement).click();
    await el.updateComplete;

    (el.querySelector("[data-testid='enterprise-provider-rotate']") as HTMLButtonElement).click();
    await el.updateComplete;
    setField(el, "enterprise-provider-rotate-key", "sk-rotated");
    (
      el.querySelector("[data-testid='enterprise-provider-rotate-form']") as HTMLFormElement
    ).requestSubmit();
    await settle(el);
    expect(
      calls.find((call) => call.method === "enterprise-model-provider.rotate-credential")?.params,
    ).toMatchObject({
      connectionId: "conn-1",
      apiKey: "sk-rotated",
    });

    (el.querySelector("[data-testid='enterprise-provider-remove']") as HTMLButtonElement).click();
    await settle(el);
    expect(calls.some((call) => call.method === "enterprise-model-provider.delete")).toBe(true);
    confirm.mockRestore();
  });

  it("keeps platform rows read-only and writes the same seat grant for both supply types", async () => {
    const { client, calls } = clientFor({
      "enterprise-model-provider.list": () => ({
        tenantId: "acme",
        connections: [connection({ status: "verified", displayName: "内网推理" })],
      }),
      "enterprise-model-catalog.list": () => ({
        tenantId: "acme",
        assets: [
          {
            tenantId: "acme",
            assetId: "asset-1",
            connectionId: "conn-1",
            runtimeModelId: "ent/conn1/qwen",
            upstreamModelId: "qwen",
            displayName: "通义",
            source: "enterprise",
            billingOwner: "enterprise",
            enabled: true,
            healthStatus: "unknown",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      }),
      "enterprise-model-grant.list": () => ({
        entitlement: null,
        allowedModelIds: [],
        grants: [
          {
            tenantId: "acme",
            subjectType: "seat",
            subjectId: "seat-a",
            seatId: "seat-a",
            grantedModelIds: ["ent/conn1/qwen", "platform/keep"],
            status: "active",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      }),
      "enterprise-model-grant.grantBatch": () => ({ grants: [] }),
    });
    const el = document.createElement("enterprise-integrations-providers");
    el.client = client as never;
    el.enterpriseId = "acme";
    el.catalogProviderIds = ["openai"];
    el.catalogModelIds = ["openai/gpt-5.4"];
    el.orgRoster = {
      departmentPaths: ["研发"],
      seats: [
        {
          seatId: "seat-a",
          title: "工程师",
          teamLabel: "研发",
          status: "active",
          roleCode: null,
          occupantLabel: null,
          occupantUser: null,
        },
        {
          seatId: "seat-b",
          title: "设计",
          teamLabel: "研发",
          status: "active",
          roleCode: null,
          occupantLabel: null,
          occupantUser: null,
        },
      ],
      members: [],
    };
    document.body.append(el);
    await settle(el);

    expect(el.querySelector("[data-testid='enterprise-model-key-table']")).not.toBeNull();
    expect(el.textContent).toContain("模型名称");
    expect(el.textContent).toContain("供给方");
    expect(el.textContent).toContain("模型配置");
    expect(el.textContent).toContain("平台提供");
    expect(el.textContent).toContain("企业自供");
    expect(el.querySelector("[data-testid='enterprise-provider-remove']")).not.toBeNull();
    expect(
      el.querySelector("[data-testid='enterprise-model-name'][data-supply='platform']"),
    ).not.toBeNull();
    (
      el.querySelector(
        "[data-testid='enterprise-model-name'][data-model-id='openai/gpt-5.4']",
      ) as HTMLButtonElement
    ).click();
    await el.updateComplete;
    expect(el.querySelector("[data-testid='enterprise-platform-model-detail']")).not.toBeNull();
    expect(el.querySelector("[data-testid='enterprise-provider-editor']")).toBeNull();
    expect(el.querySelector("[data-testid='enterprise-provider-submit']")).toBeNull();

    const seatButtons = [
      ...el.querySelectorAll("[data-testid='enterprise-model-seat-config']"),
    ] as HTMLButtonElement[];
    expect(
      seatButtons
        .map((button) => button.dataset.supply)
        .toSorted((a, b) => (a ?? "").localeCompare(b ?? "")),
    ).toEqual(["enterprise", "platform"]);
    const privateSeat = seatButtons.find((button) => button.dataset.modelId === "ent/conn1/qwen");
    privateSeat?.click();
    await settle(el);
    expect(el.querySelector("[data-testid='enterprise-model-seat-panel']")).not.toBeNull();

    const boxes = [...el.querySelectorAll("input[type='checkbox']")] as HTMLInputElement[];
    const unchecked = boxes.find((box) => !box.checked);
    unchecked?.click();
    await el.updateComplete;
    (el.querySelector("[data-testid='enterprise-model-seat-save']") as HTMLButtonElement).click();
    await settle(el);

    const platformSeat = [
      ...el.querySelectorAll("[data-testid='enterprise-model-seat-config']"),
    ].find((button) => (button as HTMLButtonElement).dataset.modelId === "openai/gpt-5.4") as
      | HTMLButtonElement
      | undefined;
    platformSeat?.click();
    await settle(el);
    const designSeat = [...el.querySelectorAll("input[type='checkbox']")].find((box) =>
      (box as HTMLInputElement).getAttribute("aria-label")?.includes("设计"),
    ) as HTMLInputElement | undefined;
    designSeat?.click();
    await el.updateComplete;
    (el.querySelector("[data-testid='enterprise-model-seat-save']") as HTMLButtonElement).click();
    await settle(el);

    const batches = calls.filter((call) => call.method === "enterprise-model-grant.grantBatch");
    expect(batches).toHaveLength(2);
    const grantIds = batches.map((call) => {
      const grants = call.params.grants as Array<{
        subjectId: string;
        mergeMode: string;
        grantedModelIds: string[];
      }>;
      return grants.find((grant) => grant.subjectId === "seat-b");
    });
    expect(grantIds).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          mergeMode: "union",
          grantedModelIds: ["ent/conn1/qwen"],
        }),
        expect.objectContaining({
          mergeMode: "union",
          grantedModelIds: ["openai/gpt-5.4"],
        }),
      ]),
    );
    expect(calls.some((call) => call.method === "models.probe")).toBe(false);
    expect(calls.some((call) => call.method === "enterprise-model-provider.delete")).toBe(false);
  });

  it("disables provider and seat actions when the gateway is not connected", async () => {
    const el = document.createElement("enterprise-integrations-providers");
    el.client = null;
    el.enterpriseId = "acme";
    el.catalogModelIds = ["openai/gpt-5.4"];
    document.body.append(el);
    await settle(el);

    expect(el.textContent).toContain("未连接网关");
    const add = el.querySelector("[data-testid='enterprise-add-provider']") as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    expect(add.title).toContain("未连接网关");
    const seat = el.querySelector(
      "[data-testid='enterprise-model-seat-config']",
    ) as HTMLButtonElement;
    expect(seat.disabled).toBe(true);
    seat.click();
    await el.updateComplete;
    expect(el.textContent).not.toContain("席位授权没有变化");
  });
});
