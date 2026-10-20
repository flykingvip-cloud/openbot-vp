import { describe, expect, it, vi } from "vitest";
import type { OpenBotConfig } from "../../config/config.js";
import type { AgentConfig } from "../../config/types.agents.js";
import { BUILTIN_STEWARD_NAME, isBuiltinStewardAgent } from "./identity.js";
import { ensureBuiltinStewardAgent, maybeProvisionBuiltinStewardAtStartup } from "./provision.js";

function listOf(cfg: OpenBotConfig): AgentConfig[] {
  return cfg.agents?.list ?? [];
}

function defaultCount(cfg: OpenBotConfig): number {
  return listOf(cfg).filter((entry) => entry.default === true).length;
}

function steward(cfg: OpenBotConfig): AgentConfig | undefined {
  return listOf(cfg).find((entry) => isBuiltinStewardAgent(entry.id));
}

describe("ensureBuiltinStewardAgent", () => {
  it("(a) injects steward as default for an empty config", () => {
    const out = ensureBuiltinStewardAgent({});
    const entry = steward(out);
    expect(entry).toBeDefined();
    expect(entry?.default).toBe(true);
    expect(entry?.identity?.name).toBe(BUILTIN_STEWARD_NAME);
    expect(entry?.memorySearch?.enabled).toBe(true);
    expect(entry?.tools?.alsoAllow).toContain("schedule");
    expect(entry?.tools?.alsoAllow).toContain("meeting");
    expect(entry?.tools?.alsoAllow).toContain("knowledge_source");
    expect(entry?.tools?.alsoAllow).toContain("diagnose");
    expect(entry?.tools?.alsoAllow).toContain("evolution_perception");
    expect(entry?.tools?.alsoAllow).toContain("conversation_send");
    expect(defaultCount(out)).toBe(1);
  });

  it("(b) does not steal the default when another default agent exists", () => {
    const cfg: OpenBotConfig = {
      agents: { list: [{ id: "agent-sales", default: true }] },
    };
    const out = ensureBuiltinStewardAgent(cfg);
    const entry = steward(out);
    expect(entry).toBeDefined();
    expect(entry?.default).toBeUndefined();
    // Existing default is untouched.
    expect(listOf(out).find((e) => e.id === "agent-sales")?.default).toBe(true);
    // Never creates a second default.
    expect(defaultCount(out)).toBe(1);
  });

  it("(c) marks the existing main entry as default when nothing else is default", () => {
    const cfg: OpenBotConfig = {
      agents: { list: [{ id: "main" }, { id: "agent-sales" }] },
    };
    const out = ensureBuiltinStewardAgent(cfg);
    expect(steward(out)?.default).toBe(true);
    expect(defaultCount(out)).toBe(1);
  });

  it("only fills missing fields on an existing steward entry (no overwrite)", () => {
    const cfg: OpenBotConfig = {
      agents: {
        list: [
          {
            id: "main",
            default: true,
            identity: { name: "我的助理" },
            memorySearch: { enabled: false },
          },
        ],
      },
    };
    const out = ensureBuiltinStewardAgent(cfg);
    const entry = steward(out);
    // User-customized name preserved.
    expect(entry?.identity?.name).toBe("我的助理");
    // Missing identity sub-fields filled from preset.
    expect(entry?.identity?.emoji).toBeTruthy();
    // User-customized memorySearch preserved (not overwritten to enabled:true).
    expect(entry?.memorySearch?.enabled).toBe(false);
    // Additive schedule/meeting grants when missing.
    expect(entry?.tools?.alsoAllow).toContain("schedule");
    expect(entry?.tools?.alsoAllow).toContain("meeting");
    expect(entry?.tools?.alsoAllow).toContain("knowledge_source");
  });

  it("does not re-add schedule when the steward already denies it", () => {
    const cfg: OpenBotConfig = {
      agents: {
        list: [
          {
            id: "main",
            default: true,
            tools: { deny: ["schedule"], alsoAllow: ["read"] },
          },
        ],
      },
    };
    const out = ensureBuiltinStewardAgent(cfg);
    expect(steward(out)?.tools?.alsoAllow).toContain("read");
    expect(steward(out)?.tools?.alsoAllow).not.toContain("schedule");
    expect(steward(out)?.tools?.deny).toEqual(["schedule"]);
    expect(steward(out)?.tools?.alsoAllow).toContain("knowledge_source");
  });

  it("allows users to deny knowledge-source configuration explicitly", () => {
    const cfg: OpenBotConfig = {
      agents: {
        list: [
          {
            id: "main",
            default: true,
            tools: { deny: ["knowledge_source"], alsoAllow: ["read"] },
          },
        ],
      },
    };
    const out = ensureBuiltinStewardAgent(cfg);
    expect(steward(out)?.tools?.alsoAllow).not.toContain("knowledge_source");
    expect(steward(out)?.tools?.alsoAllow).toContain("schedule");
  });

  it("is idempotent (second call produces an equivalent list)", () => {
    const first = ensureBuiltinStewardAgent({});
    const second = ensureBuiltinStewardAgent(first);
    expect(second.agents?.list).toEqual(first.agents?.list);
    expect(defaultCount(second)).toBe(1);
  });

  it("does not touch unrelated agents (multi-agent safety)", () => {
    const cfg: OpenBotConfig = {
      agents: { list: [{ id: "agent-sales", default: true, workspace: "/tmp/sales" }] },
    };
    const out = ensureBuiltinStewardAgent(cfg);
    const sales = listOf(out).find((e) => e.id === "agent-sales");
    expect(sales).toEqual({ id: "agent-sales", default: true, workspace: "/tmp/sales" });
  });

  it("does not mutate the input config", () => {
    const cfg: OpenBotConfig = { agents: { list: [] } };
    const snapshot = JSON.stringify(cfg);
    ensureBuiltinStewardAgent(cfg);
    expect(JSON.stringify(cfg)).toBe(snapshot);
  });
});

it("adds meeting to alsoAllow so steward sessions prefer meeting over exec", () => {
  const out = ensureBuiltinStewardAgent({});
  expect(steward(out)?.tools?.alsoAllow).toContain("meeting");
});

it("does not re-add meeting when the steward already denies it", () => {
  const cfg: OpenBotConfig = {
    agents: {
      list: [
        {
          id: "main",
          default: true,
          tools: { deny: ["meeting"], alsoAllow: ["read"] },
        },
      ],
    },
  };
  const out = ensureBuiltinStewardAgent(cfg);
  expect(steward(out)?.tools?.alsoAllow).not.toContain("meeting");
  expect(steward(out)?.tools?.deny).toEqual(["meeting"]);
  expect(steward(out)?.tools?.alsoAllow).toContain("schedule");
});

describe("maybeProvisionBuiltinStewardAtStartup", () => {
  it("persists once when the steward entry is missing", async () => {
    const writeConfig = vi.fn(async () => {});
    const out = await maybeProvisionBuiltinStewardAtStartup({
      config: { agents: { list: [{ id: "agent-sales", default: true }] } },
      writeConfig,
    });
    expect(writeConfig).toHaveBeenCalledTimes(1);
    expect(steward(out)?.default).toBeUndefined();
    expect(defaultCount(out)).toBe(1);
  });

  it("is idempotent (no write when steward already present)", async () => {
    const seeded = ensureBuiltinStewardAgent({});
    const writeConfig = vi.fn(async () => {});
    const out = await maybeProvisionBuiltinStewardAtStartup({ config: seeded, writeConfig });
    expect(writeConfig).not.toHaveBeenCalled();
    expect(out).toBe(seeded);
  });
});
