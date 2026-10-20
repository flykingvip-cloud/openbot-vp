import { describe, expect, it } from "vitest";
import {
  inferCapabilityVerbsFromText,
  matchCapabilityIntent,
} from "./skill-capability-contract.js";
import { assessWebResearchRoute } from "./skill-web-research-routing.js";

const webResearchCandidate = {
  id: "web-research",
  name: "网页调研",
  summary: "可追溯的网页调研报告",
  tags: ["调研"],
  category: "search",
  verbs: ["web.search", "research.web"],
  installed: true,
  lifecycle: "published" as const,
};

describe("web-research three-dimension routing", () => {
  it.each([
    ["请调研开源智能体平台的产品形态", true, "research"],
    ["帮我研究一下 Dify 和 Coze 的差异", true, "research"],
    ["比较多个产品当前价格", true, "compare_live"],
    ["最新新能源汽车补贴政策是什么", true, "freshness"],
    ["最近行业动态怎么样", true, "freshness"],
    ["阅读 https://example.com/policy 并分析要点", true, "read_url"],
    ["请分析这个网页：www.openbot.love", true, "read_url"],
    ["请把下面这段改写成更顺的中文", false, "local_material"],
    ["润色我提供的这段说明", false, "rewrite"],
    ["什么是光合作用", false, "stable_knowledge"],
    ["分析我上传的合同 PDF", false, "local_material"],
    ["根据附件里的纪要做摘要", false, "local_material"],
  ] as const)("%s → trigger=%s", (text, trigger, intent) => {
    const decision = assessWebResearchRoute(text);
    expect(decision.trigger, decision.reason).toBe(trigger);
    expect(decision.intent).toBe(intent);
  });

  it("does not treat rewrite of a research memo as a new web-research job", () => {
    const decision = assessWebResearchRoute("请改写这份调研纪要，让语气更正式");
    expect(decision.trigger).toBe(false);
    expect(decision.intent).toBe("rewrite");
    expect(inferCapabilityVerbsFromText("请改写这份调研纪要，让语气更正式")).not.toContain(
      "research.web",
    );
  });

  it("still infers research.web for live compare without the skill name", () => {
    expect(inferCapabilityVerbsFromText("比较多个产品当前价格")).toContain("research.web");
  });

  it("boosts web-research when matching capability intent", () => {
    const matches = matchCapabilityIntent("问一下最新行业政策变化", [webResearchCandidate]);
    expect(matches[0]?.id).toBe("web-research");
    expect(matches[0]?.score).toBeGreaterThanOrEqual(8);
  });
});
