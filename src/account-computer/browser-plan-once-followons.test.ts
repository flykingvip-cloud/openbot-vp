import { describe, expect, it } from "vitest";
import {
  BROWSER_PLAN_ONCE_LEGAL_DOM_FOLLOWONS,
  MAX_CHEAP_DISAMBIGUATIONS_PER_RUN,
  classifyControlRisk,
  createRunProgress,
  enrichSnapshotWithOcrFallback,
  filterLegalSnapshotForRisks,
  normalizeAllowedRisks,
  prepareObserveForModel,
  redactSnapshotSecrets,
  refuseRiskyControl,
  runPlanOnce,
  tryCheapDisambiguation,
  type LegalDomSnapshot,
  type PlanStep,
} from "./browser-plan-once.js";

function snap(elements: LegalDomSnapshot["elements"], signature = "s1"): LegalDomSnapshot {
  return { elements, signature };
}

describe("BROWSER_PLAN_ONCE_LEGAL_DOM_FOLLOWONS", () => {
  it("exports follow-ons landing id", () => {
    expect(BROWSER_PLAN_ONCE_LEGAL_DOM_FOLLOWONS).toBe("BROWSER_PLAN_ONCE_LEGAL_DOM_FOLLOWONS");
    expect(MAX_CHEAP_DISAMBIGUATIONS_PER_RUN).toBe(1);
  });
});

