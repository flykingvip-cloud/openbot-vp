import { html } from "lit";
import { requestPlatformSurfaceRerender } from "../shared/surface.ts";
import { formatTrainSeq } from "./fixtures.ts";
import {
  EMPTY_AUDIT_FILTER,
  EMPTY_L1_FILTER,
  L1_CONNECTED_NOTICE,
  L1_DEEPLINK_EXPLANATION,
  L1_FAIL_CLOSED_DETAIL,
  L1_READONLY_BANNER,
  L1_THIN_NOTE,
  PRODUCTIZATION_AUDIT_EVENTS,
  PRODUCTIZATION_STRATEGIC_LINE,
  PRODUCTIZATION_STRATEGIC_REVISION,
  RELEASE_WINDOW_NOTE,
  RELEASE_WINDOWS,
  SURFACE_MATRIX_NOTE,
  SURFACE_MATRIX_ROWS,
  auditActionOptions,
  auditResultOptions,
  filterAuditEvents,
  filterL1Projections,
  l1DeepLinkShape,
  l1ProjectionRows,
  l1StatusLabel,
  readL1ControlPlaneAvailability,
  releaseWindowDigestLabel,
  resetL1ControlPlaneAvailability,
  type AuditFilter,
  type L1Filter,
  type L1LicenseProjection,
  type ProductizationAuditEvent,
} from "./p1-fixtures.ts";

let l1Filter: L1Filter = { ...EMPTY_L1_FILTER };
let l1SelectedId: string | null = null;
let auditFilter: AuditFilter = { ...EMPTY_AUDIT_FILTER };
let auditSelectedId: string | null = null;

export function openL1Projection(licenseId: string | null): void {
  l1SelectedId = licenseId;
}

export function resetP1PageState(): void {
  l1Filter = { ...EMPTY_L1_FILTER };
  l1SelectedId = null;
  auditFilter = { ...EMPTY_AUDIT_FILTER };
  auditSelectedId = null;
  resetL1ControlPlaneAvailability();
}

function rerender(): void {
  requestPlatformSurfaceRerender();
}

function renderStrategicNote() {
  return html`
    <p class="pz-banner" data-productization-strategic=${PRODUCTIZATION_STRATEGIC_REVISION}>
      ${PRODUCTIZATION_STRATEGIC_LINE}
    </p>
  `;
}

export function renderL1AssociationPage() {
  const availability = readL1ControlPlaneAvailability();
  const rows = filterL1Projections(l1ProjectionRows(), l1Filter);
  const selected =
    availability === "available" ? rows.find((row) => row.licenseId === l1SelectedId) : undefined;
  return html`
    ${renderStrategicNote()}
    <p class="pz-banner">${L1_READONLY_BANNER}</p>
    <p class="pz-note">${L1_DEEPLINK_EXPLANATION}</p>
    <form
      class="pz-toolbar"
      @submit=${(event: Event) => {
        event.preventDefault();
        rerender();
      }}
    >
      <label class="field">
        <span>oem_id</span>
        <input
          type="search"
          placeholder="渠道主体"
          .value=${l1Filter.oemId}
          @input=${(event: Event) =>
            patchL1Filter({ oemId: (event.target as HTMLInputElement).value })}
        />
      </label>
      <label class="field">
        <span>tenant_id</span>
        <input
          type="search"
          .value=${l1Filter.tenantId}
          @input=${(event: Event) =>
            patchL1Filter({ tenantId: (event.target as HTMLInputElement).value })}
        />
      </label>
      <label class="field">
        <span>sku</span>
        <input
          type="search"
          .value=${l1Filter.sku}
          @input=${(event: Event) => patchL1Filter({ sku: (event.target as HTMLInputElement).value })}
        />
      </label>
      <label class="field">
        <span>状态</span>
        <select
          .value=${l1Filter.status}
          @change=${(event: Event) =>
            patchL1Filter({
              status: (event.target as HTMLSelectElement).value as L1Filter["status"],
            })}
        >
          <option value="all">全部</option>
          <option value="admitted">条款在册</option>
          <option value="grace">宽限期</option>
          <option value="unbound">未绑定</option>
          <option value="revoked">已吊销</option>
        </select>
      </label>
      <label class="field">
        <span>关键词</span>
        <input
          type="search"
          .value=${l1Filter.keyword}
          @input=${(event: Event) =>
            patchL1Filter({ keyword: (event.target as HTMLInputElement).value })}
        />
      </label>
      <button class="btn btn--sm" type="submit">查询</button>
    </form>
    ${
      availability === "unavailable"
        ? html`
            <section class="pz-panel" data-l1-control-plane="unavailable">
              <h2>控制面不可用</h2>
              <p class="pz-note">${L1_FAIL_CLOSED_DETAIL}</p>
            </section>
          `
        : html`
            <div class="pz-split" data-l1-control-plane="available">
              <div>
                <p class="pz-note">${L1_CONNECTED_NOTICE}</p>
                ${renderL1Table(rows)}
              </div>
              ${renderL1Drawer(selected)}
            </div>
          `
    }
    <p class="pz-foot">${L1_THIN_NOTE} oem_id 是渠道白标结算主体。</p>
  `;
}

