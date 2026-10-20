// @vitest-environment node
// Feature: platform-agent-runtime-center, Property 10: terminology boundary
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  containsForbiddenBusinessTerm,
  findForbiddenTermsIn,
  FORBIDDEN_BUSINESS_TERMS,
  FORBIDDEN_EMPLOYEE_TERMS,
  FORBIDDEN_TERMS_ALL,
} from "../terminology-guard.ts";

describe("Terminology guard — denylist contents", () => {
  it("business and employee denylists are disjoint from runtime allowlist", () => {
    const runtimeAllowed = [
      "Agent Runtime",
      "Capability Binding",
      "Runtime Health",
      "Deployment Lifecycle",
      "healthy",
      "degraded",
      "unhealthy",
      "unavailable",
      "deployed",
      "draining",
      "suspended",
      "deprecated",
      "archived",
      "tenant-installed",
      "platform-default",
    ];
    for (const term of runtimeAllowed) {
      expect(FORBIDDEN_TERMS_ALL).not.toContain(term);
    }
  });

  it("denylist exposes both business and employee terms", () => {
    expect(FORBIDDEN_BUSINESS_TERMS.length).toBeGreaterThan(0);
    expect(FORBIDDEN_EMPLOYEE_TERMS.length).toBeGreaterThan(0);
    expect(FORBIDDEN_TERMS_ALL.length).toBe(
      FORBIDDEN_BUSINESS_TERMS.length + FORBIDDEN_EMPLOYEE_TERMS.length,
    );
  });
});

describe("findForbiddenTermsIn", () => {
  it("returns empty array for clean runtime text", () => {
    expect(findForbiddenTermsIn("Agent Runtime catalog with healthy bindings")).toEqual([]);
  });

  it("flags every match, not just the first", () => {
    // contains: 贡献绩效 + 复用价值 + 企业认证
    const text = "贡献绩效与复用价值都需要在企业认证之上才能进入";
    const hits = findForbiddenTermsIn(text);
    expect(hits).toContain("贡献绩效");
    expect(hits).toContain("复用价值");
    expect(hits).toContain("企业认证");
  });

  it("flags employee-language terms", () => {
    expect(findForbiddenTermsIn("我的能力积累 在 工作台 中可见")).toContain("我的能力积累");
    expect(findForbiddenTermsIn("机器人会做什么")).toContain("机器人会做什么");
  });

  it("respects custom deny list extension", () => {
    expect(findForbiddenTermsIn("custom forbidden text", ["forbidden"])).toEqual(["forbidden"]);
  });
});

describe("containsForbiddenBusinessTerm", () => {
  it("returns false for runtime-only content", () => {
    expect(containsForbiddenBusinessTerm("Runtime Catalog · 5 Agent · 8 Capability Bindings")).toBe(
      false,
    );
  });

  it("returns true for any forbidden term", () => {
    expect(containsForbiddenBusinessTerm("贡献绩效")).toBe(true);
    expect(containsForbiddenBusinessTerm("我的能力")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 运行期扫描：扫描 Agent Runtime Center 源码（去除 JSDoc 注释后）的代码路径，
// 确保禁用术语不出现在 UI 渲染的字面量与代码逻辑中。
//
// 我们排除 JSDoc 注释（/** ... */ 与单行 //），因为类型定义中的对照表是合法的
// 跨层架构说明，不会进入运行时输出。
// ─────────────────────────────────────────────────────────────────────────

const here = dirname(fileURLToPath(import.meta.url));

/** 移除 JSDoc 块注释与单行注释，仅保留代码与字面量字符串部分。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

describe("Runtime-time scan: Agent Runtime Center sources", () => {
  // page.ts is the only file that must be 100% free of forbidden terms — it
  // is the actual UI surface served to the platform operator.
  //
  // Other files are exempted as documented:
  //   - projection.ts   IS the projection layer; it intentionally produces
  //                     business/employee labels as its output values.
  //   - types.ts        Type definitions only; cross-layer mapping tables in
  //                     JSDoc are stripped by `stripComments` before scanning.
  const strictTargets = ["../../../ports/platform/agents/page.ts"];

  // For supporting modules we keep a softer rule: only the "hard-forbidden"
  // terms (those that NEVER appear in any Runtime layer use-case, even as
  // projection inputs/outputs) trigger failures. This catches accidental
  // leakage without false-positives on the projection layer's intentional
  // business-label outputs.
  const softTargets = ["../types.ts"];
  const HARD_FORBIDDEN = new Set(["贡献绩效", "我的能力积累", "机器人会做什么"]);

  for (const rel of strictTargets) {
    it(`${rel} contains no forbidden terms in code (excluding JSDoc)`, () => {
      const abs = resolve(here, rel);
      const source = readFileSync(abs, "utf8");
      const codeOnly = stripComments(source);
      const hits = findForbiddenTermsIn(codeOnly);
      expect(
        hits,
        `${rel} code paths must not contain forbidden terms: ${hits.join(", ")}`,
      ).toEqual([]);
    });
  }

  for (const rel of softTargets) {
    it(`${rel} contains no hard-forbidden terms in code (excluding JSDoc)`, () => {
      const abs = resolve(here, rel);
      const source = readFileSync(abs, "utf8");
      const codeOnly = stripComments(source);
      const hardHits = findForbiddenTermsIn(codeOnly).filter((h) => HARD_FORBIDDEN.has(h));
      expect(
        hardHits,
        `${rel} code paths must not contain hard-forbidden terms: ${hardHits.join(", ")}`,
      ).toEqual([]);
    });
  }
});
