import { describe, expect, it } from "vitest";
import { RuleBasedTaskParser } from "./parser.js";
import { createBuiltinTaskTypeRegistry } from "./task-types.js";

describe("RuleBasedTaskParser", () => {
  const registry = createBuiltinTaskTypeRegistry();

  it("classifies a code review goal", async () => {
    const parser = new RuleBasedTaskParser(registry, "coding.review");
    const parsed = await parser.parse("analyze this codebase and suggest improvements");
    expect(parsed.type).toBe("coding.review");
    expect(parsed.confidence).toBeGreaterThan(0);
  });

  it("classifies a summarization goal", async () => {
    const parser = new RuleBasedTaskParser(registry, "coding.review");
    const parsed = await parser.parse("summarize this long article into a tldr");
    expect(parsed.type).toBe("summarization");
  });

  it("falls back when nothing matches", async () => {
    const parser = new RuleBasedTaskParser(registry, "coding.review");
    const parsed = await parser.parse("xyzzy plugh");
    expect(parsed.type).toBe("coding.review");
    expect(parsed.confidence).toBe(0);
  });

  it("defers to the LLM classifier when provided", async () => {
    const parser = new RuleBasedTaskParser(registry, "coding.review", async () => "summarization");
    const parsed = await parser.parse("analyze this codebase");
    expect(parsed.type).toBe("summarization");
    expect(parsed.confidence).toBeGreaterThan(0.9);
  });

  it("classifies security and ops goals", async () => {
    const parser = new RuleBasedTaskParser(registry, "coding.review");
    expect((await parser.parse("security audit for XSS vulnerabilities")).type).toBe(
      "coding.security",
    );
    expect((await parser.parse("deploy release to production with canary")).type).toBe(
      "ops.deploy",
    );
  });
});
