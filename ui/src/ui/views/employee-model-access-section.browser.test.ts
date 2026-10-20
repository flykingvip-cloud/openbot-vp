// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import "./employee-model-access-section.ts";

async function flush() {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function usageResponse(params: {
  provider: string;
  model: string;
  tokens: number;
  cost: number;
  count?: number;
}) {
  return {
    scope: "employee-visible",
    aggregatesComplete: true,
    totalSessions: 1,
    totals: { totalTokens: params.tokens, totalCost: params.cost },
    aggregates: {
      byModel: [
        {
          provider: params.provider,
          model: params.model,
          count: params.count ?? 1,
          totals: {
            input: params.tokens,
            output: 0,
            totalTokens: params.tokens,
            totalCost: params.cost,
          },
        },
      ],
    },
  };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("<employee-model-access-section> (browser)", () => {
  it("loads the read-only summary and renders available models", async () => {
    const request = vi.fn((method: string) => {
      if (method !== "employee-model-access.summary") {
        throw new Error(`unexpected ${method}`);
      }
      return Promise.resolve({
        summary: {
          modelIds: ["p/a", "p/b"],
          state: "resolved",
          reason: "可用",
          seatId: "seat-9",
        },
      });
    });
    const el = document.createElement("employee-model-access-section");
    el.client = { request, connected: true } as never;
    document.body.appendChild(el);
    await flush();
    await el.updateComplete;
    const text = el.textContent ?? "";
    expect(text).toContain("我的可用模型");
    expect(text).toContain("2 个可用模型");
    expect(el.querySelector('[title="p/a"]')).not.toBeNull();
    expect(el.querySelector('[title="p/b"]')).not.toBeNull();
    expect(text).not.toContain("seat-9");
    expect(request).toHaveBeenCalledWith("employee-model-access.summary", {});
  });

  it("renders embedded mode without outer card title (system settings path)", async () => {
    const request = vi.fn((method: string) => {
      if (method === "employee-model-access.summary") {
        return Promise.resolve({
          summary: {
            modelIds: ["openai/gpt-4o"],
            state: "resolved",
            reason: "可用",
          },
        });
      }
      if (method === "sessions.usage") {
        return Promise.resolve(
          usageResponse({ provider: "openai", model: "gpt-4o", tokens: 100, cost: 0.01 }),
        );
      }
      throw new Error(`unexpected ${method}`);
    });
    const el = document.createElement("employee-model-access-section");
    el.embedded = true;
    el.client = { request, connected: true } as never;
    document.body.appendChild(el);
    await flush();
    await el.updateComplete;
    const text = el.textContent ?? "";
    expect(text).not.toContain("我的可用模型");
    expect(text).toContain("1 个可用模型");
    expect(el.querySelector(".employee-model-access--embedded")).not.toBeNull();
    expect(el.querySelector(".employee-model-access__model")).not.toBeNull();
    expect(el.querySelector('[title="openai/gpt-4o"]')).not.toBeNull();
  });

  it("degrades to missing summary when the RPC fails", async () => {
    const request = vi.fn(() => Promise.reject(new Error("boom")));
    const el = document.createElement("employee-model-access-section");
    el.client = { request, connected: true } as never;
    document.body.appendChild(el);
    await flush();
    await el.updateComplete;
    const badge = el.querySelector("[data-status]");
    expect(badge?.getAttribute("data-status")).toBe("未配置授权");
  });

  it("loads after client is injected post-mount", async () => {
    const request = vi.fn((method: string) => {
      if (method !== "employee-model-access.summary") {
        throw new Error(`unexpected ${method}`);
      }
      return Promise.resolve({
        summary: {
          modelIds: ["p/late"],
          state: "resolved",
          reason: "可用",
          seatId: "seat-late",
        },
      });
    });
    const el = document.createElement("employee-model-access-section");
    document.body.appendChild(el);
    await flush();
    el.client = { request, connected: true } as never;
    await flush();
    await el.updateComplete;
    expect(el.querySelector('[title="p/late"]')).not.toBeNull();
    expect(el.textContent ?? "").toContain("late");
    expect(request).toHaveBeenCalledWith("employee-model-access.summary", {});
  });

  it("并行加载 sessions.usage 并渲染各模型消费量", async () => {
    const request = vi.fn((method: string) => {
      if (method === "employee-model-access.summary") {
        return Promise.resolve({
          summary: {
            modelIds: ["openai/gpt-4o"],
            state: "resolved",
            reason: "可用",
            seatId: "seat-1",
          },
        });
      }
      if (method === "sessions.usage") {
        return Promise.resolve({
          scope: "employee-visible",
          aggregatesComplete: true,
          totalSessions: 2,
          totals: { totalTokens: 1200, totalCost: 0.42 },
          aggregates: {
            byModel: [
              {
                provider: "openai",
                model: "gpt-4o",
                count: 4,
                totals: { input: 300, output: 900, totalTokens: 1200, totalCost: 0.42 },
              },
            ],
          },
        });
      }
      throw new Error(`unexpected ${method}`);
    });
    const el = document.createElement("employee-model-access-section");
    el.client = { request, connected: true } as never;
    document.body.appendChild(el);
    await flush();
    await el.updateComplete;
    const text = el.textContent ?? "";
    expect(text).toContain("模型消费量");
    expect(text).toContain("openai/gpt-4o");
    expect(text).toContain("1,200");
    expect(request).toHaveBeenCalledWith(
      "sessions.usage",
      expect.objectContaining({ limit: 1, aggregateAll: true, scope: "self" }),
    );
  });

  it("拒绝 gateway scope（非员工可见）的 usage 响应", async () => {
    const request = vi.fn((method: string) => {
      if (method === "employee-model-access.summary") {
        return Promise.resolve({
          summary: { modelIds: ["p/a"], state: "resolved", reason: "可用" },
        });
      }
      if (method === "sessions.usage") {
        return Promise.resolve({
          scope: "gateway",
          aggregatesComplete: true,
          totalSessions: 1,
          totals: { totalTokens: 99, totalCost: 0.01 },
          aggregates: {
            byModel: [
              {
                provider: "p",
                model: "a",
                count: 1,
                totals: { input: 99, output: 0, totalTokens: 99, totalCost: 0.01 },
              },
            ],
          },
        });
      }
      throw new Error(`unexpected ${method}`);
    });
    const el = document.createElement("employee-model-access-section");
    el.client = { request, connected: true } as never;
    document.body.appendChild(el);
    await flush();
    await el.updateComplete;

    const text = el.textContent ?? "";
    expect(text).toContain("用量暂不可用");
    expect(text).not.toContain("99 tokens");
    expect(text).not.toContain("近 30 天暂无模型调用记录");
  });

  it("aggregatesComplete=false 但 totals 自洽时展示可确认用量（partial）", async () => {
    const request = vi.fn((method: string) => {
      if (method === "employee-model-access.summary") {
        return Promise.resolve({
          summary: { modelIds: ["p/a"], state: "resolved", reason: "可用" },
        });
      }
      if (method === "sessions.usage") {
        return Promise.resolve({
          scope: "employee-visible",
          aggregatesComplete: false,
          totalSessions: 3,
          totals: { totalTokens: 99, totalCost: 0.01 },
          aggregates: {
            byModel: [
              {
                provider: "p",
                model: "a",
                count: 1,
                totals: { input: 99, output: 0, totalTokens: 99, totalCost: 0.01 },
              },
            ],
          },
        });
      }
      throw new Error(`unexpected ${method}`);
    });
    const el = document.createElement("employee-model-access-section");
    el.client = { request, connected: true } as never;
    document.body.appendChild(el);
    await flush();
    await el.updateComplete;

    const text = el.textContent ?? "";
    expect(text).not.toContain("用量暂不可用");
    expect(text).toContain("99");
    // Partial footnote copy was removed; totals-coherent partial still shows usage.
    expect(text).toContain("近 30 天");
  });

  it("拒绝 malformed usage 行并显示不可用", async () => {
    const request = vi.fn((method: string) => {
      if (method === "employee-model-access.summary") {
        return Promise.resolve({
          summary: { modelIds: ["p/a"], state: "resolved", reason: "可用" },
        });
      }
      if (method === "sessions.usage") {
        return Promise.resolve({
          scope: "employee-visible",
          aggregatesComplete: true,
          totalSessions: 1,
          totals: { totalTokens: 10, totalCost: 0.01 },
          aggregates: {
            byModel: [
              {
                provider: "p",
                model: "a",
                count: 1,
                totals: { input: 10, output: 0, totalTokens: "10", totalCost: 0.01 },
              },
            ],
          },
        });
      }
      throw new Error(`unexpected ${method}`);
    });
    const el = document.createElement("employee-model-access-section");
    el.client = { request, connected: true } as never;
    document.body.appendChild(el);
    await flush();
    await el.updateComplete;

    expect(el.textContent ?? "").toContain("用量暂不可用");
  });

  it.each([
    ["negative metrics", usageResponse({ provider: "p", model: "a", tokens: -1, cost: 0 })],
    [
      "fractional count",
      usageResponse({ provider: "p", model: "a", tokens: 10, cost: 0.01, count: 1.5 }),
    ],
    ["blank identity", usageResponse({ provider: " ", model: " ", tokens: 10, cost: 0.01 })],
    [
      "provider-only identity",
      {
        ...usageResponse({ provider: "openai", model: "gpt-4o", tokens: 10, cost: 0.01 }),
        aggregates: {
          byModel: [
            {
              provider: "openai",
              count: 1,
              totals: { input: 10, output: 0, totalTokens: 10, totalCost: 0.01 },
            },
          ],
        },
      },
    ],
    [
      "model-only identity",
      {
        ...usageResponse({ provider: "openai", model: "gpt-4o", tokens: 10, cost: 0.01 }),
        aggregates: {
          byModel: [
            {
              model: "openai/gpt-4o",
              count: 1,
              totals: { input: 10, output: 0, totalTokens: 10, totalCost: 0.01 },
            },
          ],
        },
      },
    ],
    [
      "unsafe integer tokens",
      usageResponse({
        provider: "p",
        model: "a",
        tokens: Number.MAX_SAFE_INTEGER + 2,
        cost: 0.01,
      }),
    ],
    [
      "zero sessions with usage",
      {
        ...usageResponse({ provider: "p", model: "a", tokens: 10, cost: 0.01 }),
        totalSessions: 0,
      },
    ],
    [
      "unattributed nonzero totals",
      {
        ...usageResponse({ provider: "p", model: "a", tokens: 10, cost: 0.01 }),
        aggregates: { byModel: [] },
      },
    ],
    [
      "token totals mismatch",
      {
        ...usageResponse({ provider: "p", model: "a", tokens: 10, cost: 0.01 }),
        totals: { totalTokens: 11, totalCost: 0.01 },
      },
    ],
    [
      "cost totals mismatch",
      {
        ...usageResponse({ provider: "p", model: "a", tokens: 10, cost: 0.01 }),
        totals: { totalTokens: 10, totalCost: 0.02 },
      },
    ],
    [
      "missing totalSessions",
      {
        ...usageResponse({ provider: "p", model: "a", tokens: 10, cost: 0.01 }),
        totalSessions: undefined,
      },
    ],
  ])("拒绝负数、小数或 top-level 对账失败：%s", async (_caseName, usage) => {
    const request = vi.fn((method: string) => {
      if (method === "employee-model-access.summary") {
        return Promise.resolve({
          summary: { modelIds: ["p/a"], state: "resolved", reason: "可用" },
        });
      }
      if (method === "sessions.usage") {
        return Promise.resolve(usage);
      }
      throw new Error(`unexpected ${method}`);
    });
    const el = document.createElement("employee-model-access-section");
    el.client = { request, connected: true } as never;
    document.body.appendChild(el);
    await flush();
    await el.updateComplete;

    expect(el.textContent ?? "").toContain("用量暂不可用");
    expect(el.textContent ?? "").not.toContain("近 30 天暂无模型调用记录");
  });

  it("client 切换后忽略旧员工的延迟响应", async () => {
    const employeeASummary = deferred<{
      summary: { modelIds: string[]; state: "resolved"; reason: string; seatId: string };
    }>();
    const requestA = vi.fn((method: string) => {
      if (method === "employee-model-access.summary") {
        return employeeASummary.promise;
      }
      if (method === "sessions.usage") {
        return Promise.resolve(
          usageResponse({ provider: "p", model: "a", tokens: 10, cost: 0.01 }),
        );
      }
      throw new Error(`unexpected ${method}`);
    });
    const requestB = vi.fn((method: string) => {
      if (method === "employee-model-access.summary") {
        return Promise.resolve({
          summary: {
            modelIds: ["p/b"],
            state: "resolved",
            reason: "B 可用",
            seatId: "seat-b",
          },
        });
      }
      if (method === "sessions.usage") {
        return Promise.resolve(
          usageResponse({ provider: "p", model: "b", tokens: 20, cost: 0.02 }),
        );
      }
      throw new Error(`unexpected ${method}`);
    });

    const el = document.createElement("employee-model-access-section");
    el.client = { request: requestA, connected: true } as never;
    document.body.appendChild(el);
    await flush();

    el.client = { request: requestB, connected: true } as never;
    await flush();
    await el.updateComplete;
    expect(el.textContent ?? "").toContain("p/b");
    expect(el.textContent ?? "").toContain("20");

    employeeASummary.resolve({
      summary: {
        modelIds: ["p/a"],
        state: "resolved",
        reason: "A 可用",
        seatId: "seat-a",
      },
    });
    await flush();
    await el.updateComplete;

    const text = el.textContent ?? "";
    expect(el.querySelector('[title="p/b"]')).not.toBeNull();
    expect(el.querySelector('[title="p/a"]')).toBeNull();
    expect(text).toContain("b");
    expect(text).not.toContain("seat-b");
    expect(text).not.toContain("seat-a");
  });

  it("sessions.usage 失败时仍展示可用模型并明确用量不可用", async () => {
    const request = vi.fn((method: string) => {
      if (method === "employee-model-access.summary") {
        return Promise.resolve({
          summary: { modelIds: ["p/a"], state: "resolved", reason: "可用" },
        });
      }
      return Promise.reject(new Error("usage boom"));
    });
    const el = document.createElement("employee-model-access-section");
    el.client = { request, connected: true } as never;
    document.body.appendChild(el);
    await flush();
    await el.updateComplete;
    const text = el.textContent ?? "";
    expect(el.querySelector('[title="p/a"]')).not.toBeNull();
    expect(text).toContain("用量暂不可用");
    expect(text).not.toContain("近 30 天暂无模型调用记录");
  });
});
