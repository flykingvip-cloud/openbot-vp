import type { Api, Model } from "@earendil-works/pi-ai/compat";
import { beforeEach, expect, it, vi } from "vitest";
import { makeZeroUsageSnapshot } from "../../agents/usage.js";
import { interactionAdmissionFact, routeInteraction } from "../command/route-interaction.js";
import { INTERACTION_PROSE_PROTOCOL_DOWNGRADE } from "../contracts/interaction.js";
import {
  buildInteractionCompletionContext,
  invokeInteractionCompletion,
} from "./interaction-completion.js";
const mocks = vi.hoisted(() => ({ complete: vi.fn() }));
vi.mock("@earendil-works/pi-ai/compat", async (original) => ({
  ...(await original<typeof import("@earendil-works/pi-ai/compat")>()),
  complete: mocks.complete,
}));
const model = {
  id: "test",
  provider: "test",
  api: "openai-completions",
  maxTokens: 1000,
} as Model<Api>;
const request = {
  input: { message: "hello", context: [] },
  model,
  timeoutMs: 1000,
  maxTokens: 200,
};
it("forwards sanitized images only to vision candidates and discloses unseen pixels otherwise", () => {
  const image = { type: "image" as const, data: "cGl4ZWxz", mimeType: "image/png" };
  const input = { message: "看看附件", context: [], images: [image] };
  const vision = buildInteractionCompletionContext(input, { ...model, input: ["text", "image"] });
  expect(vision.messages.at(-1)?.content).toEqual([{ type: "text", text: input.message }, image]);
  const textOnly = buildInteractionCompletionContext(input, { ...model, input: ["text"] });
  expect(textOnly.messages.at(-1)?.content).toContain("pixels are unavailable");
  expect(textOnly.tools).toEqual([]);
});
beforeEach(() => {
  mocks.complete.mockReset();
});
it("recognizes individual colleagues as context without enabling tools or granting send authority", () => {
  const context = buildInteractionCompletionContext(
    {
      message: "发私信",
      context: [
        { role: "user", content: '同一主人目录：[{"displayName":"客户经理"}]' },
        { role: "user", content: "给客户经理发信息，明天十点开会" },
      ],
    },
    model,
  );
  expect(context.systemPrompt).toContain("internal digital colleague");
  expect(context.systemPrompt).toContain(
    "interaction itself sends nothing and grants no permission",
  );
  expect(context.tools).toEqual([]);
  expect(context.messages.at(-1)?.content).toBe("发私信");
});
it("keeps the host decision protocol after shared response guidance", () => {
  const context = buildInteractionCompletionContext(
    { message: "hello", context: [{ role: "system", content: "Reply naturally in plain text." }] },
    model,
  );
  expect(context.systemPrompt?.indexOf("Return one JSON object only")).toBeGreaterThan(
    context.systemPrompt?.indexOf("Reply naturally") ?? -1,
  );
});
it("preserves conversation roles and refuses to reorder late system content", () => {
  const context = buildInteractionCompletionContext(
    {
      message: "current",
      context: [
        { role: "system", content: "identity" },
        { role: "user", content: "untrusted knowledge" },
        { role: "assistant", content: "earlier answer" },
      ],
    },
    model,
  );
  expect(context.tools).toEqual([]);
  expect(context.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
  expect(context.systemPrompt).not.toContain("untrusted knowledge");
  expect(() =>
    buildInteractionCompletionContext(
      {
        message: "current",
        context: [
          { role: "user", content: "history" },
          { role: "system", content: "late" },
        ],
      },
      model,
    ),
  ).toThrow(/precede/);
});
it.each(["toolUse", "length", "error", "aborted"])(
  "does not accept a non-final %s response",
  async (stopReason) => {
    mocks.complete.mockResolvedValue({
      content: [{ type: "text", text: '{"kind":"reply","text":"ok"}' }],
      stopReason,
      usage: makeZeroUsageSnapshot(),
    });
    const result = await invokeInteractionCompletion(request);
    expect(() => result.readDecision()).toThrow(/final decision/);
    expect(mocks.complete).toHaveBeenCalledOnce();
  },
);
it("treats conversational prose as a reply instead of a JSON parse error", async () => {
  const text = "今天是 2026 年星期一。我可以帮你查日期、整理事项，并接着往下做。";
  mocks.complete.mockResolvedValue({
    content: [{ type: "text", text }],
    stopReason: "stop",
    usage: makeZeroUsageSnapshot(),
  });
  const result = await invokeInteractionCompletion({
    ...request,
    input: { message: "你好，请告诉我今天是星期几，并简短介绍你能帮我做什么。", context: [] },
  });
  expect(result.readDecision()).toEqual({
    kind: "reply",
    text,
    protocolDowngrade: INTERACTION_PROSE_PROTOCOL_DOWNGRADE,
  });
});

it("still parses a fenced JSON reply and a real execution request", async () => {
  mocks.complete.mockResolvedValue({
    content: [
      {
        type: "text",
        text: '```json\n{"kind":"reply","text":"好的"}\n```',
      },
    ],
    stopReason: "stop",
    usage: makeZeroUsageSnapshot(),
  });
  expect((await invokeInteractionCompletion(request)).readDecision()).toEqual({
    kind: "reply",
    text: "好的",
  });

  const execution = {
    kind: "execution_request",
    request: { goal: "写清单", acceptance: ["包含负责人"] },
  };
  mocks.complete.mockResolvedValue({
    content: [{ type: "text", text: JSON.stringify(execution) }],
    stopReason: "stop",
    usage: makeZeroUsageSnapshot(),
  });
  expect((await invokeInteractionCompletion(request)).readDecision()).toEqual(execution);
});

it("keeps a code fence and does not pull execution JSON out of prose", async () => {
  const code = "```python\nprint('好的，我现在制作报告')\n```";
  mocks.complete.mockResolvedValue({
    content: [{ type: "text", text: code }],
    stopReason: "stop",
    usage: makeZeroUsageSnapshot(),
  });
  expect((await invokeInteractionCompletion(request)).readDecision()).toEqual({
    kind: "reply",
    text: code,
    protocolDowngrade: INTERACTION_PROSE_PROTOCOL_DOWNGRADE,
  });

  const mixed =
    '好的，我现在制作报告\n```json\n{"kind":"execution_request","request":{"goal":"报告","acceptance":["来源"]}}\n```';
  mocks.complete.mockResolvedValue({
    content: [{ type: "text", text: mixed }],
    stopReason: "stop",
    usage: makeZeroUsageSnapshot(),
  });
  const decision = (await invokeInteractionCompletion(request)).readDecision() as {
    kind: string;
    text: string;
  };
  expect(decision.kind).toBe("reply");
  expect(decision.text).toBe(mixed);
  const authorize = vi.fn();
  const commit = vi.fn();
  const routed = await routeInteraction(
    { message: "做报告", context: [] },
    { requestId: "m1", expectedFocusRevision: 0, expectedWriteEpoch: 0 },
    { inference: { infer: async () => decision }, admission: { authorize, commit } },
  );
  expect(interactionAdmissionFact(routed)).toEqual({
    admitted: false,
    protocolDowngrade: INTERACTION_PROSE_PROTOCOL_DOWNGRADE,
  });
  expect(authorize).not.toHaveBeenCalled();
  expect(commit).not.toHaveBeenCalled();
});

it("does not treat a false-start reply as admission", async () => {
  const text = "好的，我现在制作报告。任务已接纳，已开始。";
  mocks.complete.mockResolvedValue({
    content: [{ type: "text", text }],
    stopReason: "stop",
    usage: makeZeroUsageSnapshot(),
  });
  const decision = (await invokeInteractionCompletion(request)).readDecision();
  const authorize = vi.fn(async () => true);
  const commit = vi.fn(() => ({
    kind: "accepted" as const,
    binding: { taskId: "task-should-not-run" },
    acceptance: ["来源"],
  }));
  const routed = await routeInteraction(
    { message: "做报告", context: [] },
    { requestId: "m1", expectedFocusRevision: 0, expectedWriteEpoch: 0 },
    { inference: { infer: async () => decision }, admission: { authorize, commit } },
  );
  expect(routed).toMatchObject({
    kind: "respond",
    text,
    protocolDowngrade: INTERACTION_PROSE_PROTOCOL_DOWNGRADE,
  });
  expect(interactionAdmissionFact(routed)).toEqual({
    admitted: false,
    protocolDowngrade: INTERACTION_PROSE_PROTOCOL_DOWNGRADE,
  });
  expect(authorize).not.toHaveBeenCalled();
  expect(commit).not.toHaveBeenCalled();
  expect(JSON.stringify(interactionAdmissionFact(routed))).not.toContain("task-should-not-run");
});

it("still rejects a broken JSON decision instead of showing it as a reply", async () => {
  mocks.complete.mockResolvedValue({
    content: [{ type: "text", text: '{"kind":"reply",' }],
    stopReason: "stop",
    usage: makeZeroUsageSnapshot(),
  });
  const result = await invokeInteractionCompletion(request);
  expect(() => result.readDecision()).toThrow(SyntaxError);
});

it("rejects a tool call even if the provider labels it finished", async () => {
  mocks.complete.mockResolvedValue({
    content: [{ type: "toolCall", name: "exec", arguments: {} }],
    stopReason: "stop",
    usage: makeZeroUsageSnapshot(),
  });
  const result = await invokeInteractionCompletion(request);
  expect(() => result.readDecision()).toThrow(/final decision/);
});
it("does not invoke a provider for invalid budgets or an already cancelled input", async () => {
  await expect(invokeInteractionCompletion({ ...request, maxTokens: 0 })).rejects.toThrow(
    /budgets/,
  );
  await expect(
    invokeInteractionCompletion({
      ...request,
      input: { ...request.input, abortSignal: AbortSignal.abort() },
    }),
  ).rejects.toThrow();
  expect(mocks.complete).not.toHaveBeenCalled();
});
it("bounds a provider that does not settle or honor cancellation", async () => {
  mocks.complete.mockImplementation(() => new Promise(() => {}));
  await expect(invokeInteractionCompletion({ ...request, timeoutMs: 10 })).rejects.toThrow();
  expect(mocks.complete).toHaveBeenCalledOnce();
});

it("rejects a late provider answer after cancellation during inference", async () => {
  const controller = new AbortController();
  let release!: () => void;
  mocks.complete.mockImplementation(async (_model, _context, options) => {
    expect(options.signal.aborted).toBe(false);
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return {
      content: [{ type: "text", text: '{"kind":"reply","text":"late"}' }],
      stopReason: "stop",
      usage: makeZeroUsageSnapshot(),
    };
  });
  const pending = invokeInteractionCompletion({
    ...request,
    input: { ...request.input, abortSignal: controller.signal },
  });
  controller.abort();
  release();
  await expect(pending).rejects.toThrow();
  expect(mocks.complete).toHaveBeenCalledOnce();
});

it("places semantic work-admission guidance after shared skill context", () => {
  const input = {
    message: "请制作一份面向普通员工的企业AI助手使用指南，交付Markdown与HTML，约2000字。",
    context: [{ role: "system" as const, content: "Answer conversationally; never output JSON." }],
  };
  const ctx = buildInteractionCompletionContext(input, model);
  expect(ctx.systemPrompt).toContain("A filename is not required");
  expect(ctx.systemPrompt).toContain("semantic decision");
  expect(ctx.systemPrompt!.indexOf("A filename is not required")).toBeGreaterThan(
    ctx.systemPrompt!.indexOf(input.context[0].content),
  );
  expect(ctx.tools).toEqual([]);
  expect(mocks.complete).not.toHaveBeenCalled();
});

it("requests JSON output on the compatible completion adapter without mutating its payload", async () => {
  mocks.complete.mockResolvedValue({
    content: [{ type: "text", text: '{"kind":"reply","text":"ok"}' }],
    stopReason: "stop",
    usage: makeZeroUsageSnapshot(),
  });
  await invokeInteractionCompletion(request);
  expect(mocks.complete).toHaveBeenCalledOnce();
  const options = mocks.complete.mock.calls[0]?.[2] as {
    onPayload?: (payload: unknown) => unknown;
  };
  expect(options.onPayload).toBeTypeOf("function");
  const payload = { messages: [{ role: "user", content: "hello" }], max_tokens: 200 };
  expect(options.onPayload?.(payload)).toEqual({
    ...payload,
    response_format: { type: "json_object" },
  });
  expect(payload).not.toHaveProperty("response_format");
});
it("rejects a blank final completion rather than producing an empty reply", async () => {
  mocks.complete.mockResolvedValue({
    content: [{ type: "text", text: "   " }],
    stopReason: "stop",
    usage: makeZeroUsageSnapshot(),
  });
  const result = await invokeInteractionCompletion(request);
  expect(() => result.readDecision()).toThrow();
});
