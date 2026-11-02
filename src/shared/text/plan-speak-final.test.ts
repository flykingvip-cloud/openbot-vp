import { describe, expect, it } from "vitest";
import {
  PLAN_SPEAK_PAUSE_CTA,
  isExecutionStallFinal,
  isPlanSpeakFinal,
  rewritePlanSpeakFinal,
  shouldApplyShoppingPauseCta,
} from "./plan-speak-final.js";

describe("plan-speak final gate (M2)", () => {
  it("flags 高密度分析-class early finals", () => {
    const leaked =
      "目前看到 ¥699 / ¥727。要确认全平台最低价，我需要把列表按价格排序，这一步正在做，随后我会打开详情页。";
    expect(isPlanSpeakFinal(leaked)).toBe(true);
    const out = rewritePlanSpeakFinal(leaked);
    expect(out).toContain("请确认");
    expect(out).toContain("接管");
    expect(out).not.toMatch(/这一步正在做/);
    expect(out).toContain("目前看到");
  });

  it("gates real 16:36 transcript that mentions 哪一单 mid-plan (not a user ask)", () => {
    const hd1636 =
      "搜索页只渲染出部分结果：目前看到的最低是 ¥699（特步京东自营旗舰店，丰配友破纪录同款 160X7.0pro 竞速碳板跑鞋男）和 ¥727（云泽途专营店的 160x7.0Pro 超级橙/黑 39）。要确认「全平台最低价」，我需要把列表按价格排序、逐个确认到 39 码男款的实际到手价，再决定下哪一单——这一步正在做，先把最便宜的前几个挑出来核对尺码和店铺，随后我会在提交订单前把商品、数量、价格、地址列给你确认（你已授权直接下单，但付款仍由你扫码，我不代付）。";
    expect(isPlanSpeakFinal(hd1636)).toBe(true);
    const out = rewritePlanSpeakFinal(hd1636);
    expect(out).toMatch(/请确认|接管/);
    expect(out).not.toMatch(/这一步正在做/);
  });

  it("keeps real 「哪一单？」 user questions as asks (not rewritten)", () => {
    const q = "两家都有 39 码，¥699 和 ¥727，你要下哪一单？";
    expect(isPlanSpeakFinal(q)).toBe(false);
    expect(rewritePlanSpeakFinal(q)).toBe(q);
  });

  it("still gates plan prose that only says 再决定下哪一单 without ？", () => {
    const mid = "目前看到 ¥699 / ¥727。我需要排序，这一步正在做，再决定下哪一单。";
    expect(isPlanSpeakFinal(mid)).toBe(true);
    expect(rewritePlanSpeakFinal(mid)).toContain("请确认");
  });

  it("keeps explicit confirm / takeover finals", () => {
    const ok = "已经到收银台二维码了，请扫码支付；或点「接管」自己看一眼。";
    expect(isPlanSpeakFinal(ok)).toBe(false);
    expect(rewritePlanSpeakFinal(ok)).toBe(ok);
  });

  it("keeps real questions", () => {
    const q = "列表里有 ¥699 和 ¥727，你要选哪个？";
    expect(isPlanSpeakFinal(q)).toBe(false);
    expect(rewritePlanSpeakFinal(q)).toBe(q);
  });

  it("rewrites bare plan speak to pause CTA", () => {
    expect(rewritePlanSpeakFinal("我继续去结算页。")).toBe(PLAN_SPEAK_PAUSE_CTA);
  });

  it("ignores ordinary completed answers", () => {
    const done = "已把特步 160X 加入购物车，合计 ¥699。";
    expect(isPlanSpeakFinal(done)).toBe(false);
  });

  it("does not treat bare 价格/支付 in research or analysis as shopping pause", () => {
    const researchPrice = "我继续把各厂商价格变化写进研究报告，这一步正在做。";
    expect(isPlanSpeakFinal(researchPrice)).toBe(true);
    expect(shouldApplyShoppingPauseCta(researchPrice, "写一份行业价格调研报告")).toBe(false);
    expect(rewritePlanSpeakFinal(researchPrice, "写一份行业价格调研报告")).toBe(researchPrice);

    const payAnalysis = "我需要先梳理支付权限问题，这一步正在做。";
    expect(rewritePlanSpeakFinal(payAnalysis, "分析一下登录与支付权限失败原因")).toBe(payAnalysis);
  });

  it("does not rewrite video/subtitle plan-speak into the shopping pause", () => {
    const video = "我继续处理视频字幕导出，这一步正在做。";
    expect(isPlanSpeakFinal(video)).toBe(true);
    expect(rewritePlanSpeakFinal(video, "帮我给这段视频加字幕")).toBe(video);
  });

  it("admits shopping pause when user goal is shopping even if markers are soft", () => {
    const soft = "我需要核对价格和规格，这一步正在做。";
    expect(shouldApplyShoppingPauseCta(soft, "帮我比价买鞋")).toBe(true);
    expect(rewritePlanSpeakFinal(soft, "帮我比价买鞋")).toBe(PLAN_SPEAK_PAUSE_CTA);
  });

  it("does not rewrite typeset or research plan-speak into the shopping pause", () => {
    const typeset = "我需要把这篇公众号文章排版，这一步正在做，随后我会推草稿箱。";
    expect(isPlanSpeakFinal(typeset)).toBe(true);
    expect(rewritePlanSpeakFinal(typeset)).toBe(typeset);
    const research = "我继续把调研报告写完。";
    expect(rewritePlanSpeakFinal(research)).toBe(research);
    expect(rewritePlanSpeakFinal("我继续。", "开始排版和发布这篇文章到公众号")).toBe("我继续。");
  });

  it("still rewrites shopping plan-speak when the sentence names a price or checkout", () => {
    expect(rewritePlanSpeakFinal("我继续去结算页。")).toBe(PLAN_SPEAK_PAUSE_CTA);
    expect(rewritePlanSpeakFinal("我继续去结算页。", "开始排版和发布这篇文章到公众号")).toBe(
      PLAN_SPEAK_PAUSE_CTA,
    );
  });

  it("does not rewrite the WeChat holding line into the shopping pause", () => {
    const stall = "正在收尾排版，稍等片刻。";
    expect(isPlanSpeakFinal(stall)).toBe(false);
    expect(rewritePlanSpeakFinal(stall)).toBe(stall);
    expect(isExecutionStallFinal(stall)).toBe(true);
  });

  it("treats short typeset wait lines as execution stalls", () => {
    expect(isExecutionStallFinal("稍等片刻。")).toBe(true);
    expect(isExecutionStallFinal("好的，正在收尾排版，稍等片刻。")).toBe(true);
    expect(isExecutionStallFinal("请稍等，正在渲染。")).toBe(true);
    expect(isExecutionStallFinal("我继续去结算页。")).toBe(true);
  });

  it("keeps questions, permission pauses, and finished drafts terminal", () => {
    expect(isExecutionStallFinal("你要发到哪个公众号？")).toBe(false);
    expect(isExecutionStallFinal("请确认封面标题后再写入草稿箱。")).toBe(false);
    expect(isExecutionStallFinal("已经到收银台二维码了，请扫码支付。")).toBe(false);
    expect(isExecutionStallFinal("草稿已写入，mediaId=abc，请到公众号后台预览。")).toBe(false);
    expect(isExecutionStallFinal("正在处理，结果尚未对外公布。")).toBe(false);
    const article =
      "真正的 AI Native：20% 真人，80% 数字员工。正文已排版，确认后我就渲染成定版 HTML 并推草稿箱。";
    expect(isExecutionStallFinal(article)).toBe(false);
  });
});
