import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runPreparedReply } from "../auto-reply/reply/get-reply-run.js";
import { openTaskStore } from "../conversation-task/store.js";
import { OBJECTIVE_SHADOW_FLAG_ENV, OBJECTIVE_SHADOW_HMAC_KEY_ENV } from "./feature.js";
import { OBJECTIVE_SHADOW_LOG_ENV } from "./ingress-hook.js";
import { readShadowRecords } from "./log.js";
import {
  OBJECTIVE_SHADOW_CT_STORE_ENV,
  readConversationTaskCandidates,
} from "./read-existing-objectives.js";
import { enableObjectiveShadowForTest, resolveShadowTestLogPath } from "./test-env.js";

vi.mock("../agents/auth-profiles/session-override.js", () => ({
  resolveSessionAuthProfileOverride: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../agents/pi-embedded.js", () => ({
  abortEmbeddedPiRun: vi.fn().mockReturnValue(false),
  isEmbeddedPiRunActive: vi.fn().mockReturnValue(false),
  isEmbeddedPiRunStreaming: vi.fn().mockReturnValue(false),
  resolveEmbeddedSessionLane: vi.fn().mockReturnValue("session:session-key"),
}));
vi.mock("../config/sessions.js", () => ({
  resolveGroupSessionKey: vi.fn().mockReturnValue(undefined),
  resolveSessionFilePath: vi.fn().mockReturnValue("/tmp/session.jsonl"),
  resolveSessionFilePathOptions: vi.fn().mockReturnValue({}),
  updateSessionStore: vi.fn(),
}));
vi.mock("../gateway/agent-growth/working-style-store.js", () => ({
  resolveWorkingStyleInstructions: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../gateway/knowledge/agent-run-gateway-client.js", () => ({
  resolveKnowledgeGatewayClientForAgentRun: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../gateway/knowledge/kb-index.js", () => ({
  openKnowledgeIndex: vi.fn(),
  resolveKnowledgeIndexDbPath: vi.fn().mockReturnValue("/tmp/knowledge.db"),
}));
vi.mock("../gateway/knowledge/knowledge-lineage-store.js", () => ({
  upsertKnowledgeLineage: vi.fn(),
}));
vi.mock("../globals.js", () => ({ logVerbose: vi.fn() }));
vi.mock("../organization/runtime.js", () => ({
  resolveRuntimeOrganizationContext: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../process/command-queue.js", () => ({
  clearCommandLane: vi.fn().mockReturnValue(0),
  getQueueSize: vi.fn().mockReturnValue(0),
}));
vi.mock("../routing/session-key.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../routing/session-key.js")>()),
  normalizeAgentId: vi.fn((value: string) => value),
  normalizeMainKey: vi.fn().mockReturnValue("main"),
}));
vi.mock("../utils/provider-utils.js", () => ({
  isReasoningTagProvider: vi.fn().mockReturnValue(false),
}));
vi.mock("../auto-reply/command-detection.js", () => ({
  hasControlCommand: vi.fn().mockReturnValue(false),
}));
vi.mock("../auto-reply/reply/agent-runner.js", () => ({
  runReplyAgent: vi.fn().mockResolvedValue({ text: "ok" }),
}));
vi.mock("../auto-reply/reply/body.js", () => ({
  applySessionHints: vi.fn().mockImplementation(async ({ baseBody }) => baseBody),
}));
vi.mock("../auto-reply/reply/collaboration-capability-context.js", () => ({
  buildCollaborationCapabilitySystemPrompt: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../auto-reply/reply/groups.js", () => ({
  buildGroupIntro: vi.fn().mockReturnValue(""),
  buildGroupChatContext: vi.fn().mockReturnValue(""),
}));
vi.mock("../auto-reply/reply/inbound-meta.js", () => ({
  buildInboundMetaSystemPrompt: vi.fn().mockReturnValue(""),
  buildInboundUserContextPrefix: vi.fn().mockReturnValue(""),
  buildCurrentSpeakerUntrustedPrompt: vi.fn().mockReturnValue(undefined),
}));
vi.mock("../auto-reply/reply/knowledge-universe-context.js", () => ({
  buildKnowledgeUniversePromptContext: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../auto-reply/reply/operational-identity-context.js", () => ({
  buildOperationalIdentitySystemPrompt: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../auto-reply/reply/queue.js", () => ({
  resolveQueueSettings: vi.fn().mockReturnValue({ mode: "followup" }),
}));
vi.mock("../auto-reply/reply/route-reply.js", () => ({ routeReply: vi.fn() }));
vi.mock("../auto-reply/reply/runtime-context-assembly.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../auto-reply/reply/runtime-context-assembly.js")>();
  return {
    ...actual,
    isCollaborationGroupRuntimeSession: vi.fn().mockReturnValue(false),
    assembleCollaborationRuntimeContextParts: vi.fn().mockResolvedValue([]),
    resolveCollaborationRunWorkspaceDir: vi.fn(
      ({ agentWorkspaceDir }: { agentWorkspaceDir: string }) => agentWorkspaceDir,
    ),
    // Keep real resolveCollaborationGroupIdForRun.
  };
});
vi.mock("../auto-reply/reply/context-budget-assembler.js", () => ({
  buildActiveContextSystemPrompt: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../auto-reply/reply/session-continuity.js", () => ({
  buildSessionContinuityPrompt: vi.fn().mockResolvedValue(undefined),
  resolveContinuityMemoryRoot: vi.fn().mockReturnValue("/tmp/memory"),
  resolveSessionContinuityWorkspaceDir: vi.fn().mockReturnValue("/tmp/workspace"),
}));
vi.mock("../auto-reply/reply/goal-correction-mutation.js", () => ({
  buildActivePrimaryObjectivePrompt: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../auto-reply/reply/session-updates.js", () => ({
  ensureSkillSnapshot: vi.fn().mockImplementation(async ({ sessionEntry, systemSent }) => ({
    sessionEntry,
    systemSent,
    skillsSnapshot: undefined,
  })),
  drainFormattedSystemEvents: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../auto-reply/reply/learning-recall-context.js", () => ({
  buildLearningRecallSystemPrompt: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../auto-reply/reply/runtime-skill-policy.js", () => ({
  resolveRuntimeSkillPolicy: vi.fn().mockResolvedValue({ block: [] }),
}));
vi.mock("../auto-reply/reply/typing-mode.js", () => ({
  resolveTypingMode: vi.fn().mockReturnValue("off"),
}));

