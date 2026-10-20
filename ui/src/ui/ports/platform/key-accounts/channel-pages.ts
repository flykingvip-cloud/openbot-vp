import { html, nothing } from "lit";
import { pushAppHistoryState } from "../../../request-app-rerender.ts";
import { productizationArtifactHref } from "../productization/routes.ts";
import { followPortHref } from "../shared/surface.ts";
import { COMMERCE_ISSUANCE_NOTE, commerceIssuanceHref } from "./delivery-links.ts";
import {
  KEY_ACCOUNT_PREINSTALL_LINE,
  SETTLEMENT_SUMMARIES,
  settlementModeLabel,
  type WhiteLabelDraft,
} from "./fixtures.ts";
import { partnerBoundTrains, partnerInstallValue } from "./install-status.ts";
import {
  keyAccountRouteAnchor,
  renderKeyAccountNotice,
  rerenderKeyAccountPage,
} from "./render-shared.ts";
import { keyAccountHref } from "./routes.ts";
import { signedAppPackageReference } from "./signed-app-catalog.ts";
import {
  associateSignedPackage,
  emptyWhiteLabelDraft,
  findKeyAccountPartner,
  listKeyAccountPartners,
  publishWhiteLabel,
  rollbackWhiteLabel,
  saveWhiteLabelDraft,
  signedPackageChoices,
  unlinkSignedPackage,
  whiteLabelVersionForPackage,
  type KeyAccountPartner,
} from "./state.ts";

let labelDraft: WhiteLabelDraft | null = null;
let labelPartner = "";
let packageDraft = "";
let metadataPackageId = "";

export function resetChannelPageState(): void {
  labelDraft = null;
  labelPartner = "";
  packageDraft = "";
  metadataPackageId = "";
}

function draftDiffers(draft: WhiteLabelDraft, published: KeyAccountPartner["published"]): boolean {
  if (!published) {
    return true;
  }
  return (
    draft.displayName !== published.displayName ||
    draft.logoName !== published.logoName ||
    draft.primary !== published.primary ||
    draft.accent !== published.accent ||
    draft.splash !== published.splash
  );
}

function ensureLabelDraft(partner: KeyAccountPartner): WhiteLabelDraft {
  if (labelPartner !== partner.code || !labelDraft) {
    labelPartner = partner.code;
    labelDraft = partner.draft ? { ...partner.draft } : emptyWhiteLabelDraft(partner.displayName);
  }
  return labelDraft;
}

function renderPartnerSwitch(
  basePath: string,
  current: string,
  page: "whiteLabel" | "preinstall" | "settlement",
) {
  return html`
    <label class="field">
      <span>当前伙伴</span>
      <select
        .value=${current}
        @change=${(event: Event) => {
          const code = (event.target as HTMLSelectElement).value;
          labelDraft = null;
          pushAppHistoryState(keyAccountHref(basePath, page, code));
        }}
      >
        ${listKeyAccountPartners().map(
          (partner) =>
            html`<option value=${partner.code}>${partner.displayName}（${partner.code}）</option>`,
        )}
      </select>
    </label>
  `;
}

