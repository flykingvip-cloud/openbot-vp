import { describe, expect, it } from "vitest";
import {
  BROWSER_PLAN_ONCE_LEGAL_DOM_IMPL,
  DEFAULT_MAX_ACTIONS,
  DEFAULT_MAX_REPLANS,
  DEFAULT_QUIET_MS,
  DEFAULT_SETTLE_TIMEOUT_MS,
  allowsChatFinal,
  compileShapeBToA,
  createRunProgress,
  decideReplanOrTerminal,
  groundStep,
  isAmbientOnlySignatureChange,
  isForbiddenPaymentControl,
  isPauseTerminal,
  normalizeBudgets,
  noteFrontierReplan,
  runPlanOnce,
  settleConfig,
  toBrowserActBody,
  verifyTypeValue,
  type LegalDomSnapshot,
  type ShapeBPlan,
} from "./browser-plan-once.js";

function snap(elements: LegalDomSnapshot["elements"], signature = "s1"): LegalDomSnapshot {
  return { elements, signature };
}

describe("BROWSER_PLAN_ONCE_LEGAL_DOM_IMPL contract", () => {
  it("exports landing id and settle/budget defaults", () => {
    expect(BROWSER_PLAN_ONCE_LEGAL_DOM_IMPL).toBe("BROWSER_PLAN_ONCE_LEGAL_DOM_IMPL");
    expect(DEFAULT_MAX_ACTIONS).toBe(20);
    expect(DEFAULT_MAX_REPLANS).toBe(2);
    expect(DEFAULT_QUIET_MS).toBe(150);
    expect(DEFAULT_SETTLE_TIMEOUT_MS).toBe(2000);
    expect(settleConfig()).toEqual({ quiet_ms: 150, settle_timeout_ms: 2000 });
  });

  it("Shape B without budgets still enforces defaults 20 / 2", () => {
    const b = normalizeBudgets({});
    expect(b).toEqual({ max_actions: 20, max_replans: 2 });
    const progress = createRunProgress({ steps: [] } as unknown as ShapeBPlan);
    expect(progress.maxActions).toBe(20);
    expect(progress.maxReplans).toBe(2);
    const a = compileShapeBToA({ summary: "x", steps: [] });
    expect(a.max_actions).toBe(20);
    expect(a.max_replans).toBe(2);
  });
});

describe("legal DOM grounding", () => {
  const snapshot = snap([
    { id: "e1", role: "button", name: "加入购物车", enabled: true, visible: true },
    { id: "e2", role: "textbox", name: "搜索", value: "", enabled: true, visible: true },
    { id: "e3", role: "button", name: "加入购物车", near: "sidebar", enabled: true, visible: true },
    { id: "e4", role: "button", name: "灰按钮", enabled: false, visible: true },
  ]);

  it("accepts exact label match", () => {
    const g = groundStep({ action: "click", target: "搜索", role: "textbox" }, snapshot);
    expect(g.ok).toBe(true);
    if (g.ok) {
      expect(g.id).toBe("e2");
    }
  });

  it("rejects targets absent from snapshot", () => {
    const g = groundStep({ action: "click", target: "不存在的按钮" }, snapshot);
    expect(g.ok).toBe(false);
    if (!g.ok) {
      expect(g.reason).toBe("miss");
    }
  });

  it("rejects stale id not in latest snapshot", () => {
    const g = groundStep({ action: "click", id: "e99" }, snapshot);
    expect(g.ok).toBe(false);
    if (!g.ok) {
      expect(g.reason).toBe("miss");
    }
  });

  it("reports ambiguity when role/near still leave duplicates", () => {
    const g = groundStep({ action: "click", target: "加入购物车" }, snapshot);
    expect(g.ok).toBe(false);
    if (!g.ok) {
      expect(g.reason).toBe("ambiguous");
    }
  });

  it("disambiguates with near", () => {
    const g = groundStep({ action: "click", target: "加入购物车", near: "sidebar" }, snapshot);
    expect(g.ok).toBe(true);
    if (g.ok) {
      expect(g.id).toBe("e3");
    }
  });

  it("denies coordinate-only clicks", () => {
    const g = groundStep({ action: "click", x: 10, y: 20 }, snapshot);
    expect(g.ok).toBe(false);
    if (!g.ok) {
      expect(g.reason).toBe("coordinate_denied");
    }
  });

  it("press/wait do not require snapshot id", () => {
    expect(groundStep({ action: "press", key: "Enter" }, snapshot)).toMatchObject({
      ok: false,
      reason: "no_id_required",
    });
    expect(groundStep({ action: "wait" }, snapshot)).toMatchObject({
      ok: false,
      reason: "no_id_required",
    });
  });
});

