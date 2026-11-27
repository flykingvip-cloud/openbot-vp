import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withTempHome as withTempHomeBase } from "../../test/helpers/temp-home.js";
import {
  ACP_CLI_STEER_PREFLIGHT_OBSERVE_ENV,
  acpCliSteerObserveNames,
  acpCliSteerObserveTaskId,
} from "../acp/cli-steer-preflight-observe.js";
import * as acpManagerModule from "../acp/control-plane/manager.js";
import { AcpRuntimeError } from "../acp/runtime/errors.js";
import * as preflightResolve from "../agents/execution-preflight/resolve.js";
import {
  resetExecutionTraceForTest,
  readExecutionTraces,
} from "../agents/execution-preflight/trace.js";
import * as embeddedModule from "../agents/pi-embedded.js";
import type { OpenBotConfig } from "../config/config.js";
import * as configModule from "../config/config.js";
import * as agentRunGovernance from "../gateway/billing/agent-run-governance.js";
import { readSessionMessages } from "../gateway/session-utils.fs.js";
import { onAgentEvent } from "../infra/agent-events.js";
import type { RuntimeEnv } from "../runtime.js";
import { agentCommand } from "./agent.js";

const loadConfigSpy = vi.spyOn(configModule, "loadConfig");
const runEmbeddedPiAgentSpy = vi.spyOn(embeddedModule, "runEmbeddedPiAgent");
const getAcpSessionManagerSpy = vi.spyOn(acpManagerModule, "getAcpSessionManager");

const runtime: RuntimeEnv = {
  log: vi.fn(),
  error: vi.fn(),
  exit: vi.fn(() => {
    throw new Error("exit");
  }),
};

async function withTempHome<T>(fn: (home: string) => Promise<T>): Promise<T> {
  return withTempHomeBase(fn, { prefix: "openclaw-agent-acp-" });
}

function createAcpEnabledConfig(home: string, storePath: string): OpenBotConfig {
  return {
    acp: {
      enabled: true,
      backend: "acpx",
      allowedAgents: ["codex", "kimi"],
      dispatch: { enabled: true },
    },
    agents: {
      defaults: {
        model: { primary: "openai/gpt-5.3-codex" },
        models: { "openai/gpt-5.3-codex": {} },
        workspace: path.join(home, "openclaw"),
      },
    },
    session: { store: storePath, mainKey: "main" },
  };
}

function mockConfig(home: string, storePath: string) {
  loadConfigSpy.mockReturnValue(createAcpEnabledConfig(home, storePath));
}

function mockConfigWithAcpOverrides(
  home: string,
  storePath: string,
  acpOverrides: Partial<NonNullable<OpenBotConfig["acp"]>>,
) {
  const cfg = createAcpEnabledConfig(home, storePath);
  cfg.acp = {
    ...cfg.acp,
    ...acpOverrides,
  };
  loadConfigSpy.mockReturnValue(cfg);
}

function writeAcpSessionStore(storePath: string, agent = "codex") {
  const sessionKey = `agent:${agent}:acp:test`;
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(
    storePath,
    JSON.stringify(
      {
        [sessionKey]: {
          sessionId: "acp-session-1",
          updatedAt: Date.now(),
          acp: {
            backend: "acpx",
            agent,
            runtimeSessionName: sessionKey,
            mode: "oneshot",
            state: "idle",
            lastActivityAt: Date.now(),
          },
        },
      },
      null,
      2,
    ),
  );
}

function resolveReadySession(
  sessionKey: string,
  agent = "codex",
): ReturnType<ReturnType<typeof acpManagerModule.getAcpSessionManager>["resolveSession"]> {
  return {
    kind: "ready",
    sessionKey,
    meta: {
      backend: "acpx",
      agent,
      runtimeSessionName: sessionKey,
      mode: "oneshot",
      state: "idle",
      lastActivityAt: Date.now(),
    },
  };
}

function mockAcpManager(params: {
  runTurn: (params: unknown) => Promise<void>;
  resolveSession?: (params: {
    cfg: OpenBotConfig;
    sessionKey: string;
  }) => ReturnType<ReturnType<typeof acpManagerModule.getAcpSessionManager>["resolveSession"]>;
}) {
  getAcpSessionManagerSpy.mockReturnValue({
    runTurn: params.runTurn,
    resolveSession:
      params.resolveSession ??
      ((input) => {
        return resolveReadySession(input.sessionKey);
      }),
  } as unknown as ReturnType<typeof acpManagerModule.getAcpSessionManager>);
}

