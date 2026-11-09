import { beforeEach, describe, expect, test, vi } from "vitest";
import { memberSpeakingGate, resolveMemberAdmission } from "./member-admission.js";
import type { RuntimeAuthority } from "./runtime-authority.js";
const mocks = vi.hoisted(() => ({ binding: vi.fn(), board: vi.fn(), plan: vi.fn() }));
vi.mock("../collaboration-learning/try-build-chat-actor-deliverable-binding.js", () => ({
  tryBuildChatActorExecutionDeliverableBinding: mocks.binding,
}));
vi.mock("./claim-contract.js", () => ({ loadBoardClaimItem: mocks.board }));
vi.mock("./plan-gate-exec.js", () => ({ evaluateDeliveryExecGateForBoardItem: mocks.plan }));
vi.mock("../collaboration-learning/team-resource-auth.js", () => ({
  resolveStoresFromGroupLocator: () => ({ ok: true, fileStore: {}, objectStorage: {} }),
}));
vi.mock("../collaboration-learning/task-stop-entry.js", () => ({
  assertPersistedTaskNotStopped: async () => ({ taskId: "t" }),
}));
vi.mock("./task-dispatch-auth-recheck.js", () => ({
  recheckCurrentDispatchAuthorization: async () => ({ ok: true }),
}));
const authority = { namespace: { groupLocator: "/test/group" } } as RuntimeAuthority;
const input = { authority, agentId: "a", runId: "r:a", executionRequested: true };
beforeEach(() => vi.resetAllMocks());
describe("separate speaking and formal execution admission", () => {
  test("role/request alone cannot bypass speaking limits", async () => {
    mocks.binding.mockResolvedValue(null);
    const admission = await resolveMemberAdmission(input);
    expect(admission).toEqual({ purpose: "blocked", reason: "formal_claim_required" });
    expect(memberSpeakingGate(admission, false).allowed).toBe(false);
  });
  test("unconfirmed plan blocks even with a current claim", async () => {
    mocks.binding.mockResolvedValue({ taskId: "t", boardItemId: "b" });
    mocks.board.mockResolvedValue({ itemId: "b" });
    mocks.plan.mockResolvedValue({ mode: "plan_nudge", reason: "plan_unconfirmed" });
    expect(await resolveMemberAdmission(input)).toEqual({
      purpose: "blocked",
      reason: "plan_unconfirmed",
    });
  });
  test("formal execution uses existing plan gate and ignores only speaking slots", async () => {
    const binding = { taskId: "t", boardItemId: "b" };
    const taskBag = { planGate: { confirmed: true } };
    mocks.binding.mockResolvedValue(binding);
    mocks.board.mockResolvedValue({ itemId: "b" });
    mocks.plan.mockResolvedValue({ mode: "delivery_exec", taskBag });
    const admission = await resolveMemberAdmission(input);
    expect(admission).toEqual({ purpose: "formal_execution", binding, taskBag });
    expect(memberSpeakingGate(admission, true).allowed).toBe(true);
    expect(mocks.plan).toHaveBeenCalledWith(authority, {
      boardItem: { itemId: "b" },
      ownerMemberId: "a",
    });
    mocks.binding.mockResolvedValue(null);
    expect((await resolveMemberAdmission(input)).purpose).toBe("blocked");
  });
  test("discussion retains its own limit and does not infer work from a role", async () => {
    const admission = await resolveMemberAdmission({ ...input, executionRequested: false });
    expect(memberSpeakingGate(admission, true)).toEqual({
      allowed: false,
      reason: "visible_limit",
    });
    expect(mocks.binding).not.toHaveBeenCalled();
  });
});
