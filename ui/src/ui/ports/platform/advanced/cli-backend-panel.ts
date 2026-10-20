/**
 * cli-backend-panel.ts — platform admin surface for CLI backends (the
 * third-party coding-agent CLIs bots can use as a model backend).
 *
 * Self-contained LitElement (mirrors fabric-panel): injected `client`,
 * self-fetches cliBackend.list, and drives upsert/remove/test. Platform-admin
 * only (the gateway methods are ADMIN-scoped).
 *
 * SECURITY: configuring a backend means the gateway will spawn `command` with
 * `args` locally. The panel shows an explicit warning and a connectivity test so
 * the admin verifies the executable before saving bots onto it.
 */

import { LitElement, html, nothing } from "lit";
import { property, state } from "lit/decorators.js";
import type { GatewayBrowserClient } from "../../../gateway.ts";

interface CliBackendEffective {
  command: string;
  args?: string[];
  output?: string;
  input?: string;
  modelArg?: string;
  sessionIdFields?: string[];
  clearEnv?: string[];
  modelCatalog?: Array<{ id: string; displayName?: string }>;
}

interface CliBackendDescriptor {
  id: string;
  source: "builtin" | "config" | "override";
  effective: CliBackendEffective | null;
  configured: boolean;
}

interface CliBackendPreset {
  id: string;
  label: string;
  description: string;
  config: CliBackendEffective;
}

interface ListResponse {
  backends: CliBackendDescriptor[];
  presets: CliBackendPreset[];
  builtinIds: string[];
}

interface TestResult {
  ok: boolean;
  resolved: boolean;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
}

interface CapabilityModel {
  id: string;
  displayName?: string;
  capabilities?: { streaming?: boolean; tools?: boolean; vision?: boolean };
}

interface CapabilitiesResponse {
  backendId: string;
  models: CapabilityModel[];
  features: { streaming: boolean; tools: boolean; vision: boolean };
  source: "declared" | "probe";
}

interface SecretRefView {
  source: string;
  provider: string;
  id: string;
}

interface CredentialRecord {
  credentialId: string;
  tenantId: string;
  scope: "enterprise" | "personal";
  subjectId?: string;
  backendId: string;
  envVars: Record<string, SecretRefView>;
  updatedAt: string;
}

interface VerifyResult {
  valid: boolean;
  resolvedKeys: string[];
  failedKeys: string[];
}

interface CredentialForm {
  credentialId: string;
  backendId: string;
  scope: "enterprise" | "personal";
  subjectId: string;
  envVars: string;
}

const EMPTY_CRED_FORM: CredentialForm = {
  credentialId: "",
  backendId: "",
  scope: "enterprise",
  subjectId: "",
  envVars: "",
};

/** Turn gateway/Zod JSON error blobs into operator-friendly Chinese text. */
function formatPanelError(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
    return trimmed;
  }
  try {
    const issues = JSON.parse(trimmed) as Array<{ message?: string; path?: unknown[] }>;
    if (!Array.isArray(issues) || issues.length === 0) {
      return trimmed;
    }
    const lines = issues.map((issue) => issue.message?.trim()).filter(Boolean);
    if (lines.length === 0) {
      return "请求参数无效，请检查必填项。";
    }
    return lines.join("；");
  } catch {
    return trimmed;
  }
}

function errorMessage(err: unknown): string {
  return formatPanelError(err instanceof Error ? err.message : String(err));
}

/** Parse "ENV_NAME = source:provider:id" lines into a SecretRef-First env map. */
function parseSecretRefLines(text: string): Record<string, SecretRefView> {
  const out: Record<string, SecretRefView> = {};
  for (const line of lines(text)) {
    const eq = line.indexOf("=");
    if (eq < 0) {
      continue;
    }
    const name = line.slice(0, eq).trim();
    const parts = line
      .slice(eq + 1)
      .trim()
      .split(":");
    if (!name || parts.length < 3) {
      continue;
    }
    const source = parts[0].trim();
    const provider = parts[1].trim();
    const id = parts.slice(2).join(":").trim();
    if (source && provider && id) {
      out[name] = { source, provider, id };
    }
  }
  return out;
}

interface FormState {
  id: string;
  command: string;
  args: string;
  output: string;
  input: string;
  modelArg: string;
  sessionIdFields: string;
  clearEnv: string;
  modelCatalog: string;
}