async function withAcpSessionEnv(fn: () => Promise<void>) {
  await withTempHome(async (home) => {
    const storePath = path.join(home, "sessions.json");
    writeAcpSessionStore(storePath);
    mockConfig(home, storePath);
    await fn();
  });
}

async function withAcpSessionEnvInfo(
  fn: (env: { home: string; storePath: string }) => Promise<void>,
) {
  await withTempHome(async (home) => {
    const storePath = path.join(home, "sessions.json");
    writeAcpSessionStore(storePath);
    mockConfig(home, storePath);
    await fn({ home, storePath });
  });
}

function createRunTurnFromTextDeltas(chunks: string[]) {
  return vi.fn(async (paramsUnknown: unknown) => {
    const params = paramsUnknown as {
      onEvent?: (event: { type: string; text?: string; stopReason?: string }) => Promise<void>;
    };
    for (const text of chunks) {
      await params.onEvent?.({ type: "text_delta", text });
    }
    await params.onEvent?.({ type: "done", stopReason: "stop" });
  });
}

function subscribeAssistantEvents() {
  const assistantEvents: Array<{ text?: string; delta?: string }> = [];
  const stop = onAgentEvent((evt) => {
    if (evt.stream !== "assistant") {
      return;
    }
    assistantEvents.push({
      text: typeof evt.data?.text === "string" ? evt.data.text : undefined,
      delta: typeof evt.data?.delta === "string" ? evt.data.delta : undefined,
    });
  });
  return { assistantEvents, stop };
}

async function runAcpSessionWithPolicyOverrides(params: {
  acpOverrides: Partial<NonNullable<OpenBotConfig["acp"]>>;
  resolveSession?: Parameters<typeof mockAcpManager>[0]["resolveSession"];
}) {
  await withTempHome(async (home) => {
    const storePath = path.join(home, "sessions.json");
    writeAcpSessionStore(storePath);
    mockConfigWithAcpOverrides(home, storePath, params.acpOverrides);

    const runTurn = vi.fn(async (_params: unknown) => {});
    mockAcpManager({
      runTurn: (input: unknown) => runTurn(input),
      ...(params.resolveSession ? { resolveSession: params.resolveSession } : {}),
    });

    await expect(
      agentCommand({ message: "ping", sessionKey: "agent:codex:acp:test" }, runtime),
    ).rejects.toMatchObject({
      code: "ACP_DISPATCH_DISABLED",
    });
    expect(runTurn).not.toHaveBeenCalled();
    expect(runEmbeddedPiAgentSpy).not.toHaveBeenCalled();
  });
}

