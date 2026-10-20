import { html, nothing } from "lit";
import type { ProgressView } from "../../../../../../src/progress-ledger/types.ts";
import {
  formatAcceptanceBadge,
  formatExecutionSummary,
  formatLatestReplanLine,
  formatListProgressLine,
  formatReplanHistoryLine,
  formatStaleLabel,
  shouldRenderChatStrip,
  shouldRenderProgressChrome,
} from "../../../../../../src/progress-ledger/view-copy.ts";
import type { CronJob } from "../../../types.ts";

export function readJobProgress(job: CronJob): ProgressView | null {
  const progress = job.progress;
  if (!progress || progress.projectionKind !== "canonical") {
    return null;
  }
  return progress;
}

function nodeMark(tone: ProgressView["nodes"][number]["tone"]): string {
  if (tone === "done") {
    return "✓";
  }
  if (tone === "current" || tone === "blocked") {
    return "●";
  }
  if (tone === "failed") {
    return "!";
  }
  return "○";
}

export function renderProgressLedgerListLine(job: CronJob, nowMs = Date.now()) {
  const view = readJobProgress(job);
  if (!view) {
    return nothing;
  }
  const stale = formatStaleLabel(view, nowMs);
  return html`
    <div class="employee-cron-center__progress">
      <span>${formatListProgressLine(view)}</span>
      ${stale ? html`<span class="employee-cron-center__progress-stale">${stale}</span>` : nothing}
    </div>
  `;
}

export function renderProgressLedgerChatStrip(
  view: ProgressView | null,
  options?: { nowMs?: number; expandable?: boolean },
) {
  if (!view || !shouldRenderProgressChrome(view)) {
    return nothing;
  }
  const stale = formatStaleLabel(view, options?.nowMs ?? Date.now());
  const body = html`
    <div class="progress-ledger-strip__layer1">${view.headline}</div>
    <div class="progress-ledger-strip__layer2">${view.focus}</div>
    ${stale ? html`<div class="progress-ledger-strip__stale">${stale}</div>` : nothing}
  `;
  if (!options?.expandable) {
    return html`<aside class="progress-ledger-strip">${body}</aside>`;
  }
  return html`
    <details class="progress-ledger-strip progress-ledger-strip--details">
      <summary>
        ${body}
        <span class="progress-ledger-strip__more">查看执行进度</span>
      </summary>
      <ol class="progress-ledger-strip__nodes">
        ${view.nodes.map(
          (node) => html`
            <li class="progress-ledger-strip__node is-${node.tone}">
              <span aria-hidden="true">${nodeMark(node.tone)}</span>
              <span>${node.title}</span>
            </li>
          `,
        )}
      </ol>
      <p class="progress-ledger-strip__exec">${formatExecutionSummary(view)}</p>
    </details>
  `;
}

export function renderProgressLedgerDetail(job: CronJob, nowMs = Date.now()) {
  const view = readJobProgress(job);
  if (!view) {
    return nothing;
  }
  const latestReplan = formatLatestReplanLine(view);
  return html`
    <section class="employee-cron-panel__progress">
      ${renderProgressLedgerChatStrip(view, { nowMs, expandable: true })}
      <div class="employee-cron-panel__progress-meta">
        <span>${formatAcceptanceBadge(view)}</span>
        <span>${formatExecutionSummary(view)}</span>
      </div>
      ${
        latestReplan
          ? html`
            <p class="employee-cron-panel__replan">${latestReplan}</p>
            ${
              view.replans.length > 1
                ? html`
                  <ol class="employee-cron-panel__replan-history">
                    ${view.replans.map((item) => html`<li>${formatReplanHistoryLine(item)}</li>`)}
                  </ol>
                `
                : nothing
            }
          `
          : nothing
      }
    </section>
  `;
}

/** Isolated cron execution session, not a conversation identity. */
export function isCronExecutionSessionKey(sessionKey: string, jobId?: string): boolean {
  const key = sessionKey.trim();
  if (!key) {
    return false;
  }
  if (jobId && key.includes(`cron:${jobId}`)) {
    return true;
  }
  return /(?:^|:)cron:/.test(key);
}

export function findProgressForSession(
  jobs: readonly CronJob[],
  sessionKey: string,
): ProgressView | null {
  const key = sessionKey.trim();
  if (!key) {
    return null;
  }
  for (const job of jobs) {
    const view = readJobProgress(job);
    if (!view || !shouldRenderChatStrip(view)) {
      continue;
    }
    // Only the isolated cron session may show this job's ledger.
    // Main / group conversations must not treat unbound cron as ConversationTask.
    if (isCronExecutionSessionKey(key, job.id)) {
      return view;
    }
  }
  return null;
}
