/**
 * Enterprise settings → 模型管理 → 模型与 API Key.
 * Adding a provider opens an editor and persists a tenant connection.
 * Model ids are registered only after the saved endpoint probes successfully.
 */
import { LitElement, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import "./enterprise-integrations-providers.css";
import type {
  EnterpriseModelAsset,
  EnterpriseModelPublicConnection,
} from "../../../capability/enterprise-model-provider/endpoints.ts";
import { createEnterpriseModelProviderGateway } from "../../../capability/enterprise-model-provider/gateway-client.ts";
import { createModelAuthorizationGateway } from "../../../capability/model-authorization/gateway-client.ts";
import type { GatewayBrowserClient } from "../../../gateway.ts";
import {
  buildModelAuthorizationOrgDepartments,
  type ModelAuthorizationOrgRoster,
} from "../../../views/model-authorization-directory.ts";
import { localizeEnterpriseGatewayThrown } from "../enterprise-connection-copy.ts";
import {
  buildEnterpriseModelKeyRows,
  type EnterpriseModelKeyRow,
} from "./enterprise-model-key-table.ts";
import {
  collectAllSeatIds,
  collectSeatIdsInDepartment,
  planSeatModelGrantWrites,
  renderPrivateModelSeatPanel,
  seatIdsWithModel,
  type SeatGrantSlice,
} from "./enterprise-private-model-seat-plan.ts";

type ProviderType = "openai" | "anthropic" | "openai-compatible" | "custom";

type EditorState = {
  mode: "create" | "edit";
  connectionId: string | null;
  displayName: string;
  providerType: ProviderType;
  baseUrl: string;
  apiKey: string;
  modelIds: string;
};

const PROVIDER_TYPES: Array<{ value: ProviderType; label: string }> = [
  { value: "openai-compatible", label: "OpenAI 兼容（自建 / 私有）" },
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "custom", label: "自定义" },
];

function protocolFor(providerType: string) {
  return providerType === "anthropic" ? "anthropic-messages" : "openai-completions";
}

function parseModelIds(raw: string) {
  const seen = new Set<string>();
  for (const part of raw.split(/[\s,，]+/)) {
    const id = part.trim();
    if (id) {
      seen.add(id);
    }
  }
  return [...seen];
}

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function errorText(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return localizeEnterpriseGatewayThrown(error, "操作失败");
  }
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) {
      return localizeEnterpriseGatewayThrown(message, "操作失败");
    }
  }
  return "操作失败";
}

function emptyEditor(): EditorState {
  return {
    mode: "create",
    connectionId: null,
    displayName: "",
    providerType: "openai-compatible",
    baseUrl: "",
    apiKey: "",
    modelIds: "",
  };
}

@customElement("enterprise-integrations-providers")
export class EnterpriseIntegrationsProviders extends LitElement {
  protected createRenderRoot() {
    return this;
  }

  @property({ attribute: false }) client: GatewayBrowserClient | null = null;
  @property({ type: String }) enterpriseId = "";
  @property({ attribute: false }) catalogProviderIds: string[] = [];
  @property({ attribute: false }) catalogModelIds: string[] = [];
  @property({ type: String }) modelMode = "";
  @property({ type: Number }) providerCount = 0;
  @property({ type: Number }) modelCount = 0;
  /** 打开「模型授权」，把已登记的企业自供模型勾到席位。 */
  @property({ attribute: false }) onOpenAuthorization: (() => void) | null = null;
  @property({ attribute: false }) orgRoster: ModelAuthorizationOrgRoster | null = null;

  @state() private connections: EnterpriseModelPublicConnection[] = [];
  @state() private assets: EnterpriseModelAsset[] = [];
  @state() private editor: EditorState | null = null;
  @state() private rotateConnectionId: string | null = null;
  @state() private rotateKey = "";
  @state() private notice: string | null = null;
  @state() private noticeTone: "ok" | "danger" = "danger";
  @state() private busy = false;
  @state() private seatConfigModelId: string | null = null;
  @state() private seatConfigChecked: Set<string> = new Set();
  @state() private seatGrantSlices: SeatGrantSlice[] = [];
  @state() private detailModelId: string | null = null;

  private loadedFor: string | null = null;

