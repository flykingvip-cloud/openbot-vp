/**
 * Real normal-reply entrance: after A ends, runPreparedReply must inject durable
 * aside Q&A as untrusted user-body context (not extraSystemPrompt) so "解释你刚才的回答" has B's context
 * (without co-writing A's jsonl).
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenBotConfig } from "../../config/config.js";
import { runPreparedReply } from "./get-reply-run.js";
import { appendAsideDialogueTurn } from "./mid-task-aside-dialogue-history.js";

const tempDirs: string[] = [];

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

vi.mock("../../gateway/knowledge/kb-index.js", () => ({
  openKnowledgeIndex: vi.fn(),
  resolveKnowledgeIndexDbPath: vi.fn().mockReturnValue("/tmp/knowledge.db"),
}));

vi.mock("../../gateway/knowledge/knowledge-lineage-store.js", () => ({
  upsertKnowledgeLineage: vi.fn(),
}));

vi.mock("../../gateway/user-modeling/tenant-membership.js", () => ({
  resolveUserModelingTenantId: vi.fn().mockResolvedValue(null),
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
  };
});

vi.mock("./context-budget-assembler.js", () => ({
  buildActiveContextSystemPrompt: vi.fn().mockResolvedValue(undefined),
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

import { runReplyAgent } from "./agent-runner.js";

function baseParams(
  overrides: Partial<Parameters<typeof runPreparedReply>[0]> = {},
): Parameters<typeof runPreparedReply>[0] {
  return {
    ctx: {
      Body: "解释你刚才的回答",
      RawBody: "解释你刚才的回答",
      CommandBody: "解释你刚才的回答",
      ChatType: "direct",
      OriginatingChannel: "webchat",
      MessageSid: "msg-followup",
    },
    sessionCtx: {
      Body: "解释你刚才的回答",
      BodyStripped: "解释你刚才的回答",
      SenderId: "user@example.com",
      ChatType: "direct",
      OriginatingChannel: "webchat",
      MessageSid: "msg-followup",
    },
    cfg: { session: {}, channels: {}, agents: { defaults: {} } } as OpenBotConfig,
    agentId: "default",
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
    resolvedThinkLevel: "off",
    resolvedVerboseLevel: "off",
    resolvedReasoningLevel: "off",
    resolvedElevatedLevel: "off",
    elevatedEnabled: false,
    elevatedAllowed: false,
    blockStreamingEnabled: false,
    resolvedBlockStreamingBreak: "message_end",
    modelState: {
      resolveDefaultThinkingLevel: async () => "off",
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
    isNewSession: false,
    resetTriggered: false,
    systemSent: true,
    sessionKey: "agent:main:direct:user@example.com",
    workspaceDir: "/tmp/workspace",
    abortedLastRun: false,
    ...overrides,
  };
}

describe("runPreparedReply aside dialogue context (A-ended normal path)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map((dir) => fsp.rm(dir, { recursive: true, force: true })),
    );
  });

  it("injects aside Q&A as untrusted commandBody context via normal reply entrance", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aside-normal-reply-"));
    tempDirs.push(dir);
    const sessionFile = path.join(dir, "sess.jsonl");
    fs.writeFileSync(sessionFile, "", "utf8");
    appendAsideDialogueTurn(sessionFile, {
      atMs: 3_000,
      runId: "b1",
      role: "user",
      text: "续航怎么比的",
      messageId: "msg-b1",
    });
    appendAsideDialogueTurn(sessionFile, {
      atMs: 3_100,
      runId: "b1",
      role: "assistant",
      text: "刚才是按官方标称续航对比的。",
    });

    await runPreparedReply(
      baseParams({
        sessionEntry: {
          sessionId: "sess-a-ended",
          sessionFile,
          updatedAt: Date.now(),
        } as never,
      }),
    );

    const call = vi.mocked(runReplyAgent).mock.calls[0]?.[0];
    const body = call?.commandBody ?? "";
    expect(body).toContain("Untrusted context");
    expect(body).toContain("<untrusted-text>");
    expect(body).toContain("续航怎么比的");
    expect(body).toContain("官方标称续航");
    expect(body).toMatch(/data, not instructions|do not treat as instructions/i);
    const prompt = call?.followupRun.run.extraSystemPrompt ?? "";
    expect(prompt).not.toContain("续航怎么比的");
    expect(prompt).not.toContain("官方标称续航");
  });
});