describe("settle / verify", () => {
  it("ignores ambient-only signature churn", () => {
    expect(isAmbientOnlySignatureChange("clock 12:01 cart", "clock 12:02 cart")).toBe(true);
    expect(isAmbientOnlySignatureChange("load 10%", "load 55%")).toBe(true);
    expect(isAmbientOnlySignatureChange("page A", "page B")).toBe(false);
  });

  it("verify fails when type value mismatches", () => {
    expect(verifyTypeValue("hello", "hello")).toBe(true);
    expect(verifyTypeValue("hello", "hell")).toBe(false);
    expect(verifyTypeValue("hello", undefined)).toBe(false);
  });
});

describe("Replan vs terminal table", () => {
  it("missing OTP/password → NEEDS_INPUT and does not consume replans", () => {
    const progress = createRunProgress({});
    expect(progress.replansUsed).toBe(0);
    const d = decideReplanOrTerminal({ situation: "missing_literal", progress });
    expect(d.kind).toBe("NEEDS_INPUT");
    expect(progress.replansUsed).toBe(0);
  });

  it("grounding miss / ambiguity → NEEDS_AGENT without burning max_replans", () => {
    const progress = createRunProgress({});
    expect(decideReplanOrTerminal({ situation: "grounding_miss", progress }).kind).toBe(
      "NEEDS_AGENT",
    );
    expect(decideReplanOrTerminal({ situation: "grounding_ambiguous", progress }).kind).toBe(
      "NEEDS_AGENT",
    );
    expect(progress.replansUsed).toBe(0);
  });

  it("anti-loop same action+state → BLOCKED (deterministic)", () => {
    const progress = createRunProgress({});
    const d = decideReplanOrTerminal({ situation: "anti_loop_same_action_state", progress });
    expect(d.kind).toBe("BLOCKED");
  });

  it("anti-loop same action ≥3 → BLOCKED", () => {
    const progress = createRunProgress({});
    expect(
      decideReplanOrTerminal({ situation: "anti_loop_same_action_thrice", progress }).kind,
    ).toBe("BLOCKED");
  });

  it("third frontier replan attempt → BLOCKED when max_replans=2", () => {
    const progress = createRunProgress({ max_replans: 2 });
    expect(noteFrontierReplan(progress).kind).toBe("REPLAN");
    expect(progress.replansUsed).toBe(1);
    expect(noteFrontierReplan(progress).kind).toBe("REPLAN");
    expect(progress.replansUsed).toBe(2);
    const third = noteFrontierReplan(progress);
    expect(third.kind).toBe("BLOCKED");
  });

  it("verify fail with replan budget → REPLAN; exhausted → BLOCKED", () => {
    const progress = createRunProgress({ max_replans: 1 });
    expect(
      decideReplanOrTerminal({
        situation: "verify_fail",
        progress,
        remainingPlannedSteps: 0,
      }).kind,
    ).toBe("REPLAN");
    progress.replansUsed = 1;
    expect(
      decideReplanOrTerminal({
        situation: "verify_fail",
        progress,
        remainingPlannedSteps: 0,
      }).kind,
    ).toBe("BLOCKED");
  });

  it("policy 立即支付 → FAIL; 扫码 → NEEDS_INPUT", () => {
    const progress = createRunProgress({});
    expect(decideReplanOrTerminal({ situation: "policy_violation", progress }).kind).toBe("FAIL");
    expect(decideReplanOrTerminal({ situation: "policy_scan_pay", progress }).kind).toBe(
      "NEEDS_INPUT",
    );
    expect(isForbiddenPaymentControl("立即支付")).toBe(true);
    expect(isForbiddenPaymentControl("确认付款")).toBe(true);
    expect(isForbiddenPaymentControl("加入购物车")).toBe(false);
  });

  it("M2: only DONE allows chat.final; NEEDS_*/BLOCKED/FAIL forbid it", () => {
    expect(allowsChatFinal("DONE")).toBe(true);
    for (const s of ["FAIL", "NEEDS_INPUT", "NEEDS_AGENT", "BLOCKED", "REPLAN"] as const) {
      expect(allowsChatFinal(s)).toBe(false);
    }
    expect(isPauseTerminal("NEEDS_INPUT")).toBe(true);
    expect(isPauseTerminal("DONE")).toBe(false);
  });
});

