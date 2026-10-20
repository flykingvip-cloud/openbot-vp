/**
 * Control-ui observability for collaboration wake / claim board / peer reviews.
 * Thin read-only surface over existing RPCs — no new exec system.
 */
import { html, nothing } from "lit";
import type {
  CollaborationBoardClaimRow,
  CollaborationMemberProgressSnapshot,
  CollaborationObservabilitySnapshot,
  CollaborationPeerReviewRow,
  CollaborationWakeTimelineRow,
} from "../controllers/collaboration-observability.ts";

export type CollaborationObservabilityPanelProps = {
  loading?: boolean;
  error?: string | null;
  snapshot?: CollaborationObservabilitySnapshot | null;
  onRefresh?: (() => void) | null;
  /** Cap wake rows shown (newest first). */
  wakeLimit?: number;
};

function formatWhen(at: number | null | undefined): string {
  if (typeof at !== "number" || !Number.isFinite(at) || at <= 0) {
    return "—";
  }
  try {
    return new Date(at).toLocaleString();
  } catch {
    return String(at);
  }
}

function newestFirst<T extends { at: number }>(rows: readonly T[]): T[] {
  return [...rows].toSorted((a, b) => b.at - a.at);
}

function renderWakeRows(rows: readonly CollaborationWakeTimelineRow[], limit: number) {
  const sliced = newestFirst(rows).slice(0, limit);
  if (sliced.length === 0) {
    return html`
      <p class="muted" data-testid="collab-obs-wake-empty">暂无唤醒记录</p>
    `;
  }
  return html`
    <table class="employee-workbench__governance-kv mono" data-testid="collab-obs-wake-table">
      <thead>
        <tr>
          <th>From</th>
          <th>To</th>
          <th>Source</th>
          <th>Outcome</th>
          <th>When</th>
        </tr>
      </thead>
      <tbody>
        ${sliced.map(
          (row) => html`
            <tr data-wake-id=${row.wakeId}>
              <td>${row.from || "—"}</td>
              <td>${row.to || "—"}</td>
              <td>${row.source}</td>
              <td>${row.outcome}</td>
              <td>${formatWhen(row.at)}</td>
            </tr>
          `,
        )}
      </tbody>
    </table>
  `;
}

function renderBoardRows(items: readonly CollaborationBoardClaimRow[]) {
  if (items.length === 0) {
    return html`
      <p class="muted" data-testid="collab-obs-claim-empty">暂无看板认领项</p>
    `;
  }
  return html`
    <ul class="employee-workbench__collaboration-rules-list" data-testid="collab-obs-claim-list">
      ${items.map(
        (item) => html`
          <li class="employee-workbench__collaboration-rules-item">
            <strong>${item.title || item.itemId}</strong>
            · ${item.status}
            ${item.claimantId ? html` · claimant ${item.claimantId}` : nothing}
            ${item.submissionId ? html` · sub ${item.submissionId}` : nothing}
          </li>
        `,
      )}
    </ul>
  `;
}

function renderPeerRows(reviews: readonly CollaborationPeerReviewRow[]) {
  if (reviews.length === 0) {
    return html`
      <p class="muted" data-testid="collab-obs-peer-empty">暂无 peer review</p>
    `;
  }
  return html`
    <ul class="employee-workbench__collaboration-rules-list" data-testid="collab-obs-peer-list">
      ${newestFirst(reviews).map(
        (review) => html`
          <li class="employee-workbench__collaboration-rules-item">
            ${review.reviewerId} → ${review.verdict} on ${review.itemId}
            <span class="muted">(${formatWhen(review.at)})</span>
            ${review.comment ? html` — ${review.comment}` : nothing}
          </li>
        `,
      )}
    </ul>
  `;
}

function renderProgress(progress: CollaborationMemberProgressSnapshot | null) {
  if (!progress) {
    return nothing;
  }
  return html`
    <p class="muted" data-testid="collab-obs-progress-summary">
      members ${progress.memberCount} · items ${progress.itemCount}
      ${progress.unclaimed.length ? html` · unclaimed ${progress.unclaimed.length}` : nothing}
      ${progress.gaps.length ? html` · gaps ${progress.gaps.length}` : nothing}
    </p>
  `;
}

export function renderCollaborationObservabilityPanel(props: CollaborationObservabilityPanelProps) {
  const limit = props.wakeLimit ?? 40;
  const snapshot = props.snapshot ?? null;
  return html`
    <section
      class="employee-workbench__governance-section--flat"
      data-testid="collab-obs-panel"
    >
      <header class="employee-workbench__governance-section-head">
        <div class="employee-workbench__governance-section-title">协作可观测 · Wake / Claim / Peer</div>
        <div class="employee-workbench__governance-section-subtitle">
          只读：whoWokeWhom / listBoardItems / listPeerReviews（不改 LIVE）
        </div>
        ${
          props.onRefresh
            ? html`<button
                type="button"
                class="btn btn--sm"
                data-testid="collab-obs-refresh"
                ?disabled=${props.loading === true}
                @click=${() => props.onRefresh?.()}
              >
                <span>${props.loading ? "刷新中…" : "刷新"}</span>
              </button>`
            : nothing
        }
      </header>
      <div class="employee-workbench__governance-section-body">
        ${
          props.loading && !snapshot
            ? html`
                <p class="muted" data-testid="collab-obs-loading">加载协作事件…</p>
              `
            : nothing
        }
        ${
          props.error
            ? html`<p class="employee-workbench__member-governance-banner is-error" data-testid="collab-obs-error">
                ${props.error}
              </p>`
            : nothing
        }
        ${
          snapshot
            ? html`
                <p class="muted" data-testid="collab-obs-scope">
                  group ${snapshot.groupId}
                  ${
                    snapshot.taskId
                      ? html` · task ${snapshot.taskId}`
                      : html`
                          · 全部任务唤醒
                        `
                  }
                  · wake ${snapshot.timeline.length}
                </p>
                <h4 class="employee-workbench__governance-section-title">谁唤醒了谁</h4>
                ${renderWakeRows(snapshot.timeline, limit)}
                ${
                  snapshot.taskId
                    ? html`
                        <h4 class="employee-workbench__governance-section-title">看板认领</h4>
                        ${renderProgress(snapshot.memberProgress)}
                        ${renderBoardRows(snapshot.boardItems)}
                        <h4 class="employee-workbench__governance-section-title">Peer reviews</h4>
                        ${renderPeerRows(snapshot.peerReviews)}
                      `
                    : html`
                        <p class="muted">打开任务详情可查看该任务的 claim / peer。</p>
                      `
                }
              `
            : !props.loading && !props.error
              ? html`
                  <p class="muted" data-testid="collab-obs-idle">选择协作小组后可查看唤醒时间线。</p>
                `
              : nothing
        }
      </div>
    </section>
  `;
}
