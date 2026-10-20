import { html } from "lit";
import type { LegacyPlatformModelsVM as PlatformModelsVM } from "../view-model.ts";

function statusLabel(status: PlatformModelsVM["providerHealthEntries"][number]["authStatus"]) {
  switch (status) {
    case "ok":
      return "已配置";
    case "external":
      return "外部链路";
    default:
      return "待修复";
  }
}

export function renderModelProviderHealthSection(vm: PlatformModelsVM) {
  return html`
    <section class="card card-follow">
      <div class="card-title">Provider 接入健康</div>
      <div class="list card-follow">
        ${
          vm.providerHealthEntries.length === 0
            ? html`
                <div class="muted">当前没有可分析的 provider。</div>
              `
            : vm.providerHealthEntries.map(
                (entry) => html`
                  <div class="list-item">
                    <div class="list-main">
                      <div class="list-title">${entry.providerId}</div>
                      <div class="list-sub">${entry.issue}</div>
                      <div class="chip-row card-follow--sm">
                        <span class="chip">鉴权 ${entry.authMode}</span>
                        <span class="chip ${entry.authStatus === "warn" ? "warn" : ""}">
                          ${statusLabel(entry.authStatus)}
                        </span>
                        <span class="chip">模型 ${entry.modelCount}</span>
                        <span class="chip">目录 ${entry.catalogCount}</span>
                        <span class="chip mono">${entry.authLabel}</span>
                      </div>
                    </div>
                  </div>
                `,
              )
        }
      </div>
    </section>
  `;
}
