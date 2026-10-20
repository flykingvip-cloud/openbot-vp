// @vitest-environment jsdom
// subscription-commerce Phase 6: 订单/发票 UI browser 回归

import { render } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../../../i18n/index.ts";
import type { GatewayBrowserClient } from "../../gateway.ts";
import {
  __resetCostBudgetOrdersPageForTest,
  renderCostBudgetOrdersPage,
} from "./cost-budget-orders.ts";

beforeEach(async () => {
  await i18n.setLocale("zh-CN");
  __resetCostBudgetOrdersPageForTest();
});

afterEach(() => {
  document.body.innerHTML = "";
});

function mockClient(responses: Record<string, unknown>): GatewayBrowserClient {
  return {
    request: vi.fn(async (method: string) => {
      if (method in responses) {
        return responses[method];
      }
      throw new Error(`unexpected method ${method}`);
    }),
    connected: true,
  } as unknown as GatewayBrowserClient;
}

function requestMock(client: GatewayBrowserClient): ReturnType<typeof vi.fn> {
  return (client as unknown as { request: ReturnType<typeof vi.fn> }).request;
}

async function renderOrders(client: GatewayBrowserClient): Promise<HTMLElement> {
  const container = document.createElement("div");
  const doRender = () => render(renderCostBudgetOrdersPage(client, doRender), container);
  doRender();
  await vi.waitFor(() => {
    expect(container.querySelector('[data-testid="cost-budget-orders"]')).toBeTruthy();
    expect(container.textContent).not.toContain("加载订单");
  });
  return container;
}

const BANK_TRANSFER = {
  accountName: "OpenBot Ltd",
  bankName: "Test Bank",
  accountNumber: "6222020000000000",
  remarkHint: "备注订单号",
};

const INVOICE_CONTEXT_EMPTY = {
  "billing-profile.get": { profile: null, complete: false },
  "invoices.list": { requests: [] },
};

