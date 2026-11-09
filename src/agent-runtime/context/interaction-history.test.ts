import { expect, it } from "vitest";
import { projectInteractionHistory } from "./interaction-history.js";
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
    { role: "user", content: "y" },
    { role: "user", content: "why" },
  ]);
  expect(projectInteractionHistory(messages, "current", 0)).toEqual([]);
});
