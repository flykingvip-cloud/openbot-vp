// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { KNOWLEDGE_UNIVERSE_ANCHORS } from "./knowledge-universe-anchors.ts";

describe("knowledge-universe anchor navigation", () => {
  it("scrolls to focusId when provided", () => {
    const workspace = document.createElement("section");
    workspace.id = KNOWLEDGE_UNIVERSE_ANCHORS.workspace;
    document.body.append(workspace);

    const focus = document.createElement("article");
    focus.id = KNOWLEDGE_UNIVERSE_ANCHORS.kbSearchFocus;
    const scrollIntoView = vi.fn();
    focus.scrollIntoView = scrollIntoView;
    document.body.append(focus);

    return import("./knowledge-universe-anchor-nav.ts").then(
      ({ navigateKnowledgeUniverseAnchor }) => {
        navigateKnowledgeUniverseAnchor(KNOWLEDGE_UNIVERSE_ANCHORS.workspace, {
          focusId: KNOWLEDGE_UNIVERSE_ANCHORS.kbSearchFocus,
          block: "nearest",
        });
        return new Promise<void>((resolve) => {
          requestAnimationFrame(() => {
            expect(scrollIntoView).toHaveBeenCalledWith({
              behavior: "smooth",
              block: "nearest",
            });
            workspace.remove();
            focus.remove();
            resolve();
          });
        });
      },
    );
  });
});
