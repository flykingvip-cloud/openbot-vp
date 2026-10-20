// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  clearKnowledgeUniverseSearchPanelDismiss,
  ensureKnowledgeUniverseSearchShortcut,
  focusKnowledgeUniverseSearch,
  KNOWLEDGE_UNIVERSE_SEARCH_INPUT_ID,
  registerKnowledgeUniverseSearchPanelDismiss,
  releaseKnowledgeUniverseSearchShortcutForTests,
} from "./knowledge-universe-search-focus.ts";

describe("knowledge-universe search focus", () => {
  afterEach(() => {
    releaseKnowledgeUniverseSearchShortcutForTests();
    document.body.replaceChildren();
  });

  it("focuses and selects the unified search input", () => {
    const page = document.createElement("section");
    page.className = "employee-workbench__module-page--knowledge";
    const input = document.createElement("input");
    input.id = KNOWLEDGE_UNIVERSE_SEARCH_INPUT_ID;
    page.append(input);
    document.body.append(page);

    focusKnowledgeUniverseSearch();

    return new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        expect(document.activeElement).toBe(input);
        expect(input.selectionStart).toBe(0);
        expect(input.selectionEnd).toBe(input.value.length);
        resolve();
      });
    });
  });

  it("binds Cmd/Ctrl+K to focus search when knowledge page is visible", () => {
    const page = document.createElement("section");
    page.className = "employee-workbench__module-page--knowledge";
    const input = document.createElement("input");
    input.id = KNOWLEDGE_UNIVERSE_SEARCH_INPUT_ID;
    page.append(input);
    document.body.append(page);

    ensureKnowledgeUniverseSearchShortcut();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }));

    return new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        expect(document.activeElement).toBe(input);
        resolve();
      });
    });
  });

  it("does not steal Cmd/Ctrl+K from inputs outside the knowledge module", () => {
    const page = document.createElement("section");
    page.className = "employee-workbench__module-page--knowledge";
    const search = document.createElement("input");
    search.id = KNOWLEDGE_UNIVERSE_SEARCH_INPUT_ID;
    page.append(search);

    const chat = document.createElement("textarea");
    document.body.append(page, chat);
    chat.focus();

    ensureKnowledgeUniverseSearchShortcut();
    const event = new KeyboardEvent("keydown", {
      key: "k",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    const prevented = !chat.dispatchEvent(event);

    expect(prevented).toBe(false);
    expect(document.activeElement).toBe(chat);
  });

  it("focuses unified search from supply form fields inside knowledge module", () => {
    const page = document.createElement("section");
    page.className = "employee-workbench__module-page--knowledge";
    const search = document.createElement("input");
    search.id = KNOWLEDGE_UNIVERSE_SEARCH_INPUT_ID;
    const supplyField = document.createElement("input");
    page.append(search, supplyField);
    document.body.append(page);
    supplyField.focus();

    ensureKnowledgeUniverseSearchShortcut();
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true, cancelable: true }),
    );

    return new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        expect(document.activeElement).toBe(search);
        resolve();
      });
    });
  });

  it("dismisses open search panel on Escape", () => {
    let dismissed = false;
    const page = document.createElement("section");
    page.className = "employee-workbench__module-page--knowledge";
    const panel = document.createElement("div");
    panel.className = "knowledge-universe__search-panel";
    page.append(panel);
    document.body.append(page);

    ensureKnowledgeUniverseSearchShortcut();
    registerKnowledgeUniverseSearchPanelDismiss(() => {
      dismissed = true;
    });

    const event = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    const prevented = !window.dispatchEvent(event);

    expect(prevented).toBe(true);
    expect(dismissed).toBe(true);
    clearKnowledgeUniverseSearchPanelDismiss();
  });
});
