import { describe, expect, it } from "vitest";
import {
  applyTemplateVariableValues,
  extractTemplateVariables,
  listMissingTemplateVariables,
} from "./template-variables.ts";

describe("template-variables", () => {
  it("extracts unique template variables from mustache slots", () => {
    const body = [
      "# {{ 会议主题 }}",
      "时间：{{YYYY年MM月DD日}}",
      "形式：{{ 纯线上 / 纯线下 / 线上+线下混合 }}",
      "重复：{{会议主题}}",
    ].join("\n");
    const variables = extractTemplateVariables(body);
    expect(variables.map((entry) => entry.name)).toEqual([
      "会议主题",
      "YYYY年MM月DD日",
      "纯线上 / 纯线下 / 线上+线下混合",
    ]);
  });

  it("fills preview values while leaving empty slots as placeholders", () => {
    const template = "主题：{{会议主题}}\n时间：{{YYYY年MM月DD日}}";
    const filled = applyTemplateVariableValues(template, {
      会议主题: "季度复盘",
    });
    expect(filled).toBe("主题：季度复盘\n时间：{{YYYY年MM月DD日}}");
  });

  it("lists required variables that are still empty", () => {
    const variables = extractTemplateVariables("主题：{{会议主题}}\n时间：{{YYYY年MM月DD日}}");
    expect(
      listMissingTemplateVariables(variables, {
        会议主题: "季度复盘",
      }),
    ).toEqual(["YYYY年MM月DD日"]);
  });
});