describe("CostBudget commerce UI", () => {
  it("订单页空态", async () => {
    const container = await renderOrders(
      mockClient({
        ...INVOICE_CONTEXT_EMPTY,
        "commercial-orders.list": { orders: [] },
        "commercial-orders.checkout-info": { bankTransfer: BANK_TRANSFER },
      }),
    );
    expect(container.textContent).toContain("暂无商业订单");
    expect(container.querySelector('[data-testid="order-detail"]')).toBeNull();
  });

  it("订单列表展示本地化类型与状态徽章", async () => {
    const container = await renderOrders(
      mockClient({
        ...INVOICE_CONTEXT_EMPTY,
        "commercial-orders.list": {
          orders: [
            {
              id: "ord-60169444-32ea-4094-9119-7bd1332822c1",
              kind: "change_plan",
              status: "paid",
              amountCents: 176351,
              createdAt: "2026-06-22T04:59:54.000Z",
              lineItems: [
                {
                  label: "剩余周期应付 · 旗舰版 · v:pv-scale",
                  amountCents: 176351,
                },
              ],
            },
          ],
        },
        "commercial-orders.checkout-info": { bankTransfer: BANK_TRANSFER },
      }),
    );

    expect(container.querySelector(".cost-budget-orders__table")).toBeTruthy();
    expect(container.querySelector('[data-testid="orders-panel"]')).toBeTruthy();
    expect(container.textContent).toContain("旗舰版");
    expect(container.textContent).toContain("已支付");
    expect(container.textContent).toContain("1,763");
    expect(container.textContent).toContain(".51");
    expect(container.textContent).toContain("共 1 笔");
    expect(container.textContent).toContain("已支付 1 笔");
    expect(container.textContent).toContain("总金额");
    expect(container.textContent).toContain("OB-20260622-6016");
    expect(container.querySelector(".cost-budget-orders__status-pill--success")).toBeTruthy();
    expect(container.textContent).not.toContain("change_plan");
  });

  it("待支付订单列表展示去支付按钮", async () => {
    const container = await renderOrders(
      mockClient({
        ...INVOICE_CONTEXT_EMPTY,
        "commercial-orders.list": {
          orders: [
            {
              id: "ord-pending-table",
              kind: "subscribe",
              status: "pending_payment",
              amountCents: 9900,
              createdAt: "2026-06-19T08:00:00.000Z",
            },
          ],
        },
        "commercial-orders.checkout-info": { bankTransfer: BANK_TRANSFER },
      }),
    );

    const payBtn = container.querySelector('[data-testid="order-pay-now"]') as HTMLButtonElement;
    expect(payBtn).toBeTruthy();
    expect(payBtn.textContent).toContain("去支付");
    payBtn.click();
    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="order-detail-drawer"]')).toBeTruthy();
    });
  });

  it("订单列表支持搜索筛选", async () => {
    const container = await renderOrders(
      mockClient({
        ...INVOICE_CONTEXT_EMPTY,
        "commercial-orders.list": {
          orders: [
            {
              id: "ord-paid-search-a",
              kind: "subscribe",
              status: "paid",
              amountCents: 100,
              createdAt: "2026-06-22T04:59:54.000Z",
              lineItems: [{ label: "旗舰版 · monthly", amountCents: 100 }],
            },
            {
              id: "ord-paid-search-b",
              kind: "subscribe",
              status: "paid",
              amountCents: 200,
              createdAt: "2026-06-21T04:59:54.000Z",
              lineItems: [{ label: "基础版 · monthly", amountCents: 200 }],
            },
          ],
        },
        "commercial-orders.checkout-info": { bankTransfer: BANK_TRANSFER },
      }),
    );

    const searchInput = container.querySelector(
      '[data-testid="orders-search-input"]',
    ) as HTMLInputElement;
    expect(searchInput).toBeTruthy();
    searchInput.value = "旗舰";
    searchInput.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.waitFor(() => {
      expect(container.querySelectorAll('[data-testid="order-row"]').length).toBe(1);
      expect(container.textContent).toContain("旗舰版");
      expect(container.textContent).not.toContain("基础版");
    });
  });

  it("订单列表支持状态筛选", async () => {
    const container = await renderOrders(
      mockClient({
        ...INVOICE_CONTEXT_EMPTY,
        "commercial-orders.list": {
          orders: [
            {
              id: "ord-paid-filter",
              kind: "subscribe",
              status: "paid",
              amountCents: 100,
              createdAt: "2026-06-22T04:59:54.000Z",
            },
            {
              id: "ord-pending-filter",
              kind: "subscribe",
              status: "pending_payment",
              amountCents: 200,
              createdAt: "2026-06-21T04:59:54.000Z",
            },
          ],
        },
        "commercial-orders.checkout-info": { bankTransfer: BANK_TRANSFER },
      }),
    );

    const statusFilter = container.querySelector(
      '[data-testid="orders-status-filter"]',
    ) as HTMLSelectElement;
    statusFilter.value = "pending_payment";
    statusFilter.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.waitFor(() => {
      expect(container.querySelectorAll('[data-testid="order-row"]').length).toBe(1);
      expect(container.textContent).toContain("去支付");
    });
  });

  it("点击订单行打开右侧详情抽屉", async () => {
    const container = await renderOrders(
      mockClient({
        ...INVOICE_CONTEXT_EMPTY,
        "commercial-orders.list": {
          orders: [
            {
              id: "ord-pending-1",
              kind: "subscribe",
              status: "pending_payment",
              amountCents: 9900,
              createdAt: "2026-06-19T08:00:00.000Z",
              lineItems: [{ label: "Pro", amountCents: 9900 }],
            },
          ],
        },
        "commercial-orders.checkout-info": { bankTransfer: BANK_TRANSFER },
      }),
    );

    const row = container.querySelector('[data-testid="order-row"]') as HTMLElement;
    row.click();
    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="order-detail-drawer"]')).toBeTruthy();
      expect(container.querySelector('[data-testid="order-detail"]')).toBeTruthy();
    });

    expect(container.querySelector('[data-testid="checkout-bank-transfer"]')).toBeTruthy();
    expect(container.textContent).toContain("6222020000000000");
    expect(container.querySelector('[data-testid="pay-stripe"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="pay-alipay"]')).toBeTruthy();
  });

  it("发票资料未完成时展示提示并引导完善资料", async () => {
    const container = await renderOrders(
      mockClient({
        ...INVOICE_CONTEXT_EMPTY,
        "commercial-orders.list": {
          orders: [
            {
              id: "ord-paid-1",
              kind: "subscribe",
              status: "paid",
              amountCents: 9900,
              paidAt: "2026-06-19T09:00:00.000Z",
              createdAt: "2026-06-19T08:00:00.000Z",
            },
          ],
        },
        "commercial-orders.checkout-info": { bankTransfer: BANK_TRANSFER },
      }),
    );

    (container.querySelector('[data-testid="order-row"]') as HTMLElement).click();
    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="order-invoice-action"]')).toBeTruthy();
    });

    expect(container.textContent).toContain("请先保存完整开票资料后再申请发票");
    expect(container.querySelector('[data-testid="invoice-request-order"]')).toBeNull();
    expect(container.querySelector('[data-testid="invoice-open-profile"]')).toBeTruthy();
  });

  it("开票资料抽屉可从订单页打开", async () => {
    const container = await renderOrders(
      mockClient({
        ...INVOICE_CONTEXT_EMPTY,
        "commercial-orders.list": { orders: [] },
        "commercial-orders.checkout-info": { bankTransfer: BANK_TRANSFER },
      }),
    );
    (container.querySelector('[data-testid="orders-open-profile"]') as HTMLButtonElement).click();
    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="billing-profile-drawer"]')).toBeTruthy();
      expect(container.querySelector('[data-testid="billing-profile-form"]')).toBeTruthy();
    });
  });

  it("已支付订单详情可发起开票申请", async () => {
    const client = mockClient({
      "billing-profile.get": {
        profile: {
          enterpriseId: "ent-1",
          legalName: "Acme 科技",
          taxId: "91110000MA0000000X",
          invoiceType: "vat_special",
          updatedAt: "2026-06-19T08:00:00.000Z",
        },
        complete: true,
      },
      "invoices.list": { requests: [] },
      "commercial-orders.list": {
        orders: [
          {
            id: "ord-paid-3",
            kind: "recharge",
            status: "paid",
            amountCents: 5000,
            paidAt: "2026-06-19T09:00:00.000Z",
            createdAt: "2026-06-19T08:00:00.000Z",
          },
        ],
      },
      "commercial-orders.checkout-info": { bankTransfer: BANK_TRANSFER },
      "invoices.request": { request: { id: "inv-req-3", status: "pending" } },
    });

    const container = await renderOrders(client);
    (container.querySelector('[data-testid="order-row"]') as HTMLElement).click();
    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="order-invoice-action"]')).toBeTruthy();
    });

    const requestBtn = container.querySelector(
      '[data-testid="invoice-request-order"]',
    ) as HTMLButtonElement;
    expect(requestBtn.disabled).toBe(false);
    requestBtn.click();

    await vi.waitFor(() => {
      expect(requestMock(client)).toHaveBeenCalledWith("invoices.request", {
        orderId: "ord-paid-3",
      });
    });
  });
});
