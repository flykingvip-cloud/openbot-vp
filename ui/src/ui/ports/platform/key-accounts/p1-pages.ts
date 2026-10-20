import { html } from "lit";
import { pushAppHistoryState } from "../../../request-app-rerender.ts";
import {
  KEY_ACCOUNT_AUDIT_ACTIONS,
  KEY_ACCOUNT_PREINSTALL_LINE,
  KEY_ACCOUNT_STRATEGIC_LINE,
  filterKeyAccountAudit,
  settlementModeLabel,
  type KeyAccountAuditEvent,
  type KeyAccountAuditFilter,
} from "./fixtures.ts";
import {
  keyAccountRouteAnchor,
  renderKeyAccountNotice,
  rerenderKeyAccountPage,
} from "./render-shared.ts";
import { keyAccountHref } from "./routes.ts";
import {
  findKeyAccountPartner,
  listKeyAccountAuditEvents,
  listKeyAccountPartners,
  type KeyAccountPartner,
} from "./state.ts";

let auditFilter: KeyAccountAuditFilter = { action: "all", partner: "all", keyword: "" };
let auditSelectedId: string | null = null;
let auditBoundPartner = "\0";

export function resetKeyAccountP1State(): void {
  auditFilter = { action: "all", partner: "all", keyword: "" };
  auditSelectedId = null;
  auditBoundPartner = "\0";
}

function bindAuditPartner(partnerCode: string | null): void {
  const key = partnerCode ?? "";
  if (auditBoundPartner === key) {
    return;
  }
  auditBoundPartner = key;
  auditFilter = { ...auditFilter, partner: partnerCode ?? "all" };
  auditSelectedId = null;
}

export function renderKeyAccountAudit(basePath: string, partnerCode: string | null) {
  bindAuditPartner(partnerCode);
  const rows = filterKeyAccountAudit(listKeyAccountAuditEvents(), auditFilter);
  const selected = rows.find((event) => event.id === auditSelectedId) ?? null;
  return html`
    <p class="ka-banner" data-ka-readonly="audit">
      本页只检索大客户域内动作：伙伴变更、白牌发布、预装关联和解除关联。只读，不能改写，也不能补记。
    </p>
    ${renderKeyAccountNotice()}
    <form
      class="ka-toolbar"
      @submit=${(event: Event) => {
        event.preventDefault();
        rerenderKeyAccountPage();
      }}
    >
      <label class="field">
        <span>动作</span>
        <select
          .value=${auditFilter.action}
          @change=${(event: Event) => {
            auditFilter = {
              ...auditFilter,
              action: (event.target as HTMLSelectElement).value as KeyAccountAuditFilter["action"],
            };
            auditSelectedId = null;
            rerenderKeyAccountPage();
          }}
        >
          <option value="all">全部</option>
          ${KEY_ACCOUNT_AUDIT_ACTIONS.map(
            (action) => html`<option value=${action}>${action}</option>`,
          )}
        </select>
      </label>
      <label class="field">
        <span>伙伴</span>
        <select
          .value=${auditFilter.partner}
          @change=${(event: Event) => {
            auditFilter = { ...auditFilter, partner: (event.target as HTMLSelectElement).value };
            auditSelectedId = null;
            rerenderKeyAccountPage();
          }}
        >
          <option value="all">全部</option>
          ${listKeyAccountPartners().map(
            (partner) =>
              html`<option value=${partner.code}>${partner.displayName}（${partner.code}）</option>`,
          )}
        </select>
      </label>
      <label class="field">
        <span>关键词</span>
        <input
          .value=${auditFilter.keyword}
          placeholder="操作者、对象或摘要"
          @input=${(event: Event) => {
            auditFilter = { ...auditFilter, keyword: (event.target as HTMLInputElement).value };
          }}
        />
      </label>
      <button class="btn btn--sm" type="submit">查询</button>
    </form>
    <div class="ka-split">
      ${renderAuditTable(rows)}
      ${renderAuditDetail(basePath, selected)}
    </div>
    <p class="ka-foot">共 ${rows.length} 条。演示记录。域内只读，无补写入口。</p>
  `;
}

function renderAuditTable(rows: readonly KeyAccountAuditEvent[]) {
  return html`
    <table class="platform-tenants__table">
      <thead>
        <tr>
          <th>时间</th>
          <th>伙伴</th>
          <th>动作</th>
          <th>对象</th>
          <th>摘要</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        ${
          rows.length === 0
            ? html`
                <tr>
                  <td colspan="6">没有符合筛选的审计记录。</td>
                </tr>
              `
            : rows.map(
                (event) => html`
                  <tr>
                    <td>${event.at}</td>
                    <td>${event.partnerCode}</td>
                    <td>${event.action}</td>
                    <td>${event.objectId}</td>
                    <td>${event.summary}</td>
                    <td>
                      <button
                        class="btn btn--sm"
                        type="button"
                        @click=${() => {
                          auditSelectedId = event.id;
                          rerenderKeyAccountPage();
                        }}
                      >
                        查看
                      </button>
                    </td>
                  </tr>
                `,
              )
        }
      </tbody>
    </table>
  `;
}

