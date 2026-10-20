import { html, nothing } from "lit";
import { renderPlatformDomainDenied, resolvePlatformDomainAccess } from "../domain-access.ts";
import { productizationArtifactHref } from "../productization/routes.ts";
import { ledgerEmptyCopy } from "../shared/ledger-empty.ts";
import {
  renderPreinstall,
  renderSettlement,
  renderSettlementReconcile,
  renderWhiteLabel,
  resetChannelPageState,
} from "./channel-pages.ts";
import {
  renderAuthorizationBlock,
  renderCustomerDeliveryBoard,
  resetDeliveryBoardState,
} from "./delivery-board.ts";
import {
  KEY_ACCOUNT_DEMO_NOTICE,
  KEY_ACCOUNT_PREINSTALL_LINE,
  KEY_ACCOUNT_STRATEGIC_LINE,
  KEY_ACCOUNT_STRATEGIC_REVISION,
  findSignedPackage,
  partnerStatusLabel,
  partnerTypeLabel,
  settlementModeLabel,
  type PartnerStatus,
  type PartnerType,
} from "./fixtures.ts";
import { partnerBoundTrains, partnerInstallValue } from "./install-status.ts";
import { readKeyAccountLedgerMode, resetKeyAccountLedgerMode } from "./ledger-mode.ts";
import {
  renderKeyAccountAudit,
  renderKeyAccountTerms,
  resetKeyAccountP1State,
} from "./p1-pages.ts";
import { renderShipmentBatches } from "./p2-pages.ts";
import {
  keyAccountRouteAnchor,
  renderKeyAccountNotice,
  rerenderKeyAccountPage,
} from "./render-shared.ts";
import { keyAccountHref, resolveKeyAccountRoute, type KeyAccountView } from "./routes.ts";
import {
  changeKeyAccountStatus,
  createKeyAccountPartner,
  findKeyAccountPartner,
  listKeyAccountPartners,
  resetKeyAccountState,
  type KeyAccountPartner,
} from "./state.ts";

type LedgerQuery = {
  type: "all" | PartnerType;
  status: "all" | PartnerStatus;
  keyword: string;
};

type DraftForm = {
  code: string;
  displayName: string;
  type: PartnerType;
  contact: string;
  open: boolean;
};

let ledgerQuery: LedgerQuery = { type: "all", status: "all", keyword: "" };
let draftForm: DraftForm = {
  code: "",
  displayName: "",
  type: "channel-oem",
  contact: "",
  open: false,
};
let statusDraft = { status: "active" as PartnerStatus, reason: "", confirm: false };
let statusPartner = "";

export function resetKeyAccountPageState(): void {
  ledgerQuery = { type: "all", status: "all", keyword: "" };
  draftForm = { code: "", displayName: "", type: "channel-oem", contact: "", open: false };
  statusDraft = { status: "active", reason: "", confirm: false };
  statusPartner = "";
  resetChannelPageState();
  resetKeyAccountP1State();
  resetDeliveryBoardState();
  resetKeyAccountLedgerMode();
  resetKeyAccountState();
}

/** Test hook for the partner-ledger filter empty state. */
export function setKeyAccountLedgerKeyword(keyword: string): void {
  ledgerQuery = { ...ledgerQuery, keyword };
}

function locate(props: { basePath: string; pathname?: string; search?: string }): {
  pathname: string;
  search: string;
} {
  if (props.pathname) {
    return { pathname: props.pathname, search: props.search ?? "" };
  }
  if (typeof window === "undefined") {
    return { pathname: keyAccountHref(props.basePath, "ledger"), search: "" };
  }
  return { pathname: window.location.pathname, search: window.location.search };
}

