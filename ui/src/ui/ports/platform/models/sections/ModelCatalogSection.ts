import { html } from "lit";
import type { PlatformPortRenderModel } from "../../view-types.ts";
import type { LegacyPlatformModelsVM as PlatformModelsVM } from "../view-model.ts";

export function renderModelCatalogSection(
  vm: PlatformModelsVM,
  actions: PlatformPortRenderModel["surfaceActions"],
) {
  return html`
    <section class="card card-follow">
      <div class="row row--split">
        <div>
          <div class="card-title">网关模型目录对照</div>
        </div>
        <button class="btn" @click=${() => actions.models.onRefreshCatalog()}>刷新目录</button>
      </div>
      <div class="chip-row card-follow">
        <span class="chip">目录 ${vm.gatewayCatalogEntries.length} 个</span>
        <span class="chip"
          >已入池 ${vm.gatewayCatalogEntries.filter((entry) => entry.inPool).length} 个</span
        >
        <span class="chip"
          >待导入 ${vm.gatewayCatalogEntries.filter((entry) => !entry.inPool).length} 个</span
        >
      </div>
      <div class="list card-follow">
        ${
          vm.gatewayCatalogEntries.length === 0
            ? html`
                <div class="muted">当前还没有加载网关模型目录，点击“刷新目录”后再进行对照。</div>
              `
            : vm.gatewayCatalogEntries.map(
                (entry) => html`
                  <div class="list-item">
                    <div class="list-main">
                      <div class="list-title">${entry.providerId}/${entry.modelId}</div>
                      <div class="list-sub">${entry.name} · 上下文 ${entry.contextWindow}</div>
                    </div>
                    <div class="row row--tight">
                      <span class="chip ${entry.inPool ? "" : "warn"}"
                        >${entry.inPool ? "已入池" : "待导入"}</span
                      >
                      ${
                        entry.inPool
                          ? ""
                          : html`
                              <button
                                class="btn btn--sm"
                                ?disabled=${!vm.canManage}
                                @click=${() =>
                                  actions.models.onImportCatalogModel({
                                    providerId: entry.providerId,
                                    modelId: entry.modelId,
                                    name: entry.name,
                                    contextWindow: entry.contextWindowRaw,
                                  })}
                              >
                                导入模型池
                              </button>
                            `
                      }
                    </div>
                  </div>
                `,
              )
        }
      </div>
    </section>
  `;
}
