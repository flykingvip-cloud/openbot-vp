import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { describe, expect, it } from "vitest";
import {
  createMessageCharEstimateCache,
  estimateContextChars,
  getToolResultText,
} from "./tool-result-char-estimator.js";

describe("estimateContextChars after compile", () => {
  it("does not read length on a text block whose text is missing", () => {
    const messages = [
      { role: "user", content: [{ type: "text" }], timestamp: 1 },
      {
        role: "toolResult",
        toolName: "lookup",
        content: [{ type: "text" }, { type: "text", text: "kept" }],
        timestamp: 2,
      },
      { role: "assistant", timestamp: 3 },
    ] as AgentMessage[];

    expect(() => estimateContextChars(messages, createMessageCharEstimateCache())).not.toThrow();
    expect(estimateContextChars(messages, createMessageCharEstimateCache())).toBeGreaterThan(0);
    expect(getToolResultText(messages[1] as AgentMessage)).toBe("kept");
  });
});
