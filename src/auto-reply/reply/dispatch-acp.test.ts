import { readdirSync, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONSTITUTIONAL_SHADOW_ENV } from "../../../packages/constitutional-contracts/src/index.js";
import { AcpRuntimeError } from "../../acp/runtime/errors.js";
import type { AcpSessionStoreEntry } from "../../acp/runtime/session-meta.js";
import * as preflightFacade from "../../agents/execution-preflight/constitutional-runtime-facade.js";
import * as preflightResolve from "../../agents/execution-preflight/resolve.js";
import {
  readExecutionTraces,
  resetExecutionTraceForTest,
} from "../../agents/execution-preflight/trace.js";
import type { OpenBotConfig } from "../../config/config.js";
import type { SessionBindingRecord } from "../../infra/outbound/session-binding-service.js";
import type { ReplyDispatcher } from "./reply-dispatcher.js";
import { buildTestCtx } from "./test-ctx.js";
import { createAcpSessionMeta, createAcpTestConfig } from "./test-fixtures/acp-runtime.js";

const managerMocks = vi.hoisted(() => ({
  resolveSession: vi.fn(),
  runTurn: vi.fn(),
  getObservabilitySnapshot: vi.fn(() => ({
    turns: { queueDepth: 0 },
    runtimeCache: { activeSessions: 0 },
  })),
}));

const policyMocks = vi.hoisted(() => ({
  resolveAcpDispatchPolicyError: vi.fn<(cfg: OpenBotConfig) => AcpRuntimeError | null>(() => null),
  resolveAcpAgentPolicyError: vi.fn<(cfg: OpenBotConfig, agent: string) => AcpRuntimeError | null>(
    () => null,
  ),
}));

const routeMocks = vi.hoisted(() => ({
  routeReply: vi.fn(async (_params: unknown) => ({ ok: true, messageId: "mock" })),
}));

const messageActionMocks = vi.hoisted(() => ({
  runMessageAction: vi.fn(async (_params: unknown) => ({ ok: true as const })),
}));

const ttsMocks = vi.hoisted(() => ({
  maybeApplyTtsToPayload: vi.fn(async (paramsUnknown: unknown) => {
    const params = paramsUnknown as { payload: unknown };
    return params.payload;
  }),
  resolveTtsConfig: vi.fn((_cfg: OpenBotConfig) => ({ mode: "final" })),
}));

const sessionMetaMocks = vi.hoisted(() => ({
  readAcpSessionEntry: vi.fn<
    (params: { sessionKey: string; cfg?: OpenBotConfig }) => AcpSessionStoreEntry | null
  >(() => null),
}));

const bindingServiceMocks = vi.hoisted(() => ({
  listBySession: vi.fn<(sessionKey: string) => SessionBindingRecord[]>(() => []),
}));

vi.mock("../../acp/control-plane/manager.js", () => ({
  getAcpSessionManager: () => managerMocks,
}));

vi.mock("../../acp/policy.js", () => ({
  resolveAcpDispatchPolicyError: (cfg: OpenBotConfig) =>
    policyMocks.resolveAcpDispatchPolicyError(cfg),
  resolveAcpAgentPolicyError: (cfg: OpenBotConfig, agent: string) =>
    policyMocks.resolveAcpAgentPolicyError(cfg, agent),
}));

vi.mock("./route-reply.js", () => ({
  routeReply: (params: unknown) => routeMocks.routeReply(params),
}));

vi.mock("../../infra/outbound/message-action-runner.js", () => ({
  runMessageAction: (params: unknown) => messageActionMocks.runMessageAction(params),
}));

vi.mock("../../tts/tts.js", () => ({
  maybeApplyTtsToPayload: (params: unknown) => ttsMocks.maybeApplyTtsToPayload(params),
  resolveTtsConfig: (cfg: OpenBotConfig) => ttsMocks.resolveTtsConfig(cfg),
}));

vi.mock("../../acp/runtime/session-meta.js", () => ({
  readAcpSessionEntry: (params: { sessionKey: string; cfg?: OpenBotConfig }) =>
    sessionMetaMocks.readAcpSessionEntry(params),
}));

vi.mock("../../infra/outbound/session-binding-service.js", () => ({
  getSessionBindingService: () => ({
    listBySession: (sessionKey: string) => bindingServiceMocks.listBySession(sessionKey),
  }),
}));

const {
  tryDispatchAcpReply,
  ACP_TURN_PREFLIGHT_OBSERVE_ENV,
  acpInProcessTurnObserveNames,
  acpInProcessTurnObserveTaskId,
  isAcpTurnPreflightObserveEnabled,
} = await import("./dispatch-acp.js");
const sessionKey = "agent:codex-acp:session-1";

