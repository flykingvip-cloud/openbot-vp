import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as preflightResolve from "../agents/execution-preflight/resolve.js";
import {
  readExecutionTraces,
  resetExecutionTraceForTest,
} from "../agents/execution-preflight/trace.js";
import { AGENT_LANE_NESTED } from "../agents/lanes.js";
import {
  INTER_AGENT_BUS_PREFLIGHT_OBSERVE_ENV,
  buildMentionMessage,
  buildOrganizationAgentSessionKey,
  buildTaskAssignmentMessage,
  interAgentBusObserveTaskId,
  isInterAgentBusPreflightObserveEnabled,
  sendAgentMention,
  sendAgentTask,
} from "./inter-agent-bus.js";
import { createTaskAssignment } from "./task-assignment.js";

const callGatewayMock = vi.hoisted(() => vi.fn());

vi.mock("../gateway/call.js", () => ({
  callGateway: (...args: unknown[]) => callGatewayMock(...args),
}));

describe("organization inter-agent bus", () => {
  beforeEach(() => {
    callGatewayMock.mockReset();
  });

  it("builds stable organization agent session keys", () => {
    expect(
      buildOrganizationAgentSessionKey({
        agentId: "bot-2",
        organizationId: "upbeyond",
      }),
    ).toBe("agent:bot-2:org:upbeyond");
  });

  it("sends task assignments to the owner agent session", async () => {
    callGatewayMock.mockResolvedValueOnce({ runId: "run-1" });
    const assignment = createTaskAssignment({
      organizationId: "upbeyond",
      title: "文章质量审核",
      ownerAgentId: "bot-2",
      createdByAgentId: "main",
      now: "2026-05-11T00:00:00.000Z",
    });

    const result = await sendAgentTask({
      assignment,
      sourceAgentId: "main",
      sourceSessionKey: "agent:main:main:space:upbeyond",
    });

    expect(result).toMatchObject({
      status: "accepted",
      runId: "run-1",
      targetSessionKey: "agent:bot-2:org:upbeyond",
    });
    expect(callGatewayMock).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "agent",
        params: expect.objectContaining({
          sessionKey: "agent:bot-2:org:upbeyond",
          message: expect.stringContaining("Task ID:"),
          deliver: false,
          channel: "webchat",
          inputProvenance: expect.objectContaining({
            sourceTool: "organization_tasks",
          }),
        }),
      }),
    );
  });

  it("formats an acknowledgement instruction into task messages", () => {
    const assignment = createTaskAssignment({
      organizationId: "upbeyond",
      title: "文章质量审核",
      ownerAgentId: "bot-2",
      createdByAgentId: "main",
      now: "2026-05-11T00:00:00.000Z",
    });

    expect(buildTaskAssignmentMessage(assignment)).toContain(
      'organization_tasks(action="accept", taskId="<Task ID>")',
    );
  });

  it("sends mention messages to the target agent session", async () => {
    callGatewayMock.mockResolvedValueOnce({ runId: "run-mention-1" });

    const result = await sendAgentMention({
      messageId: "message-1",
      messageText: "hello @Agent B",
      mentions: [
        {
          mention_id: "mention-1",
          agentId: "agent-b",
          displayName: "Agent B",
          offset: 6,
          length: 8,
        },
      ],
      mentionContext: {
        isMentioned: true,
        mentionType: "direct",
        mentionSourceAgentId: "agent-a",
        coordinatorVisible: true,
        mentionIds: ["mention-1"],
      },
      sourceAgentId: "agent-a",
      targetAgentId: "agent-b",
      organizationId: "upbeyond",
    });

    expect(result).toMatchObject({
      status: "accepted",
      runId: "run-mention-1",
      targetSessionKey: "agent:agent-b:org:upbeyond",
    });
    expect(callGatewayMock).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "agent",
        params: expect.objectContaining({
          sessionKey: "agent:agent-b:org:upbeyond",
          message: expect.stringContaining("Organization mention:"),
          deliver: false,
          channel: "webchat",
          inputProvenance: expect.objectContaining({
            sourceTool: "organization_mentions",
          }),
        }),
      }),
    );
  });

  it("formats mention context into mention messages", () => {
    expect(
      buildMentionMessage({
        messageId: "message-1",
        messageText: "hello @Agent B",
        mentions: [
          {
            mention_id: "mention-1",
            agentId: "agent-b",
            displayName: "Agent B",
            offset: 6,
            length: 8,
          },
        ],
        mentionContext: {
          isMentioned: true,
          mentionType: "direct",
          coordinatorVisible: true,
          mentionIds: ["mention-1"],
        },
        sourceAgentId: "agent-a",
        organizationId: "upbeyond",
      }),
    ).toContain("Mention IDs: mention-1");
  });
});

