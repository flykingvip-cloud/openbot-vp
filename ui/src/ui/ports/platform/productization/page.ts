import { html, nothing } from "lit";
import { pushAppHistoryState } from "../../../request-app-rerender.ts";
import { renderPlatformDomainDenied, resolvePlatformDomainAccess } from "../domain-access.ts";
import { ledgerEmptyCopy } from "../shared/ledger-empty.ts";
import { followPortHref, requestPlatformSurfaceRerender } from "../shared/surface.ts";
import {
  createProductizationDemoState,
  reconciledChannelTargets,
  saveChannelPointer,
  type ProductizationDemoState,
} from "./channels.ts";
import {
  PRODUCTIZATION_ARTIFACTS,
  PRODUCTIZATION_DEMO_NOTICE,
  artifactStatusLabel,
  channelKindLabel,
  filterArtifacts,
  findArtifactByDigest,
  formatTrainSeq,
  shortDigest,
  signatureLabel,
  surfaceLabel,
  surfaceOptionLabel,
  type ArtifactStatusFilter,
  type ArtifactSurfaceFilter,
  type ChannelKind,
  type ProductizationArtifact,
  type ProductizationChannel,
} from "./fixtures.ts";
import { readProductizationLedgerMode, resetProductizationLedgerMode } from "./ledger-mode.ts";
import { renderReleaseOverview } from "./overview.ts";
import { PRODUCTIZATION_STRATEGIC_LINE, PRODUCTIZATION_STRATEGIC_REVISION } from "./p1-fixtures.ts";
import {
  renderL1AssociationPage,
  renderProductizationAuditPage,
  renderReleaseWindowsPage,
  renderSurfaceMatrixPage,
  resetP1PageState,
} from "./p1-pages.ts";
import { renderArtifactInstallRefs } from "./preinstall-xref.ts";
import {
  formatReconcileReport,
  readReconcileQuery,
  reconcileQuery,
  type ReconcileInput,
  type ReconcileResult,
} from "./reconcile.ts";
import { artifactIsDrift } from "./release-health.ts";
import {
  productizationArtifactHref,
  productizationHref,
  productizationReconcileHref,
  resolveProductizationRoute,
  type ProductizationView,
} from "./routes.ts";

/** P-02 actions. License issuance is intentionally absent. */
export const PRODUCTIZATION_DETAIL_ACTIONS = ["打开对账台", "复制 digest"] as const;

type ChannelEditor = {
  mode: "create" | "edit" | "readonly";
  channelId: string | null;
  name: string;
  description: string;
  kind: ChannelKind;
  digest: string;
  confirmPending: boolean;
  error: string | null;
};

type ArtifactQuery = {
  surface: ArtifactSurfaceFilter;
  status: ArtifactStatusFilter;
  keyword: string;
};

let demoState: ProductizationDemoState = createProductizationDemoState();
let channelEditor: ChannelEditor | null = null;
let channelNotice: string | null = null;
let artifactQuery: ArtifactQuery = { surface: "all", status: "all", keyword: "" };
let reconcileDraft: ReconcileInput = { trainSeq: "", digest: "", imageRef: "" };
let reconcileDraftDirty = false;
let copyNotice: string | null = null;

export function resetProductizationPageState(): void {
  demoState = createProductizationDemoState();
  channelEditor = null;
  channelNotice = null;
  artifactQuery = { surface: "all", status: "all", keyword: "" };
  reconcileDraft = { trainSeq: "", digest: "", imageRef: "" };
  reconcileDraftDirty = false;
  copyNotice = null;
  resetProductizationLedgerMode();
  resetP1PageState();
}

/** Test hook for the artifact-list filter empty state. */
export function setProductizationArtifactKeyword(keyword: string): void {
  artifactQuery = { ...artifactQuery, keyword };
}

/** Opens the channel drawer so tests can read its operator copy. */
export function openProductizationChannelPreview(channelId: string): void {
  const channel = demoState.channels.find((item) => item.id === channelId);
  if (!channel) {
    return;
  }
  channelEditor = {
    mode: channel.writable ? "edit" : "readonly",
    channelId: channel.id,
    name: channel.name,
    description: channel.description,
    kind: channel.kind,
    digest: channel.currentDigest,
    confirmPending: false,
    error: null,
  };
}

