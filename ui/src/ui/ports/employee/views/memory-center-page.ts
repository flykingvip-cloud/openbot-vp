import { html, nothing, type TemplateResult } from "lit";
import type { SettingsContract } from "./workbench-stage-contracts.ts";

export type MemoryCenterEntryRow = {
  key: string;
  label: string;
  bytes: number;
  updatedAtMs: number;
};

export type MemoryCenterAtomRow = {
  id: string;
  summary: string;
  atomType: string;
  whyHint?: string;
  scope: {
    kind: "agent" | "space" | "group";
    visibility: "private" | "shared";
    agentId?: string;
    spaceId?: string;
    groupKey?: string;
  };
  botId: string;
  privacyLevel?: "private" | "shared" | "org" | "public";
  syncEligible: boolean;
  shared: boolean;
  status: string;
  updatedAtMs: number;
  confidence?: number;
};

export type MemoryCenterPanelState = {
  loading?: boolean;
  error?: string | null;
  mode?: "local" | "managed" | null;
  agentId?: string;
  selectedKey?: string;
  selectedAtomId?: string;
  busy?: boolean;
  message?: string | null;
  entries?: MemoryCenterEntryRow[];
  atoms?: MemoryCenterAtomRow[];
  viewMode?: "files" | "atoms" | "mixed";
  entriesLoading?: boolean;
};

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return "—";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatUpdatedAt(ms: number): string {
  if (!ms) {
    return "—";
  }
  try {
    return new Date(ms).toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

function scopeLabel(atom: MemoryCenterAtomRow): string {
  if (atom.scope.kind === "space") {
    return `空间 · ${atom.scope.spaceId ?? atom.botId}`;
  }
  if (atom.scope.kind === "group") {
    return `协作 · ${atom.scope.groupKey ?? atom.botId}`;
  }
  return `机器人 · ${atom.scope.agentId ?? atom.botId}`;
}

/**
 * CW2-P6 Memory Center — user view/delete loop for agent memory entries + atoms.
 * Hides journals, embeddings, vector backends, and other implementation details.
 * When `embedded`, omit the page chrome title (parent panel supplies 隐私与记忆).
 */
export function renderMemoryCenterPanel(
  settings: SettingsContract,
  state: MemoryCenterPanelState,
  options?: { embedded?: boolean },
): TemplateResult {
  const embedded = Boolean(options?.embedded);
  const robotOptions = (settings.robotEntries ?? [])
    .filter((entry) => entry.source === "owned")
    .map((entry) => ({
      value: entry.id,
      label: entry.name?.trim() || entry.id,
    }));
  const groupOptions = (settings.groupEntries ?? []).map((entry) => ({
    value: entry.groupId ?? entry.sessionKey,
    label: entry.title?.trim() || entry.sessionKey,
  }));
  const selected = (state.entries ?? []).find((entry) => entry.key === state.selectedKey);
  const selectedAtom = (state.atoms ?? []).find((atom) => atom.id === state.selectedAtomId);
  const hasAtoms = (state.atoms?.length ?? 0) > 0;
  const hasFiles = (state.entries?.length ?? 0) > 0;
  const empty = !hasAtoms && !hasFiles;

  if (state.mode === "managed") {
    return html`
      <div class="employee-workbench__memory-center ${embedded ? "is-embedded" : ""}">
        ${
          embedded
            ? nothing
            : html`
                <div class="employee-workbench__settings-section-title">隐私与记忆</div>
              `
        }
        <div class="employee-workbench__settings-status-copy">
          云端托管模式下，记忆由平台托管，本机无法查看或删除。
        </div>
      </div>
    `;
  }

  return html`
    <div class="employee-workbench__memory-center ${embedded ? "is-embedded" : ""}">
      ${
        embedded
          ? nothing
          : html`
              <div class="employee-workbench__settings-section-title">隐私与记忆</div>
            `
      }

      ${
        state.loading
          ? html`
              <div class="employee-workbench__settings-status-copy">正在加载…</div>
            `
          : nothing
      }
      ${
        state.error
          ? html`
              <div class="callout callout--danger employee-workbench__settings-callout">
                ${state.error}
              </div>
            `
          : nothing
      }

      <label class="employee-workbench__settings-field">
        <span class="employee-workbench__settings-field-label">机器人 / 小组</span>
        <select
          class="employee-workbench__settings-input"
          .value=${state.agentId ?? ""}
          @change=${(event: Event) =>
            settings.onMemoryCenterAgentIdChange?.(
              (event.currentTarget as HTMLSelectElement).value,
            )}
        >
          <option value="">请选择…</option>
          ${
            robotOptions.length > 0
              ? html`<optgroup label="机器人">
                  ${robotOptions.map(
                    (opt) => html`<option value=${opt.value}>${opt.label}</option>`,
                  )}
                </optgroup>`
              : nothing
          }
          ${
            groupOptions.length > 0
              ? html`<optgroup label="协作小组">
                  ${groupOptions.map(
                    (opt) => html`<option value=${opt.value}>${opt.label}</option>`,
                  )}
                </optgroup>`
              : nothing
          }
        </select>
      </label>

      ${
        !state.agentId
          ? html`
              <div class="employee-workbench__settings-status-copy">请先选择机器人 / 协作小组。</div>
            `
          : state.entriesLoading
            ? html`
                <div class="employee-workbench__settings-status-copy">正在加载记忆…</div>
              `
            : empty
              ? html`
                  <div class="employee-workbench__settings-status-copy">暂无可管理的记忆。</div>
                `
              : html`
                  ${
                    hasAtoms
                      ? html`
                          <div class="employee-workbench__memory-list-label">记忆要点</div>
                          <div
                            class="employee-workbench__settings-list employee-workbench__settings-list--meta"
                          >
                            ${(state.atoms ?? []).map((atom) => {
                              const active = atom.id === state.selectedAtomId;
                              return html`
                                <button
                                  type="button"
                                  class="employee-workbench__settings-row ${active ? "is-active" : ""}"
                                  @click=${() => settings.onMemoryCenterAtomIdChange?.(atom.id)}
                                >
                                  <div class="employee-workbench__settings-label">
                                    ${atom.summary}
                                  </div>
                                  <div class="employee-workbench__settings-value">
                                    ${scopeLabel(atom)} · ${formatUpdatedAt(atom.updatedAtMs)}
                                    ${atom.shared ? " · 共享" : ""}
                                  </div>
                                </button>
                              `;
                            })}
                          </div>
                        `
                      : nothing
                  }
                  ${
                    hasFiles
                      ? html`
                          <div class="employee-workbench__memory-list-label">记忆文件</div>
                          <div
                            class="employee-workbench__settings-list employee-workbench__settings-list--meta"
                          >
                            ${(state.entries ?? []).map((entry) => {
                              const active = entry.key === state.selectedKey;
                              return html`
                                <button
                                  type="button"
                                  class="employee-workbench__settings-row ${active ? "is-active" : ""}"
                                  @click=${() => settings.onMemoryCenterKeyChange?.(entry.key)}
                                >
                                  <div class="employee-workbench__settings-label">
                                    ${entry.label}
                                  </div>
                                  <div class="employee-workbench__settings-value">
                                    ${formatUpdatedAt(entry.updatedAtMs)} ·
                                    ${formatBytes(entry.bytes)}
                                  </div>
                                </button>
                              `;
                            })}
                          </div>
                        `
                      : nothing
                  }
                `
      }

      ${
        selectedAtom
          ? html`
              <div
                class="employee-workbench__settings-list employee-workbench__settings-list--meta employee-workbench__memory-detail"
              >
                <div class="employee-workbench__settings-row">
                  <div class="employee-workbench__settings-label">内容</div>
                  <div class="employee-workbench__settings-value">${selectedAtom.summary}</div>
                </div>
                ${
                  selectedAtom.whyHint
                    ? html`
                        <div class="employee-workbench__settings-row">
                          <div class="employee-workbench__settings-label">适用场景</div>
                          <div class="employee-workbench__settings-value">
                            ${selectedAtom.whyHint}
                          </div>
                        </div>
                      `
                    : nothing
                }
                <div class="employee-workbench__settings-row">
                  <div class="employee-workbench__settings-label">范围</div>
                  <div class="employee-workbench__settings-value">${scopeLabel(selectedAtom)}</div>
                </div>
                <div class="employee-workbench__settings-row">
                  <div class="employee-workbench__settings-label">类型</div>
                  <div class="employee-workbench__settings-value">${selectedAtom.atomType}</div>
                </div>
                <div class="employee-workbench__settings-row">
                  <div class="employee-workbench__settings-label">更新时间</div>
                  <div class="employee-workbench__settings-value">
                    ${formatUpdatedAt(selectedAtom.updatedAtMs)}
                  </div>
                </div>
              </div>
            `
          : nothing
      }

      ${
        selected
          ? html`
              <div
                class="employee-workbench__settings-list employee-workbench__settings-list--meta employee-workbench__memory-detail"
              >
                <div class="employee-workbench__settings-row">
                  <div class="employee-workbench__settings-label">名称</div>
                  <div class="employee-workbench__settings-value">${selected.label}</div>
                </div>
                <div class="employee-workbench__settings-row">
                  <div class="employee-workbench__settings-label">更新时间</div>
                  <div class="employee-workbench__settings-value">
                    ${formatUpdatedAt(selected.updatedAtMs)}
                  </div>
                </div>
                <div class="employee-workbench__settings-row">
                  <div class="employee-workbench__settings-label">大小</div>
                  <div class="employee-workbench__settings-value">
                    ${formatBytes(selected.bytes)}
                  </div>
                </div>
              </div>
              <div
                class="employee-workbench__settings-password-actions employee-workbench__settings-password-actions--inline"
              >
                <button
                  type="button"
                  class="btn btn--danger"
                  title="仅删除所选文件，不会清除其他来源中的相同内容，也不保证立即停止相关召回"
                  ?disabled=${state.busy || !state.selectedKey}
                  @click=${() => void settings.onMemoryCenterForget?.()}
                >
                  ${state.busy ? "处理中…" : "删除此记忆文件"}
                </button>
              </div>
            `
          : nothing
      }

      ${
        state.message
          ? html`
              <div class="callout employee-workbench__settings-callout">${state.message}</div>
            `
          : nothing
      }
    </div>
  `;
}
