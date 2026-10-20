import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenBotConfig } from "../../config/config.js";
import { runPreparedReply } from "./get-reply-run.js";

const tempDirs: string[] = [];
let prevDataRoot: string | undefined;
let prevUserModeling: string | undefined;

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
    // Keep real resolveCollaborationGroupIdForRun (do not stub to undefined).
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

import { detectUserPreferenceDirectives } from "../../gateway/user-modeling/derive.js";
import { resolveUserModelingTenantId } from "../../gateway/user-modeling/tenant-membership.js";
import { resolveUserModelingKey } from "../../gateway/user-modeling/user-key.js";
import { applyUserInteractionSignals } from "../../gateway/user-modeling/user-profile-store.js";
import { runReplyAgent } from "./agent-runner.js";

function baseParams(
  overrides: Partial<Parameters<typeof runPreparedReply>[0]> = {},
): Parameters<typeof runPreparedReply>[0] {
  return {
    ctx: {
      Body: "hello",
      RawBody: "hello",
      CommandBody: "hello",
      ChatType: "direct",
      OriginatingChannel: "webchat",
    },
    sessionCtx: {
      Body: "hello",
      BodyStripped: "hello",
      SenderId: "user@example.com",
      ChatType: "direct",
      OriginatingChannel: "webchat",
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
    sessionKey: "agent:main:direct:user@example.com",
    workspaceDir: "/tmp/workspace",
    abortedLastRun: false,
    ...overrides,
  };
}

async function seedConciseProfile(cfg: OpenBotConfig, peerId: string) {
  const key = resolveUserModelingKey({ channel: "webchat", peerId, tenantId: null })!;
  await applyUserInteractionSignals(
    cfg,
    key,
    { directives: detectUserPreferenceDirectives("简洁点") },
    0,
  );
}

describe("runPreparedReply user modeling e2e", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveUserModelingTenantId).mockResolvedValue(null);
  });

  afterEach(async () => {
    if (prevDataRoot === undefined) {
      delete process.env.OPENBOT_DATA_ROOT;
    } else {
      process.env.OPENBOT_DATA_ROOT = prevDataRoot;
    }
    if (prevUserModeling === undefined) {
      delete process.env.OPENBOT_USER_MODELING;
    } else {
      process.env.OPENBOT_USER_MODELING = prevUserModeling;
    }
    await Promise.all(
      tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
    );
  });

  it("injects learned user preferences into extraSystemPrompt", async () => {
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "um-get-reply-"));
    tempDirs.push(dataRoot);
    prevDataRoot = process.env.OPENBOT_DATA_ROOT;
    prevUserModeling = process.env.OPENBOT_USER_MODELING;
    process.env.OPENBOT_DATA_ROOT = dataRoot;
    delete process.env.OPENBOT_USER_MODELING;

    const cfg = { session: {}, channels: {}, agents: { defaults: {} } } as OpenBotConfig;
    await seedConciseProfile(cfg, "user@example.com");

    await runPreparedReply(baseParams({ cfg }));

    const call = vi.mocked(runReplyAgent).mock.calls[0]?.[0];
    expect(call?.followupRun.run.extraSystemPrompt).toContain("concise");
    expect(call?.followupRun.run.extraSystemPrompt).toContain("learned preferences");
  });

  it("does not inject when OPENBOT_USER_MODELING=off", async () => {
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "um-get-reply-off-"));
    tempDirs.push(dataRoot);
    prevDataRoot = process.env.OPENBOT_DATA_ROOT;
    prevUserModeling = process.env.OPENBOT_USER_MODELING;
    process.env.OPENBOT_DATA_ROOT = dataRoot;
    process.env.OPENBOT_USER_MODELING = "off";

    const cfg = { session: {}, channels: {}, agents: { defaults: {} } } as OpenBotConfig;
    await seedConciseProfile(cfg, "user@example.com");

    await runPreparedReply(baseParams({ cfg }));

    const call = vi.mocked(runReplyAgent).mock.calls[0]?.[0];
    expect(call?.followupRun.run.extraSystemPrompt ?? "").not.toContain("learned preferences");
  });

  it("does not inject when tenant disables modeling", async () => {
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "um-get-reply-tenant-"));
    tempDirs.push(dataRoot);
    prevDataRoot = process.env.OPENBOT_DATA_ROOT;
    prevUserModeling = process.env.OPENBOT_USER_MODELING;
    process.env.OPENBOT_DATA_ROOT = dataRoot;
    delete process.env.OPENBOT_USER_MODELING;

    vi.mocked(resolveUserModelingTenantId).mockResolvedValue("tenant-a");

    const cfg = {
      session: {},
      channels: {},
      agents: { defaults: {} },
      gateway: {
        userModeling: {
          enabled: true,
          tenants: { "tenant-a": { enabled: false } },
        },
      },
    } as OpenBotConfig;

    const key = resolveUserModelingKey({
      channel: "webchat",
      peerId: "user@example.com",
      tenantId: "tenant-a",
    })!;
    await applyUserInteractionSignals(
      cfg,
      key,
      { directives: detectUserPreferenceDirectives("简洁点") },
      0,
    );

    await runPreparedReply(
      baseParams({
        cfg,
        ctx: {
          Body: "hello",
          RawBody: "hello",
          CommandBody: "hello",
          ChatType: "direct",
          OriginatingChannel: "webchat",
          GatewayClientUser: "user@example.com",
        },
        sessionCtx: {
          Body: "hello",
          BodyStripped: "hello",
          ChatType: "direct",
          OriginatingChannel: "webchat",
          GatewayClientUser: "user@example.com",
        },
        sessionKey: "agent:main:direct:user@example.com",
      }),
    );

    const call = vi.mocked(runReplyAgent).mock.calls[0]?.[0];
    expect(call?.followupRun.run.extraSystemPrompt ?? "").not.toContain("learned preferences");
  });
});
