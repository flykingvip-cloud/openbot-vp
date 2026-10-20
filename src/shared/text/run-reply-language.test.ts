import { describe, expect, it } from "vitest";
import {
  clearRunReplyLanguage,
  getRunReplyLanguage,
  registerRunReplyLanguage,
  resetRunReplyLanguageForTest,
} from "./run-reply-language.js";

describe("run-reply-language", () => {
  it("stores and clears per-run language", () => {
    resetRunReplyLanguageForTest();
    registerRunReplyLanguage("run-1", "en");
    expect(getRunReplyLanguage("run-1")).toBe("en");
    clearRunReplyLanguage("run-1");
    expect(getRunReplyLanguage("run-1")).toBeNull();
  });
});
