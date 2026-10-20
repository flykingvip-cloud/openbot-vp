/**
 * 企业端「模型授权」自包含区块（任务 11 主表面接入）。
 *
 * 设计：`.kiro/specs/model-entitlement-chain/design.md`（§8.2，R4.1）。
 *
 * 自包含 LitElement：持有 `client`（+ 可选 enterpriseId），自行通过
 * `enterprise-model-grant.*` 加载 entitlement/grants，渲染 `renderModelAuthorizationPanel`，
 * 并把勾选/撤销/新增主体落到 RPC 后重新加载。挂载于企业端访问控制（设置）主表面。
 *
 * 授权主体优先从企业组织席位/成员选择器选取，不再要求管理员手输 seatId/employeeId。
 */

import { LitElement, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { createEnterpriseModelProviderGateway } from "../capability/enterprise-model-provider/gateway-client.ts";
import {
  createModelAuthorizationGateway,
  getModelAuthorizationClient,
  type EnterpriseModelEntitlement,
  type ModelGrantSubjectType,
  type SeatModelGrant,
} from "../capability/model-authorization/index.ts";
import {
  buildEnterpriseAuthorizationView,
  type EnterpriseGrantSubjectView,
} from "../capability/model-authorization/view-model.ts";
import type { GatewayBrowserClient } from "../gateway.ts";
import {
  buildModelAuthorizationDirectory,
  buildModelAuthorizationOrgDepartments,
  type ModelAuthorizationDirectoryEntry,
  type ModelAuthorizationOrgRoster,
  type ModelAuthorizationSubjectOption,
} from "./model-authorization-directory.ts";
import {
  renderModelAuthorizationPanel,
  type ModelAuthorizationPanelProps,
} from "./model-authorization-panel.ts";
import {
  buildAuthorizedModelCatalog,
  type AuthorizedModelCatalog,
} from "./model-authorization-presentation.ts";

export type { ModelAuthorizationOrgRoster, ModelAuthorizationSubjectOption };

@customElement("model-authorization-section")
export class ModelAuthorizationSection extends LitElement {
  // 复用全局样式表（不使用 shadow DOM 隔离，沿用本仓库 light-DOM 渲染约定）。
  protected createRenderRoot() {
    return this;
  }

  @property({ attribute: false }) client: GatewayBrowserClient | null = null;
  @property({ type: String }) enterpriseId: string | null = null;
  /** 席位选择器选项（来自企业组织数据）。 */
  @property({ attribute: false }) seatOptions: ModelAuthorizationSubjectOption[] = [];
  /** 员工选择器选项（来自企业成员数据）。 */
  @property({ attribute: false }) memberOptions: ModelAuthorizationSubjectOption[] = [];
  /** 企业组织名录。有岗位时左侧改为组织树，不再手输主体 id。 */
  @property({ attribute: false }) orgRoster: ModelAuthorizationOrgRoster | null = null;
  /** 外层已有「模型授权」页签时隐藏重复标题。 */
  @property({ type: Boolean }) embedded = false;

  private resolveClient(): GatewayBrowserClient | null {
    return this.client ?? getModelAuthorizationClient();
  }

  @state() private entitlement: EnterpriseModelEntitlement | null = null;
  @state() private allowedModelIds: string[] = [];
  @state() private ceilingModelIds: string[] = [];
  @state() private suppressedPlatformModelIds: string[] = [];
  @state() private grants: SeatModelGrant[] = [];
  @state() private busy = false;
  @state() private error: string | null = null;
  @state() private loaded = false;
  @state() private newSubjectType: ModelGrantSubjectType = "seat";
  @state() private newSubjectId = "";
  @state() private subjectFilter = "";
  @state() private directoryQuery = "";
  @state() private selectedKey: string | null = null;
  @state() private modelCatalog: AuthorizedModelCatalog | null = null;

  connectedCallback() {
    super.connectedCallback();
    void this.load();
  }

  private scope(): { enterpriseId?: string } {
    return this.enterpriseId ? { enterpriseId: this.enterpriseId } : {};
  }

  private async load() {
    const client = this.resolveClient();
    if (!client) {
      return;
    }
    this.busy = true;
    this.error = null;
    try {
      const gw = createModelAuthorizationGateway(client);
      const res = await gw.listGrants(this.scope());
      this.entitlement = res.entitlement;
      this.allowedModelIds = res.ceilingModelIds ?? res.allowedModelIds;
      this.ceilingModelIds = res.ceilingModelIds ?? res.allowedModelIds;
      this.suppressedPlatformModelIds = res.suppressedPlatformModelIds ?? [];
      this.grants = res.grants;
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    } finally {
      this.busy = false;
      this.loaded = true;
    }
    await this.loadModelCatalog();
  }

  private async loadModelCatalog() {
    const client = this.resolveClient();
    if (!client) {
      return;
    }
    try {
      const gw = createEnterpriseModelProviderGateway(client);
      const [providers, catalog] = await Promise.all([
        gw.list(this.scope()),
        gw.listCatalog(this.scope()),
      ]);
      this.modelCatalog = buildAuthorizedModelCatalog({
        connections: providers.connections ?? [],
        assets: (catalog.assets ?? []).map((asset) => ({
          runtimeModelId: asset.runtimeModelId,
          displayName: asset.displayName,
          upstreamModelId: asset.upstreamModelId,
          connectionId: asset.connectionId,
        })),
      });
    } catch {
      // 目录只影响展示名。授权勾选仍以上界与 grant 为准。
    }
  }

  private async toggleModel(
    subject: { subjectType: ModelGrantSubjectType; subjectId: string },
    modelId: string,
    granted: boolean,
  ) {
    const client = this.resolveClient();
    if (!client) {
      return;
    }
    const current = this.grants.find(
      (g) => g.subjectType === subject.subjectType && g.subjectId === subject.subjectId,
    );
    const next = new Set(current?.grantedModelIds ?? []);
    if (granted) {
      next.add(modelId);
    } else {
      next.delete(modelId);
    }
    this.busy = true;
    this.error = null;
    try {
      const gw = createModelAuthorizationGateway(client);
      await gw.grant({
        ...this.scope(),
        subjectType: subject.subjectType,
        subjectId: subject.subjectId,
        grantedModelIds: [...next],
      });
      await this.load();
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
      this.busy = false;
    }
  }

  private async revokeSubject(subject: { subjectType: ModelGrantSubjectType; subjectId: string }) {
    const client = this.resolveClient();
    if (!client) {
      return;
    }
    this.busy = true;
    this.error = null;
    try {
      const gw = createModelAuthorizationGateway(client);
      await gw.revoke({
        ...this.scope(),
        subjectType: subject.subjectType,
        subjectId: subject.subjectId,
      });
      await this.load();
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
      this.busy = false;
    }
  }

  private async addSubject() {
    const subjectId = this.newSubjectId.trim();
    const client = this.resolveClient();
    if (!client || !subjectId) {
      return;
    }
    this.busy = true;
    this.error = null;
    try {
      const gw = createModelAuthorizationGateway(client);
      // 以空授权创建主体行，随后可在表格中逐个勾选模型。
      await gw.grant({
        ...this.scope(),
        subjectType: this.newSubjectType,
        subjectId,
        grantedModelIds: [],
      });
      this.newSubjectId = "";
      await this.load();
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
      this.busy = false;
    }
  }

  private filteredOptions(): ModelAuthorizationSubjectOption[] {
    const options = this.newSubjectType === "seat" ? this.seatOptions : this.memberOptions;
    const q = this.subjectFilter.trim().toLowerCase();
    if (!q) {
      return options;
    }
    return options.filter(
      (opt) => opt.label.toLowerCase().includes(q) || opt.id.toLowerCase().includes(q),
    );
  }

  private grantSummary(): string {
    const seatCount = this.grants.filter((g) => g.subjectType === "seat").length;
    const employeeCount = this.grants.filter((g) => g.subjectType === "employee").length;
    const hidden = new Set(this.suppressedPlatformModelIds);
    const modelCount = new Set(
      this.grants.flatMap((grant) => grant.grantedModelIds.filter((id) => !hidden.has(id.trim()))),
    ).size;
    return `席位 ${seatCount} · 员工 ${employeeCount} · 已授权 ${modelCount} 种 · 上界 ${this.ceilingModelIds.length}`;
  }

  private directory(): ModelAuthorizationDirectoryEntry[] {
    return buildModelAuthorizationDirectory({
      grants: this.grants,
      orgRoster: this.orgRoster,
      seatOptions: this.seatOptions,
      memberOptions: this.memberOptions,
      query: this.directoryQuery,
      hiddenModelIds: this.suppressedPlatformModelIds,
    });
  }

  private selectedDirectoryEntry(
    directory: readonly ModelAuthorizationDirectoryEntry[],
  ): ModelAuthorizationDirectoryEntry | undefined {
    const subjects = directory.filter((entry) => entry.kind === "subject");
    if (this.selectedKey) {
      const selected = subjects.find((entry) => entry.key === this.selectedKey);
      if (selected) {
        return selected;
      }
    }
    return subjects[0];
  }

  private previewFor(
    view: ReturnType<typeof buildEnterpriseAuthorizationView>,
    entry: ModelAuthorizationDirectoryEntry | undefined,
  ): { subject: EnterpriseGrantSubjectView; hasRecord: boolean } | null {
    if (!entry?.subjectType || !entry.subjectId) {
      return null;
    }
    const existing = view.subjects.find(
      (subject) =>
        subject.subjectType === entry.subjectType && subject.subjectId === entry.subjectId,
    );
    if (existing) {
      return { subject: existing, hasRecord: true };
    }
    if (!view.hasEntitlement) {
      return null;
    }
    return {
      hasRecord: false,
      subject: {
        subjectType: entry.subjectType,
        subjectId: entry.subjectId,
        status: "active",
        rows: view.entitlementModelIds.map((modelId) => ({
          modelId,
          withinEntitlement: true,
          granted: false,
        })),
      },
    };
  }

  private hasOrgSeats(): boolean {
    return (this.orgRoster?.seats.length ?? 0) > 0;
  }

  render() {
    if (!this.loaded && this.busy) {
      return html`
        <div class="card"><div class="card-sub">加载模型授权…</div></div>
      `;
    }
    const view = buildEnterpriseAuthorizationView({
      entitlement: this.entitlement,
      allowedModelIds: this.allowedModelIds,
      grants: this.grants,
      hiddenModelIds: this.suppressedPlatformModelIds,
    });
    const directory = this.directory();
    const selected = this.selectedDirectoryEntry(directory);
    const preview = this.previewFor(view, selected);
    const unavailableModelIds = [
      ...new Set(
        view.subjects.flatMap((subject) =>
          subject.rows.filter((row) => !row.withinEntitlement).map((row) => row.modelId),
        ),
      ),
    ].toSorted();
    const panelProps: ModelAuthorizationPanelProps = {
      view,
      busy: this.busy,
      error: this.error,
      embedded: this.embedded,
      summary: this.grantSummary(),
      unavailableModelIds,
      directory,
      orgDepartments: this.hasOrgSeats()
        ? buildModelAuthorizationOrgDepartments({
            orgRoster: this.orgRoster,
            query: this.directoryQuery,
          })
        : undefined,
      modelCatalog: this.modelCatalog,
      directoryQuery: this.directoryQuery,
      onDirectoryQuery: (value) => {
        this.directoryQuery = value;
      },
      selectedKey: selected?.key ?? null,
      onSelectSubject: (key) => {
        this.selectedKey = key;
      },
      preview: preview?.subject ?? null,
      previewHasRecord: preview?.hasRecord ?? false,
      previewRoleLabel: selected?.roleLabel ?? null,
      previewTitle: selected?.label ?? null,
      previewMeta: selected?.meta ?? null,
      onToggleModel: (subject, modelId, granted) =>
        void this.toggleModel(subject, modelId, granted),
      onRevokeSubject: (subject) => void this.revokeSubject(subject),
    };
    const options = this.filteredOptions();
    const usePicker =
      options.length > 0 || this.seatOptions.length > 0 || this.memberOptions.length > 0;
    return html`
      <div class="model-authorization-section" data-testid="model-authorization-section">
        ${renderModelAuthorizationPanel(panelProps)}
        ${
          view.hasEntitlement && !this.hasOrgSeats()
            ? html`
              <div class="card model-auth-add-subject">
                <div class="card-title">新增授权主体</div>
                <div class="row" style="gap: 8px; margin-top: 8px; align-items: center; flex-wrap: wrap;">
                  <select
                    .value=${this.newSubjectType}
                    ?disabled=${this.busy}
                    @change=${(e: Event) => {
                      this.newSubjectType = (e.target as HTMLSelectElement)
                        .value as ModelGrantSubjectType;
                      this.newSubjectId = "";
                      this.subjectFilter = "";
                    }}
                  >
                    <option value="seat">席位</option>
                    <option value="employee">员工</option>
                  </select>
                  ${
                    usePicker
                      ? html`
                          <input
                            type="search"
                            placeholder="搜索席位或成员"
                            .value=${this.subjectFilter}
                            ?disabled=${this.busy}
                            @input=${(e: Event) => {
                              this.subjectFilter = (e.target as HTMLInputElement).value;
                            }}
                          />
                          <select
                            .value=${this.newSubjectId}
                            ?disabled=${this.busy || options.length === 0}
                            @change=${(e: Event) => {
                              this.newSubjectId = (e.target as HTMLSelectElement).value;
                            }}
                          >
                            <option value="">
                              ${this.newSubjectType === "seat" ? "选择席位…" : "选择员工…"}
                            </option>
                            ${options.map(
                              (opt) =>
                                html`<option value=${opt.id}>${opt.label} (${opt.id})</option>`,
                            )}
                          </select>
                        `
                      : html`
                          <input
                            type="text"
                            placeholder=${this.newSubjectType === "seat" ? "seatId" : "employeeId"}
                            .value=${this.newSubjectId}
                            ?disabled=${this.busy}
                            @input=${(e: Event) => {
                              this.newSubjectId = (e.target as HTMLInputElement).value;
                            }}
                          />
                        `
                  }
                  <button
                    class="btn primary"
                    ?disabled=${this.busy || !this.newSubjectId.trim()}
                    @click=${() => void this.addSubject()}
                  >
                    添加
                  </button>
                </div>
              </div>
            `
            : nothing
        }
      </div>
    `;
  }
}
