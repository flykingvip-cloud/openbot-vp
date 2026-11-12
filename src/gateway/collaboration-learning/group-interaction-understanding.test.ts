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
