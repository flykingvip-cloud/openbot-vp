import type { Api, Model } from "@earendil-works/pi-ai/compat";
import AjvPkg from "ajv";
import { expect, it, vi } from "vitest";
import { invokeInteractionCompletion } from "./index.js";

const mocks = vi.hoisted(() => ({ complete: vi.fn() }));
vi.mock("@earendil-works/pi-ai/compat", async (original) => ({
  ...(await original<typeof import("@earendil-works/pi-ai/compat")>()),
  complete: mocks.complete,
}));
const Ajv = AjvPkg.default ?? AjvPkg;

it("native transport schema matches the host decision contract through the public model entry", async () => {
  let schema: object | undefined;
  mocks.complete.mockImplementation(async (_model, _context, options) => {
    const payload = options.onPayload({});
    schema = payload.tools[0].function.parameters;
    return { stopReason: "stop", content: [], usage: { output: 0 } };
  });
  await invokeInteractionCompletion({
    input: { message: "hello", context: [] },
    model: {
      id: "deepseek-v4-flash",
      provider: "api-proxy-deepseek",
      api: "openai-completions",
      maxTokens: 1000,
    } as Model<Api>,
    timeoutMs: 1000,
    maxTokens: 200,
  });
  expect(schema).toBeDefined();
  const validate = new Ajv({ strict: false }).compile(schema!);
  expect(
    validate({
      kind: "execution_request",
      text: "现在执行",
      request: { lifecycle: "long_task", goal: "报告", acceptance: ["可核对"] },
    }),
  ).toBe(false);
  for (const value of [
    { kind: "reply" },
    { kind: "execution_request" },
    { kind: "task_control", text: "停了" },
  ]) {
    expect(validate(value)).toBe(false);
  }
  for (const value of [
    { kind: "reply", text: "你好" },
    {
      kind: "execution_request",
      request: { lifecycle: "long_task", goal: "报告", acceptance: ["核验"] },
    },
    { kind: "task_control", target: { taskId: "t", revision: "1" }, action: "cancel" },
  ]) {
    expect(validate(value)).toBe(true);
  }
});
