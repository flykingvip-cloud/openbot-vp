import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CURRENT_SESSION_VERSION } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// Stub the run registry itself; eagerly importing its heavy public barrel
// before reply-turn changes cyclic module initialization in this host test.
import * as executionRuntime from "../../agent-runtime/execution/runner/run-registry.js";
import { replyTurnRuntime } from "../../agent-runtime/wiring/reply-turn.js";
import { resolveBootstrapContextForRun } from "../../agents/bootstrap-files.js";
import { STEWARD_REQUIRED_SKILLS } from "../../agents/builtin-steward/required-skills.js";
import { listRetrieveReadOnlyCoreToolIds } from "../../agents/inbound-tool-policy.js";
import { createOpenClawTools } from "../../agents/openclaw-tools.js";
import {
  embeddedToolSetContainsKnowledgeSource,
  resolveEmbeddedAttemptToolsRaw,
} from "../../agents/pi-embedded-runner/run/resolve-embedded-tools.js";
import { composeSkillPolicy } from "../../agents/skills/skill-policy.js";
import { isWorkspaceOnboardingCompleted } from "../../agents/workspace.js";
import { resolveSessionFilePath } from "../../config/sessions.js";
import { resolveGroupSessionKey } from "../../config/sessions.js";
import { loadContextScopeCatalog } from "../../gateway/context-scope/catalog.js";
import { authorizeContextScopePlan } from "../../gateway/context-scope/index.js";
import { recordContextScopeOnCollaborationRuntime } from "../../gateway/context-scope/runtime-join.js";
import { resolveKnowledgeGatewayClientForAgentRun } from "../../gateway/knowledge/agent-run-gateway-client.js";
import { onAgentEvent, resetAgentRunContextForTest } from "../../infra/agent-events.js";
import type { GetReplyOptions } from "../types.js";
import { runReplyAgent } from "./agent-runner.js";
import { buildCollaborationCapabilitySystemPrompt } from "./collaboration-capability-context.js";
import { readConversationPeerContext } from "./conversation-peer-context.js";
import { runPreparedReply } from "./get-reply-run.js";
import { buildKnowledgeUniversePromptContext } from "./knowledge-universe-context.js";
import { buildLearningRecallSystemPrompt } from "./learning-recall-context.js";
import { buildOperationalIdentitySystemPrompt } from "./operational-identity-context.js";
import { isCollaborationGroupRuntimeSession } from "./runtime-context-assembly.js";
import { resolveRuntimeSkillPolicy } from "./runtime-skill-policy.js";
import { ensureSkillSnapshot } from "./session-updates.js";
vi.mock("./conversation-peer-context.js", () => ({
  readConversationPeerContext: vi.fn().mockResolvedValue("同主人目录：客户经理（会话可用）"),
}));

vi.mock("../../agents/auth-profiles/session-override.js", () => ({
  resolveSessionAuthProfileOverride: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../agents/bootstrap-files.js", () => ({
  resolveBootstrapContextForRun: vi.fn().mockResolvedValue({
    bootstrapFiles: [],
    contextFiles: [{ path: "IDENTITY.md", content: "shared identity" }],
  }),
}));

vi.mock("../../agents/pi-embedded.js", () => ({
  abortEmbeddedPiRun: vi.fn().mockReturnValue(false),
  isEmbeddedPiRunActive: vi.fn().mockReturnValue(false),
  isEmbeddedPiRunStreaming: vi.fn().mockReturnValue(false),
  queueEmbeddedPiMessage: vi.fn().mockReturnValue(false),
  resolveEmbeddedSessionLane: vi.fn().mockReturnValue("session:session-key"),
}));

vi.mock("../../config/sessions.js", () => ({
  resolveGroupSessionKey: vi.fn().mockReturnValue(undefined),
  resolveSessionFilePath: vi.fn().mockReturnValue("/tmp/session.jsonl"),
  resolveSessionFilePathOptions: vi.fn().mockReturnValue({}),
  updateSessionStore: vi.fn(),
}));

vi.mock("../../agents/workspace.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../agents/workspace.js")>();
  return {
    ...actual,
    isWorkspaceOnboardingCompleted: vi.fn().mockResolvedValue(true),
  };
});

vi.mock("../../gateway/agent-growth/working-style-store.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../gateway/agent-growth/working-style-store.js")>()),
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
  buildCollaborationCapabilitySystemPrompt: vi.fn().mockResolvedValue("capability-listing"),
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
  buildOperationalIdentitySystemPrompt: vi.fn().mockResolvedValue("identity"),
}));

vi.mock("./queue.js", () => ({
  resolveQueueSettings: vi.fn().mockReturnValue({ mode: "followup" }),
}));

vi.mock("./route-reply.js", () => ({
  routeReply: vi.fn(),
}));

vi.mock("../../gateway/context-scope/catalog.js", () => ({
  loadContextScopeCatalog: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../gateway/context-scope/runtime-join.js", () => ({
  recordContextScopeOnCollaborationRuntime: vi.fn().mockResolvedValue({
    ledger: true,
    snapshot: true,
    degraded: false,
  }),
}));

vi.mock("../../gateway/context-scope/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../gateway/context-scope/index.js")>();
  return {
    ...actual,
    authorizeContextScopePlan: vi.fn(actual.authorizeContextScopePlan),
    appendContextScopeAuditRecord: vi.fn(),
  };
});

vi.mock("./runtime-context-assembly.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./runtime-context-assembly.js")>();
  return {
    ...actual,
    isCollaborationGroupRuntimeSession: vi.fn(actual.isCollaborationGroupRuntimeSession),
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
const RETRIEVE_QUERY = "查询知识库里的差旅政策";
const ACT_WRITE = "把结论写入工作区 notes.md";

type RunReplyCall = {
  followupRun: {
    run: {
      disableTools?: boolean;
      skillPolicy?: { allow?: string[]; block: string[] };
      extraSystemPrompt?: string;
      contextLane?: "chat" | "retrieve" | "act";
      inboundToolCeiling?: {
        depth: "chat" | "retrieve" | "act";
        maxToolMode: "none" | "read" | "write";
        maxSideEffectLevel: "none" | "reversible" | "irreversible_external";
      };
    };
  };
};

function lastReplyCall(): RunReplyCall | undefined {
  return vi.mocked(runReplyAgent).mock.calls.at(-1)?.[0] as RunReplyCall | undefined;
}

function constructedToolsFromLastRun() {
  const run = lastReplyCall()?.followupRun.run;
  return resolveEmbeddedAttemptToolsRaw({
    disableTools: run?.disableTools,
    inboundToolCeiling: run?.inboundToolCeiling,
    skillPolicy: run?.skillPolicy,
    createTools: () => createOpenClawTools({ gatewayClientUser: "user@example.com" }),
  });
}

function messageParams(text: string): Partial<Parameters<typeof runPreparedReply>[0]> {
  return {
    ctx: {
      Body: text,
      RawBody: text,
      CommandBody: text,
      ChatType: "direct",
      OriginatingChannel: "webchat",
    },
    sessionCtx: {
      Body: text,
      BodyStripped: text,
      SenderId: "user@example.com",
      ChatType: "direct",
      OriginatingChannel: "webchat",
    },
  };
}

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
    opts: { runId: "run-router-1" },
    ...overrides,
  };
}

