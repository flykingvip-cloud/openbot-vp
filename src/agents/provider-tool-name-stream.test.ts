import type { StreamFn } from "@earendil-works/pi-agent-core";
import { describe, expect, it } from "vitest";
import { wrapStreamFnSanitizeProviderToolNames } from "./provider-tool-name-stream.js";

function eventStream(name: string) {
  const message = {
    role: "assistant",
    content: [{ type: "toolCall", name, arguments: {} }],
  };
  return {
    result: async () => message,
    async *[Symbol.asyncIterator]() {
      yield { type: "done", message, partial: message };
    },
  };
}

describe("wrapStreamFnSanitizeProviderToolNames", () => {
  it("scrubs a late onPayload mutation and restores the registered tool name", async () => {
    let sentName = "";
    const base: StreamFn = (model, context, options) => {
      const payload = {
        tools: (context.tools ?? []).map((tool) => ({
          type: "function",
          function: { name: tool.name },
        })),
      };
      return (async () => {
        const next = await options?.onPayload?.(payload, model as never);
        const sent = (next ?? payload) as typeof payload;
        sentName = sent.tools[0]?.function.name ?? "";
        return eventStream(sentName);
      })() as unknown as ReturnType<StreamFn>;
    };
    const wrapped = wrapStreamFnSanitizeProviderToolNames(base);
    const registered = { name: "local_file.stat", description: "stat" };
    const stream = await wrapped(
      { id: "m", api: "openai-completions", provider: "deepseek" } as never,
      { tools: [registered] } as never,
      {
        onPayload: (payload) => {
          const record = payload as {
            tools: Array<{ function: { name: string } }>;
          };
          record.tools[0].function.name = "local_file.stat";
          return record;
        },
      },
    );
    expect(sentName).toMatch(/^[a-zA-Z0-9_-]+$/);
    expect(sentName).toBe("local_file_stat");
    expect(registered.name).toBe("local_file.stat");
    const done = await stream.result();
    expect((done.content[0] as { name?: string } | undefined)?.name).toBe("local_file.stat");
    const iterator = stream[Symbol.asyncIterator]();
    const event = await iterator.next();
    const value = event.value as {
      message: { content: Array<{ name: string }> };
      partial: { content: Array<{ name: string }> };
    };
    expect(value.message.content[0]?.name).toBe("local_file.stat");
    expect(value.partial.content[0]?.name).toBe("local_file.stat");
  });
});
