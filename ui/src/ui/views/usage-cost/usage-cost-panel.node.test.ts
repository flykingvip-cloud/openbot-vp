// @vitest-environment jsdom

import { render } from "lit";
import { describe, expect, it } from "vitest";
import {
  presentUsageCostLayer,
  type UsageRequestFact,
} from "../../../../../src/gateway/billing/usage-cost-layer.ts";
import type { UsageCostLayerView } from "../../../../../src/shared/usage-cost-layer.ts";
import {
  __resetUsageCostSlotsForTest,
  __seedUsageCostSlotForTest,
  usageCostSlotKey,
} from "./usage-cost-client.ts";
import { renderUsageCostDisclosure, renderUsageCostPanel } from "./usage-cost-panel.ts";

function fact(overrides: Partial<UsageRequestFact> = {}): UsageRequestFact {
  return {
    requestId: "req",
    taskId: "child",
    parentTaskId: "parent",
    role: "request",
    revision: 1,
    occurredAt: "2026-11-01T00:00:00.000Z",
    enterpriseId: "ent-a",
    userId: "user-a",
    assistantId: "bot-a",
    provider: "openai",
    model: "gpt-test",
    purpose: null,
    taskType: null,
    status: "succeeded",
    attempt: "fallback",
    inputTokens: 11,
    outputTokens: 4,
    cacheReadTokens: null,
    cacheWriteTokens: 0,
    latencyMs: 10,
    acceptance: null,
    anomaly: false,
    settlement: { kind: "pending", credits: 2 },
    procurementCents: null,
    procurementCurrency: null,
    revenueCents: null,
    ...overrides,
  };
}

function viewFor(surface: "user" | "enterprise" | "platform"): UsageCostLayerView {
  const presented = presentUsageCostLayer(
    {
      surface,
      userId: surface === "platform" ? "ops" : "user-a",
      enterpriseId: surface === "platform" ? null : "ent-a",
      enterpriseWide: surface !== "user",
    },
    [fact()],
  );
  if (!presented.ok) {
    throw new Error(presented.message);
  }
  return presented.view;
}

describe("usage cost panel", () => {
  it("renders the same production projection on the three surfaces", () => {
    const user = viewFor("user");
    const enterprise = viewFor("enterprise");
    const platform = viewFor("platform");
    expect(user.input.known).toBe(enterprise.input.known);
    expect(enterprise.input.known).toBe(platform.input.known);
    const container = document.createElement("div");
    document.body.append(container);
    render(renderUsageCostPanel(user, { surface: "user", status: "ready" }), container);
    const summary = container.querySelector("summary");
    expect(summary?.textContent).toContain("待核对");
    expect(container.querySelector("[data-testid='usage-cost-detail']")?.textContent).toContain(
      "未知",
    );
    expect(container.textContent).toContain("待结算");
    expect(container.textContent).not.toContain("采购成本");
    const detail = container.querySelector("[data-testid='usage-cost-detail']");
    const details = detail?.parentElement;
    expect(details?.tagName).toBe("DETAILS");
    expect(details instanceof HTMLDetailsElement && details.open).toBe(false);

    render(
      renderUsageCostPanel(enterprise, {
        surface: "enterprise",
        status: "ready",
        budgetLevel: "alert",
      }),
      container,
    );
    expect(container.querySelector("[data-surface='enterprise']")).toBeTruthy();
    expect(container.textContent).toContain("已达到预算提醒阈值");
    expect(container.textContent).toContain("bot-a");
    expect(container.textContent).not.toContain("采购成本");

    render(renderUsageCostPanel(platform, { surface: "platform", status: "ready" }), container);
    expect(container.querySelector("[data-testid='usage-cost-platform']")?.textContent).toContain(
      "采购成本待确认",
    );
    expect(container.querySelector("[data-testid='usage-cost-unranked']")?.textContent).toContain(
      "未进入成本排名",
    );
    expect(container.textContent).toContain("已对齐");
    document.body.innerHTML = "";
  });

  it("reads a seeded query result from the task disclosure", () => {
    __resetUsageCostSlotsForTest();
    const view = viewFor("user");
    const key = usageCostSlotKey({ surface: "user", taskId: "parent" });
    __seedUsageCostSlotForTest(key, { status: "ready", view, error: null });
    const container = document.createElement("div");
    render(renderUsageCostDisclosure({ surface: "user", taskId: "parent" }), container);
    expect(container.querySelector("[data-testid='usage-cost-summary']")?.textContent).toContain(
      "待结算",
    );
    expect(container.textContent).not.toContain("采购成本");
    __resetUsageCostSlotsForTest();
  });
});