export function renderWhiteLabel(basePath: string, partnerCode: string | null, canWrite: boolean) {
  const partner = findKeyAccountPartner(partnerCode) ?? listKeyAccountPartners()[0] ?? null;
  if (!partner) {
    return html`
      <p class="ka-note">台账里还没有伙伴。</p>
    `;
  }
  const draft = ensureLabelDraft(partner);
  const published = partner.published;
  return html`
    <p class="ka-banner">白牌是渠道封面和皮肤。封面配置不改控制面，也不分叉内核。</p>
    ${renderKeyAccountNotice()}
    <div class="ka-toolbar">
      ${renderPartnerSwitch(basePath, partner.code, "whiteLabel")}
      <p class="ka-note">当前伙伴：${partner.displayName}（${partner.code}）</p>
    </div>
    ${
      published
        ? html`<p class="ka-note" data-ka-published=${published.version}>
            已发布 ${published.version}${
              draftDiffers(draft, published)
                ? "。草稿与已发布封面不一致，发布后才会写到关联预装配置。"
                : ""
            }
          </p>`
        : html`
            <p class="ka-note" data-ka-published="none">当前使用默认品牌。保存前不可对外称为已白牌出货。</p>
          `
    }
    <form
      class="ka-section"
      @submit=${(event: Event) => {
        event.preventDefault();
        saveWhiteLabelDraft(partner.code, draft);
        rerenderKeyAccountPage();
      }}
    >
      <h2>皮肤项</h2>
      <div class="ka-toolbar">
        <label class="field">
          <span>展示名</span>
          <input
            data-ka-label-name
            .value=${draft.displayName}
            ?disabled=${!canWrite}
            @input=${(event: Event) => {
              draft.displayName = (event.target as HTMLInputElement).value;
            }}
          />
        </label>
        <label class="field">
          <span>Logo</span>
          <input
            type="file"
            accept="image/*"
            ?disabled=${!canWrite}
            @change=${(event: Event) => {
              const file = (event.target as HTMLInputElement).files?.[0];
              if (file) {
                draft.logoName = file.name;
                rerenderKeyAccountPage();
              }
            }}
          />
        </label>
        <label class="field">
          <span>主题主色</span>
          <input
            .value=${draft.primary}
            placeholder="#1F4B99"
            ?disabled=${!canWrite}
            @input=${(event: Event) => {
              draft.primary = (event.target as HTMLInputElement).value;
            }}
          />
        </label>
        <label class="field">
          <span>辅助色</span>
          <input
            .value=${draft.accent}
            placeholder="#E8EEF8"
            ?disabled=${!canWrite}
            @input=${(event: Event) => {
              draft.accent = (event.target as HTMLInputElement).value;
            }}
          />
        </label>
        <label class="field">
          <span>启动页文案</span>
          <input
            .value=${draft.splash}
            ?disabled=${!canWrite}
            @input=${(event: Event) => {
              draft.splash = (event.target as HTMLInputElement).value;
            }}
          />
        </label>
      </div>
      <p class="ka-note">Logo 仅作渠道封面。格式和尺寸在出货前由设计约定，本页只记下文件名。</p>
      ${
        canWrite
          ? html`
              <div class="ka-actions">
                <button class="btn btn--sm" type="submit" data-ka-label-save>保存草稿</button>
                <button
                  class="btn btn--sm btn--primary"
                  type="button"
                  data-ka-label-publish
                  @click=${() => {
                    saveWhiteLabelDraft(partner.code, draft);
                    publishWhiteLabel(partner.code);
                    rerenderKeyAccountPage();
                  }}
                >
                  发布到关联预装配置
                </button>
                <button
                  class="btn btn--sm"
                  type="button"
                  data-ka-label-rollback
                  @click=${() => {
                    rollbackWhiteLabel(partner.code);
                    labelDraft = null;
                    rerenderKeyAccountPage();
                  }}
                >
                  回滚上一版
                </button>
              </div>
            `
          : nothing
      }
    </form>
    <section
      class="ka-preview"
      data-ka-preview="readonly"
      style="--ka-primary: ${draft.primary}; --ka-accent: ${draft.accent};"
    >
      <p class="ka-note">预览只读示意</p>
      <div class="ka-preview__splash">
        <strong>${draft.displayName || "默认品牌"}</strong>
        <span>${draft.splash || "客户端开屏"}</span>
        <span>${draft.logoName || "默认标记"}</span>
      </div>
      <p class="ka-preview__about">关于页 · ${draft.displayName || partner.displayName}</p>
    </section>
  `;
}

