/**
 * 平台端「套餐⇄模型」统一配置区块（legacy 独立入口，主流程见 pricing 页）。
 *
 * 读写已收口至 `platform-plan-bundle.overview` / `platform-plan-bundle.update`。
 */

import { LitElement, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  buildPlatformModelBindingView,
  toggleModelForPlan,
  type PlatformModelBindingOverview,
} from "../capability/platform-model-binding/index.ts";
import {
  buildBundleUpdatePayload,
  buildModelBindingOverviewFromBundleResponse,
  createPlatformPlanBundleGateway,
  indexBundleVersionMeta,
  type PlatformPlanBundleVersionRow,
} from "../capability/platform-plan-bundle/index.ts";
import type { GatewayBrowserClient } from "../gateway.ts";

@customElement("platform-plan-model-binding-section")
export class PlatformPlanModelBindingSection extends LitElement {
  protected createRenderRoot() {
    return this;
  }

  @property({ attribute: false }) client: GatewayBrowserClient | null = null;

  @state() private overview: PlatformModelBindingOverview | null = null;
  @state() private versionMetaById: Record<string, PlatformPlanBundleVersionRow> = {};
  @state() private busy = false;
  @state() private error: string | null = null;
  @state() private notice: string | null = null;
  @state() private loaded = false;

  connectedCallback() {
    super.connectedCallback();
    void this.load();
  }

  private async load() {
    if (!this.client) {
      return;
    }
    this.busy = true;
    this.error = null;
    try {
      const bundle = createPlatformPlanBundleGateway(this.client);
      const res = await bundle.overview({
        debugSource: "legacy.platformPlanModelBindingSection.load",
        debugModuleUrl: import.meta.url,
      });
      this.versionMetaById = indexBundleVersionMeta(res);
      this.overview = buildModelBindingOverviewFromBundleResponse(res);
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    } finally {
      this.busy = false;
      this.loaded = true;
    }
  }

  private async toggle(planId: string, planVersionId: string, modelId: string, included: boolean) {
    if (!this.client || !this.overview) {
      return;
    }
    const nextAllowed = toggleModelForPlan(this.overview, planId, modelId, included);
    this.busy = true;
    this.error = null;
    this.notice = null;
    try {
      const meta = this.versionMetaById[planVersionId] ?? null;
      await createPlatformPlanBundleGateway(this.client).update(
        buildBundleUpdatePayload(planId, meta, nextAllowed),
      );
      this.notice = "模型绑定已保存。";
      await this.load();
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
      this.busy = false;
    }
  }

  render() {
    if (!this.loaded && this.busy) {
      return html`
        <div class="card"><div class="card-sub">加载套餐⇄模型配置…</div></div>
      `;
    }
    if (!this.overview) {
      return html`
        <div class="card">
          <div class="card-title">套餐 · 可用模型</div>
          <div class="card-sub">${this.error ?? "暂无数据"}</div>
        </div>
      `;
    }
    const view = buildPlatformModelBindingView(this.overview);
    return html`
      <section class="platform-plan-model-binding">
        ${this.error ? html`<div class="alert danger">${this.error}</div>` : nothing}
        ${this.notice ? html`<div class="alert success">${this.notice}</div>` : nothing}

        <div class="card">
          <div class="card-title">套餐 · 可用模型（勾选即生效，自动刷新存量订阅）</div>
          ${
            view.matrix.length === 0
              ? html`
                  <div class="card-sub">暂无套餐。</div>
                `
              : view.matrix.map(
                  (row) => html`
                  <div class="plan-model-row" data-plan-id=${row.planId} style="margin-top: 12px;">
                    <div class="card-sub">
                      <strong>${row.name}</strong> · ${row.status}
                    </div>
                    <div class="stack" style="margin-top: 6px;">
                      ${row.cells.map(
                        (cell) => html`
                          <label class="row" style="gap: 8px; align-items: center;">
                            <input
                              type="checkbox"
                              .checked=${cell.included}
                              ?disabled=${this.busy}
                              @change=${(e: Event) =>
                                void this.toggle(
                                  row.planId,
                                  row.currentVersionId,
                                  cell.modelId,
                                  (e.target as HTMLInputElement).checked,
                                )}
                            />
                            <span>${cell.modelId}</span>
                          </label>
                        `,
                      )}
                    </div>
                  </div>
                `,
                )
          }
        </div>

        <div class="card" style="margin-top: 12px;">
          <div class="card-title">模型 · 被哪些套餐包含（反向视图）</div>
          <div class="stack" style="margin-top: 6px;">
            ${view.reverse.map(
              (r) => html`
                <div class="model-reverse-row" data-model-id=${r.modelId}>
                  <span>${r.modelId}</span>
                  <span class="muted">
                    → ${r.planNames.length > 0 ? r.planNames.join(", ") : "（未被任何套餐包含）"}
                  </span>
                </div>
              `,
            )}
          </div>
        </div>
      </section>
    `;
  }
}
