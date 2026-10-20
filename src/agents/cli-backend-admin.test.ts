import { describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../config/config.js";
import {
  CLI_BACKEND_PRESETS,
  describeCliBackendCapabilities,
  describeCliBackends,
  hasConfiguredCliBackend,
  listCliBackendCatalogModelRefs,
  removeCliBackendConfig,
  setCliBackendConfig,
  validateCliBackendConfig,
  validateCliBackendId,
} from "./cli-backend-admin.js";

describe("cli-backend-admin — validation", () => {
  it("accepts a minimal valid config (command only)", () => {
    const c = validateCliBackendConfig({ command: "kiro" });
    expect(c.command).toBe("kiro");
  });

  it("accepts a full config and rejects unknown keys (strict)", () => {
    expect(() =>
      validateCliBackendConfig({ command: "codex", args: ["exec"], output: "jsonl" }),
    ).not.toThrow();
    expect(() => validateCliBackendConfig({ command: "x", bogus: 1 })).toThrow();
  });

  it("rejects empty command and bad enums", () => {
    expect(() => validateCliBackendConfig({ command: "" })).toThrow();
    expect(() => validateCliBackendConfig({ command: "x", output: "yaml" })).toThrow();
  });

  it("validates ids as lowercase slugs", () => {
    expect(validateCliBackendId("kiro-cli")).toBe("kiro-cli");
    expect(() => validateCliBackendId("Kiro CLI")).toThrow();
    expect(() => validateCliBackendId("a/b")).toThrow();
    expect(() => validateCliBackendId("")).toThrow();
  });
});

describe("cli-backend-admin — describe", () => {
  it("lists builtins with source=builtin when not configured", () => {
    const list = describeCliBackends(undefined);
    const claude = list.find((b) => b.id === "claude-cli");
    const codex = list.find((b) => b.id === "codex-cli");
    const kiro = list.find((b) => b.id === "kiro-cli");
    const cursor = list.find((b) => b.id === "cursor-cli");
    const devin = list.find((b) => b.id === "devin-cli");
    const grok = list.find((b) => b.id === "grok-cli");
    expect(claude?.source).toBe("builtin");
    expect(codex?.source).toBe("builtin");
    expect(kiro?.source).toBe("builtin");
    expect(cursor?.source).toBe("builtin");
    expect(devin?.source).toBe("builtin");
    expect(grok?.source).toBe("builtin");
    expect(claude?.effective?.command).toBe("claude");
    expect(codex?.effective?.worker?.control).toEqual(
      expect.arrayContaining(["streaming", "cancellable"]),
    );
    expect(kiro?.effective?.command).toBe("kiro-cli");
    expect(cursor?.effective?.command).toBe("cursor-agent");
    expect(devin?.effective?.command).toBe("devin");
    expect(grok?.effective?.command).toBe("grok");
    expect(kiro?.effective?.worker?.taskCapabilities).toContain("coding");
  });

  it("marks a configured builtin as override and a custom one as config", () => {
    const cfg = {
      agents: {
        defaults: {
          cliBackends: {
            "claude-cli": { command: "/usr/local/bin/claude" },
            "kiro-cli": { command: "/opt/bin/kiro-cli" },
            "my-cli": { command: "my-cli" },
          },
        },
      },
    } as OpenBotConfig;
    const list = describeCliBackends(cfg);
    expect(list.find((b) => b.id === "claude-cli")?.source).toBe("override");
    const kiro = list.find((b) => b.id === "kiro-cli");
    expect(kiro?.source).toBe("override");
    expect(kiro?.configured).toBe(true);
    expect(kiro?.effective?.command).toBe("/opt/bin/kiro-cli");
    expect(list.find((b) => b.id === "my-cli")?.source).toBe("config");
  });
});

describe("cli-backend-admin — pure config mutations", () => {
  const base = { agents: { defaults: {} } } as OpenBotConfig;

  it("setCliBackendConfig adds without mutating the input", () => {
    const next = setCliBackendConfig(base, "kiro-cli", { command: "kiro" });
    expect(next.agents?.defaults?.cliBackends?.["kiro-cli"]?.command).toBe("kiro");
    expect(base.agents?.defaults?.cliBackends).toBeUndefined();
  });

  it("removeCliBackendConfig deletes the entry", () => {
    const withOne = setCliBackendConfig(base, "kiro-cli", { command: "kiro" });
    const removed = removeCliBackendConfig(withOne, "kiro-cli");
    expect(removed.agents?.defaults?.cliBackends?.["kiro-cli"]).toBeUndefined();
  });

  it("hasConfiguredCliBackend is case-insensitive", () => {
    const withOne = setCliBackendConfig(base, "kiro-cli", { command: "kiro" });
    expect(hasConfiguredCliBackend(withOne, "kiro-cli")).toBe(true);
    expect(hasConfiguredCliBackend(withOne, "missing")).toBe(false);
  });
});

describe("cli-backend-admin — presets", () => {
  it("ships claude/codex/kiro/cursor/devin/grok presets that validate", () => {
    const ids = CLI_BACKEND_PRESETS.map((p) => p.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "claude-cli",
        "codex-cli",
        "kiro-cli",
        "cursor-cli",
        "devin-cli",
        "grok-cli",
      ]),
    );
    for (const preset of CLI_BACKEND_PRESETS) {
      expect(() => validateCliBackendConfig(preset.config)).not.toThrow();
    }
  });
});

describe("cli-backend-admin — structured modelCatalog (P0-1)", () => {
  it("validates structured catalog entries and rejects bad ids", () => {
    expect(() =>
      validateCliBackendConfig({
        command: "kiro",
        modelCatalog: [{ id: "kiro-default", displayName: "Kiro", capabilities: { tools: true } }],
      }),
    ).not.toThrow();
    expect(() =>
      validateCliBackendConfig({ command: "kiro", modelCatalog: [{ id: "bad id!" }] }),
    ).toThrow();
    expect(() =>
      validateCliBackendConfig({ command: "kiro", modelCatalog: [{ id: "x", bogus: 1 }] }),
    ).toThrow();
  });

  it("listCliBackendCatalogModelRefs enumerates <backendId>/<modelId>", () => {
    const cfg = {
      agents: {
        defaults: {
          cliBackends: {
            "kiro-cli": { command: "kiro", modelCatalog: [{ id: "k1" }, { id: "k2" }] },
            "x-cli": { command: "x", modelCatalog: [{ id: "m" }] },
          },
        },
      },
    } as OpenBotConfig;
    expect(listCliBackendCatalogModelRefs(cfg).toSorted()).toEqual(
      ["kiro-cli/k1", "kiro-cli/k2", "x-cli/m"].toSorted(),
    );
    expect(listCliBackendCatalogModelRefs(undefined)).toEqual([]);
  });

  it("describeCliBackendCapabilities aggregates declared features (P0-2)", () => {
    const cfg = {
      agents: {
        defaults: {
          cliBackends: {
            "kiro-cli": {
              command: "kiro",
              modelCatalog: [
                { id: "a", capabilities: { tools: true } },
                { id: "b", capabilities: { streaming: true } },
              ],
            },
          },
        },
      },
    } as OpenBotConfig;
    const caps = describeCliBackendCapabilities(cfg, "kiro-cli");
    expect(caps.backendId).toBe("kiro-cli");
    expect(caps.models).toHaveLength(2);
    expect(caps.features).toEqual({ streaming: true, tools: true, vision: false });
    expect(caps.source).toBe("declared");
  });
});