function createDispatcher(): {
  dispatcher: ReplyDispatcher;
  counts: Record<"tool" | "block" | "final", number>;
} {
  const counts = { tool: 0, block: 0, final: 0 };
  const dispatcher: ReplyDispatcher = {
    sendToolResult: vi.fn(() => true),
    sendBlockReply: vi.fn(() => true),
    sendFinalReply: vi.fn(() => true),
    waitForIdle: vi.fn(async () => {}),
    getQueuedCounts: vi.fn(() => counts),
    markComplete: vi.fn(),
  };
  return { dispatcher, counts };
}

function setReadyAcpResolution() {
  managerMocks.resolveSession.mockReturnValue({
    kind: "ready",
    sessionKey,
    meta: createAcpSessionMeta(),
  });
}

function createAcpConfigWithVisibleToolTags(): OpenBotConfig {
  return createAcpTestConfig({
    acp: {
      enabled: true,
      stream: {
        tagVisibility: {
          tool_call: true,
          tool_call_update: true,
        },
      },
    },
  });
}

async function runDispatch(params: {
  bodyForAgent: string;
  cfg?: OpenBotConfig;
  dispatcher?: ReplyDispatcher;
  shouldRouteToOriginating?: boolean;
  onReplyStart?: () => void;
  ctxOverrides?: Record<string, unknown>;
}) {
  return tryDispatchAcpReply({
    ctx: buildTestCtx({
      Provider: "discord",
      Surface: "discord",
      SessionKey: sessionKey,
      BodyForAgent: params.bodyForAgent,
      ...params.ctxOverrides,
    }),
    cfg: params.cfg ?? createAcpTestConfig(),
    dispatcher: params.dispatcher ?? createDispatcher().dispatcher,
    sessionKey,
    inboundAudio: false,
    shouldRouteToOriginating: params.shouldRouteToOriginating ?? false,
    ...(params.shouldRouteToOriginating
      ? { originatingChannel: "telegram", originatingTo: "telegram:thread-1" }
      : {}),
    shouldSendToolSummaries: true,
    bypassForCommand: false,
    ...(params.onReplyStart ? { onReplyStart: params.onReplyStart } : {}),
    recordProcessed: vi.fn(),
    markIdle: vi.fn(),
  });
}

async function emitToolLifecycleEvents(
  onEvent: (event: unknown) => Promise<void>,
  toolCallId: string,
) {
  await onEvent({
    type: "tool_call",
    tag: "tool_call",
    toolCallId,
    status: "in_progress",
    title: "Run command",
    text: "Run command (in_progress)",
  });
  await onEvent({
    type: "tool_call",
    tag: "tool_call_update",
    toolCallId,
    status: "completed",
    title: "Run command",
    text: "Run command (completed)",
  });
  await onEvent({ type: "done" });
}

function mockToolLifecycleTurn(toolCallId: string) {
  managerMocks.runTurn.mockImplementation(
    async ({ onEvent }: { onEvent: (event: unknown) => Promise<void> }) => {
      await emitToolLifecycleEvents(onEvent, toolCallId);
    },
  );
}

function mockVisibleTextTurn(text = "visible") {
  managerMocks.runTurn.mockImplementationOnce(
    async ({ onEvent }: { onEvent: (event: unknown) => Promise<void> }) => {
      await onEvent({ type: "text_delta", text, tag: "agent_message_chunk" });
      await onEvent({ type: "done" });
    },
  );
}

async function dispatchVisibleTurn(onReplyStart: () => void) {
  await runDispatch({
    bodyForAgent: "visible",
    dispatcher: createDispatcher().dispatcher,
    onReplyStart,
  });
}

