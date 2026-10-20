import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseFrontmatter } from "./skills/frontmatter.js";

const SKILL_NAMES = ["deep-research", "knowledge", "content", "design", "content-ops"] as const;

type SkillName = (typeof SKILL_NAMES)[number];

/** Phrases that must live in description — triggering never reads the SKILL.md body. */
const REQUIRED_TRIGGERS: Record<SkillName, readonly string[]> = {
  "deep-research": [
    "深度研究",
    "deep research",
    "横纵分析",
    "竞品分析",
    "行业研究",
    "这个公司/产品怎么回事",
    "战略问题搞清楚",
    "研究这家公司",
    "这个概念从哪来",
    "先给判断和证据",
  ],
  knowledge: [
    "总结",
    "拆书",
    "读论文",
    "这篇论文",
    "讲清楚",
    "结构化",
    "把这份纪要结构化",
    "对比这两份",
    "挑刺",
    "challenge",
    "挑战推荐理由",
    "这篇文章在说什么",
  ],
  content: [
    "写一篇",
    "出大纲",
    "改稿",
    "审校",
    "降 AI 味",
    "事实检查",
    "根据调研写文章",
    "对内简报",
    "先别写正文",
  ],
  design: [
    "设计审查",
    "design audit",
    "critique",
    "改一版 UI",
    "响应式",
    "对比度",
    "无障碍",
    "polish",
    "landing",
    "dashboard 截图",
  ],
  "content-ops": [
    "热点",
    "选题",
    "拆成小红书/X/脚本",
    "内容日历",
    "素材收集",
    "repurpose",
    "口播",
    "复用计划",
    "线程",
  ],
};

const CORPUS: ReadonlyArray<{
  text: string;
  expect: SkillName | null;
}> = [
  { text: "帮我深度研究一下这家公司", expect: "deep-research" },
  { text: "做个 deep research，先给判断和证据", expect: "deep-research" },
  { text: "用横纵分析看看这个产品怎么回事", expect: "deep-research" },
  { text: "帮我做竞品分析，列出主要对手", expect: "deep-research" },
  { text: "这个行业研究一下，战略问题搞清楚", expect: "deep-research" },
  { text: "研究这家公司和它的主要竞品", expect: "deep-research" },
  { text: "这个概念从哪来，现在谁在用", expect: "deep-research" },
  { text: "不要长文，先给判断和证据就行", expect: "deep-research" },

  { text: "把这份纪要结构化", expect: "knowledge" },
  { text: "这篇论文在说什么，证据到哪", expect: "knowledge" },
  { text: "拆书，讲清楚这本书的主线", expect: "knowledge" },
  { text: "对比这两份方案，并挑战推荐理由", expect: "knowledge" },
  { text: "challenge 一下作者的假设和反例", expect: "knowledge" },
  { text: "总结一下这篇文章，不要去网上再搜", expect: "knowledge" },
  { text: "读论文：作者到底贡献了什么", expect: "knowledge" },
  { text: "帮我挑刺，看看逻辑有没有跳跃", expect: "knowledge" },

  { text: "根据这份研究写一篇对内简报", expect: "content" },
  { text: "出大纲，先别写正文", expect: "content" },
  { text: "审校这篇，降 AI 味", expect: "content" },
  { text: "事实检查一下，标出无法核实的数字", expect: "content" },
  { text: "根据调研写文章，保持中性口吻", expect: "content" },
  { text: "改稿：把这段写顺，但不要补造事实", expect: "content" },
  { text: "帮我写一篇公众号，先做事实检查", expect: "content" },

  { text: "design audit 这个 landing", expect: "design" },
  { text: "这张 dashboard 截图做设计审查", expect: "design" },
  { text: "改一版 UI，检查对比度和响应式", expect: "design" },
  { text: "polish 一下无障碍和触控目标", expect: "design" },
  { text: "critique 这个页面的层级", expect: "design" },
  { text: "按钮太小，先做设计审查再改", expect: "design" },

  { text: "把这份研究拆成小红书和脚本", expect: "content-ops" },
  { text: "这周 AI Agent 有哪些可做选题，先不要写正文", expect: "content-ops" },
  { text: "repurpose 成公众号要点和 X 线程", expect: "content-ops" },
  { text: "给三条硬事实做一周复用计划", expect: "content-ops" },
  { text: "收集素材，排一个内容日历", expect: "content-ops" },
  { text: "最近有什么热点可以做，不要写成终稿", expect: "content-ops" },
  { text: "同一事实源拆成口播和知识卡片", expect: "content-ops" },

  { text: "这个 TypeScript 编译错误怎么修", expect: null },
  { text: "帮我看看 git rebase 冲突", expect: null },
];