  protected updated(): void {
    const key = this.loadKey();
    if (key == null || this.loadedFor === key) {
      return;
    }
    this.loadedFor = key;
    void this.reload();
  }

  private loadKey() {
    if (!this.client || typeof this.client.request !== "function") {
      return null;
    }
    return this.enterpriseId || "";
  }

  private scope() {
    return this.enterpriseId ? { enterpriseId: this.enterpriseId } : {};
  }

  private gateway() {
    return this.client && typeof this.client.request === "function"
      ? createEnterpriseModelProviderGateway(this.client)
      : null;
  }

  private async reload() {
    const gw = this.gateway();
    if (!gw) {
      return;
    }
    try {
      const [providers, catalog] = await Promise.all([
        gw.list(this.scope()),
        gw.listCatalog(this.scope()),
      ]);
      this.connections = providers.connections ?? [];
      this.assets = catalog.assets ?? [];
    } catch (error) {
      this.notice = errorText(error);
      this.noticeTone = "danger";
    }
  }

  private async run(task: () => Promise<void>) {
    if (this.busy) {
      return;
    }
    this.busy = true;
    this.notice = null;
    try {
      await task();
    } catch (error) {
      this.notice = errorText(error);
      this.noticeTone = "danger";
    } finally {
      this.busy = false;
    }
  }

  private connectionForCatalog(providerId: string) {
    const key = providerId.toLowerCase();
    return this.connections.find((connection) => {
      if (connection.displayName.toLowerCase() === key) {
        return true;
      }
      return this.assets.some(
        (asset) =>
          asset.connectionId === connection.connectionId &&
          (asset.runtimeModelId.toLowerCase().startsWith(`${key}/`) ||
            asset.upstreamModelId.toLowerCase() === key),
      );
    });
  }

  private enterpriseOnlyConnections() {
    const catalog = new Set(this.catalogProviderIds.map((id) => id.toLowerCase()));
    return this.connections.filter((connection) => {
      if (catalog.has(connection.displayName.toLowerCase())) {
        return false;
      }
      return !this.catalogProviderIds.some(
        (providerId) =>
          this.connectionForCatalog(providerId)?.connectionId === connection.connectionId,
      );
    });
  }

  private modelsForConnection(connectionId: string) {
    return this.assets
      .filter((asset) => asset.connectionId === connectionId)
      .map((asset) => asset.upstreamModelId);
  }

  private hasRegisteredByok() {
    if (this.assets.some((asset) => asset.enabled)) {
      return true;
    }
    return this.enterpriseOnlyConnections().some((connection) =>
      ["verified", "models_discovered", "active"].includes(connection.status),
    );
  }

  private openCreate() {
    this.rotateConnectionId = null;
    this.editor = emptyEditor();
    this.notice = null;
  }

  private openModelRow(row: EnterpriseModelKeyRow) {
    if (row.supply === "enterprise" && row.connectionId) {
      const connection = this.connections.find((item) => item.connectionId === row.connectionId);
      this.detailModelId = null;
      if (connection) {
        this.openEditorForConnection(connection);
      }
      return;
    }
    this.editor = null;
    this.rotateConnectionId = null;
    this.detailModelId = this.detailModelId === row.modelId ? null : row.modelId;
  }

  private openEditorForConnection(connection: EnterpriseModelPublicConnection) {
    this.detailModelId = null;
    this.rotateConnectionId = null;
    const providerType = PROVIDER_TYPES.some((item) => item.value === connection.providerType)
      ? (connection.providerType as ProviderType)
      : "openai-compatible";
    this.editor = {
      mode: "edit",
      connectionId: connection.connectionId,
      displayName: connection.displayName,
      providerType,
      baseUrl: connection.baseUrl ?? "",
      apiKey: "",
      modelIds: this.modelsForConnection(connection.connectionId).join(", "),
    };
    this.notice = null;
  }

  private validate(editor: EditorState) {
    const displayName = editor.displayName.trim();
    const baseUrl = editor.baseUrl.trim();
    const modelIds = parseModelIds(editor.modelIds);
    if (!displayName) {
      return "请填写显示名称。";
    }
    const needsBaseUrl =
      editor.providerType === "openai-compatible" || editor.providerType === "custom";
    if (needsBaseUrl && !baseUrl) {
      return "自建或自定义提供方需要填写 Base URL。";
    }
    if (baseUrl && !isHttpUrl(baseUrl)) {
      return "Base URL 需要是 http 或 https 地址，私有 IP 也可以。";
    }
    if (editor.mode === "create" && !editor.apiKey.trim()) {
      return "请填写 API Key。";
    }
    if (modelIds.length === 0) {
      return "请至少填写一个模型 ID。连接成功后才会登记这些模型。";
    }
    return null;
  }