export function renderKeyAccountSurface(props: {
  basePath: string;
  pathname?: string;
  search?: string;
  scopes?: readonly string[] | null;
}) {
  if (!resolvePlatformDomainAccess(props.scopes).keyAccounts) {
    return renderPlatformDomainDenied("key-accounts");
  }
  const located = locate(props);
  const view = resolveKeyAccountRoute(located.pathname, props.basePath, located.search);
  const canWrite = resolvePlatformDomainAccess(props.scopes).keyAccountWrite;
  return html`
    <div
      class="ka"
      data-key-account-page=${view.id}
      data-key-account-code=${view.page ?? ""}
      data-key-account-strategic=${KEY_ACCOUNT_STRATEGIC_REVISION}
    >
      <p class="ka-note">${KEY_ACCOUNT_DEMO_NOTICE}</p>
      ${renderBody(props.basePath, view, canWrite, located.search)}
    </div>
  `;
}

function renderBody(basePath: string, view: KeyAccountView, canWrite: boolean, search: string) {
  switch (view.id) {
    case "delivery":
      return renderCustomerDeliveryBoard(basePath);
    case "ledger":
      return renderLedger(basePath, canWrite);
    case "detail":
      return renderDetail(basePath, view.partnerCode, canWrite);
    case "whiteLabel":
      return renderWhiteLabel(basePath, view.partnerCode, canWrite);
    case "preinstall":
      return renderPreinstall(basePath, view.partnerCode, canWrite, search);
    case "settlement":
      return renderSettlement(basePath, view.partnerCode);
    case "settlementReconcile":
      return renderSettlementReconcile(basePath, view.partnerCode);
    case "audit":
      return renderKeyAccountAudit(basePath, view.partnerCode);
    case "terms":
      return renderKeyAccountTerms(basePath, view.partnerCode);
    case "shipments":
      return renderShipmentBatches(basePath, view.partnerCode);
    default:
      return html`
        <p class="ka-note">这个路径没有注册为大客户管理页面。</p>
      `;
  }
}

function renderLedger(basePath: string, canWrite: boolean) {
  const keyword = ledgerQuery.keyword.trim().toLowerCase();
  const filtering =
    keyword.length > 0 || ledgerQuery.type !== "all" || ledgerQuery.status !== "all";
  const matched = listKeyAccountPartners().filter((partner) => {
    if (ledgerQuery.type !== "all" && partner.type !== ledgerQuery.type) {
      return false;
    }
    if (ledgerQuery.status !== "all" && partner.status !== ledgerQuery.status) {
      return false;
    }
    if (!keyword) {
      return true;
    }
    return `${partner.code} ${partner.displayName}`.toLowerCase().includes(keyword);
  });
  const empty = ledgerEmptyCopy(readKeyAccountLedgerMode(), matched.length, filtering);
  const rows = empty ? [] : matched;
  return html`
    <p class="ka-banner">${KEY_ACCOUNT_STRATEGIC_LINE} ${KEY_ACCOUNT_PREINSTALL_LINE}</p>
    ${renderKeyAccountNotice()}
    <form
      class="ka-toolbar"
      @submit=${(event: Event) => {
        event.preventDefault();
        rerenderKeyAccountPage();
      }}
    >
      <label class="field">
        <span>类型</span>
        <select
          .value=${ledgerQuery.type}
          @change=${(event: Event) => {
            ledgerQuery = {
              ...ledgerQuery,
              type: (event.target as HTMLSelectElement).value as LedgerQuery["type"],
            };
            rerenderKeyAccountPage();
          }}
        >
          <option value="all">全部</option>
          <option value="key-account">大客户</option>
          <option value="channel-oem">渠道OEM</option>
        </select>
      </label>
      <label class="field">
        <span>状态</span>
        <select
          .value=${ledgerQuery.status}
          @change=${(event: Event) => {
            ledgerQuery = {
              ...ledgerQuery,
              status: (event.target as HTMLSelectElement).value as LedgerQuery["status"],
            };
            rerenderKeyAccountPage();
          }}
        >
          <option value="all">全部</option>
          <option value="intent">意向</option>
          <option value="active">合作中</option>
          <option value="paused">暂停</option>
          <option value="ended">终止</option>
        </select>
      </label>
      <label class="field">
        <span>关键词</span>
        <input
          .value=${ledgerQuery.keyword}
          placeholder="编码或显示名"
          @input=${(event: Event) => {
            ledgerQuery = { ...ledgerQuery, keyword: (event.target as HTMLInputElement).value };
          }}
        />
      </label>
      <button class="btn btn--sm" type="submit">查询</button>
      ${
        canWrite
          ? html`<button
              class="btn btn--sm btn--primary"
              type="button"
              @click=${() => {
                draftForm = { ...draftForm, open: !draftForm.open };
                rerenderKeyAccountPage();
              }}
            >
              新建伙伴
            </button>`
          : nothing
      }
    </form>
    ${draftForm.open && canWrite ? renderCreateForm() : nothing}
    <table class="platform-tenants__table">
      <thead>
        <tr>
          <th>伙伴编码</th>
          <th>显示名</th>
          <th>类型</th>
          <th>状态</th>
          <th>白牌</th>
          <th>预装包</th>
          <th>结算</th>
          <th>更新时间</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        ${
          empty
            ? html`
                <tr>
                  <td colspan="9" data-empty-kind=${empty.kind}>${empty.title}。${empty.detail}</td>
                </tr>
              `
            : rows.map((partner) => renderLedgerRow(basePath, partner))
        }
      </tbody>
    </table>
    <p class="ka-foot">共 ${rows.length} 条。${KEY_ACCOUNT_STRATEGIC_LINE}</p>
  `;
}

