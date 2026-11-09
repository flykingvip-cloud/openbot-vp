import type { Api, Model } from "@earendil-works/pi-ai/compat";
import { beforeEach, expect, it, vi } from "vitest";
import { makeZeroUsageSnapshot } from "../../agents/usage.js";
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
