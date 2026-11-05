/** One provider response; authorization, accounting and persistence stay with its caller. */
import { complete, type Api, type Context, type Model } from "@earendil-works/pi-ai/compat";
import { makeZeroUsageSnapshot } from "../../agents/usage.js";
import { withTimeout } from "../../utils/with-timeout.js";
import type { InteractionModelInput } from "../contracts/interaction.js";

const PROTOCOL = [
  "Understand the current user message using the supplied identity, conversation, memory and knowledge.",
  "Return one JSON object only. Never call tools or claim that a proposed action has executed.",
  'Use {"kind":"reply","text":"..."} to answer directly, or kind=clarify with text for missing information.',
  'For work use {"kind":"execution_request","request":{"goal":"...","acceptance":["..."]}}.',
  "For task changes use kind=task_change, target={taskId,revision}, and text. For controls use kind=task_control, the same target, and action=pause|cancel|resume.",
  "Only the host-bound task target is valid. A new message does not complete or replace an existing task.",
].join("\n");

export function buildInteractionCompletionContext(
  input: InteractionModelInput,
  model: Model<Api>,
): Context {
  const system = [PROTOCOL];
  const messages: Context["messages"] = [];
  let historyStarted = false;
  for (const part of input.context) {
    if (part.role === "system") {
      if (historyStarted) {
        throw new Error("System context must precede conversation history");
      }
      system.push(part.content);
    } else {
      historyStarted = true;
      if (part.role === "user") {
        messages.push({ role: "user", content: part.content, timestamp: 0 });
      } else {
        messages.push({
          role: "assistant",
          content: [{ type: "text", text: part.content }],
          api: model.api,
          provider: model.provider,
          model: model.id,
          usage: makeZeroUsageSnapshot(),
          stopReason: "stop",
          timestamp: 0,
        });
      }
    }
  }
  system.push(`Host-bound task target: ${JSON.stringify(input.taskTarget ?? null)}`);
  messages.push({ role: "user", content: input.message, timestamp: Date.now() });
  return { systemPrompt: system.join("\n\n"), messages, tools: [] };
}

/** Fixed provider adapter. No runner, task board, hooks, scheduling or history writes. */
export async function invokeInteractionCompletion(params: {
  input: InteractionModelInput;
  model: Model<Api>;
  apiKey?: string;
  timeoutMs: number;
  maxTokens: number;
}) {
  if (
    !Number.isFinite(params.timeoutMs) ||
    params.timeoutMs <= 0 ||
    !Number.isFinite(params.maxTokens) ||
    params.maxTokens <= 0
  ) {
    throw new Error("Interaction requires finite positive budgets");
  }
  params.input.abortSignal?.throwIfAborted();
  const timeoutMs = Math.max(1, Math.floor(params.timeoutMs));
  const signal = params.input.abortSignal
    ? AbortSignal.any([params.input.abortSignal, AbortSignal.timeout(timeoutMs)])
    : AbortSignal.timeout(timeoutMs);
  const response = await withTimeout(
    complete(params.model, buildInteractionCompletionContext(params.input, params.model), {
      ...(params.apiKey ? { apiKey: params.apiKey } : {}),
      signal,
      timeoutMs,
      maxTokens: Math.max(1, Math.floor(Math.min(params.maxTokens, params.model.maxTokens))),
    }),
    timeoutMs,
  );
  signal.throwIfAborted();
  return {
    response,
    readDecision() {
      if (
        response.stopReason !== "stop" ||
        response.content.some((part) => part.type === "toolCall")
      ) {
        throw new Error("Interaction did not return a final decision");
      }
      const text = response.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("");
      return JSON.parse(text) as unknown;
    },
  };
}
