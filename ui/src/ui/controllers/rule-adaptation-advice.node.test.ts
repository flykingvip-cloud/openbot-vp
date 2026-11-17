import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EMPLOYEE_ADVICE_CANCEL_METHOD,
  EMPLOYEE_ADVICE_METHOD,
} from "../chat/rule-adaptation-advice-panel.ts";
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

  it("sends only question, targetRef, and a correlation requestId to the gateway method", async () => {
    const request = vi.fn(async (method: string, params: unknown) => {
      expect(method).toBe(EMPLOYEE_ADVICE_METHOD);
      const record = params as { question?: unknown; targetRef?: unknown; requestId?: unknown };
      expect(record.question).toBe("上下文太大");
      expect(record.targetRef).toEqual({ sessionKey: "agent:main", agentId: "bot" });
      expect(typeof record.requestId).toBe("string");
      expect(String(record.requestId).length).toBeGreaterThan(0);
      expect(Object.keys(params as object).toSorted()).toEqual([
        "question",
        "requestId",
        "targetRef",
      ]);
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
    expect(ruleAdaptationAdviceClientContract.allowedKeys).toEqual([
      "question",
      "targetRef",
      "requestId",
    ]);
    expect(ruleAdaptationAdviceClientContract.cancelMethod).toBe(EMPLOYEE_ADVICE_CANCEL_METHOD);
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

  it("sends cancel to the server and drops a stale result after cancel or refresh", async () => {
    let resolveRequest: (value: unknown) => void = () => undefined;
    const pending = new Promise((resolve) => {
      resolveRequest = resolve;
    });
    const request = vi.fn(async (method: string, _params?: unknown) => {
      if (method === EMPLOYEE_ADVICE_CANCEL_METHOD) {
        return { cancelled: true };
      }
      return pending;
    });
    const first = requestRuleAdaptationAdvice({ client: { request }, question: "one" });
    const started = request.mock.calls.find((call) => call[0] === EMPLOYEE_ADVICE_METHOD) as
      | [string, { requestId?: string }]
      | undefined;
    const requestId = started?.[1]?.requestId;
    expect(typeof requestId).toBe("string");
    cancelRuleAdaptationAdvice();
    await Promise.resolve();
    expect(getRuleAdaptationAdvicePanel().status).toBe("cancelled");
    expect(request).toHaveBeenCalledWith(EMPLOYEE_ADVICE_CANCEL_METHOD, { requestId });
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