  private async syncModels(connectionId: string, modelIds: string[]) {
    const gw = this.gateway();
    if (!gw) {
      return;
    }
    const desired = new Set(modelIds);
    const owned = this.assets.filter((asset) => asset.connectionId === connectionId);
    for (const upstreamModelId of modelIds) {
      const existing = owned.find((asset) => asset.upstreamModelId === upstreamModelId);
      if (!existing) {
        await gw.register({
          ...this.scope(),
          connectionId,
          upstreamModelId,
          displayName: upstreamModelId,
          enabled: true,
        });
        continue;
      }
      if (!existing.enabled) {
        await gw.enableAsset({ ...this.scope(), assetId: existing.assetId });
      }
    }
    for (const asset of owned) {
      if (asset.enabled && !desired.has(asset.upstreamModelId)) {
        await gw.disableAsset({ ...this.scope(), assetId: asset.assetId });
      }
    }
  }

  private async submitEditor(event: Event) {
    event.preventDefault();
    const editor = this.editor;
    const gw = this.gateway();
    if (!editor || !gw) {
      this.notice = "当前未连接网关，无法保存提供方。";
      this.noticeTone = "danger";
      return;
    }
    const invalid = this.validate(editor);
    if (invalid) {
      this.notice = invalid;
      this.noticeTone = "danger";
      return;
    }
    const modelIds = parseModelIds(editor.modelIds);
    const baseUrl = editor.baseUrl.trim();
    await this.run(async () => {
      if (editor.mode === "create") {
        const created = await gw.create({
          ...this.scope(),
          providerType: editor.providerType,
          displayName: editor.displayName.trim(),
          ...(baseUrl ? { baseUrl } : {}),
          protocol: protocolFor(editor.providerType),
          apiKey: editor.apiKey.trim(),
        });
        const connectionId = created.connection.connectionId;
        const tested = await gw.test({ ...this.scope(), connectionId });
        if (!tested.ok) {
          this.editor = { ...editor, mode: "edit", connectionId, apiKey: "" };
          this.notice =
            tested.message?.trim() || "连接未成功，模型尚未登记。请修正地址或密钥后再验证。";
          this.noticeTone = "danger";
          await this.reload();
          return;
        }
        await this.syncModels(connectionId, modelIds);
        this.editor = null;
        this.notice = "连接成功，模型已登记。";
        this.noticeTone = "ok";
        await this.reload();
        return;
      }
      const connectionId = editor.connectionId;
      if (!connectionId) {
        this.notice = "找不到要编辑的企业连接。";
        this.noticeTone = "danger";
        return;
      }
      await gw.update({
        ...this.scope(),
        connectionId,
        displayName: editor.displayName.trim(),
        ...(baseUrl ? { baseUrl } : {}),
        protocol: protocolFor(editor.providerType),
      });
      if (editor.apiKey.trim()) {
        await gw.rotateCredential({
          ...this.scope(),
          connectionId,
          apiKey: editor.apiKey.trim(),
        });
      } else {
        const tested = await gw.test({ ...this.scope(), connectionId });
        if (!tested.ok) {
          this.notice = tested.message?.trim() || "连接未成功，模型登记保持不变。";
          this.noticeTone = "danger";
          await this.reload();
          return;
        }
      }
      await this.syncModels(connectionId, modelIds);
      this.editor = null;
      this.notice = "连接成功，模型已更新。";
      this.noticeTone = "ok";
      await this.reload();
    });
  }

  private async verifyConnection(connection: EnterpriseModelPublicConnection) {
    const gw = this.gateway();
    if (!gw) {
      this.notice = "当前未连接网关，无法验证。";
      this.noticeTone = "danger";
      return;
    }
    await this.run(async () => {
      const tested = await gw.test({ ...this.scope(), connectionId: connection.connectionId });
      this.notice = tested.ok ? "连接验证成功。" : tested.message?.trim() || "连接验证失败。";
      this.noticeTone = tested.ok ? "ok" : "danger";
      await this.reload();
    });
  }