function rerender(): void {
  requestPlatformSurfaceRerender();
}

function locate(props: { basePath: string; pathname?: string; search?: string }): {
  pathname: string;
  search: string;
} {
  if (props.pathname) {
    return { pathname: props.pathname, search: props.search ?? "" };
  }
  if (typeof window === "undefined") {
    return { pathname: productizationHref(props.basePath, "artifacts"), search: "" };
  }
  return { pathname: window.location.pathname, search: window.location.search };
}

function routeAnchor(href: string, label: string, className = "btn btn--sm") {
  return html`
    <a
      class=${className}
      href=${href}
      @click=${(event: MouseEvent) => {
        reconcileDraftDirty = false;
        followPortHref(event, href);
      }}
      >${label}</a
    >
  `;
}

function statusClass(status: ReconcileResult["cards"][number]["status"]): string {
  return `pz-status--${status}`;
}

function renderStrategicBanner() {
  return html`
    <p class="pz-banner" data-productization-strategic=${PRODUCTIZATION_STRATEGIC_REVISION}>
      ${PRODUCTIZATION_STRATEGIC_LINE}
    </p>
  `;
}

export function renderProductizationSurface(props: {
  basePath: string;
  pathname?: string;
  search?: string;
  scopes?: readonly string[] | null;
}) {
  if (!resolvePlatformDomainAccess(props.scopes).productization) {
    return renderPlatformDomainDenied("productization");
  }
  const located = locate(props);
  const view = resolveProductizationRoute(located.pathname, props.basePath, located.search);
  return html`
    <div class="pz" data-productization-page=${view.id}>
      <p class="pz-note">${PRODUCTIZATION_DEMO_NOTICE}</p>
      ${renderBody(props.basePath, located.search, view)}
    </div>
  `;
}

function renderBody(basePath: string, search: string, view: ProductizationView) {
  switch (view.id) {
    case "overview":
      return renderReleaseOverview(basePath, demoState.channels);
    case "artifacts":
      return renderArtifactList(basePath);
    case "artifactDetail":
      return renderArtifactDetail(basePath, view.digestHex);
    case "channels":
      return renderChannels(basePath);
    case "reconcile":
      return renderReconcile(basePath, search);
    case "l1":
      return renderL1AssociationPage();
    case "surfaces":
      return renderSurfaceMatrixPage();
    case "windows":
      return renderReleaseWindowsPage();
    case "audit":
      return renderProductizationAuditPage();
    default:
      return renderStub("这个路径没有注册为产品化页面。", "不会因此创建制品或通道。");
  }
}

function renderArtifactList(basePath: string) {
  const rows = filterArtifacts(PRODUCTIZATION_ARTIFACTS, artifactQuery);
  const filtering =
    artifactQuery.keyword.trim().length > 0 ||
    artifactQuery.surface !== "all" ||
    artifactQuery.status !== "all";
  const empty = ledgerEmptyCopy(readProductizationLedgerMode(), rows.length, filtering);
  return html`
    ${renderStrategicBanner()}
    <form
      class="pz-toolbar"
      @submit=${(event: Event) => {
        event.preventDefault();
        rerender();
      }}
    >
      <label class="field">
        <span>表面</span>
        <select
          .value=${artifactQuery.surface}
          @change=${(event: Event) => {
            artifactQuery = {
              ...artifactQuery,
              surface: (event.target as HTMLSelectElement).value as ArtifactSurfaceFilter,
            };
            rerender();
          }}
        >
          <option value="all">全部</option>
          <option value="full">${surfaceOptionLabel("full")}</option>
        </select>
      </label>
      <label class="field">
        <span>状态</span>
        <select
          .value=${artifactQuery.status}
          @change=${(event: Event) => {
            artifactQuery = {
              ...artifactQuery,
              status: (event.target as HTMLSelectElement).value as ArtifactStatusFilter,
            };
            rerender();
          }}
        >
          <option value="all">全部</option>
          <option value="candidate">候选</option>
          <option value="promoted">正式</option>
          <option value="retired">废弃</option>
        </select>
      </label>
      <label class="field">
        <span>关键词</span>
        <input
          type="search"
          placeholder="版本、列车序号或 digest"
          .value=${artifactQuery.keyword}
          @input=${(event: Event) => {
            artifactQuery = { ...artifactQuery, keyword: (event.target as HTMLInputElement).value };
            rerender();
          }}
        />
      </label>
      <button class="btn btn--sm" type="submit">查询</button>
    </form>
    <div class="platform-tenants__table-wrap">
      <table class="platform-tenants__table">
        <thead>
          <tr>
            <th scope="col">状态</th>
            <th scope="col">列车序号</th>
            <th scope="col">版本叙事</th>
            <th scope="col">digest</th>
            <th scope="col">签名</th>
            <th scope="col">通道</th>
            <th scope="col">操作</th>
          </tr>
        </thead>
        <tbody>
          ${
            empty
              ? html`
                  <tr>
                    <td colspan="7" data-empty-kind=${empty.kind}>${empty.title}。${empty.detail}</td>
                  </tr>
                `
              : rows.map((artifact) => renderArtifactRow(basePath, artifact))
          }
        </tbody>
      </table>
    </div>
    <p class="pz-foot">
      共 ${rows.length} 条 · 仅展示发布列车可对账条目 · 禁止手工野版录入
    </p>
  `;
}

