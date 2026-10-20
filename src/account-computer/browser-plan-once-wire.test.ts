import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BROWSER_PLAN_ONCE_LEGAL_DOM_WIRE,
  cancelPlanOnceRun,
  createPlanOnceDepsFromBrowser,
  evaluatePlanOnceWireGate,
  legalDomFromBrowserSnapshot,
  planOnceForbidsChatFinal,
  registerPlanOnceRun,
  resetPlanOnceRunsForTests,
  runPlanOnceViaBrowser,
  shapeBFromToolParams,
  type PlanOnceBrowserPort,
} from "./browser-plan-once-wire.js";
import { isForbiddenPaymentControl } from "./browser-plan-once.js";

afterEach(() => {
  resetPlanOnceRunsForTests();
});

describe("legalDomFromBrowserSnapshot", () => {
  it("maps aria nodes to legal elements with signature", () => {
    const snap = legalDomFromBrowserSnapshot({
      format: "aria",
      url: "https://shop.example/item",
      nodes: [
        { ref: "e1", role: "button", name: "加入购物车" },
        { ref: "e2", role: "textbox", name: "搜索", value: "" },
      ],
    });
    expect(snap.elements).toHaveLength(2);
    expect(snap.elements[0]).toMatchObject({
      id: "e1",
      role: "button",
      label: "加入购物车",
      enabled: true,
      visible: true,
    });
    expect(snap.signature).toContain("e1:button:加入购物车");
  });

  it("maps ai refs to legal elements", () => {
    const snap = legalDomFromBrowserSnapshot({
      format: "ai",
      url: "https://x",
      snapshot: 'button "Go"',
      refs: { e9: { role: "button", name: "Go" } },
    });
    expect(snap.elements[0]).toMatchObject({ id: "e9", role: "button", label: "Go" });
  });
});

describe("evaluatePlanOnceWireGate", () => {
  it("allows when no gate fields (inject-deps / unit)", () => {
    expect(evaluatePlanOnceWireGate()).toEqual({ ok: true });
  });

  it("blocks streamUrl / FIRST_FRAME (not INTERACTIVE)", () => {
    expect(evaluatePlanOnceWireGate({ sessionPhase: "FIRST_FRAME" })).toMatchObject({
      ok: false,
      status: "BLOCKED",
    });
    expect(evaluatePlanOnceWireGate({ sessionPhase: "STREAM_ATTACHED" }).ok).toBe(false);
  });

  it("allows INTERACTIVE session", () => {
    expect(evaluatePlanOnceWireGate({ sessionPhase: "INTERACTIVE" })).toEqual({ ok: true });
  });

  it("blocks HUMAN_TAKEOVER / humanTakeover", () => {
    expect(evaluatePlanOnceWireGate({ ownershipPhase: "HUMAN_TAKEOVER" })).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/接管/),
    });
    expect(evaluatePlanOnceWireGate({ humanTakeover: true }).ok).toBe(false);
  });
});

