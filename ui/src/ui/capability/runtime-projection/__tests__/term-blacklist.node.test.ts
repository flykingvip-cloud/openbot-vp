// @vitest-environment node
// Feature: enterprise-capability-usage-management
// Property 1 (text subset): 术语黑名单守卫

import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  BLACKLIST_DOWNGRADE_PLACEHOLDER,
  TERM_BLACKLIST,
  assertNoBlacklistedTerm,
  scanText,
} from "../term-blacklist.ts";

describe("Property 1 (text subset): term blacklist guard", () => {
  it("scanText detects every blacklist token at any case", () => {
    for (const token of TERM_BLACKLIST) {
      // Lowercase
      expect(scanText(`This contains ${token} word`)).not.toBeNull();
      // Uppercase
      expect(scanText(`This contains ${token.toUpperCase()} word`)).not.toBeNull();
      // Mixed case
      const mixed = token.charAt(0).toUpperCase() + token.slice(1);
      expect(scanText(`This contains ${mixed} word`)).not.toBeNull();
    }
  });

  it("scanText returns null for clean business-language strings", () => {
    const cleanStrings = [
      "数字人能力视图",
      "能力使用管理",
      "效果稳定",
      "暂无数据",
      "本月调用 1,284 次",
      "成功率 96.5%",
      "客户跟进提醒",
      "财务报表生成",
    ];
    for (const s of cleanStrings) {
      expect(scanText(s)).toBeNull();
    }
  });

  it("scanText does not flag substrings within other words (word boundary)", () => {
    // "agentmanager" should not match "agent" because of \b boundary
    // BUT "agent-manager" might because of -, depending on regex behavior
    expect(scanText("agentmanager")).toBeNull();
    expect(scanText("templated")).toBeNull();
  });

  it("assertNoBlacklistedTerm in throw mode raises on hit", () => {
    fc.assert(
      fc.property(fc.constantFrom(...TERM_BLACKLIST), (token) => {
        expect(() =>
          assertNoBlacklistedTerm(`prefix ${token} suffix`, { mode: "throw" }),
        ).toThrow();
      }),
      { numRuns: 50 },
    );
  });

  it("assertNoBlacklistedTerm in downgrade mode returns 暂无数据 on hit", () => {
    fc.assert(
      fc.property(fc.constantFrom(...TERM_BLACKLIST), (token) => {
        const result = assertNoBlacklistedTerm(`prefix ${token} suffix`, { mode: "downgrade" });
        expect(result).toBe(BLACKLIST_DOWNGRADE_PLACEHOLDER);
      }),
      { numRuns: 50 },
    );
  });

  it("assertNoBlacklistedTerm passes through clean strings unchanged", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }).filter((s) => scanText(s) === null),
        (clean) => {
          expect(assertNoBlacklistedTerm(clean, { mode: "throw" })).toBe(clean);
          expect(assertNoBlacklistedTerm(clean, { mode: "downgrade" })).toBe(clean);
        },
      ),
      { numRuns: 100 },
    );
  });
});