function renderInstallTrack(basePath: string, partner: KeyAccountPartner) {
  const trains = partnerBoundTrains(partner);
  const install = partnerInstallValue(partner);
  return html`
    <section class="ka-section" data-ka-install-track="readonly">
      <h2>远程安装</h2>
      <p class="ka-note">已绑定制品列车与安装跟踪。只读交叉引用，不写入 digest 台账。</p>
      <p data-ka-install-tone=${install.tone}>${install.value}</p>
      ${
        trains.length === 0
          ? html`
              <p class="ka-note">未绑定预装，安装无法跟踪。</p>
            `
          : html`<ul>
              ${trains.map((train) => {
                const href = productizationArtifactHref(basePath, train.digest);
                return html`<li>
                  ${train.packageId} · ${train.trainLabel} · ${train.versionNarrative}
                  ${train.drifted ? "· 漂移" : train.candidate ? "· 尚未晋升" : "· 已对齐"}
                  ·
                  ${keyAccountRouteAnchor(href, "打开制品", "ka-text-link")}
                </li>`;
              })}
            </ul>`
      }
    </section>
  `;
}

function renderLedgerRow(basePath: string, partner: KeyAccountPartner) {
  const signed = partner.packageIds
    .map((id) => findSignedPackage(id))
    .filter((item) => item !== null);
  const preinstall =
    signed.length === 0
      ? "未关联"
      : signed.map((item) => `${item.versionNarrative} 已验签`).join("、");
  return html`
    <tr>
      <td>${partner.code}</td>
      <td>${partner.displayName}</td>
      <td>${partnerTypeLabel(partner.type)}</td>
      <td>${partnerStatusLabel(partner.status)}</td>
      <td>${partner.published ? "已配" : "未配"}</td>
      <td>${preinstall}</td>
      <td>
        ${keyAccountRouteAnchor(keyAccountHref(basePath, "settlement", partner.code), "入口", "ka-text-link")}
      </td>
      <td>${partner.updatedAt}</td>
      <td>${keyAccountRouteAnchor(keyAccountHref(basePath, "detail", partner.code), "详情")}</td>
    </tr>
  `;
}

