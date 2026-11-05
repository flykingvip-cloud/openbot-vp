import { expect, it, vi } from "vitest";
import { routeInteraction } from "./route-interaction.js";
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
  expect(authorize).toHaveBeenCalledOnce();
  expect(commit).toHaveBeenCalledOnce();
  expect(commit.mock.calls[0]?.[0]).toMatchObject({
    ...captured,
    proposal: { goal: "报告", acceptance: ["来源"] },
  });
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
