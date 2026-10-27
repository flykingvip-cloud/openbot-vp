/**
 * Ev1 seam: production chat.send calls dispatchInboundMessage with no custom
 * replyResolver, so this fixture uses the real getReplyFromConfig. The HTTP
 * gateway method itself is not started. runReplyAgent is faked so no model runs.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenBotConfig } from "../config/config.js";
import { loadSessionStore } from "../config/sessions/store.js";

const { runReplyAgentMock } = vi.hoisted(() => ({
  runReplyAgentMock: vi.fn(async (..._args: unknown[]) => ({ text: "agent-ran" })),
}));

vi.mock("./reply/agent-runner.js", () => ({
  runReplyAgent: (...args: unknown[]) => runReplyAgentMock(...args),
}));

import { dispatchInboundMessage } from "./dispatch.js";
import type { ReplyDispatcher } from "./reply/reply-dispatcher.js";

const SESSION_KEY = "agent:main:ogui-dispatch";

function legacyAnswer(): string {
  return [
    "```ogui-answer",
    JSON.stringify({
      schema_version: "ogui/v1",
      component_id: "cmp-1",
      submission_id: "legacy-dispatch",
      answers: { choice: "a" },
    }),
    "```",
  ].join("\n");
}

function makeCfg(home: string, storePath: string): OpenBotConfig {
  return {
    agents: {
      defaults: {
        model: { primary: "openai/mock-1" },
        workspace: path.join(home, "workspace"),
        skipBootstrap: true,
      },
    },
    models: {
      providers: {
        openai: {
          api: "openai-responses",
          apiKey: "sk-test",
          baseUrl: "https://example.invalid",
          models: [
            {
              id: "mock-1",
              name: "Mock 1",
              reasoning: false,
              input: ["text"],
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow: 16_000,
              maxTokens: 2048,
            },
          ],
        },
      },
    },
    session: { store: storePath },
    collaboration: { task: { oguiDecisionLifecycle: true } },
  } as OpenBotConfig;
}

describe("dispatchInboundMessage legacy OGUI answer", () => {
  let home = "";
  let previousLifecycle: string | undefined;
  const envKeys = [
    "HOME",
    "USERPROFILE",
    "OPENCLAW_STATE_DIR",
    "OPENCLAW_HOME",
    "OPENCLAW_TEST_FAST",
  ] as const;
  const previousEnv = new Map<string, string | undefined>();

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "ogui-dispatch-"));
    fs.mkdirSync(path.join(home, ".openclaw", "agents", "main", "sessions"), { recursive: true });
    previousLifecycle = process.env.OPENBOT_OGUI_DECISION_LIFECYCLE;
    process.env.OPENBOT_OGUI_DECISION_LIFECYCLE = "1";
    for (const key of envKeys) {
      previousEnv.set(key, process.env[key]);
    }
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    process.env.OPENCLAW_STATE_DIR = path.join(home, ".openclaw");
    process.env.OPENCLAW_HOME = "";
    process.env.OPENCLAW_TEST_FAST = "1";
    runReplyAgentMock.mockClear();
  });

  afterEach(() => {
    if (previousLifecycle === undefined) {
      delete process.env.OPENBOT_OGUI_DECISION_LIFECYCLE;
    } else {
      process.env.OPENBOT_OGUI_DECISION_LIFECYCLE = previousLifecycle;
    }
    for (const key of envKeys) {
      const value = previousEnv.get(key);
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("lets a legacy answer through getReplyFromConfig and writes no decision (Ev1)", async () => {
    const storePath = path.join(home, "sessions.json");
    const text = legacyAnswer();
    const finals: string[] = [];
    const dispatcher = {
      sendToolResult: () => true,
      sendBlockReply: () => true,
      sendFinalReply: (payload: { text?: string }) => {
        if (payload.text) {
          finals.push(payload.text);
        }
        return true;
      },
      getQueuedCounts: () => ({ tool: 0, block: 0, final: finals.length }),
      markComplete: () => undefined,
      waitForIdle: async () => undefined,
    } satisfies ReplyDispatcher;

    await dispatchInboundMessage({
      ctx: {
        Body: text,
        BodyForAgent: text,
        BodyForCommands: text,
        RawBody: text,
        CommandBody: text,
        SessionKey: SESSION_KEY,
        Provider: "webchat",
        Surface: "webchat",
        OriginatingChannel: "webchat",
        ChatType: "direct",
        CommandAuthorized: true,
        GatewayClientPlatformUserId: "user-1",
      },
      cfg: makeCfg(home, storePath),
      dispatcher,
      replyOptions: { runId: "run-ogui-dispatch" },
    });

    expect(runReplyAgentMock).toHaveBeenCalledTimes(1);
    expect(finals).toContain("agent-ran");
    const stored = loadSessionStore(storePath, { skipCache: true });
    for (const entry of Object.values(stored)) {
      expect(entry.oguiDecisions).toBeUndefined();
    }
  }, 60_000);
});
