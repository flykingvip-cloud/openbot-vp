import { expect, it } from "vitest";
import {
  INTERACTION_HISTORY_OMISSION_NOTICE,
  projectInteractionHistory,
  projectInteractionHistoryWithStatus,
} from "./interaction-history.js";

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
      { role: "system", content: INTERACTION_HISTORY_OMISSION_NOTICE },
      { role: "user", content: "why" },
    ],
    complete: false,
  });
  expect(projectInteractionHistoryWithStatus(messages, "current", 0)).toEqual({
    context: [{ role: "system", content: INTERACTION_HISTORY_OMISSION_NOTICE }],
    complete: false,
  });
});

it("never turns a partial historical prohibition into apparent permission", () => {
  const text = "Do not publish. Only publish after my explicit approval.";
  const result = projectInteractionHistoryWithStatus([{ role: "user", content: text }], "now", 20);
  expect(result.complete).toBe(false);
  expect(result.context).toEqual([
    { role: "system", content: INTERACTION_HISTORY_OMISSION_NOTICE },
  ]);
  expect(result.context.some((part) => part.content.includes("publish"))).toBe(false);
});

it("does not invert a negation or condition by character-tail truncation", () => {
  const text = "Do not publish unless the owner has confirmed in writing.";
  const projected = projectInteractionHistory([{ role: "user", content: text }], "now", 18);
  expect(projected.map((part) => part.content).join("\n")).not.toMatch(/publish unless/i);
  expect(projected).toEqual([{ role: "system", content: INTERACTION_HISTORY_OMISSION_NOTICE }]);
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
      { role: "system", content: INTERACTION_HISTORY_OMISSION_NOTICE },
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
  ).toEqual({ role: "system", content: INTERACTION_HISTORY_OMISSION_NOTICE });
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