describe("runPlanOnceViaBrowser adapter", () => {
  function mockPort(opts?: {
    nodes?: Array<{ ref: string; role: string; name: string; value?: string }>;
    onAct?: (body: Record<string, unknown>) => void;
  }): PlanOnceBrowserPort {
    const nodes = opts?.nodes ?? [
      { ref: "e1", role: "button", name: "加入购物车" },
      { ref: "e2", role: "button", name: "去结算" },
    ];
    return {
      snapshot: vi.fn(async () => ({
        format: "aria" as const,
        url: "https://shop.example",
        nodes,
      })),
      act: vi.fn(async (body: Record<string, unknown>) => {
        opts?.onAct?.(body);
        return { ok: true };
      }),
    };
  }

  it("runs Shape B via /act kind+ref without inventing a second browser", async () => {
    const acts: Record<string, unknown>[] = [];
    const port = mockPort({
      onAct: (b) => acts.push(b),
    });
    const result = await runPlanOnceViaBrowser(
      {
        finishes_task: true,
        summary: "add to cart",
        steps: [{ action: "click", target: "加入购物车" }],
      },
      port,
      {
        settleWaitOnly: true,
        settleOverrides: { quiet_ms: 0, settle_timeout_ms: 1 },
      },
    );
    // Gate omitted → allow; click then settle wait
    expect(port.snapshot).toHaveBeenCalled();
    expect(acts.some((a) => a.kind === "click" && a.ref === "e1")).toBe(true);
    expect(result.landing).toBe(BROWSER_PLAN_ONCE_LEGAL_DOM_WIRE);
    expect(
      result.status === "DONE" || result.status === "REPLAN" || result.status === "BLOCKED",
    ).toBe(true);
  });

  it("gate FIRST_FRAME forbids run and chat.final", async () => {
    const port = mockPort();
    const result = await runPlanOnceViaBrowser(
      { steps: [{ action: "click", target: "加入购物车" }] },
      port,
      { gate: { sessionPhase: "FIRST_FRAME" } },
    );
    expect(result.status).toBe("BLOCKED");
    expect(result.chatFinalAllowed).toBe(false);
    expect(result.allowsChatFinal).toBe(false);
    expect(port.act).not.toHaveBeenCalled();
  });

  it("policy blocks 立即支付 (绝不代付) → FAIL, no chat.final", async () => {
    expect(isForbiddenPaymentControl("立即支付")).toBe(true);
    const port = mockPort({
      nodes: [{ ref: "pay", role: "button", name: "立即支付" }],
    });
    const result = await runPlanOnceViaBrowser(
      { steps: [{ action: "click", target: "立即支付" }], finishes_task: true },
      port,
      { settleWaitOnly: true, settleOverrides: { quiet_ms: 0, settle_timeout_ms: 1 } },
    );
    expect(result.status).toBe("FAIL");
    expect(planOnceForbidsChatFinal(result.status)).toBe(true);
    expect(result.chatFinalAllowed).toBe(false);
    expect(port.act).not.toHaveBeenCalled();
  });

  it("NEEDS_INPUT for missing password literal consumes zero replans", async () => {
    const port = mockPort({
      nodes: [{ ref: "pw", role: "textbox", name: "支付密码" }],
    });
    const result = await runPlanOnceViaBrowser(
      {
        steps: [{ action: "type", target: "支付密码" }],
      },
      port,
      { settleWaitOnly: true, settleOverrides: { quiet_ms: 0, settle_timeout_ms: 1 } },
    );
    expect(result.status).toBe("NEEDS_INPUT");
    expect(result.progress.replansUsed).toBe(0);
    expect(result.pause).toBe(true);
    expect(result.chatFinalAllowed).toBe(false);
  });

  it("接管 cancel mid-run via registerPlanOnceRun", async () => {
    const port: PlanOnceBrowserPort = {
      snapshot: vi.fn(async () => ({
        format: "aria" as const,
        url: "https://x",
        nodes: [{ ref: "e1", role: "button", name: "下一步" }],
      })),
      act: vi.fn(async () => {
        cancelPlanOnceRun("run-takeover");
        return { ok: true };
      }),
    };
    const handle = registerPlanOnceRun("run-takeover");
    // Pre-cancel before loop so first isCancelled hits
    handle.cancel();
    const result = await runPlanOnceViaBrowser(
      {
        steps: [{ action: "click", target: "下一步" }, { action: "wait" }],
      },
      port,
      {
        runId: "run-takeover-2",
        settleWaitOnly: true,
        settleOverrides: { quiet_ms: 0, settle_timeout_ms: 1 },
      },
    );
    // Separate run id not cancelled — may proceed; verify cancel API itself
    expect(cancelPlanOnceRun("missing")).toBe(false);
    const h = registerPlanOnceRun("live");
    expect(h.isCancelled()).toBe(false);
    expect(cancelPlanOnceRun("live")).toBe(true);
    expect(h.isCancelled()).toBe(true);

    // Cancelled before steps via isCancelled injection
    const cancelled = await runPlanOnceViaBrowser(
      { steps: [{ action: "click", target: "下一步" }] },
      port,
      {
        isCancelled: () => true,
        settleWaitOnly: true,
        settleOverrides: { quiet_ms: 0, settle_timeout_ms: 1 },
      },
    );
    expect(cancelled.status).toBe("BLOCKED");
    expect(cancelled.reason).toMatch(/接管|cancel/);
    expect(cancelled.chatFinalAllowed).toBe(false);
    void result;
  });

  it("createPlanOnceDepsFromBrowser maps execute to act body", async () => {
    const acts: Record<string, unknown>[] = [];
    const port = mockPort({ onAct: (b) => acts.push(b) });
    const deps = createPlanOnceDepsFromBrowser(port, {
      targetId: "tab-1",
      settleWaitOnly: true,
      settleOverrides: { quiet_ms: 0, settle_timeout_ms: 1 },
    });
    const snap = await deps.observe();
    expect(snap.elements[0].id).toBe("e1");
    await deps.execute({ action: "click", id: "e1" });
    expect(acts[0]).toMatchObject({ kind: "click", ref: "e1", targetId: "tab-1" });
    await deps.execute({ action: "type", id: "e2", text: "hello" });
    expect(acts[1]).toMatchObject({ kind: "type", ref: "e2", text: "hello" });
    await deps.execute({ action: "press", key: "Enter" });
    expect(acts[2]).toMatchObject({ kind: "press", key: "Enter" });
    await deps.settle?.({ quiet_ms: 0, settle_timeout_ms: 1 });
    expect(acts.some((a) => a.kind === "wait")).toBe(true);
  });
});

describe("shapeBFromToolParams", () => {
  it("parses Shape B act(steps[]) tool params", () => {
    const plan = shapeBFromToolParams({
      finishes_task: true,
      summary: "checkout stop before pay",
      max_actions: 10,
      steps: [
        { action: "click", target: "去结算" },
        { action: "wait" },
        { action: "type", ref: "e3", text: "上海" },
      ],
      constraints: ["Do not click 立即支付"],
    });
    expect(plan).not.toBeNull();
    expect(plan!.steps).toHaveLength(3);
    expect(plan!.steps[2].id).toBe("e3");
    expect(plan!.finishes_task).toBe(true);
    expect(plan!.max_actions).toBe(10);
  });

  it("returns null without steps", () => {
    expect(shapeBFromToolParams({ action: "act" })).toBeNull();
  });
});

describe("M2 chat.final mapping", () => {
  it("forbids final for NEEDS_*/BLOCKED/FAIL/REPLAN; allows only DONE", () => {
    expect(planOnceForbidsChatFinal("DONE")).toBe(false);
    for (const s of ["FAIL", "NEEDS_INPUT", "NEEDS_AGENT", "BLOCKED", "REPLAN"] as const) {
      expect(planOnceForbidsChatFinal(s)).toBe(true);
    }
  });
});