  private async rotate(connectionId: string) {
    const gw = this.gateway();
    const apiKey = this.rotateKey.trim();
    if (!gw) {
      this.notice = "当前未连接网关，无法轮换。";
      this.noticeTone = "danger";
      return;
    }
    if (!apiKey) {
      this.notice = "请填写新的 API Key。";
      this.noticeTone = "danger";
      return;
    }
    await this.run(async () => {
      await gw.rotateCredential({ ...this.scope(), connectionId, apiKey });
      this.rotateConnectionId = null;
      this.rotateKey = "";
      this.notice = "密钥已轮换，连接验证成功。";
      this.noticeTone = "ok";
      await this.reload();
    });
  }

  private async removeConnection(connectionId: string) {
    const gw = this.gateway();
    if (!gw) {
      this.notice = "当前未连接网关，无法移除。";
      this.noticeTone = "danger";
      return;
    }
    if (!window.confirm("移除该提供方将删除企业连接、已登记模型和密钥。继续？")) {
      return;
    }
    await this.run(async () => {
      try {
        await gw.delete({ ...this.scope(), connectionId });
      } catch (error) {
        const message = errorText(error);
        if (message.includes("force") || message.includes("启用") || message.includes("授权")) {
          if (!window.confirm(`${message}\n\n是否强制移除？`)) {
            return;
          }
          await gw.delete({ ...this.scope(), connectionId, force: true });
        } else {
          throw error;
        }
      }
      this.editor = null;
      this.rotateConnectionId = null;
      this.notice = "已移除提供方。";
      this.noticeTone = "ok";
      await this.reload();
    });
  }

  private renderActions(connection: EnterpriseModelPublicConnection) {
    return html`
      <div class="enterprise-model-key-table__actions">
        <button
          class="btn btn--sm"
          type="button"
          data-testid="enterprise-provider-verify"
          data-connection-id=${connection.connectionId}
          ?disabled=${this.busy}
          @click=${() => void this.verifyConnection(connection)}
        >
          验证密钥
        </button>
        <button
          class="btn btn--sm"
          type="button"
          data-testid="enterprise-provider-edit"
          data-connection-id=${connection.connectionId}
          ?disabled=${this.busy}
          @click=${() => this.openEditorForConnection(connection)}
        >
          编辑
        </button>
        <button
          class="btn btn--sm"
          type="button"
          data-testid="enterprise-provider-rotate"
          data-connection-id=${connection.connectionId}
          ?disabled=${this.busy}
          @click=${() => {
            this.rotateConnectionId = connection.connectionId;
            this.rotateKey = "";
            this.editor = null;
            this.detailModelId = null;
          }}
        >
          轮换
        </button>
        <button
          class="btn btn--sm btn--danger"
          type="button"
          data-testid="enterprise-provider-remove"
          data-connection-id=${connection.connectionId}
          ?disabled=${this.busy}
          @click=${() => void this.removeConnection(connection.connectionId)}
        >
          移除
        </button>
      </div>
    `;
  }

  private renderRotateForm(connectionId: string) {
    if (this.rotateConnectionId !== connectionId) {
      return nothing;
    }
    return html`
      <form
        class="enterprise-provider-editor"
        data-testid="enterprise-provider-rotate-form"
        @submit=${(event: Event) => {
          event.preventDefault();
          void this.rotate(connectionId);
        }}
      >
        <label class="field">
          <span>新的 API Key</span>
          <input
            type="password"
            name="apiKey"
            data-testid="enterprise-provider-rotate-key"
            .value=${this.rotateKey}
            @input=${(event: Event) => {
              this.rotateKey =
                event.currentTarget instanceof HTMLInputElement ? event.currentTarget.value : "";
            }}
          />
        </label>
        <div class="row row--end row--tight">
          <button class="btn btn--sm" type="button" @click=${() => (this.rotateConnectionId = null)}>
            取消
          </button>
          <button class="btn btn--sm btn--primary" type="submit" ?disabled=${this.busy}>确认轮换</button>
        </div>
      </form>
    `;
  }

