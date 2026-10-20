import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isEmbeddedPiRunActive } from "../../agents/pi-embedded.js";
import { onAgentEvent, resetAgentRunContextForTest } from "../../infra/agent-events.js";
import type { GetReplyOptions } from "../types.js";
import { runPreparedReply } from "./get-reply-run.js";
import { buildKnowledgeUniversePromptContext } from "./knowledge-universe-context.js";

vi.mock("../../agents/auth-profiles/session-override.js", () => ({
  resolveSessionAuthProfileOverride: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../agents/pi-embedded.js", () => ({
  abortEmbeddedPiRun: vi.fn().mockReturnValue(false),
  isEmbeddedPiRunActive: vi.fn().mockReturnValue(false),
  isEmbeddedPiRunStreaming: vi.fn().mockReturnValue(false),
  resolveEmbeddedSessionLane: vi.fn().mockReturnValue("session:session-key"),
}));

vi.mock("../../config/sessions.js", () => ({
  resolveGroupSessionKey: vi.fn().mockReturnValue(undefined),
  resolveSessionFilePath: vi.fn().mockReturnValue("/tmp/session.jsonl"),
  resolveSessionFilePathOptions: vi.fn().mockReturnValue({}),
  updateSessionStore: vi.fn(),
}));

vi.mock("../../gateway/agent-growth/working-style-store.js", () => ({
  resolveWorkingStyleInstructions: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../gateway/knowledge/agent-run-gateway-client.js", () => ({
  resolveKnowledgeGatewayClientForAgentRun: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../gateway/knowledge/kb-index.js", () => ({
  openKnowledgeIndex: vi.fn(),
  resolveKnowledgeIndexDbPath: vi.fn().mockReturnValue("/tmp/knowledge.db"),
}));

vi.mock("../../gateway/knowledge/knowledge-lineage-store.js", () => ({
  upsertKnowledgeLineage: vi.fn(),
}));

vi.mock("../../globals.js", () => ({
  logVerbose: vi.fn(),
}));

vi.mock("../../organization/runtime.js", () => ({
  resolveRuntimeOrganizationContext: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../process/command-queue.js", () => ({
  clearCommandLane: vi.fn().mockReturnValue(0),
  getQueueSize: vi.fn().mockReturnValue(0),
}));

// Partial mock: keep DEFAULT_ACCOUNT_ID for src/web/auth-store.ts import-time reads.
vi.mock("../../routing/session-key.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../routing/session-key.js")>()),
  normalizeAgentId: vi.fn((value: string) => value),
  normalizeMainKey: vi.fn().mockReturnValue("main"),
}));

vi.mock("../../utils/provider-utils.js", () => ({
  isReasoningTagProvider: vi.fn().mockReturnValue(false),
}));

vi.mock("../command-detection.js", () => ({
  hasControlCommand: vi.fn().mockReturnValue(false),
}));

vi.mock("./agent-runner.js", () => ({
  runReplyAgent: vi.fn().mockResolvedValue({ text: "ok" }),
}));

vi.mock("./body.js", () => ({
  applySessionHints: vi.fn().mockImplementation(async ({ baseBody }) => baseBody),
}));

vi.mock("./collaboration-capability-context.js", () => ({
  buildCollaborationCapabilitySystemPrompt: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./groups.js", () => ({
  buildGroupIntro: vi.fn().mockReturnValue(""),
  buildGroupChatContext: vi.fn().mockReturnValue(""),
}));

vi.mock("./inbound-meta.js", () => ({
  buildInboundMetaSystemPrompt: vi.fn().mockReturnValue(""),
  buildInboundUserContextPrefix: vi.fn().mockReturnValue(""),
  buildCurrentSpeakerUntrustedPrompt: vi.fn().mockReturnValue(undefined),
}));

vi.mock("./knowledge-universe-context.js", () => ({
  buildKnowledgeUniversePromptContext: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./operational-identity-context.js", () => ({
  buildOperationalIdentitySystemPrompt: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./queue.js", () => ({
  resolveQueueSettings: vi.fn().mockReturnValue({ mode: "followup" }),
}));

vi.mock("./route-reply.js", () => ({
  routeReply: vi.fn(),
}));

vi.mock("./runtime-context-assembly.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./runtime-context-assembly.js")>();
  return {
    ...actual,
    assembleCollaborationRuntimeContextParts: vi.fn().mockResolvedValue([]),
    resolveCollaborationRunWorkspaceDir: vi.fn(
      ({ agentWorkspaceDir }: { agentWorkspaceDir: string }) => agentWorkspaceDir,
    ),
    // Keep real resolveCollaborationGroupIdForRun (do not stub to undefined).
  };
});

vi.mock("./context-budget-assembler.js", () => ({
  buildActiveContextSystemPrompt: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./session-continuity.js", () => ({
  buildSessionContinuityPrompt: vi.fn().mockResolvedValue(undefined),
  resolveContinuityMemoryRoot: vi.fn().mockReturnValue("/tmp/memory"),
}));