describe("agentCommand ACP runtime routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runEmbeddedPiAgentSpy.mockResolvedValue({
      payloads: [{ text: "embedded" }],
      meta: {
        durationMs: 5,
      },
    } as never);
  });

  it("routes ACP sessions through AcpSessionManager instead of embedded agent", async () => {
    await withAcpSessionEnv(async () => {
      const runTurn = createRunTurnFromTextDeltas(["ACP_", "OK"]);

      mockAcpManager({
        runTurn: (params: unknown) => runTurn(params),
      });

      await agentCommand({ message: "ping", sessionKey: "agent:codex:acp:test" }, runtime);

      expect(runTurn).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionKey: "agent:codex:acp:test",
          text: "ping",
          mode: "prompt",
        }),
      );
      expect(runEmbeddedPiAgentSpy).not.toHaveBeenCalled();
      const hasAckLog = vi
        .mocked(runtime.log)
        .mock.calls.some(([first]) => typeof first === "string" && first.includes("ACP_OK"));
      expect(hasAckLog).toBe(true);
    });
  });

  it("persists ACP child session history to the transcript store", async () => {
    await withAcpSessionEnvInfo(async ({ storePath }) => {
      const runTurn = createRunTurnFromTextDeltas(["ACP_", "OK"]);

      mockAcpManager({
        runTurn: (params: unknown) => runTurn(params),
      });

      await agentCommand({ message: "ping", sessionKey: "agent:codex:acp:test" }, runtime);

      const persistedStore = JSON.parse(fs.readFileSync(storePath, "utf-8")) as Record<
        string,
        { sessionFile?: string }
      >;
      const sessionFile = persistedStore["agent:codex:acp:test"]?.sessionFile;
      const messages = readSessionMessages("acp-session-1", storePath, sessionFile);
      expect(messages).toHaveLength(2);
      expect(messages[0]).toMatchObject({
        role: "user",
        content: "ping",
      });
      expect(messages[1]).toMatchObject({
        role: "assistant",
        content: [{ type: "text", text: "ACP_OK" }],
      });
    });
  });

  it("preserves exact ACP transcript text without trimming whitespace", async () => {
    await withAcpSessionEnvInfo(async ({ storePath }) => {
      const runTurn = createRunTurnFromTextDeltas(["  ACP_OK\n"]);

      mockAcpManager({
        runTurn: (params: unknown) => runTurn(params),
      });

      await agentCommand({ message: "  ping\n", sessionKey: "agent:codex:acp:test" }, runtime);

      const persistedStore = JSON.parse(fs.readFileSync(storePath, "utf-8")) as Record<
        string,
        { sessionFile?: string }
      >;
      const sessionFile = persistedStore["agent:codex:acp:test"]?.sessionFile;
      const messages = readSessionMessages("acp-session-1", storePath, sessionFile);
      expect(messages).toHaveLength(2);
      expect(messages[0]).toMatchObject({
        role: "user",
        content: "  ping\n",
      });
      expect(messages[1]).toMatchObject({
        role: "assistant",
        content: [{ type: "text", text: "  ACP_OK\n" }],
      });
    });
  });

  it("suppresses ACP NO_REPLY lead fragments before emitting assistant text", async () => {
    await withAcpSessionEnv(async () => {
      const { assistantEvents, stop } = subscribeAssistantEvents();
      const runTurn = createRunTurnFromTextDeltas([
        "NO",
        "NO_",
        "NO_RE",
        "NO_REPLY",
        "Actual answer",
      ]);

      mockAcpManager({
        runTurn: (params: unknown) => runTurn(params),
      });

      try {
        await agentCommand({ message: "ping", sessionKey: "agent:codex:acp:test" }, runtime);
      } finally {
        stop();
      }

      expect(assistantEvents).toEqual([{ text: "Actual answer", delta: "Actual answer" }]);

      const logLines = vi.mocked(runtime.log).mock.calls.map(([first]) => String(first));
      expect(logLines.some((line) => line.includes("NO_REPLY"))).toBe(false);
      expect(logLines.some((line) => line.includes("Actual answer"))).toBe(true);
    });
  });

  it("keeps silent-only ACP turns out of assistant output", async () => {
    await withAcpSessionEnv(async () => {
      const assistantEvents: string[] = [];
      const stop = onAgentEvent((evt) => {
        if (evt.stream !== "assistant") {
          return;
        }
        if (typeof evt.data?.text === "string") {
          assistantEvents.push(evt.data.text);
        }
      });

      const runTurn = createRunTurnFromTextDeltas(["NO", "NO_", "NO_RE", "NO_REPLY"]);

      mockAcpManager({
        runTurn: (params: unknown) => runTurn(params),
      });

      try {
        await agentCommand({ message: "ping", sessionKey: "agent:codex:acp:test" }, runtime);
      } finally {
        stop();
      }

      expect(assistantEvents).toEqual([]);

      const logLines = vi.mocked(runtime.log).mock.calls.map(([first]) => String(first));
      expect(logLines.some((line) => line.includes("NO_REPLY"))).toBe(false);
      expect(logLines.some((line) => line.includes("No reply from agent."))).toBe(true);
    });
  });

  it("preserves repeated identical ACP delta chunks", async () => {
    await withAcpSessionEnv(async () => {
      const { assistantEvents, stop } = subscribeAssistantEvents();
      const runTurn = createRunTurnFromTextDeltas(["b", "o", "o", "k"]);

      mockAcpManager({
        runTurn: (params: unknown) => runTurn(params),
      });

      try {
        await agentCommand({ message: "ping", sessionKey: "agent:codex:acp:test" }, runtime);
      } finally {
        stop();
      }

      expect(assistantEvents).toEqual([
        { text: "b", delta: "b" },
        { text: "bo", delta: "o" },
        { text: "boo", delta: "o" },
        { text: "book", delta: "k" },
      ]);

      const logLines = vi.mocked(runtime.log).mock.calls.map(([first]) => String(first));
      expect(logLines.some((line) => line.includes("book"))).toBe(true);
    });
  });

  it("re-emits buffered NO prefix when ACP text becomes visible content", async () => {
    await withAcpSessionEnv(async () => {
      const { assistantEvents, stop } = subscribeAssistantEvents();
      const runTurn = createRunTurnFromTextDeltas(["NO", "W"]);

      mockAcpManager({
        runTurn: (params: unknown) => runTurn(params),
      });

      try {
        await agentCommand({ message: "ping", sessionKey: "agent:codex:acp:test" }, runtime);
      } finally {
        stop();
      }

      expect(assistantEvents).toEqual([{ text: "NOW", delta: "NOW" }]);

      const logLines = vi.mocked(runtime.log).mock.calls.map(([first]) => String(first));
      expect(logLines.some((line) => line.includes("NOW"))).toBe(true);
    });
  });

  it("fails closed for ACP-shaped session keys missing ACP metadata", async () => {
    await withTempHome(async (home) => {
      const storePath = path.join(home, "sessions.json");
      fs.mkdirSync(path.dirname(storePath), { recursive: true });
      fs.writeFileSync(
        storePath,
        JSON.stringify(
          {
            "agent:codex:acp:stale": {
              sessionId: "stale-1",
              updatedAt: Date.now(),
            },
          },
          null,
          2,
        ),
      );
      mockConfig(home, storePath);

      const runTurn = vi.fn(async (_params: unknown) => {});
      mockAcpManager({
        runTurn: (params: unknown) => runTurn(params),
        resolveSession: ({ sessionKey }) => {
          return {
            kind: "stale",
            sessionKey,
            error: new AcpRuntimeError(
              "ACP_SESSION_INIT_FAILED",
              `ACP metadata is missing for session ${sessionKey}.`,
            ),
          };
        },
      });

      await expect(
        agentCommand({ message: "ping", sessionKey: "agent:codex:acp:stale" }, runtime),
      ).rejects.toMatchObject({
        code: "ACP_SESSION_INIT_FAILED",
        message: expect.stringContaining("ACP metadata is missing"),
      });
      expect(runTurn).not.toHaveBeenCalled();
      expect(runEmbeddedPiAgentSpy).not.toHaveBeenCalled();
    });
  });

  it.each([
    {
      name: "blocks ACP turns when ACP is disabled by policy",
      acpOverrides: { enabled: false } satisfies Partial<NonNullable<OpenBotConfig["acp"]>>,
    },
    {
      name: "blocks ACP turns when ACP dispatch is disabled by policy",
      acpOverrides: {
        dispatch: { enabled: false },
      } satisfies Partial<NonNullable<OpenBotConfig["acp"]>>,
    },
  ])("$name", async ({ acpOverrides }) => {
    await runAcpSessionWithPolicyOverrides({ acpOverrides });
  });

  it("blocks ACP turns when ACP agent is disallowed by policy", async () => {
    await withTempHome(async (home) => {
      const storePath = path.join(home, "sessions.json");
      writeAcpSessionStore(storePath);
      mockConfigWithAcpOverrides(home, storePath, {
        allowedAgents: ["claude"],
      });

      const runTurn = vi.fn(async (_params: unknown) => {});
      mockAcpManager({
        runTurn: (params: unknown) => runTurn(params),
        resolveSession: ({ sessionKey }) => resolveReadySession(sessionKey, "codex"),
      });

      await expect(
        agentCommand({ message: "ping", sessionKey: "agent:codex:acp:test" }, runtime),
      ).rejects.toMatchObject({
        code: "ACP_SESSION_INIT_FAILED",
        message: expect.stringContaining("not allowed by policy"),
      });
      expect(runTurn).not.toHaveBeenCalled();
      expect(runEmbeddedPiAgentSpy).not.toHaveBeenCalled();
    });
  });

  it("allows ACP turns for kimi when policy allowlists kimi", async () => {
    await withTempHome(async (home) => {
      const storePath = path.join(home, "sessions.json");
      writeAcpSessionStore(storePath, "kimi");
      mockConfigWithAcpOverrides(home, storePath, {
        allowedAgents: ["kimi"],
      });

      const runTurn = vi.fn(async (_params: unknown) => {});
      mockAcpManager({
        runTurn: (params: unknown) => runTurn(params),
        resolveSession: ({ sessionKey }) => resolveReadySession(sessionKey, "kimi"),
      });

      await agentCommand({ message: "ping", sessionKey: "agent:kimi:acp:test" }, runtime);

      expect(runTurn).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionKey: "agent:kimi:acp:test",
          text: "ping",
        }),
      );
      expect(runEmbeddedPiAgentSpy).not.toHaveBeenCalled();
    });
  });
});