describe("runPreparedReply inbound depth router", () => {
  it.each([
    "respond",
    "respond_with_task",
    "accepted",
    "duplicate",
    "rejected",
    "resumed",
    "resume_denied",
    "direct_respond",
    "corrupt_state",
    "transcript_failure",
    "amended",
    "amended_paused",
    "accepted_turn",
    "amended_active",
    "amended_replaced",
    "amended_rejected",
    "amended_steered",
    "amended_finished",
    "amended_reset",
    "amended_unreadable",
  ] as const)("Gateway interaction %s enters execution only after acceptance", async (kind) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-ingress-reply-"));
    const file = path.join(dir, "session.jsonl");
    fs.writeFileSync(
      file,
      JSON.stringify({
        type: "session",
        version: CURRENT_SESSION_VERSION,
        id: "ingress",
        cwd: dir,
        timestamp: new Date().toISOString(),
      }) + "\n",
    );
    vi.mocked(resolveSessionFilePath).mockReturnValue(file);
    const binding = {
      taskId: "accepted-task",
      executionAttempt: "original-attempt",
      deliverableVersion: "original-version",
    };
    const isResume = kind === "resumed" || kind === "resume_denied";
    const isAmendment = kind.startsWith("amended");
    const executes =
      kind === "accepted" ||
      kind === "accepted_turn" ||
      kind === "resumed" ||
      kind === "amended" ||
      kind === "amended_active" ||
      kind === "amended_steered";
    const active = vi
      .spyOn(executionRuntime, "isEmbeddedPiRunActive")
      .mockReturnValue(kind === "amended_active");
    const steer = vi.spyOn(replyTurnRuntime, "steer").mockReturnValue(kind === "amended_steered");
    const abort = vi.spyOn(executionRuntime, "abortEmbeddedPiRun").mockReturnValue(true);
    const wait = vi.spyOn(executionRuntime, "waitForEmbeddedPiRunEnd").mockResolvedValue(true);
    const mutate = vi
      .spyOn(replyTurnRuntime.state, "applyInteractionProposal")
      .mockReturnValue(
        kind === "amended_rejected"
          ? { kind: "rejected", reason: "revision_mismatch" }
          : { kind: "applied", text: "要求已写入原任务板。", abort: false },
      );
    const interaction = vi.spyOn(replyTurnRuntime, "interaction").mockResolvedValue(
      kind === "respond" ||
        kind === "respond_with_task" ||
        kind === "direct_respond" ||
        kind === "corrupt_state" ||
        kind === "transcript_failure"
        ? { kind: "respond", text: "你好", clarification: false }
        : isAmendment
          ? {
              kind: "task_proposal",
              decision: {
                kind: "task_change",
                target: { taskId: binding.taskId, revision: "0" },
                text: "将补贴改为1000元并重写文件",
                mode: "revise",
              },
            }
          : isResume
            ? {
                kind: "task_proposal",
                decision: {
                  kind: "task_control",
                  target: { taskId: binding.taskId, revision: "0" },
                  action: "resume",
                },
              }
            : {
                kind: "execution_admission",
                result:
                  kind === "accepted_turn"
                    ? {
                        kind,
                        admission: {
                          requestId: "ingress-message",
                          sessionFile: file,
                          goal: "Send once",
                          acceptance: ["Report receipt"],
                          focusRevision: 0,
                          writeEpoch: 0,
                        },
                      }
                    : kind === "accepted"
                      ? { kind, binding, acceptance: ["来源"] }
                      : kind === "duplicate"
                        ? { kind, binding }
                        : { kind: "rejected", reason: "revision_mismatch" },
              },
    );
    const read = vi.spyOn(replyTurnRuntime.state, "read").mockReturnValue({
      focusRevision: 0,
      parked: [],
      resetGeneration: kind === "amended_reset" ? 1 : 0,
      current:
        kind === "accepted" || isResume || isAmendment || kind === "respond_with_task"
          ? {
              ...binding,
              taskId: kind === "amended_replaced" ? "replacement-task" : binding.taskId,
              wakeSuppress: kind === "amended_paused",
              acceptanceCriteria: ["来源"],
              title: "报告",
              goalText: "生成报告",
              unfinished: kind !== "amended_finished",
              admittedGeneration: 0,
              effectiveConstraints: isAmendment
                ? [{ text: "将补贴改为1000元并重写文件", kind: "revise", atMs: 2 }]
                : [],
              createdAtMs: 1,
              stop: { summary: "已接纳", workspacePaths: [] },
            }
          : undefined,
    });
    const strictRead = vi
      .spyOn(replyTurnRuntime.state, "readForInteraction")
      .mockImplementation(() => {
        if (
          kind === "corrupt_state" ||
          (kind === "amended_unreadable" && strictRead.mock.calls.length > 1)
        ) {
          throw new SyntaxError("corrupt private task");
        }
        return read.mock.results.at(-1)?.value ?? { focusRevision: 0, parked: [] };
      });
    const persist = vi.spyOn(replyTurnRuntime, "persistInteractionMessage");
    if (kind === "transcript_failure") {
      persist.mockImplementation(() => {
        throw Object.assign(new Error("private path"), { code: "ENOSPC" });
      });
    }
    try {
      vi.mocked(runReplyAgent).mockClear();
      const result = await runPreparedReply(
        baseParams({
          ctx: {
            ...baseParams().ctx,
            ...(kind === "direct_respond"
              ? { InputProvenance: { kind: "external_user" as const } }
              : {}),
            ComposerMentions: [
              {
                mention_id: "plugin-mention",
                displayName: "Origin",
                offset: 0,
                length: 7,
                target: { kind: "plugin", pluginId: "plugin:ext:origin" },
              },
            ],
          },
          sessionId: "ingress",
          sessionEntry: { sessionId: "ingress", sessionFile: file, updatedAt: 1 },
          opts: {
            runId: "ingress-message",
            ...(kind === "direct_respond"
              ? {}
              : {
                  interactionIngress: {
                    userMessageId: "ingress-message",
                    persistOwnTranscript: true,
                  },
                }),
            onInteractionTaskResume: async () =>
              kind === "resumed"
                ? { kind: "accepted", binding, acceptance: ["来源"] }
                : { kind: "rejected", reason: "resume_not_authorized" },
          },
        }),
      );
      expect(interaction).toHaveBeenCalledOnce();
      expect(resolveBootstrapContextForRun).toHaveBeenCalled();
      expect(interaction.mock.calls[0]?.[0].input.context).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ role: "user", content: "同主人目录：客户经理（会话可用）" }),
          expect.objectContaining({
            role: "system",
            content: expect.stringContaining("shared identity"),
          }),
        ]),
      );
      expect(readConversationPeerContext).toHaveBeenCalled();
      expect(runReplyAgent).toHaveBeenCalledTimes(executes ? 1 : 0);
      if (kind === "amended_active") {
        expect(abort).toHaveBeenCalledWith("ingress");
        expect(wait).toHaveBeenCalledWith("ingress");
      }
      if (kind === "corrupt_state" || kind === "transcript_failure") {
        expect(interaction.mock.calls[0]?.[0].input.availability).toMatchObject({
          mode: "restricted",
        });
        expect(result).toMatchObject({
          text: expect.stringContaining("继续对话"),
          channelData: { runtimeInteraction: { mode: "restricted" } },
        });
      }
      if (executes) {
        const run = vi.mocked(runReplyAgent).mock.calls[0]?.[0].followupRun.run;
        expect(run).toMatchObject({
          ...(kind === "accepted_turn" ? {} : { taskCompletionBinding: binding }),
          executionAdmitted: true,
          skipUserTranscriptPersist: true,
        });
        if (kind === "accepted_turn") {
          expect(run?.turnExecutionAdmission?.goal).toBe("Send once");
          expect(run?.taskCompletionBinding).toBeUndefined();
          expect(run?.extraSystemPrompt).toContain("Current-turn work only");
          expect(abort).not.toHaveBeenCalled();
          expect(mutate).not.toHaveBeenCalled();
        }
        expect(run?.extraSystemPrompt).toContain("Acceptance criteria:");
        if (kind === "amended") {
          expect(run?.taskCompletionBinding?.constraints).toEqual(["将补贴改为1000元并重写文件"]);
          expect(run?.extraSystemPrompt).toContain("将补贴改为1000元并重写文件");
          expect(mutate).toHaveBeenCalledOnce();
        }
        expect(run?.mentionedPluginToolAllowlist).toEqual(["origin"]);
        expect(run?.extraSystemPrompt).toContain("pluginId=origin");
        expect(run?.extraSystemPrompt).not.toContain("host-executed");
      }
      if (kind === "respond" || kind === "direct_respond") {
        expect(result).toEqual({ text: "你好" });
      }
      if (!executes && kind !== "transcript_failure") {
        const entries = fs
          .readFileSync(file, "utf8")
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line) as unknown);
        expect(entries).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ message: expect.objectContaining({ role: "assistant" }) }),
          ]),
        );
      }
    } finally {
      steer.mockRestore();
      mutate.mockRestore();
      abort.mockRestore();
      wait.mockRestore();
      active.mockRestore();
      interaction.mockRestore();
      read.mockRestore();
      strictRead.mockRestore();
      persist.mockRestore();
      vi.mocked(resolveSessionFilePath).mockReturnValue("/tmp/session.jsonl");
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
  let previousShadow: string | undefined;
  let previousRouter: string | undefined;
  let previousKnowledgePolicy: string | undefined;
  let previousToolPolicy: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isCollaborationGroupRuntimeSession).mockReturnValue(false);
    vi.mocked(isWorkspaceOnboardingCompleted).mockResolvedValue(true);
    resetAgentRunContextForTest();
    previousShadow = process.env.OPENBOT_CHAT_INBOUND_DEPTH_SHADOW;
    previousRouter = process.env.OPENBOT_CHAT_INBOUND_DEPTH_ROUTER;
    previousKnowledgePolicy = process.env.OPENBOT_CHAT_INBOUND_KNOWLEDGE_POLICY;
    previousToolPolicy = process.env.OPENBOT_CHAT_INBOUND_TOOL_POLICY;
    delete process.env.OPENBOT_CHAT_INBOUND_DEPTH_SHADOW;
    delete process.env.OPENBOT_CHAT_INBOUND_DEPTH_ROUTER;
    delete process.env.OPENBOT_CHAT_INBOUND_KNOWLEDGE_POLICY;
    delete process.env.OPENBOT_CHAT_INBOUND_TOOL_POLICY;
  });

  afterEach(() => {
    resetAgentRunContextForTest();
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
    if (previousKnowledgePolicy === undefined) {
      delete process.env.OPENBOT_CHAT_INBOUND_KNOWLEDGE_POLICY;
    } else {
      process.env.OPENBOT_CHAT_INBOUND_KNOWLEDGE_POLICY = previousKnowledgePolicy;
    }
    if (previousToolPolicy === undefined) {
      delete process.env.OPENBOT_CHAT_INBOUND_TOOL_POLICY;
    } else {
      process.env.OPENBOT_CHAT_INBOUND_TOOL_POLICY = previousToolPolicy;
    }
  });

  it("restricts chat actions without emptying shared identity or skill context", async () => {
    const events: Array<Record<string, unknown>> = [];
    const stop = onAgentEvent((evt) => {
      events.push(evt.data);
    });
    const opts: GetReplyOptions = { runId: "run-router-off" };
    await runPreparedReply(baseParams({ opts }));
    stop();
    // depth_decided still flag-gated; chat-lane cuts apply from steward classify-only.
    expect(events.filter((evt) => evt.event === "chat.depth_decided")).toEqual([]);
    expect(opts.inboundDepthDecision?.depth).toBe("chat");
    expect(vi.mocked(buildKnowledgeUniversePromptContext)).not.toHaveBeenCalled();
    expect(vi.mocked(resolveKnowledgeGatewayClientForAgentRun)).not.toHaveBeenCalled();
    expect(vi.mocked(buildCollaborationCapabilitySystemPrompt)).not.toHaveBeenCalled();
    expect(vi.mocked(buildOperationalIdentitySystemPrompt)).toHaveBeenCalledWith(
      expect.objectContaining({ listingMode: "lightweight" }),
    );
    expect(vi.mocked(ensureSkillSnapshot).mock.calls[0]?.[0]).toMatchObject({
      skillFilter: undefined,
    });
    expect(opts.bootstrapContextMode).toBeUndefined();
    expect(lastReplyCall()?.followupRun.run.disableTools).toBe(true);
    expect(lastReplyCall()?.followupRun.run.contextLane).toBe("chat");
    const tools = constructedToolsFromLastRun();
    expect(tools).toHaveLength(0);
    expect(embeddedToolSetContainsKnowledgeSource(tools)).toBe(false);
    const skippedKnowledge = events.filter((evt) => evt.event === "chat.knowledge_degraded");
    expect(skippedKnowledge).toHaveLength(1);
    expect(skippedKnowledge[0]?.knowledgeSkippedReason).toBe("depth_chat");
    const toolEvents = events.filter((evt) => evt.event === "chat.tool_policy_applied");
    expect(toolEvents).toHaveLength(1);
    expect(toolEvents[0]?.toolSkippedReason).toBe("depth_chat");
  });

  it("selected knowledge supplies context without granting execution tools", async () => {
    vi.mocked(loadContextScopeCatalog).mockResolvedValue([
      { type: "file", id: "article-1", label: "article" },
    ]);
    const events: Array<Record<string, unknown>> = [];
    const stop = onAgentEvent((evt) => {
      events.push(evt.data);
    });
    const opts: GetReplyOptions = {
      runId: "run-chat-selected-kb",
      contextScopeRequest: {
        mode: "focused",
        sources: [{ type: "file", id: "article-1" }],
      },
    };
    await runPreparedReply(
      baseParams({
        ...messageParams("请分析这篇文章的要点"),
        opts,
      }),
    );
    stop();
    expect(opts.inboundDepthDecision?.depth).toBe("chat");
    expect(opts.contextScopePlan?.mode).toBe("focused");
    expect(vi.mocked(buildKnowledgeUniversePromptContext)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(resolveKnowledgeGatewayClientForAgentRun)).toHaveBeenCalledTimes(1);
    expect(lastReplyCall()?.followupRun.run.disableTools).toBe(true);
    const tools = constructedToolsFromLastRun();
    expect(tools).toHaveLength(0);
    expect(embeddedToolSetContainsKnowledgeSource(tools)).toBe(false);
    // Identity stays concise while the skill filter remains available to context selection.
    expect(vi.mocked(buildOperationalIdentitySystemPrompt)).toHaveBeenCalledWith(
      expect.objectContaining({ listingMode: "lightweight" }),
    );
    expect(vi.mocked(ensureSkillSnapshot).mock.calls[0]?.[0]).toMatchObject({
      skillFilter: undefined,
    });
    expect(events.filter((evt) => evt.event === "chat.knowledge_degraded")).toEqual([]);
  });

  it("chat without selected sources still skips optional knowledge", async () => {
    const opts: GetReplyOptions = {
      runId: "run-chat-no-sources",
      contextScopeRequest: { mode: "minimal" },
    };
    await runPreparedReply(baseParams({ opts }));
    expect(opts.inboundDepthDecision?.depth).toBe("chat");
    expect(opts.contextScopePlan?.mode).toBe("minimal");
    expect(vi.mocked(buildKnowledgeUniversePromptContext)).not.toHaveBeenCalled();
    expect(lastReplyCall()?.followupRun.run.disableTools).toBe(true);
  });

  it("selected folder sources also survive chat-lane knowledge skip", async () => {
    vi.mocked(loadContextScopeCatalog).mockResolvedValue([
      { type: "folder", id: "/kb/policies", label: "policies" },
    ]);
    const opts: GetReplyOptions = {
      runId: "run-chat-selected-folder",
      contextScopeRequest: {
        mode: "focused",
        sources: [{ type: "folder", id: "/kb/policies" }],
      },
    };
    await runPreparedReply(
      baseParams({
        ...messageParams("请根据勾选的文件夹总结"),
        opts,
      }),
    );
    expect(opts.inboundDepthDecision?.depth).toBe("chat");
    expect(vi.mocked(buildKnowledgeUniversePromptContext)).toHaveBeenCalledTimes(1);
    expect(lastReplyCall()?.followupRun.run.disableTools).toBe(true);
  });

  it("keeps full bootstrap on chat-lane while workspace onboarding is incomplete", async () => {
    vi.mocked(isWorkspaceOnboardingCompleted).mockResolvedValue(false);
    const opts: GetReplyOptions = { runId: "run-router-off-onboarding" };
    await runPreparedReply(baseParams({ opts }));
    expect(opts.inboundDepthDecision?.depth).toBe("chat");
    expect(opts.bootstrapContextMode).toBeUndefined();
    expect(lastReplyCall()?.followupRun.run.disableTools).toBe(true);
  });

  it("retains selected skill guidance and memory in interaction without enabling tools", async () => {
    vi.mocked(buildLearningRecallSystemPrompt).mockResolvedValueOnce("RELEVANT_MEMORY");
    const opts: GetReplyOptions = { runId: "run-shared-supply", skillFilter: ["writing-guidance"] };
    await runPreparedReply(baseParams({ opts }));
    expect(vi.mocked(ensureSkillSnapshot).mock.calls[0]?.[0]).toMatchObject({
      skillFilter: ["writing-guidance"],
    });
    expect(lastReplyCall()?.followupRun.run.extraSystemPrompt).toContain("RELEVANT_MEMORY");
    expect(lastReplyCall()?.followupRun.run.extraSystemPrompt).toContain("identity");
    expect(lastReplyCall()?.followupRun.run.disableTools).toBe(true);
    expect(opts.bootstrapContextMode).toBeUndefined();
  });

  it("does not force steward-required skills into retrieve skillFilter", async () => {
    const opts: GetReplyOptions = {
      runId: "run-retrieve-no-force",
      skillFilter: ["weather"],
    };
    await runPreparedReply(baseParams({ ...messageParams(RETRIEVE_QUERY), opts }));
    expect(opts.inboundDepthDecision?.depth).toBe("retrieve");
    expect(vi.mocked(ensureSkillSnapshot).mock.calls[0]?.[0]).toMatchObject({
      skillFilter: ["weather"],
    });
    const filter = vi.mocked(ensureSkillSnapshot).mock.calls[0]?.[0]?.skillFilter as string[];
    for (const name of STEWARD_REQUIRED_SKILLS) {
      if ((name as string) !== "weather") {
        expect(filter).not.toContain(name);
      }
    }
  });

  it("force-merges steward-required skills into act skillFilter", async () => {
    const opts: GetReplyOptions = {
      runId: "run-act-force",
      skillFilter: ["weather"],
    };
    await runPreparedReply(baseParams({ ...messageParams(ACT_WRITE), opts }));
    expect(opts.inboundDepthDecision?.depth).toBe("act");
    const filter = vi.mocked(ensureSkillSnapshot).mock.calls[0]?.[0]?.skillFilter as string[];
    expect(filter).toEqual(expect.arrayContaining(["weather", ...STEWARD_REQUIRED_SKILLS]));
  });

  it("does not apply chat-lane cuts for steward act when the router flag is off", async () => {
    const opts: GetReplyOptions = { runId: "run-router-off-act" };
    await runPreparedReply(baseParams({ ...messageParams(ACT_WRITE), opts }));
    expect(opts.inboundDepthDecision?.depth).toBe("act");
    expect(vi.mocked(buildKnowledgeUniversePromptContext)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(resolveKnowledgeGatewayClientForAgentRun)).toHaveBeenCalledTimes(1);
    expect(lastReplyCall()?.followupRun.run.disableTools).toBeUndefined();
    const tools = constructedToolsFromLastRun();
    expect(tools.length).toBeGreaterThan(0);
    expect(embeddedToolSetContainsKnowledgeSource(tools)).toBe(true);
    expect(vi.mocked(ensureSkillSnapshot).mock.calls[0]?.[0]).not.toMatchObject({
      skillFilter: [],
    });
  });

  it("leaves non-steward sessions unchanged when depth flags are off", async () => {
    const opts: GetReplyOptions = { runId: "run-router-off-space" };
    await runPreparedReply(baseParams({ sessionKey: SPACE_SESSION_KEY, opts }));
    expect(opts).not.toHaveProperty("inboundDepthDecision");
    expect(vi.mocked(buildKnowledgeUniversePromptContext)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(resolveKnowledgeGatewayClientForAgentRun)).toHaveBeenCalledTimes(1);
    expect(lastReplyCall()?.followupRun.run.disableTools).toBeUndefined();
    const tools = constructedToolsFromLastRun();
    expect(tools.length).toBeGreaterThan(0);
  });

  it("writes group skill policy onto skillFilter, blocklist, and the embedded run allowlist", async () => {
    vi.mocked(isCollaborationGroupRuntimeSession).mockReturnValue(true);
    vi.mocked(resolveRuntimeSkillPolicy).mockResolvedValue({
      allow: ["web_search", "read"],
      block: ["exec"],
    });
    vi.mocked(buildLearningRecallSystemPrompt).mockResolvedValue(
      "## 已沉淀的经验\n- 先核对工具是否在白名单。",
    );

    // Space + round-invoked so collaboration assembly runs; act text avoids
    // steward-specific chat action restriction.
    await runPreparedReply(
      baseParams({
        ...messageParams(ACT_WRITE),
        sessionKey: SPACE_SESSION_KEY,
        sessionCtx: {
          Body: ACT_WRITE,
          BodyStripped: ACT_WRITE,
          SenderId: "user@example.com",
          ChatType: "group",
          OriginatingChannel: "webchat",
          CollaborationGroupId: "group-1",
          CollaborationRoundInvoked: true,
        },
        opts: { skillFilter: ["web_search", "exec", "read"] },
      }),
    );

    expect(vi.mocked(ensureSkillSnapshot).mock.calls[0]?.[0]).toMatchObject({
      skillFilter: ["web_search", "read"],
      skillBlocklist: ["exec"],
    });
    expect(lastReplyCall()?.followupRun.run.skillPolicy).toEqual({
      allow: ["web_search", "read"],
      block: ["exec"],
    });
    const filteredTools = constructedToolsFromLastRun().map((tool) => tool.name);
    expect(filteredTools).toContain("web_search");
    expect(filteredTools).not.toContain("exec");
    expect(lastReplyCall()?.followupRun.run.extraSystemPrompt ?? "").toContain("已沉淀的经验");
  });

  it("maps group blockedSkills=search onto the constructed tools array", () => {
    const policy = composeSkillPolicy({
      groupProfile: { blockedSkills: ["search"] },
    });
    const tools = resolveEmbeddedAttemptToolsRaw({
      skillPolicy: policy,
      createTools: () => createOpenClawTools({ gatewayClientUser: "user@example.com" }),
    });
    expect(tools.map((tool) => tool.name)).not.toContain("web_search");
  });

  it("keeps unselected knowledge optional and chat actions disabled when the router is on", async () => {
    process.env.OPENBOT_CHAT_INBOUND_DEPTH_ROUTER = "1";
    const events: Array<Record<string, unknown>> = [];
    const stop = onAgentEvent((evt) => {
      events.push(evt.data);
    });
    const opts: GetReplyOptions = { runId: "run-router-chat" };
    await runPreparedReply(baseParams({ opts }));
    stop();

    expect(opts.inboundDepthDecision?.depth).toBe("chat");
    expect(vi.mocked(buildKnowledgeUniversePromptContext)).not.toHaveBeenCalled();
    expect(vi.mocked(resolveKnowledgeGatewayClientForAgentRun)).not.toHaveBeenCalled();
    expect(vi.mocked(buildCollaborationCapabilitySystemPrompt)).not.toHaveBeenCalled();
    expect(vi.mocked(buildOperationalIdentitySystemPrompt)).toHaveBeenCalledWith(
      expect.objectContaining({ listingMode: "lightweight" }),
    );
    expect(vi.mocked(ensureSkillSnapshot).mock.calls[0]?.[0]).toMatchObject({
      skillFilter: undefined,
    });
    expect(opts.bootstrapContextMode).toBeUndefined();
    expect(lastReplyCall()?.followupRun.run.disableTools).toBe(true);
    expect(lastReplyCall()?.followupRun.run.contextLane).toBe("chat");
    const constructedTools = constructedToolsFromLastRun();
    expect(constructedTools).toHaveLength(0);
    expect(embeddedToolSetContainsKnowledgeSource(constructedTools)).toBe(false);
    expect(constructedTools.map((tool) => tool.name)).not.toContain("knowledge_source");
    expect(constructedTools.map((tool) => tool.name)).not.toContain("knowledge-source-tool");

    const decided = events.filter((evt) => evt.event === "chat.depth_decided");
    expect(decided).toHaveLength(1);
    expect(decided[0]?.mode).toBe("router");
    expect(decided[0]?.wouldDepth).toBe("chat");
    expect(typeof decided[0]?.routeMs).toBe("number");
    const skippedKnowledge = events.filter((evt) => evt.event === "chat.knowledge_degraded");
    expect(skippedKnowledge).toHaveLength(1);
    expect(skippedKnowledge[0]?.knowledgeSkippedReason).toBe("depth_chat");
    expect(skippedKnowledge[0]?.identitySnapshot).toBe("lightweight");
    expect(skippedKnowledge[0]?.identitySnapshotHit).toBe(false);
    expect(skippedKnowledge[0]?.identitySnapshotPolicy).toBe("no_cache");
    expect(skippedKnowledge[0]?.identityResolveSkippedReason).toBe("depth_chat");
    const tools = events.filter((evt) => evt.event === "chat.tool_policy_applied");
    expect(tools).toHaveLength(1);
    expect(tools[0]?.toolSkippedReason).toBe("depth_chat");
    expect(tools[0]?.toolCount).toBe(0);
    expect(JSON.stringify(events)).not.toContain(GREETING);
    expect(JSON.stringify(events)).not.toContain("knowledge_source");
  });

  it("keeps knowledge prefetch and tools for retrieve", async () => {
    process.env.OPENBOT_CHAT_INBOUND_DEPTH_ROUTER = "1";
    const events: Array<Record<string, unknown>> = [];
    const stop = onAgentEvent((evt) => {
      events.push(evt.data);
    });
    const opts: GetReplyOptions = { runId: "run-router-retrieve" };
    await runPreparedReply(baseParams({ ...messageParams(RETRIEVE_QUERY), opts }));
    stop();

    expect(opts.inboundDepthDecision?.depth).toBe("retrieve");
    expect(vi.mocked(buildKnowledgeUniversePromptContext)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(resolveKnowledgeGatewayClientForAgentRun)).toHaveBeenCalledTimes(1);
    // 1:1 steward retrieve does not inject collaboration capability prompts.
    expect(vi.mocked(buildCollaborationCapabilitySystemPrompt)).not.toHaveBeenCalled();
    expect(vi.mocked(buildOperationalIdentitySystemPrompt)).toHaveBeenCalledWith(
      expect.not.objectContaining({ listingMode: "lightweight" }),
    );
    expect(lastReplyCall()?.followupRun.run.disableTools).toBeUndefined();
    const tools = constructedToolsFromLastRun();
    expect(tools.length).toBeGreaterThan(0);
    expect(embeddedToolSetContainsKnowledgeSource(tools)).toBe(true);
    expect(events.filter((evt) => evt.event === "chat.knowledge_degraded")).toEqual([]);
    expect(events.filter((evt) => evt.event === "chat.tool_policy_applied")).toEqual([]);
  });

  it("keeps knowledge prefetch and tools for act", async () => {
    process.env.OPENBOT_CHAT_INBOUND_DEPTH_ROUTER = "1";
    const opts: GetReplyOptions = { runId: "run-router-act" };
    await runPreparedReply(baseParams({ ...messageParams(ACT_WRITE), opts }));
    expect(opts.inboundDepthDecision?.depth).toBe("act");
    expect(vi.mocked(buildKnowledgeUniversePromptContext)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(resolveKnowledgeGatewayClientForAgentRun)).toHaveBeenCalledTimes(1);
    expect(lastReplyCall()?.followupRun.run.disableTools).toBeUndefined();
    const tools = constructedToolsFromLastRun();
    expect(tools.length).toBeGreaterThan(0);
    expect(embeddedToolSetContainsKnowledgeSource(tools)).toBe(true);
  });

  it("does not apply the inbound-depth chat skip to space sessions", async () => {
    process.env.OPENBOT_CHAT_INBOUND_DEPTH_ROUTER = "1";
    const opts: GetReplyOptions = { runId: "run-router-space" };
    await runPreparedReply(baseParams({ sessionKey: SPACE_SESSION_KEY, opts }));
    expect(opts).not.toHaveProperty("inboundDepthDecision");
    expect(vi.mocked(buildKnowledgeUniversePromptContext)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(resolveKnowledgeGatewayClientForAgentRun)).toHaveBeenCalledTimes(1);
    expect(lastReplyCall()?.followupRun.run.disableTools).toBeUndefined();
  });

  it("chat assembly avoids the knowledge wait that retrieve still pays", async () => {
    process.env.OPENBOT_CHAT_INBOUND_DEPTH_ROUTER = "1";
    vi.mocked(buildKnowledgeUniversePromptContext).mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
      return undefined;
    });

    const chatStarted = Date.now();
    await runPreparedReply(baseParams({ opts: { runId: "run-router-ttft-chat" } }));
    const chatMs = Date.now() - chatStarted;

    vi.mocked(buildKnowledgeUniversePromptContext).mockClear();
    const retrieveStarted = Date.now();
    await runPreparedReply(
      baseParams({
        ...messageParams(RETRIEVE_QUERY),
        opts: { runId: "run-router-ttft-retrieve" },
      }),
    );
    const retrieveMs = Date.now() - retrieveStarted;

    expect(vi.mocked(buildKnowledgeUniversePromptContext)).toHaveBeenCalledTimes(1);
    expect(chatMs).toBeLessThan(retrieveMs);
    expect(retrieveMs - chatMs).toBeGreaterThanOrEqual(40);
  });

  it("does not change retrieve knowledge args when only the router flag is on", async () => {
    process.env.OPENBOT_CHAT_INBOUND_DEPTH_ROUTER = "1";
    const opts: GetReplyOptions = { runId: "run-router-retrieve-no-policy" };
    await runPreparedReply(baseParams({ ...messageParams(RETRIEVE_QUERY), opts }));
    expect(vi.mocked(buildKnowledgeUniversePromptContext)).toHaveBeenCalledWith(
      expect.not.objectContaining({ applySourcePolicy: true }),
    );
  });

  it("passes retrieve source policy without enabling live sources", async () => {
    process.env.OPENBOT_CHAT_INBOUND_DEPTH_ROUTER = "1";
    process.env.OPENBOT_CHAT_INBOUND_KNOWLEDGE_POLICY = "1";
    const events: Array<Record<string, unknown>> = [];
    const stop = onAgentEvent((evt) => {
      events.push(evt.data);
    });
    const opts: GetReplyOptions = { runId: "run-router-retrieve-policy" };
    await runPreparedReply(baseParams({ ...messageParams(RETRIEVE_QUERY), opts }));
    stop();
    expect(opts.inboundDepthDecision?.depth).toBe("retrieve");
    expect(vi.mocked(buildKnowledgeUniversePromptContext)).toHaveBeenCalledWith(
      expect.objectContaining({
        applySourcePolicy: true,
        depth: "retrieve",
        hasExplicitLiveIntent: false,
        capabilityCeiling: expect.objectContaining({ liveSourcesAllowed: false }),
      }),
    );
    const finished = events.filter((evt) => evt.event === "chat.knowledge_finished");
    expect(finished).toHaveLength(1);
    expect(finished[0]?.liveSkipped).toBe(true);
    expect(finished[0]?.depth).toBe("retrieve");
    expect(typeof finished[0]?.knowledgeMs).toBe("number");
    const started = events.filter((evt) => evt.event === "chat.knowledge_started");
    expect(started).toHaveLength(1);
    expect(started[0]?.applySourcePolicy).toBe(true);
    expect(JSON.stringify(events)).not.toContain(RETRIEVE_QUERY);
  });

  it("keeps the act knowledge path without source policy", async () => {
    process.env.OPENBOT_CHAT_INBOUND_DEPTH_ROUTER = "1";
    process.env.OPENBOT_CHAT_INBOUND_KNOWLEDGE_POLICY = "1";
    const opts: GetReplyOptions = { runId: "run-router-act-policy" };
    await runPreparedReply(baseParams({ ...messageParams(ACT_WRITE), opts }));
    expect(opts.inboundDepthDecision?.depth).toBe("act");
    expect(vi.mocked(buildKnowledgeUniversePromptContext)).toHaveBeenCalledWith(
      expect.not.objectContaining({ applySourcePolicy: true }),
    );
    expect(lastReplyCall()?.followupRun.run.disableTools).toBeUndefined();
  });

  it("keeps chat zero-knowledge zero-tools when both router and knowledge policy are on", async () => {
    process.env.OPENBOT_CHAT_INBOUND_DEPTH_ROUTER = "1";
    process.env.OPENBOT_CHAT_INBOUND_KNOWLEDGE_POLICY = "1";
    const opts: GetReplyOptions = { runId: "run-router-chat-policy" };
    await runPreparedReply(baseParams({ opts }));
    expect(opts.inboundDepthDecision?.depth).toBe("chat");
    expect(vi.mocked(buildKnowledgeUniversePromptContext)).not.toHaveBeenCalled();
    expect(lastReplyCall()?.followupRun.run.disableTools).toBe(true);
    expect(constructedToolsFromLastRun()).toHaveLength(0);
  });

  it("does not apply retrieve tool policy when only the router flag is on", async () => {
    process.env.OPENBOT_CHAT_INBOUND_DEPTH_ROUTER = "1";
    const opts: GetReplyOptions = { runId: "run-router-retrieve-no-tool-policy" };
    await runPreparedReply(baseParams({ ...messageParams(RETRIEVE_QUERY), opts }));
    expect(lastReplyCall()?.followupRun.run.inboundToolCeiling).toBeUndefined();
    expect(constructedToolsFromLastRun().map((tool) => tool.name)).toContain("knowledge_source");
  });

  it("applies retrieve read-only ceiling without giving that allowlist to chat", async () => {
    process.env.OPENBOT_CHAT_INBOUND_DEPTH_ROUTER = "1";
    process.env.OPENBOT_CHAT_INBOUND_TOOL_POLICY = "1";
    const events: Array<Record<string, unknown>> = [];
    const stop = onAgentEvent((evt) => {
      events.push(evt.data);
    });
    const opts: GetReplyOptions = { runId: "run-tool-policy-retrieve" };
    await runPreparedReply(baseParams({ ...messageParams(RETRIEVE_QUERY), opts }));
    stop();

    expect(opts.inboundDepthDecision?.depth).toBe("retrieve");
    expect(lastReplyCall()?.followupRun.run.disableTools).toBeUndefined();
    expect(lastReplyCall()?.followupRun.run.inboundToolCeiling).toEqual({
      depth: "retrieve",
      maxToolMode: "read",
      maxSideEffectLevel: "none",
    });
    expect(lastReplyCall()?.followupRun.run.contextLane).toBe("retrieve");
    const names = constructedToolsFromLastRun().map((tool) => tool.name);
    expect(names.length).toBeGreaterThan(0);
    expect(names).toContain("agents_list");
    expect(names).toContain("knowledge_search");
    expect(names).toContain("knowledge_get");
    expect(names).not.toContain("knowledge_source");
    expect(names).not.toContain("knowledge-source-tool");
    expect(names).not.toContain("message");
    expect(names).not.toContain("browser");
    const policy = events.filter((evt) => evt.event === "chat.tool_policy_applied");
    expect(policy).toHaveLength(1);
    expect(policy[0]?.toolPolicy).toBe("retrieve_readonly");
    expect(policy[0]?.policyVersion).toBe("inbound-tool-policy-v1");
    // Snapshot of retrieve read-only core tool ids (must match tool-catalog).
    // Includes evolution_perception (read / sideEffect none) — intentional.
    expect(listRetrieveReadOnlyCoreToolIds()).toEqual([
      "agents_list",
      "evolution_perception",
      "image",
      "knowledge_get",
      "knowledge_search",
      "memory_get",
      "memory_search",
      "read",
      "sessions_history",
      "sessions_list",
      "site_describe",
      "site_list",
      "web_fetch",
      "web_search",
    ]);
    expect(policy[0]?.allowlistSize).toBe(14);
    expect(policy[0]?.maxToolMode).toBe("read");
    expect(policy[0]?.maxSideEffectLevel).toBe("none");
    expect(JSON.stringify(events)).not.toContain(RETRIEVE_QUERY);
  });

  it("keeps chat on disableTools instead of the retrieve allowlist", async () => {
    process.env.OPENBOT_CHAT_INBOUND_DEPTH_ROUTER = "1";
    process.env.OPENBOT_CHAT_INBOUND_TOOL_POLICY = "1";
    const opts: GetReplyOptions = { runId: "run-tool-policy-chat" };
    await runPreparedReply(baseParams({ opts }));
    expect(opts.inboundDepthDecision?.depth).toBe("chat");
    expect(lastReplyCall()?.followupRun.run.disableTools).toBe(true);
    expect(lastReplyCall()?.followupRun.run.inboundToolCeiling).toBeUndefined();
    expect(constructedToolsFromLastRun()).toHaveLength(0);
  });

  it("still applies classify-only chat-lane when only the tool policy flag is on", async () => {
    process.env.OPENBOT_CHAT_INBOUND_TOOL_POLICY = "1";
    const opts: GetReplyOptions = { runId: "run-tool-policy-chat-only-e" };
    await runPreparedReply(baseParams({ opts }));
    expect(opts.inboundDepthDecision?.depth).toBe("chat");
    // Steward chat classify-only empties tools; tool-policy alone does not set retrieve ceiling.
    expect(lastReplyCall()?.followupRun.run.disableTools).toBe(true);
    expect(lastReplyCall()?.followupRun.run.inboundToolCeiling).toBeUndefined();
    expect(constructedToolsFromLastRun()).toHaveLength(0);
  });

  it("leaves act on the existing tool set when tool policy is on", async () => {
    process.env.OPENBOT_CHAT_INBOUND_DEPTH_ROUTER = "1";
    process.env.OPENBOT_CHAT_INBOUND_TOOL_POLICY = "1";
    const opts: GetReplyOptions = { runId: "run-tool-policy-act" };
    await runPreparedReply(baseParams({ ...messageParams(ACT_WRITE), opts }));
    expect(opts.inboundDepthDecision?.depth).toBe("act");
    expect(lastReplyCall()?.followupRun.run.inboundToolCeiling).toBeUndefined();
    expect(constructedToolsFromLastRun().map((tool) => tool.name)).toContain("knowledge_source");
  });
});

