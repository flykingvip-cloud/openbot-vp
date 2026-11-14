import { afterEach, describe, expect, it, vi } from "vitest";
import { EMPLOYEE_ADVICE_METHOD } from "../chat/rule-adaptation-advice-panel.ts";
import {
  cancelRuleAdaptationAdvice,
  getRuleAdaptationAdvicePanel,
  isRuleAdaptationAdviceInFlight,
  requestRuleAdaptationAdvice,
  resetRuleAdaptationAdvicePanel,
  ruleAdaptationAdviceClientContract,
} from "./rule-adaptation-advice.ts";

vi.mock("../request-app-rerender.ts", () => ({
  requestOpenBotAppRerender: vi.fn(),
}));

describe("rule-adaptation-advice controller", () => {
  afterEach(() => {
    resetRuleAdaptationAdvicePanel();
  });

  it("sends only question and targetRef to the gateway method", async () => {
    const request = vi.fn(async (method: string, params: unknown) => {
      expect(method).toBe(EMPLOYEE_ADVICE_METHOD);
      expect(params).toEqual({
        question: "上下文太大",
        targetRef: { sessionKey: "agent:main", agentId: "bot" },
      });
      expect(Object.keys(params as object).toSorted()).toEqual(["question", "targetRef"]);
      return {
        advice: {
          state: "adjustment_suggested",
          label: "建议调整",
          notEffective: true,
          notEffectiveLabel: "尚未生效",
          summary: "ok",
          reasons: [],
          activationAllowed: false,
          requestId: "r1",
          modelCalled: true,
        },
      };
    });
    await requestRuleAdaptationAdvice({
      client: { request },
      question: "上下文太大",
      sessionKey: "agent:main",
      agentId: "bot",
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(getRuleAdaptationAdvicePanel().status).toBe("result");
    expect(getRuleAdaptationAdvicePanel().result?.label).toBe("建议调整");
    expect(ruleAdaptationAdviceClientContract.allowedKeys).toEqual(["question", "targetRef"]);
  });

  it("does not start a second request while one is in flight", async () => {
    let release: () => void = () => undefined;
    const pending = new Promise((resolve) => {
      release = () =>
        resolve({
          advice: {
            state: "no_change",
            label: "无需调整",
            notEffective: true,
            notEffectiveLabel: "尚未生效",
            summary: "ok",
            reasons: [],
            activationAllowed: false,
            requestId: "r1",
            modelCalled: true,
          },
        });
    });
    const request = vi.fn(async () => pending);
    const first = requestRuleAdaptationAdvice({ client: { request }, question: "one" });
    expect(isRuleAdaptationAdviceInFlight()).toBe(true);
    await requestRuleAdaptationAdvice({ client: { request }, question: "two" });
    expect(request).toHaveBeenCalledTimes(1);
    release();
    await first;
    expect(getRuleAdaptationAdvicePanel().result?.state).toBe("no_change");
  });

  it("drops a stale result after cancel or refresh", async () => {
    let resolveRequest: (value: unknown) => void = () => undefined;
    const pending = new Promise((resolve) => {
      resolveRequest = resolve;
    });
    const request = vi.fn(async () => pending);
    const first = requestRuleAdaptationAdvice({ client: { request }, question: "one" });
    cancelRuleAdaptationAdvice();
    expect(getRuleAdaptationAdvicePanel().status).toBe("cancelled");
    resolveRequest({
      advice: {
        state: "adjustment_suggested",
        label: "建议调整",
        notEffective: true,
        notEffectiveLabel: "尚未生效",
        summary: "stale",
        reasons: [],
        activationAllowed: false,
        requestId: "stale",
        modelCalled: true,
      },
    });
    await first;
    expect(getRuleAdaptationAdvicePanel().status).toBe("cancelled");
    expect(getRuleAdaptationAdvicePanel().result).toBeNull();
    resetRuleAdaptationAdvicePanel();
    expect(getRuleAdaptationAdvicePanel().status).toBe("idle");
    expect(getRuleAdaptationAdvicePanel().result).toBeNull();
  });
});
