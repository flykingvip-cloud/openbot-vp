// @vitest-environment jsdom
import { html, render } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { KnowledgeGovernanceSummary } from "../capability/knowledge-universe/endpoints.ts";
import type { WorkbenchKnowledgeSurface } from "../ports/employee/views/home-page-contracts.ts";
import { renderKnowledgeUniverseRelationsDiscovery } from "./knowledge-universe-relations-discovery.ts";

afterEach(() => {
  document.body.innerHTML = "";
});

function summary(overrides: Partial<KnowledgeGovernanceSummary> = {}): KnowledgeGovernanceSummary {
  return {
    openConflictCount: 0,
    openClaimConflictCount: 0,
    openDuplicateCount: 0,
    openOrphanCount: 0,
    openStaleCount: 0,
    suppressedChunkCount: 0,
    indexedChunkCount: 100,
    llmUsage: {
      llmCallCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      creditsCharged: 0,
      lastCallAt: null,
    },
    ...overrides,
  };
}

function mount(surface: Partial<WorkbenchKnowledgeSurface>): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  render(
    html`${renderKnowledgeUniverseRelationsDiscovery(surface as unknown as WorkbenchKnowledgeSurface)}`,
    container,
  );
  return container;
}

describe("renderKnowledgeUniverseRelationsDiscovery", () => {
  it("shows a full health score and healthy state with no govern CTA when clean", () => {
    const container = mount({ governanceSummary: summary(), onPageTabChange: vi.fn() });

    const score = container.querySelector('[data-testid="ku-relations-discovery-score"]');
    expect(score?.textContent).toContain("100");
    expect(score?.getAttribute("data-tone")).toBe("good");
    expect(container.querySelector('[data-testid="ku-relations-discovery-healthy"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="ku-relations-discovery-govern"]')).toBeNull();
  });

  it("shows counts, a lowered score, and a govern CTA that routes to governance", () => {
    const onPageTabChange = vi.fn();
    const container = mount({
      governanceSummary: summary({
        openConflictCount: 3,
        openDuplicateCount: 2,
        openStaleCount: 5,
      }),
      onPageTabChange,
    });

    // Penalty = 3*8 + 2*5 + 5*3 = 49 → score 100 - 49 = 51 (poor tone).
    const score = container.querySelector('[data-testid="ku-relations-discovery-score"]');
    expect(score?.textContent).toContain("51");
    expect(score?.getAttribute("data-tone")).toBe("poor");

    const govern = container.querySelector<HTMLButtonElement>(
      '[data-testid="ku-relations-discovery-govern"]',
    );
    expect(govern).toBeTruthy();
    govern!.click();
    expect(onPageTabChange).toHaveBeenCalledWith("governance");
  });
});