const HMAC_KEY = "chat-shadow-hmac";

function baseParams() {
  return {
    ctx: {
      Body: "hi",
      RawBody: "hi",
      CommandBody: "hi",
      ChatType: "direct",
      OriginatingChannel: "webchat",
      GatewayClientSessionEnterpriseId: "tenant-chat",
    },
    sessionCtx: {
      Body: "hi",
      BodyStripped: "hi",
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
    directives: { hasThinkDirective: false, thinkLevel: undefined } as never,
    defaultActivation: "always",
    resolvedThinkLevel: "high",
    resolvedVerboseLevel: "off",
    resolvedReasoningLevel: "off",
    resolvedElevatedLevel: "off",
    elevatedEnabled: false,
    elevatedAllowed: false,
    blockStreamingEnabled: false,
    resolvedBlockStreamingBreak: "message_end",
    modelState: { resolveDefaultThinkingLevel: async () => "medium" } as never,
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
    sessionKey: "agent:main:main",
    sessionId: "session-chat-1",
    workspaceDir: "/tmp/workspace",
    abortedLastRun: false,
    opts: { runId: "run-chat-1" },
  } as Parameters<typeof runPreparedReply>[0];
}

describe("runPreparedReply objective shadow wiring", () => {
  let root: string;
  let logPath: string;
  let previous: Record<string, string | undefined>;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "chat-obj-shadow-"));
    logPath = resolveShadowTestLogPath(path.join(root, "objective-shadow.jsonl"));
    previous = {
      [OBJECTIVE_SHADOW_FLAG_ENV]: process.env[OBJECTIVE_SHADOW_FLAG_ENV],
      [OBJECTIVE_SHADOW_HMAC_KEY_ENV]: process.env[OBJECTIVE_SHADOW_HMAC_KEY_ENV],
      [OBJECTIVE_SHADOW_LOG_ENV]: process.env[OBJECTIVE_SHADOW_LOG_ENV],
      [OBJECTIVE_SHADOW_CT_STORE_ENV]: process.env[OBJECTIVE_SHADOW_CT_STORE_ENV],
    };
    process.env[OBJECTIVE_SHADOW_LOG_ENV] = logPath;
    process.env[OBJECTIVE_SHADOW_CT_STORE_ENV] = root;
    if (logPath === path.join(root, "objective-shadow.jsonl")) {
      delete process.env[OBJECTIVE_SHADOW_FLAG_ENV];
      delete process.env[OBJECTIVE_SHADOW_HMAC_KEY_ENV];
    }
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("OFF writes no JSONL", async () => {
    await runPreparedReply(baseParams());
    expect(fs.existsSync(logPath)).toBe(false);
  });

  it("ON without a ConversationTask skips and does not propose from runId", async () => {
    enableObjectiveShadowForTest(HMAC_KEY);
    await runPreparedReply(baseParams());
    const records = readShadowRecords(logPath);
    expect(records).toHaveLength(1);
    expect(records[0]?.resolveStatus).toBe("skipped");
    expect(records[0]?.proposed).toEqual([]);
    expect(records[0]?.correlation.objectiveId).toBeUndefined();
    expect(records[0]?.correlation.objectiveId).not.toBe("run-chat-1");
    expect(records[0]?.proposedDisposition).not.toBe("generated");
  });

  it("ON writes at most one chat record whose objective comes from ConversationTask", async () => {
    enableObjectiveShadowForTest(HMAC_KEY);
    const store = openTaskStore({ tenantId: "tenant-chat", storeRoot: root, now: () => 1 });
    const sessionKey = "agent:main:main";
    const sessionId = "session-chat-1";
    expect(sessionId).not.toBe(sessionKey);
    const created = store.createTaskIfAbsent({
      conversationId: sessionKey,
      goal: "跟踪竞品周报",
      activationEpoch: 5,
      requesterId: "user-1",
    });
    store.close();
    expect(created.task.taskKey).toBeTruthy();
    expect(
      readConversationTaskCandidates({
        tenantId: "tenant-chat",
        conversationId: sessionId,
        storeRoot: root,
      }),
    ).toEqual([]);
    expect(
      readConversationTaskCandidates({
        tenantId: "tenant-chat",
        conversationId: sessionKey,
        storeRoot: root,
      })[0]?.objectiveId,
    ).toBe(created.task.taskKey);
    await runPreparedReply(baseParams());
    await runPreparedReply(baseParams());
    const records = readShadowRecords(logPath);
    expect(records).toHaveLength(1);
    expect(records[0]?.correlation.ingress).toBe("chat");
    expect(records[0]?.correlation.runId).toBe("run-chat-1");
    expect(records[0]?.correlation.objectiveId).toBe(created.task.taskKey);
    expect(records[0]?.correlation.revision).toBe(5);
    expect(records[0]?.correlation.objectiveId).not.toBe("run-chat-1");
    expect(records[0]?.correlation.objectiveId).not.toBe(sessionId);
    expect(records[0]?.proposedDisposition).toBe("generated");
    expect(records[0]?.proposed[0]?.objectiveId).toBe(created.task.taskKey);
  });
});