  private renderEditor() {
    const editor = this.editor;
    if (!editor) {
      return nothing;
    }
    const set = (key: keyof EditorState) => (event: Event) => {
      const target = event.currentTarget;
      const value =
        target instanceof HTMLInputElement || target instanceof HTMLSelectElement
          ? target.value
          : "";
      this.editor = this.editor ? { ...this.editor, [key]: value } : this.editor;
    };
    return html`
      <form
        class="enterprise-provider-editor"
        data-testid="enterprise-provider-editor"
        @submit=${(event: Event) => void this.submitEditor(event)}
      >
        <div class="enterprise-provider-editor__grid">
          <label class="field">
            <span>显示名称</span>
            <input
              name="displayName"
              data-testid="enterprise-provider-display-name"
              .value=${editor.displayName}
              @input=${set("displayName")}
            />
          </label>
          <label class="field">
            <span>协议类型</span>
            <select
              name="providerType"
              data-testid="enterprise-provider-type"
              .value=${editor.providerType}
              ?disabled=${editor.mode === "edit"}
              @change=${set("providerType")}
            >
              ${PROVIDER_TYPES.map(
                (item) => html`<option value=${item.value}>${item.label}</option>`,
              )}
            </select>
          </label>
          <label class="field">
            <span>Base URL</span>
            <input
              name="baseUrl"
              data-testid="enterprise-provider-base-url"
              placeholder="https://llm.internal.example/v1 或 http://10.0.0.8:8000/v1"
              .value=${editor.baseUrl}
              @input=${set("baseUrl")}
            />
          </label>
          <label class="field">
            <span>API Key</span>
            <input
              type="password"
              name="apiKey"
              data-testid="enterprise-provider-api-key"
              placeholder=${editor.mode === "edit" ? "留空则不更换密钥" : ""}
              .value=${editor.apiKey}
              @input=${set("apiKey")}
            />
          </label>
          <label class="field enterprise-provider-editor__wide">
            <span>模型 ID</span>
            <input
              name="modelIds"
              data-testid="enterprise-provider-model-ids"
              placeholder="qwen2.5, deepseek-chat"
              .value=${editor.modelIds}
              @input=${set("modelIds")}
            />
          </label>
        </div>
        <p class="muted">支持私有或自建 OpenAI 兼容地址。连接验证成功后才会登记模型。</p>
        <div class="row row--end row--tight">
          <button
            class="btn btn--sm"
            type="button"
            data-testid="enterprise-provider-cancel"
            @click=${() => (this.editor = null)}
          >
            取消
          </button>
          <button
            class="btn btn--sm btn--primary"
            type="submit"
            data-testid="enterprise-provider-submit"
            ?disabled=${this.busy}
          >
            保存并验证
          </button>
        </div>
      </form>
    `;
  }

  private seatDepartments() {
    return buildModelAuthorizationOrgDepartments({ orgRoster: this.orgRoster });
  }

  private async openSeatConfig(modelId: string) {
    if (this.seatConfigModelId === modelId) {
      this.seatConfigModelId = null;
      return;
    }
    if (!this.client || typeof this.client.request !== "function") {
      this.notice = "未连接网关，无法配置席位。";
      this.noticeTone = "danger";
      return;
    }
    this.busy = true;
    this.notice = null;
    try {
      const listed = await createModelAuthorizationGateway(this.client).listGrants(this.scope());
      const grants = listed.grants ?? [];
      const slices = new Map<string, string[]>();
      for (const seat of this.orgRoster?.seats ?? []) {
        if (seat.seatId.trim()) {
          slices.set(seat.seatId, []);
        }
      }
      for (const grant of grants) {
        if (grant.subjectType !== "seat" || grant.status === "revoked") {
          continue;
        }
        const seatId = (grant.seatId || grant.subjectId).trim();
        if (seatId) {
          slices.set(seatId, [...grant.grantedModelIds]);
        }
      }
      this.seatGrantSlices = [...slices.entries()].map(([seatId, grantedModelIds]) => ({
        seatId,
        grantedModelIds,
      }));
      this.seatConfigChecked = seatIdsWithModel(modelId, grants);
      this.seatConfigModelId = modelId;
    } catch (err) {
      this.notice = errorText(err);
      this.noticeTone = "danger";
    } finally {
      this.busy = false;
    }
  }