describe("tryDispatchAcpReply", () => {
  beforeEach(() => {
    delete process.env[ACP_TURN_PREFLIGHT_OBSERVE_ENV];
    managerMocks.resolveSession.mockReset();
    managerMocks.runTurn.mockReset();
    managerMocks.getObservabilitySnapshot.mockReset();
    managerMocks.getObservabilitySnapshot.mockReturnValue({
      turns: { queueDepth: 0 },
      runtimeCache: { activeSessions: 0 },
    });
    policyMocks.resolveAcpDispatchPolicyError.mockReset();
    policyMocks.resolveAcpDispatchPolicyError.mockReturnValue(null);
    policyMocks.resolveAcpAgentPolicyError.mockReset();
    policyMocks.resolveAcpAgentPolicyError.mockReturnValue(null);
    routeMocks.routeReply.mockReset();
    routeMocks.routeReply.mockResolvedValue({ ok: true, messageId: "mock" });
    messageActionMocks.runMessageAction.mockReset();
    messageActionMocks.runMessageAction.mockResolvedValue({ ok: true as const });
    ttsMocks.maybeApplyTtsToPayload.mockClear();
    ttsMocks.resolveTtsConfig.mockReset();
    ttsMocks.resolveTtsConfig.mockReturnValue({ mode: "final" });
    sessionMetaMocks.readAcpSessionEntry.mockReset();
    sessionMetaMocks.readAcpSessionEntry.mockReturnValue(null);
    bindingServiceMocks.listBySession.mockReset();
    bindingServiceMocks.listBySession.mockReturnValue([]);
  });

  it("buffers ACP block output and delivers it as a final reply to the originating channel", async () => {
    setReadyAcpResolution();
    managerMocks.runTurn.mockImplementation(
      async ({ onEvent }: { onEvent: (event: unknown) => Promise<void> }) => {
        await onEvent({ type: "text_delta", text: "hello", tag: "agent_message_chunk" });
        await onEvent({ type: "done" });
      },
    );

    const { dispatcher } = createDispatcher();
    const result = await runDispatch({
      bodyForAgent: "reply",
      dispatcher,
      shouldRouteToOriginating: true,
    });

    expect(result?.counts.final).toBe(1);
    expect(routeMocks.routeReply).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "telegram",
        to: "telegram:thread-1",
        payload: expect.objectContaining({
          text: "hello",
        }),
      }),
    );
    expect(dispatcher.sendBlockReply).not.toHaveBeenCalled();
    expect(dispatcher.sendFinalReply).not.toHaveBeenCalled();
  });

  it("suppresses ACP tool lifecycle updates when routing to the originating channel", async () => {
    setReadyAcpResolution();
    mockToolLifecycleTurn("call-1");

    const { dispatcher } = createDispatcher();
    await runDispatch({
      bodyForAgent: "run tool",
      cfg: createAcpConfigWithVisibleToolTags(),
      dispatcher,
      shouldRouteToOriginating: true,
    });

    expect(routeMocks.routeReply).not.toHaveBeenCalled();
    expect(messageActionMocks.runMessageAction).not.toHaveBeenCalled();
    expect(dispatcher.sendToolResult).not.toHaveBeenCalled();
  });

  it("does not attempt ACP tool message edits when originating delivery is final-only", async () => {
    setReadyAcpResolution();
    mockToolLifecycleTurn("call-2");

    const { dispatcher } = createDispatcher();
    await runDispatch({
      bodyForAgent: "run tool",
      cfg: createAcpConfigWithVisibleToolTags(),
      dispatcher,
      shouldRouteToOriginating: true,
    });

    expect(messageActionMocks.runMessageAction).not.toHaveBeenCalled();
    expect(routeMocks.routeReply).not.toHaveBeenCalled();
    expect(dispatcher.sendToolResult).not.toHaveBeenCalled();
  });

  it("starts reply lifecycle when ACP turn starts, including hidden-only turns", async () => {
    setReadyAcpResolution();
    const onReplyStart = vi.fn();
    const { dispatcher } = createDispatcher();

    managerMocks.runTurn.mockImplementationOnce(
      async ({ onEvent }: { onEvent: (event: unknown) => Promise<void> }) => {
        await onEvent({
          type: "status",
          tag: "usage_update",
          text: "usage updated: 1/100",
          used: 1,
          size: 100,
        });
        await onEvent({ type: "done" });
      },
    );
    await runDispatch({
      bodyForAgent: "hidden",
      dispatcher,
      onReplyStart,
    });
    expect(onReplyStart).toHaveBeenCalledTimes(1);

    mockVisibleTextTurn();
    await dispatchVisibleTurn(onReplyStart);
    expect(onReplyStart).toHaveBeenCalledTimes(2);
  });

  it("starts reply lifecycle once per turn when output is delivered", async () => {
    setReadyAcpResolution();
    const onReplyStart = vi.fn();

    mockVisibleTextTurn();
    await dispatchVisibleTurn(onReplyStart);

    expect(onReplyStart).toHaveBeenCalledTimes(1);
  });

  it("does not start reply lifecycle for empty ACP prompt", async () => {
    setReadyAcpResolution();
    const onReplyStart = vi.fn();
    const { dispatcher } = createDispatcher();

    await runDispatch({
      bodyForAgent: "   ",
      dispatcher,
      onReplyStart,
    });

    expect(managerMocks.runTurn).not.toHaveBeenCalled();
    expect(onReplyStart).not.toHaveBeenCalled();
  });

  it("forwards normalized image attachments into ACP turns", async () => {
    setReadyAcpResolution();
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "dispatch-acp-"));
    const imagePath = path.join(tempDir, "inbound.png");
    try {
      await fs.writeFile(imagePath, "image-bytes");
      managerMocks.runTurn.mockResolvedValue(undefined);

      await runDispatch({
        bodyForAgent: "   ",
        ctxOverrides: {
          MediaPath: imagePath,
          MediaType: "image/png",
        },
      });

      expect(managerMocks.runTurn).toHaveBeenCalledWith(
        expect.objectContaining({
          text: "",
          attachments: [
            {
              mediaType: "image/png",
              data: Buffer.from("image-bytes").toString("base64"),
            },
          ],
        }),
      );
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("forwards a manifest for non-image attachments when there is no text prompt", async () => {
    setReadyAcpResolution();
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "dispatch-acp-"));
    const docPath = path.join(tempDir, "inbound.pdf");
    try {
      await fs.writeFile(docPath, "pdf-bytes");

      await runDispatch({
        bodyForAgent: "   ",
        ctxOverrides: {
          MediaPath: docPath,
          MediaType: "application/pdf",
        },
      });

      expect(managerMocks.runTurn).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('<attachment name="inbound.pdf"'),
        }),
      );
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("surfaces ACP policy errors as final error replies", async () => {
    setReadyAcpResolution();
    policyMocks.resolveAcpDispatchPolicyError.mockReturnValue(
      new AcpRuntimeError("ACP_DISPATCH_DISABLED", "ACP dispatch is disabled by policy."),
    );
    const { dispatcher } = createDispatcher();

    await runDispatch({
      bodyForAgent: "test",
      dispatcher,
    });

    expect(managerMocks.runTurn).not.toHaveBeenCalled();
    expect(dispatcher.sendFinalReply).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("ACP_DISPATCH_DISABLED"),
      }),
    );
  });
});