function renderArtifactRow(basePath: string, artifact: ProductizationArtifact) {
  const href = productizationArtifactHref(basePath, artifact.digest);
  const drifted = artifactIsDrift(artifact);
  const channels = artifact.channelIds.length > 0 ? artifact.channelIds.join("、") : "无";
  return html`
    <tr class=${drifted ? "pz-row--drift" : ""} data-pz-drift=${drifted ? "true" : "false"}>
      <td>${artifactStatusLabel(artifact.status)}${drifted ? " · 漂移" : ""}</td>
      <td class="mono">${formatTrainSeq(artifact.trainSeq)}</td>
      <td>${artifact.versionNarrative}</td>
      <td class="mono" title=${artifact.digest}>${shortDigest(artifact.digest)}</td>
      <td>${artifact.signature === "verified" ? "✓ " : ""}${signatureLabel(artifact.signature)}</td>
      <td>${channels}</td>
      <td>${routeAnchor(href, "详情")}</td>
    </tr>
  `;
}

function renderArtifactDetail(basePath: string, digestHex: string | null) {
  const artifact = digestHex ? findArtifactByDigest(digestHex) : undefined;
  if (!artifact) {
    return html`
      <section class="pz-panel">
        <h2>台账中没有这个 digest</h2>
        <p class="pz-note">禁止把它当作野版录入。平台端不会新建制品。</p>
        ${routeAnchor(productizationHref(basePath, "artifacts"), "返回制品总览")}
      </section>
    `;
  }
  const reconcileHref = productizationReconcileHref(basePath, {
    trainSeq: artifact.trainSeq,
    digest: artifact.digest,
    imageRef: artifact.imageRef,
  });
  return html`
    ${renderStrategicBanner()}
    <section class="pz-panel">
      <h2>身份</h2>
      <dl class="pz-kv">
        <div>
          <dt>digest</dt>
          <dd class="mono">${artifact.digest}</dd>
        </div>
        <div>
          <dt>版本叙事</dt>
          <dd>${artifact.versionNarrative}</dd>
        </div>
        <div>
          <dt>表面标记</dt>
          <dd>${surfaceLabel(artifact.surfaces)}</dd>
        </div>
        <div>
          <dt>provenance SHA</dt>
          <dd class="mono">${artifact.provenanceSha}</dd>
        </div>
        <div>
          <dt>SBOM</dt>
          <dd>只读占位。演示夹具不提供 SBOM 文件。</dd>
        </div>
        <div>
          <dt>签名</dt>
          <dd>${signatureLabel(artifact.signature)}</dd>
        </div>
      </dl>
    </section>
    <section class="pz-panel">
      <h2>列车关联</h2>
      <dl class="pz-kv">
        <div>
          <dt>列车序号</dt>
          <dd class="mono">${formatTrainSeq(artifact.trainSeq)}</dd>
        </div>
        <div>
          <dt>通道归属</dt>
          <dd>${artifact.channelIds.length > 0 ? artifact.channelIds.join("、") : "无"}</dd>
        </div>
      </dl>
      <ol class="pz-timeline">
        ${artifact.timeline.map(
          (entry) =>
            html`<li><span class="mono">${entry.at}</span><span>${entry.label}</span></li>`,
        )}
      </ol>
    </section>
    <section class="pz-panel">
      <h2>表面证明</h2>
      <p class="pz-note">${artifact.surfaceProof}</p>
    </section>
    ${renderArtifactInstallRefs(basePath, artifact)}
    <div class="pz-actions">
      ${routeAnchor(reconcileHref, PRODUCTIZATION_DETAIL_ACTIONS[0], "btn btn--primary btn--sm")}
      <button
        class="btn btn--sm"
        type="button"
        @click=${() => {
          void copyDigest(artifact.digest);
        }}
      >
        ${PRODUCTIZATION_DETAIL_ACTIONS[1]}
      </button>
      ${routeAnchor(productizationHref(basePath, "artifacts"), "返回制品总览")}
    </div>
    ${copyNotice ? html`<p class="pz-note">${copyNotice}</p>` : nothing}
  `;
}

