import { describe, expect, it, vi } from "vitest";
import type { WorkbenchKnowledgeSurface } from "../ports/employee/views/home-page-contracts.ts";
import { enterKnowledgeUniverseGovernance } from "./knowledge-universe-workspace-nav.ts";

function surface(overrides: Partial<WorkbenchKnowledgeSurface> = {}): WorkbenchKnowledgeSurface {
  return {
    governanceSummary: {
      openConflictCount: 0,
      openClaimConflictCount: 0,
      openDuplicateCount: 0,
      openOrphanCount: 0,
      openStaleCount: 0,
      suppressedChunkCount: 0,
      indexedChunkCount: 0,
      llmUsage: {
        llmCallCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        creditsCharged: 0,
        lastCallAt: null,
      },
    },
    ...overrides,
  } as WorkbenchKnowledgeSurface;
}

describe("enterKnowledgeUniverseGovernance", () => {
  it("opens governance page even when no chunks are indexed", () => {
    const onOpenGovernancePage = vi.fn();
    enterKnowledgeUniverseGovernance(surface(), onOpenGovernancePage);
    expect(onOpenGovernancePage).toHaveBeenCalledTimes(1);
  });

  it("opens governance page when chunks are indexed", () => {
    const onOpenGovernancePage = vi.fn();
    enterKnowledgeUniverseGovernance(
      surface({
        governanceSummary: {
          openConflictCount: 1,
          openClaimConflictCount: 0,
          openDuplicateCount: 0,
          openOrphanCount: 0,
          openStaleCount: 0,
          suppressedChunkCount: 0,
          indexedChunkCount: 12,
          llmUsage: {
            llmCallCount: 0,
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            creditsCharged: 0,
            lastCallAt: null,
          },
        },
      }),
      onOpenGovernancePage,
    );
    expect(onOpenGovernancePage).toHaveBeenCalledTimes(1);
  });
});