describe("allowed_risks", () => {
  it("default empty refuses purchase (不代付) including 立即支付", () => {
    expect(normalizeAllowedRisks(undefined).size).toBe(0);
    expect(normalizeAllowedRisks([]).size).toBe(0);
    expect(classifyControlRisk("立即支付")).toBe("purchase");
    expect(classifyControlRisk("提交订单")).toBe("purchase");
    expect(classifyControlRisk("删除")).toBe("delete");
    expect(classifyControlRisk("发送")).toBe("send");
    expect(classifyControlRisk("关闭账户")).toBe("close");
    expect(classifyControlRisk("加入购物车")).toBe(null);

    const iron = refuseRiskyControl({ label: "立即支付", allowed_risks: [] });
    expect(iron.refuse).toBe(true);
    if (iron.refuse) {
      expect(iron.risk).toBe("iron_pay");
    }

    // Even with purchase listed, iron pay-submit stays refused (consistent with wire).
    const stillIron = refuseRiskyControl({
      label: "立即支付",
      allowed_risks: ["purchase"],
    });
    expect(stillIron.refuse).toBe(true);

    const orderOk = refuseRiskyControl({
      label: "提交订单",
      allowed_risks: ["purchase"],
    });
    expect(orderOk.refuse).toBe(false);

    const orderBlocked = refuseRiskyControl({
      label: "提交订单",
      allowed_risks: [],
    });
    expect(orderBlocked.refuse).toBe(true);
  });

  it("hides risky controls from legal snapshot unless listed", () => {
    const snapshot = snap([
      { id: "a", role: "button", name: "加入购物车", enabled: true, visible: true },
      { id: "b", role: "button", name: "提交订单", enabled: true, visible: true },
      { id: "c", role: "button", name: "立即支付", enabled: true, visible: true },
      { id: "d", role: "button", name: "删除", enabled: true, visible: true },
    ]);
    const hidden = filterLegalSnapshotForRisks(snapshot, []);
    expect(hidden.elements.map((e) => e.id)).toEqual(["a"]);

    const withPurchase = filterLegalSnapshotForRisks(snapshot, ["purchase"]);
    // 立即支付 still hidden (iron); 提交订单 allowed
    expect(withPurchase.elements.map((e) => e.id).toSorted()).toEqual(["a", "b"]);
  });

  it("runPlanOnce refuses 提交订单 when purchase not allowed; no execute", async () => {
    let executed = false;
    const result = await runPlanOnce(
      { steps: [{ action: "click", target: "提交订单" }], allowed_risks: [] },
      {
        observe: () =>
          snap([{ id: "o", role: "button", name: "提交订单", enabled: true, visible: true }]),
        execute: async () => {
          executed = true;
        },
      },
    );
    expect(executed).toBe(false);
    expect(result.status).toBe("FAIL");
    expect(result.allowsChatFinal).toBe(false);
    expect(result.reason).toMatch(/purchase|不代付|policy/i);
  });

  it("runPlanOnce still hard-fails 立即支付 even when purchase allowed", async () => {
    let executed = false;
    const result = await runPlanOnce(
      {
        steps: [{ action: "click", target: "立即支付" }],
        allowed_risks: ["purchase"],
      },
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
  });
});

describe("secret_inputs", () => {
  it("redacts secret values from observe/model context", () => {
    const snapshot = snap([
      {
        id: "otp",
        role: "textbox",
        name: "验证码",
        value: "123456",
        enabled: true,
        visible: true,
      },
      {
        id: "q",
        role: "textbox",
        name: "搜索",
        value: "特步",
        enabled: true,
        visible: true,
      },
    ]);
    const redacted = redactSnapshotSecrets(snapshot, ["验证码"]);
    expect(redacted.elements.find((e) => e.id === "otp")?.value).toBe("[redacted]");
    expect(redacted.elements.find((e) => e.id === "q")?.value).toBe("特步");

    const prepared = prepareObserveForModel(snapshot, {
      secret_inputs: ["验证码"],
      allowed_risks: [],
    });
    expect(prepared.elements.find((e) => e.id === "otp")?.value).toBe("[redacted]");
  });

  it("types real secret from inputs at execute; never invents", async () => {
    const elements = [
      { id: "otp", role: "textbox", name: "验证码", value: "", enabled: true, visible: true },
    ];
    const typed: string[] = [];
    const result = await runPlanOnce(
      {
        finishes_task: true,
        secret_inputs: ["验证码"],
        inputs: { 验证码: "654321" },
        steps: [{ action: "type", target: "验证码", role: "textbox" }],
      },
      {
        observe: () => snap(elements, "login"),
        execute: (req) => {
          if (req.action === "type") {
            typed.push(req.text);
            elements[0].value = req.text;
          }
        },
      },
    );
    expect(result.status).toBe("DONE");
    expect(typed).toEqual(["654321"]);
  });

  it("missing secret_inputs value → NEEDS_INPUT with zero replans", async () => {
    const result = await runPlanOnce(
      {
        secret_inputs: ["密码"],
        inputs: {},
        steps: [{ action: "type", target: "密码", role: "textbox" }],
      },
      {
        observe: () =>
          snap([
            { id: "pw", role: "textbox", name: "密码", value: "", enabled: true, visible: true },
          ]),
        execute: async () => {
          throw new Error("must not invent secret");
        },
      },
    );
    expect(result.status).toBe("NEEDS_INPUT");
    expect(result.progress.replansUsed).toBe(0);
    expect(result.allowsChatFinal).toBe(false);
  });
});

describe("cheap non-frontier disambiguation", () => {
  it("one call resolves ambiguity without burning max_replans", async () => {
    const snapshot = snap([
      { id: "e1", role: "button", name: "加入购物车", near: "main", enabled: true, visible: true },
      {
        id: "e2",
        role: "button",
        name: "加入购物车",
        near: "sidebar",
        enabled: true,
        visible: true,
      },
    ]);
    let calls = 0;
    let signature = "list";
    const result = await runPlanOnce(
      {
        finishes_task: true,
        max_replans: 2,
        steps: [{ action: "click", target: "加入购物车" }],
      },
      {
        observe: () => snap(snapshot.elements, signature),
        execute: (req) => {
          if (req.action === "click" && req.id === "e2") {
            signature = "cart";
          }
        },
        disambiguate: (candidates) => {
          calls += 1;
          return candidates.find((c) => c.id === "e2") ?? null;
        },
      },
    );
    expect(calls).toBe(1);
    expect(result.status).toBe("DONE");
    expect(result.progress.replansUsed).toBe(0);
    expect(result.progress.cheapDisambiguationsUsed).toBe(1);
  });

  it("still ambiguous / no hook → NEEDS_AGENT; does not consume max_replans", async () => {
    const result = await runPlanOnce(
      {
        steps: [{ action: "click", target: "加入购物车" }],
      },
      {
        observe: () =>
          snap([
            { id: "e1", role: "button", name: "加入购物车", enabled: true, visible: true },
            { id: "e2", role: "button", name: "加入购物车", enabled: true, visible: true },
          ]),
        execute: async () => {
          throw new Error("should not execute");
        },
      },
    );
    expect(result.status).toBe("NEEDS_AGENT");
    expect(result.progress.replansUsed).toBe(0);
    expect(result.progress.cheapDisambiguationsUsed).toBe(0);
  });

  it("tryCheapDisambiguation respects per-run cap", async () => {
    const progress = createRunProgress({});
    const step: PlanStep = { action: "click", target: "X" };
    const candidates = [
      { id: "a", role: "button", name: "X", enabled: true, visible: true },
      { id: "b", role: "button", name: "X", enabled: true, visible: true },
    ];
    const first = await tryCheapDisambiguation({
      candidates,
      step,
      snapshot: snap(candidates),
      progress,
      disambiguate: () => candidates[0],
    });
    expect(first?.ok).toBe(true);
    expect(progress.cheapDisambiguationsUsed).toBe(1);
    const second = await tryCheapDisambiguation({
      candidates,
      step,
      snapshot: snap(candidates),
      progress,
      disambiguate: () => candidates[1],
    });
    expect(second).toBeNull();
    expect(progress.cheapDisambiguationsUsed).toBe(1);
    expect(progress.replansUsed).toBe(0);
  });
});

describe("OCR fallback (stub / optional enricher)", () => {
  it("not_needed when DOM has elements", async () => {
    const r = await enrichSnapshotWithOcrFallback(
      snap([{ id: "e1", role: "button", name: "OK", enabled: true, visible: true }]),
    );
    expect(r.status).toBe("not_needed");
  });

  it("unavailable when empty DOM and no OCR inject (stub)", async () => {
    const r = await enrichSnapshotWithOcrFallback(snap([]));
    expect(r.status).toBe("unavailable");
    expect(r.snapshot.elements).toEqual([]);
  });

  it("applied when host OCR returns canvas labels", async () => {
    const r = await enrichSnapshotWithOcrFallback(snap([]), async () => [
      { id: "ocr1", role: "button", name: "画布按钮", enabled: true, visible: true },
    ]);
    expect(r.status).toBe("applied");
    expect(r.snapshot.elements[0]?.name).toBe("画布按钮");
  });

  it("runPlanOnce OCR path completes DONE when observe reflects enrich", async () => {
    let elements: LegalDomSnapshot["elements"] = [];
    let signature = "canvas";
    const result = await runPlanOnce(
      {
        finishes_task: true,
        steps: [{ action: "click", target: "画布按钮" }],
      },
      {
        observe: () => snap(elements, signature),
        execute: (req) => {
          if (req.action === "click") {
            signature = "done";
          }
        },
        ocrFallback: async () => {
          elements = [
            { id: "ocr1", role: "button", name: "画布按钮", enabled: true, visible: true },
          ];
          return elements;
        },
      },
    );
    expect(result.status).toBe("DONE");
    expect(result.allowsChatFinal).toBe(true);
  });
});