describe("runPreparedReply context-scope production entry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAgentRunContextForTest();
    vi.mocked(loadContextScopeCatalog).mockResolvedValue([]);
    vi.mocked(recordContextScopeOnCollaborationRuntime).mockResolvedValue({
      ledger: true,
      snapshot: true,
      degraded: false,
    });
    vi.mocked(authorizeContextScopePlan).mockImplementation(({ plan }) => ({
      plan,
      denied: [],
    }));
    vi.mocked(isCollaborationGroupRuntimeSession).mockReturnValue(false);
    vi.mocked(resolveGroupSessionKey).mockReturnValue(null);
  });

  afterEach(() => {
    resetAgentRunContextForTest();
  });

  function managedGroupParams() {
    vi.mocked(isCollaborationGroupRuntimeSession).mockReturnValue(true);
    vi.mocked(resolveGroupSessionKey).mockReturnValue({
      key: "agent:main:space:group-1",
      id: "group-1",
    });
    return baseParams({
      ...messageParams(RETRIEVE_QUERY),
      sessionKey: SPACE_SESSION_KEY,
      sessionEntry: {
        groupId: "group-1",
        space: "group-1",
        collaborationGroupProfile: { groupId: "group-1" },
      } as never,
      opts: {
        runId: "run-scope-entry",
        contextScopeRequest: { mode: "focused", sources: [{ type: "file", fileId: "notes.md" }] },
      },
    });
  }

  it("persists authorized Scope onto Round/Ledger before optional retrieve", async () => {
    await runPreparedReply(managedGroupParams());
    expect(vi.mocked(authorizeContextScopePlan)).toHaveBeenCalled();
    expect(vi.mocked(recordContextScopeOnCollaborationRuntime)).toHaveBeenCalledWith(
      expect.objectContaining({
        groupId: "group-1",
        requireSnapshot: true,
        evidenceCount: 0,
      }),
    );
    expect(vi.mocked(buildKnowledgeUniversePromptContext)).toHaveBeenCalled();
    const persistOrder =
      vi.mocked(recordContextScopeOnCollaborationRuntime).mock.invocationCallOrder[0] ?? 0;
    const retrieveOrder =
      vi.mocked(buildKnowledgeUniversePromptContext).mock.invocationCallOrder[0] ?? 0;
    expect(persistOrder).toBeGreaterThan(0);
    expect(persistOrder).toBeLessThan(retrieveOrder);
  });

  it("skips optional retrieve when authorize throws", async () => {
    vi.mocked(loadContextScopeCatalog).mockRejectedValue(new Error("catalog unavailable"));
    await runPreparedReply(managedGroupParams());
    expect(vi.mocked(buildKnowledgeUniversePromptContext)).not.toHaveBeenCalled();
    expect(vi.mocked(recordContextScopeOnCollaborationRuntime)).toHaveBeenCalledWith(
      expect.objectContaining({
        plan: expect.objectContaining({
          reasons: expect.arrayContaining(["denied:authorize_failed"]),
        }),
      }),
    );
  });

  it("skips optional retrieve when managed Scope persist degrades", async () => {
    vi.mocked(recordContextScopeOnCollaborationRuntime).mockResolvedValue({
      ledger: true,
      snapshot: false,
      degraded: true,
      reason: "snapshot_failed",
    });
    await runPreparedReply(managedGroupParams());
    expect(vi.mocked(recordContextScopeOnCollaborationRuntime)).toHaveBeenCalled();
    expect(vi.mocked(buildKnowledgeUniversePromptContext)).not.toHaveBeenCalled();
  });

  it("still retrieves when a group has no open managed round", async () => {
    vi.mocked(recordContextScopeOnCollaborationRuntime).mockResolvedValue({
      ledger: true,
      snapshot: false,
      degraded: false,
      reason: "no_open_round",
    });
    await runPreparedReply(managedGroupParams());
    expect(vi.mocked(recordContextScopeOnCollaborationRuntime)).toHaveBeenCalled();
    expect(vi.mocked(buildKnowledgeUniversePromptContext)).toHaveBeenCalled();
  });

  it("does not require Round persist on 1:1 retrieve", async () => {
    await runPreparedReply(
      baseParams({
        ...messageParams(RETRIEVE_QUERY),
        opts: { runId: "run-scope-direct" },
      }),
    );
    expect(vi.mocked(authorizeContextScopePlan)).toHaveBeenCalled();
    expect(vi.mocked(recordContextScopeOnCollaborationRuntime)).not.toHaveBeenCalled();
    expect(vi.mocked(buildKnowledgeUniversePromptContext)).toHaveBeenCalled();
  });
});
