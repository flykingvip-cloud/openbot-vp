import { describe, expect, it } from "vitest";
import {
  generateRepairSuggestions,
  normalizeRepairSuggestion,
  shouldShowRepairSuggestions,
  type RepairSuggestion,
} from "./skill-health-repair.ts";

describe("skill-health-repair controller", () => {
  describe("shouldShowRepairSuggestions", () => {
    it("returns true for warning status", () => {
      expect(shouldShowRepairSuggestions("warning")).toBe(true);
    });

    it("returns true for broken status", () => {
      expect(shouldShowRepairSuggestions("broken")).toBe(true);
    });

    it("returns false for healthy status", () => {
      expect(shouldShowRepairSuggestions("healthy")).toBe(false);
    });
  });

  describe("generateRepairSuggestions", () => {
    it("returns empty array for healthy status", () => {
      const result = generateRepairSuggestions("healthy", ["timeout error"]);
      expect(result).toEqual([]);
    });

    it("returns suggestions for warning with timeout failure", () => {
      const result = generateRepairSuggestions("warning", ["request timeout after 30s"]);
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].message).toBe("建议简化输入内容或拆分为更小的任务");
    });

    it("returns suggestions for warning with Chinese timeout failure (超时)", () => {
      const result = generateRepairSuggestions("warning", ["连接超时"]);
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].message).toBe("建议简化输入内容或拆分为更小的任务");
    });

    it("returns suggestions for broken with permission failure", () => {
      const result = generateRepairSuggestions("broken", ["permission denied"]);
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].message).toBe("建议联系管理员确认权限设置");
      expect(result[0].priority).toBe("high");
    });

    it("returns suggestions for broken with Chinese permission failure (权限)", () => {
      const result = generateRepairSuggestions("broken", ["权限不足"]);
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].message).toBe("建议联系管理员确认权限设置");
    });

    it("returns format suggestion for format-related failure", () => {
      const result = generateRepairSuggestions("warning", ["invalid format"]);
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].message).toBe("建议检查输入格式是否符合要求");
    });

    it("returns not-found suggestion for not found failure", () => {
      const result = generateRepairSuggestions("warning", ["resource not found"]);
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].message).toBe("建议确认相关数据源是否可用");
    });

    it("returns context suggestion for context-related failure", () => {
      const result = generateRepairSuggestions("warning", ["insufficient context provided"]);
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].message).toBe("建议调整使用场景，确保提供足够的背景信息");
    });

    it("returns default suggestion when no pattern matches", () => {
      const result = generateRepairSuggestions("warning", ["some unknown issue occurred"]);
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].message).toBe("建议检查最近的使用方式是否有变化");
    });

    it("returns default suggestion when failure reasons are empty", () => {
      const result = generateRepairSuggestions("broken", []);
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].message).toBe("建议检查最近的使用方式是否有变化");
    });

    it("deduplicates suggestions for repeated failure patterns", () => {
      const result = generateRepairSuggestions("warning", [
        "timeout on call 1",
        "timeout on call 2",
        "timeout on call 3",
      ]);
      const timeoutSuggestions = result.filter(
        (s) => s.message === "建议简化输入内容或拆分为更小的任务",
      );
      expect(timeoutSuggestions).toHaveLength(1);
    });

    it("returns multiple suggestions for different failure patterns", () => {
      const result = generateRepairSuggestions("broken", ["permission denied", "request timeout"]);
      expect(result.length).toBe(2);
      const messages = result.map((s) => s.message);
      expect(messages).toContain("建议联系管理员确认权限设置");
      expect(messages).toContain("建议简化输入内容或拆分为更小的任务");
    });

    it("sorts suggestions by priority (high first)", () => {
      const result = generateRepairSuggestions("broken", ["request timeout", "permission denied"]);
      expect(result[0].priority).toBe("high");
      expect(result[1].priority).toBe("medium");
    });

    it("all suggestion messages use employee-friendly Chinese language", () => {
      const testCases = [
        ["timeout"],
        ["format error"],
        ["not found"],
        ["permission denied"],
        ["context missing"],
        ["unknown issue"],
      ];

      const forbiddenTerms = ["error", "exception", "stack", "trace", "API", "endpoint"];

      for (const reasons of testCases) {
        const result = generateRepairSuggestions("warning", reasons);
        for (const suggestion of result) {
          for (const term of forbiddenTerms) {
            expect(suggestion.message.toLowerCase()).not.toContain(term.toLowerCase());
          }
        }
      }
    });

    it("suggestions never contain technical English terms", () => {
      const allReasons = [
        "timeout",
        "超时",
        "format",
        "格式",
        "not found",
        "未找到",
        "permission",
        "权限",
        "context",
        "上下文",
        "random failure xyz",
      ];

      const forbiddenTerms = ["error", "exception", "stack", "trace", "API", "endpoint"];

      for (const reason of allReasons) {
        const result = generateRepairSuggestions("broken", [reason]);
        for (const suggestion of result) {
          for (const term of forbiddenTerms) {
            expect(suggestion.message).not.toContain(term);
            expect(suggestion.message.toLowerCase()).not.toContain(term.toLowerCase());
          }
        }
      }
    });
  });

  describe("normalizeRepairSuggestion", () => {
    it("returns null for null input", () => {
      expect(normalizeRepairSuggestion(null)).toBeNull();
    });

    it("returns null for non-object input", () => {
      expect(normalizeRepairSuggestion("string")).toBeNull();
      expect(normalizeRepairSuggestion(123)).toBeNull();
    });

    it("returns null for missing required fields", () => {
      expect(normalizeRepairSuggestion({ id: "1" })).toBeNull();
      expect(normalizeRepairSuggestion({ message: "test" })).toBeNull();
    });

    it("returns null for invalid priority", () => {
      expect(
        normalizeRepairSuggestion({
          id: "1",
          message: "建议",
          priority: "critical",
          category: "input",
        }),
      ).toBeNull();
    });

    it("returns null for invalid category", () => {
      expect(
        normalizeRepairSuggestion({
          id: "1",
          message: "建议",
          priority: "high",
          category: "unknown",
        }),
      ).toBeNull();
    });

    it("returns valid RepairSuggestion for correct input", () => {
      const input: RepairSuggestion = {
        id: "repair-1",
        message: "建议简化输入内容",
        priority: "medium",
        category: "input",
      };
      const result = normalizeRepairSuggestion(input);
      expect(result).toEqual(input);
    });

    it("strips forbidden technical terms from message", () => {
      const result = normalizeRepairSuggestion({
        id: "1",
        message: "建议检查 API endpoint 配置",
        priority: "high",
        category: "general",
      });
      expect(result).not.toBeNull();
      expect(result!.message).not.toContain("API");
      expect(result!.message).not.toContain("endpoint");
    });
  });
});
