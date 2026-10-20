// @vitest-environment node
// Feature: enterprise-capability-usage-management
// i18n key completeness — Requirement 1.8

import { describe, expect, it } from "vitest";
import { en } from "../../../../i18n/locales/en.ts";
import { zh_CN as zhCN } from "../../../../i18n/locales/zh-CN.ts";

const REQUIRED_LEAF_PATHS = [
  "tabs.enterpriseUsageManagement",
  "subtitles.enterpriseUsageManagement",
  "nav.items.enterpriseUsageManagement",
] as const;

const REQUIRED_NAMESPACES = ["enterpriseUsage"] as const;

const REQUIRED_USAGE_KEYS = ["robots", "installs", "analytics", "governance"] as const;

function getNestedValue(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc === null || acc === undefined || typeof acc !== "object") {
      return undefined;
    }
    return (acc as Record<string, unknown>)[key];
  }, obj);
}

describe("i18n key completeness for enterprise-capability-usage-management", () => {
  it("zh-CN locale has all required leaf string keys", () => {
    for (const key of REQUIRED_LEAF_PATHS) {
      const value = getNestedValue(zhCN, key);
      expect(value, `zh-CN missing key ${key}`).toBeTruthy();
      expect(typeof value, `zh-CN key ${key} should be string`).toBe("string");
    }
  });

  it("en locale has all required leaf string keys", () => {
    for (const key of REQUIRED_LEAF_PATHS) {
      const value = getNestedValue(en, key);
      expect(value, `en missing key ${key}`).toBeTruthy();
      expect(typeof value, `en key ${key} should be string`).toBe("string");
    }
  });

  it("zh-CN has enterpriseUsage namespace with sub-page keys", () => {
    for (const ns of REQUIRED_NAMESPACES) {
      const obj = getNestedValue(zhCN, ns);
      expect(obj, `zh-CN missing namespace ${ns}`).toBeTruthy();
      expect(typeof obj).toBe("object");
      for (const subKey of REQUIRED_USAGE_KEYS) {
        const subValue = getNestedValue(zhCN, `${ns}.${subKey}`);
        expect(subValue, `zh-CN missing ${ns}.${subKey}`).toBeTruthy();
      }
    }
  });

  it("en has enterpriseUsage namespace with sub-page keys", () => {
    for (const ns of REQUIRED_NAMESPACES) {
      const obj = getNestedValue(en, ns);
      expect(obj, `en missing namespace ${ns}`).toBeTruthy();
      expect(typeof obj).toBe("object");
      for (const subKey of REQUIRED_USAGE_KEYS) {
        const subValue = getNestedValue(en, `${ns}.${subKey}`);
        expect(subValue, `en missing ${ns}.${subKey}`).toBeTruthy();
      }
    }
  });

  it("zh-CN top-level tab labels are correct Chinese", () => {
    expect(getNestedValue(zhCN, "tabs.enterpriseUsageManagement")).toBe("能力应用管理");
    expect(getNestedValue(zhCN, "enterpriseUsage.robots")).toBe("机器人能力配置");
  });

  it("legacy enterpriseAgents tab key is kept (compatibility window) if present", () => {
    // The deprecated key may still exist or have been removed — both are valid states
    // Check that EITHER the legacy key still exists (deprecation path) OR has been cleanly removed
    const zhLegacy = getNestedValue(zhCN, "tabs.enterpriseAgents");
    const enLegacy = getNestedValue(en, "tabs.enterpriseAgents");
    // If it exists, it should be a string; if removed, undefined — both OK
    if (zhLegacy !== undefined) {
      expect(typeof zhLegacy).toBe("string");
    }
    if (enLegacy !== undefined) {
      expect(typeof enLegacy).toBe("string");
    }
  });
});
