import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tmpDir = path.join(os.tmpdir(), `openbot-guidance-event-tool-${Date.now()}`);

vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return {
    ...actual,
    CONFIG_DIR: tmpDir,
  };
});

const { createGuidanceEventTool } = await import("./guidance-event-tool.js");
const { listSessionEvents } = await import("../../gateway/asset-incubation-session-store.js");

describe("createGuidanceEventTool", () => {
  beforeEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("persists a completed guidance event for the signed-in owner", async () => {
    const tool = createGuidanceEventTool({
      agentSessionKey: "agent:main:employee:alice",
      gatewayClientUser: "Alice@Example.com",
    });
    const result = await tool.execute("call-1", {
      event: "guidance_completed",
      scenario: "wechat_oa_setup",
      contextConfidence: "high",
      stepsCompleted: 5,
      reusablePattern: true,
    });
    const text = result.content.find((part) => part.type === "text")?.text ?? "";
    expect(text).toContain("guidance:wechat_oa_setup");
    const events = listSessionEvents("alice@example.com");
    expect(events).toHaveLength(1);
    expect(events[0]?.intentKey).toContain("guidance_completed");
  });

  it("rejects incomplete step-failure payloads", async () => {
    const tool = createGuidanceEventTool({ gatewayClientUser: "bob@example.com" });
    await expect(
      tool.execute("call-2", {
        event: "guidance_step_failed",
        scenario: "wechat_oa_setup",
        contextConfidence: "medium",
      }),
    ).rejects.toThrow(/stepId/);
  });
});