describe("agentCommand ACP CLI turn preflight observe", () => {
  const sessionKey = "agent:codex:acp:test";

  afterEach(() => {
    delete process.env[ACP_CLI_STEER_PREFLIGHT_OBSERVE_ENV];
    resetExecutionTraceForTest();
  });

  it("does not call preflight when the flag is off and keeps the CLI payload", async () => {
    await withAcpSessionEnv(async () => {
      const runTurn = createRunTurnFromTextDeltas(["ACP_", "OK"]);
      mockAcpManager({
        runTurn: (params: unknown) => runTurn(params),
      });
      const spy = vi.spyOn(preflightResolve, "buildExecutionPreflight");
      try {
        const result = await agentCommand({ message: "ping", sessionKey }, runtime);
        expect(spy).not.toHaveBeenCalled();
        expect(runTurn).toHaveBeenCalledWith(
          expect.objectContaining({ sessionKey, text: "ping", mode: "prompt" }),
        );
        expect(result?.payloads?.[0]?.text).toBe("ACP_OK");
        expect(
          readExecutionTraces(acpCliSteerObserveTaskId("cli-turn", sessionKey, "codex")),
        ).toEqual([]);
      } finally {
        spy.mockRestore();
      }
    });
  });

  it("records a distinct CLI task id when observe is on without changing the payload", async () => {
    process.env[ACP_CLI_STEER_PREFLIGHT_OBSERVE_ENV] = "1";
    await withAcpSessionEnv(async () => {
      const runTurn = createRunTurnFromTextDeltas(["ACP_", "OK"]);
      mockAcpManager({
        runTurn: (params: unknown) => runTurn(params),
      });
      const spy = vi.spyOn(preflightResolve, "buildExecutionPreflight");
      try {
        const result = await agentCommand({ message: "ping", sessionKey }, runtime);
        const taskId = acpCliSteerObserveTaskId("cli-turn", sessionKey, "codex");
        const names = acpCliSteerObserveNames(
          { acp: { allowedAgents: ["codex", "kimi"] } } as OpenBotConfig,
          "codex",
        );
        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy).toHaveBeenCalledWith(
          expect.objectContaining({
            taskId,
            sessionId: sessionKey,
            message: "codex",
            skills: [],
            policyToolNames: names,
            catalogToolNames: names,
          }),
        );
        expect(taskId.startsWith("acp-cli-turn:")).toBe(true);
        expect(taskId).not.toContain("acp-steer:");
        expect(runTurn).toHaveBeenCalledWith(
          expect.objectContaining({ sessionKey, text: "ping", mode: "prompt" }),
        );
        expect(result?.payloads?.[0]?.text).toBe("ACP_OK");
        expect(readExecutionTraces(taskId).some((row) => row.decisionStage === "preflight")).toBe(
          true,
        );
      } finally {
        spy.mockRestore();
      }
    });
  });

  it("discards a denying allow set and still returns the CLI payload", async () => {
    process.env[ACP_CLI_STEER_PREFLIGHT_OBSERVE_ENV] = "yes";
    await withAcpSessionEnv(async () => {
      const runTurn = createRunTurnFromTextDeltas(["ACP_", "OK"]);
      mockAcpManager({
        runTurn: (params: unknown) => runTurn(params),
      });
      const realBuild = preflightResolve.buildExecutionPreflight;
      const spy = vi
        .spyOn(preflightResolve, "buildExecutionPreflight")
        .mockImplementation((input) => {
          const result = realBuild(input);
          return {
            ...result,
            allowedTools: ["read"],
            blockedTools: ["exec", "write"],
          };
        });
      try {
        const result = await agentCommand({ message: "ping", sessionKey }, runtime);
        expect(spy).toHaveBeenCalledTimes(1);
        expect(runTurn).toHaveBeenCalledTimes(1);
        const turn = runTurn.mock.calls[0]?.[0] as { text?: string };
        expect(turn.text).toBe("ping");
        expect(JSON.stringify(turn)).not.toContain("exec");
        expect(JSON.stringify(turn)).not.toContain('"read"');
        expect(result?.payloads?.[0]?.text).toBe("ACP_OK");
      } finally {
        spy.mockRestore();
      }
    });
  });

  it("keeps the CLI payload when observe throws", async () => {
    process.env[ACP_CLI_STEER_PREFLIGHT_OBSERVE_ENV] = "on";
    await withAcpSessionEnv(async () => {
      const runTurn = createRunTurnFromTextDeltas(["ACP_", "OK"]);
      mockAcpManager({
        runTurn: (params: unknown) => runTurn(params),
      });
      const spy = vi.spyOn(preflightResolve, "buildExecutionPreflight").mockImplementation(() => {
        throw new Error("observe boom");
      });
      try {
        const result = await agentCommand({ message: "ping", sessionKey }, runtime);
        expect(spy).toHaveBeenCalledTimes(1);
        expect(runTurn).toHaveBeenCalledWith(
          expect.objectContaining({ text: "ping", mode: "prompt" }),
        );
        expect(result?.payloads?.[0]?.text).toBe("ACP_OK");
      } finally {
        spy.mockRestore();
      }
    });
  });

  it("does not enforce preflight on the CLI ACP turn", () => {
    const entry = fs.readFileSync(new URL("./agent.ts", import.meta.url), "utf8");
    expect(entry).toContain("await runCommandAcpTurn(");
    const source = fs.readFileSync(
      new URL("../agent-runtime/execution/runner/acp-turn.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain('kind: "cli-turn"');
    expect(source).toContain("observeAcpCliSteerPreflight");
    expect(source).not.toContain("applyPreflightToTools");
    expect(source).not.toContain("armCompletionHold");
    expect(source).not.toContain("allowedTools");
    expect(source).not.toContain("ORCHESTRATION_LIVE_INVOKE");
  });

  it("does not call preflight when policy already blocks the CLI turn", async () => {
    process.env[ACP_CLI_STEER_PREFLIGHT_OBSERVE_ENV] = "true";
    const spy = vi.spyOn(preflightResolve, "buildExecutionPreflight");
    try {
      await runAcpSessionWithPolicyOverrides({
        acpOverrides: { enabled: false },
      });
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});

describe("ACP controlled execution lifecycle enforcement", () => {
  it("blocks ACP turn before AcpSessionManager.runTurn when commercial preparation denies", async () => {
    await withTempHome(async (home) => {
      const storePath = path.join(home, "sessions.json");
      mockConfig(home, storePath);
      const sessionKey = "agent:codex:acp:test";
      writeAcpSessionStore(storePath);
      const runTurn = vi.fn(async () => {});
      getAcpSessionManagerSpy.mockReturnValue({
        resolveSession: () => resolveReadySession(sessionKey),
        runTurn,
      } as unknown as ReturnType<typeof acpManagerModule.getAcpSessionManager>);

      const acquireSpy = vi
        .spyOn(agentRunGovernance, "tryAcquireEnterpriseAgentRun")
        .mockResolvedValue({
          acquired: false,
          skipped: false,
          reason: "NO_SUBSCRIPTION",
          message: "commercial quota denied",
        });
      const releaseSpy = vi
        .spyOn(agentRunGovernance, "releaseEnterpriseAgentRun")
        .mockResolvedValue(undefined);
      try {
        await expect(agentCommand({ message: "ping", sessionKey }, runtime)).rejects.toThrow(
          /commercial quota denied/,
        );
        expect(runTurn).not.toHaveBeenCalled();
        expect(releaseSpy).not.toHaveBeenCalled();
      } finally {
        acquireSpy.mockRestore();
        releaseSpy.mockRestore();
      }
    });
  });

  it("blocks ACP turn before AcpSessionManager.runTurn when abortSignal is aborted and still disposes lease once", async () => {
    await withTempHome(async (home) => {
      const storePath = path.join(home, "sessions.json");
      mockConfig(home, storePath);
      const sessionKey = "agent:codex:acp:test";
      writeAcpSessionStore(storePath);
      const runTurn = vi.fn(async () => {});
      getAcpSessionManagerSpy.mockReturnValue({
        resolveSession: () => resolveReadySession(sessionKey),
        runTurn,
      } as unknown as ReturnType<typeof acpManagerModule.getAcpSessionManager>);

      const controller = new AbortController();
      const acquireSpy = vi
        .spyOn(agentRunGovernance, "tryAcquireEnterpriseAgentRun")
        .mockImplementation(async () => {
          controller.abort();
          return { acquired: true, skipped: false, enterpriseId: "tenant-acp" };
        });
      const releaseSpy = vi
        .spyOn(agentRunGovernance, "releaseEnterpriseAgentRun")
        .mockResolvedValue(undefined);
      try {
        await expect(
          agentCommand({ message: "ping", sessionKey, abortSignal: controller.signal }, runtime),
        ).rejects.toThrow();
        expect(runTurn).not.toHaveBeenCalled();
        expect(releaseSpy).toHaveBeenCalledOnce();
      } finally {
        acquireSpy.mockRestore();
        releaseSpy.mockRestore();
      }
    });
  });
});
