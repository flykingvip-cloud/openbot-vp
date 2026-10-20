import { describe, expect, it } from "vitest";
import {
  buildMemoryFlushCandidateCapsule,
  memoryFlushToLearningSignal,
} from "./memory-flush-outcome-capsule.js";

describe("memoryFlushToLearningSignal", () => {
  it("maps flush markdown to partial memory signal with lesson text", () => {
    const signal = memoryFlushToLearningSignal({
      groupId: "group-1",
      botId: "bot-a",
      confidentialityTier: "internal",
      memoryFlushWritePath: "memory/2026-04-09.md",
      appendedMarkdown: "## Retro\n- summarize risks before approval",
      flushedAt: 1_000,
      memoryCompactionCompleted: false,
      workspaceDir: "/tmp/ws",
      sessionKey: "sk-1",
    });
    expect(signal.outcome).toBe("partial");
    expect(signal.sourceType).toBe("memory");
    expect(signal.lesson).toContain("summarize risks");
    expect(signal.createdBy).toBe("bot-a");
  });
});

describe("buildMemoryFlushCandidateCapsule", () => {
  it("produces candidate lesson capsule aligned with task/review governance", () => {
    const capsule = buildMemoryFlushCandidateCapsule({
      groupId: "group-1",
      botId: "bot-a",
      participationId: "group-1::bot-a",
      confidentialityTier: "restricted",
      memoryFlushWritePath: "memory/2026-04-09.md",
      appendedMarkdown: "## Hiring draft\n- keep restricted notes internal",
      flushedAt: 2_000,
      memoryCompactionCompleted: true,
      workspaceDir: "/tmp/ws",
    });
    expect(capsule).toEqual(
      expect.objectContaining({
        groupId: "group-1",
        sourceType: "memory",
        capsuleType: "lesson",
        status: "candidate",
        reusability: "group_only",
        sensitivity: "restricted",
        createdBy: "bot-a",
      }),
    );
    expect(capsule?.metadata).toEqual(
      expect.objectContaining({
        origin: "memory_flush",
        sourceParticipationId: "group-1::bot-a",
      }),
    );
    expect(capsule?.structuredContent).toEqual(
      expect.objectContaining({
        memoryFlushWritePath: "memory/2026-04-09.md",
        memoryCompactionCompleted: true,
      }),
    );
  });
});
