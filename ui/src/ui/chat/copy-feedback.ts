import { recordExternalizationSignal } from "../controllers/asset-incubation/externalization-tracker.ts";

const COPIED_FOR_MS = 1500;
const ERROR_FOR_MS = 2000;

export type CopyFeedbackLabels = {
  idle: string;
  done: string;
  error: string;
};

export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!text) {
    return false;
  }
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function setCopyButtonLabel(button: HTMLButtonElement, label: string): void {
  button.title = label;
  button.setAttribute("aria-label", label);
}

/**
 * Shared copy affordance behaviour: busy → copied/failed → back to idle. Used by both the lit-rendered
 * copy buttons and the delegated code-block buttons injected into sanitized markdown, so the two paths
 * stay visually and functionally identical.
 */
export async function runCopyWithFeedback(params: {
  button: HTMLButtonElement;
  text: () => string;
  labels: CopyFeedbackLabels;
  contextId?: string | null;
}): Promise<void> {
  const { button, labels } = params;
  if (button.dataset.copying === "1") {
    return;
  }

  button.dataset.copying = "1";
  button.setAttribute("aria-busy", "true");
  button.disabled = true;

  const copied = await copyTextToClipboard(params.text());
  if (!button.isConnected) {
    return;
  }

  delete button.dataset.copying;
  button.removeAttribute("aria-busy");
  button.disabled = false;

  if (!copied) {
    button.dataset.error = "1";
    setCopyButtonLabel(button, labels.error);
    window.setTimeout(() => {
      if (!button.isConnected) {
        return;
      }
      delete button.dataset.error;
      setCopyButtonLabel(button, labels.idle);
    }, ERROR_FOR_MS);
    return;
  }

  button.dataset.copied = "1";
  setCopyButtonLabel(button, labels.done);
  recordExternalizationSignal({ kind: "copy", contextId: params.contextId ?? null });

  window.setTimeout(() => {
    if (!button.isConnected) {
      return;
    }
    delete button.dataset.copied;
    setCopyButtonLabel(button, labels.idle);
  }, COPIED_FOR_MS);
}