function renderCreateForm() {
  return html`
    <form
      class="ka-section"
      @submit=${(event: Event) => {
        event.preventDefault();
        createKeyAccountPartner(draftForm);
        draftForm = { ...draftForm, open: false, code: "", displayName: "", contact: "" };
        rerenderKeyAccountPage();
      }}
    >
      <h2>新建伙伴</h2>
      <div class="ka-toolbar">
        <label class="field">
          <span>伙伴编码</span>
          <input
            .value=${draftForm.code}
            placeholder="KA-0001"
            @input=${(event: Event) => {
              draftForm = { ...draftForm, code: (event.target as HTMLInputElement).value };
            }}
          />
        </label>
        <label class="field">
          <span>显示名</span>
          <input
            .value=${draftForm.displayName}
            @input=${(event: Event) => {
              draftForm = { ...draftForm, displayName: (event.target as HTMLInputElement).value };
            }}
          />
        </label>
        <label class="field">
          <span>类型</span>
          <select
            .value=${draftForm.type}
            @change=${(event: Event) => {
              draftForm = {
                ...draftForm,
                type: (event.target as HTMLSelectElement).value as PartnerType,
              };
            }}
          >
            <option value="key-account">大客户</option>
            <option value="channel-oem">渠道OEM</option>
          </select>
        </label>
        <label class="field">
          <span>主联系人</span>
          <input
            .value=${draftForm.contact}
            @input=${(event: Event) => {
              draftForm = { ...draftForm, contact: (event.target as HTMLInputElement).value };
            }}
          />
        </label>
        <button class="btn btn--sm btn--primary" type="submit">保存到演示台账</button>
        <button
          class="btn btn--sm"
          type="button"
          data-testid="key-account-create-cancel"
          @click=${() => {
            draftForm = { ...draftForm, open: false, code: "", displayName: "", contact: "" };
            rerenderKeyAccountPage();
          }}
        >
          取消
        </button>
      </div>
    </form>
  `;
}