  private toggleSeatConfig(seatId: string) {
    const next = new Set(this.seatConfigChecked);
    if (next.has(seatId)) {
      next.delete(seatId);
    } else {
      next.add(seatId);
    }
    this.seatConfigChecked = next;
  }

  private toggleSeatDepartment(fullPath: string) {
    const ids = collectSeatIdsInDepartment(this.seatDepartments(), fullPath);
    const next = new Set(this.seatConfigChecked);
    const allOn = ids.length > 0 && ids.every((id) => next.has(id));
    for (const id of ids) {
      if (allOn) {
        next.delete(id);
      } else {
        next.add(id);
      }
    }
    this.seatConfigChecked = next;
  }

  private toggleAllSeatConfig() {
    const ids = collectAllSeatIds(this.seatDepartments());
    const allOn = ids.length > 0 && ids.every((id) => this.seatConfigChecked.has(id));
    this.seatConfigChecked = allOn ? new Set() : new Set(ids);
  }

  private async saveSeatConfig() {
    const modelId = this.seatConfigModelId;
    if (!modelId || !this.client || typeof this.client.request !== "function") {
      return;
    }
    const writes = planSeatModelGrantWrites({
      modelId,
      seats: this.seatGrantSlices,
      selectedSeatIds: this.seatConfigChecked,
    });
    if (writes.length === 0) {
      this.notice = "席位授权没有变化。";
      this.noticeTone = "ok";
      this.seatConfigModelId = null;
      return;
    }
    this.busy = true;
    this.notice = null;
    try {
      await createModelAuthorizationGateway(this.client).grantBatch({
        ...this.scope(),
        grants: writes,
      });
      this.notice = "席位配置已写入模型授权。";
      this.noticeTone = "ok";
      this.seatConfigModelId = null;
    } catch (err) {
      this.notice = errorText(err);
      this.noticeTone = "danger";
    } finally {
      this.busy = false;
    }
  }

  private modelKeyRows() {
    return buildEnterpriseModelKeyRows({
      catalogModelIds: this.catalogModelIds,
      assets: this.assets,
      connections: this.connections,
    });
  }

  private renderPlatformDetail(row: EnterpriseModelKeyRow) {
    if (row.supply !== "platform" || this.detailModelId !== row.modelId) {
      return nothing;
    }
    return html`
      <tr class="enterprise-model-key-table__detail" data-testid="enterprise-platform-model-detail">
        <td colspan="4">
          <dl class="enterprise-model-key-table__facts">
            <div>
              <dt>模型名称</dt>
              <dd>${row.title}</dd>
            </div>
            <div>
              <dt>模型 ID</dt>
              <dd>${row.modelId}</dd>
            </div>
            <div>
              <dt>供给方</dt>
              <dd>平台提供</dd>
            </div>
            <div>
              <dt>模型配置</dt>
              <dd>套餐下发。端点与密钥由平台维护，企业不能在这里修改。</dd>
            </div>
          </dl>
          <button
            class="btn btn--sm"
            type="button"
            data-testid="enterprise-platform-model-detail-close"
            @click=${() => {
              this.detailModelId = null;
            }}
          >
            关闭
          </button>
        </td>
      </tr>
    `;
  }

  private renderSeatPanel(row: EnterpriseModelKeyRow) {
    if (this.seatConfigModelId !== row.modelId) {
      return nothing;
    }
    return html`
      <tr class="enterprise-model-key-table__detail">
        <td colspan="4">
          ${renderPrivateModelSeatPanel({
            modelLabel: row.title,
            departments: this.seatDepartments(),
            checkedSeatIds: this.seatConfigChecked,
            busy: this.busy,
            onToggleSeat: (seatId) => this.toggleSeatConfig(seatId),
            onToggleDepartment: (fullPath) => this.toggleSeatDepartment(fullPath),
            onToggleAll: () => this.toggleAllSeatConfig(),
            onCancel: () => {
              this.seatConfigModelId = null;
            },
            onSave: () => void this.saveSeatConfig(),
          })}
        </td>
      </tr>
    `;
  }

  private renderConfigCell(row: EnterpriseModelKeyRow) {
    if (!row.configEditable) {
      return html`<span>${row.configSummary}</span>`;
    }
    const connection = row.connectionId
      ? this.connections.find((item) => item.connectionId === row.connectionId)
      : undefined;
    return html`
      <div class="enterprise-model-key-table__config">
        <span>${row.configSummary}</span>
        ${connection ? this.renderActions(connection) : nothing}
        ${connection ? this.renderRotateForm(connection.connectionId) : nothing}
      </div>
    `;
  }

