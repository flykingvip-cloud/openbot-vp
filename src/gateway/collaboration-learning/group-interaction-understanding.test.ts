import { expect, it, vi } from "vitest";
import { understandGroupInteraction } from "./group-interaction-understanding.js";

const calls = vi.hoisted(() => ({ understand: vi.fn(), bootstrap: vi.fn() }));
vi.mock("../../agent-runtime/wiring/interaction-turn.runtime.js", () => ({
  runGatewayUnderstanding: calls.understand,
}));
vi.mock("../../agents/bootstrap-files.js", () => ({
  resolveBootstrapContextForRun: calls.bootstrap,
}));
vi.mock("../../agents/skills.js", () => ({
  buildWorkspaceSkillSnapshot: () => ({ prompt: "Relevant skill guidance" }),
}));

it("assembles group identity, bootstrap, skills and quoted history for one governed understanding", async () => {
  calls.bootstrap.mockResolvedValue({
    contextFiles: [{ path: "MEMORY.md", content: "Group memory" }],
  });
  const result = { kind: "understood", decision: { kind: "reply", text: "30" } };
  calls.understand.mockResolvedValue(result);
  expect(
    await understandGroupInteraction({
      config: {},
      runId: "request",
      groupId: "g",
      agentId: "bot",
      sessionKey: "s",
      workspaceDir: "/tmp/authorized-group",
      provider: "p",
      model: "m",
      timeoutMs: 1000,
      identity: { gatewayClientPlatformUserId: "owner" },
      message: "100减70",
      groupContext: { title: "Group", currentTask: "reference-only" },
      history: [{ role: "user", content: "previous goal" }],
    }),
  ).toBe(result);
  expect(calls.understand).toHaveBeenCalledOnce();
  const request = calls.understand.mock.calls[0][0];
  expect(request.identity.gatewayClientPlatformUserId).toBe("owner");
  expect(request.input.message).toBe("100减70");
  expect(request.input.context).toEqual(
    expect.arrayContaining([
      { role: "system", content: "## MEMORY.md\nGroup memory" },
      { role: "system", content: "Relevant skill guidance" },
      { role: "user", content: "previous goal" },
    ]),
  );
  expect(request).not.toHaveProperty("sessionFile");
  expect(request).not.toHaveProperty("captured");
});

it("marks incomplete budgeted history as restricted and still answers an ordinary question", async () => {
  calls.bootstrap.mockResolvedValue({ contextFiles: [] });
  const result = { kind: "understood", decision: { kind: "reply", text: "4" } };
  calls.understand.mockResolvedValue(result);
  const history = [
    {
      role: "user",
      content: `${"prior-authorization-record-".repeat(40)}must-not-be-a-complete-view`,
    },
    { role: "assistant", content: "previous official conclusion" },
  ];
  expect(
    await understandGroupInteraction({
      config: {
        agents: {
          defaults: { contextBudget: { enabled: true, maxTokens: 1 } },
        },
      },
      runId: "request-budget",
      groupId: "g",
      agentId: "bot",
      sessionKey: "s",
      workspaceDir: "/tmp/authorized-group",
      provider: "p",
      model: "m",
      timeoutMs: 1000,
      identity: { gatewayClientPlatformUserId: "owner" },
      message: "2加2等于几",
      groupContext: { title: "Group" },
      history,
    }),
  ).toBe(result);
  const understandCall = calls.understand.mock.calls.at(-1);
  if (!understandCall) {
    throw new Error("expected runGatewayUnderstanding to be called");
  }
  const request = understandCall[0] as {
    input: {
      availability?: unknown;
      context: Array<{ role: string; content: string }>;
      message: string;
    };
  };
  expect(request.input.availability).toEqual({
    mode: "restricted",
    reasons: ["context_source_unavailable"],
  });
  expect(
    request.input.context.some(
      (part) =>
        part.role === "system" &&
        String(part.content).includes("not a complete authorization record"),
    ),
  ).toBe(true);
  const historyChars = request.input.context
    .filter((part) => part.role !== "system" && !String(part.content).includes('"groupId"'))
    .reduce((sum, part) => sum + part.content.length, 0);
  const sourceChars = history.reduce((sum, part) => sum + part.content.length, 0);
  expect(historyChars).toBeLessThanOrEqual(512);
  expect(historyChars).toBeLessThan(sourceChars);
  expect(request.input.message).toBe("2加2等于几");
});

it("charges group preparation against the shared interaction budget before model admission", async () => {
  vi.useFakeTimers();
  calls.understand.mockClear();
  calls.bootstrap.mockImplementationOnce(
    () => new Promise((resolve) => setTimeout(() => resolve({ contextFiles: [] }), 500)),
  );
  try {
    const pending = understandGroupInteraction({
      config: {},
      runId: "budget",
      groupId: "g",
      agentId: "bot",
      sessionKey: "s",
      workspaceDir: "/tmp/group",
      provider: "p",
      model: "m",
      timeoutMs: 100,
      identity: {},
      message: "hello",
      history: [],
      groupContext: {},
    });
    const rejected = expect(pending).rejects.toThrow("timeout");
    await vi.advanceTimersByTimeAsync(101);
    await rejected;
    expect(calls.understand).not.toHaveBeenCalled();
  } finally {
    vi.clearAllTimers();
    vi.useRealTimers();
  }
});
