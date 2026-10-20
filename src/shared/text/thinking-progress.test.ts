import { describe, expect, it } from "vitest";
import {
  THINKING_PROGRESS_PLACEHOLDER,
  THINKING_PROGRESS_PLACEHOLDER_EN,
  deriveThinkingProgress,
  isSafeThinkingProgressSnapshot,
  sanitizeThinkingStepLabel,
} from "./thinking-progress.js";

describe("thinking-progress", () => {
  it("returns neutral Chinese structure when input is empty", () => {
    const snap = deriveThinkingProgress("");
    expect(snap.placeholder).toBe(THINKING_PROGRESS_PLACEHOLDER);
    expect(snap.steps.length).toBeGreaterThanOrEqual(3);
    expect(snap.steps.every((s) => /[\u4e00-\u9fff]/.test(s.label))).toBe(true);
    expect(snap.steps.some((s) => s.status === "active")).toBe(true);
    expect(isSafeThinkingProgressSnapshot(snap)).toBe(true);
  });

  it("derives phase labels from English scratchpad without leaking CoT", () => {
    const raw = [
      "Let me understand the user's question first.",
      "I need to search the local wechat folder.",
      "Actually, I will organize a Chinese reply.",
    ].join("\n\n");
    const snap = deriveThinkingProgress(raw);
    expect(snap.placeholder).toBe(THINKING_PROGRESS_PLACEHOLDER);
    expect(JSON.stringify(snap)).not.toMatch(/Let me|I need to|Actually/i);
    expect(snap.steps.map((s) => s.label).join("|")).toMatch(/理解|检索|组织|梳理|分析/);
    expect(snap.percent).toBeGreaterThan(0);
    expect(snap.percent).toBeLessThanOrEqual(95);
    expect(isSafeThinkingProgressSnapshot(snap)).toBe(true);
  });

  it("prefers short CJK headings when present", () => {
    const raw = [
      "## 核对路径",
      "## 整理结论",
      "Let me keep going with more English scratchpad.",
    ].join("\n");
    const snap = deriveThinkingProgress(raw);
    expect(snap.steps[0]?.label).toBe("核对路径");
    expect(snap.steps.some((s) => s.label === "整理结论")).toBe(true);
    expect(JSON.stringify(snap)).not.toMatch(/Let me keep going/);
  });

  it("sanitizeThinkingStepLabel rejects English CoT fragments", () => {
    expect(sanitizeThinkingStepLabel("Let me check sandbox")).toBeNull();
    expect(sanitizeThinkingStepLabel("核对本机路径")).toBe("核对本机路径");
    expect(sanitizeThinkingStepLabel("a".repeat(40))).toBeNull();
  });

  it("uses English process labels when the user asked in English", () => {
    const raw = [
      "Let me understand the user's question first.",
      "I need to search the local wechat folder.",
      "Actually, I will organize a reply.",
    ].join("\n\n");
    const snap = deriveThinkingProgress(raw, "en");
    expect(snap.placeholder).toBe(THINKING_PROGRESS_PLACEHOLDER_EN);
    expect(JSON.stringify(snap)).not.toMatch(/Let me|I need to|Actually/i);
    expect(snap.steps.map((s) => s.label).join("|")).toMatch(
      /Understanding|Gathering info|Drafting a reply|Key points|Analyzing/,
    );
    expect(snap.steps.every((s) => !/[\u4e00-\u9fff]/.test(s.label))).toBe(true);
    expect(isSafeThinkingProgressSnapshot(snap)).toBe(true);
  });

  it("allows short English headings for English users", () => {
    expect(sanitizeThinkingStepLabel("Check export path", "en")).toBe("Check export path");
    expect(sanitizeThinkingStepLabel("Let me check sandbox", "en")).toBeNull();
  });
});
