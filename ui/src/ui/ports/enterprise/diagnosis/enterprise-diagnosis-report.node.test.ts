import { describe, expect, it } from "vitest";
import {
  parseDiagnoseReportActions,
  parseDiagnoseReportArticle,
} from "./enterprise-diagnosis-report.ts";

describe("enterprise diagnosis report article", () => {
  it("parses eight sections and conversation action chips", () => {
    const text = [
      "【诊断报告】",
      "",
      "一、结论与窗口",
      "对象：市场助手",
      "综述：运行面证据不足；身份或主人字段未齐。",
      "",
      "二、运行现状",
      "扫描范围",
      "主会话：4（近窗 1）",
      "",
      "三、特征属性",
      "工作区：可读",
      "IDENTITY 未确认（缺 name、vibe）",
      "",
      "八、可执行建议",
      "[练未观察技能]",
      "执行者：被诊断数字人（Skill孵化）",
      "任务：请让Skill孵化用已安装技能 data-analysis 做一次练习。",
    ].join("\n");
    const article = parseDiagnoseReportArticle(text);
    expect(article.title).toBe("【诊断报告】");
    expect(article.sections.map((section) => section.heading)).toEqual([
      "一、结论与窗口",
      "二、运行现状",
      "三、特征属性",
      "八、可执行建议",
    ]);
    expect(article.sections[0]?.lines).toContainEqual({
      kind: "kv",
      label: "对象",
      value: "市场助手",
    });
    expect(article.sections[1]?.lines).toContainEqual({ kind: "subhead", value: "扫描范围" });
    expect(article.sections[2]?.lines).toContainEqual({
      kind: "kv",
      label: "IDENTITY",
      value: "未确认（缺 name、vibe）",
    });
    expect(parseDiagnoseReportActions(text)).toEqual([
      {
        title: "练未观察技能",
        prompt: "请让Skill孵化用已安装技能 data-analysis 做一次练习。",
        handoffChannel: "steward",
      },
    ]);
  });
});
