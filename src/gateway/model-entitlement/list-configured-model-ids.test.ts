import { describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../../config/types.js";
import { listConfiguredModelIds } from "./resolve-effective-model-set.js";

describe("listConfiguredModelIds — provider catalog", () => {
  it("enumerates provider/id from models.providers", () => {
    const cfg = {
      models: {
        providers: {
          anthropic: { models: [{ id: "claude-sonnet" }, { id: "claude-opus" }] },
          openai: { models: [{ id: "gpt-5" }] },
        },
      },
    } as unknown as OpenBotConfig;
    expect(listConfiguredModelIds(cfg).toSorted()).toEqual(
      ["anthropic/claude-opus", "anthropic/claude-sonnet", "openai/gpt-5"].toSorted(),
    );
  });

  it("returns [] for empty/undefined config", () => {
    expect(listConfiguredModelIds(undefined)).toEqual([]);
    expect(listConfiguredModelIds({} as OpenBotConfig)).toEqual([]);
  });
});

describe("listConfiguredModelIds — CLI backend bridge (cli-backend-onboarding Task 2)", () => {
  it("unions CLI backend modelCatalog as <backendId>/<model>", () => {
    const cfg = {
      agents: {
        defaults: {
          cliBackends: {
            "kiro-cli": { command: "kiro", modelCatalog: [{ id: "k1" }, { id: "k2" }] },
            "claude-cli": { command: "claude", modelCatalog: [{ id: "claude-sonnet" }] },
          },
        },
      },
    } as unknown as OpenBotConfig;
    expect(listConfiguredModelIds(cfg).toSorted()).toEqual(
      ["claude-cli/claude-sonnet", "kiro-cli/k1", "kiro-cli/k2"].toSorted(),
    );
  });

  it("merges provider catalog + CLI backend catalog, de-duped", () => {
    const cfg = {
      models: { providers: { openai: { models: [{ id: "gpt-5" }] } } },
      agents: {
        defaults: {
          cliBackends: { "kiro-cli": { command: "kiro", modelCatalog: [{ id: "k1" }] } },
        },
      },
    } as unknown as OpenBotConfig;
    expect(listConfiguredModelIds(cfg).toSorted()).toEqual(
      ["kiro-cli/k1", "openai/gpt-5"].toSorted(),
    );
  });

  it("ignores CLI backends without a declared modelCatalog (zero regression)", () => {
    const cfg = {
      agents: {
        defaults: {
          cliBackends: { "codex-cli": { command: "codex" } },
        },
      },
    } as unknown as OpenBotConfig;
    expect(listConfiguredModelIds(cfg)).toEqual([]);
  });
});