  private renderModelKeyTable() {
    const clientMissing = !this.client;
    const rows = this.modelKeyRows();
    if (rows.length === 0) {
      return html`
        <div class="enterprise-settings-empty">当前没有已登记的模型。</div>
      `;
    }
    return html`
      <div class="enterprise-model-key-table-wrap">
        <table class="enterprise-model-key-table" data-testid="enterprise-model-key-table">
          <thead>
            <tr>
              <th>模型名称</th>
              <th>供给方</th>
              <th>模型配置</th>
              <th>席位配置</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(
              (row) => html`
                <tr data-model-id=${row.modelId} data-supply=${row.supply}>
                  <td>
                    <button
                      class="enterprise-model-key-table__name"
                      type="button"
                      data-testid="enterprise-model-name"
                      data-model-id=${row.modelId}
                      data-supply=${row.supply}
                      ?disabled=${this.busy}
                      @click=${() => this.openModelRow(row)}
                    >
                      ${row.title}
                    </button>
                  </td>
                  <td>${row.supplyLabel}</td>
                  <td>${this.renderConfigCell(row)}</td>
                  <td>
                    <button
                      class="btn btn--sm"
                      type="button"
                      data-testid="enterprise-model-seat-config"
                      data-model-id=${row.modelId}
                      data-supply=${row.supply}
                      ?disabled=${this.busy || clientMissing}
                      title=${clientMissing ? "未连接网关，无法配置席位。" : "按席位授权该模型"}
                      @click=${() => void this.openSeatConfig(row.modelId)}
                    >
                      席位配置
                    </button>
                  </td>
                </tr>
                ${this.renderPlatformDetail(row)}
                ${this.renderSeatPanel(row)}
              `,
            )}
          </tbody>
        </table>
      </div>
    `;
  }

  render() {
    const clientMissing = !this.client;
    const subtitle = clientMissing
      ? "未连接网关，不能读取或保存企业提供方。"
      : this.providerCount > 0
        ? `${this.providerCount} 个提供方 · ${this.modelCount} 个模型${this.modelMode ? ` · 模式 ${this.modelMode}` : ""}`
        : "尚未配置模型提供方。机器人将无法路由 AI 调用。";
    const selfHosted =
      this.connections.length > 0 ? ` · ${this.connections.length} 个企业自供` : "";
    return html`
      <article class="enterprise-settings-panel enterprise-settings-panel--flat">
        <div class="enterprise-settings-panel__head">
          <div>
            <div class="enterprise-settings-panel__title">模型与 API Key</div>
            <div class="enterprise-settings-panel__sub">${subtitle}${selfHosted}</div>
          </div>
          <button
            class="btn btn--sm btn--primary enterprise-settings-panel__head-action"
            type="button"
            data-testid="enterprise-add-provider"
            ?disabled=${this.busy || clientMissing}
            title=${clientMissing ? "未连接网关，无法添加提供方。" : "添加企业自供模型提供方"}
            @click=${() => this.openCreate()}
          >
            + 添加提供方
          </button>
        </div>
        ${
          this.notice
            ? html`<div class="callout ${this.noticeTone === "ok" ? "ok" : "danger"}" data-testid="enterprise-provider-notice">${this.notice}</div>`
            : nothing
        }
        ${
          this.hasRegisteredByok()
            ? html`
                <div class="enterprise-byok-authorize" data-testid="enterprise-byok-authorize-hint">
                  <span>企业自供模型已登记。未做席位配置前只出现在列表里，员工还不能调用。</span>
                  ${
                    this.onOpenAuthorization
                      ? html`
                          <button
                            class="btn btn--sm"
                            type="button"
                            data-testid="enterprise-open-model-authorization"
                            @click=${() => this.onOpenAuthorization?.()}
                          >
                            去授权席位
                          </button>
                        `
                      : nothing
                  }
                </div>
              `
            : nothing
        }
        ${this.renderModelKeyTable()}
        ${this.renderEditor()}
      </article>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "enterprise-integrations-providers": EnterpriseIntegrationsProviders;
  }
}
