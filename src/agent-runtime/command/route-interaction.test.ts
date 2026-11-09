import { expect, it, vi } from "vitest";
import { INTERACTION_PROSE_PROTOCOL_DOWNGRADE } from "../contracts/interaction.js";
import { interactionAdmissionFact, routeInteraction } from "./route-interaction.js";
const captured = { requestId: "message", expectedFocusRevision: 0, expectedWriteEpoch: 0 };
it.each(["reply", "clarify"] as const)(
  "%s bypasses execution authorization and state mutation",
  async (kind) => {
    const infer = vi.fn(async () => ({ kind, text: "你好" }));
    const authorize = vi.fn();
    const commit = vi.fn();
    expect(
      (
        await routeInteraction({ message: "你好", context: [] }, captured, {
          inference: { infer },
          admission: { authorize, commit },
        })
      ).kind,
    ).toBe("respond");
    expect(infer).toHaveBeenCalledOnce();
    expect(authorize).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  },
);
it("explicit work alone reaches admission, once", async () => {
  const infer = vi.fn(async () => ({
    kind: "execution_request",
    request: { goal: "报告", acceptance: ["来源"] },
  }));
  const authorize = vi.fn(async () => true);
  const commit = vi.fn((_input: unknown) => ({
    kind: "accepted" as const,
    binding: { taskId: "a" },
    acceptance: ["来源"],
  }));
  const result = await routeInteraction({ message: "生成报告", context: [] }, captured, {
    inference: { infer },
    admission: { authorize, commit },
  });
  expect(result.kind).toBe("execution_admission");
  expect(interactionAdmissionFact(result)).toEqual({ admitted: true, taskId: "a" });
  expect(authorize).toHaveBeenCalledOnce();
  expect(commit).toHaveBeenCalledOnce();
  expect(commit.mock.calls[0]?.[0]).toMatchObject({
    ...captured,
    proposal: { goal: "报告", acceptance: ["来源"] },
  });
});
it("records a prose downgrade without admitting work the reply claims has started", async () => {
  const text = "好的，我现在制作报告。任务已接纳，已开始。";
  const authorize = vi.fn();
  const commit = vi.fn();
  const routed = await routeInteraction({ message: "做报告", context: [] }, captured, {
    inference: {
      infer: async () => ({
        kind: "reply",
        text,
        protocolDowngrade: INTERACTION_PROSE_PROTOCOL_DOWNGRADE,
      }),
    },
    admission: { authorize, commit },
  });
  expect(interactionAdmissionFact(routed)).toEqual({
    admitted: false,
    protocolDowngrade: INTERACTION_PROSE_PROTOCOL_DOWNGRADE,
  });
  expect(authorize).not.toHaveBeenCalled();
  expect(commit).not.toHaveBeenCalled();
});

it("admits an explicit named-file delivery even when the model would stay on prose", async () => {
  const message = "请制作一份入职清单，文件名为 onboarding-checklist.md";
  const infer = vi.fn(async () => ({
    kind: "reply",
    text: "好的，我写在对话里。",
    protocolDowngrade: INTERACTION_PROSE_PROTOCOL_DOWNGRADE,
  }));
  const authorize = vi.fn(async () => true);
  const commit = vi.fn(() => ({
    kind: "accepted" as const,
    binding: { taskId: "file-task" },
    acceptance: ["交付文件 onboarding-checklist.md"],
  }));
  const routed = await routeInteraction({ message, context: [] }, captured, {
    inference: { infer },
    admission: { authorize, commit },
  });
  expect(routed.kind).toBe("execution_admission");
  expect(interactionAdmissionFact(routed)).toEqual({ admitted: true, taskId: "file-task" });
  expect(infer).not.toHaveBeenCalled();
  expect(authorize).toHaveBeenCalledOnce();
  expect(commit).toHaveBeenCalledOnce();
  expect(commit.mock.calls[0]?.[0]).toMatchObject({
    proposal: {
      goal: message,
      acceptance: ["交付文件 onboarding-checklist.md"],
    },
  });
});

it("does not admit a filename mention or a make request that names no file", async () => {
  const authorize = vi.fn();
  const commit = vi.fn();
  for (const message of ["onboarding-checklist.md 里写了什么", "请制作一份报告"]) {
    const routed = await routeInteraction({ message, context: [] }, captured, {
      inference: {
        infer: async () => ({
          kind: "reply",
          text: "好的",
          protocolDowngrade: INTERACTION_PROSE_PROTOCOL_DOWNGRADE,
        }),
      },
      admission: { authorize, commit },
    });
    expect(routed.kind).toBe("respond");
  }
  expect(authorize).not.toHaveBeenCalled();
  expect(commit).not.toHaveBeenCalled();
});

it("bound changes remain proposals rather than entering new-task admission", async () => {
  const target = { taskId: "a", revision: "1" };
  const authorize = vi.fn();
  const commit = vi.fn();
  const result = await routeInteraction(
    { message: "暂停", context: [], taskTarget: target },
    captured,
    {
      inference: { infer: async () => ({ kind: "task_control", target, action: "pause" }) },
      admission: { authorize, commit },
    },
  );
  expect(result.kind).toBe("task_proposal");
  expect(authorize).not.toHaveBeenCalled();
  expect(commit).not.toHaveBeenCalled();
});
