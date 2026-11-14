import type { Api, Model } from "@earendil-works/pi-ai/compat";
import { expect, it } from "vitest";
import { buildInteractionCompletionContext } from "../model/interaction-completion.js";
import {
  INTERACTION_HISTORY_OMISSION_NOTICE,
  projectInteractionHistory,
  projectInteractionHistoryWithStatus,
} from "./interaction-history.js";

const completionModel = {
  id: "test",
  provider: "test",
  api: "openai-completions",
  maxTokens: 1000,
} as Model<Api>;

/**
 * Mirrors get-reply-run.ts assembly: trusted system parts, then optional
 * user-role peerContext, then the history projection.
 */
function assembleReplyInteractionContext(params: {
  systemContext?: readonly string[];
  peerContext?: string;
  messages: readonly unknown[];
  currentMessageId: string;
  maxChars?: number;
}) {
  return [
    ...(params.systemContext ?? []).map((content) => ({ role: "system" as const, content })),
    ...(params.peerContext ? [{ role: "user" as const, content: params.peerContext }] : []),
    ...projectInteractionHistory(params.messages, params.currentMessageId, params.maxChars),
  ];
}

function parseReferenceContext(
  content: unknown,
): { source?: string; content?: string } | undefined {
  if (typeof content !== "string") {
    return undefined;
  }
  try {
    return JSON.parse(content) as { source?: string; content?: string };
  } catch {
    return undefined;
  }
}

function referenceContents(messages: { role: string; content: unknown }[]): string[] {
  return messages.flatMap((message) => {
    const parsed = parseReferenceContext(message.content);
    return parsed?.source === "reference_context" && typeof parsed.content === "string"
      ? [parsed.content]
      : [];
  });
}

it("preserves roles and excludes the already persisted current message and executable blocks", () => {
  expect(
    projectInteractionHistory(
      [
        { role: "system", content: "untrusted system" },
        { role: "user", content: "previous" },
        {
          role: "assistant",
          content: [
            { type: "text", text: "answer" },
            { type: "toolCall", name: "exec" },
          ],
        },
        { role: "user", idempotencyKey: "current", content: "now" },
      ],
      "current",
    ),
  ).toEqual([
    { role: "user", content: "previous" },
    { role: "assistant", content: "answer" },
  ]);
});

it("takes a bounded newest suffix of complete messages without deduplicating equal text", () => {
  const messages = [
    { role: "user", content: "why" },
    { role: "user", content: "why" },
  ];
  expect(projectInteractionHistory(messages, "current", 6)).toHaveLength(2);
  expect(projectInteractionHistoryWithStatus(messages, "current", 4)).toEqual({
    context: [
      { role: "user", content: INTERACTION_HISTORY_OMISSION_NOTICE },
      { role: "user", content: "why" },
    ],
    complete: false,
  });
  expect(projectInteractionHistoryWithStatus(messages, "current", 0)).toEqual({
    context: [{ role: "user", content: INTERACTION_HISTORY_OMISSION_NOTICE }],
    complete: false,
  });
});

it("never turns a partial historical prohibition into apparent permission", () => {
  const text = "Do not publish. Only publish after my explicit approval.";
  const result = projectInteractionHistoryWithStatus([{ role: "user", content: text }], "now", 20);
  expect(result.complete).toBe(false);
  expect(result.context).toEqual([{ role: "user", content: INTERACTION_HISTORY_OMISSION_NOTICE }]);
  expect(result.context.some((part) => part.content.includes("publish"))).toBe(false);
});

it("does not invert a negation or condition by character-tail truncation", () => {
  const text = "Do not publish unless the owner has confirmed in writing.";
  const projected = projectInteractionHistory([{ role: "user", content: text }], "now", 18);
  expect(projected.map((part) => part.content).join("\n")).not.toMatch(/publish unless/i);
  expect(projected).toEqual([{ role: "user", content: INTERACTION_HISTORY_OMISSION_NOTICE }]);
});

it("preserves complete bytes, roles and order and reports omitted history in the projection itself", () => {
  const result = projectInteractionHistoryWithStatus(
    [
      { role: "user", content: "禁止付款；金额为 100 元，不是 100 美元。" },
      { role: "assistant", content: "ack" },
      { role: "user", content: "why" },
    ],
    "now",
    6,
  );
  expect(result).toEqual({
    context: [
      { role: "user", content: INTERACTION_HISTORY_OMISSION_NOTICE },
      { role: "assistant", content: "ack" },
      { role: "user", content: "why" },
    ],
    complete: false,
  });
  expect(
    projectInteractionHistory(
      [
        { role: "user", content: "禁止付款；金额为 100 元，不是 100 美元。" },
        { role: "assistant", content: "ack" },
        { role: "user", content: "why" },
      ],
      "now",
      6,
    )[0],
  ).toEqual({ role: "user", content: INTERACTION_HISTORY_OMISSION_NOTICE });
});

