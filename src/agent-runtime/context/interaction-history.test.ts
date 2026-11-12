import { expect, it } from "vitest";
import {
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
it("takes a bounded newest suffix without deduplicating equal text", () => {
  const messages = [
    { role: "user", content: "why" },
    { role: "user", content: "why" },
  ];
  expect(projectInteractionHistory(messages, "current", 6)).toHaveLength(2);
  expect(projectInteractionHistory(messages, "current", 4)).toEqual([
    { role: "user", content: "why" },
  ]);
  expect(projectInteractionHistory(messages, "current", 0)).toEqual([]);
});

it("never turns a partial historical prohibition into apparent permission", () => {
  const text = "Do not publish. Only publish after my explicit approval.";
  const result = projectInteractionHistoryWithStatus([{ role: "user", content: text }], "now", 20);
  expect(result).toEqual({ context: [], complete: false });
});
it("preserves complete bytes, roles and order and reports omitted history", () => {
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
      { role: "assistant", content: "ack" },
      { role: "user", content: "why" },
    ],
    complete: false,
  });
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
