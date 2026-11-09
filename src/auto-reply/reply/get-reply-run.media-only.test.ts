import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SILENT_REPLY_TOKEN } from "../tokens.js";
import { runPreparedReply } from "./get-reply-run.js";

const tempDirs: string[] = [];

vi.mock("../../agents/auth-profiles/session-override.js", () => ({
  resolveSessionAuthProfileOverride: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../agent-runtime/execution/index.js", async (original) => ({
  ...(await original<typeof import("../../agent-runtime/execution/index.js")>()),
  abortEmbeddedPiRun: vi.fn().mockReturnValue(false),
  isEmbeddedPiRunActive: vi.fn().mockReturnValue(false),
  isEmbeddedPiRunStreaming: vi.fn().mockReturnValue(false),
}));

vi.mock("../../config/sessions.js", () => ({
  resolveGroupSessionKey: vi.fn().mockReturnValue(undefined),
  resolveSessionFilePath: vi.fn().mockReturnValue("/tmp/session.jsonl"),
  resolveSessionFilePathOptions: vi.fn().mockReturnValue({}),
  updateSessionStore: vi.fn(),
}));

vi.mock("../../globals.js", () => ({
  logVerbose: vi.fn(),
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

vi.mock("./groups.js", () => ({
  buildGroupIntro: vi.fn().mockReturnValue(""),
  buildGroupChatContext: vi.fn().mockReturnValue(""),
}));

vi.mock("./inbound-meta.js", () => ({
  buildInboundMetaSystemPrompt: vi.fn().mockReturnValue(""),
  buildInboundUserContextPrefix: vi.fn().mockReturnValue(""),
  buildCurrentSpeakerUntrustedPrompt: vi
    .fn()
    .mockReturnValue("## Current speaker (untrusted)\nSpeaker: Alice"),
}));

vi.mock("./queue.js", () => ({
  resolveQueueSettings: vi.fn().mockReturnValue({ mode: "followup" }),
}));

vi.mock("./route-reply.js", () => ({
  routeReply: vi.fn(),
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
import {
  buildCurrentSpeakerUntrustedPrompt,
  buildInboundUserContextPrefix,
} from "./inbound-meta.js";
import { routeReply } from "./route-reply.js";
import { drainFormattedSystemEvents } from "./session-updates.js";
import { resolveTypingMode } from "./typing-mode.js";

function baseParams(
  overrides: Partial<Parameters<typeof runPreparedReply>[0]> = {},
): Parameters<typeof runPreparedReply>[0] {
  return {
    ctx: {
      Body: "",
      RawBody: "",
      CommandBody: "",
      ThreadHistoryBody: "Earlier message in this thread",
      OriginatingChannel: "slack",
      OriginatingTo: "C123",
      ChatType: "group",
    },
    sessionCtx: {
      Body: "",
      BodyStripped: "",
      ThreadHistoryBody: "Earlier message in this thread",
      MediaPath: "/tmp/input.png",
      Provider: "slack",
      ChatType: "group",
      OriginatingChannel: "slack",
      OriginatingTo: "C123",
    },
    cfg: { session: {}, channels: {}, agents: { defaults: {} } },
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
    sessionKey: "session-key",
    workspaceDir: "/tmp/workspace",
    abortedLastRun: false,
    ...overrides,
  };
}

describe("runPreparedReply media-only handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
    );
  });

  it("allows media-only prompts and preserves thread context in queued followups", async () => {
    const result = await runPreparedReply(baseParams());
    expect(result).toEqual({ text: "ok" });

    const call = vi.mocked(runReplyAgent).mock.calls[0]?.[0];
    expect(call).toBeTruthy();
    expect(call?.followupRun.prompt).toContain("[Thread history - for context]");
    expect(call?.followupRun.prompt).toContain("Earlier message in this thread");
    expect(call?.followupRun.prompt).toContain("[User sent media without caption]");
  });

  it("suppresses direct group replies from non-coordinator organization members", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-org-routing-"));
    tempDirs.push(root);
    const groupDir = path.join(root, "groups", encodeURIComponent("upbeyond"));
    await fs.mkdir(groupDir, { recursive: true });
    await fs.writeFile(
      path.join(groupDir, "profile.json"),
      JSON.stringify({
        groupId: "upbeyond",
        displayName: "upbeyond",
        coordinatorBotId: "main",
      }),
    );
    await fs.writeFile(
      path.join(groupDir, "members.json"),
      JSON.stringify({
        members: [
          {
            memberId: "main",
            memberKind: "bot",
            agentId: "main",
            name: "大白管家",
            status: "active",
          },
          {
            memberId: "bot-2",
            memberKind: "bot",
            agentId: "bot-2",
            name: "市场助手",
            status: "active",
          },
        ],
      }),
    );

    const result = await runPreparedReply(
      baseParams({
        cfg: { collaboration: { defaults: { workspace: root } }, agents: { defaults: {} } },
        agentId: "bot-2",
        workspaceDir: root,
        sessionKey: "agent:bot-2:main:space:upbeyond",
        sessionEntry: { chatType: "group", groupId: "upbeyond" } as never,
      }),
    );

    expect(result).toEqual({ text: SILENT_REPLY_TOKEN });
    expect(vi.mocked(runReplyAgent)).not.toHaveBeenCalled();
  });

  it("keeps thread history context on follow-up turns", async () => {
    const result = await runPreparedReply(
      baseParams({
        isNewSession: false,
      }),
    );
    expect(result).toEqual({ text: "ok" });

    const call = vi.mocked(runReplyAgent).mock.calls[0]?.[0];
    expect(call).toBeTruthy();
    expect(call?.followupRun.prompt).toContain("[Thread history - for context]");
    expect(call?.followupRun.prompt).toContain("Earlier message in this thread");
  });

  it("returns the empty-body reply when there is no text and no media", async () => {
    const result = await runPreparedReply(
      baseParams({
        ctx: {
          Body: "",
          RawBody: "",
          CommandBody: "",
        },
        sessionCtx: {
          Body: "",
          BodyStripped: "",
          Provider: "slack",
        },
      }),
    );

    expect(result).toEqual({
      text: "I didn't receive any text in your message. Please resend or add a caption.",
    });
    expect(vi.mocked(runReplyAgent)).not.toHaveBeenCalled();
  });

  it("omits auth key labels from /new and /reset confirmation messages", async () => {
    await runPreparedReply(
      baseParams({
        resetTriggered: true,
      }),
    );

    const resetNoticeCall = vi.mocked(routeReply).mock.calls[0]?.[0] as
      | { payload?: { text?: string } }
      | undefined;
    expect(resetNoticeCall?.payload?.text).toContain("✅ New session started · model:");
    expect(resetNoticeCall?.payload?.text).not.toContain("🔑");
    expect(resetNoticeCall?.payload?.text).not.toContain("api-key");
    expect(resetNoticeCall?.payload?.text).not.toContain("env:");
  });

  it("skips reset notice when only webchat fallback routing is available", async () => {
    await runPreparedReply(
      baseParams({
        resetTriggered: true,
        ctx: {
          Body: "",
          RawBody: "",
          CommandBody: "",
          ThreadHistoryBody: "Earlier message in this thread",
          OriginatingChannel: undefined,
          OriginatingTo: undefined,
          ChatType: "group",
        },
        command: {
          isAuthorizedSender: true,
          abortKey: "session-key",
          ownerList: [],
          senderIsOwner: false,
          channel: "webchat",
          from: undefined,
          to: undefined,
        } as never,
      }),
    );

    expect(vi.mocked(routeReply)).not.toHaveBeenCalled();
  });

  it("uses inbound origin channel for run messageProvider", async () => {
    await runPreparedReply(
      baseParams({
        ctx: {
          Body: "",
          RawBody: "",
          CommandBody: "",
          ThreadHistoryBody: "Earlier message in this thread",
          OriginatingChannel: "webchat",
          OriginatingTo: "session:abc",
          ChatType: "group",
        },
        sessionCtx: {
          Body: "",
          BodyStripped: "",
          ThreadHistoryBody: "Earlier message in this thread",
          MediaPath: "/tmp/input.png",
          Provider: "telegram",
          ChatType: "group",
          OriginatingChannel: "telegram",
          OriginatingTo: "telegram:123",
        },
      }),
    );

    const call = vi.mocked(runReplyAgent).mock.calls[0]?.[0];
    expect(call?.followupRun.run.messageProvider).toBe("webchat");
  });

  it("prefers Provider over Surface when origin channel is missing", async () => {
    await runPreparedReply(
      baseParams({
        ctx: {
          Body: "",
          RawBody: "",
          CommandBody: "",
          ThreadHistoryBody: "Earlier message in this thread",
          OriginatingChannel: undefined,
          OriginatingTo: undefined,
          Provider: "feishu",
          Surface: "webchat",
          ChatType: "group",
        },
        sessionCtx: {
          Body: "",
          BodyStripped: "",
          ThreadHistoryBody: "Earlier message in this thread",
          MediaPath: "/tmp/input.png",
          Provider: "webchat",
          ChatType: "group",
          OriginatingChannel: undefined,
          OriginatingTo: undefined,
        },
      }),
    );

    const call = vi.mocked(runReplyAgent).mock.calls[0]?.[0];
    expect(call?.followupRun.run.messageProvider).toBe("feishu");
  });

  it("passes suppressTyping through typing mode resolution", async () => {
    await runPreparedReply(
      baseParams({
        opts: {
          suppressTyping: true,
        },
      }),
    );

    const call = vi.mocked(resolveTypingMode).mock.calls[0]?.[0] as
      | { suppressTyping?: boolean }
      | undefined;
    expect(call?.suppressTyping).toBe(true);
  });

  it("routes queued system events into system prompt context, not the user instruction", async () => {
    vi.mocked(drainFormattedSystemEvents).mockResolvedValueOnce("System: [t] Model switched.");

    await runPreparedReply(baseParams());

    const call = vi.mocked(runReplyAgent).mock.calls[0]?.[0];
    expect(call).toBeTruthy();
    expect(call?.commandBody).not.toContain("System: [t] Model switched.");
    expect(call?.followupRun.prompt).not.toContain("System: [t] Model switched.");
    expect(call?.followupRun.run.extraSystemPrompt ?? "").toContain("## Runtime system events");
    expect(call?.followupRun.run.extraSystemPrompt ?? "").toContain("System: [t] Model switched.");
  });

  it("does not prepend inbound user-context onto the user-role body", async () => {
    await runPreparedReply(baseParams());

    expect(vi.mocked(buildInboundUserContextPrefix)).not.toHaveBeenCalled();
  });

  it("puts the current speaker on the system prompt, not the user instruction", async () => {
    await runPreparedReply(baseParams());

    expect(vi.mocked(buildCurrentSpeakerUntrustedPrompt)).toHaveBeenCalled();
    const call = vi.mocked(runReplyAgent).mock.calls[0]?.[0];
    expect(call?.commandBody).not.toContain("Current speaker (untrusted)");
    expect(call?.followupRun.run.extraSystemPrompt ?? "").toContain("Current speaker (untrusted)");
    expect(call?.followupRun.run.extraSystemPrompt ?? "").toContain("Speaker: Alice");
  });

  it("injects collaboration capability context into the extra system prompt when session data exists", async () => {
    await runPreparedReply(
      baseParams({
        agentId: "bot-1",
        sessionEntry: {
          sessionId: "session-1",
          updatedAt: 1,
          groupId: "group-1",
          collaborationPersonalCapabilities: ["draft", "search"],
          collaborationGroupProfile: {
            groupId: "group-1",
            enabledSkills: ["summarize", "review"],
            blockedSkills: ["search"],
            systemInstructions: ["Follow the release review rubric."],
            confidentialityTier: "restricted",
            updatedAtMs: 1,
          },
          collaborationParticipationOverlay: {
            participationId: "group-1::bot-1",
            botId: "bot-1",
            groupId: "group-1",
            overlayCapabilities: ["diff-analysis"],
            policyFilters: [
              "allow:draft",
              "allow:review",
              "allow:summarize",
              "allow:diff-analysis",
            ],
            systemInstructions: ["Act as the release reviewer for this collaboration."],
            confidentialityTier: "restricted",
          },
        },
      }),
    );

    const call = vi.mocked(runReplyAgent).mock.calls.at(-1)?.[0];
    expect(call?.followupRun.run.extraSystemPrompt ?? "").toContain(
      "Collaboration capability context",
    );
    expect(call?.followupRun.run.extraSystemPrompt ?? "").toContain("Confidentiality: restricted");
    expect(call?.followupRun.run.extraSystemPrompt ?? "").toContain(
      "Effective capabilities: draft, summarize, review, diff-analysis",
    );
    expect(call?.followupRun.run.extraSystemPrompt ?? "").toContain(
      "Treat group and participation context as scoped to this collaboration.",
    );
  });

  it("merges promoted learning assets into personal collaboration capabilities", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-collab-capabilities-"));
    tempDirs.push(workspaceDir);

    const storeDir = path.join(workspaceDir, "groups", encodeURIComponent("group-1"));
    await fs.mkdir(storeDir, { recursive: true });
    await fs.writeFile(
      path.join(storeDir, "learning-assets.json"),
      JSON.stringify(
        {
          assets: [
            {
              assetId: "asset-1",
              botId: "bot-1",
              sourceGroupId: "group-1",
              sourceCapsuleId: "capsule-1",
              status: "active",
              abstractedContent: {
                capabilities: ["risk-scan", "signoff-review"],
              },
            },
          ],
        },
        null,
        2,
      ),
      "utf-8",
    );

    await runPreparedReply(
      baseParams({
        workspaceDir,
        agentId: "bot-1",
        cfg: { collaboration: { defaults: { workspace: workspaceDir } }, agents: { defaults: {} } },
        sessionEntry: {
          sessionId: "session-1",
          updatedAt: 1,
          groupId: "group-1",
          collaborationPersonalCapabilities: ["draft"],
          collaborationGroupProfile: {
            groupId: "group-1",
            enabledSkills: ["summarize"],
            confidentialityTier: "internal",
            updatedAtMs: 1,
          },
          collaborationParticipationOverlay: {
            participationId: "group-1::bot-1",
            botId: "bot-1",
            groupId: "group-1",
            overlayCapabilities: ["diff-analysis"],
          },
        },
      }),
    );

    const call = vi.mocked(runReplyAgent).mock.calls.at(-1)?.[0];
    expect(call?.followupRun.run.extraSystemPrompt ?? "").toContain(
      "Personal capabilities: draft, risk-scan, signoff-review",
    );
    expect(call?.followupRun.run.extraSystemPrompt ?? "").toContain(
      "Effective capabilities: draft, risk-scan, signoff-review, summarize, diff-analysis",
    );
  });

  it("preserves first-token think hint when system events are present", async () => {
    vi.mocked(drainFormattedSystemEvents).mockResolvedValueOnce("System: [t] Node connected.");

    await runPreparedReply(
      baseParams({
        ctx: { Body: "low tell me about cats", RawBody: "low tell me about cats" },
        sessionCtx: { Body: "low tell me about cats", BodyStripped: "low tell me about cats" },
        resolvedThinkLevel: undefined,
      }),
    );

    const call = vi.mocked(runReplyAgent).mock.calls[0]?.[0];
    expect(call).toBeTruthy();
    expect(call?.followupRun.run.thinkLevel).toBe("low");
    expect(call?.commandBody).toContain("tell me about cats");
    expect(call?.commandBody).not.toMatch(/^low\b/);
    expect(call?.commandBody).not.toContain("System: [t] Node connected.");
    expect(call?.followupRun.run.extraSystemPrompt ?? "").toContain("System: [t] Node connected.");
  });

  it("carries system events into followupRun extraSystemPrompt for deferred turns", async () => {
    vi.mocked(drainFormattedSystemEvents).mockResolvedValueOnce("System: [t] Node connected.");

    await runPreparedReply(baseParams());

    const call = vi.mocked(runReplyAgent).mock.calls[0]?.[0];
    expect(call).toBeTruthy();
    expect(call?.followupRun.prompt).not.toContain("System: [t] Node connected.");
    expect(call?.followupRun.run.extraSystemPrompt ?? "").toContain("System: [t] Node connected.");
  });

  it("does not strip think-hint token from deferred queue body", async () => {
    // In steer mode the inferred thinkLevel is never consumed, so the first token
    // must not be stripped from the queue/steer body (followupRun.prompt).
    vi.mocked(drainFormattedSystemEvents).mockResolvedValueOnce(undefined);

    await runPreparedReply(
      baseParams({
        ctx: { Body: "low steer this conversation", RawBody: "low steer this conversation" },
        sessionCtx: {
          Body: "low steer this conversation",
          BodyStripped: "low steer this conversation",
        },
        resolvedThinkLevel: undefined,
      }),
    );

    const call = vi.mocked(runReplyAgent).mock.calls[0]?.[0];
    expect(call).toBeTruthy();
    // Queue body (used by steer mode) must keep the full original text.
    expect(call?.followupRun.prompt).toContain("low steer this conversation");
  });
});
