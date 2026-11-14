import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { describe, expect, it } from "vitest";
import {
  createContextCompileState,
  installContextCompilerTransform,
  simulatePiModelBoundary,
  wrapContextCompilerModelBoundary,
} from "../../agent-runtime/capabilities/index.js";
import { compileModelContext } from "./compile.js";

function user(text: string): AgentMessage {
  return { role: "user", content: text, timestamp: Date.now() } as AgentMessage;
}

function assistant(text: string): AgentMessage {
  return { role: "assistant", content: text, timestamp: Date.now() } as unknown as AgentMessage;
}

function history(count: number): AgentMessage[] {
  const messages: AgentMessage[] = [];
  for (let i = 0; i < count; i += 1) {
    messages.push(user(`old-${i}`));
    messages.push(assistant(`reply-${i}`));
  }
  messages.push(user("current"));
  return messages;
}

describe("model-boundary probe (P0-0)", () => {
  it("documents that streamFn context.messages is the provider request", async () => {
    const source = history(20);
    const compiled = compileModelContext({ messages: source, lane: "chat" });
    const { providerMessages } = await simulatePiModelBoundary({
      messages: source,
      transformContext: async (messages) =>
        compileModelContext({ messages, lane: "chat" }).messages,
    });

    expect(compiled.telemetry.preCompileMessageCount).toBe(source.length);
    expect(providerMessages).toHaveLength(compiled.messages.length);
    expect(providerMessages).toEqual(compiled.messages);
    expect(providerMessages.some((message) => message === source[0])).toBe(false);
    expect(providerMessages.some((message) => message === source.at(-1))).toBe(true);
  });

  it("fail-closes if a later streamFn still sees the full transcript", async () => {
    const source = history(80);
    const state = createContextCompileState();
    const compiled = compileModelContext({ messages: source, lane: "chat" });
    state.lastTelemetry = compiled.telemetry;
    state.lastCompiledCount = compiled.telemetry.postCompileMessageCount;

    let captured = 0;
    const inner = ((_model: unknown, context: { messages?: unknown[] }) => {
      captured = Array.isArray(context.messages) ? context.messages.length : 0;
      return {
        async *[Symbol.asyncIterator]() {
          yield { type: "done" };
        },
        result: async () => ({ role: "assistant", content: [], timestamp: Date.now() }),
      };
    }) as never;

    const wrapped = wrapContextCompilerModelBoundary({ streamFn: inner, state });
    await wrapped({} as never, { messages: source } as never, {});
    expect(captured).toBe(compiled.telemetry.postCompileMessageCount);
    expect(state.lastTelemetry?.providerBoundaryMatch).toBe(false);
  });

  it("installs transformContext as the compile authority without mutating source", async () => {
    const source = history(40);
    const agent: { transformContext?: (messages: AgentMessage[]) => Promise<AgentMessage[]> } = {};
    const state = createContextCompileState();
    installContextCompilerTransform({
      agent,
      state,
      lane: "chat",
      candidates: { userProfile: [], task: "", memory: "", evidence: "" },
    });
    const transformed = await agent.transformContext?.(source);
    expect(transformed?.length).toBeLessThan(source.length);
    expect(source.length).toBe(81);
    expect(state.lastTelemetry?.preCompileMessageCount).toBe(81);
    expect(state.lastTelemetry?.recallSafety.currentTurnPreserved).toBe(true);
  });
});
