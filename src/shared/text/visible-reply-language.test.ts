import { describe, expect, it } from "vitest";
import {
  enforceVisibleReplyLanguage,
  enforceVisibleReplyLanguageFromCache,
  registerVisibleReplyRewriter,
  resetVisibleReplyLanguageForTest,
  visibleReplyCjkRatio,
  visibleReplyNeedsChineseRewrite,
} from "./visible-reply-language.js";

const ABORTED_CHECKOUT =
  "I aborted the checkout because the cart changed while the page was updating. The item was removed before payment, so I did not place the order.";

describe("visible reply language", () => {
  it("rewrites the 08:33:52 English checkout answer once", async () => {
    resetVisibleReplyLanguageForTest();
    expect(visibleReplyNeedsChineseRewrite(ABORTED_CHECKOUT, "zh")).toBe(true);
    expect(visibleReplyCjkRatio(ABORTED_CHECKOUT)).toBeLessThan(0.2);
    let calls = 0;
    registerVisibleReplyRewriter("run-976c3ba5", async () => {
      calls += 1;
      return "我中止了结账，因为页面更新时购物车变了。商品在付款前被移除，所以没有下单。";
    });
    const first = await enforceVisibleReplyLanguage({
      text: ABORTED_CHECKOUT,
      expectedLanguage: "zh",
      runId: "run-976c3ba5",
    });
    const second = await enforceVisibleReplyLanguage({
      text: ABORTED_CHECKOUT,
      expectedLanguage: "zh",
      runId: "run-976c3ba5",
    });
    expect(first).toContain("我中止了结账");
    expect(second).toBe(first);
    expect(calls).toBe(1);
    expect(
      enforceVisibleReplyLanguageFromCache({
        text: ABORTED_CHECKOUT,
        expectedLanguage: "zh",
      }),
    ).toBe(first);
    resetVisibleReplyLanguageForTest();
  });

  it("does not rewrite a Chinese answer that only adds a URL and a product name", () => {
    const text =
      "已打开京东（JD.COM）订单页 https://order.jd.com/center/list.action ，没有待支付订单。";
    expect(visibleReplyNeedsChineseRewrite(text, "zh")).toBe(false);
    expect(visibleReplyCjkRatio(text)).toBeGreaterThanOrEqual(0.2);
  });

  it("ignores code fences when measuring the reply language", () => {
    const text = ["结果如下", "```", "I aborted the checkout because the cart changed", "```"].join(
      "\n",
    );
    expect(visibleReplyNeedsChineseRewrite(text, "zh")).toBe(false);
  });

  it("leaves English turns and unregistered runs unchanged", async () => {
    resetVisibleReplyLanguageForTest();
    expect(visibleReplyNeedsChineseRewrite(ABORTED_CHECKOUT, "en")).toBe(false);
    await expect(
      enforceVisibleReplyLanguage({
        text: ABORTED_CHECKOUT,
        expectedLanguage: "zh",
        runId: "missing",
      }),
    ).resolves.toBe(ABORTED_CHECKOUT);
  });
});