function patchL1Filter(patch: Partial<L1Filter>): void {
  l1Filter = { ...l1Filter, ...patch };
  l1SelectedId = null;
  rerender();
}

function renderL1Table(rows: readonly L1LicenseProjection[]) {
  return html`
    <div class="platform-tenants__table-wrap">
      <table class="platform-tenants__table">
        <thead>
          <tr>
            <th scope="col">license_id</th>
            <th scope="col">sku</th>
            <th scope="col">设备标记</th>
            <th scope="col">oem</th>
            <th scope="col">状态</th>
            <th scope="col">最近心跳</th>
            <th scope="col">操作</th>
          </tr>
        </thead>
        <tbody>
          ${
            rows.length === 0
              ? html`
                  <tr>
                    <td colspan="7">没有符合筛选的只读关联。</td>
                  </tr>
                `
              : rows.map(
                  (row) => html`
                    <tr>
                      <td class="mono">${row.licenseId}</td>
                      <td>${row.skuLabel}</td>
                      <td class="mono">${row.deviceId ?? "—"}</td>
                      <td class="mono">${row.oemId}</td>
                      <td>${l1StatusLabel(row.status)}</td>
                      <td>${row.lastHeartbeat ?? "—"}</td>
                      <td>
                        <button
                          class="btn btn--sm"
                          type="button"
                          @click=${() => {
                            openL1Projection(row.licenseId);
                            rerender();
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
    </div>
  `;
}

function renderL1Drawer(row: L1LicenseProjection | undefined) {
  if (!row) {
    return html`
      <aside class="pz-panel">
        <h2>只读抽屉</h2>
        <p class="pz-note">选择一条关联后，字段在这里只读展示。没有签发、吊销或换机操作。</p>
      </aside>
    `;
  }
  return html`
    <aside class="pz-panel">
      <h2>只读关联</h2>
      <dl class="pz-kv">
        <div>
          <dt>license_id</dt>
          <dd class="mono">${row.licenseId}</dd>
        </div>
        <div>
          <dt>sku</dt>
          <dd>${row.skuLabel}</dd>
        </div>
        <div>
          <dt>tenant_id</dt>
          <dd class="mono">${row.tenantId}</dd>
        </div>
        <div>
          <dt>设备标记</dt>
          <dd class="mono">${row.deviceId ?? "未绑定"}</dd>
        </div>
        <div>
          <dt>oem_id</dt>
          <dd class="mono">${row.oemId}</dd>
        </div>
        <div>
          <dt>状态</dt>
          <dd>${l1StatusLabel(row.status)}</dd>
        </div>
        <div>
          <dt>最近心跳</dt>
          <dd>${row.lastHeartbeat ?? "—"}</dd>
        </div>
        <div>
          <dt>深链形态</dt>
          <dd>${l1DeepLinkShape(row.licenseId)}</dd>
        </div>
      </dl>
      <p class="pz-note">${L1_DEEPLINK_EXPLANATION}</p>
      <button
        class="btn btn--sm"
        type="button"
        @click=${() => {
          openL1Projection(null);
          rerender();
        }}
      >
        关闭
      </button>
    </aside>
  `;
}

export function renderSurfaceMatrixPage() {
  return html`
    ${renderStrategicNote()}
    <p class="pz-note">${SURFACE_MATRIX_NOTE}</p>
    <div class="platform-tenants__table-wrap">
      <table class="platform-tenants__table">
        <thead>
          <tr>
            <th scope="col">能力</th>
            <th scope="col">full · SaaS 主路径</th>
          </tr>
        </thead>
        <tbody>
          ${SURFACE_MATRIX_ROWS.map(
            (row) => html`
              <tr>
                <th scope="row">${row.capability}</th>
                <td>${row.full}</td>
              </tr>
            `,
          )}
        </tbody>
      </table>
    </div>
    <p class="pz-foot">只读矩阵。本页只描述 SaaS full。</p>
  `;
}

export function renderReleaseWindowsPage() {
  return html`
    ${renderStrategicNote()}
    <p class="pz-note">${RELEASE_WINDOW_NOTE}</p>
    <div class="platform-tenants__table-wrap">
      <table class="platform-tenants__table">
        <thead>
          <tr>
            <th scope="col">窗口</th>
            <th scope="col">列车</th>
            <th scope="col">版本叙事</th>
            <th scope="col">digest</th>
            <th scope="col">阶段</th>
            <th scope="col">GO</th>
            <th scope="col">说明</th>
          </tr>
        </thead>
        <tbody>
          ${RELEASE_WINDOWS.map(
            (row) => html`
              <tr>
                <td>${row.name}</td>
                <td class="mono">${formatTrainSeq(row.trainSeq)}</td>
                <td>${row.versionNarrative}</td>
                <td class="mono" title=${row.digest}>${releaseWindowDigestLabel(row.digest)}</td>
                <td>${row.phaseLabel}</td>
                <td>${row.goLabel}</td>
                <td>${row.narrative}</td>
              </tr>
            `,
          )}
        </tbody>
      </table>
    </div>
    <p class="pz-foot">窗口状态来自发布列车台账。这里不能改 GO，也不能录入野版。</p>
  `;
}

export function renderProductizationAuditPage() {
  const rows = filterAuditEvents(PRODUCTIZATION_AUDIT_EVENTS, auditFilter);
  const selected = rows.find((event) => event.id === auditSelectedId);
  const actions = auditActionOptions();
  const results = auditResultOptions();
  return html`
    ${renderStrategicNote()}
    <p class="pz-note">产品化域关键动作的只读检索。演示夹具。不提供写入入口。</p>
    <form
      class="pz-toolbar"
      @submit=${(event: Event) => {
        event.preventDefault();
        rerender();
      }}
    >
      <label class="field">
        <span>动作</span>
        <select
          .value=${auditFilter.action}
          @change=${(event: Event) =>
            patchAuditFilter({ action: (event.target as HTMLSelectElement).value })}
        >
          <option value="all">全部</option>
          ${actions.map((action) => html`<option value=${action}>${action}</option>`)}
        </select>
      </label>
      <label class="field">
        <span>结果</span>
        <select
          .value=${auditFilter.result}
          @change=${(event: Event) =>
            patchAuditFilter({ result: (event.target as HTMLSelectElement).value })}
        >
          <option value="all">全部</option>
          ${results.map((result) => html`<option value=${result}>${result}</option>`)}
        </select>
      </label>
      <label class="field">
        <span>关键词</span>
        <input
          type="search"
          placeholder="操作者、对象或摘要"
          .value=${auditFilter.keyword}
          @input=${(event: Event) =>
            patchAuditFilter({ keyword: (event.target as HTMLInputElement).value })}
        />
      </label>
      <button class="btn btn--sm" type="submit">查询</button>
    </form>
    <div class="pz-split">
      ${renderAuditTable(rows)}
      ${renderAuditDrawer(selected)}
    </div>
    <p class="pz-foot">共 ${rows.length} 条 · 域内只读 · 无补写入口</p>
  `;
}

function patchAuditFilter(patch: Partial<AuditFilter>): void {
  auditFilter = { ...auditFilter, ...patch };
  auditSelectedId = null;
  rerender();
}

function renderAuditTable(rows: readonly ProductizationAuditEvent[]) {
  return html`
    <div class="platform-tenants__table-wrap">
      <table class="platform-tenants__table">
        <thead>
          <tr>
            <th scope="col">时间</th>
            <th scope="col">操作者</th>
            <th scope="col">动作</th>
            <th scope="col">对象</th>
            <th scope="col">结果</th>
            <th scope="col">操作</th>
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
                      <td class="mono">${event.at}</td>
                      <td class="mono">${event.actor}</td>
                      <td>${event.action}</td>
                      <td class="mono">${event.objectId}</td>
                      <td>${event.result}</td>
                      <td>
                        <button
                          class="btn btn--sm"
                          type="button"
                          @click=${() => {
                            auditSelectedId = event.id;
                            rerender();
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
    </div>
  `;
}

function renderAuditDrawer(event: ProductizationAuditEvent | undefined) {
  if (!event) {
    return html`
      <aside class="pz-panel">
        <h2>审计详情</h2>
        <p class="pz-note">选择一条记录后只读查看摘要。不能改写，也不能补记。</p>
      </aside>
    `;
  }
  return html`
    <aside class="pz-panel">
      <h2>审计详情</h2>
      <dl class="pz-kv">
        <div>
          <dt>时间</dt>
          <dd class="mono">${event.at}</dd>
        </div>
        <div>
          <dt>操作者</dt>
          <dd class="mono">${event.actor}</dd>
        </div>
        <div>
          <dt>动作</dt>
          <dd>${event.action}</dd>
        </div>
        <div>
          <dt>对象</dt>
          <dd class="mono">${event.objectType} · ${event.objectId}</dd>
        </div>
        <div>
          <dt>结果</dt>
          <dd>${event.result}</dd>
        </div>
        <div>
          <dt>摘要</dt>
          <dd>${event.summary}</dd>
        </div>
      </dl>
      <button
        class="btn btn--sm"
        type="button"
        @click=${() => {
          auditSelectedId = null;
          rerender();
        }}
      >
        关闭
      </button>
    </aside>
  `;
}