describe("ACP in-process turn preflight observe", () => {
  beforeEach(() => {
    delete process.env[ACP_TURN_PREFLIGHT_OBSERVE_ENV];
    resetExecutionTraceForTest();
    managerMocks.resolveSession.mockReset();
    managerMocks.runTurn.mockReset();
    managerMocks.getObservabilitySnapshot.mockReset();
    managerMocks.getObservabilitySnapshot.mockReturnValue({
      turns: { queueDepth: 0 },
      runtimeCache: { activeSessions: 0 },
    });
    policyMocks.resolveAcpDispatchPolicyError.mockReset();
    policyMocks.resolveAcpDispatchPolicyError.mockReturnValue(null);
    policyMocks.resolveAcpAgentPolicyError.mockReset();
    policyMocks.resolveAcpAgentPolicyError.mockReturnValue(null);
    routeMocks.routeReply.mockReset();
    routeMocks.routeReply.mockResolvedValue({ ok: true, messageId: "mock" });
    messageActionMocks.runMessageAction.mockReset();
    messageActionMocks.runMessageAction.mockResolvedValue({ ok: true as const });
    ttsMocks.maybeApplyTtsToPayload.mockClear();
    ttsMocks.resolveTtsConfig.mockReset();
    ttsMocks.resolveTtsConfig.mockReturnValue({ mode: "final" });
    sessionMetaMocks.readAcpSessionEntry.mockReset();
    sessionMetaMocks.readAcpSessionEntry.mockReturnValue(null);
    bindingServiceMocks.listBySession.mockReset();
    bindingServiceMocks.listBySession.mockReturnValue([]);
  });

  afterEach(() => {
    delete process.env[ACP_TURN_PREFLIGHT_OBSERVE_ENV];
    resetExecutionTraceForTest();
  });

  it("keeps the turn unchanged when preflight observe is off", async () => {
    expect(isAcpTurnPreflightObserveEnabled({})).toBe(false);
    for (const value of ["0", "false", "no", "off", ""]) {
      expect(
        isAcpTurnPreflightObserveEnabled({
          [ACP_TURN_PREFLIGHT_OBSERVE_ENV]: value,
        }),
      ).toBe(false);
    }
    setReadyAcpResolution();
    mockVisibleTextTurn("visible");
    const spy = vi.spyOn(preflightResolve, "buildExecutionPreflight");
    try {
      const recordProcessed = vi.fn();
      const result = await tryDispatchAcpReply({
        ctx: buildTestCtx({
          Provider: "discord",
          Surface: "discord",
          SessionKey: sessionKey,
          BodyForAgent: "reply",
        }),
        cfg: createAcpTestConfig(),
        dispatcher: createDispatcher().dispatcher,
        sessionKey,
        inboundAudio: false,
        shouldRouteToOriginating: false,
        shouldSendToolSummaries: true,
        bypassForCommand: false,
        recordProcessed,
        markIdle: vi.fn(),
      });
      expect(result?.queuedFinal).toBe(false);
      expect(managerMocks.runTurn).toHaveBeenCalledTimes(1);
      expect(managerMocks.runTurn).toHaveBeenCalledWith(
        expect.objectContaining({ sessionKey, text: "reply", mode: "prompt" }),
      );
      expect(recordProcessed).toHaveBeenCalledWith("completed", { reason: "acp_dispatch" });
      expect(spy).not.toHaveBeenCalled();
      expect(readExecutionTraces(acpInProcessTurnObserveTaskId(sessionKey, "codex"))).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });

  it("records a preflight trace when observe is on without changing the turn", async () => {
    for (const value of ["1", "true", "yes", "on"]) {
      expect(
        isAcpTurnPreflightObserveEnabled({
          [ACP_TURN_PREFLIGHT_OBSERVE_ENV]: value,
        }),
      ).toBe(true);
    }
    process.env[ACP_TURN_PREFLIGHT_OBSERVE_ENV] = "1";
    setReadyAcpResolution();
    mockVisibleTextTurn("visible");
    const cfg = createAcpTestConfig();
    const spy = vi.spyOn(preflightResolve, "buildExecutionPreflight");
    try {
      const recordProcessed = vi.fn();
      await tryDispatchAcpReply({
        ctx: buildTestCtx({
          Provider: "discord",
          Surface: "discord",
          SessionKey: sessionKey,
          BodyForAgent: "reply",
        }),
        cfg,
        dispatcher: createDispatcher().dispatcher,
        sessionKey,
        inboundAudio: false,
        shouldRouteToOriginating: false,
        shouldSendToolSummaries: true,
        bypassForCommand: false,
        recordProcessed,
        markIdle: vi.fn(),
      });
      const taskId = acpInProcessTurnObserveTaskId(sessionKey, "codex");
      const names = acpInProcessTurnObserveNames(cfg, "codex");
      expect(names).toEqual(["codex"]);
      expect(managerMocks.runTurn).toHaveBeenCalledWith(
        expect.objectContaining({ sessionKey, text: "reply", mode: "prompt" }),
      );
      expect(recordProcessed).toHaveBeenCalledWith("completed", { reason: "acp_dispatch" });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith({
        taskId,
        sessionId: sessionKey,
        message: "codex",
        skills: [],
        policyToolNames: names,
        catalogToolNames: names,
      });
      const traces = readExecutionTraces(taskId);
      expect(traces.some((row) => row.decisionStage === "preflight")).toBe(true);
      expect(traces.every((row) => row.decisionStage === "preflight")).toBe(true);
      expect(traces[0]?.decisionCode).toBe("no_skill_contract");
    } finally {
      spy.mockRestore();
    }
  });

  it("discards the preflight allow set and still runs the original turn", async () => {
    process.env[ACP_TURN_PREFLIGHT_OBSERVE_ENV] = "1";
    setReadyAcpResolution();
    mockVisibleTextTurn("visible");
    const cfg = createAcpTestConfig({
      acp: {
        enabled: true,
        allowedAgents: ["Codex", "Other-Agent"],
      },
    });
    const realBuild = preflightResolve.buildExecutionPreflight;
    let observedAllow: string[] = [];
    const spy = vi
      .spyOn(preflightResolve, "buildExecutionPreflight")
      .mockImplementation((input) => {
        const result = realBuild(input);
        observedAllow = [...result.allowedTools];
        return {
          ...result,
          allowedTools: ["read"],
          blockedTools: ["exec", "write"],
        };
      });
    try {
      await tryDispatchAcpReply({
        ctx: buildTestCtx({
          Provider: "discord",
          Surface: "discord",
          SessionKey: sessionKey,
          BodyForAgent: "keep-this-prompt",
        }),
        cfg,
        dispatcher: createDispatcher().dispatcher,
        sessionKey,
        inboundAudio: false,
        shouldRouteToOriginating: false,
        shouldSendToolSummaries: true,
        bypassForCommand: false,
        recordProcessed: vi.fn(),
        markIdle: vi.fn(),
      });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(observedAllow).toEqual(["codex", "other-agent"]);
      expect(cfg.acp?.allowedAgents).toEqual(["Codex", "Other-Agent"]);
      expect(managerMocks.runTurn).toHaveBeenCalledTimes(1);
      const turn = managerMocks.runTurn.mock.calls[0]?.[0] as { text?: string };
      expect(turn.text).toBe("keep-this-prompt");
      expect(JSON.stringify(turn)).not.toContain("exec");
      expect(JSON.stringify(turn)).not.toContain('"read"');
    } finally {
      spy.mockRestore();
    }
  });

  it("does not record a preflight trace when policy, allowlist, or an empty prompt already stops the turn", async () => {
    process.env[ACP_TURN_PREFLIGHT_OBSERVE_ENV] = "1";
    const spy = vi.spyOn(preflightResolve, "buildExecutionPreflight");
    try {
      setReadyAcpResolution();
      policyMocks.resolveAcpDispatchPolicyError.mockReturnValue(
        new AcpRuntimeError("ACP_DISPATCH_DISABLED", "ACP dispatch is disabled by policy."),
      );
      await runDispatch({ bodyForAgent: "blocked-by-policy" });
      expect(managerMocks.runTurn).not.toHaveBeenCalled();

      policyMocks.resolveAcpDispatchPolicyError.mockReturnValue(null);
      policyMocks.resolveAcpAgentPolicyError.mockReturnValue(
        new AcpRuntimeError("ACP_SESSION_INIT_FAILED", "ACP agent is not allowed by policy."),
      );
      await runDispatch({ bodyForAgent: "blocked-by-allowlist" });
      expect(managerMocks.runTurn).not.toHaveBeenCalled();

      policyMocks.resolveAcpAgentPolicyError.mockReturnValue(null);
      await runDispatch({ bodyForAgent: "   " });
      expect(managerMocks.runTurn).not.toHaveBeenCalled();

      managerMocks.resolveSession.mockReturnValue({ kind: "none" });
      const skipped = await runDispatch({ bodyForAgent: "not-an-acp-session" });
      expect(skipped).toBeNull();

      const bypassed = await tryDispatchAcpReply({
        ctx: buildTestCtx({
          Provider: "discord",
          Surface: "discord",
          SessionKey: sessionKey,
          BodyForAgent: "bypass",
        }),
        cfg: createAcpTestConfig(),
        dispatcher: createDispatcher().dispatcher,
        sessionKey,
        inboundAudio: false,
        shouldRouteToOriginating: false,
        shouldSendToolSummaries: true,
        bypassForCommand: true,
        recordProcessed: vi.fn(),
        markIdle: vi.fn(),
      });
      expect(bypassed).toBeNull();

      expect(spy).not.toHaveBeenCalled();
      expect(readExecutionTraces(acpInProcessTurnObserveTaskId(sessionKey, "codex"))).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });

  it("keeps an ACP turn error when observe is on", async () => {
    process.env[ACP_TURN_PREFLIGHT_OBSERVE_ENV] = "1";
    setReadyAcpResolution();
    managerMocks.runTurn.mockRejectedValue(new Error("turn boom"));
    const spy = vi.spyOn(preflightResolve, "buildExecutionPreflight");
    try {
      const { dispatcher } = createDispatcher();
      const recordProcessed = vi.fn();
      await tryDispatchAcpReply({
        ctx: buildTestCtx({
          Provider: "discord",
          Surface: "discord",
          SessionKey: sessionKey,
          BodyForAgent: "reply",
        }),
        cfg: createAcpTestConfig(),
        dispatcher,
        sessionKey,
        inboundAudio: false,
        shouldRouteToOriginating: false,
        shouldSendToolSummaries: true,
        bypassForCommand: false,
        recordProcessed,
        markIdle: vi.fn(),
      });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(managerMocks.runTurn).toHaveBeenCalledTimes(1);
      expect(recordProcessed).toHaveBeenCalledWith("completed", {
        reason: "acp_error:acp_turn_failed",
      });
      expect(dispatcher.sendFinalReply).toHaveBeenCalledWith(
        expect.objectContaining({
          isError: true,
          text: expect.stringContaining("ACP_TURN_FAILED"),
        }),
      );
    } finally {
      spy.mockRestore();
    }
  });

  it("swallows observe failures without flipping a successful turn", async () => {
    process.env[ACP_TURN_PREFLIGHT_OBSERVE_ENV] = "1";
    setReadyAcpResolution();
    mockVisibleTextTurn("visible");
    const spy = vi.spyOn(preflightResolve, "buildExecutionPreflight").mockImplementation(() => {
      throw new Error("observe boom");
    });
    try {
      const recordProcessed = vi.fn();
      await tryDispatchAcpReply({
        ctx: buildTestCtx({
          Provider: "discord",
          Surface: "discord",
          SessionKey: sessionKey,
          BodyForAgent: "reply",
        }),
        cfg: createAcpTestConfig(),
        dispatcher: createDispatcher().dispatcher,
        sessionKey,
        inboundAudio: false,
        shouldRouteToOriginating: false,
        shouldSendToolSummaries: true,
        bypassForCommand: false,
        recordProcessed,
        markIdle: vi.fn(),
      });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(managerMocks.runTurn).toHaveBeenCalledWith(expect.objectContaining({ text: "reply" }));
      expect(recordProcessed).toHaveBeenCalledWith("completed", { reason: "acp_dispatch" });
      expect(readExecutionTraces(acpInProcessTurnObserveTaskId(sessionKey, "codex"))).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });

  it("does not enforce preflight on the ACP in-process dispatch path", () => {
    const source = readFileSync(new URL("./dispatch-acp.ts", import.meta.url), "utf8");
    expect(source).toContain("buildExecutionPreflight");
    expect(source).toContain("OPENBOT_ACP_TURN_PREFLIGHT_OBSERVE");
    expect(source).not.toContain("applyPreflightToTools");
    expect(source).not.toContain("armCompletionHold");
    expect(source).not.toContain("allowedTools");
    expect(source).not.toContain("ORCHESTRATION_LIVE_INVOKE");
  });
});

describe("ACP hot-path runtime façade observe (Phase D H1)", () => {
  beforeEach(() => {
    delete process.env[ACP_TURN_PREFLIGHT_OBSERVE_ENV];
    delete process.env[CONSTITUTIONAL_SHADOW_ENV];
    resetExecutionTraceForTest();
    managerMocks.resolveSession.mockReset();
    managerMocks.runTurn.mockReset();
    managerMocks.getObservabilitySnapshot.mockReset();
    managerMocks.getObservabilitySnapshot.mockReturnValue({
      turns: { queueDepth: 0 },
      runtimeCache: { activeSessions: 0 },
    });
    policyMocks.resolveAcpDispatchPolicyError.mockReset();
    policyMocks.resolveAcpDispatchPolicyError.mockReturnValue(null);
    policyMocks.resolveAcpAgentPolicyError.mockReset();
    policyMocks.resolveAcpAgentPolicyError.mockReturnValue(null);
    routeMocks.routeReply.mockReset();
    routeMocks.routeReply.mockResolvedValue({ ok: true, messageId: "mock" });
    messageActionMocks.runMessageAction.mockReset();
    messageActionMocks.runMessageAction.mockResolvedValue({ ok: true as const });
    ttsMocks.maybeApplyTtsToPayload.mockClear();
    ttsMocks.resolveTtsConfig.mockReset();
    ttsMocks.resolveTtsConfig.mockReturnValue({ mode: "final" });
    sessionMetaMocks.readAcpSessionEntry.mockReset();
    sessionMetaMocks.readAcpSessionEntry.mockReturnValue(null);
    bindingServiceMocks.listBySession.mockReset();
    bindingServiceMocks.listBySession.mockReturnValue([]);
  });

  afterEach(() => {
    delete process.env[ACP_TURN_PREFLIGHT_OBSERVE_ENV];
    delete process.env[CONSTITUTIONAL_SHADOW_ENV];
    resetExecutionTraceForTest();
  });

  async function runVisibleTurn() {
    setReadyAcpResolution();
    mockVisibleTextTurn("visible");
    const recordProcessed = vi.fn();
    const result = await tryDispatchAcpReply({
      ctx: buildTestCtx({
        Provider: "discord",
        Surface: "discord",
        SessionKey: sessionKey,
        BodyForAgent: "reply",
      }),
      cfg: createAcpTestConfig(),
      dispatcher: createDispatcher().dispatcher,
      sessionKey,
      inboundAudio: false,
      shouldRouteToOriginating: false,
      shouldSendToolSummaries: true,
      bypassForCommand: false,
      recordProcessed,
      markIdle: vi.fn(),
    });
    return { result, recordProcessed };
  }

  it("stays inert when OPENBOT_CONSTITUTIONAL_SHADOW is unset (default-off)", async () => {
    const spy = vi.spyOn(preflightFacade, "observePreflightRuntimeFacade");
    try {
      const { result, recordProcessed } = await runVisibleTurn();
      expect(result?.queuedFinal).toBe(false);
      expect(managerMocks.runTurn).toHaveBeenCalledTimes(1);
      expect(recordProcessed).toHaveBeenCalledWith("completed", { reason: "acp_dispatch" });
      expect(spy).toHaveBeenCalledTimes(1);
      const out = spy.mock.results[0]?.value as
        | ReturnType<typeof preflightFacade.observePreflightRuntimeFacade>
        | undefined;
      expect(out).toBeDefined();
      expect(out!.invoked).toBe(false);
      expect(out!.mode).toBe("inert");
      expect(out!.report).toBeNull();
      expect(out!.blocked).toBe(false);
      expect(out!.enforce).toBe(false);
      expect(out!.liveInvoke).toBe(false);
      expect(out!.fabricDefaultOn).toBe(false);
      expect(out!.wroteReceipt).toBe(false);
      expect(out!.wroteTrace).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it("opts in to a report-only façade observe without changing the turn", async () => {
    process.env[CONSTITUTIONAL_SHADOW_ENV] = "1";
    const spy = vi.spyOn(preflightFacade, "observePreflightRuntimeFacade");
    try {
      const { result, recordProcessed } = await runVisibleTurn();
      expect(result?.queuedFinal).toBe(false);
      expect(managerMocks.runTurn).toHaveBeenCalledWith(
        expect.objectContaining({ sessionKey, text: "reply", mode: "prompt" }),
      );
      expect(recordProcessed).toHaveBeenCalledWith("completed", { reason: "acp_dispatch" });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ env: process.env }));
      const out = spy.mock.results[0]?.value as
        | ReturnType<typeof preflightFacade.observePreflightRuntimeFacade>
        | undefined;
      expect(out).toBeDefined();
      expect(out!.invoked).toBe(true);
      expect(out!.mode).toBe("shadow");
      expect(out!.report).not.toBeNull();
      expect(out!.report?.enforce).toBe(false);
      expect(out!.report?.enforced).toBe(false);
      expect(out!.selectedPath).toBeNull();
      expect(out!.blocked).toBe(false);
      expect(out!.enforce).toBe(false);
      expect(out!.liveInvoke).toBe(false);
      expect(out!.fabricDefaultOn).toBe(false);
      expect(out!.readyToTighten).toBe(false);
      expect(out!.wroteReceipt).toBe(false);
      expect(out!.wroteTrace).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it("rolls back to inert when the shadow flag is cleared", async () => {
    process.env[CONSTITUTIONAL_SHADOW_ENV] = "on";
    const spy = vi.spyOn(preflightFacade, "observePreflightRuntimeFacade");
    try {
      await runVisibleTurn();
      const first = spy.mock.results[0]?.value as { invoked: boolean } | undefined;
      expect(first).toBeDefined();
      expect(first!.invoked).toBe(true);

      delete process.env[CONSTITUTIONAL_SHADOW_ENV];
      spy.mockClear();
      managerMocks.runTurn.mockClear();
      await runVisibleTurn();
      expect(spy).toHaveBeenCalledTimes(1);
      const out = spy.mock.results[0]?.value as { invoked: boolean; mode: string } | undefined;
      expect(out).toBeDefined();
      expect(out!.invoked).toBe(false);
      expect(out!.mode).toBe("inert");
      expect(managerMocks.runTurn).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  it("keeps façade observe discard-only and confined to this ACP call site", () => {
    const source = readFileSync(new URL("./dispatch-acp.ts", import.meta.url), "utf8");
    expect(source).toContain("observePreflightRuntimeFacade");
    expect(source).toContain("OPENBOT_CONSTITUTIONAL_SHADOW");
    expect(source).toContain("phase_d_hotpath_facade_observe_one_site_start_order");
    expect(source).not.toContain("applyPreflightToTools");
    expect(source).not.toContain("armCompletionHold");
    expect(source).not.toContain("readyToTighten: true");
    expect(source).not.toContain("OPENBOT_CONSTITUTIONAL_HOTPATH_FACADE_OBSERVE");

    // Sibling production modules under auto-reply/reply must not also import the façade.
    const replyDir = fileURLToPath(new URL("./", import.meta.url));
    const siblings = readdirSync(replyDir).filter(
      (name) => name.endsWith(".ts") && !name.endsWith(".test.ts") && name !== "dispatch-acp.ts",
    );
    for (const name of siblings) {
      const body = readFileSync(path.join(replyDir, name), "utf8");
      expect(body, name).not.toContain("constitutional-runtime-facade");
      expect(body, name).not.toContain("observePreflightRuntimeFacade");
    }
  });
});