export function renderPreinstall(
  basePath: string,
  partnerCode: string | null,
  canWrite: boolean,
  search = "",
) {
  const partner = findKeyAccountPartner(partnerCode) ?? listKeyAccountPartners()[0] ?? null;
  if (!partner) {
    return html`
      <p class="ka-note">台账里还没有伙伴。</p>
    `;
  }
  const choices = signedPackageChoices();
  const trainQuery = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search).get(
    "train",
  );
  const trains = partnerBoundTrains(partner);
  const install = partnerInstallValue(partner);
  const trainFocus = trainQuery?.trim() ?? "";
  const focused = trainFocus
    ? trains.filter((train) => train.trainSeq === trainFocus || train.trainLabel === trainFocus)
    : trains;
  return html`
    <p class="ka-banner">
      只关联已签名 App 预装包，对象是客户端入口。可选包来自产品化已签名目录，只读引用，不写入 digest
      台账。
    </p>
    <section class="ka-section" data-ka-install-track="readonly">
      <h2>远程安装</h2>
      <p class="ka-note">${KEY_ACCOUNT_PREINSTALL_LINE} 绑定列车只读展示，不写入 digest 台账。</p>
      <p data-ka-install-tone=${install.tone}>${install.value}</p>
      ${
        trainFocus && focused.length === 0
          ? html`<p class="ka-note" data-empty-kind="filter-empty">
              筛选无结果。当前伙伴没有绑定列车 ${trainFocus}。
            </p>`
          : nothing
      }
      ${
        focused.length === 0
          ? nothing
          : html`<ul>
              ${focused.map((train) => {
                const href = productizationArtifactHref(basePath, train.digest);
                return html`<li data-ka-bound-train=${train.trainSeq}>
                  ${train.packageId} · ${train.trainLabel} · ${train.versionNarrative}
                  ${train.drifted ? "· 漂移" : train.candidate ? "· 尚未晋升" : "· 已对齐"}
                  · ${keyAccountRouteAnchor(href, "打开制品", "ka-text-link")}
                </li>`;
              })}
            </ul>`
      }
    </section>
    ${renderKeyAccountNotice()}
    <div class="ka-toolbar">
      ${renderPartnerSwitch(basePath, partner.code, "preinstall")}
      <p class="ka-note">当前伙伴：${partner.displayName}</p>
    </div>
    ${
      canWrite
        ? html`
            <form
              class="ka-toolbar"
              @submit=${(event: Event) => {
                event.preventDefault();
                associateSignedPackage(partner.code, packageDraft);
                packageDraft = "";
                rerenderKeyAccountPage();
              }}
            >
              <label class="field">
                <span>选择已登记签名包</span>
                <select
                  data-ka-package-select
                  .value=${packageDraft}
                  @change=${(event: Event) => {
                    packageDraft = (event.target as HTMLSelectElement).value;
                  }}
                >
                  <option value="">请选择</option>
                  ${choices.map(
                    (item) =>
                      html`<option value=${item.id}>${item.id} · ${item.versionNarrative}</option>`,
                  )}
                </select>
              </label>
              <label class="field">
                <span>或粘贴包标识</span>
                <input
                  data-ka-package-paste
                  .value=${packageDraft}
                  placeholder="app-pre-…"
                  @input=${(event: Event) => {
                    packageDraft = (event.target as HTMLInputElement).value;
                  }}
                />
              </label>
              <button class="btn btn--sm btn--primary" type="submit" data-ka-package-submit>关联</button>
            </form>
          `
        : nothing
    }
    <table class="platform-tenants__table">
      <thead>
        <tr>
          <th>包标识</th>
          <th>版本叙事</th>
          <th>签名状态</th>
          <th>白牌配置版本</th>
          <th>制品引用</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        ${
          partner.packageIds.length === 0
            ? html`
                <tr>
                  <td colspan="6">还没有关联已签名 App 预装包。</td>
                </tr>
              `
            : partner.packageIds.map((id) => {
                const item = signedAppPackageReference(id);
                return html`
                  <tr data-ka-package-row=${id}>
                    <td>${id}</td>
                    <td>${item?.versionNarrative ?? "—"}</td>
                    <td>${item ? "已验签" : "不可用"}</td>
                    <td>${whiteLabelVersionForPackage(partner, id)}</td>
                    <td>${item ? item.digestPreview : "—"}</td>
                    <td>
                      <button
                        class="btn btn--sm"
                        type="button"
                        data-ka-package-meta=${id}
                        @click=${() => {
                          metadataPackageId = metadataPackageId === id ? "" : id;
                          rerenderKeyAccountPage();
                        }}
                      >
                        查看包元数据只读
                      </button>
                      ${
                        canWrite
                          ? html`<button
                              class="btn btn--sm"
                              type="button"
                              @click=${() => {
                                unlinkSignedPackage(partner.code, id);
                                if (metadataPackageId === id) {
                                  metadataPackageId = "";
                                }
                                rerenderKeyAccountPage();
                              }}
                            >
                              解除关联
                            </button>`
                          : html`
                              <span class="ka-note">只读</span>
                            `
                      }
                      ${
                        metadataPackageId === id
                          ? html`<p class="ka-note" data-ka-package-detail=${id}>
                              ${
                                item
                                  ? `只读引用 ${item.id} · ${item.versionNarrative} · 已验签 · 渠道标签 ${item.channelTag} · 制品 ${item.digestPreview}。不写入 digest 台账。`
                                  : "这个标识不在已签名目录里。"
                              }
                            </p>`
                          : nothing
                      }
                    </td>
                  </tr>
                `;
              })
        }
      </tbody>
    </table>
    <p class="ka-foot">${KEY_ACCOUNT_PREINSTALL_LINE} 包元数据以签名登记为准，本页只展示标识和验签态。</p>
  `;
}

