import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../agent-runtime/execution/runner/admitted-candidate-embedded.ts",
  ),
  "utf8",
);

describe("chat embedded run tool evidence", () => {
  it("records tool events on the existing Pi run and does not add a second one", () => {
    expect(source.match(/await runEmbeddedPiAgent\(/g)).toHaveLength(1);
    const handler = source.slice(source.indexOf("onAgentEvent: async (evt)"));
    expect(handler.startsWith("onAgentEvent: async (evt)")).toBe(true);
    expect(handler.slice(0, 500)).toContain("conversationToolObserver?.(evt)");
    expect(source).toContain("createConversationTurnToolObserver");
    expect(source).not.toContain("ORCHESTRATION_LIVE_INVOKE = true");
  });
});
