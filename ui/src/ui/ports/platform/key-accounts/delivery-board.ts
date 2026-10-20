/**
 * Customer delivery board (K-00). Five checks per partner:
 * white-label, preinstall, authorization link, install tracking, settlement entry.
 * Not a sales funnel. Authorization and settlement are deep links only.
 */

import { html } from "lit";
import { PRODUCTIZATION_ARTIFACTS, formatTrainSeq } from "../productization/fixtures.ts";
import { artifactIsDrift } from "../productization/release-health.ts";
import { productizationReconcileHref } from "../productization/routes.ts";
import { ledgerEmptyCopy } from "../shared/ledger-empty.ts";
import { followPortHref } from "../shared/surface.ts";
import {
  COMMERCE_ISSUANCE_NOTE,
  SEAT_CATALOG_NOTE,
  commerceIssuanceHref,
  seatCatalogHref,
} from "./delivery-links.ts";
import { KEY_ACCOUNT_PREINSTALL_LINE, partnerTypeLabel } from "./fixtures.ts";
import { partnerBoundTrains, partnerInstallValue } from "./install-status.ts";
import { readKeyAccountLedgerMode } from "./ledger-mode.ts";
import { keyAccountRouteAnchor, rerenderKeyAccountPage } from "./render-shared.ts";
import { keyAccountHref } from "./routes.ts";
import { listSignedAppPreinstallPackages } from "./signed-app-catalog.ts";
import { listKeyAccountPartners, type KeyAccountPartner } from "./state.ts";

let keyword = "";

export function resetDeliveryBoardState(): void {
  keyword = "";
}

export function setDeliveryBoardKeyword(next: string): void {
  keyword = next;
}

type DeliveryTodo = {
  id: string;
  text: string;
  href: string;
};

function partnerTodos(basePath: string, partner: KeyAccountPartner): DeliveryTodo[] {
  const todos: DeliveryTodo[] = [];
  const trains = partnerBoundTrains(partner);
  if (trains.length === 0) {
    todos.push({
      id: `${partner.code}-preinstall`,
      text: `${partner.displayName} 未绑定预装`,
      href: keyAccountHref(basePath, "preinstall", partner.code),
    });
  }
  for (const train of trains) {
    if (train.drifted) {
      todos.push({
        id: `${partner.code}-${train.trainSeq}-drift`,
        text: `${partner.displayName} 绑定的 ${train.trainLabel} 版本漂移`,
        href: productizationReconcileHref(basePath, {
          trainSeq: train.trainSeq,
          digest: train.digest,
        }),
      });
    } else if (train.candidate) {
      todos.push({
        id: `${partner.code}-${train.trainSeq}-candidate`,
        text: `${partner.displayName} 绑定的 ${train.trainLabel} 尚未晋升`,
        href: productizationReconcileHref(basePath, {
          trainSeq: train.trainSeq,
          digest: train.digest,
        }),
      });
    }
  }
  if (!partner.published) {
    todos.push({
      id: `${partner.code}-label`,
      text: `${partner.displayName} 白牌未发布`,
      href: keyAccountHref(basePath, "whiteLabel", partner.code),
    });
  }
  return todos;
}

function unboundDriftTodos(basePath: string): DeliveryTodo[] {
  const referenced = new Set(listSignedAppPreinstallPackages().map((item) => item.artifactDigest));
  return PRODUCTIZATION_ARTIFACTS.filter(
    (artifact) => artifactIsDrift(artifact) && !referenced.has(artifact.digest),
  ).map((artifact) => ({
    id: `train-${artifact.trainSeq}-drift`,
    text: `${formatTrainSeq(artifact.trainSeq)} 漂移，尚无预装绑定`,
    href: productizationReconcileHref(basePath, {
      trainSeq: artifact.trainSeq,
      digest: artifact.digest,
    }),
  }));
}

function visiblePartners(): KeyAccountPartner[] {
  const needle = keyword.trim().toLowerCase();
  return listKeyAccountPartners().filter((partner) => {
    if (!needle) {
      return true;
    }
    return `${partner.code} ${partner.displayName}`.toLowerCase().includes(needle);
  });
}

