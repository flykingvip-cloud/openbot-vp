// @vitest-environment node
// Feature: enterprise-data-capability-center
// i18n key completeness (Task 5.2).
//
// Note: panel body labels follow the inline-Chinese convention used by sibling
// enterprise surfaces (e.g. enterprise-capability-center-surface). This test guards
// the module-level tab / subtitle / nav keys that ARE routed through i18n `t()`.

import { describe, expect, it } from "vitest";
import { en } from "../../../i18n/locales/en.ts";
import { zh_CN as zhCN } from "../../../i18n/locales/zh-CN.ts";

const REQUIRED_LEAF_PATHS = [
  "tabs.enterpriseDataGovernanceCenter",
  "subtitles.enterpriseDataGovernanceCenter",
  "nav.items.enterpriseDataGovernanceCenter",
] as const;

function getNestedValue(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc === null || acc === undefined || typeof acc !== "object") {
      return undefined;
    }
    return (acc as Record<string, unknown>)[key];
  }, obj);
}

describe("i18n key completeness for enterprise-data-capability-center", () => {
  it("zh-CN locale has all required module keys as non-empty strings", () => {
    for (const key of REQUIRED_LEAF_PATHS) {
      const value = getNestedValue(zhCN, key);
      expect(value, `zh-CN missing key ${key}`).toBeTruthy();
      expect(typeof value, `zh-CN key ${key} should be string`).toBe("string");
    }
  });

  it("en locale has all required module keys as non-empty strings", () => {
    for (const key of REQUIRED_LEAF_PATHS) {
      const value = getNestedValue(en, key);
      expect(value, `en missing key ${key}`).toBeTruthy();
      expect(typeof value, `en key ${key} should be string`).toBe("string");
    }
  });

  it("renames the module to Enterprise Data Capability Center (not the legacy name)", () => {
    expect(getNestedValue(zhCN, "tabs.enterpriseDataGovernanceCenter")).toBe("企业数据能力中心");
    expect(getNestedValue(en, "tabs.enterpriseDataGovernanceCenter")).toBe(
      "Enterprise Data Capability Center",
    );
  });
});
