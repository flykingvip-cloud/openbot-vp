import { expect, it, vi } from "vitest";
import { interpretInteraction } from "./interpret-interaction.js";

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
