import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  classifyWriteChannel,
  DEFAULT_TOOL_WRITE_CHANNELS,
  resolveDeclaredWriteChannel,
  resolveWriteChannelLocator,
} from "./write-channel.js";

describe("write-channel (C17)", () => {
  it("classifies interaction drafts vs primary", () => {
    expect(classifyWriteChannel("agent-interactions/drafts/note.md")).toBe("interaction");
    expect(classifyWriteChannel("deliverables/deck.md")).toBe("primary");
    expect(classifyWriteChannel("AGENTS.md")).toBe("primary");
  });

  it("defaults tools to interaction-only (cannot write primary without capability)", () => {
    const denied = resolveDeclaredWriteChannel({
      relativePath: "report.md",
      allowedChannels: DEFAULT_TOOL_WRITE_CHANNELS,
    });
    expect(denied.ok).toBe(false);

    const allowed = resolveDeclaredWriteChannel({
      relativePath: "agent-interactions/drafts/scratch.md",
      allowedChannels: DEFAULT_TOOL_WRITE_CHANNELS,
    });
    expect(allowed.ok).toBe(true);
  });

  it("resolves interaction locator under primary", () => {
    const root = resolveWriteChannelLocator({
      primaryLocator: "/tmp/ws",
      channel: "interaction",
    });
    expect(root).toBe(path.join("/tmp/ws", "agent-interactions", "drafts"));
  });
});
