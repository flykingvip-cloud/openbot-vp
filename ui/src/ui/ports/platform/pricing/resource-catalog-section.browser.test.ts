// @vitest-environment jsdom
import { render } from "lit";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { i18n } from "../../../../i18n/index.ts";
import { zh_CN } from "../../../../i18n/locales/zh-CN.ts";
import { handleCatalogPolicyRpc } from "./browser-test-helpers.ts";
import {
  __resetResourceCatalogSectionForTest,
  renderPlatformResourceCatalogSection,
} from "./resource-catalog-section.ts";

type GatewayBrowserClient = import("../../../gateway.ts").GatewayBrowserClient;
type RpcCall = { method: string; params?: Record<string, unknown> };

beforeAll(async () => {
  i18n.registerTranslation("zh-CN", zh_CN);
  await i18n.setLocale("zh-CN");
});

afterEach(() => {
  document.body.innerHTML = "";
  __resetResourceCatalogSectionForTest();
});

function makeClient(calls: RpcCall[]): GatewayBrowserClient {
  return {
    request: async (method: string, params?: Record<string, unknown>) => {
      calls.push({ method, params });
      const res = handleCatalogPolicyRpc(method, [{ id: "plan-1" }], params);
      if (res !== undefined) {
        return res;
      }
      throw new Error(`unexpected method ${method}`);
    },
    connected: true,
  } as never;
}

function mount(client: GatewayBrowserClient): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const doRender = () => render(renderPlatformResourceCatalogSection(client, doRender), container);
  doRender();
  return container;
}

// fixture 中的 openai/gpt-4o 成本为 0/0、tier_a。
const INPUT_SELECTOR = '[data-testid="model-cost-input-openai/gpt-4o"]';
const SAVE_SELECTOR = '[data-testid="model-cost-save-openai/gpt-4o"]';

describe("resource catalog model cost editor", () => {
  it("renders cost inputs and flags unpriced models", async () => {
    const container = mount(makeClient([]));
    await vi.waitFor(() =>
      expect(container.querySelector('[data-testid="model-cost-table"]')).toBeTruthy(),
    );
    expect(container.querySelector(INPUT_SELECTOR)).toBeTruthy();
    // 两个 fixture 模型成本都是 0/0 → 未定价标记。
    expect(
      container.querySelector('[data-testid="model-cost-unpriced-openai/gpt-4o"]'),
    ).toBeTruthy();
  });

  it("saves edited provider cost via models.upsert", async () => {
    const calls: RpcCall[] = [];
    const container = mount(makeClient(calls));
    await vi.waitFor(() => expect(container.querySelector(INPUT_SELECTOR)).toBeTruthy());

    const input = container.querySelector<HTMLInputElement>(INPUT_SELECTOR);
    expect(input).toBeTruthy();
    input!.value = "2160";
    input!.dispatchEvent(new Event("input"));

    await vi.waitFor(() => {
      const btn = container.querySelector<HTMLButtonElement>(SAVE_SELECTOR);
      expect(btn).toBeTruthy();
      expect(btn?.disabled).toBe(false);
    });
    container.querySelector<HTMLButtonElement>(SAVE_SELECTOR)!.click();

    await vi.waitFor(() => {
      const upsert = calls.find((c) => c.method === "platform-resource-catalog.models.upsert");
      expect(upsert).toBeTruthy();
      expect(upsert?.params).toMatchObject({
        modelId: "openai/gpt-4o",
        tier: "tier_a",
        inputCostPer1MCents: 2160,
        outputCostPer1MCents: 0,
      });
    });
  });

  it("keeps save disabled until a value changes", async () => {
    const container = mount(makeClient([]));
    await vi.waitFor(() => expect(container.querySelector(SAVE_SELECTOR)).toBeTruthy());
    const btn = container.querySelector<HTMLButtonElement>(SAVE_SELECTOR);
    expect(btn?.disabled).toBe(true);
  });
});