async function copyDigest(digest: string): Promise<void> {
  try {
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
      copyNotice = "当前环境不能写入剪贴板，请手动选择 digest。";
    } else {
      await navigator.clipboard.writeText(digest);
      copyNotice = "已复制 digest。";
    }
  } catch {
    copyNotice = "复制失败，请手动选择 digest。";
  }
  rerender();
}

function renderChannels(basePath: string) {
  return html`
    ${renderStrategicBanner()}
    <div class="pz-actions">
      <button class="btn btn--primary btn--sm" type="button" @click=${() => openCreate()}>
        新建通道
      </button>
      ${channelNotice ? html`<p class="pz-note">${channelNotice}</p>` : nothing}
    </div>
    <div class="pz-split">
      <div class="platform-tenants__table-wrap">
        <table class="platform-tenants__table">
          <thead>
            <tr>
              <th scope="col">通道名</th>
              <th scope="col">类型</th>
              <th scope="col">当前指向 digest</th>
              <th scope="col">更新时间</th>
              <th scope="col">操作</th>
            </tr>
          </thead>
          <tbody>
            ${demoState.channels.map((channel) => renderChannelRow(channel))}
          </tbody>
        </table>
      </div>
      ${renderChannelPanel(basePath)}
    </div>
    <p class="pz-foot">
      云侧通道只能指向已对账制品。Fleet 镜像只读，license-cloud 不是近端必经控制面。
    </p>
  `;
}

function renderChannelRow(channel: ProductizationChannel) {
  return html`
    <tr>
      <td>${channel.name}</td>
      <td>${channelKindLabel(channel.kind)}</td>
      <td class="mono" title=${channel.currentDigest}>${shortDigest(channel.currentDigest)}</td>
      <td>${channel.updatedAt}</td>
      <td>
        <button class="btn btn--sm" type="button" @click=${() => openChannel(channel)}>
          ${channel.writable ? "编辑" : "查看"}
        </button>
      </td>
    </tr>
  `;
}

function openCreate(): void {
  const first = reconciledChannelTargets()[0];
  channelEditor = {
    mode: "create",
    channelId: null,
    name: "",
    description: "",
    kind: "cloud-release",
    digest: first?.digest ?? "",
    confirmPending: false,
    error: null,
  };
  channelNotice = null;
  rerender();
}

function openChannel(channel: ProductizationChannel): void {
  channelEditor = {
    mode: channel.writable ? "edit" : "readonly",
    channelId: channel.id,
    name: channel.name,
    description: channel.description,
    kind: channel.kind,
    digest: channel.currentDigest,
    confirmPending: false,
    error: null,
  };
  channelNotice = null;
  rerender();
}

