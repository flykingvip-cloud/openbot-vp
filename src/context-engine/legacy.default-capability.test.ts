/**
 * Default context capability must reach LegacyContextEngine, not only the flag resolver.
 * Env is cleared. Defaults and explicit config are the inputs under test.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { afterEach, describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../config/config.js";
import { CONVERSATION_PRODUCTION_DEFAULTS } from "../conversations/flags.js";
import { resetProjectionStoreCache } from "../conversations/projection-store.js";
import { LegacyContextEngine, getLegacyProjectionForTests } from "./legacy.js";

const ENV_KEYS = ["OPENBOT_CONVERSATION_CONTEXT_PLANNER", "OPENBOT_CONVERSATION_PROJECTION"];

function user(text: string): AgentMessage {
  return { role: "user", content: text, timestamp: 1 } as unknown as AgentMessage;
}

function assistant(text: string): AgentMessage {
  return { role: "assistant", content: text, timestamp: 2 } as unknown as AgentMessage;
}

function longHistory(): AgentMessage[] {
  const messages: AgentMessage[] = [];
  for (let i = 0; i < 8; i++) {
    messages.push(user(`u${i} ${"a".repeat(120)}`));
    messages.push(assistant(`a${i} ${"b".repeat(120)}`));
  }
  messages.push(user("final question"));
  return messages;
}

function localCfg(dataRoot: string, conversation?: Record<string, unknown>): OpenBotConfig {
  return {
    data: { root: dataRoot, mode: "local", schemaVersion: 1 },
    ...(conversation ? { conversation } : {}),
  } as OpenBotConfig;
}

describe("LegacyContextEngine default capability", () => {
  const roots: string[] = [];
  const saved: Record<string, string | undefined> = {};

  afterEach(async () => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
    resetProjectionStoreCache();
    for (const root of roots.splice(0)) {
      await fs.rm(root, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  function clearEnv() {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  }

  it("no env + default config + tokenBudget produces a real budget trace", async () => {
    clearEnv();
    const engine = new LegacyContextEngine({
      conversation: CONVERSATION_PRODUCTION_DEFAULTS,
    } as OpenBotConfig);
    const result = await engine.assemble({
      sessionId: "sess-default-budget",
      messages: longHistory(),
      tokenBudget: 3_500,
    });
    expect(result.budgetTrace).toBeTruthy();
    expect(result.budgetTrace?.modelContextTokens).toBe(3_500);
    expect(result.estimatedTokens).toBeGreaterThan(0);
    expect(result.messages.at(-1)).toMatchObject({ role: "user", content: "final question" });
    expect(result.capabilityDecisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          capability: "context_planner",
          enabled: true,
          applied: true,
          reason: null,
        }),
      ]),
    );
  });

  it("explicit false disables and explicit true enables without env", async () => {
    clearEnv();
    const off = new LegacyContextEngine(
      localCfg("/tmp/unused-off", {
        contextPlanner: { enabled: false },
        projection: { enabled: false },
      }),
    );
    const disabled = await off.assemble({
      sessionId: "sess-off",
      messages: longHistory(),
      tokenBudget: 3_500,
    });
    expect(disabled.budgetTrace).toBeUndefined();
    expect(disabled.messages).toHaveLength(longHistory().length);
    expect(disabled.capabilityDecisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          capability: "context_planner",
          enabled: false,
          applied: false,
          reason: "disabled_by_config",
        }),
        expect.objectContaining({
          capability: "conversation_projection",
          enabled: false,
          applied: false,
          reason: "disabled_by_config",
        }),
      ]),
    );

    const on = new LegacyContextEngine(
      localCfg("/tmp/unused-on", {
        contextPlanner: { enabled: true },
        projection: { enabled: true },
      }),
    );
    const enabled = await on.assemble({
      sessionId: "sess-on",
      messages: [user("hello")],
      tokenBudget: 1,
    });
    expect(enabled.budgetTrace).toBeTruthy();
    expect(enabled.budgetTrace?.modelContextTokens).toBe(1);
  });

  it("env override wins over the opposite config value", async () => {
    clearEnv();
    process.env.OPENBOT_CONVERSATION_CONTEXT_PLANNER = "0";
    const envOff = await new LegacyContextEngine(
      localCfg("/tmp/unused-env-off", { contextPlanner: { enabled: true } }),
    ).assemble({
      sessionId: "sess-env-off",
      messages: [user("hello")],
      tokenBudget: 2_000,
    });
    expect(envOff.budgetTrace).toBeUndefined();
    expect(envOff.capabilityDecisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          capability: "context_planner",
          reason: "disabled_by_env",
        }),
      ]),
    );

    process.env.OPENBOT_CONVERSATION_CONTEXT_PLANNER = "1";
    const envOn = await new LegacyContextEngine(
      localCfg("/tmp/unused-env-on", { contextPlanner: { enabled: false } }),
    ).assemble({
      sessionId: "sess-env-on",
      messages: [user("hello")],
      tokenBudget: 2_000,
    });
    expect(envOn.budgetTrace?.modelContextTokens).toBe(2_000);
  });

  it("missing budget and missing conversation id are skips, not errors", async () => {
    clearEnv();
    const engine = new LegacyContextEngine();
    const noBudget = await engine.assemble({
      sessionId: "sess-no-budget",
      messages: [user("keep me")],
    });
    expect(noBudget.budgetTrace).toBeUndefined();
    expect(noBudget.messages[0]).toMatchObject({ role: "user", content: "keep me" });
    expect(noBudget.capabilityDecisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          capability: "context_planner",
          enabled: true,
          applied: false,
          reason: "missing_token_budget",
        }),
        expect.objectContaining({
          capability: "conversation_projection",
          enabled: true,
          applied: false,
          reason: "missing_conversation_id",
        }),
      ]),
    );

    await engine.afterTurn?.({
      sessionId: "sess-no-conv",
      sessionFile: "/tmp/none.jsonl",
      messages: [user("no conversation id")],
      prePromptMessageCount: 0,
      runtimeContext: { sessionKey: "agent:main:main" },
    });
    expect(engine.lastCapabilityDecisions).toEqual([
      expect.objectContaining({
        capability: "conversation_projection",
        enabled: true,
        applied: false,
        reason: "missing_conversation_id",
      }),
    ]);
  });

  it("resolveContextEngine binds the request config into the legacy engine", async () => {
    clearEnv();
    const { ensureContextEnginesInitialized } = await import("./init.js");
    const { resolveContextEngine } = await import("./registry.js");
    ensureContextEnginesInitialized();
    const engine = await resolveContextEngine(
      localCfg(path.join(os.tmpdir(), "legacy-resolver-unused"), {
        contextPlanner: { enabled: false },
        projection: { enabled: false },
      }),
    );
    const result = await engine.assemble({
      sessionId: "sess-resolver",
      messages: [user("hello")],
      tokenBudget: 2_000,
    });
    expect(result.budgetTrace).toBeUndefined();
    expect(result.capabilityDecisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          capability: "context_planner",
          enabled: false,
          reason: "disabled_by_config",
        }),
      ]),
    );
  });

  it("afterTurn writes a projection that the next assemble consumes after restart", async () => {
    clearEnv();
    const dataRoot = path.join(os.tmpdir(), `legacy-default-proj-${Date.now()}-${Math.random()}`);
    roots.push(dataRoot);
    const cfg = localCfg(dataRoot, {
      projection: { enabled: true },
      contextPlanner: { enabled: true },
    });
    const sessionId = "sess-restart";
    const sessionKey = "agent:helper:conversation:conv_restart_1";
    const first = new LegacyContextEngine(cfg);
    await first.afterTurn?.({
      sessionId,
      sessionFile: path.join(dataRoot, "session.jsonl"),
      messages: [user("remember the deadline is Monday")],
      prePromptMessageCount: 0,
      runtimeContext: { sessionKey, config: cfg },
    });
    expect(first.lastCapabilityDecisions).toEqual([
      expect.objectContaining({
        capability: "conversation_projection",
        applied: true,
        reason: null,
      }),
    ]);
    const stored = await getLegacyProjectionForTests("conv_restart_1", cfg);
    expect(String(stored?.shortSummary ?? "").toLowerCase()).toContain("monday");

    resetProjectionStoreCache();
    const restarted = new LegacyContextEngine(cfg);
    const next = await restarted.assemble({
      sessionId,
      messages: [user("what was the deadline?")],
      tokenBudget: 4_000,
    });
    expect(next.budgetTrace).toBeTruthy();
    expect(next.systemPromptAddition?.toLowerCase()).toContain("monday");
    expect(next.messages.at(-1)).toMatchObject({
      role: "user",
      content: "what was the deadline?",
    });
    expect(next.capabilityDecisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          capability: "conversation_projection",
          enabled: true,
          applied: true,
          reason: null,
        }),
      ]),
    );
  });
});