function taskAssignment() {
  return createTaskAssignment({
    organizationId: "upbeyond",
    title: "文章质量审核",
    ownerAgentId: "bot-2",
    createdByAgentId: "main",
    now: "2026-05-11T00:00:00.000Z",
  });
}

const mentionParams = {
  messageId: "message-1",
  messageText: "hello @Agent B",
  mentions: [
    {
      mention_id: "mention-1",
      agentId: "agent-b",
      displayName: "Agent B",
      offset: 6,
      length: 8,
    },
  ],
  mentionContext: {
    isMentioned: true,
    mentionType: "direct" as const,
    mentionSourceAgentId: "agent-a",
    coordinatorVisible: true,
    mentionIds: ["mention-1"],
  },
  sourceAgentId: "agent-a",
  targetAgentId: "agent-b",
  organizationId: "upbeyond",
};

describe("inter-agent bus preflight observe", () => {
  const taskSessionKey = "agent:bot-2:org:upbeyond";
  const mentionSessionKey = "agent:agent-b:org:upbeyond";

  beforeEach(() => {
    callGatewayMock.mockReset();
    delete process.env[INTER_AGENT_BUS_PREFLIGHT_OBSERVE_ENV];
    resetExecutionTraceForTest();
  });

  afterEach(() => {
    delete process.env[INTER_AGENT_BUS_PREFLIGHT_OBSERVE_ENV];
    resetExecutionTraceForTest();
  });

  it("keeps dispatch unchanged when preflight observe is off", async () => {
    expect(isInterAgentBusPreflightObserveEnabled({})).toBe(false);
    for (const value of ["0", "false", "no", "off", ""]) {
      expect(
        isInterAgentBusPreflightObserveEnabled({
          [INTER_AGENT_BUS_PREFLIGHT_OBSERVE_ENV]: value,
        }),
      ).toBe(false);
    }
    callGatewayMock.mockResolvedValueOnce({ runId: "run-off" });
    const spy = vi.spyOn(preflightResolve, "buildExecutionPreflight");
    try {
      const result = await sendAgentTask({
        assignment: taskAssignment(),
        sourceAgentId: "main",
        sourceSessionKey: "agent:main:main:space:upbeyond",
      });
      expect(result).toEqual({
        status: "accepted",
        runId: "run-off",
        targetSessionKey: taskSessionKey,
      });
      expect(callGatewayMock).toHaveBeenCalledTimes(1);
      expect(spy).not.toHaveBeenCalled();
      expect(readExecutionTraces(interAgentBusObserveTaskId("task", taskSessionKey))).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });

  it("records a preflight trace when observe is on without changing the dispatch", async () => {
    for (const value of ["1", "true", "yes", "on"]) {
      expect(
        isInterAgentBusPreflightObserveEnabled({
          [INTER_AGENT_BUS_PREFLIGHT_OBSERVE_ENV]: value,
        }),
      ).toBe(true);
    }
    process.env[INTER_AGENT_BUS_PREFLIGHT_OBSERVE_ENV] = "1";
    callGatewayMock.mockResolvedValueOnce({ runId: "run-task" });
    callGatewayMock.mockResolvedValueOnce({ runId: "run-mention" });
    const spy = vi.spyOn(preflightResolve, "buildExecutionPreflight");
    try {
      const taskResult = await sendAgentTask({
        assignment: taskAssignment(),
        sourceAgentId: "main",
      });
      const mentionResult = await sendAgentMention(mentionParams);
      const taskId = interAgentBusObserveTaskId("task", taskSessionKey);
      const mentionId = interAgentBusObserveTaskId("mention", mentionSessionKey);
      expect(taskResult).toEqual({
        status: "accepted",
        runId: "run-task",
        targetSessionKey: taskSessionKey,
      });
      expect(mentionResult).toEqual({
        status: "accepted",
        runId: "run-mention",
        targetSessionKey: mentionSessionKey,
      });
      expect(spy).toHaveBeenCalledTimes(2);
      expect(spy).toHaveBeenNthCalledWith(1, {
        taskId,
        sessionId: taskSessionKey,
        message: `task lane=${AGENT_LANE_NESTED} source=organization_tasks`,
        skills: [],
        policyToolNames: [],
        catalogToolNames: [],
        resourceScope: ["kind:task", `lane:${AGENT_LANE_NESTED}`, "source:organization_tasks"],
      });
      expect(spy).toHaveBeenNthCalledWith(2, {
        taskId: mentionId,
        sessionId: mentionSessionKey,
        message: `mention lane=${AGENT_LANE_NESTED} source=organization_mentions`,
        skills: [],
        policyToolNames: [],
        catalogToolNames: [],
        resourceScope: [
          "kind:mention",
          `lane:${AGENT_LANE_NESTED}`,
          "source:organization_mentions",
        ],
      });
      for (const id of [taskId, mentionId]) {
        const traces = readExecutionTraces(id);
        expect(traces.some((row) => row.decisionStage === "preflight")).toBe(true);
        expect(traces.every((row) => row.decisionStage === "preflight")).toBe(true);
        expect(traces[0]?.decisionCode).toBe("no_skill_contract");
      }
      expect(callGatewayMock).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          method: "agent",
          params: expect.objectContaining({
            sessionKey: taskSessionKey,
            lane: AGENT_LANE_NESTED,
            deliver: false,
          }),
        }),
      );
    } finally {
      spy.mockRestore();
    }
  });

  it("discards a denying preflight allow set and still returns the gateway result", async () => {
    process.env[INTER_AGENT_BUS_PREFLIGHT_OBSERVE_ENV] = "1";
    callGatewayMock.mockResolvedValueOnce({ runId: "run-deny" });
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
      const assignment = taskAssignment();
      const result = await sendAgentTask({
        assignment,
        sourceAgentId: "main",
        sourceSessionKey: "agent:main:main:space:upbeyond",
      });
      expect(result).toEqual({
        status: "accepted",
        runId: "run-deny",
        targetSessionKey: taskSessionKey,
      });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(observedAllow).toEqual([]);
      expect(callGatewayMock).toHaveBeenCalledTimes(1);
      const gatewayCall = callGatewayMock.mock.calls[0]?.[0] as {
        method?: string;
        params?: { message?: string; sessionKey?: string; lane?: string };
      };
      expect(gatewayCall.method).toBe("agent");
      expect(gatewayCall.params?.sessionKey).toBe(taskSessionKey);
      expect(gatewayCall.params?.lane).toBe(AGENT_LANE_NESTED);
      expect(gatewayCall.params?.message).toBe(buildTaskAssignmentMessage(assignment));
      expect(JSON.stringify(gatewayCall.params)).not.toContain("exec");
      expect(JSON.stringify(gatewayCall.params)).not.toContain('"read"');
    } finally {
      spy.mockRestore();
    }
  });

  it("keeps a gateway error when observe is on", async () => {
    process.env[INTER_AGENT_BUS_PREFLIGHT_OBSERVE_ENV] = "1";
    callGatewayMock.mockRejectedValueOnce(new Error("gateway down"));
    const spy = vi.spyOn(preflightResolve, "buildExecutionPreflight");
    try {
      const result = await sendAgentMention(mentionParams);
      expect(result).toEqual({
        status: "error",
        targetSessionKey: mentionSessionKey,
        error: "gateway down",
      });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(callGatewayMock).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  it("swallows observe failures without flipping an accepted dispatch", async () => {
    process.env[INTER_AGENT_BUS_PREFLIGHT_OBSERVE_ENV] = "1";
    callGatewayMock.mockResolvedValueOnce({ runId: "run-boom" });
    const spy = vi.spyOn(preflightResolve, "buildExecutionPreflight").mockImplementation(() => {
      throw new Error("observe boom");
    });
    try {
      const result = await sendAgentTask({
        assignment: taskAssignment(),
        sourceAgentId: "main",
      });
      expect(result).toEqual({
        status: "accepted",
        runId: "run-boom",
        targetSessionKey: taskSessionKey,
      });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(callGatewayMock).toHaveBeenCalledTimes(1);
      expect(readExecutionTraces(interAgentBusObserveTaskId("task", taskSessionKey))).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });

  it("does not enforce preflight on the inter-agent bus path", () => {
    const source = readFileSync(new URL("./inter-agent-bus.ts", import.meta.url), "utf8");
    expect(source).toContain("buildExecutionPreflight");
    expect(source).toContain("OPENBOT_INTER_AGENT_BUS_PREFLIGHT_OBSERVE");
    expect(source).not.toContain("applyPreflightToTools");
    expect(source).not.toContain("armCompletionHold");
    expect(source).not.toContain("allowedTools");
    expect(source).not.toContain("ORCHESTRATION_LIVE_INVOKE");
  });
});
