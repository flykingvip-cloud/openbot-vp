import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import type { AppViewState } from "../app-view-state.ts";
import type { LocalFileApprovalDecision } from "../controllers/local-file-approval.ts";
import { icons } from "../icons.ts";

/**
 * Disk read approval card, in the same conversation slot as the local exec card.
 *
 * Allow Once covers this turn. Allow Always remembers the exact resolved path
 * (a directory listing does not grant child reads). Hard-deny paths never reach
 * this card. The gateway still returns the opaque denial to the model when the
 * user refuses or the path cannot be granted.
 */

function formatRemaining(ms: number): string {
  const remaining = Math.max(0, ms);
  const totalSeconds = Math.floor(remaining / 1000);
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  return `${Math.floor(minutes / 60)}h`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const kib = bytes / 1024;
  if (kib < 1024) {
    return `${Math.round(kib)} KiB`;
  }
  return `${Math.round((kib / 1024) * 10) / 10} MiB`;
}

function decide(state: AppViewState, decision: LocalFileApprovalDecision) {
  // The shell method forwards the decision string to localFiles.approval.resolve.
  const settle = state.handleLocalFileApprovalDecision as (
    decision: LocalFileApprovalDecision,
  ) => void;
  settle(decision);
}

function renderLocalFileApprovalBody(state: AppViewState) {
  const active = state.localFileApprovalQueue[0];
  if (!active) {
    return nothing;
  }
  const request = active.request;
  const remainingMs = active.expiresAtMs - Date.now();
  const remaining =
    remainingMs > 0
      ? t("localFileApproval.expiresIn", { value: formatRemaining(remainingMs) })
      : t("localFileApproval.expired");
  const queueCount = state.localFileApprovalQueue.length;
  const budget = request.budget;
  const showBudget = Boolean(budget && budget.maxCalls > 1);
  const machine = request.nodeDisplayName?.trim();

  return html`
    <div class="exec-approval-card exec-approval-card--local">
      <div class="exec-approval-header">
        <div>
          <div class="exec-approval-title">
            <span class="exec-approval-warn">${icons.alertTriangle}</span>
            <span>${t("localFileApproval.title")}</span>
          </div>
          <div class="exec-approval-sub">${remaining}</div>
        </div>
        ${
          queueCount > 1
            ? html`<div class="exec-approval-queue">
                ${t("localFileApproval.pending", { count: String(queueCount) })}
              </div>`
            : nothing
        }
      </div>
      ${
        machine
          ? html`<div class="exec-approval-machine">
              ${t("execApproval.local.machine", { name: machine })}
            </div>`
          : nothing
      }
      <div class="exec-approval-meta" data-field="intent">
        ${t("localFileApproval.intent", {
          agent: request.agentId || t("localFileApproval.unknownAgent"),
          action: request.taskDescription,
        })}
      </div>
      <div class="exec-approval-command mono">${request.canonicalPath}</div>
      ${
        showBudget && budget
          ? html`<div class="exec-approval-sub" data-field="budget">
              ${t("localFileApproval.budget", {
                entries: String(budget.maxEntriesRead),
                bytes: formatBytes(budget.maxTotalExpandedBytes),
              })}
            </div>`
          : nothing
      }
      ${
        state.localFileApprovalError
          ? html`<div class="exec-approval-error">${state.localFileApprovalError}</div>`
          : nothing
      }
      <div class="exec-approval-actions">
        <button
          class="btn primary"
          data-decision="allow-always"
          ?disabled=${state.localFileApprovalBusy}
          @click=${() => decide(state, "allow-always")}
        >
          ${t("execApproval.local.alwaysAllow")}
        </button>
        <button
          class="btn"
          data-decision="allow-once"
          ?disabled=${state.localFileApprovalBusy}
          @click=${() => decide(state, "allow-once")}
        >
          ${t("execApproval.local.allowOnce")}
        </button>
        <button
          class="btn"
          data-decision="deny"
          ?disabled=${state.localFileApprovalBusy}
          @click=${() => decide(state, "deny")}
        >
          ${t("execApproval.local.never")}
        </button>
      </div>
      <div class="exec-approval-sub" data-field="note">${t("localFileApproval.note")}</div>
    </div>
  `;
}

/** Card implanted in the open conversation, after the transcript and before the composer. */
export function renderLocalFileApprovalInline(state: AppViewState) {
  const active = state.localFileApprovalQueue[0];
  if (!active) {
    return nothing;
  }
  return html`
    <div
      class="exec-approval-inline"
      data-surface="local-file-approval"
      data-placement="conversation"
      data-approval-id=${active.id}
      role="group"
      aria-label=${t("localFileApproval.title")}
    >
      ${renderLocalFileApprovalBody(state)}
    </div>
  `;
}

function renderLocalFileApprovalOverlay(state: AppViewState) {
  const active = state.localFileApprovalQueue[0];
  if (!active) {
    return nothing;
  }
  return html`
    <div
      class="exec-approval-overlay"
      data-surface="local-file-approval"
      data-placement="overlay"
      data-approval-id=${active.id}
      role="dialog"
      aria-live="polite"
    >
      ${renderLocalFileApprovalBody(state)}
    </div>
  `;
}

export function renderLocalFileApprovalPrompt(state: AppViewState, opts?: { inline?: boolean }) {
  if (!state.localFileApprovalQueue[0]) {
    return nothing;
  }
  // The open chat already hosts this card. A second overlay would cover the dialogue.
  if (opts?.inline) {
    return nothing;
  }
  return renderLocalFileApprovalOverlay(state);
}