function renderChannelPanel(basePath: string) {
  if (!channelEditor) {
    return html`
      <aside class="pz-panel">
        <h2>通道详情</h2>
        <p class="pz-note">选择一条通道，或新建云侧通道。指向列表只含已对账制品。</p>
      </aside>
    `;
  }
  const editor = channelEditor;
  const readonly = editor.mode === "readonly";
  const targets = reconciledChannelTargets();
  return html`
    <aside class="pz-panel">
      <h2>${readonly ? "只读镜像" : editor.mode === "create" ? "新建通道" : "编辑通道"}</h2>
      ${
        readonly
          ? html`
              <p class="pz-note">Fleet 镜像只读。license-cloud 不是近端必经控制面，这里不能改指向。</p>
            `
          : html`
              <p class="pz-note">不得指向列车外 digest。保存须二次确认。</p>
            `
      }
      <label class="field">
        <span>通道名</span>
        <input
          type="text"
          ?disabled=${readonly}
          .value=${editor.name}
          @input=${(event: Event) => patchEditor({ name: (event.target as HTMLInputElement).value })}
        />
      </label>
      <label class="field">
        <span>描述</span>
        <input
          type="text"
          ?disabled=${readonly}
          .value=${editor.description}
          @input=${(event: Event) =>
            patchEditor({ description: (event.target as HTMLInputElement).value })}
        />
      </label>
      <label class="field">
        <span>类型</span>
        ${
          readonly
            ? html`<input type="text" disabled .value=${channelKindLabel(editor.kind)} />`
            : html`
                <select
                  .value=${editor.kind}
                  @change=${(event: Event) =>
                    patchEditor({
                      kind: (event.target as HTMLSelectElement).value as
                        | "cloud-release"
                        | "joint-review",
                    })}
                >
                  <option value="cloud-release">云发布</option>
                  <option value="joint-review">联审</option>
                </select>
              `
        }
      </label>
      <label class="field">
        <span>指向 digest</span>
        ${
          readonly
            ? html`<input type="text" disabled .value=${editor.digest} />`
            : html`
                <select
                  .value=${editor.digest}
                  @change=${(event: Event) =>
                    patchEditor({ digest: (event.target as HTMLSelectElement).value })}
                >
                  ${targets.map(
                    (artifact) => html`
                      <option value=${artifact.digest}>
                        ${formatTrainSeq(artifact.trainSeq)} · ${shortDigest(artifact.digest)} ·
                        ${artifact.versionNarrative}
                      </option>
                    `,
                  )}
                </select>
              `
        }
      </label>
      ${editor.error ? html`<p class="pz-status--rejected">${editor.error}</p>` : nothing}
      <div class="pz-actions">
        ${
          readonly
            ? nothing
            : html`
                <button class="btn btn--primary btn--sm" type="button" @click=${() => submitChannel()}>
                  ${editor.confirmPending ? "确认保存" : "保存"}
                </button>
              `
        }
        <button class="btn btn--sm" type="button" @click=${() => closeEditor()}>取消</button>
        ${routeAnchor(productizationHref(basePath, "audit"), "查看审计")}
      </div>
    </aside>
  `;
}

function patchEditor(patch: Partial<ChannelEditor>): void {
  if (!channelEditor || channelEditor.mode === "readonly") {
    return;
  }
  channelEditor = { ...channelEditor, ...patch, confirmPending: false, error: null };
  rerender();
}

function closeEditor(): void {
  channelEditor = null;
  rerender();
}

function submitChannel(): void {
  if (!channelEditor || channelEditor.mode === "readonly") {
    return;
  }
  const editor = channelEditor;
  const saved = saveChannelPointer(demoState, {
    channelId: editor.channelId,
    name: editor.name,
    description: editor.description,
    kind: editor.kind,
    digest: editor.digest,
    confirmed: editor.confirmPending,
  });
  demoState = saved.state;
  if (!saved.result.ok) {
    channelEditor = {
      ...editor,
      confirmPending: saved.result.code === "confirm-required",
      error: saved.result.message,
    };
    rerender();
    return;
  }
  channelEditor = null;
  channelNotice = "演示夹具已更新通道指向。这不会写入生产台账。";
  rerender();
}

