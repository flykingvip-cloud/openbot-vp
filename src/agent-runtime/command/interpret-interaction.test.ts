import { expect, it, vi } from "vitest";
import { UNBOUND_TASK_TARGET_CLARIFY } from "./host-task-target.js";
import {
  interpretInteraction,
  InteractionDecisionValidationError,
} from "./interpret-interaction.js";

it.each(["turn", "long_task"] as const)(
  "preserves the planned %s lifecycle without granting admission",
  async (lifecycle) => {
    const decision = {
      kind: "execution_request",
      request: { lifecycle, goal: "Work", acceptance: ["Result"] },
    };
    expect(
      await interpretInteraction({ message: "Work", context: [] }, { infer: async () => decision }),
    ).toEqual(decision);
  },
);
it("refuses an unsupported lifecycle rather than silently building a task", async () => {
  await expect(
    interpretInteraction(
      { message: "Work", context: [] },
      {
        infer: async () => ({
          kind: "execution_request",
          request: { lifecycle: "auto", goal: "Work", acceptance: ["Result"] },
        }),
      },
    ),
  ).rejects.toThrow(/Invalid interaction/);
});

it("retains fail-closed diagnostics without model body, arbitrary keys or target identities", async () => {
  const infer = vi.fn(async () => ({
    kind: "send_message",
    text: "PRIVATE BODY",
    private_key: "SECRET",
  }));
  const error = await interpretInteraction({ message: "send", context: [] }, { infer }).catch(
    (e) => e,
  );
  expect(error).toBeInstanceOf(InteractionDecisionValidationError);
  expect(error.shape).toMatchObject({
    kind: "unsupported",
    fields: { kind: "string", text: "string" },
    unknownFieldCount: 1,
  });
  expect(JSON.stringify(error.shape)).not.toMatch(/PRIVATE|SECRET|private_key|send_message/);
  expect(infer).toHaveBeenCalledOnce();
});

it("preserves declarative checks and refuses executable acceptance fields", async () => {
  const check = {
    criterion: 0,
    validator: "artifact.text.exact.v1",
    artifact: "result.txt",
    expected: "EXACT",
  };
  const proposal = {
    kind: "execution_request",
    request: { goal: "Create result.txt", acceptance: ["Exact bytes"], checks: [check] },
  };
  expect(
    await interpretInteraction(
      { message: "Create result.txt", context: [] },
      { infer: async () => proposal },
    ),
  ).toEqual(proposal);
  await expect(
    interpretInteraction(
      { message: "Create result.txt", context: [] },
      {
        infer: async () => ({
          ...proposal,
          request: { ...proposal.request, checks: [{ ...check, script: "execute()" }] },
        }),
      },
    ),
  ).rejects.toThrow(/Invalid interaction acceptance checks/);
});

it.each(["supplement", "revise", "replace_all"])(
  "preserves the explicit amendment scope %s",
  async (mode) => {
    const target = { taskId: "a", revision: "2" };
    const decision = { kind: "task_change", target, text: "要求更新", mode };
    expect(
      await interpretInteraction(
        { message: "要求更新", context: [], taskTarget: target },
        { infer: async () => decision },
      ),
    ).toEqual(decision);
  },
);

it.each(["task_change", "task_control"] as const)(
  "preserves a mixed question and bound %s in one inference",
  async (kind) => {
    const target = { taskId: "a", revision: "2" };
    const decision =
      kind === "task_change"
        ? { kind, target, text: "改为三页", answer: "任务板最近记录为未完成。" }
        : { kind, target, action: "pause", answer: "任务板最近记录为未完成。" };
    const infer = vi.fn(async () => decision);
    expect(
      await interpretInteraction(
        { message: "进度怎样，报告改为三页", context: [], taskTarget: target },
        { infer },
      ),
    ).toEqual(decision);
    expect(infer).toHaveBeenCalledOnce();
    await expect(
      interpretInteraction(
        { message: "update", context: [], taskTarget: { ...target, revision: "3" } },
        { infer },
      ),
    ).rejects.toThrow(/not bound/);
  },
);
it.each([null, 1, " "])("rejects malformed mixed answer %j", async (answer) => {
  const target = { taskId: "a", revision: "2" };
  await expect(
    interpretInteraction(
      { message: "update", context: [], taskTarget: target },
      { infer: async () => ({ kind: "task_change", target, text: "三页", answer }) },
    ),
  ).rejects.toThrow(/Invalid interaction answer/);
});

it("answers with one inference and preserves authorized context roles", async () => {
  const input = {
    message: "你好",
    context: [
      { role: "system" as const, content: "identity" },
      { role: "user" as const, content: "untrusted knowledge" },
      { role: "assistant" as const, content: "previous answer" },
    ],
  };
  const infer = vi.fn(async () => ({ kind: "reply", text: "你好" }));
  expect(await interpretInteraction(input, { infer })).toEqual({ kind: "reply", text: "你好" });
  expect(infer).toHaveBeenCalledExactlyOnceWith(input);
});
it("returns an execution proposal without executing or looping", async () => {
  const proposal = {
    kind: "execution_request",
    request: { goal: "生成报告", acceptance: ["包含可核验来源"] },
  };
  const infer = vi.fn(async () => proposal);
  expect(await interpretInteraction({ message: "生成报告", context: [] }, { infer })).toEqual(
    proposal,
  );
  expect(infer).toHaveBeenCalledOnce();
});
it.each([
  null,
  { kind: "reply", text: " " },
  { kind: "execution_request", request: { goal: "run", acceptance: [] } },
  { kind: "reply", text: "ok", script: "execute" },
  { kind: "execution_request", request: { goal: "run", acceptance: ["done"], tools: ["exec"] } },
])("rejects invalid or executable decision payload: %j", async (proposal) => {
  await expect(
    interpretInteraction({ message: "test", context: [] }, { infer: async () => proposal }),
  ).rejects.toThrow(/Invalid interaction/);
});
it("does not call inference after cancellation", async () => {
  const infer = vi.fn();
  await expect(
    interpretInteraction(
      { message: "test", context: [], abortSignal: AbortSignal.abort() },
      { infer },
    ),
  ).rejects.toThrow();
  expect(infer).not.toHaveBeenCalled();
});
it("rejects late output after cancellation without another inference", async () => {
  const controller = new AbortController();
  const infer = vi.fn(async () => {
    controller.abort();
    return { kind: "reply", text: "late" };
  });
  await expect(
    interpretInteraction(
      { message: "test", context: [], abortSignal: controller.signal },
      { infer },
    ),
  ).rejects.toThrow();
  expect(infer).toHaveBeenCalledOnce();
});

it.each(["task_change", "task_control"] as const)(
  "binds %s proposals to the captured task revision",
  async (kind) => {
    const target = { taskId: "task-a", revision: "epoch-1" };
    const decision =
      kind === "task_change"
        ? { kind, target, text: "仅用公开资料" }
        : { kind, target, action: "pause" };
    const infer = vi.fn(async () => decision);
    expect(
      await interpretInteraction({ message: "update", context: [], taskTarget: target }, { infer }),
    ).toEqual(decision);
    expect(await interpretInteraction({ message: "update", context: [] }, { infer })).toEqual({
      kind: "clarify",
      text: UNBOUND_TASK_TARGET_CLARIFY,
    });
    await expect(
      interpretInteraction(
        { message: "update", context: [], taskTarget: { ...target, revision: "epoch-2" } },
        { infer },
      ),
    ).rejects.toThrow(/not bound/);
  },
);