export function renderCustomerDeliveryBoard(basePath: string) {
  const rows = visiblePartners();
  const filtering = keyword.trim().length > 0;
  const empty = ledgerEmptyCopy(readKeyAccountLedgerMode(), rows.length, filtering);
  const todos = empty
    ? []
    : [
        ...rows.flatMap((partner) => partnerTodos(basePath, partner)),
        ...unboundDriftTodos(basePath),
      ];
  const seatsHref = seatCatalogHref(basePath);
  return html`
    <p class="ka-note" data-ka-module-subtitle="delivery">白牌·预装·授权·安装</p>
    <section class="ka-section" data-ka-delivery="five-state">
      <h2>客户交付状态</h2>
      <p class="ka-note">${KEY_ACCOUNT_PREINSTALL_LINE} ${SEAT_CATALOG_NOTE}</p>
      <form
        class="ka-toolbar"
        @submit=${(event: Event) => {
          event.preventDefault();
        }}
      >
        <label class="field">
          <span>客户</span>
          <input
            data-ka-delivery-filter
            .value=${keyword}
            placeholder="编码或显示名"
            @input=${(event: Event) => {
              keyword = (event.target as HTMLInputElement).value;
              rerenderKeyAccountPage();
            }}
          />
        </label>
      </form>
      ${
        empty
          ? html`<p class="ka-note" data-empty-kind=${empty.kind}>${empty.title}。${empty.detail}</p>`
          : html`
              ${
                todos.length > 0
                  ? html`<ul class="ka-todo" data-ka-delivery-todos="open">
                      ${todos.map(
                        (todo) => html`<li>
                          <a
                            href=${todo.href}
                            @click=${(event: MouseEvent) => followPortHref(event, todo.href)}
                            >${todo.text}</a
                          >
                        </li>`,
                      )}
                    </ul>`
                  : html`
                      <p class="ka-note" data-ka-delivery-todos="clear">没有缺绑或漂移待办。</p>
                    `
              }
              <table class="platform-tenants__table">
              <thead>
                <tr>
                  <th>客户</th>
                  <th>白牌</th>
                  <th>预装</th>
                  <th>授权</th>
                  <th>安装</th>
                  <th>结算入口</th>
                </tr>
              </thead>
              <tbody>
                ${rows.map((partner) => renderDeliveryRow(basePath, partner, seatsHref))}
              </tbody>
            </table>`
      }
    </section>
  `;
}

function renderDeliveryRow(basePath: string, partner: KeyAccountPartner, seatsHref: string) {
  const trains = partnerBoundTrains(partner);
  const preinstall =
    trains.length === 0
      ? "未绑定"
      : trains
          .map((train) =>
            train.drifted ? `${train.trainLabel} 漂移` : `${train.trainLabel} 已绑定`,
          )
          .join("、");
  const install = partnerInstallValue(partner);
  const settlementHref = keyAccountHref(basePath, "settlement", partner.code);
  const detailHref = keyAccountHref(basePath, "detail", partner.code);
  return html`
    <tr data-ka-delivery-row=${partner.code}>
      <td>
        ${keyAccountRouteAnchor(detailHref, partner.displayName, "ka-text-link")}
        <span class="ka-note">${partner.code} · ${partnerTypeLabel(partner.type)}</span>
      </td>
      <td data-ka-check="white-label">
        ${partner.published ? `已发布 ${partner.published.version}` : "未发布"}
      </td>
      <td data-ka-check="preinstall">${preinstall}</td>
      <td data-ka-check="authorization">
        <a href=${seatsHref} @click=${(event: MouseEvent) => followPortHref(event, seatsHref)}
          >未在本模块建账</a
        >
      </td>
      <td data-ka-check="install" data-ka-install-tone=${install.tone}>${install.value}</td>
      <td data-ka-check="settlement">
        ${keyAccountRouteAnchor(settlementHref, "结算入口", "ka-text-link")}
      </td>
    </tr>
  `;
}

export function renderAuthorizationBlock(basePath: string) {
  const seatsHref = seatCatalogHref(basePath);
  const commerceHref = commerceIssuanceHref(basePath);
  return html`
    <section class="ka-section" data-ka-auth-block="readonly">
      <h2>授权与签发</h2>
      <p class="ka-note">${SEAT_CATALOG_NOTE}</p>
      <p class="ka-note">${COMMERCE_ISSUANCE_NOTE}</p>
      <dl class="ka-kv">
        <div>
          <dt>许可范围</dt>
          <dd>只读摘要。席位与权益以套餐目录为准，这里不复制一份许可账。</dd>
        </div>
        <div>
          <dt>远程签发</dt>
          <dd>到商业核销查看开户与核销记录。本页不代开发票。</dd>
        </div>
      </dl>
      <div class="ka-actions">
        <a
          class="btn btn--sm btn--primary"
          data-ka-seat-link
          href=${seatsHref}
          @click=${(event: MouseEvent) => followPortHref(event, seatsHref)}
          >打开套餐与席位</a
        >
        <a
          class="btn btn--sm"
          data-ka-commerce-link
          href=${commerceHref}
          @click=${(event: MouseEvent) => followPortHref(event, commerceHref)}
          >打开商业核销</a
        >
      </div>
    </section>
  `;
}