function renderReconcile(basePath: string, search: string) {
  const fromUrl = readReconcileQuery(search);
  const form = reconcileDraftDirty ? reconcileDraft : fromUrl;
  const ran = Boolean(
    fromUrl.trainSeq?.trim() || fromUrl.digest?.trim() || fromUrl.imageRef?.trim(),
  );
  const result = ran ? reconcileQuery(fromUrl) : null;
  return html`
    ${renderStrategicBanner()}
    <form
      class="pz-toolbar"
      @submit=${(event: Event) => {
        event.preventDefault();
        const next = reconcileDraftDirty ? reconcileDraft : form;
        reconcileDraft = next;
        reconcileDraftDirty = false;
        pushAppHistoryState(productizationReconcileHref(basePath, next));
      }}
    >
      <label class="field">
        <span>列车序号</span>
        <input
          type="text"
          placeholder="112 或 seq-112"
          .value=${form.trainSeq ?? ""}
          @input=${(event: Event) =>
            patchReconcileDraft(form, { trainSeq: (event.target as HTMLInputElement).value })}
        />
      </label>
      <label class="field">
        <span>digest</span>
        <input
          type="text"
          placeholder="sha256:…"
          .value=${form.digest ?? ""}
          @input=${(event: Event) =>
            patchReconcileDraft(form, { digest: (event.target as HTMLInputElement).value })}
        />
      </label>
      <label class="field">
        <span>镜像引用</span>
        <input
          type="text"
          placeholder="registry.example.invalid/…"
          .value=${form.imageRef ?? ""}
          @input=${(event: Event) =>
            patchReconcileDraft(form, { imageRef: (event.target as HTMLInputElement).value })}
        />
      </label>
      <button class="btn btn--primary btn--sm" type="submit">对账</button>
    </form>
    ${
      result
        ? renderReconcileResult(basePath, result)
        : html`
            <p class="pz-note">输入列车序号、digest 或镜像引用后对账。野版 digest 会被拒绝，且不会写入。</p>
          `
    }
  `;
}

function patchReconcileDraft(current: ReconcileInput, patch: ReconcileInput): void {
  reconcileDraft = { ...current, ...patch };
  reconcileDraftDirty = true;
}

function renderReconcileResult(basePath: string, result: ReconcileResult) {
  const channelHref = productizationHref(basePath, "channels");
  return html`
    <section class="pz-panel">
      <h2 class=${statusClass(result.outcome === "aligned" ? "aligned" : result.outcome === "drift" ? "drift" : "rejected")}>
        ${result.outcome === "aligned" ? "对齐" : result.outcome === "drift" ? "漂移" : "拒绝"}
      </h2>
      <p>${result.summary}</p>
      <div class="pz-align">
        ${result.cards.map(
          (item) => html`
            <article>
              <h3>${item.title}</h3>
              <p class=${statusClass(item.status)}>${item.status === "aligned" ? "一致" : item.status === "drift" ? "漂移" : "拒绝"}</p>
              <p class="mono">${item.value}</p>
              <p class="pz-note">${item.detail}</p>
            </article>
          `,
        )}
      </div>
      ${
        result.diffs.length > 0
          ? html`<ul class="pz-diffs">
              ${result.diffs.map((diff) => html`<li>${diff}</li>`)}
            </ul>`
          : nothing
      }
      <div class="pz-actions">
        ${
          result.outcome === "rejected"
            ? nothing
            : html`<a
                class="btn btn--primary btn--sm"
                data-pz-go-channel
                href=${channelHref}
                @click=${(event: MouseEvent) => followPortHref(event, channelHref)}
                >去改通道</a
              >`
        }
        <button
          class="btn btn--sm"
          type="button"
          ?disabled=${result.outcome === "rejected" && result.code === "empty"}
          @click=${() => downloadReconcileReport(result)}
        >
          导出对账报告
        </button>
      </div>
      ${
        result.outcome === "rejected"
          ? nothing
          : html`
              <p class="pz-note">只改已对账制品的通道指向。不会写入野版 digest。</p>
            `
      }
    </section>
  `;
}

function downloadReconcileReport(result: ReconcileResult): void {
  if (typeof document === "undefined") {
    return;
  }
  const blob = new Blob([formatReconcileReport(result)], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "productization-reconcile.txt";
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function renderStub(title: string, detail: string) {
  return html`
    <section class="pz-panel">
      <h2>${title}</h2>
      <p class="pz-note">${detail}</p>
    </section>
  `;
}
