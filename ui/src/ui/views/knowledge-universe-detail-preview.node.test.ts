// @vitest-environment jsdom
import { html, render } from "lit";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { i18n } from "../../i18n/index.ts";
import { renderKnowledgeUniverseDetailPreview } from "./knowledge-universe-detail-preview.ts";

beforeAll(async () => {
  await i18n.setLocale("en");
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("renderKnowledgeUniverseDetailPreview", () => {
  it("renders publish intent handoff button for selected objects", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const onCreatePublishIntent = vi.fn();

    render(
      html`${renderKnowledgeUniverseDetailPreview({
        selectedNodeId: "node-1",
        selectedObject: {
          id: "obj-1",
          title: "Release Notes",
          source: "personal",
          kind: "document",
          summary: "Weekly release summary",
          tags: [],
          updatedAt: 1,
        },
        graph: null,
        onCreatePublishIntent,
      })}`,
      container,
    );
    await Promise.resolve();

    expect(container.textContent).toContain("Hand off to assistant");
    expect(container.textContent).toContain(
      "The Knowledge Universe does not publish externally by itself",
    );

    const channelButtons = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".knowledge-universe__publish-channel"),
    );
    expect(channelButtons.length).toBeGreaterThan(0);
    channelButtons[0]?.click();

    expect(onCreatePublishIntent).toHaveBeenCalledWith({
      objectId: "obj-1",
      objectTitle: "Release Notes",
      objectSummary: "Weekly release summary",
      provider: "github-personal",
      suggestedAction: "create_issue",
    });
  });

  it("renders AI insights and health narrative for a focused node", async () => {
    const container = document.createElement("div");
    document.body.append(container);

    render(
      html`${renderKnowledgeUniverseDetailPreview({
        selectedNodeId: "node:a",
        selectedObject: {
          id: "a",
          title: "HR Policy",
          source: "enterprise",
          kind: "policy",
          summary: "HR policy doc",
          tags: [],
          updatedAt: Date.now(),
          relationshipSummary: { relatedCount: 3, conflictCount: 1, supportingCount: 2 },
        },
        graph: {
          nodes: [
            {
              id: "node:a",
              kind: "knowledge-object",
              title: "HR Policy",
              objectId: "a",
              governance: { status: "conflict", conflictCount: 1, freshness: "stale" },
            },
            { id: "node:b", kind: "knowledge-object", title: "Comp Policy", objectId: "b" },
          ],
          edges: [{ sourceId: "node:a", targetId: "node:b", relationType: "conflicts", score: 66 }],
        },
        relatedGroups: null,
      })}`,
      container,
    );
    await Promise.resolve();

    const insights = container.querySelector('[data-testid="ku-detail-insights"]');
    expect(insights).toBeTruthy();
    expect(insights!.textContent).toContain("AI insights");
    expect(insights!.textContent).toContain("Knowledge health");
    expect(insights!.textContent).toContain("Comp Policy");
    expect(insights!.textContent).not.toContain("66% confidence");

    const health = container.querySelector('[data-testid="ku-detail-health"]');
    expect(health).toBeTruthy();
    expect(health!.textContent).toContain("1 content conflicts found");
    expect(health!.textContent).toContain("May be outdated");

    expect(container.querySelector('[data-testid="ku-detail-why"]')).toBeNull();
    expect(container.textContent).toContain("Policy");
  });

  it("keeps humanized relation evidence inside the expandable why section", async () => {
    const container = document.createElement("div");
    document.body.append(container);

    render(
      html`${renderKnowledgeUniverseDetailPreview({
        selectedNodeId: "node:a",
        selectedObject: {
          id: "a",
          title: "HR Policy",
          source: "enterprise",
          kind: "policy",
          summary: "s",
          tags: [],
          updatedAt: 1,
          relationshipSummary: { relatedCount: 2, conflictCount: 0, supportingCount: 1 },
        },
        graph: {
          nodes: [
            { id: "node:a", kind: "knowledge-object", title: "HR Policy", objectId: "a" },
            { id: "node:b", kind: "knowledge-object", title: "Comp Policy", objectId: "b" },
          ],
          edges: [
            {
              sourceId: "node:a",
              targetId: "node:b",
              relationType: "related",
              score: 74,
              reasons: ["shared-tags:HR,制度"],
            },
          ],
        },
        relatedGroups: null,
      })}`,
      container,
    );
    await Promise.resolve();

    const relatedCard = Array.from(container.querySelectorAll(".ku-insight-card")).find((card) =>
      card.textContent?.includes("Comp Policy"),
    );
    const details = relatedCard?.querySelector(".ku-insight-card__why");
    expect(details).toBeTruthy();
    expect(details!.textContent).toContain("Shared tags");
    expect(details!.textContent).toContain("HR");
    expect(details!.textContent).toContain("制度");
    expect(container.textContent).not.toContain("74% confidence");
  });

  it("embeds governance actions inside insight cards", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const onExecuteKnowledgeAction = vi.fn();

    render(
      html`${renderKnowledgeUniverseDetailPreview({
        selectedNodeId: "node:a",
        selectedObject: {
          id: "a",
          title: "HR Policy",
          source: "enterprise",
          kind: "policy",
          summary: "s",
          tags: [],
          updatedAt: 1,
        },
        graph: {
          nodes: [{ id: "node:a", kind: "knowledge-object", title: "HR Policy", objectId: "a" }],
          edges: [],
        },
        relatedGroups: null,
        actionSuggestions: [
          {
            actionId: "merge-1",
            actionType: "merge_duplicate",
            title: "Merge duplicate chunks",
            reason: "Duplicate content hurts retrieval quality",
            score: 92,
            context: { objectId: "a" },
            executable: true,
          },
        ],
        onExecuteKnowledgeAction,
      })}`,
      container,
    );
    await Promise.resolve();

    const actionButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="ku-insight-action"]',
    );
    expect(actionButton).toBeTruthy();
    actionButton?.click();
    expect(onExecuteKnowledgeAction).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-testid="ku-detail-governance"]')).toBeNull();
  });
});
