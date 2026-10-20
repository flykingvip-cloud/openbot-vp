import { html, type TemplateResult } from "lit";
import {
  meterSemanticsLabel,
  type DraftMeterRow,
  type DraftPricingRow,
} from "./plan-version-actions.ts";

export function renderDeleteConfirmPanel(params: {
  versionNumber: number;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel?: string;
  busyLabel?: string;
  cancelLabel?: string;
  description?: string;
}): TemplateResult {
  return html`
    <section class="card card-follow--sm" data-testid="delete-confirm">
      <div class="card-title">删除版本 · v${params.versionNumber}</div>
      <div class="card-sub">
        ${
          params.description ?? "确认删除该版本？此操作不可撤销。生效中或被订阅引用的版本无法删除。"
        }
      </div>
      <div class="row card-follow--sm row--tight">
        <button
          class="btn btn--primary"
          data-testid="confirm-delete-btn"
          ?disabled=${params.busy}
          @click=${params.onConfirm}
        >
          ${params.busy ? (params.busyLabel ?? "删除中…") : (params.confirmLabel ?? "确认删除")}
        </button>
        <button class="btn" ?disabled=${params.busy} @click=${params.onCancel}>
          ${params.cancelLabel ?? "取消"}
        </button>
      </div>
    </section>
  `;
}

export function renderDraftEditorPanel(params: {
  rows: DraftPricingRow[];
  meters?: DraftMeterRow[];
  busy: boolean;
  title: string;
  modelsLabel: string;
  aorLabel: string;
  saveLabel: string;
  cancelLabel: string;
  onPriceInput: (index: number, value: string) => void;
  onMeterKeyInput?: (index: number, value: string) => void;
  onMeterUnitChange?: (index: number, value: DraftMeterRow["unit"]) => void;
  onMeterIncludedMode?: (index: number, value: DraftMeterRow["includedMode"]) => void;
  onMeterOverageMode?: (index: number, value: DraftMeterRow["overageMode"]) => void;
  onMeterQuotaInput?: (index: number, value: string) => void;
  onMeterAdd?: () => void;
  onMeterRemove?: (index: number) => void;
  modelLibraryContent: TemplateResult;
  aorEnableContent: TemplateResult;
  aorFieldsContent: TemplateResult;
  entitlementContent: TemplateResult;
  onSave: () => void;
  onCancel: () => void;
}): TemplateResult {
  const meters = params.meters ?? [];
  return html`
    <section class="card card-follow--sm" data-testid="draft-editor">
      <div class="card-title">${params.title}</div>
      <div class="list card-follow--xs">
        ${params.rows.map(
          (row, idx) => html`
            <div class="row row--tight">
              <span class="chip mono">${row.type}/${row.key}</span>
              <input
                type="number"
                .value=${row.priceYuan}
                ?disabled=${params.busy}
                @input=${(e: Event) =>
                  params.onPriceInput(idx, (e.target as HTMLInputElement).value)}
              />
            </div>
          `,
        )}
      </div>
      <div class="card-sub card-follow--sm">计量合同（MeterDefinition）</div>
      <div class="list card-follow--xs" data-testid="draft-meters-editor">
        ${meters.map(
          (m, idx) => html`
            <div
              class="row row--tight row--wrap"
              data-testid="draft-meter-row"
              data-meter-key=${m.key}
            >
              <input
                type="text"
                .value=${m.key}
                ?disabled=${params.busy}
                data-testid="meter-key"
                @input=${(e: Event) =>
                  params.onMeterKeyInput?.(idx, (e.target as HTMLInputElement).value)}
              />
              <select
                ?disabled=${params.busy}
                data-testid="meter-unit"
                @change=${(e: Event) =>
                  params.onMeterUnitChange?.(
                    idx,
                    (e.target as HTMLSelectElement).value as DraftMeterRow["unit"],
                  )}
              >
                ${(["credit", "token", "cent", "count"] as const).map(
                  (u) => html`<option value=${u} ?selected=${m.unit === u}>${u}</option>`,
                )}
              </select>
              <label class="muted">
                配额
                <input
                  type="number"
                  min="0"
                  step="1"
                  .value=${m.includedQuota}
                  ?disabled=${params.busy}
                  @input=${(e: Event) =>
                    params.onMeterQuotaInput?.(idx, (e.target as HTMLInputElement).value)}
                />
              </label>
              <select
                ?disabled=${params.busy}
                data-testid="meter-included-mode"
                @change=${(e: Event) =>
                  params.onMeterIncludedMode?.(
                    idx,
                    (e.target as HTMLSelectElement).value as DraftMeterRow["includedMode"],
                  )}
              >
                <option value="free" ?selected=${m.includedMode === "free"}>套餐内免费</option>
                <option value="usage_priced" ?selected=${m.includedMode === "usage_priced"}>
                  套餐内按量收费
                </option>
              </select>
              <select
                ?disabled=${params.busy}
                data-testid="meter-overage-mode"
                @change=${(e: Event) =>
                  params.onMeterOverageMode?.(
                    idx,
                    (e.target as HTMLSelectElement).value as DraftMeterRow["overageMode"],
                  )}
              >
                <option value="block" ?selected=${m.overageMode === "block"}>禁止超额</option>
                <option value="paid" ?selected=${m.overageMode === "paid"}>允许付费超额</option>
              </select>
              <span class="muted" data-testid="meter-semantics-label">
                ${meterSemanticsLabel(m)}
              </span>
              <button
                type="button"
                class="btn btn--sm"
                ?disabled=${params.busy}
                @click=${() => params.onMeterRemove?.(idx)}
              >
                删除
              </button>
            </div>
          `,
        )}
        <button
          type="button"
          class="btn btn--sm"
          data-testid="draft-meter-add"
          ?disabled=${params.busy}
          @click=${() => params.onMeterAdd?.()}
        >
          添加计量
        </button>
      </div>
      <div class="card-sub card-follow--sm">${params.modelsLabel}</div>
      <div class="platform-pricing__editor-aligned-control">${params.modelLibraryContent}</div>
      <div class="platform-pricing__section-heading-row card-follow--sm">
        <div class="card-sub">${params.aorLabel}</div>
        ${params.aorEnableContent}
      </div>
      ${params.aorFieldsContent} ${params.entitlementContent}
      <div class="row card-follow--sm row--tight">
        <button class="btn btn--primary" ?disabled=${params.busy} @click=${params.onSave}>
          ${params.saveLabel}
        </button>
        <button class="btn" ?disabled=${params.busy} @click=${params.onCancel}>
          ${params.cancelLabel}
        </button>
      </div>
    </section>
  `;
}
