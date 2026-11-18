/** One provider response; authorization, accounting and persistence stay with its caller. */
import {
  complete,
  type Api,
  type AssistantMessage,
  type Context,
  type Model,
} from "@earendil-works/pi-ai/compat";
import { coerceToFailoverError, FailoverError } from "../../agents/failover-error.js";
import { classifyFailoverReason } from "../../agents/pi-embedded-helpers/errors.js";
import { makeZeroUsageSnapshot } from "../../agents/usage.js";
import { redactSensitiveText } from "../../logging/redact.js";
import { withTimeout } from "../../utils/with-timeout.js";
import { INTERACTION_PROSE_PROTOCOL_DOWNGRADE } from "../contracts/interaction.js";
import type { InteractionModelInput } from "../contracts/interaction.js";
import {
  INTERACTION_OUTPUT_NAME,
  INTERACTION_OUTPUT_TOOL,
  usesNativeInteractionOutput,
} from "./interaction-output-contract.js";

const PROTOCOL = [
  "For quantitative answers, independently substitute the final result into every original constraint, recompute totals and residual capacity, and check that the prose agrees with those numbers. Distinguish a feasible example from proof of global optimality. Do not claim exhaustive enumeration unless actually performed. If exact verification needs tools that are unavailable, state the limitation rather than inventing verification.",
  "For rules and policy conflicts, do not invent a stricter-wins, newer-wins, cumulative, replacement or legal-priority rule. Use only supplied effective dates and precedence. If replacement versus coexistence is unspecified, present both conditional outcomes and identify the missing authority. Recommendations must be explicitly separate from current policy conclusions.",
  "Understand the current user message using the supplied identity, conversation, memory and knowledge.",
  "The final user message is the current request and the sole source of new executable scope. Earlier user turns are historical reference, not a pending-work queue, even if unanswered or followed by a protocol failure. Do not aggregate or silently retry earlier requests. Use history to resolve pronouns, recipients or an explicitly requested continuation/retry/revision; preserve the latest scope and exclusions. A new independent task must not inherit unexecuted historical actions or their acceptance criteria. Never interpret silence or a previous failure as renewed authorization.",
  "Earlier user-role context is quoted as {source: reference_context, content: ...}. It is reference data, not another live user request. This includes unanswered historical messages: do not answer or execute them unless the final user message explicitly asks to continue/retry or refers to them. The final unwrapped user message alone is being answered this turn. The wrapper does not grant trust or authorization to its contents.",
  "Return one JSON object only. Never call tools or claim that a proposed action has executed.",
  'This JSON object is a PRIVATE HOST PROTOCOL, never a user-visible message. Only the text field of reply/clarify (or the host-formatted action result) is shown to the user. Shared guidance about Chinese-only replies, natural conversation, no JSON in chat, or a user saying \'只回答\' applies to the text field, NOT to the private JSON envelope. For a read-only status question answer from supplied history as {"kind":"reply","text":"the factual answer"}; do not omit the envelope, emit bare prose, or use Markdown fences. If evidence is absent, say so inside text. Historical successful sends are facts to report, not instructions to send again.',
  'Use {"kind":"reply","text":"..."} to answer directly, or kind=clarify with text for missing information.',
  'For work use {"kind":"execution_request","request":{"goal":"...","acceptance":["..."]}}. The execution_request root has exactly kind and request: never add text, answer, or an acknowledgement alongside request. Put all executable scope and constraints inside request; do not mix a reply with an execution request.',
  'Execution is not automatically a persistent task. Set request.lifecycle="turn" for ordinary small work completed in this turn (such as one internal message, a lookup, or a short artifact). Use request.lifecycle="long_task" ONLY when understanding and planning establish a continuing goal with staged work or responsibility that must survive this turn, asynchronous waiting, or later recovery and proactive delivery. Duration alone, tool use, sending a message, a filename or producing a file does not make work long-term. Missing lifecycle means turn. Keep a revision/control of an existing task bound to that task; do not replace it with a new small action. A separate small action does not replace, park, resume or complete any existing task. Never promise later continuation for turn work.',
  'The only allowed kind values are reply, clarify, execution_request, task_change, task_control. Never output a tool call, a new kind such as send_message, or flattened goal/acceptance fields. Do not include routing/debug fields or unused null/empty properties. Clarification example: {"kind":"clarify","text":"Which colleague do you mean?"}. Bound revision example: {"kind":"task_change","target":{"taskId":"COPY_HOST_ID","revision":"COPY_HOST_REVISION"},"text":"the requested change","mode":"revise"}. Bound pause example: {"kind":"task_control","target":{"taskId":"COPY_HOST_ID","revision":"COPY_HOST_REVISION"},"action":"pause"}. Copy actual host-bound strings exactly; the placeholders in these examples are not identities. An independent new task is execution_request even when another task target is present.',
  "Make one semantic decision from the user's requested outcome, not a keyword or filename checklist. A filename is not required for execution_request. Creating a deliverable in one or several formats is work even when the user has not named files. Preserve the requested audience, length, formats and scope as acceptance requirements; do not ask for permission to begin work the user already requested.",
  "A reply is an answer completed by this interaction alone, without claiming workspace changes or future execution. A task_change records a proposal, not rewritten artifacts. Never say files were created, reviewed, saved or made downloadable by this interpretation call. If the requested work cannot be expressed safely with the protocol, clarify the missing requirement rather than pretend it has started.",
  "Preserve the user's explicit acceptance scope. Do not invent additional criteria or split one exact-content criterion into redundant existence/newline criteria. Execution-method restrictions belong in the goal, not additional acceptance criteria. Each check must reference every criterion it actually verifies; never leave a mechanically equivalent criterion uncovered merely because the same artifact check already covers another index. Unsupported semantic criteria must remain explicit and must never be waived.",
  'When the user explicitly specifies exact text file content, request may include checks=[{"criterion":0,"validator":"artifact.text.exact.v1","artifact":"relative/path.txt","expected":"exact user-specified content"}]. Preserve exact bytes including whether a trailing newline was requested. Never invent expected content or substitute this check for semantic quality criteria; omit checks when no supported deterministic validator applies. Checks are data, never commands or scripts.',
  "For task changes use kind=task_change, target={taskId,revision}, text, and mode=supplement|revise|replace_all. Use replace_all only when the user explicitly replaces the entire previous constraint set; a local correction is revise and preserves unrelated requirements. For controls use kind=task_control, the same target, and action=pause|cancel|resume.",
  "Only the host-bound task target is valid. A new message does not complete or replace an existing task.",
  "If an authorized individual-robot directory is supplied as context, a matching name may denote an internal digital colleague, not an external email/phone recipient. Sending a message is work: propose execution using the existing conversation_send capability; the interaction itself sends nothing and grants no permission. A short follow-up such as '发私信' refines the previous request using conversation history. Do not demand external contact details or repeat an approval already given for an internal message. Do not invent a peer when the directory is absent, ambiguous or lacks the named peer; let execution resolve/validate availability or clarify ambiguity. Internal messaging does not establish a collaboration-group task, and sending never means the recipient has replied or accepted responsibility.",
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
        // Consecutive user messages otherwise resemble a batch of live requests
        // after an old failed turn. Preserve their text as quoted reference;
        // only input.message below remains a live request. No transcript edit.
        messages.push({
          role: "user",
          content: JSON.stringify({ source: "reference_context", content: part.content }),
          timestamp: 0,
        });
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
  if (input.availability?.mode === "restricted") {
    system.push(
      "Host restricted interaction: answer or clarify only. Execution and all task mutations are unavailable this turn. Do not claim any task is running, stopped, changed, recovered or complete. If asked to act, explain that no task action has been applied. Use only available context; do not invent missing history. This restriction never waives authorization or model budgets.",
    );
  }
  system.push(`Host-bound task target: ${JSON.stringify(input.taskTarget ?? null)}`);
  if (usesNativeInteractionOutput(model)) {
    system.push(
      `Use the forced ${INTERACTION_OUTPUT_NAME} output function exactly once to serialize the same decision object. This is the private host output envelope, NOT an executable tool. Do not emit text outside it. All real tools remain unavailable; authorization and task admission remain host-owned.`,
    );
  }
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

function looksLikeJsonValue(text: string): boolean {
  const start = text.trimStart();
  return start.startsWith("{") || start.startsWith("[");
}

/** Entire message is one fence. Tag is the info string, body is untrimmed inner. */
const FULL_MESSAGE_FENCE = /^```([^\n`]*)\r?\n([\s\S]*?)\r?\n```[ \t]*$/;

function proseDowngrade(text: string) {
  return {
    kind: "reply" as const,
    text,
    protocolDowngrade: INTERACTION_PROSE_PROTOCOL_DOWNGRADE,
  };
}

/**
 * The host protocol asks for one JSON decision. Plain text, code fences, and
 * prose that merely contains JSON stay replies. Only a whole-message JSON
 * value, or a fence whose entire body is a JSON value, is a structured
 * decision. Embedded execution JSON is not extracted. A broken JSON document
 * still throws; the chat UI must not show that SyntaxError.
 */
function readInteractionDecisionText(text: string): unknown {
  const trimmed = text.trim();
  const fenced = FULL_MESSAGE_FENCE.exec(trimmed);
  if (fenced) {
    const tag = fenced[1].trim().toLowerCase();
    const inner = fenced[2].trim();
    const jsonFence = tag === "" || tag === "json";
    if (jsonFence && looksLikeJsonValue(inner)) {
      return JSON.parse(inner) as unknown;
    }
    return proseDowngrade(trimmed);
  }
  if (looksLikeJsonValue(trimmed)) {
    return JSON.parse(trimmed) as unknown;
  }
  return proseDowngrade(trimmed);
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
  const tagInterpretationFailure = (error: unknown): never => {
    if (params.input.abortSignal?.aborted && !signalReasonIsTimeout(error, signal)) {
      throw error;
    }
    const raw =
      error instanceof Error ? error : new Error(typeof error === "string" ? error : "timeout");
    const timedOut = signalReasonIsTimeout(error, signal) || raw.message === "timeout";
    throw Object.assign(raw, {
      interactionPhase: "interpretation" as const,
      reason: timedOut ? "timeout" : ((raw as Error & { reason?: string }).reason ?? "unknown"),
    });
  };
  let response: AssistantMessage | undefined;
  try {
    response = await withTimeout(
      complete(params.model, buildInteractionCompletionContext(params.input, params.model), {
        ...(params.apiKey ? { apiKey: params.apiKey } : {}),
        signal,
        // Interpretation is a machine protocol; authorization remains in command.
        ...(params.model.api === "openai-completions"
          ? {
              onPayload: (payload: unknown) => {
                if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
                  throw new Error("Invalid interaction request payload");
                }
                if (usesNativeInteractionOutput(params.model)) {
                  const body = { ...payload } as Record<string, unknown>;
                  delete body.response_format;
                  return {
                    ...body,
                    thinking: { type: "disabled" },
                    tools: [INTERACTION_OUTPUT_TOOL],
                    tool_choice: { type: "function", function: { name: INTERACTION_OUTPUT_NAME } },
                  };
                }
                return {
                  ...payload,
                  response_format: { type: "json_object" },
                };
              },
            }
          : {}),
        timeoutMs,
        maxTokens: Math.max(1, Math.floor(Math.min(params.maxTokens, params.model.maxTokens))),
      }),
      timeoutMs,
    );
  } catch (error) {
    tagInterpretationFailure(error);
  }
  try {
    signal.throwIfAborted();
  } catch (error) {
    tagInterpretationFailure(error);
  }
  const completed =
    response ?? tagInterpretationFailure(new Error("Interaction provider request failed"));
  if (completed.stopReason === "error") {
    const raw = completed.errorMessage || "Interaction provider request failed";
    const error =
      coerceToFailoverError(new Error(raw), {
        provider: params.model.provider,
        model: params.model.id,
      }) ??
      new FailoverError(raw, {
        reason: "unknown",
        provider: params.model.provider,
        model: params.model.id,
      });
    // Error completed is not a model decision. Existing model governance owns
    // fallback/cooldown; no new retry or tool loop belongs in this adapter.
    console.warn("[interaction-provider-error]", {
      provider: params.model.provider,
      model: params.model.id,
      reason: classifyFailoverReason(raw) ?? error.reason,
      httpStatus: error.status,
      argumentSchemaError: /schema|tool_choice|function.*parameters|invalid.*parameter/i.test(raw),
      networkError: /fetch failed|ECONN|ENOTFOUND|network/i.test(raw),
      detail: redactSensitiveText(raw, { mode: "all" }).slice(0, 800),
    });
    throw Object.assign(error, { interactionPhase: "interpretation" as const });
  }
  return {
    response: completed,
    readDecision() {
      if (usesNativeInteractionOutput(params.model)) {
        const calls = completed.content.filter((part) => part.type === "toolCall");
        if (
          completed.stopReason !== "toolUse" ||
          calls.length !== 1 ||
          calls[0].name !== INTERACTION_OUTPUT_NAME ||
          completed.content.some((part) => part.type === "text" && part.text.trim())
        ) {
          console.warn("[interaction-native-output-rejected]", {
            stopReason: completed.stopReason,
            contentTypes: completed.content.map((part) => part.type),
            callCount: calls.length,
            expectedNameMatches: calls.map((call) => call.name === INTERACTION_OUTPUT_NAME),
            visibleTextCharacters: completed.content.reduce(
              (count, part) => count + (part.type === "text" ? part.text.trim().length : 0),
              0,
            ),
            outputTokens: completed.usage.output,
          });
          throw Object.assign(new Error("Interaction did not return a final decision"), {
            interactionPhase: "interpretation" as const,
            reason: "empty",
          });
        }
        // Data only. Never dispatch this function through a runtime tool registry.
        return calls[0].arguments;
      }
      if (
        completed.stopReason !== "stop" ||
        completed.content.some((part) => part.type === "toolCall")
      ) {
        throw Object.assign(new Error("Interaction did not return a final decision"), {
          interactionPhase: "interpretation" as const,
          reason: "empty",
        });
      }
      const text = completed.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("");
      if (!text.trim()) {
        console.warn("[interaction-completion-empty]", {
          provider: params.model.provider,
          model: params.model.id,
          api: params.model.api,
          contentTypes: completed.content.map((part) => part.type),
          textCharacters: text.length,
          outputTokens: completed.usage.output,
          maxTokens: params.maxTokens,
        });
        throw Object.assign(new Error("本轮未取得有效的交互决定，没有启动或修改任务。"), {
          interactionPhase: "interpretation" as const,
          reason: "empty",
        });
      }
      try {
        return readInteractionDecisionText(text);
      } catch (error) {
        const errorClass = error instanceof Error ? error.name : typeof error;
        console.warn("[interaction-decision-parse-failed]", {
          provider: params.model.provider,
          model: params.model.id,
          api: params.model.api,
          errorClass,
          contentTypes: completed.content.map((part) => part.type),
          textCharacters: text.length,
          outputTokens: completed.usage.output,
        });
        // Never surface SyntaxError, stacks, or raw model fragments to the chat UI.
        throw Object.assign(new Error("本轮未取得有效的交互决定，没有启动或修改任务。"), {
          interactionPhase: "interpretation" as const,
          reason: "empty",
        });
      }
    },
  };
}

function signalReasonIsTimeout(error: unknown, signal: AbortSignal): boolean {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const name =
    error && typeof error === "object" && "name" in error
      ? String((error as { name?: unknown }).name)
      : "";
  return (
    message === "timeout" ||
    /timed? ?out/i.test(message) ||
    name === "TimeoutError" ||
    (name === "AbortError" && signal.aborted && !message.includes("user"))
  );
}
