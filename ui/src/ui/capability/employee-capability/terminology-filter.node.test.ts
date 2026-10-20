import { describe, expect, it } from "vitest";
import {
  assertNoBlacklistedTerm,
  scanNode,
  SKILL_STANDALONE_PATTERN,
  TERMINOLOGY_BLACKLIST_PATTERN,
} from "./terminology-filter.ts";

function makeNode(params: {
  textContent?: string;
  attrs?: Record<string, string>;
  children?: Array<{ attrs?: Record<string, string> }>;
}) {
  return {
    textContent: params.textContent ?? "",
    getAttribute: (name: string) => params.attrs?.[name] ?? null,
    querySelectorAll: () =>
      (params.children ?? []).map((child) => ({
        textContent: "",
        getAttribute: (name: string) => child.attrs?.[name] ?? null,
      })),
  };
}

describe("employee capability terminology filter", () => {
  it("allows employee-language capability copy", () => {
    expect(() =>
      assertNoBlacklistedTerm("我的能力积累会从日常工作中自然形成", "copy"),
    ).not.toThrow();
  });

  it("blocks runtime and asset-layer terms", () => {
    const samples = [
      "Prompt 配置",
      "model routing",
      "dependency graph",
      "asset lifecycle",
      "OpenAI provider",
      "模型路由",
      "状态为 published",
    ];

    for (const sample of samples) {
      expect(() => assertNoBlacklistedTerm(sample, "sample")).toThrow(
        /Employee capability terminology violation/u,
      );
    }
  });

  it("blocks standalone Skill without blocking ordinary capability wording", () => {
    expect(SKILL_STANDALONE_PATTERN.test("Save Skill")).toBe(true);
    expect(() => assertNoBlacklistedTerm("Save Skill", "button")).toThrow();
    expect(() => assertNoBlacklistedTerm("能力保存", "button")).not.toThrow();
  });

  it("scans text content and common accessible attributes", () => {
    expect(() =>
      scanNode(
        makeNode({
          textContent: "我的能力积累",
          children: [{ attrs: { "aria-label": "查看能力详情" } }],
        }),
      ),
    ).not.toThrow();

    expect(() =>
      scanNode(
        makeNode({
          textContent: "我的能力积累",
          children: [{ attrs: { title: "查看 workflow" } }],
        }),
      ),
    ).toThrow(/workflow/u);
  });

  it("exports a blacklist pattern that catches representative terms", () => {
    expect(TERMINOLOGY_BLACKLIST_PATTERN.test("execution policy")).toBe(true);
    expect(TERMINOLOGY_BLACKLIST_PATTERN.test("运行稳定")).toBe(false);
  });
});
