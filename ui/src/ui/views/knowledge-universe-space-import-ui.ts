import { html, nothing, type TemplateResult } from "lit";
import { t } from "../../i18n/index.ts";

export type SpaceImportAlertVariant = "hint" | "notice" | "error";

export function renderSpaceImportProgress(
  progress: {
    current: number;
    total: number;
    label: string;
  } | null,
) {
  if (!progress || !progress.label.trim()) {
    return nothing;
  }
  const percent =
    progress.total > 0
      ? Math.max(0, Math.min(100, Math.round((progress.current / progress.total) * 100)))
      : 0;
  const indeterminate = progress.total <= 0;
  return html`
    <div
      class="ku-space-import__progress"
      data-testid="ku-space-import-progress"
      role="progressbar"
      aria-valuemin="0"
      aria-valuemax=${indeterminate ? nothing : 100}
      aria-valuenow=${indeterminate ? nothing : percent}
      aria-valuetext=${progress.label}
    >
      <p class="ku-space-import__progress-label">${progress.label}</p>
      <div class="ku-space-import__progress-track">
        <div
          class="ku-space-import__progress-fill ${indeterminate ? "is-indeterminate" : ""}"
          style=${indeterminate ? nothing : `width:${percent}%`}
        ></div>
      </div>
      <p class="ku-space-import__progress-hint">
        ${t("frontstage.workbench.knowledgeUniverse.importToSpace.localFolder.progress.batchHint")}
      </p>
    </div>
  `;
}

export function renderSpaceImportAlert(
  variant: SpaceImportAlertVariant,
  message: string,
  testId?: string,
) {
  if (!message.trim()) {
    return nothing;
  }
  return html`
    <p
      class="ku-space-import__alert ku-space-import__alert--${variant}"
      data-testid=${testId ?? nothing}
      role=${variant === "error" ? "alert" : "status"}
    >
      ${message}
    </p>
  `;
}

/** Flat section title — no nested card border. */
export function renderSpaceImportSection(title: string, body: TemplateResult) {
  return html`
    <section class="ku-space-import__section">
      <h3 class="ku-space-import__section-title">${title}</h3>
      <div class="ku-space-import__section-body">${body}</div>
    </section>
  `;
}

export function renderSpaceImportActionBar(content: TemplateResult) {
  return html`<div class="ku-space-import__actions">${content}</div>`;
}

/** Visual step rail for connector wizard (display-only). */
export function renderSpaceImportStepRail(steps: string[], activeIndex: number) {
  if (steps.length === 0) {
    return nothing;
  }
  return html`
    <ol class="ku-space-import__steps" aria-label="Progress">
      ${steps.map((label, index) => {
        const state = index < activeIndex ? "done" : index === activeIndex ? "active" : "pending";
        return html`
          <li class="ku-space-import__step ku-space-import__step--${state}">
            <span class="ku-space-import__step-index" aria-hidden="true">${index + 1}</span>
            <span class="ku-space-import__step-label">${label}</span>
          </li>
        `;
      })}
    </ol>
  `;
}

export function parseWizardSteps(hint: string): string[] {
  return hint
    .split(/\s*[→>]\s*/)
    .map((part) => part.replace(/[。.]\s*$/, "").trim())
    .filter(Boolean);
}
