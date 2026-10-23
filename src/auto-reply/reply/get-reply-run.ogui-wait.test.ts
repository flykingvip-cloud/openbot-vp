import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  issueOguiDecisionFromText,
  OGUI_WAIT_PAUSE_TEXT,
} from "../../config/sessions/ogui-decision-engine.js";
import { clearOguiWaitRegistryForTests } from "../../config/sessions/ogui-decision-wait-registry.js";
import { loadSessionStore, updateSessionStore } from "../../config/sessions/store.js";

const { isEmbeddedPiRunActiveMock, runReplyAgentMock } = vi.hoisted(() => ({
  isEmbeddedPiRunActiveMock: vi.fn(() => false),
  runReplyAgentMock: vi.fn(async () => ({ text: "agent-ran" })),
}));

vi.mock("../../agents/pi-embedded.js", () => ({
  abortEmbeddedPiRun: vi.fn().mockReturnValue(false),
  isEmbeddedPiRunActive: (...args: unknown[]) => isEmbeddedPiRunActiveMock(...args),
  isEmbeddedPiRunStreaming: vi.fn().mockReturnValue(false),
  resolveEmbeddedSessionLane: vi.fn().mockReturnValue("session:ogui"),
}));

vi.mock("../../agents/auth-profiles/session-override.js", () => ({
  resolveSessionAuthProfileOverride: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../agents/workspace.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../agents/workspace.js")>();
  return { ...actual, isWorkspaceOnboardingCompleted: vi.fn().mockResolvedValue(true) };
});

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

vi.mock("../../gateway/user-modeling/tenant-membership.js", () => ({
  resolveUserModelingTenantId: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../gateway/user-modeling/record-signal.js", () => ({
  recordUserInteractionSignalSafely: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../objective-shadow/ingress-hook.js", () => ({
  observeObjectiveShadowFromIngress: vi.fn(),
}));

vi.mock("../../objective-shadow/read-existing-objectives.js", () => ({
  readConversationTaskCandidates: vi.fn().mockReturnValue([]),
}));

vi.mock("../../organization/runtime.js", () => ({
  resolveRuntimeOrganizationContext: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../process/command-queue.js", () => ({
  clearCommandLane: vi.fn().mockReturnValue(0),
  getQueueSize: vi.fn().mockReturnValue(0),
}));

vi.mock("../../globals.js", () => ({
  logVerbose: vi.fn(),
}));

vi.mock("../command-detection.js", () => ({
  hasControlCommand: vi.fn().mockReturnValue(false),
}));

vi.mock("./agent-runner.js", () => ({
  runReplyAgent: (...args: unknown[]) => runReplyAgentMock(...args),
}));

vi.mock("./session-updates.js", () => ({
  ensureSkillSnapshot: vi.fn().mockImplementation(async ({ sessionEntry, systemSent }) => ({
    sessionEntry,
    systemSent,
    skillsSnapshot: undefined,
  })),
  drainFormattedSystemEvents: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./queue.js", () => ({
  resolveQueueSettings: vi.fn().mockReturnValue({ mode: "followup" }),
}));

import { runPreparedReply } from "./get-reply-run.js";

const SESSION_KEY = "agent:main:ogui-ingress";

function legacyAnswer(): string {
  return [
    "```ogui-answer",
    JSON.stringify({
      schema_version: "ogui/v1",
      component_id: "cmp-1",
      submission_id: "legacy-ingress",
      answers: { choice: "a" },
    }),
    "```",
  ].join("\n");
}

function formText(): string {
  return [
    "```ogui-form",
    JSON.stringify({
      schema_version: "ogui/v1",
      component_id: "cmp-1",
      title: "选口径",
      fields: [
        {
          id: "choice",
          label: "口径",
          type: "single_select",
          options: [
            { value: "a", label: "甲" },
            { value: "b", label: "乙" },
          ],
        },
      ],
    }),
    "```",
  ].join("\n");
}

function replyParams(input: {
  storePath: string;
  text: string;
  heartbeat?: boolean;
}): Parameters<typeof runPreparedReply>[0] {
  const text = input.text;
  return {
    ctx: {
      Body: text,
      RawBody: text,
      CommandBody: text,
      ChatType: "direct",
      OriginatingChannel: "webchat",
      GatewayClientPlatformUserId: "user-1",
    },
    sessionCtx: {
      Body: text,
      BodyStripped: text,
      SenderId: "user-1",
      ChatType: "direct",
      OriginatingChannel: "webchat",
    },
    cfg: {
      session: {},
      channels: {},
      agents: { defaults: {} },
      collaboration: { task: { oguiDecisionLifecycle: true } },
    },
    agentId: "main",
    agentDir: "/tmp/agent",
    agentCfg: {},
    sessionCfg: {},
    commandAuthorized: true,
    command: {
      isAuthorizedSender: true,
      abortKey: SESSION_KEY,
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
    model: "claude",
    typing: { onReplyStart: vi.fn().mockResolvedValue(undefined), cleanup: vi.fn() } as never,
    defaultProvider: "anthropic",
    defaultModel: "claude",
    timeoutMs: 30_000,
    isNewSession: false,
    resetTriggered: false,
    systemSent: true,
    sessionKey: SESSION_KEY,
    sessionId: "sid-ingress",
    storePath: input.storePath,
    sessionEntry: { sessionId: "sid-ingress", updatedAt: 1 },
    workspaceDir: "/tmp/workspace",
    abortedLastRun: false,
    opts: { runId: "run-ogui-ingress", isHeartbeat: input.heartbeat === true },
  };
}

describe("runPreparedReply OGUI ingress", () => {
  let previous: string | undefined;
  let dir = "";

  beforeEach(async () => {
    previous = process.env.OPENBOT_OGUI_DECISION_LIFECYCLE;
    process.env.OPENBOT_OGUI_DECISION_LIFECYCLE = "1";
    isEmbeddedPiRunActiveMock.mockReset();
    isEmbeddedPiRunActiveMock.mockReturnValue(false);
    runReplyAgentMock.mockClear();
    clearOguiWaitRegistryForTests();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ogui-ingress-"));
    const storePath = path.join(dir, "sessions.json");
    await updateSessionStore(storePath, (store) => {
      store[SESSION_KEY] = { sessionId: "sid-ingress", updatedAt: 1 };
    });
  });

  afterEach(() => {
    if (previous === undefined) {
      delete process.env.OPENBOT_OGUI_DECISION_LIFECYCLE;
    } else {
      process.env.OPENBOT_OGUI_DECISION_LIFECYCLE = previous;
    }
    fs.rmSync(dir, { recursive: true, force: true });
    clearOguiWaitRegistryForTests();
  });

  it("lets a legacy answer proceed through runPreparedReply and writes no decision (Ev1)", async () => {
    const storePath = path.join(dir, "sessions.json");
    const result = await runPreparedReply(replyParams({ storePath, text: legacyAnswer() }));
    expect(runReplyAgentMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ text: "agent-ran" });
    expect(
      loadSessionStore(storePath, { skipCache: true })[SESSION_KEY]?.oguiDecisions,
    ).toBeUndefined();
  });

  it("pauses heartbeat and an active-run follow-up inside runPreparedReply (Ev10)", async () => {
    const storePath = path.join(dir, "sessions.json");
    await issueOguiDecisionFromText({
      text: formText(),
      binding: {
        lifecycleEnabled: true,
        cfg: { collaboration: { task: { oguiDecisionLifecycle: true } } },
        storePath,
        sessionKey: SESSION_KEY,
        userId: "user-1",
        originRunId: "run-origin",
        ingress: "chat",
        allowIssue: true,
      },
      env: { OPENBOT_OGUI_DECISION_LIFECYCLE: "1" },
    });
    const heartbeat = await runPreparedReply(
      replyParams({ storePath, text: "继续做后面独立的部分", heartbeat: true }),
    );
    expect(heartbeat).toEqual({ text: OGUI_WAIT_PAUSE_TEXT });
    expect(runReplyAgentMock).not.toHaveBeenCalled();

    isEmbeddedPiRunActiveMock.mockReturnValue(true);
    const queued = await runPreparedReply(replyParams({ storePath, text: "继续做后面独立的部分" }));
    expect(queued).toEqual({ text: OGUI_WAIT_PAUSE_TEXT });
    expect(runReplyAgentMock).not.toHaveBeenCalled();
    const stored = Object.values(
      loadSessionStore(storePath, { skipCache: true })[SESSION_KEY]?.oguiDecisions ?? {},
    )[0];
    expect(stored?.decisionStatus).toBe("waiting");
    expect(stored?.resumeStatus).toBe("pending");
  });

  it("binds resumeRef on the reply path and writes the resume completed", async () => {
    const storePath = path.join(dir, "sessions.json");
    const issued = await issueOguiDecisionFromText({
      text: formText(),
      binding: {
        lifecycleEnabled: true,
        cfg: { collaboration: { task: { oguiDecisionLifecycle: true } } },
        storePath,
        sessionKey: SESSION_KEY,
        userId: "user-1",
        originRunId: "run-origin",
        ingress: "chat",
        allowIssue: true,
      },
      env: { OPENBOT_OGUI_DECISION_LIFECYCLE: "1" },
    });
    const answer = [
      "```ogui-answer",
      JSON.stringify({
        schema_version: "ogui/v1",
        component_id: "cmp-1",
        submission_id: "sub-reply-1",
        decision_id: issued.decisionId,
        decision_version: 1,
        answers: { choice: "a" },
      }),
      "```",
    ].join("\n");
    const result = await runPreparedReply(replyParams({ storePath, text: answer }));
    expect(result).toEqual({ text: "agent-ran" });
    const call = runReplyAgentMock.mock.calls[0]?.[0] as {
      followupRun?: { run?: { oguiDecisionRun?: { resumeRef?: string; decisionId?: string } } };
    };
    expect(call.followupRun?.run?.oguiDecisionRun?.resumeRef).toBe(issued.resumeRef);
    expect(call.followupRun?.run?.oguiDecisionRun?.decisionId).toBe(issued.decisionId);
    const stored = loadSessionStore(storePath, { skipCache: true })[SESSION_KEY]?.oguiDecisions?.[
      issued.decisionId ?? ""
    ];
    expect(stored?.decisionStatus).toBe("answered");
    expect(stored?.resumeStatus).toBe("completed");
    expect(stored?.resumeRef).toBe(issued.resumeRef);
  });

  it("releases a failed reply to retryable and completes the same resume on retry", async () => {
    const storePath = path.join(dir, "sessions.json");
    const issued = await issueOguiDecisionFromText({
      text: formText(),
      binding: {
        lifecycleEnabled: true,
        cfg: { collaboration: { task: { oguiDecisionLifecycle: true } } },
        storePath,
        sessionKey: SESSION_KEY,
        userId: "user-1",
        originRunId: "run-origin",
        ingress: "chat",
        allowIssue: true,
      },
      env: { OPENBOT_OGUI_DECISION_LIFECYCLE: "1" },
    });
    const answer = [
      "```ogui-answer",
      JSON.stringify({
        schema_version: "ogui/v1",
        component_id: "cmp-1",
        submission_id: "sub-reply-fail",
        decision_id: issued.decisionId,
        decision_version: 1,
        answers: { choice: "a" },
      }),
      "```",
    ].join("\n");
    runReplyAgentMock.mockRejectedValueOnce(new Error("exec-failed"));
    await expect(runPreparedReply(replyParams({ storePath, text: answer }))).rejects.toThrow(
      "exec-failed",
    );
    const failed = loadSessionStore(storePath, { skipCache: true })[SESSION_KEY]?.oguiDecisions?.[
      issued.decisionId ?? ""
    ];
    expect(failed?.decisionStatus).toBe("answered");
    expect(failed?.resumeStatus).toBe("retryable");
    expect(failed?.resumeRef).toBe(issued.resumeRef);
    const retried = await runPreparedReply(replyParams({ storePath, text: answer }));
    expect(retried).toEqual({ text: "agent-ran" });
    const stored = loadSessionStore(storePath, { skipCache: true })[SESSION_KEY]?.oguiDecisions?.[
      issued.decisionId ?? ""
    ];
    expect(stored?.resumeStatus).toBe("completed");
    expect(stored?.resumeRef).toBe(issued.resumeRef);
    expect(stored?.decisionStatus).toBe("answered");
  });
});
