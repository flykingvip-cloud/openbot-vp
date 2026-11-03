import { describe, expect, it } from "vitest";
import {
  PLAN_SPEAK_PAUSE_CTA,
  isExecutionStallFinal,
  isPlanSpeakFinal,
  rewritePlanSpeakFinal,
} from "./plan-speak-final.js";

describe("plan-speak final gate (M2)", () => {
  it("detects 高密度分析-class early finals but does not invent pause CTA", () => {
    const leaked =
      "目前看到 ¥699 / ¥727。要确认全平台最低价，我需要把列表按价格排序，这一步正在做，随后我会打开详情页。";
    expect(isPlanSpeakFinal(leaked)).toBe(true);
    expect(isExecutionStallFinal(leaked)).toBe(true);
    expect(rewritePlanSpeakFinal(leaked)).toBe(leaked);
    expect(rewritePlanSpeakFinal(leaked)).not.toContain("请确认下一步");
    expect(rewritePlanSpeakFinal(leaked)).not.toBe(PLAN_SPEAK_PAUSE_CTA);
  });

  it("detects 16:36 transcript mid-plan without rewriting to shopping pause", () => {
    const hd1636 =
      "搜索页只渲染出部分结果：目前看到的最低是 ¥699（特步京东自营旗舰店，丰配友破纪录同款 160X7.0pro 竞速碳板跑鞋男）和 ¥727（云泽途专营店的 160x7.0Pro 超级橙/黑 39）。要确认「全平台最低价」，我需要把列表按价格排序、逐个确认到 39 码男款的实际到手价，再决定下哪一单——这一步正在做，先把最便宜的前几个挑出来核对尺码和店铺，随后我会在提交订单前把商品、数量、价格、地址列给你确认（你已授权直接下单，但付款仍由你扫码，我不代付）。";
    expect(isPlanSpeakFinal(hd1636)).toBe(true);
    expect(rewritePlanSpeakFinal(hd1636)).toBe(hd1636);
  });

  it("keeps real 「哪一单？」 user questions as asks (not rewritten)", () => {
    const q = "两家都有 39 码，¥699 和 ¥727，你要下哪一单？";
    expect(isPlanSpeakFinal(q)).toBe(false);
    expect(rewritePlanSpeakFinal(q)).toBe(q);
  });

  it("leaves mid-plan prose as progress text (executor continues; reply does not invent confirm)", () => {
    const mid = "目前看到 ¥699 / ¥727。我需要排序，这一步正在做，再决定下哪一单。";
    expect(isPlanSpeakFinal(mid)).toBe(true);
    expect(rewritePlanSpeakFinal(mid)).toBe(mid);
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

  it("does not invent pause CTA for bare checkout plan-speak", () => {
    expect(rewritePlanSpeakFinal("我继续去结算页。")).toBe("我继续去结算页。");
  });

  it("ignores ordinary completed answers", () => {
    const done = "已把特步 160X 加入购物车，合计 ¥699。";
    expect(isPlanSpeakFinal(done)).toBe(false);
    expect(rewritePlanSpeakFinal(done)).toBe(done);
  });

  it("cross-sample: research / analysis / video / shopping plan-speak stay progress text", () => {
    const samples: Array<[string, string]> = [
      ["我继续把各厂商价格变化写进研究报告，这一步正在做。", "写一份行业价格调研报告"],
      ["我需要先梳理支付权限问题，这一步正在做。", "分析一下登录与支付权限失败原因"],
      ["我继续处理视频字幕导出，这一步正在做。", "帮我给这段视频加字幕"],
      ["我需要核对价格和规格，这一步正在做。", "帮我比价买鞋"],
      [
        "我需要把这篇公众号文章排版，这一步正在做，随后我会推草稿箱。",
        "开始排版和发布这篇文章到公众号",
      ],
      ["我继续把调研报告写完。", "写调研报告"],
    ];
    for (const [text, goal] of samples) {
      expect(isPlanSpeakFinal(text)).toBe(true);
      expect(rewritePlanSpeakFinal(text, goal)).toBe(text);
      expect(rewritePlanSpeakFinal(text, goal)).not.toContain(PLAN_SPEAK_PAUSE_CTA.slice(0, 8));
    }
  });

  it("does not rewrite the WeChat holding line into a pause CTA", () => {
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
