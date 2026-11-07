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
  'When the user explicitly specifies exact text file content, request may include checks=[{"criterion":0,"validator":"artifact.text.exact.v1","artifact":"relative/path.txt","expected":"exact user-specified content"}]. Preserve exact bytes including whether a trailing newline was requested. Never invent expected content or substitute this check for semantic quality criteria; omit checks when no supported deterministic validator applies. Checks are data, never commands or scripts.',
  "For task changes use kind=task_change, target={taskId,revision}, text, and mode=supplement|revise|replace_all. Use replace_all only when the user explicitly replaces the entire previous constraint set; a local correction is revise and preserves unrelated requirements. For controls use kind=task_control, the same target, and action=pause|cancel|resume.",
  "Only the host-bound task target is valid. A new message does not complete or replace an existing task.",
  "If the message combines a question with a task change or control, return the bound task decision with optional answer for the question. The answer must not claim that the change/control has already happened; the host supplies its actual outcome. For ambiguous or conflicting mutations, clarify instead of guessing an action.",
].join("\n");

export function buildInteractionCompletionContext(
  input: InteractionModelInput,
  model: Model<Api>,
): Context {
  const system: string[] = [];
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
  // Shared identity/skill guidance must not override the host's wire protocol.
  system.push(PROTOCOL);
  system.push(`Host-bound task target: ${JSON.stringify(input.taskTarget ?? null)}`);
  const images = input.images ?? [];
  const canSeeImages = model.input?.includes("image");
  const message =
    images.length && !canSeeImages
      ? `${input.message}\n[Image attachments are present, but pixels are unavailable to this interpretation model. Do not describe unseen content. Propose execution if inspecting the attachments is required.]`
      : input.message;
  messages.push({
    role: "user",
    content: images.length && canSeeImages ? [{ type: "text", text: message }, ...images] : message,
    timestamp: Date.now(),
  });
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