vi.mock("./session-updates.js", () => ({
  ensureSkillSnapshot: vi.fn().mockImplementation(async ({ sessionEntry, systemSent }) => ({
    sessionEntry,
    systemSent,
    skillsSnapshot: undefined,
  })),
  drainFormattedSystemEvents: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./learning-recall-context.js", () => ({
  buildLearningRecallSystemPrompt: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./runtime-skill-policy.js", () => ({
  resolveRuntimeSkillPolicy: vi.fn().mockResolvedValue({ block: [] }),
}));

vi.mock("./typing-mode.js", () => ({
  resolveTypingMode: vi.fn().mockReturnValue("off"),
}));

const EMPLOYEE_SESSION_KEY = "agent:main:employee:c7f8e59e-4705-4fe0-a763-5fa62d66e6f2";
const SPACE_SESSION_KEY = "agent:main:space:group-1";
const GREETING = "晚上好";

function baseParams(
  overrides: Partial<Parameters<typeof runPreparedReply>[0]> = {},
): Parameters<typeof runPreparedReply>[0] {
  return {
    ctx: {
      Body: GREETING,
      RawBody: GREETING,
      CommandBody: GREETING,
      ChatType: "direct",
      OriginatingChannel: "webchat",
    },
    sessionCtx: {
      Body: GREETING,
      BodyStripped: GREETING,
      SenderId: "user@example.com",
      ChatType: "direct",
      OriginatingChannel: "webchat",
    },
    cfg: { session: {}, channels: {}, agents: { defaults: {} } },
    agentId: "main",
    agentDir: "/tmp/agent",
    agentCfg: {},
    sessionCfg: {},
    commandAuthorized: true,
    command: {
      isAuthorizedSender: true,
      abortKey: "session-key",
      ownerList: [],
      senderIsOwner: false,
    } as never,
    commandSource: "",
    allowTextCommands: true,
    directives: {
      hasThinkDirective: false,
      thinkLevel: undefined,
    } as never,
    defaultActivation: "always",
    resolvedThinkLevel: "high",
    resolvedVerboseLevel: "off",
    resolvedReasoningLevel: "off",
    resolvedElevatedLevel: "off",
    elevatedEnabled: false,
    elevatedAllowed: false,
    blockStreamingEnabled: false,
    resolvedBlockStreamingBreak: "message_end",
    modelState: {
      resolveDefaultThinkingLevel: async () => "medium",
    } as never,
    provider: "anthropic",
    model: "claude-opus-4-1",
    typing: {
      onReplyStart: vi.fn().mockResolvedValue(undefined),
      cleanup: vi.fn(),
    } as never,
    defaultProvider: "anthropic",
    defaultModel: "claude-opus-4-1",
    timeoutMs: 30_000,
    isNewSession: true,
    resetTriggered: false,
    systemSent: true,
    sessionKey: EMPLOYEE_SESSION_KEY,
    workspaceDir: "/tmp/workspace",
    abortedLastRun: false,
    opts: { runId: "run-shadow-1" },
    ...overrides,
  };
}