const EMPTY_FORM: FormState = {
  id: "",
  command: "",
  args: "",
  output: "json",
  input: "arg",
  modelArg: "",
  sessionIdFields: "",
  clearEnv: "",
  modelCatalog: "",
};

function lines(v: string): string[] {
  return v
    .split(/\r?\n/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

function commaList(v: string): string[] {
  return v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Parse "id" or "id|显示名" per line into structured catalog entries. */
function parseModelCatalog(v: string): Array<{ id: string; displayName?: string }> {
  return lines(v).map((line) => {
    const [id, displayName] = line.split("|").map((s) => s.trim());
    return displayName ? { id, displayName } : { id };
  });
}

/** Serialize structured catalog back to "id|显示名" lines for the editor. */
function stringifyModelCatalog(entries?: Array<{ id: string; displayName?: string }>): string {
  return (entries ?? []).map((e) => (e.displayName ? `${e.id}|${e.displayName}` : e.id)).join("\n");
}

export type CliBackendEnterpriseOption = {
  tenantId: string;
  label: string;
};

function formatProbeLabel(result: TestResult, backendId?: string): string {
  if (result.ok) {
    return "连通正常（exit 0）";
  }
  if (!result.resolved) {
    return "未检测到可执行文件（请确认已安装且在 Gateway 主机 PATH 中）";
  }
  const stderr = result.stderr ?? "";
  if (
    stderr.includes("ENOENT") &&
    (backendId === "codex-cli" || stderr.includes("/codex/") || stderr.includes("@openai/codex"))
  ) {
    return "Codex CLI 安装不完整：包装器可执行，但内置二进制缺失。请在 Gateway 主机执行 npm i -g @openai/codex 重装，并确认 which codex 指向可用安装。";
  }
  return `可执行文件存在，但探测非零退出（exit ${result.exitCode ?? "?"})`;
}

export class CliBackendAdminSection extends LitElement {
  protected createRenderRoot() {
    return this;
  }

  @property({ attribute: false }) client: GatewayBrowserClient | null = null;
  @property({ attribute: false }) enterprises: CliBackendEnterpriseOption[] = [];

  @state() private data: ListResponse | null = null;
  @state() private loading = false;
  @state() private busy = false;
  @state() private listError: string | null = null;
  @state() private credError: string | null = null;
  @state() private capError: string | null = null;
  @state() private editorError: string | null = null;
  @state() private notice: string | null = null;
  @state() private form: FormState = { ...EMPTY_FORM };
  @state() private editing = false;
  @state() private testResult: TestResult | null = null;
  @state() private testResultScope: "list" | "editor" | null = null;
  @state() private testResultBackendId: string | null = null;
  @state() private capabilities: CapabilitiesResponse | null = null;
  @state() private capabilitiesForId: string | null = null;
  @state() private credTenantId = "";
  @state() private credentials: CredentialRecord[] = [];
  @state() private credForm: CredentialForm = { ...EMPTY_CRED_FORM };
  @state() private credEditing = false;
  @state() private credBusy = false;
  @state() private verifyResults: Record<string, VerifyResult> = {};
  private loadedOnce = false;

  connectedCallback() {
    super.connectedCallback();
    if (this.client) {
      void this.load();
    }
  }

  updated(changed: Map<string, unknown>) {
    if (changed.has("client") && this.client && !this.loadedOnce) {
      void this.load();
    }
  }

  private async load() {
    if (!this.client) {
      return;
    }
    this.loadedOnce = true;
    this.loading = true;
    this.listError = null;
    try {
      this.data = await this.client.request<ListResponse>("cliBackend.list", {});
    } catch (err) {
      this.listError = errorMessage(err);
    } finally {
      this.loading = false;
    }
  }

  private applyPreset(presetId: string) {
    const preset = this.data?.presets.find((p) => p.id === presetId);
    if (!preset) {
      return;
    }
    const c = preset.config;
    this.form = {
      id: preset.id,
      command: c.command ?? "",
      args: (c.args ?? []).join("\n"),
      output: c.output ?? "json",
      input: c.input ?? "arg",
      modelArg: c.modelArg ?? "",
      sessionIdFields: (c.sessionIdFields ?? []).join(", "),
      clearEnv: (c.clearEnv ?? []).join(", "),
      modelCatalog: stringifyModelCatalog(c.modelCatalog),
    };
    this.editing = true;
    this.testResult = null;
    this.testResultScope = null;
    this.editorError = null;
  }

  private editExisting(d: CliBackendDescriptor) {
    const c = d.effective ?? { command: "" };
    this.form = {
      id: d.id,
      command: c.command ?? "",
      args: (c.args ?? []).join("\n"),
      output: c.output ?? "json",
      input: c.input ?? "arg",
      modelArg: c.modelArg ?? "",
      sessionIdFields: (c.sessionIdFields ?? []).join(", "),
      clearEnv: (c.clearEnv ?? []).join(", "),
      modelCatalog: stringifyModelCatalog(c.modelCatalog),
    };
    this.editing = true;
    this.testResult = null;
    this.testResultScope = null;
    this.editorError = null;
  }

  private buildConfig() {
    const config: Record<string, unknown> = {
      command: this.form.command.trim(),
      output: this.form.output,
      input: this.form.input,
    };
    const args = lines(this.form.args);
    if (args.length) {
      config.args = args;
    }
    if (this.form.modelArg.trim()) {
      config.modelArg = this.form.modelArg.trim();
    }
    const sids = commaList(this.form.sessionIdFields);
    if (sids.length) {
      config.sessionIdFields = sids;
    }
    const clears = commaList(this.form.clearEnv);
    if (clears.length) {
      config.clearEnv = clears;
    }
    const catalog = parseModelCatalog(this.form.modelCatalog);
    if (catalog.length) {
      config.modelCatalog = catalog;
    }
    return config;
  }

  private async save() {
    if (!this.client || this.busy) {
      return;
    }
    const id = this.form.id.trim();
    const command = this.form.command.trim();
    if (!id) {
      this.editorError = "请填写后端 ID（小写 slug，如 devin-cli）。";
      return;
    }
    if (!command) {
      this.editorError = "请填写可执行命令或绝对路径。";
      return;
    }
    this.busy = true;
    this.editorError = null;
    this.notice = null;
    try {
      await this.client.request("cliBackend.upsert", {
        id,
        config: this.buildConfig(),
      });
      this.notice = `已保存 CLI 后端「${id}」。`;
      this.editing = false;
      this.form = { ...EMPTY_FORM };
      await this.load();
    } catch (err) {
      this.editorError = errorMessage(err);
    } finally {
      this.busy = false;
    }
  }

  private async removeBackend(id: string) {
    if (!this.client || this.busy) {
      return;
    }
    if (
      typeof window !== "undefined" &&
      typeof window.confirm === "function" &&
      !window.confirm(`确认删除 CLI 后端「${id}」的配置覆盖？`)
    ) {
      return;
    }
    this.busy = true;
    this.listError = null;
    this.notice = null;
    try {
      await this.client.request("cliBackend.remove", { id });
      this.notice = `已删除 CLI 后端「${id}」的配置覆盖。`;
      if (this.capabilitiesForId === id) {
        this.capabilities = null;
        this.capabilitiesForId = null;
      }
      await this.load();
    } catch (err) {
      this.listError = errorMessage(err);
    } finally {
      this.busy = false;
    }
  }

  private async test(opts: { id?: string; command?: string }, scope: "list" | "editor") {
    if (!this.client || this.busy) {
      return;
    }
    this.busy = true;
    this.testResult = null;
    this.testResultScope = null;
    this.testResultBackendId = opts.id ?? null;
    if (scope === "list") {
      this.listError = null;
    } else {
      this.editorError = null;
    }
    try {
      this.testResult = await this.client.request<TestResult>("cliBackend.test", opts);
      this.testResultScope = scope;
    } catch (err) {
      const msg = errorMessage(err);
      if (scope === "list") {
        this.listError = msg;
      } else {
        this.editorError = msg;
      }
    } finally {
      this.busy = false;
    }
  }

  // ── Capability discovery (Task 8 / P0-2) ──────────────────────────────────
  private async loadCapabilities(id: string) {
    if (!this.client || this.busy) {
      return;
    }
    if (this.capabilitiesForId === id) {
      this.capabilities = null;
      this.capabilitiesForId = null;
      this.capError = null;
      return;
    }
    this.busy = true;
    this.capError = null;
    this.capabilities = null;
    this.capabilitiesForId = id;
    try {
      this.capabilities = await this.client.request<CapabilitiesResponse>(
        "cliBackend.capabilities",
        { id },
      );
    } catch (err) {
      this.capError = errorMessage(err);
      this.capabilitiesForId = null;
    } finally {
      this.busy = false;
    }
  }

  // ── Credentials (Task 8 verify + Task 9 enterprise entry) ─────────────────
  private async loadCredentials() {
    if (!this.client || this.credBusy) {
      return;
    }
    const tenantId = this.credTenantId.trim();
    if (!tenantId) {
      this.credError = "请先填写租户 ID（tenantId）。";
      return;
    }
    this.credBusy = true;
    this.credError = null;
    try {
      const res = await this.client.request<{ credentials: CredentialRecord[] }>(
        "cliBackend.credential.list",
        { tenantId },
      );
      this.credentials = res.credentials ?? [];
      this.verifyResults = {};
    } catch (err) {
      this.credError = errorMessage(err);
    } finally {
      this.credBusy = false;
    }
  }

  private async saveCredential() {
    if (!this.client || this.credBusy) {
      return;
    }
    const tenantId = this.credTenantId.trim();
    const envVars = parseSecretRefLines(this.credForm.envVars);
    if (!tenantId || !this.credForm.credentialId.trim() || !this.credForm.backendId.trim()) {
      this.credError = "租户 ID、凭证 ID、后端 ID 均必填。";
      return;
    }
    if (Object.keys(envVars).length === 0) {
      this.credError = "至少配置一个 env 变量（格式：NAME = source:provider:id，绝不填明文）。";
      return;
    }
    this.credBusy = true;
    this.credError = null;
    this.notice = null;
    let ok = false;
    try {
      await this.client.request("cliBackend.credential.set", {
        tenantId,
        credentialId: this.credForm.credentialId.trim(),
        backendId: this.credForm.backendId.trim(),
        scope: this.credForm.scope,
        ...(this.credForm.scope === "personal" && this.credForm.subjectId.trim()
          ? { subjectId: this.credForm.subjectId.trim() }
          : {}),
        envVars,
      });
      this.notice = `已保存凭证「${this.credForm.credentialId.trim()}」（仅存 SecretRef 引用，无明文）。`;
      this.credForm = { ...EMPTY_CRED_FORM };
      this.credEditing = false;
      ok = true;
    } catch (err) {
      this.credError = errorMessage(err);
    } finally {
      this.credBusy = false;
    }
    if (ok) {
      await this.loadCredentials();
    }
  }

  private async removeCredential(credentialId: string) {
    if (!this.client || this.credBusy) {
      return;
    }
    if (
      typeof window !== "undefined" &&
      typeof window.confirm === "function" &&
      !window.confirm(`确认删除凭证「${credentialId}」？这只会移除 SecretRef，不会显示密钥明文。`)
    ) {
      return;
    }
    this.credBusy = true;
    this.credError = null;
    let ok = false;
    try {
      await this.client.request("cliBackend.credential.remove", { credentialId });
      this.notice = `已删除凭证「${credentialId}」。`;
      ok = true;
    } catch (err) {
      this.credError = errorMessage(err);
    } finally {
      this.credBusy = false;
    }
    if (ok) {
      await this.loadCredentials();
    }
  }

  private async verifyCredential(credentialId: string) {
    if (!this.client || this.credBusy) {
      return;
    }
    const tenantId = this.credTenantId.trim();
    if (!tenantId) {
      this.credError = "校验前请先填写并加载租户 ID。";
      return;
    }
    this.credBusy = true;
    this.credError = null;
    try {
      const result = await this.client.request<VerifyResult>("cliBackend.verifyCredential", {
        tenantId,
        credentialId,
      });
      this.verifyResults = { ...this.verifyResults, [credentialId]: result };
    } catch (err) {
      this.credError = errorMessage(err);
    } finally {
      this.credBusy = false;
    }
  }

  render() {
    return html`
      <div class="stack">
        ${this.notice ? html`<div class="callout success">${this.notice}</div>` : nothing}
        ${this.renderWarning()} ${this.renderList()} ${this.editing ? this.renderEditor() : nothing}
        ${this.renderCredentials()}
      </div>
    `;
  }

  private renderWarning() {
    return html`
      <div class="callout info">
        <strong>安全提示：</strong>配置 CLI 后端会让网关在主机上以指定参数 spawn
        该可执行文件（通常带权限放宽参数）。
        这等同于本地命令执行，仅限平台管理员操作，所有变更均会写入审计日志。
        保存前请先用「测试」确认可执行文件可用。
        <div class="card-sub card-follow--xs">
          <strong>Devin CLI / Cursor 等本机登录型后端</strong>：员工在本机完成
          <code>devin auth login</code> 即可，通常<strong>无需</strong>在下方凭证区配置 API Key；仅需
          override 命令路径（Gateway PATH 不含 CLI 时）。
        </div>
      </div>
    `;
  }

  private configuredLabel(b: CliBackendDescriptor): string {
    if (!b.configured) {
      return b.source === "builtin" ? "内置默认" : "否";
    }
    return b.source === "override" ? "已覆盖" : "是";
  }

  private renderList() {
    const backends = this.data?.backends ?? [];
    return html`
      <section class="card">
        <div class="row row--split">
          <div>
            <div class="card-title">CLI 后端 / 第三方协作工具</div>
            <div class="card-sub">
              内置编程 agent CLI（claude / codex / cursor / devin / kiro）作为机器人模型后端
            </div>
          </div>
          <div class="row row--tight">
            <button
              class="btn btn--sm btn--primary"
              ?disabled=${this.busy}
              @click=${() => {
                this.form = { ...EMPTY_FORM };
                this.editing = true;
                this.testResult = null;
                this.testResultScope = null;
                this.editorError = null;
              }}
            >
              新增
            </button>
            <button class="btn btn--sm" ?disabled=${this.loading} @click=${() => this.load()}>
              ${this.loading ? "加载中…" : "刷新"}
            </button>
          </div>
        </div>
        ${this.listError ? html`<div class="callout danger card-follow--sm">${this.listError}</div>` : nothing}
        ${this.capError ? html`<div class="callout danger card-follow--sm">${this.capError}</div>` : nothing}
        <div class="platform-capabilities__distribution card-follow--sm">
          <table class="platform-capabilities__distribution-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>来源</th>
                <th>命令</th>
                <th>模型</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              ${backends.flatMap((b) => {
                const rows = [
                  html`
                    <tr>
                      <td><code class="text-xs">${b.id}</code></td>
                      <td>
                        <span
                          class="platform-capabilities__chip is-${b.source === "builtin" ? "neutral" : "ok"}"
                          >${b.source}</span
                        >
                      </td>
                      <td><span class="muted">${b.effective?.command ?? "—"}</span></td>
                      <td>
                        <span class="muted"
                          >${(b.effective?.modelCatalog ?? []).map((m) => m.id).join(", ") || "—"}</span
                        >
                      </td>
                      <td>${this.configuredLabel(b)}</td>
                      <td>
                        <div class="row row--tight">
                          <button
                            class="btn btn--sm"
                            ?disabled=${this.busy}
                            @click=${() => this.test({ id: b.id }, "list")}
                          >
                            测试
                          </button>
                          <button
                            class="btn btn--sm"
                            ?disabled=${this.busy}
                            @click=${() => this.loadCapabilities(b.id)}
                          >
                            ${this.capabilitiesForId === b.id ? "收起" : "能力"}
                          </button>
                          <button
                            class="btn btn--sm"
                            ?disabled=${this.busy}
                            @click=${() => this.editExisting(b)}
                          >
                            编辑
                          </button>
                          ${
                            b.configured
                              ? html`<button
                                  class="btn btn--sm"
                                  ?disabled=${this.busy}
                                  @click=${() => this.removeBackend(b.id)}
                                >
                                  删除覆盖
                                </button>`
                              : nothing
                          }
                        </div>
                      </td>
                    </tr>
                  `,
                ];
                if (this.capabilitiesForId === b.id && this.capabilities) {
                  rows.push(html`
                    <tr>
                      <td colspan="6">${this.renderCapabilitiesInline(this.capabilities, b)}</td>
                    </tr>
                  `);
                }
                return rows;
              })}
            </tbody>
          </table>
        </div>
        ${this.testResult && this.testResultScope === "list" ? this.renderTestResult() : nothing}
      </section>
    `;
  }

  /** Capability summary inline under a row — avoids duplicating the model ID column above. */
  private renderCapabilitiesInline(c: CapabilitiesResponse, backend: CliBackendDescriptor) {
    const flag = (on: boolean) => (on ? "✓" : "—");
    const catalogIds = (backend.effective?.modelCatalog ?? []).map((m) => m.id);
    const showModelTable = c.models.length > 0 && catalogIds.length === 0;
    return html`
      <div class="stack stack--snug">
        <div class="card-sub">
          <strong>能力摘要 · ${c.backendId}</strong> · 来源
          ${c.source === "declared" ? "声明" : "探测"} · streaming ${flag(c.features.streaming)} ·
          tools ${flag(c.features.tools)} · vision ${flag(c.features.vision)}
        </div>
        ${
          catalogIds.length > 0
            ? html`<div class="card-sub muted">
                模型列表见上表「模型」列（${catalogIds.join(", ")}）。
              </div>`
            : nothing
        }
        ${
          showModelTable
            ? html`
                <table class="platform-capabilities__distribution-table">
                  <thead>
                    <tr>
                      <th>模型 ID</th>
                      <th>显示名</th>
                      <th>streaming</th>
                      <th>tools</th>
                      <th>vision</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${c.models.map(
                      (m) => html`
                        <tr>
                          <td><code class="text-xs">${m.id}</code></td>
                          <td><span class="muted">${m.displayName ?? "—"}</span></td>
                          <td>${flag(Boolean(m.capabilities?.streaming))}</td>
                          <td>${flag(Boolean(m.capabilities?.tools))}</td>
                          <td>${flag(Boolean(m.capabilities?.vision))}</td>
                        </tr>
                      `,
                    )}
                  </tbody>
                </table>
              `
            : c.models.length === 0
              ? html`
                  <div class="card-sub muted">该后端未声明 modelCatalog；请刷新 Gateway 或检查内置后端版本。</div>
                `
              : nothing
        }
      </div>
    `;
  }

  private renderCredentials() {
    return html`
      <section class="card">
        <div class="card-title">凭证（企业共有 API Key · SecretRef-First）</div>
        <div class="card-sub card-follow--xs">
          仅<strong>托管模式</strong>（网关 spawn + 共享 API Key）需要在此配置 SecretRef。 Devin CLI
          / 本机 IDE 登录型后端请让员工自行 <code>devin auth login</code>，无需平台代填 Key。
        </div>
        ${this.credError ? html`<div class="callout danger card-follow--sm">${this.credError}</div>` : nothing}
        <div class="row row--tight row--bottom card-follow--sm">
          <label class="stack stack--tight">
            <span class="card-sub">企业租户</span>
            ${
              this.enterprises.length > 0
                ? html`
                    <select
                      class="input"
                      .value=${this.credTenantId}
                      @change=${(e: Event) => {
                        this.credTenantId = (e.target as HTMLSelectElement).value;
                        this.credError = null;
                        if (this.credTenantId.trim()) {
                          void this.loadCredentials();
                        } else {
                          this.credentials = [];
                        }
                      }}
                    >
                      <option value="">请选择租户…</option>
                      ${this.enterprises.map(
                        (entry) => html`
                          <option value=${entry.tenantId}>
                            ${entry.label} (${entry.tenantId})
                          </option>
                        `,
                      )}
                    </select>
                  `
                : html`
                    <input
                      class="input"
                      .value=${this.credTenantId}
                      placeholder="填写真实租户 ID 后加载"
                      @input=${(e: Event) => {
                        this.credTenantId = (e.target as HTMLInputElement).value;
                        this.credError = null;
                      }}
                    />
                  `
            }
          </label>
          <button
            class="btn btn--sm"
            ?disabled=${this.credBusy || !this.credTenantId.trim()}
            @click=${() => this.loadCredentials()}
          >
            ${this.credBusy ? "加载中…" : "刷新凭证"}
          </button>
          <button
            class="btn btn--sm"
            ?disabled=${this.credBusy || !this.credTenantId.trim()}
            @click=${() => {
              this.credEditing = true;
              this.credError = null;
            }}
          >
            添加凭证
          </button>
        </div>
        ${this.credentials.length > 0 ? this.renderCredentialList() : nothing}
        ${this.credEditing && this.credTenantId.trim() ? this.renderCredentialEditor() : nothing}
      </section>
    `;
  }

  private renderCredentialList() {
    return html`
      <div class="platform-capabilities__distribution card-follow--sm">
        <table class="platform-capabilities__distribution-table">
          <thead>
            <tr>
              <th>凭证 ID</th>
              <th>作用域</th>
              <th>后端</th>
              <th>env 变量</th>
              <th>校验</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            ${this.credentials.map((c) => {
              const v = this.verifyResults[c.credentialId];
              return html`
                <tr>
                  <td><code class="text-xs">${c.credentialId}</code></td>
                  <td>${c.scope === "enterprise" ? "企业共有" : `个人(${c.subjectId ?? "?"})`}</td>
                  <td><span class="muted">${c.backendId}</span></td>
                  <td><span class="muted">${Object.keys(c.envVars).join(", ") || "—"}</span></td>
                  <td>
                    ${
                      v
                        ? v.valid
                          ? html`
                              <span class="platform-capabilities__chip is-ok">有效</span>
                            `
                          : html`<span
                              class="platform-capabilities__chip is-danger"
                              title=${`failed: ${v.failedKeys.join(",")}`}
                              >无效</span
                            >`
                        : html`
                            <span class="muted">未校验</span>
                          `
                    }
                  </td>
                  <td>
                    <div class="row row--tight">
                      <button
                        class="btn btn--sm"
                        ?disabled=${this.credBusy}
                        @click=${() => this.verifyCredential(c.credentialId)}
                      >
                        校验
                      </button>
                      <button
                        class="btn btn--sm"
                        ?disabled=${this.credBusy}
                        @click=${() => this.removeCredential(c.credentialId)}
                      >
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              `;
            })}
          </tbody>
        </table>
      </div>
    `;
  }

  private renderCredentialEditor() {
    return html`
      <div class="grid grid-cols-2 grid--tight card-follow">
        <label class="stack stack--tight">
          <span class="card-sub">凭证 ID</span>
          <input
            class="input"
            .value=${this.credForm.credentialId}
            placeholder="corp-anthropic"
            @input=${(e: Event) => {
              this.credForm = {
                ...this.credForm,
                credentialId: (e.target as HTMLInputElement).value,
              };
            }}
          />
        </label>
        <label class="stack stack--tight">
          <span class="card-sub">后端 ID（backendId）</span>
          <input
            class="input"
            .value=${this.credForm.backendId}
            placeholder="claude-cli"
            @input=${(e: Event) => {
              this.credForm = { ...this.credForm, backendId: (e.target as HTMLInputElement).value };
            }}
          />
        </label>
        <label class="stack stack--tight">
          <span class="card-sub">作用域</span>
          <select
            class="input"
            .value=${this.credForm.scope}
            @change=${(e: Event) => {
              this.credForm = {
                ...this.credForm,
                scope: (e.target as HTMLSelectElement).value as "enterprise" | "personal",
              };
            }}
          >
            <option value="enterprise">企业共有</option>
            <option value="personal">个人/席位</option>
          </select>
        </label>
        ${
          this.credForm.scope === "personal"
            ? html`<label class="stack stack--tight">
                <span class="card-sub">subjectId（席位/员工）</span>
                <input
                  class="input"
                  .value=${this.credForm.subjectId}
                  placeholder="seat-9"
                  @input=${(e: Event) => {
                    this.credForm = {
                      ...this.credForm,
                      subjectId: (e.target as HTMLInputElement).value,
                    };
                  }}
                />
              </label>`
            : nothing
        }
      </div>
      <div class="card-follow--sm">
        <label class="stack stack--tight">
          <span class="card-sub">env 变量（每行 NAME = source:provider:id；绝不填明文）</span>
          <textarea
            class="input"
            rows="3"
            placeholder="ANTHROPIC_API_KEY = exec:vault:anthropic/api-key"
            .value=${this.credForm.envVars}
            @input=${(e: Event) => {
              this.credForm = {
                ...this.credForm,
                envVars: (e.target as HTMLTextAreaElement).value,
              };
            }}
          ></textarea>
        </label>
      </div>
      <div class="row row--tight card-follow--sm">
        <button
          class="btn btn--primary btn--sm"
          ?disabled=${this.credBusy || !this.credForm.credentialId.trim() || !this.credForm.backendId.trim()}
          @click=${() => this.saveCredential()}
        >
          ${this.credBusy ? "保存中…" : "保存凭证"}
        </button>
        <button
          class="btn btn--sm"
          @click=${() => {
            this.credEditing = false;
            this.credForm = { ...EMPTY_CRED_FORM };
          }}
        >
          取消
        </button>
      </div>
    `;
  }

  private renderTestResult() {
    const r = this.testResult!;
    const tone = r.ok ? "" : "danger";
    const label = formatProbeLabel(r, this.testResultBackendId ?? undefined);
    return html`
      <div class="callout ${tone} card-follow--sm">
        <div><strong>测试结果：</strong>${label}</div>
        ${r.stdout ? html`<pre class="callout-pre">${r.stdout.slice(0, 400)}</pre>` : nothing}
        ${r.stderr ? html`<pre class="callout-pre callout-pre--dim">${r.stderr.slice(0, 400)}</pre>` : nothing}
      </div>
    `;
  }

  private field(label: string, key: keyof FormState, placeholder = "") {
    return html`
      <label class="stack stack--tight">
        <span class="card-sub">${label}</span>
        <input
          class="input"
          .value=${this.form[key]}
          placeholder=${placeholder}
          @input=${(e: Event) => {
            this.form = { ...this.form, [key]: (e.target as HTMLInputElement).value };
          }}
        />
      </label>
    `;
  }

  private textarea(label: string, key: keyof FormState, placeholder = "") {
    return html`
      <label class="stack stack--tight">
        <span class="card-sub">${label}</span>
        <textarea
          class="input"
          rows="4"
          placeholder=${placeholder}
          @input=${(e: Event) => {
            this.form = { ...this.form, [key]: (e.target as HTMLTextAreaElement).value };
          }}
          .value=${this.form[key]}
        ></textarea>
      </label>
    `;
  }

  private renderEditor() {
    const presets = this.data?.presets ?? [];
    return html`
      <section class="card">
        <div class="row row--split">
          <div class="card-title">编辑 CLI 后端</div>
          <button
            class="btn btn--sm"
            @click=${() => {
              this.editing = false;
              this.testResult = null;
              this.testResultScope = null;
              this.editorError = null;
            }}
          >
            关闭
          </button>
        </div>
        ${this.editorError ? html`<div class="callout danger card-follow--sm">${this.editorError}</div>` : nothing}
        <div class="row row--tight card-follow--sm row--wrap">
          <span class="card-sub">从预设填充：</span>
          ${presets.map(
            (p) => html`
              <button
                class="btn btn--sm"
                title=${p.description}
                @click=${() => this.applyPreset(p.id)}
              >
                ${p.label}
              </button>
            `,
          )}
        </div>
        <div class="grid grid-cols-2 grid--tight card-follow--sm">
          ${this.field("ID（小写 slug，如 kiro-cli）", "id", "kiro-cli")}
          ${this.field("命令（可执行名或绝对路径）", "command", "kiro")}
          ${this.field("modelArg（传模型的参数，可空）", "modelArg", "--model")}
          ${this.field("sessionIdFields（逗号分隔）", "sessionIdFields", "thread_id, session_id")}
          ${this.field("clearEnv（逗号分隔，需清除的环境变量）", "clearEnv", "ANTHROPIC_API_KEY")}
          <label class="stack stack--tight">
            <span class="card-sub">output（输出解析）</span>
            <select
              class="input"
              .value=${this.form.output}
              @change=${(e: Event) => {
                this.form = { ...this.form, output: (e.target as HTMLSelectElement).value };
              }}
            >
              <option value="json">json</option>
              <option value="jsonl">jsonl</option>
              <option value="text">text</option>
            </select>
          </label>
          <label class="stack stack--tight">
            <span class="card-sub">input（prompt 传入方式）</span>
            <select
              class="input"
              .value=${this.form.input}
              @change=${(e: Event) => {
                this.form = { ...this.form, input: (e.target as HTMLSelectElement).value };
              }}
            >
              <option value="arg">arg</option>
              <option value="stdin">stdin</option>
            </select>
          </label>
        </div>
        <div class="card-follow--sm">
          ${this.textarea("args（每行一个）", "args", "exec\n--json")}
        </div>
        <div class="card-follow--sm">
          ${this.textarea("暴露模型 modelCatalog（每行一个：id 或 id|显示名）", "modelCatalog", "claude-sonnet|Claude Sonnet\nclaude-opus")}
          <div class="card-sub card-follow--xs">
            声明后,这些模型经 entitlement
            链授权即可被机器人/终端用户使用(<code>&lt;后端id&gt;/&lt;模型id&gt;</code>)。
          </div>
        </div>
        <div class="row row--tight card-follow--sm">
          <button
            class="btn btn--primary btn--sm"
            ?disabled=${this.busy}
            @click=${() => this.save()}
          >
            ${this.busy ? "保存中…" : "保存"}
          </button>
          <button
            class="btn btn--sm"
            ?disabled=${this.busy || !this.form.command.trim()}
            @click=${() => this.test({ command: this.form.command.trim() }, "editor")}
          >
            测试连通性
          </button>
        </div>
        ${this.testResult && this.testResultScope === "editor" ? this.renderTestResult() : nothing}
      </section>
    `;
  }
}

if (!customElements.get("cli-backend-admin-section")) {
  customElements.define("cli-backend-admin-section", CliBackendAdminSection);
}
