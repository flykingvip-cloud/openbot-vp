import { describe, expect, it } from "vitest";
import { extractTemplateVariables } from "./skill-profile-inference.ts";

describe("skill-profile-inference", () => {
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
    expect(variables.every((entry) => entry.type === "string" && entry.required)).toBe(true);
  });
});