function renderAuditDetail(basePath: string, event: KeyAccountAuditEvent | null) {
  if (!event) {
    return html`
      <aside class="ka-section">
        <h2>审计详情</h2>
        <p class="ka-note">选择一条记录后只读查看摘要。</p>
      </aside>
    `;
  }
  return html`
    <aside class="ka-section" data-ka-audit-detail=${event.id}>
      <h2>审计详情</h2>
      <dl class="ka-kv">
        <div>
          <dt>时间</dt>
          <dd>${event.at}</dd>
        </div>
        <div>
          <dt>操作者</dt>
          <dd>${event.actor}</dd>
        </div>
        <div>
          <dt>动作</dt>
          <dd>${event.action}</dd>
        </div>
        <div>
          <dt>伙伴</dt>
          <dd>${event.partnerCode}</dd>
        </div>
        <div>
          <dt>对象</dt>
          <dd>${event.objectId}</dd>
        </div>
        <div>
          <dt>摘要</dt>
          <dd>${event.summary}</dd>
        </div>
      </dl>
      <div class="ka-actions">
        ${keyAccountRouteAnchor(keyAccountHref(basePath, "detail", event.partnerCode), "伙伴详情")}
        ${keyAccountRouteAnchor(keyAccountHref(basePath, "terms", event.partnerCode), "合作条款摘要")}
        <button
          class="btn btn--sm"
          type="button"
          @click=${() => {
            auditSelectedId = null;
            rerenderKeyAccountPage();
          }}
        >
          关闭
        </button>
      </div>
    </aside>
  `;
}

function renderTermsPartnerSwitch(basePath: string, current: string) {
  return html`
    <label class="field">
      <span>当前伙伴</span>
      <select
        .value=${current}
        @change=${(event: Event) => {
          const code = (event.target as HTMLSelectElement).value;
          pushAppHistoryState(keyAccountHref(basePath, "terms", code));
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

export function renderKeyAccountTerms(basePath: string, partnerCode: string | null) {
  const partner = findKeyAccountPartner(partnerCode) ?? listKeyAccountPartners()[0] ?? null;
  if (!partner) {
    return html`
      <p class="ka-note">台账里还没有伙伴。</p>
    `;
  }
  return html`
    <p class="ka-banner" data-ka-readonly="terms">
      合作条款是只读摘要。合同、分成和批发以商务主数据为准。没有账单签发，也没有收款确认。
    </p>
    ${renderKeyAccountNotice()}
    <div class="ka-toolbar">
      ${renderTermsPartnerSwitch(basePath, partner.code)}
      <p class="ka-note">当前伙伴：${partner.displayName}（${partner.code}）</p>
    </div>
    ${renderTermsBody(basePath, partner)}
  `;
}

function renderTermsBody(basePath: string, partner: KeyAccountPartner) {
  const terms = partner.terms;
  const sourceHref = `${keyAccountHref(basePath, "terms", partner.code)}#business-master`;
  const mode = settlementModeLabel(partner.settlementMode);
  return html`
    <section class="ka-section">
      <h2>条款摘要</h2>
      <p>${KEY_ACCOUNT_STRATEGIC_LINE}</p>
      <dl class="ka-kv">
        <div>
          <dt>合同编号</dt>
          <dd>${terms.contractRef}</dd>
        </div>
        <div>
          <dt>生效</dt>
          <dd>${terms.effectiveFrom}</dd>
        </div>
        <div>
          <dt>结算模式</dt>
          <dd>${mode}（只读展示）</dd>
        </div>
        <div>
          <dt>分成摘要</dt>
          <dd>${terms.shareSummary}</dd>
        </div>
        <div>
          <dt>批发摘要</dt>
          <dd>${terms.wholesaleSummary}</dd>
        </div>
        <div>
          <dt>粘贴字段</dt>
          <dd>${terms.pasted}</dd>
        </div>
        <div>
          <dt>来源</dt>
          <dd>${terms.sourceLabel}</dd>
        </div>
      </dl>
      <p class="ka-note">${KEY_ACCOUNT_PREINSTALL_LINE}</p>
    </section>
    <section class="ka-section" id="business-master">
      <h2>商务主数据</h2>
      <p class="ka-note">外链槽位。商务主数据不在本模块，这里只保留已粘贴的只读摘要。</p>
      <div class="ka-actions">
        ${keyAccountRouteAnchor(sourceHref, "打开商务主数据外链")}
        ${keyAccountRouteAnchor(keyAccountHref(basePath, "detail", partner.code), "返回伙伴详情")}
        ${keyAccountRouteAnchor(keyAccountHref(basePath, "audit", partner.code), "查看该伙伴审计")}
      </div>
    </section>
  `;
}