describe("runPreparedReply inbound depth shadow", () => {
  let previousShadow: string | undefined;
  const tempDirs: string[] = [];

  let previousRouter: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    resetAgentRunContextForTest();
    previousShadow = process.env.OPENBOT_CHAT_INBOUND_DEPTH_SHADOW;
    previousRouter = process.env.OPENBOT_CHAT_INBOUND_DEPTH_ROUTER;
    delete process.env.OPENBOT_CHAT_INBOUND_DEPTH_SHADOW;
    delete process.env.OPENBOT_CHAT_INBOUND_DEPTH_ROUTER;
  });

  afterEach(() => {
    resetAgentRunContextForTest();
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    if (previousShadow === undefined) {
      delete process.env.OPENBOT_CHAT_INBOUND_DEPTH_SHADOW;
    } else {
      process.env.OPENBOT_CHAT_INBOUND_DEPTH_SHADOW = previousShadow;
    }
    if (previousRouter === undefined) {
      delete process.env.OPENBOT_CHAT_INBOUND_DEPTH_ROUTER;
    } else {
      process.env.OPENBOT_CHAT_INBOUND_DEPTH_ROUTER = previousRouter;
    }
  });

  it("does not emit depth_decided when the shadow flag is off", async () => {
    const events: Array<Record<string, unknown>> = [];
    const stop = onAgentEvent((evt) => {
      events.push(evt.data);
    });
    const opts: GetReplyOptions = { runId: "run-shadow-off" };
    await runPreparedReply(baseParams({ opts }));
    stop();
    expect(events.filter((evt) => evt.event === "chat.depth_decided")).toEqual([]);
    // Classify still runs for CSC/knowledge gating; events stay quiet without flags.
    expect(opts.inboundDepthDecision?.depth).toBe("chat");
    expect(vi.mocked(buildKnowledgeUniversePromptContext)).not.toHaveBeenCalled();
  });

  it("records wouldDepth and skips optional knowledge for chat (CSC minimal)", async () => {
    process.env.OPENBOT_CHAT_INBOUND_DEPTH_SHADOW = "1";
    const events: Array<Record<string, unknown>> = [];
    const stop = onAgentEvent((evt) => {
      events.push(evt.data);
    });
    const opts: GetReplyOptions = { runId: "run-shadow-on" };
    await runPreparedReply(baseParams({ opts }));
    stop();

    const decided = events.filter((evt) => evt.event === "chat.depth_decided");
    expect(decided).toHaveLength(1);
    expect(decided[0]?.wouldDepth).toBe("chat");
    expect(decided[0]?.routeStrength).toBe("unknown");
    expect(decided[0]?.classifierVersion).toBe("inbound-depth-v1");
    expect(decided[0]?.mode).toBe("shadow");
    expect(decided[0]?.reasons).toEqual(["default_chat"]);
    expect(JSON.stringify(decided[0])).not.toContain(GREETING);
    expect(opts.inboundDepthDecision?.depth).toBe("chat");
    // Chat → CSC minimal: optional knowledge is not a fixed cost anymore.
    expect(vi.mocked(buildKnowledgeUniversePromptContext)).not.toHaveBeenCalled();
  });

  it("does not classify space sessions even when shadow is on", async () => {
    process.env.OPENBOT_CHAT_INBOUND_DEPTH_SHADOW = "1";
    const events: Array<Record<string, unknown>> = [];
    const stop = onAgentEvent((evt) => {
      events.push(evt.data);
    });
    const opts: GetReplyOptions = { runId: "run-shadow-space" };
    await runPreparedReply(baseParams({ sessionKey: SPACE_SESSION_KEY, opts }));
    stop();
    expect(events.filter((evt) => evt.event === "chat.depth_decided")).toEqual([]);
    expect(opts).not.toHaveProperty("inboundDepthDecision");
    expect(vi.mocked(buildKnowledgeUniversePromptContext)).toHaveBeenCalledTimes(1);
  });

  it("inherits previous act from persisted transcript after a process restart", async () => {
    process.env.OPENBOT_CHAT_INBOUND_DEPTH_SHADOW = "1";
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "inbound-depth-shadow-"));
    tempDirs.push(dir);
    const sessionFile = path.join(dir, "session.jsonl");
    fs.writeFileSync(
      sessionFile,
      [
        JSON.stringify({
          type: "message",
          id: "user-1",
          message: { role: "user", content: "把结论写入工作区 notes.md" },
        }),
        JSON.stringify({
          type: "message",
          id: "asst-1",
          message: {
            role: "assistant",
            content: [{ type: "toolCall", id: "call_write_1", name: "write" }],
          },
        }),
        JSON.stringify({
          type: "message",
          id: "user-2",
          message: { role: "user", content: "继续" },
        }),
      ].join("\n"),
    );

    vi.mocked(isEmbeddedPiRunActive).mockReturnValue(true);
    const events: Array<Record<string, unknown>> = [];
    const stop = onAgentEvent((evt) => {
      events.push(evt.data);
    });
    const opts: GetReplyOptions = { runId: "run-shadow-continue" };
    await runPreparedReply(
      baseParams({
        ctx: {
          Body: "继续",
          RawBody: "继续",
          CommandBody: "继续",
          ChatType: "direct",
          OriginatingChannel: "webchat",
        },
        sessionCtx: {
          Body: "继续",
          BodyStripped: "继续",
          SenderId: "user@example.com",
          ChatType: "direct",
          OriginatingChannel: "webchat",
        },
        sessionEntry: {
          sessionId: "sess-shadow-1",
          updatedAt: Date.now(),
          sessionFile,
        },
        opts,
      }),
    );
    stop();

    const decided = events.filter((evt) => evt.event === "chat.depth_decided");
    expect(decided).toHaveLength(1);
    expect(decided[0]?.wouldDepth).toBe("act");
    expect(decided[0]?.reasons).toEqual(["continuation_unfinished_tool"]);
    expect(JSON.stringify(decided[0])).not.toContain("继续");
    expect(opts.inboundDepthDecision?.depth).toBe("act");
    expect(vi.mocked(buildKnowledgeUniversePromptContext)).toHaveBeenCalled();
  });

  it("does not treat an active agent run without unfinished tools as continuation", async () => {
    process.env.OPENBOT_CHAT_INBOUND_DEPTH_SHADOW = "1";
    vi.mocked(isEmbeddedPiRunActive).mockReturnValue(true);
    const events: Array<Record<string, unknown>> = [];
    const stop = onAgentEvent((evt) => {
      events.push(evt.data);
    });
    const opts: GetReplyOptions = { runId: "run-shadow-continue-no-tool" };
    await runPreparedReply(
      baseParams({
        ctx: {
          Body: "继续",
          RawBody: "继续",
          CommandBody: "继续",
          ChatType: "direct",
          OriginatingChannel: "webchat",
        },
        sessionCtx: {
          Body: "继续",
          BodyStripped: "继续",
          SenderId: "user@example.com",
          ChatType: "direct",
          OriginatingChannel: "webchat",
        },
        opts,
      }),
    );
    stop();

    const decided = events.filter((evt) => evt.event === "chat.depth_decided");
    expect(decided).toHaveLength(1);
    expect(decided[0]?.wouldDepth).toBe("chat");
    expect(decided[0]?.reasons).toEqual(["default_chat"]);
  });
});
