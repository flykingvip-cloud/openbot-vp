import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  gitPorcelain,
  resolveRepoRoot,
} from "../../../.kiro/specs/execution-router-phase0/shadow/artifact.ts";
import type { OpenBotConfig } from "../../config/config.js";
import {
  configureExecutionRouterObservationForTest,
  executionRouterObservationSize,
  resetExecutionRouterObservationForTest,
  type ChatRunObservation,
} from "../../gateway/execution-router-observation.js";
import type { ReplyDispatcher } from "./reply-dispatcher.js";
import { buildTestCtx } from "./test-ctx.js";

function createMockUsage(input: number, output: number) {
  return {
    input,
    output,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: input + output,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

vi.mock("@earendil-works/pi-ai/compat", async () => {
  const actual = await vi.importActual<typeof import("@earendil-works/pi-ai/compat")>(
    "@earendil-works/pi-ai/compat",
  );
  const buildAssistantMessage = (model: { api: string; provider: string; id: string }) => ({
    role: "assistant" as const,
    content: [{ type: "text" as const, text: "mainchain-ok" }],
    stopReason: "stop" as const,
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: createMockUsage(4, 2),
    timestamp: Date.now(),
  });
  return {
    ...actual,
    complete: async (model: { api: string; provider: string; id: string }) =>
      buildAssistantMessage(model),
    completeSimple: async (model: { api: string; provider: string; id: string }) =>
      buildAssistantMessage(model),
    streamSimple: (model: { api: string; provider: string; id: string }) => {
      const stream = actual.createAssistantMessageEventStream();
      queueMicrotask(() => {
        stream.push({
          type: "done",
          reason: "stop",
          message: buildAssistantMessage(model),
        });
        stream.end();
      });
      return stream;
    },
  };
});

vi.mock("../../agents/pi-tools.js", () => ({
  createOpenClawCodingTools: () => [],
  resolveToolLoopDetectionConfig: () => ({}),
}));

vi.mock("../../agents/openai-ws-stream.js", () => ({
  createOpenAIWebSocketStreamFn: vi.fn(),
  releaseWsSession: () => {},
}));

const { dispatchReplyFromConfig } = await import("./dispatch-from-config.js");
const { getReplyFromConfig } = await import("../reply.js");

const TEST_SOURCE = await fs.readFile(new URL(import.meta.url), "utf8");

function makeCfg(home: string): OpenBotConfig {
  return {
    agents: {
      defaults: {
        model: { primary: "openai/mock-1" },
        workspace: path.join(home, "openclaw"),
        skipBootstrap: true,
        blockStreamingCoalesce: { idleMs: 1 },
        humanDelay: { mode: "off" },
      },
    },
    models: {
      providers: {
        openai: {
          api: "openai-responses",
          apiKey: "sk-test",
          baseUrl: "https://example.com",
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
    channels: {
      whatsapp: { allowFrom: ["*"] },
    },
    messages: {
      queue: { debounceMs: 0 },
    },
    session: { store: path.join(home, "sessions.json") },
  } as OpenBotConfig;
}

function createDispatcher(): ReplyDispatcher {
  return {
    sendToolResult: vi.fn(() => true),
    sendBlockReply: vi.fn(() => true),
    sendFinalReply: vi.fn(() => true),
    waitForIdle: vi.fn(async () => {}),
    getQueuedCounts: vi.fn(() => ({ tool: 0, block: 0, final: 0 })),
    markComplete: vi.fn(),
  };
}

function replyText(reply: Awaited<ReturnType<typeof getReplyFromConfig>>): string | undefined {
  return Array.isArray(reply) ? reply[0]?.text : reply?.text;
}

const ORIGINAL_ENV = {
  HOME: process.env.HOME,
  USERPROFILE: process.env.USERPROFILE,
  OPENCLAW_STATE_DIR: process.env.OPENCLAW_STATE_DIR,
  OPENCLAW_HOME: process.env.OPENCLAW_HOME,
  OPENCLAW_TEST_FAST: process.env.OPENCLAW_TEST_FAST,
  OPENBOT_EXECUTION_ROUTER_OBSERVATION: process.env.OPENBOT_EXECUTION_ROUTER_OBSERVATION,
};

describe("Phase 0 main-chain end-to-end observation", () => {
  const delivered: ChatRunObservation[] = [];
  const repoRoot = resolveRepoRoot();
  let porcelainBaseline = "";
  let home = "";
  let nowMs = 3_000_000;

  beforeAll(() => {
    porcelainBaseline = gitPorcelain(repoRoot);
  });

  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-mainchain-"));
    await fs.mkdir(path.join(home, ".openclaw", "agents", "main", "sessions"), { recursive: true });
    vi.stubEnv("HOME", home);
    vi.stubEnv("USERPROFILE", home);
    vi.stubEnv("OPENCLAW_STATE_DIR", path.join(home, ".openclaw"));
    vi.stubEnv("OPENCLAW_HOME", "");
    vi.stubEnv("OPENCLAW_TEST_FAST", "1");
    vi.stubEnv("OPENBOT_EXECUTION_ROUTER_OBSERVATION", "1");
    delivered.length = 0;
    nowMs = 3_000_000;
    resetExecutionRouterObservationForTest();
    configureExecutionRouterObservationForTest({
      enabled: true,
      now: () => nowMs,
      ttlMs: 50,
      sink: (observation) => delivered.push(structuredClone(observation)),
    });
  });

  afterEach(async () => {
    resetExecutionRouterObservationForTest();
    vi.unstubAllEnvs();
    expect(process.env.HOME).toBe(ORIGINAL_ENV.HOME);
    expect(process.env.USERPROFILE).toBe(ORIGINAL_ENV.USERPROFILE);
    expect(process.env.OPENCLAW_STATE_DIR).toBe(ORIGINAL_ENV.OPENCLAW_STATE_DIR);
    expect(process.env.OPENCLAW_HOME).toBe(ORIGINAL_ENV.OPENCLAW_HOME);
    expect(process.env.OPENCLAW_TEST_FAST).toBe(ORIGINAL_ENV.OPENCLAW_TEST_FAST);
    expect(process.env.OPENBOT_EXECUTION_ROUTER_OBSERVATION).toBe(
      ORIGINAL_ENV.OPENBOT_EXECUTION_ROUTER_OBSERVATION,
    );
    expect(gitPorcelain(repoRoot)).toBe(porcelainBaseline);
    if (home) {
      await fs.rm(home, { recursive: true, force: true });
    }
  });

  it("does not invent stages from this harness", () => {
    expect(TEST_SOURCE).not.toMatch(/observeChatInboundStage\(/);
    expect(TEST_SOURCE).not.toMatch(/observeExecutionStage\(/);
    expect(TEST_SOURCE).not.toMatch(/observeAttemptSkillPreparation\(/);
    expect(TEST_SOURCE).not.toMatch(/observeAttemptToolPreparation\(/);
    expect(TEST_SOURCE).not.toMatch(/observeAttemptSystemPromptReady\(/);
    expect(TEST_SOURCE).not.toMatch(/emitChatInboundStage\(/);
  });

  it("getReplyFromConfig carries runId to a single production terminal", async () => {
    const runId = "mainchain-get-reply-1";
    const reply = await getReplyFromConfig(
      {
        Body: "ping",
        From: "+1002",
        To: "+2000",
        Provider: "whatsapp",
        CommandAuthorized: true,
      },
      { runId },
      makeCfg(home),
    );
    const terminals = delivered.filter((row) => row.envelope.runId === runId);
    expect(replyText(reply)).toBeTruthy();
    expect(terminals).toHaveLength(1);
    const observation = terminals[0];
    expect(observation?.envelope.sessionKeyHash).toMatch(/^[0-9a-f]{16}$/);
    expect(JSON.stringify(observation)).not.toMatch(/agent:[a-z0-9_-]+:/i);
    expect(observation?.stages.model_started).toEqual(expect.any(Number));
    expect(observation?.stages.run_completed).toEqual(expect.any(Number));
    expect(observation?.stages.skill_snapshot_ready).toEqual(expect.any(Number));
    expect(observation?.stages.tool_set_ready).toEqual(expect.any(Number));
    expect(observation?.stages.system_prompt_ready).toEqual(expect.any(Number));
    expect(observation?.skillBaseline).toBeTruthy();
    expect(observation?.toolBaseline).toBeTruthy();
    expect(executionRouterObservationSize()).toBe(0);
  }, 60_000);

  it("dispatchReplyFromConfig uses the public resolver and the same runId", async () => {
    const runId = "mainchain-dispatch-1";
    const dispatcher = createDispatcher();
    await dispatchReplyFromConfig({
      ctx: buildTestCtx({
        Body: "ping",
        CommandBody: "ping",
        From: "+1002",
        To: "+2000",
        Provider: "whatsapp",
        Surface: "whatsapp",
        CommandAuthorized: true,
      }),
      cfg: makeCfg(home),
      dispatcher,
      replyOptions: { runId },
    });
    const terminals = delivered.filter((row) => row.envelope.runId === runId);
    expect(terminals).toHaveLength(1);
    expect(dispatcher.sendFinalReply).toHaveBeenCalled();
    expect(executionRouterObservationSize()).toBe(0);
  }, 60_000);

  it("keeps the reply when the observation sink throws", async () => {
    configureExecutionRouterObservationForTest({
      enabled: true,
      now: () => nowMs,
      ttlMs: 50,
      sink: () => {
        throw new Error("sink-boom");
      },
    });
    const reply = await getReplyFromConfig(
      {
        Body: "ping",
        From: "+1002",
        To: "+2000",
        Provider: "whatsapp",
        CommandAuthorized: true,
      },
      { runId: "mainchain-sink-throw" },
      makeCfg(home),
    );
    expect(replyText(reply)).toBeTruthy();
    expect(executionRouterObservationSize()).toBe(0);
  }, 60_000);

  it("emits nothing when the observation flag is off", async () => {
    resetExecutionRouterObservationForTest();
    vi.stubEnv("OPENBOT_EXECUTION_ROUTER_OBSERVATION", "0");
    configureExecutionRouterObservationForTest({
      enabled: false,
      sink: (observation) => delivered.push(structuredClone(observation)),
    });
    const reply = await getReplyFromConfig(
      {
        Body: "ping",
        From: "+1002",
        To: "+2000",
        Provider: "whatsapp",
        CommandAuthorized: true,
      },
      { runId: "mainchain-flag-off" },
      makeCfg(home),
    );
    expect(replyText(reply)).toBeTruthy();
    expect(delivered).toEqual([]);
    expect(executionRouterObservationSize()).toBe(0);
  }, 60_000);

  it("sweeps an unfinished run on a later production turn", async () => {
    const failedId = "mainchain-unfinished";
    const abort = new AbortController();
    abort.abort();
    await getReplyFromConfig(
      {
        Body: "ping",
        From: "+1002",
        To: "+2000",
        Provider: "whatsapp",
        CommandAuthorized: true,
      },
      { runId: failedId, abortSignal: abort.signal },
      makeCfg(home),
    ).catch(() => undefined);
    nowMs += 100;
    await getReplyFromConfig(
      {
        Body: "ping again",
        From: "+1002",
        To: "+2000",
        Provider: "whatsapp",
        CommandAuthorized: true,
      },
      { runId: "mainchain-sweep-follow" },
      makeCfg(home),
    );
    expect(executionRouterObservationSize()).toBe(0);
  }, 60_000);

  it("leaves the full worktree porcelain unchanged", () => {
    expect(gitPorcelain(repoRoot)).toBe(porcelainBaseline);
  });
});
