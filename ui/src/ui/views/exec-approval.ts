import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import type { AppViewState } from "../app-view-state.ts";
import { icons } from "../icons.ts";

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
  const hours = Math.floor(minutes / 60);
  return `${hours}h`;
}

function renderMetaRow(label: string, value?: string | null) {
  if (!value) {
    return nothing;
  }
  return html`<div class="exec-approval-meta-row"><span>${label}</span><span>${value}</span></div>`;
}

function nodeListDisplayName(nodes: AppViewState["nodes"], nodeId: string): string {
  for (const node of nodes ?? []) {
    const id =
      typeof node.nodeId === "string" ? node.nodeId : typeof node.id === "string" ? node.id : "";
    if (id !== nodeId) {
      continue;
    }
    const name = typeof node.displayName === "string" ? node.displayName.trim() : "";
    if (name && name !== nodeId) {
      return name;
    }
  }
  return "";
}

function resolveLocalMachineLabel(
  state: AppViewState,
  request: AppViewState["execApprovalQueue"][number]["request"],
): string {
  const nodeId = request.nodeId?.trim() ?? "";
  const explicit = request.nodeDisplayName?.trim() ?? "";
  // A raw node id stuffed into the display-name field is not a machine name.
  if (explicit && explicit !== nodeId) {
    return explicit;
  }
  if (nodeId) {
    const listed = nodeListDisplayName(state.nodes, nodeId);
    if (listed) {
      return listed;
    }
    return nodeId;
  }
  return explicit || t("execApproval.local.unknownMachine");
}

function activeLocalExecApproval(state: AppViewState) {
  const active = state.execApprovalQueue[0];
  if (!active || active.request.host !== "node") {
    return null;
  }
  return active;
}

function renderLocalExecPermissionBody(state: AppViewState) {
  const active = activeLocalExecApproval(state);
  if (!active) {
    return nothing;
  }
  const request = active.request;
  const machine = resolveLocalMachineLabel(state, request);
  const queueCount = state.execApprovalQueue.length;
  return html`
    <div class="exec-approval-card exec-approval-card--local">
      <div class="exec-approval-header">
        <div class="exec-approval-title">
          <span class="exec-approval-warn" aria-hidden="true">${icons.alertTriangle}</span>
          <span>${t("execApproval.local.title")}</span>
        </div>
        ${
          queueCount > 1
            ? html`<div class="exec-approval-queue">${t("execApproval.pending", { count: String(queueCount) })}</div>`
            : nothing
        }
      </div>
      <div class="exec-approval-machine">${t("execApproval.local.machine", { name: machine })}</div>
      <div class="exec-approval-note">
        <span>${t("execApproval.local.note")}</span>
        <details class="exec-approval-command-toggle">
          <summary>${t("execApproval.local.viewCommand")}</summary>
          <div class="exec-approval-command mono">${request.command}</div>
        </details>
      </div>
      ${
        state.execApprovalError
          ? html`<div class="exec-approval-error">${state.execApprovalError}</div>`
          : nothing
      }
      <div class="exec-approval-actions">
        <button
          class="btn primary"
          data-decision="allow-always"
          ?disabled=${state.execApprovalBusy}
          @click=${() => state.handleExecApprovalDecision("allow-always")}
        >
          ${t("execApproval.local.alwaysAllow")}
        </button>
        <button
          class="btn"
          data-decision="allow-once"
          ?disabled=${state.execApprovalBusy}
          @click=${() => state.handleExecApprovalDecision("allow-once")}
        >
          ${t("execApproval.local.allowOnce")}
        </button>
        <button
          class="btn"
          data-decision="deny"
          ?disabled=${state.execApprovalBusy}
          @click=${() => state.handleExecApprovalDecision("deny")}
        >
          ${t("execApproval.local.never")}
        </button>
      </div>
    </div>
  `;
}

/**
 * Grok-style card implanted in the open conversation, after the transcript
 * and before the composer. Same approval id and decisions as the gateway queue.
 */
export function renderLocalExecPermissionInline(state: AppViewState) {
  const active = activeLocalExecApproval(state);
  if (!active) {
    return nothing;
  }
  return html`
    <div
      class="exec-approval-inline"
      data-surface="local-exec-permission"
      data-placement="conversation"
      data-approval-id=${active.id}
      role="group"
      aria-label=${t("execApproval.local.title")}
    >
      ${renderLocalExecPermissionBody(state)}
    </div>
  `;
}

function renderLocalExecPermissionOverlay(state: AppViewState) {
  const active = activeLocalExecApproval(state);
  if (!active) {
    return nothing;
  }
  return html`
    <div
      class="exec-approval-overlay"
      data-surface="local-exec-permission"
      data-placement="overlay"
      data-approval-id=${active.id}
      role="dialog"
      aria-live="polite"
    >
      ${renderLocalExecPermissionBody(state)}
    </div>
  `;
}

export function renderExecApprovalPrompt(
  state: AppViewState,
  opts?: { localCardInline?: boolean },
) {
  const active = state.execApprovalQueue[0];
  if (!active) {
    return nothing;
  }
  if (active.request.host === "node") {
    // The open chat already hosts this card in the transcript. A second
    // overlay would cover the dialogue the user is reading.
    if (opts?.localCardInline) {
      return nothing;
    }
    return renderLocalExecPermissionOverlay(state);
  }
  const request = active.request;
  const remainingMs = active.expiresAtMs - Date.now();
  const remaining =
    remainingMs > 0
      ? t("execApproval.expiresIn", { value: formatRemaining(remainingMs) })
      : t("execApproval.expired");
  const queueCount = state.execApprovalQueue.length;
  return html`
    <div class="exec-approval-overlay" role="dialog" aria-live="polite">
      <div class="exec-approval-card">
        <div class="exec-approval-header">
          <div>
            <div class="exec-approval-title">${t("execApproval.title")}</div>
            <div class="exec-approval-sub">${remaining}</div>
          </div>
          ${
            queueCount > 1
              ? html`<div class="exec-approval-queue">${t("execApproval.pending", { count: String(queueCount) })}</div>`
              : nothing
          }
        </div>
        <div class="exec-approval-command mono">${request.command}</div>
        <div class="exec-approval-meta">
          ${renderMetaRow(t("execApproval.fields.host"), request.host)}
          ${renderMetaRow(t("execApproval.fields.agent"), request.agentId)}
          ${renderMetaRow(t("execApproval.fields.session"), request.sessionKey)}
          ${renderMetaRow("CWD", request.cwd)}
          ${renderMetaRow(t("execApproval.fields.resolved"), request.resolvedPath)}
          ${renderMetaRow(t("execApproval.fields.security"), request.security)}
          ${renderMetaRow(t("execApproval.fields.ask"), request.ask)}
        </div>
        ${
          state.execApprovalError
            ? html`<div class="exec-approval-error">${state.execApprovalError}</div>`
            : nothing
        }
        <div class="exec-approval-actions">
          <button
            class="btn primary"
            ?disabled=${state.execApprovalBusy}
            @click=${() => state.handleExecApprovalDecision("allow-once")}
          >
            ${t("execApproval.allowOnce")}
          </button>
          <button
            class="btn"
            ?disabled=${state.execApprovalBusy}
            @click=${() => state.handleExecApprovalDecision("allow-always")}
          >
            ${t("execApproval.alwaysAllow")}
          </button>
          <button
            class="btn danger"
            ?disabled=${state.execApprovalBusy}
            @click=${() => state.handleExecApprovalDecision("deny")}
          >
            ${t("execApproval.deny")}
          </button>
        </div>
      </div>
    </div>
  `;
}