describe("runPlanOnce integration (injected observe/execute)", () => {
  it("grounds and clicks a legal id; finishes_task → DONE; allowsChatFinal", async () => {
    let signature = "home";
    const elements = [{ id: "e1", role: "button", name: "去结算", enabled: true, visible: true }];
    const executed: string[] = [];
    const result = await runPlanOnce(
      {
        finishes_task: true,
        summary: "go checkout",
        steps: [{ action: "click", target: "去结算" }],
      },
      {
        observe: () => snap(elements, signature),
        execute: (req) => {
          executed.push(JSON.stringify(req));
          signature = "checkout";
        },
      },
    );
    expect(executed).toEqual(['{"action":"click","id":"e1"}']);
    expect(result.status).toBe("DONE");
    expect(result.allowsChatFinal).toBe(true);
    expect(result.progress.actionsUsed).toBe(1);
  });

  it("rejects click on absent label → NEEDS_AGENT; no chat.final", async () => {
    const result = await runPlanOnce(
      { steps: [{ action: "click", target: "幽灵按钮" }] },
      {
        observe: () =>
          snap([{ id: "e1", role: "button", name: "真实", enabled: true, visible: true }]),
        execute: async () => {
          throw new Error("should not execute");
        },
      },
    );
    expect(result.status).toBe("NEEDS_AGENT");
    expect(result.allowsChatFinal).toBe(false);
    expect(result.progress.replansUsed).toBe(0);
  });

  it("missing OTP text → NEEDS_INPUT with zero replans", async () => {
    const result = await runPlanOnce(
      {
        steps: [{ action: "type", target: "验证码", role: "textbox" }],
      },
      {
        observe: () =>
          snap([
            { id: "otp", role: "textbox", name: "验证码", value: "", enabled: true, visible: true },
          ]),
        execute: async () => {
          throw new Error("should not type invented OTP");
        },
      },
    );
    expect(result.status).toBe("NEEDS_INPUT");
    expect(result.progress.replansUsed).toBe(0);
    expect(result.allowsChatFinal).toBe(false);
  });

  it("anti-loop blocks identical action+state on second admit", async () => {
    const executed: string[] = [];
    const result = await runPlanOnce(
      {
        steps: [{ action: "wait" }, { action: "wait" }],
      },
      {
        observe: () => snap([], "frozen"),
        execute: async (req) => {
          executed.push(req.action);
        },
      },
    );
    expect(executed).toEqual(["wait"]);
    expect(result.status).toBe("BLOCKED");
    expect(result.reason).toMatch(/anti-loop/i);
    expect(result.allowsChatFinal).toBe(false);
  });

  it("blocks 立即支付 without executing", async () => {
    let executed = false;
    const result = await runPlanOnce(
      { steps: [{ action: "click", target: "立即支付" }] },
      {
        observe: () =>
          snap([{ id: "pay", role: "button", name: "立即支付", enabled: true, visible: true }]),
        execute: async () => {
          executed = true;
        },
      },
    );
    expect(executed).toBe(false);
    expect(result.status).toBe("FAIL");
    expect(result.allowsChatFinal).toBe(false);
  });

  it("max_actions exhausted → BLOCKED", async () => {
    let n = 0;
    const result = await runPlanOnce(
      {
        max_actions: 2,
        max_replans: 0,
        steps: [{ action: "wait" }, { action: "wait" }, { action: "wait" }],
      },
      {
        observe: () => snap([], `s${n++}`),
        execute: async () => {},
      },
    );
    expect(result.status).toBe("BLOCKED");
    expect(result.progress.actionsUsed).toBeLessThanOrEqual(2);
    expect(result.allowsChatFinal).toBe(false);
  });

  it("successful type verifies field value", async () => {
    const elements = [
      { id: "q", role: "textbox", name: "搜索", value: "", enabled: true, visible: true },
    ];
    const result = await runPlanOnce(
      {
        finishes_task: true,
        steps: [{ action: "type", target: "搜索", text: "特步" }],
      },
      {
        observe: () => snap(elements, "form"),
        execute: (req) => {
          if (req.action === "type") {
            elements[0].value = req.text;
          }
        },
      },
    );
    expect(result.status).toBe("DONE");
    expect(elements[0].value).toBe("特步");
  });
});

describe("toBrowserActBody plug-in", () => {
  it("maps grounded click/type to existing /act kind+ref", () => {
    expect(toBrowserActBody({ action: "click", id: "e12" })).toEqual({
      kind: "click",
      ref: "e12",
    });
    expect(toBrowserActBody({ action: "type", id: "e2", text: "hi" })).toEqual({
      kind: "type",
      ref: "e2",
      text: "hi",
    });
    expect(toBrowserActBody({ action: "press", key: "Enter" })).toEqual({
      kind: "press",
      key: "Enter",
    });
  });
});