function renderDetail(basePath: string, partnerCode: string | null, canWrite: boolean) {
  const partner = findKeyAccountPartner(partnerCode);
  if (partner && statusPartner !== partner.code) {
    statusPartner = partner.code;
    statusDraft = { status: partner.status, reason: "", confirm: false };
  }
  if (!partner) {
    return html`
      <p class="ka-note">台账里没有这个伙伴。</p>
    `;
  }
  const published = partner.published;
  const packages = partner.packageIds
    .map((id) => findSignedPackage(id))
    .filter((item) => item !== null);
  return html`
    ${renderKeyAccountNotice()}
    <section class="ka-section">
      <h2>身份</h2>
      <dl class="ka-kv">
        <div>
          <dt>伙伴编码</dt>
          <dd>${partner.code}</dd>
        </div>
        <div>
          <dt>显示名</dt>
          <dd>${partner.displayName}</dd>
        </div>
        <div>
          <dt>类型</dt>
          <dd>${partnerTypeLabel(partner.type)}</dd>
        </div>
        <div>
          <dt>状态</dt>
          <dd data-ka-partner-status=${partner.status}>${partnerStatusLabel(partner.status)}</dd>
        </div>
        <div>
          <dt>主联系人</dt>
          <dd>${partner.contact}</dd>
        </div>
        <div>
          <dt>商务负责人</dt>
          <dd>${partner.owner}</dd>
        </div>
        <div>
          <dt>备注</dt>
          <dd>${partner.note}</dd>
        </div>
      </dl>
    </section>
    <section class="ka-section">
      <h2>合作摘要</h2>
      <p>合作模式：白牌预装 / 渠道结算（${settlementModeLabel(partner.settlementMode)}）</p>
      <p>
        合同摘要：${partner.terms.contractRef} · ${partner.terms.sourceLabel}
      </p>
      <p class="ka-note">${partner.terms.pasted}</p>
      <p class="ka-note">${KEY_ACCOUNT_STRATEGIC_LINE}</p>
      <div class="ka-actions">
        ${keyAccountRouteAnchor(keyAccountHref(basePath, "terms", partner.code), "合作条款摘要")}
      </div>
    </section>
    ${renderAuthorizationBlock(basePath)}
    ${renderInstallTrack(basePath, partner)}
    <section class="ka-section">
      <h2>快捷区</h2>
      <div class="ka-actions">
        ${keyAccountRouteAnchor(keyAccountHref(basePath, "whiteLabel", partner.code), "白牌配置", "btn btn--sm btn--primary")}
        ${keyAccountRouteAnchor(keyAccountHref(basePath, "preinstall", partner.code), "预装包关联")}
        ${keyAccountRouteAnchor(keyAccountHref(basePath, "settlement", partner.code), "结算对账入口")}
        ${keyAccountRouteAnchor(keyAccountHref(basePath, "shipments", partner.code), "出货批次")}
        ${keyAccountRouteAnchor(keyAccountHref(basePath, "ledger"), "返回台账")}
      </div>
      <dl class="ka-kv">
        <div>
          <dt>白牌</dt>
          <dd>${published ? `${published.version} · ${published.displayName}` : "未配置"}</dd>
        </div>
        <div>
          <dt>预装包</dt>
          <dd>
            ${
              packages.length === 0
                ? "未关联"
                : packages.map((item) => `${item.id} · ${item.versionNarrative} 已验签`).join("；")
            }
          </dd>
        </div>
      </dl>
    </section>
    <section class="ka-section">
      <h2>状态</h2>
      <div class="ka-actions">
        ${keyAccountRouteAnchor(keyAccountHref(basePath, "audit", partner.code), "查看审计")}
      </div>
      ${
        canWrite
          ? html`
              <form
                class="ka-toolbar"
                @submit=${(event: Event) => {
                  event.preventDefault();
                  if (!statusDraft.reason.trim()) {
                    return;
                  }
                  if (!statusDraft.confirm) {
                    statusDraft = { ...statusDraft, confirm: true };
                    rerenderKeyAccountPage();
                    return;
                  }
                  changeKeyAccountStatus(partner.code, statusDraft.status, statusDraft.reason);
                  statusDraft = { status: statusDraft.status, reason: "", confirm: false };
                  rerenderKeyAccountPage();
                }}
              >
                <label class="field">
                  <span>变更状态</span>
                  <select
                    data-ka-status-select
                    .value=${statusDraft.status}
                    @change=${(event: Event) => {
                      statusDraft = {
                        ...statusDraft,
                        status: (event.target as HTMLSelectElement).value as PartnerStatus,
                        confirm: false,
                      };
                    }}
                  >
                    <option value="intent">意向</option>
                    <option value="active">合作中</option>
                    <option value="paused">暂停</option>
                    <option value="ended">终止</option>
                  </select>
                </label>
                <label class="field">
                  <span>原因</span>
                  <input
                    data-ka-status-reason
                    .value=${statusDraft.reason}
                    @input=${(event: Event) => {
                      statusDraft = {
                        ...statusDraft,
                        reason: (event.target as HTMLInputElement).value,
                        confirm: false,
                      };
                    }}
                  />
                </label>
                <button
                  class="btn btn--sm"
                  type="submit"
                  data-ka-status-submit
                  ?disabled=${!statusDraft.reason.trim()}
                  title=${statusDraft.reason.trim() ? "变更伙伴状态" : "变更状态需要填写原因"}
                >
                  ${statusDraft.confirm ? "确认变更" : "变更状态"}
                </button>
              </form>
              ${
                statusDraft.confirm
                  ? html`
                      <p class="ka-banner" data-ka-status-confirm="ready">
                        确认将 ${partner.code} 的状态从「${partnerStatusLabel(partner.status)}」改为「${partnerStatusLabel(statusDraft.status)}」。原因：${statusDraft.reason}
                      </p>
                    `
                  : nothing
              }
              ${
                partner.statusReason
                  ? html`<p class="ka-note" data-ka-status-reason=${partner.statusReason}>
                      最近原因：${partner.statusReason}
                    </p>`
                  : nothing
              }
            `
          : nothing
      }
    </section>
  `;
}
