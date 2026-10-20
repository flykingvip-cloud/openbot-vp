import { describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../../config/config.js";
import {
  filterEmployeeDisplayModelIds,
  isSupervisionOrCliProvider,
} from "./filter-employee-display-models.js";

function cfgWithProviders(providers: Record<string, { models: Array<string | { id: string }> }>) {
  return {
    models: { providers },
  } as unknown as OpenBotConfig;
}

describe("isSupervisionOrCliProvider", () => {
  it("flags known CLI / supervision providers", () => {
    expect(isSupervisionOrCliProvider("codex-cli")).toBe(true);
    expect(isSupervisionOrCliProvider("cursor-cli")).toBe(true);
    expect(isSupervisionOrCliProvider("kiro-cli")).toBe(true);
    expect(isSupervisionOrCliProvider("claude-cli")).toBe(true);
    expect(isSupervisionOrCliProvider("api-proxy-deepseek")).toBe(false);
  });
});

describe("filterEmployeeDisplayModelIds", () => {
  it("keeps only configured non-CLI models", () => {
    const cfg = cfgWithProviders({
      "api-proxy-deepseek": { models: [{ id: "deepseek-v4-flash" }] },
      google: { models: [{ id: "gemini-2.0-flash" }] },
    });
    const filtered = filterEmployeeDisplayModelIds(
      [
        "api-proxy-deepseek/deepseek-v4-flash",
        "codex-cli/gpt-5.4",
        "cursor-cli/gpt-5",
        "cursor-cli/sonnet-4",
        "kiro-cli/kiro-default",
        "api-proxy-claude/claude-sonnet-4-5-20250929",
        "ollama/llama3.2",
        "google/gemini-2.0-flash",
      ],
      cfg,
    );
    expect(filtered).toEqual(["api-proxy-deepseek/deepseek-v4-flash", "google/gemini-2.0-flash"]);
  });

  it("drops entitled ids whose provider is not configured", () => {
    const cfg = cfgWithProviders({
      "api-proxy-deepseek": { models: [{ id: "deepseek-v4-flash" }] },
    });
    expect(
      filterEmployeeDisplayModelIds(
        ["api-proxy-gpt/gpt-5.2", "api-proxy-deepseek/deepseek-v4-flash"],
        cfg,
      ),
    ).toEqual(["api-proxy-deepseek/deepseek-v4-flash"]);
  });
});
