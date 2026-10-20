// Guards knowledge-universe module i18n keys against cross-locale regressions.
//
// This test scans the knowledge-universe view files with node:fs, so it must run
// under the root node-based vitest runner (NOT the ui/ browser/chromium suite,
// where node:fs is externalized). It is intentionally located under test/** so the
// ui package's `src/**/*.test.ts` browser glob does not pick it up.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { en } from "../../ui/src/i18n/locales/en.ts";
import { zh_CN as zhCN } from "../../ui/src/i18n/locales/zh-CN.ts";

const KEY_PREFIX = "frontstage.workbench.knowledgeUniverse.";
const VIEWS_DIR = join(import.meta.dirname, "..", "..", "ui", "src", "ui", "views");

function getNestedValue(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc === null || acc === undefined || typeof acc !== "object") {
      return undefined;
    }
    return (acc as Record<string, unknown>)[key];
  }, obj);
}

function collectKnowledgeUniverseKeys(): string[] {
  const files = readdirSync(VIEWS_DIR).filter(
    (name) =>
      name.startsWith("knowledge-universe") && name.endsWith(".ts") && !name.endsWith(".test.ts"),
  );
  const keyPattern = /t\(\s*["'](frontstage\.workbench\.knowledgeUniverse(?:\.[^"']+)*)["']/g;
  const keys = new Set<string>();

  for (const file of files) {
    const content = readFileSync(join(VIEWS_DIR, file), "utf8");
    for (const match of content.matchAll(keyPattern)) {
      keys.add(match[1]);
    }
  }

  return [...keys].toSorted();
}

function assertLocaleHasKeys(localeName: string, locale: unknown, keys: string[]) {
  const missing: string[] = [];
  const empty: string[] = [];

  for (const key of keys) {
    const value = getNestedValue(locale, key);
    if (value === undefined) {
      missing.push(key);
      continue;
    }
    if (typeof value === "string" && value.trim().length === 0) {
      empty.push(key);
    }
  }

  expect(missing, `${localeName} missing keys:\n${missing.join("\n")}`).toEqual([]);
  expect(empty, `${localeName} empty string keys:\n${empty.join("\n")}`).toEqual([]);
}

describe("knowledge-universe i18n key coverage", () => {
  const keys = collectKnowledgeUniverseKeys();

  it("discovers module t() keys from knowledge-universe view files", () => {
    expect(keys.length).toBeGreaterThan(20);
    expect(keys.some((key) => key.startsWith(KEY_PREFIX))).toBe(true);
  });

  it("zh-CN has every scanned knowledge-universe key", () => {
    assertLocaleHasKeys("zh-CN", zhCN, keys);
  });

  it("en has every scanned knowledge-universe key", () => {
    assertLocaleHasKeys("en", en, keys);
  });

  it("restores regression keys for deliverable sources and quick actions", () => {
    for (const locale of [zhCN, en] as const) {
      expect(
        getNestedValue(locale, `${KEY_PREFIX}workspace.artifactSourceType.agent`),
      ).toBeTruthy();
      expect(getNestedValue(locale, `${KEY_PREFIX}quickActions.createAndCollect`)).toBeTruthy();
      expect(getNestedValue(locale, `${KEY_PREFIX}workspace.viewAllDeliverables`)).toBeTruthy();
      expect(getNestedValue(locale, `${KEY_PREFIX}workspace.showFewerDeliverables`)).toBeTruthy();
    }
  });
});
