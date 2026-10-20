import { describe, expect, it } from "vitest";
import {
  CONTEXT_BUDGET_AGENT_PRESETS,
  DEFAULT_CONTEXT_BUDGET,
  resolveContextBudget,
} from "./resolve-context-budget.js";

describe("resolveContextBudget", () => {
  it("defaults to disabled when no config is set", () => {
    const resolved = resolveContextBudget({}, "main");
    expect(resolved.enabled).toBe(false);
  });

  it("enables budget when agents.defaults.contextBudget is present", () => {
    const resolved = resolveContextBudget(
      {
        agents: {
          defaults: {
            contextBudget: { maxTokens: 9000 },
          },
        },
      },
      "main",
    );
    expect(resolved.enabled).toBe(true);
    expect(resolved.maxChars).toBe(9000 * 4);
  });

  it("applies agent preset priority for sales-agent", () => {
    const resolved = resolveContextBudget(
      {
        agents: {
          defaults: {
            contextBudget: { maxTokens: DEFAULT_CONTEXT_BUDGET.maxTokens },
          },
        },
      },
      "sales-agent",
    );
    expect(resolved.priority[0]).toBe("current_task");
    expect(resolved.maxChars).toBe(CONTEXT_BUDGET_AGENT_PRESETS["sales-agent"].maxTokens! * 4);
  });
});