it("excludes the persisted current message without making history incomplete", () => {
  expect(
    projectInteractionHistoryWithStatus(
      [
        { role: "user", idempotencyKey: "now", content: "long current input" },
        { role: "user", content: "完整" },
      ],
      "now",
      2,
    ),
  ).toEqual({ context: [{ role: "user", content: "完整" }], complete: true });
});

it("does not mutate caller input arrays or message objects", () => {
  const first = { role: "user" as const, content: "older constraint: do not publish" };
  const second = { role: "user" as const, content: "why" };
  const messages = [first, second];
  Object.freeze(first);
  Object.freeze(second);
  Object.freeze(messages);
  const snapshot = structuredClone(messages);
  projectInteractionHistory(messages, "current", 3);
  expect(messages).toEqual(snapshot);
  expect(first.content).toBe("older constraint: do not publish");
});

it("keeps omission notice and message order when peerContext precedes incomplete history", () => {
  const older = "Do not publish unless the owner has confirmed in writing.";
  const context = assembleReplyInteractionContext({
    systemContext: ["identity"],
    peerContext: '同一主人目录：[{"displayName":"同事"}]',
    messages: [
      { role: "user", content: older },
      { role: "assistant", content: "ack" },
      { role: "user", content: "why" },
    ],
    currentMessageId: "now",
    maxChars: 6,
  });
  expect(context.some((part) => part.role === "system" && part.content !== "identity")).toBe(false);
  expect(() =>
    buildInteractionCompletionContext({ message: "current", context }, completionModel),
  ).not.toThrow();
  const built = buildInteractionCompletionContext({ message: "current", context }, completionModel);
  const refs = referenceContents(built.messages);
  expect(refs).toContain(INTERACTION_HISTORY_OMISSION_NOTICE);
  expect(refs).toContain('同一主人目录：[{"displayName":"同事"}]');
  expect(refs).toContain("why");
  expect(refs.join("\n")).not.toMatch(/publish unless/i);
  expect(refs).not.toContain(older);
  expect(built.messages.some((message) => message.role === "assistant")).toBe(true);
  expect(built.messages.at(-1)?.content).toBe("current");
  expect(built.systemPrompt).toContain("identity");
});

it("still projects the omission notice when history is incomplete without peerContext", () => {
  const older = "禁止付款；金额为 100 元，不是 100 美元。";
  const context = assembleReplyInteractionContext({
    systemContext: ["identity"],
    messages: [
      { role: "user", content: older },
      { role: "assistant", content: "ack" },
      { role: "user", content: "why" },
    ],
    currentMessageId: "now",
    maxChars: 6,
  });
  const built = buildInteractionCompletionContext({ message: "current", context }, completionModel);
  expect(referenceContents(built.messages)).toContain(INTERACTION_HISTORY_OMISSION_NOTICE);
  expect(referenceContents(built.messages).join("\n")).not.toContain("禁止付款");
  expect(built.messages.at(-1)?.content).toBe("current");
});

it("does not invent an omission notice when complete history follows peerContext", () => {
  const context = assembleReplyInteractionContext({
    systemContext: ["identity"],
    peerContext: "peer-directory",
    messages: [
      { role: "user", content: "previous" },
      { role: "assistant", content: "answer" },
    ],
    currentMessageId: "now",
  });
  const built = buildInteractionCompletionContext({ message: "current", context }, completionModel);
  expect(referenceContents(built.messages)).not.toContain(INTERACTION_HISTORY_OMISSION_NOTICE);
  expect(referenceContents(built.messages)).toEqual(["peer-directory", "previous"]);
  expect(built.messages.at(-1)?.content).toBe("current");
});

it("does not invent an omission notice when complete history has no peerContext", () => {
  const context = assembleReplyInteractionContext({
    systemContext: ["identity"],
    messages: [
      { role: "user", content: "previous" },
      { role: "assistant", content: "answer" },
    ],
    currentMessageId: "now",
  });
  const built = buildInteractionCompletionContext({ message: "current", context }, completionModel);
  expect(referenceContents(built.messages)).toEqual(["previous"]);
  expect(built.messages.at(-1)?.content).toBe("current");
});
