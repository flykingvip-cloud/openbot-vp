/**
 * Artifact Card — renders an artifact as a clickable, actionable card in chat.
 *
 * This replaces the anti-pattern of listing file names in plain text.
 * Each artifact card provides: Open, Preview, Download actions.
 *
 * Rules:
 * - Every generated file MUST render as an ArtifactCard
 * - Cards are interactive (not just decorative)
 * - Cards show: icon, title, type label, size, summary, action buttons
 */

import { html, nothing } from "lit";
import { getArtifactIcon, getArtifactTypeLabel } from "./registry.ts";
import type { Artifact, ArtifactCardProps, Task, TaskCardProps } from "./types.ts";

/**
 * Format file size for display.
 */
function formatSize(bytes?: number): string {
  if (!bytes || bytes <= 0) {
    return "";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(0)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Render a single Artifact Card.
 *
 * This is the primary delivery surface for generated files.
 * It MUST be used instead of text-only file references.
 */
export function renderArtifactCard(props: ArtifactCardProps) {
  const { artifact, onOpen, onPreview, onDownload } = props;
  const icon = getArtifactIcon(artifact.type);
  const typeLabel = getArtifactTypeLabel(artifact.type);
  const sizeLabel = formatSize(artifact.metadata?.size);
  const stateLabel = resolveStateLabel(artifact.lifecycle_state);

  return html`
    <div class="artifact-card" data-artifact-id=${artifact.id} data-artifact-type=${artifact.type}>
      <div class="artifact-card__header">
        <span class="artifact-card__icon" aria-hidden="true">${icon}</span>
        <div class="artifact-card__info">
          <span class="artifact-card__title">${artifact.title}</span>
          <span class="artifact-card__meta">
            ${typeLabel}${sizeLabel ? ` · ${sizeLabel}` : ""}${stateLabel ? ` · ${stateLabel}` : ""}
          </span>
        </div>
      </div>

      ${
        artifact.summary
          ? html`
              <div class="artifact-card__summary">
                ${renderSummaryContent(artifact)}
              </div>
            `
          : nothing
      }

      <div class="artifact-card__actions">
        ${
          onOpen
            ? html`
                <button
                  class="artifact-card__action artifact-card__action--primary"
                  type="button"
                  @click=${() => onOpen(artifact.id)}
                  title="打开"
                >
                  打开
                </button>
              `
            : nothing
        }
        ${
          onPreview && artifact.previewable
            ? html`
                <button
                  class="artifact-card__action"
                  type="button"
                  @click=${() => onPreview(artifact.id)}
                  title="预览"
                >
                  预览
                </button>
              `
            : nothing
        }
        ${
          onDownload && artifact.downloadable
            ? html`
                <button
                  class="artifact-card__action"
                  type="button"
                  @click=${() => onDownload(artifact.id)}
                  title="下载"
                >
                  下载
                </button>
              `
            : nothing
        }
      </div>
    </div>
  `;
}

/**
 * Render a Task Card with its bound artifacts.
 *
 * The task card shows task status and lists all artifact deliverables.
 * This replaces the old "任务完成" text summary.
 */
export function renderTaskArtifactCard(props: TaskCardProps) {
  const { task, artifacts, onOpenArtifact, onPreviewArtifact, onDownloadArtifact } = props;
  const statusIcon = resolveTaskStatusIcon(task.status);
  const statusLabel = resolveTaskStatusLabel(task.status);
  const artifactCount = artifacts.length;

  return html`
    <div
      class="task-artifact-card"
      data-task-id=${task.id}
      data-task-status=${task.status}
    >
      <div class="task-artifact-card__header">
        <span class="task-artifact-card__status-icon">${statusIcon}</span>
        <span class="task-artifact-card__title">${task.title}</span>
        <span class="task-artifact-card__status">${statusLabel}</span>
        ${
          artifactCount > 0
            ? html`<span class="task-artifact-card__count">${artifactCount}个成果</span>`
            : nothing
        }
      </div>

      ${
        artifacts.length > 0
          ? html`
              <div class="task-artifact-card__artifacts">
                ${artifacts.map(
                  (artifact) => html`
                    ${renderArtifactCard({
                      artifact,
                      onOpen: onOpenArtifact,
                      onPreview: onPreviewArtifact,
                      onDownload: onDownloadArtifact,
                    })}
                  `,
                )}
              </div>
            `
          : nothing
      }

      ${
        task.message && task.status === "running"
          ? html`<div class="task-artifact-card__message">${task.message}</div>`
          : nothing
      }
    </div>
  `;
}

/**
 * Render multiple artifact cards as a delivery group.
 * Used when a task produces multiple deliverables.
 */
export function renderArtifactDeliveryGroup(
  artifacts: Artifact[],
  handlers: {
    onOpen?: (artifactId: string) => void;
    onPreview?: (artifactId: string) => void;
    onDownload?: (artifactId: string) => void;
  },
) {
  if (artifacts.length === 0) {
    return nothing;
  }

  return html`
    <div class="artifact-delivery-group">
      ${artifacts.map(
        (artifact) => html`
          ${renderArtifactCard({
            artifact,
            onOpen: handlers.onOpen,
            onPreview: handlers.onPreview,
            onDownload: handlers.onDownload,
          })}
        `,
      )}
    </div>
  `;
}

/**
 * Render the session recovery prompt showing recent artifacts.
 */
export function renderArtifactRecoveryPrompt(artifacts: Artifact[], onContinue?: () => void) {
  if (artifacts.length === 0) {
    return nothing;
  }

  return html`
    <div class="artifact-recovery-prompt">
      <div class="artifact-recovery-prompt__title">
        你有最近生成的成果：
      </div>
      <div class="artifact-recovery-prompt__list">
        ${artifacts.map(
          (artifact) => html`
            <div class="artifact-recovery-prompt__item">
              <span class="artifact-recovery-prompt__icon">${getArtifactIcon(artifact.type)}</span>
              <span class="artifact-recovery-prompt__name">${artifact.title}</span>
            </div>
          `,
        )}
      </div>
      ${
        onContinue
          ? html`
              <button
                class="artifact-recovery-prompt__action"
                type="button"
                @click=${onContinue}
              >
                继续查看
              </button>
            `
          : nothing
      }
    </div>
  `;
}

// ─── Helpers ───────────────────────────────────────────────────────────

function resolveStateLabel(state: string): string {
  switch (state) {
    case "generating":
      return "生成中";
    case "registered":
      return "已生成";
    case "previewing":
      return "预览中";
    case "editing":
      return "编辑中";
    case "persisted":
      return "已保存";
    case "recovered":
      return "已恢复";
    default:
      return "";
  }
}

function resolveTaskStatusIcon(status: Task["status"]): string {
  switch (status) {
    case "running":
      return "⏳";
    case "waiting":
      return "⏸";
    case "success":
      return "✅";
    case "failed":
      return "❌";
  }
}

function resolveTaskStatusLabel(status: Task["status"]): string {
  switch (status) {
    case "running":
      return "执行中";
    case "waiting":
      return "等待中";
    case "success":
      return "已完成";
    case "failed":
      return "失败";
  }
}

function renderSummaryContent(artifact: Artifact) {
  const summary = artifact.summary ?? "";
  if (!summary) {
    return nothing;
  }

  // Parse bullet-point summaries
  const lines = summary.split("\n").filter((line) => line.trim());
  if (lines.length <= 1) {
    return html`<span>${summary}</span>`;
  }

  return html`
    <ul class="artifact-card__summary-list">
      ${lines.map((line) => html`<li>${line.replace(/^[-•·]\s*/, "")}</li>`)}
    </ul>
  `;
}