function readDescription(name: SkillName): string {
  const skillPath = path.join(process.cwd(), "skills", name, "SKILL.md");
  const raw = fs.readFileSync(skillPath, "utf-8");
  const frontmatter = parseFrontmatter(raw);
  return frontmatter.description ?? "";
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, "");
}

function expandTrigger(phrase: string): string[] {
  const parts = phrase
    .split(/[/、]/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2);
  return [phrase, ...parts];
}

function triggersFromDescription(description: string): string[] {
  const quoted = [...description.matchAll(/「([^」]+)」/g)].map((match) => match[1] ?? "");
  const expanded = quoted.flatMap(expandTrigger);
  const unique = [...new Set(expanded.map((item) => item.trim()).filter(Boolean))];
  return unique.toSorted((left, right) => right.length - left.length);
}

function scoreUtterance(utterance: string, triggers: readonly string[]): number {
  const haystack = normalize(utterance);
  let score = 0;
  const seen = new Set<string>();
  for (const trigger of triggers) {
    const needle = normalize(trigger);
    if (needle.length < 2 || seen.has(needle) || !haystack.includes(needle)) {
      continue;
    }
    seen.add(needle);
    score += needle.length * needle.length;
  }
  return score;
}

function route(utterance: string, catalog: Record<SkillName, string>): SkillName | null {
  const scored = SKILL_NAMES.map((name) => ({
    name,
    score: scoreUtterance(utterance, triggersFromDescription(catalog[name])),
  }));
  const best = Math.max(...scored.map((row) => row.score));
  if (best <= 0) {
    return null;
  }
  const winners = scored.filter((row) => row.score === best);
  if (winners.length !== 1) {
    throw new Error(
      `tie for "${utterance}": ${winners.map((row) => `${row.name}=${row.score}`).join(", ")}`,
    );
  }
  return winners[0]?.name ?? null;
}

describe("enterprise AI skills trigger corpus", () => {
  const catalog = Object.fromEntries(
    SKILL_NAMES.map((name) => [name, readDescription(name)]),
  ) as Record<SkillName, string>;

  it("keeps descriptions inside the 1024-character load gate", () => {
    for (const name of SKILL_NAMES) {
      expect(catalog[name].length, name).toBeGreaterThan(40);
      expect(catalog[name].length, name).toBeLessThanOrEqual(1024);
    }
  });

  it("puts every required trigger phrase in description, not only the body", () => {
    for (const name of SKILL_NAMES) {
      const description = catalog[name];
      for (const phrase of REQUIRED_TRIGGERS[name]) {
        expect(description, `${name} missing 「${phrase}」`).toContain(phrase);
      }
    }
  });

  it("does not share exclusive trigger phrases across the five skills", () => {
    const owners = new Map<string, SkillName[]>();
    for (const name of SKILL_NAMES) {
      for (const phrase of REQUIRED_TRIGGERS[name]) {
        const key = normalize(phrase);
        const current = owners.get(key) ?? [];
        current.push(name);
        owners.set(key, current);
      }
    }
    const collisions = [...owners.entries()].filter(([, names]) => names.length > 1);
    expect(collisions).toEqual([]);
  });

  it.each(CORPUS)("routes `$text` → $expect", ({ text, expect: expected }) => {
    expect(route(text, catalog)).toBe(expected);
  });
});
