import { html, type TemplateResult } from "lit";

/** True only when the read model explicitly says the first shell payload has not arrived. */
export function isPlatformShellPending(readModel: { shellSnapshotReady?: boolean }): boolean {
  return readModel.shellSnapshotReady === false;
}

export function renderPlatformSummaryPending(label: string): TemplateResult {
  return html`
    <section
      class="platform-summary-pending"
      aria-busy="true"
      aria-live="polite"
      aria-label=${`正在加载${label}`}
      data-testid="platform-summary-pending"
    >
      <p class="muted">正在加载${label}…</p>
    </section>
  `;
}
