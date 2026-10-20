import { describe, expect, it } from "vitest";
import { stripAssistantInternalScaffolding } from "./assistant-visible-text.js";

describe("stripAssistantInternalScaffolding", () => {
  it("strips reasoning tags", () => {
    const input = ["<thinking>", "secret", "</thinking>", "Visible"].join("\n");
    expect(stripAssistantInternalScaffolding(input)).toBe("Visible");
  });

  it("strips relevant-memories scaffolding blocks", () => {
    const input = [
      "<relevant-memories>",
      "The following memories may be relevant to this conversation:",
      "- Internal memory note",
      "</relevant-memories>",
      "",
      "User-visible answer",
    ].join("\n");
    expect(stripAssistantInternalScaffolding(input)).toBe("User-visible answer");
  });

  it("supports relevant_memories tag variants", () => {
    const input = [
      "<relevant_memories>",
      "Internal memory note",
      "</relevant_memories>",
      "Visible",
    ].join("\n");
    expect(stripAssistantInternalScaffolding(input)).toBe("Visible");
  });

  it("keeps relevant-memories tags inside fenced code", () => {
    const input = [
      "```xml",
      "<relevant-memories>",
      "sample",
      "</relevant-memories>",
      "```",
      "",
      "Visible text",
    ].join("\n");
    expect(stripAssistantInternalScaffolding(input)).toBe(input);
  });

  it("hides unfinished relevant-memories blocks", () => {
    const input = ["Hello", "<relevant-memories>", "internal-only"].join("\n");
    expect(stripAssistantInternalScaffolding(input)).toBe("Hello\n");
  });

  it("strips English CoT scratchpad and /approve fences, keeps Chinese answer", () => {
    const cot = [
      "The skill is at a path outside my sandbox. Let me try to read via exec.",
      "Actually, since exec needs approval, let me guide the user.",
    ].join("\n\n");
    const answer = [
      "这是我的环境需要在你本机执行命令来定位微信文件夹。请点一下本机只读授权。",
      "```",
      "/approve 92a00388 allow-once",
      "```",
      "批准后我继续。",
    ].join("\n");
    const out = stripAssistantInternalScaffolding(`${cot}\n\n${answer}`);
    expect(out).toContain("定位微信文件夹");
    expect(out).toContain("批准后我继续");
    expect(out).not.toMatch(/sandbox/i);
    expect(out).not.toMatch(/\/approve/);
    expect(out).not.toMatch(/Let me/i);
  });

  it("keeps legitimate English product answers", () => {
    const t = "Your export folder is ready. Upload the txt files next.";
    expect(stripAssistantInternalScaffolding(t)).toBe(t);
  });
});
