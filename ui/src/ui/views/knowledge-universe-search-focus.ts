export const KNOWLEDGE_UNIVERSE_SEARCH_INPUT_ID = "knowledge-universe-search";

export function focusKnowledgeUniverseSearch(): void {
  if (typeof document === "undefined") {
    return;
  }
  requestAnimationFrame(() => {
    const input = document.getElementById(KNOWLEDGE_UNIVERSE_SEARCH_INPUT_ID);
    if (input instanceof HTMLInputElement) {
      input.focus();
      input.select();
    }
  });
}

function isBlockingShortcutContext(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const knowledgeRoot = document.querySelector(".employee-workbench__module-page--knowledge");
  if (!knowledgeRoot) {
    return true;
  }
  if (!knowledgeRoot.contains(target)) {
    return true;
  }
  const modal = target.closest('[role="dialog"], dialog[open]');
  if (modal instanceof HTMLElement && modal.hasAttribute("data-ku-shortcut-block")) {
    return true;
  }
  return false;
}

function shouldHandleKnowledgeUniverseSearchShortcut(event: KeyboardEvent): boolean {
  if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") {
    return false;
  }
  if (event.shiftKey || event.altKey) {
    return false;
  }
  if (event.defaultPrevented) {
    return false;
  }
  if (!document.querySelector(".employee-workbench__module-page--knowledge")) {
    return false;
  }
  if (isBlockingShortcutContext(event.target)) {
    return false;
  }
  return true;
}

function handleKnowledgeUniverseSearchShortcut(event: KeyboardEvent): void {
  if (!shouldHandleKnowledgeUniverseSearchShortcut(event)) {
    return;
  }
  event.preventDefault();
  focusKnowledgeUniverseSearch();
}

let shortcutBound = false;
let shortcutCapture = false;
let panelDismissBound = false;
let panelDismissHandler: (() => void) | null = null;

export function registerKnowledgeUniverseSearchPanelDismiss(handler: () => void): void {
  panelDismissHandler = handler;
}

export function clearKnowledgeUniverseSearchPanelDismiss(): void {
  panelDismissHandler = null;
}

function shouldDismissKnowledgeUniverseSearchPanel(event: KeyboardEvent): boolean {
  if (event.key !== "Escape" || event.defaultPrevented) {
    return false;
  }
  if (!panelDismissHandler) {
    return false;
  }
  if (!document.querySelector(".knowledge-universe__search-panel")) {
    return false;
  }
  const target = event.target;
  if (target instanceof HTMLElement) {
    const blocking = target.closest('[role="dialog"], dialog[open]');
    if (
      blocking instanceof HTMLElement &&
      !blocking.classList.contains("knowledge-universe__search-panel")
    ) {
      return false;
    }
  }
  return true;
}

function handleKnowledgeUniverseSearchPanelDismiss(event: KeyboardEvent): void {
  if (!shouldDismissKnowledgeUniverseSearchPanel(event)) {
    return;
  }
  event.preventDefault();
  panelDismissHandler?.();
}

export function ensureKnowledgeUniverseSearchShortcut(): void {
  if (typeof window === "undefined") {
    return;
  }
  if (!shortcutBound) {
    window.addEventListener("keydown", handleKnowledgeUniverseSearchShortcut, { capture: true });
    shortcutBound = true;
    shortcutCapture = true;
  }
  if (!panelDismissBound) {
    window.addEventListener("keydown", handleKnowledgeUniverseSearchPanelDismiss, {
      capture: true,
    });
    panelDismissBound = true;
  }
}

/** Test helper — unbind global shortcut listener. */
export function releaseKnowledgeUniverseSearchShortcutForTests(): void {
  if (typeof window === "undefined") {
    return;
  }
  if (shortcutBound) {
    window.removeEventListener(
      "keydown",
      handleKnowledgeUniverseSearchShortcut,
      shortcutCapture ? { capture: true } : undefined,
    );
    shortcutBound = false;
  }
  if (panelDismissBound) {
    window.removeEventListener("keydown", handleKnowledgeUniverseSearchPanelDismiss, {
      capture: true,
    });
    panelDismissBound = false;
  }
  panelDismissHandler = null;
}
