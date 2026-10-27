/**
 * Product wiring after #128 merge: auto-advance trigger, force readiness,
 * and chat DELIVERABLE → submitTeamDeliverable helper.
 * Not F4: does not claim autonomous browser loop or 18789 cutover.
 */
import { describe, expect, it, vi } from "vitest";
import { maybeSubmitTeamDeliverableFromChatFinal } from "./chat-deliverable-team-submit.js";
import { precheckDispatchReadiness } from "./dispatch-readiness-precheck.js";

vi.mock("./team-deliverable-submit.js", () => ({
  submitTeamDeliverable: vi.fn(async (params: Record<string, unknown>) => ({
    ok: true,
    deliverableId: "deliv-mock",
    relativePath: params.relativePath,
    groupId: params.groupId,
    taskId: params.taskId,
  })),
}));

describe("product wiring — deliverable helper", () => {
  it("skips without group/task/agent", async () => {
    const r = await maybeSubmitTeamDeliverableFromChatFinal({
      text: '<<DELIVERABLE file="a.md">>\nbody\n<</DELIVERABLE>>',
      agentId: "bot-a",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("group_task_or_agent_required");
    }
  });

  it("skips non-deliverable text", async () => {
    const r = await maybeSubmitTeamDeliverableFromChatFinal({
      text: "普通回复",
      groupId: "g1",
      taskId: "t1",
      agentId: "bot-a",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("no_deliverable_envelope");
    }
  });

  it("routes DELIVERABLE envelope through submitTeamDeliverable", async () => {
    const { submitTeamDeliverable } = await import("./team-deliverable-submit.js");
    const text = '<<DELIVERABLE title="成果A" file="notes/out.md">>\n正文内容\n<</DELIVERABLE>>';
    const r = await maybeSubmitTeamDeliverableFromChatFinal({
      text,
      groupId: "g1",
      taskId: "t1",
      agentId: "bot-a",
    });
    expect(r.ok).toBe(true);
    expect(submitTeamDeliverable).toHaveBeenCalled();
    const call = vi.mocked(submitTeamDeliverable).mock.calls.at(-1)?.[0] as {
      groupId: string;
      taskId: string;
      actor: string;
      content: string;
      relativePath: string;
    };
    expect(call.groupId).toBe("g1");
    expect(call.taskId).toBe("t1");
    expect(call.actor).toBe("bot-a");
    expect(call.relativePath).toContain("deliverables/");
    expect(call.content).toContain("正文内容");
  });
});

describe("product wiring — readiness precheck still forced API", () => {
  it("rejects unregistered members", async () => {
    const r = await precheckDispatchReadiness({
      memberIds: ["ghost"],
      resolveMember: (memberId) => ({
        memberId,
        agentId: null,
        displayName: null,
        registration: "not_registered",
        sessionKey: null,
      }),
    });
    expect(r.allDispatchable).toBe(false);
  });
});