export function renderSettlement(basePath: string, partnerCode: string | null) {
  const partner = findKeyAccountPartner(partnerCode) ?? listKeyAccountPartners()[0] ?? null;
  if (!partner) {
    return html`
      <p class="ka-note">台账里还没有伙伴。</p>
    `;
  }
  const rows = SETTLEMENT_SUMMARIES.filter((row) => row.partnerCode === partner.code);
  const reconcileHref = keyAccountHref(basePath, "settlementReconcile", partner.code);
  return html`
    <p class="ka-banner" data-ka-settlement-boundary="commerce">
      本页是结算入口占位。不在此签发账单、不改账、不开票。${COMMERCE_ISSUANCE_NOTE}
    </p>
    ${renderKeyAccountNotice()}
    <p class="ka-actions">
      <a
        data-ka-commerce-link
        href=${commerceIssuanceHref(basePath)}
        @click=${(event: MouseEvent) => followPortHref(event, commerceIssuanceHref(basePath))}
        >打开商业核销</a
      >
    </p>
    <div class="ka-toolbar">
      ${renderPartnerSwitch(basePath, partner.code, "settlement")}
      <p>结算模式：${settlementModeLabel(partner.settlementMode)}（只读展示）</p>
    </div>
    <div class="ka-entry-row">
      <a
        class="ka-entry"
        data-ka-open-reconcile
        href=${reconcileHref}
        @click=${(event: MouseEvent) => followPortHref(event, reconcileHref)}
      >
        <strong>进入结算对账视图</strong>
        <span>打开应用内结算对账占位。不在那里签发账单。</span>
      </a>
      <div class="ka-entry" data-settlement-slot="placeholder">
        <strong>占位：结算未就绪</strong>
        <span>没有账单签发，也没有收款确认。</span>
      </div>
    </div>
    <section class="ka-section">
      <h2>最近对账摘要</h2>
      ${
        rows.length === 0
          ? html`
              <p class="ka-note">还没有对账摘要。</p>
            `
          : html`
              <table class="platform-tenants__table">
                <thead>
                  <tr>
                    <th>账期</th>
                    <th>状态</th>
                    <th>更新时间</th>
                  </tr>
                </thead>
                <tbody>
                  ${rows.map(
                    (row) => html`
                      <tr>
                        <td>${row.period}</td>
                        <td>${row.status === "reconciled" ? "已对账" : "未关闭"}</td>
                        <td>${row.updatedAt}</td>
                      </tr>
                    `,
                  )}
                </tbody>
              </table>
            `
      }
    </section>
    <div class="ka-actions">
      ${keyAccountRouteAnchor(reconcileHref, "打开结算视图", "btn btn--sm")}
      <button
        class="btn btn--sm"
        type="button"
        @click=${async () => {
          const text = partner.settlementId;
          if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
          }
          rerenderKeyAccountPage();
        }}
      >
        复制伙伴结算标识
      </button>
      <span class="ka-note">${partner.settlementId}</span>
    </div>
  `;
}

export function renderSettlementReconcile(basePath: string, partnerCode: string | null) {
  const partner = findKeyAccountPartner(partnerCode) ?? listKeyAccountPartners()[0] ?? null;
  if (!partner) {
    return html`
      <p class="ka-note">台账里还没有伙伴。</p>
    `;
  }
  const rows = SETTLEMENT_SUMMARIES.filter((row) => row.partnerCode === partner.code);
  return html`
    <section data-settlement-view="placeholder" data-ka-readonly="settlement-reconcile">
      <p class="ka-banner">这是结算对账占位。不在此签发账单、不改账、不开票。</p>
      <dl class="ka-kv">
        <div>
          <dt>伙伴</dt>
          <dd>${partner.displayName}（${partner.code}）</dd>
        </div>
        <div>
          <dt>结算模式</dt>
          <dd>${settlementModeLabel(partner.settlementMode)}（只读展示）</dd>
        </div>
        <div>
          <dt>结算标识</dt>
          <dd>${partner.settlementId}</dd>
        </div>
      </dl>
      <section class="ka-section">
        <h2>对账摘要</h2>
        ${
          rows.length === 0
            ? html`
                <p class="ka-note">还没有对账摘要。占位视图不生成账期。</p>
              `
            : html`
                <table class="platform-tenants__table">
                  <thead>
                    <tr>
                      <th>账期</th>
                      <th>状态</th>
                      <th>更新时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${rows.map(
                      (row) => html`
                        <tr>
                          <td>${row.period}</td>
                          <td>${row.status === "reconciled" ? "已对账" : "未关闭"}</td>
                          <td>${row.updatedAt}</td>
                        </tr>
                      `,
                    )}
                  </tbody>
                </table>
              `
        }
      </section>
      <p class="ka-note">没有账单签发，也没有收款确认。分成或批发比例留在商务主数据，本页只读。</p>
      <div class="ka-actions">
        ${keyAccountRouteAnchor(keyAccountHref(basePath, "settlement", partner.code), "返回结算入口")}
        ${keyAccountRouteAnchor(keyAccountHref(basePath, "detail", partner.code), "返回伙伴详情")}
      </div>
    </section>
  `;
}
