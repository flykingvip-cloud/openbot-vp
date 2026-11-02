/**
 * 企业端「模型授权」操作面。
 *
 * 左侧组织目录选择席位/员工，右侧预览并编辑该主体的模型授权。
 * 纯展示组件：变更通过回调上抛，由上层调用 `enterprise-model-grant.*`。
 */

import { html, nothing, type TemplateResult } from "lit";
import type {
  EnterpriseAuthorizationView,
  EnterpriseGrantSubjectView,
} from "../capability/model-authorization/view-model.ts";
import { renderIcon } from "../icons.ts";
import type { EnterpriseOrgDepartmentNode } from "../ports/enterprise/views/enterprise-org-tree-model.ts";
import "./model-authorization-panel.css";
import { renderEnterpriseOrgTree } from "../ports/enterprise/views/enterprise-org-tree-view.ts";
import type { ModelAuthorizationDirectoryEntry } from "./model-authorization-directory.ts";
import {
  describeUnavailableModelGrants,
  modelAuthorizationSubjectHeadline,
  presentAuthorizedModel,
  type AuthorizedModelCatalog,
} from "./model-authorization-presentation.ts";

export type ModelAuthorizationPanelProps = {
  view: EnterpriseAuthorizationView;
  busy?: boolean;
  error?: string | null;
  /** 嵌入「模型授权」页签时不再重复大标题。 */
  embedded?: boolean;
  summary?: string | null;
  unavailableModelIds?: readonly string[];
  directory?: readonly ModelAuthorizationDirectoryEntry[];
  /** 有组织名录时传入部门树，目录改为可折叠组织树。空数组表示搜索无匹配。 */
  orgDepartments?: readonly EnterpriseOrgDepartmentNode[];
  directoryQuery?: string;
  onDirectoryQuery?: (value: string) => void;
  selectedKey?: string | null;
  onSelectSubject?: (key: string) => void;
  /** 显式传入时（含 null）不再从目录推断预览。 */
  preview?: EnterpriseGrantSubjectView | null;
  previewHasRecord?: boolean;
  previewRoleLabel?: string | null;
  /** 组织目录上的人名或席位名；缺省时回退到目录条目或「席位/员工 · id」。 */
  previewTitle?: string | null;
  /** 目录副文案，例如岗位名或「空岗」。 */
  previewMeta?: string | null;
  modelCatalog?: AuthorizedModelCatalog | null;
  onToggleModel: (subject: EnterpriseGrantSubjectView, modelId: string, granted: boolean) => void;
  onRevokeSubject: (subject: EnterpriseGrantSubjectView) => void;
};

function subjectKey(subject: EnterpriseGrantSubjectView): string {
  return `${subject.subjectType}:${subject.subjectId}`;
}

function subjectLabel(subject: EnterpriseGrantSubjectView): string {
  const kind = subject.subjectType === "employee" ? "员工" : "席位";
  return `${kind} · ${subject.subjectId}`;
}

function directoryFromView(view: EnterpriseAuthorizationView): ModelAuthorizationDirectoryEntry[] {
  if (!view.subjects.length) {
    return [];
  }
  return [
    { key: "group:grants", kind: "group", label: "已授权主体", depth: 0 },
    ...view.subjects.map((subject) => ({
      key: subjectKey(subject),
      kind: "subject" as const,
      label: subjectLabel(subject),
      meta: subject.status === "active" ? "已有授权" : "已撤销",
      depth: 1,
      subjectType: subject.subjectType,
      subjectId: subject.subjectId,
      grantedCount: subject.rows.filter((row) => row.granted).length,
    })),
  ];
}

function unavailableFromView(view: EnterpriseAuthorizationView): string[] {
  return [
    ...new Set(
      view.subjects.flatMap((subject) =>
        subject.rows.filter((row) => !row.withinEntitlement).map((row) => row.modelId),
      ),
    ),
  ].toSorted();
}

function resolvePreview(
  props: ModelAuthorizationPanelProps,
  directory: readonly ModelAuthorizationDirectoryEntry[],
): { subject: EnterpriseGrantSubjectView; hasRecord: boolean } | null {
  if (props.preview !== undefined) {
    return props.preview
      ? { subject: props.preview, hasRecord: props.previewHasRecord ?? true }
      : null;
  }
  const subjects = directory.filter((entry) => entry.kind === "subject");
  const selected = props.selectedKey
    ? subjects.find((entry) => entry.key === props.selectedKey)
    : subjects[0];
  const match = selected
    ? props.view.subjects.find(
        (subject) =>
          subject.subjectType === selected.subjectType && subject.subjectId === selected.subjectId,
      )
    : undefined;
  const subject = match ?? props.view.subjects[0];
  return subject ? { subject, hasRecord: true } : null;
}

function headlineFor(
  props: ModelAuthorizationPanelProps,
  subject: EnterpriseGrantSubjectView,
  directory: readonly ModelAuthorizationDirectoryEntry[],
) {
  const explicitTitle = props.previewTitle?.trim() ?? "";
  if (explicitTitle) {
    return modelAuthorizationSubjectHeadline({
      label: explicitTitle,
      meta: props.previewMeta,
      subjectType: subject.subjectType,
      subjectId: subject.subjectId,
      roleLabel: props.previewRoleLabel,
    });
  }
  const entry = directory.find(
    (item) =>
      item.kind === "subject" &&
      item.subjectType === subject.subjectType &&
      item.subjectId === subject.subjectId,
  );
  if (!entry) {
    return { title: subjectLabel(subject), tooltip: subject.subjectId };
  }
  return modelAuthorizationSubjectHeadline(entry);
}

function selectedSeatId(selectedKey: string | null): string | null {
  return selectedKey?.startsWith("seat:") ? selectedKey.slice("seat:".length) : null;
}

function orphanDirectory(
  directory: readonly ModelAuthorizationDirectoryEntry[],
): ModelAuthorizationDirectoryEntry[] {
  const start = directory.findIndex((entry) => entry.key === "group:orphans");
  return start < 0 ? [] : directory.slice(start);
}

function renderSubjectButton(
  props: ModelAuthorizationPanelProps,
  entry: ModelAuthorizationDirectoryEntry,
  selectedKey: string | null,
) {
  return html`
    <button
      class="model-auth-directory__subject ${selectedKey === entry.key ? "is-active" : ""}"
      type="button"
      role="treeitem"
      data-testid="model-auth-subject"
      data-subject-key=${entry.key}
      aria-selected=${selectedKey === entry.key ? "true" : "false"}
      style=${`padding-left:${8 + entry.depth * 14}px`}
      @click=${() => props.onSelectSubject?.(entry.key)}
    >
      <span class="model-auth-directory__label">${entry.label}</span>
      <span class="model-auth-directory__meta">
        ${entry.meta ?? ""}
        ${entry.grantedCount ? html`<span> · ${entry.grantedCount} 个模型</span>` : nothing}
      </span>
    </button>
  `;
}

function renderFoldGroup(label: string, body: TemplateResult) {
  return html`
    <details class="enterprise-org-tree__team model-auth-directory__fold" open>
      <summary class="enterprise-org-tree__team-summary">
        <span class="enterprise-org-tree__toggle" aria-hidden="true">
          ${renderIcon("chevronRight", "enterprise-org-tree__toggle-icon")}
        </span>
        <span class="enterprise-org-tree__primary">${label}</span>
      </summary>
      <div class="enterprise-org-tree__children">${body}</div>
    </details>
  `;
}

function renderFlatDirectory(
  props: ModelAuthorizationPanelProps,
  directory: readonly ModelAuthorizationDirectoryEntry[],
  selectedKey: string | null,
) {
  const chunks: TemplateResult[] = [];
  let groupLabel: string | null = null;
  let subjects: ModelAuthorizationDirectoryEntry[] = [];
  const flush = () => {
    if (!groupLabel && subjects.length === 0) {
      return;
    }
    const rows = html`${subjects.map((entry) => renderSubjectButton(props, entry, selectedKey))}`;
    chunks.push(groupLabel ? renderFoldGroup(groupLabel, rows) : rows);
    subjects = [];
  };
  for (const entry of directory) {
    if (entry.kind === "group") {
      flush();
      groupLabel = entry.label;
      continue;
    }
    subjects.push(entry);
  }
  flush();
  return chunks;
}

function renderDirectory(
  props: ModelAuthorizationPanelProps,
  directory: readonly ModelAuthorizationDirectoryEntry[],
  selectedKey: string | null,
) {
  const useOrgTree = props.orgDepartments !== undefined;
  const subjects = directory.filter((entry) => entry.kind === "subject");
  const grantedBySeat = new Map<string, number>();
  for (const entry of subjects) {
    if (entry.subjectType === "seat" && entry.subjectId) {
      grantedBySeat.set(entry.subjectId, entry.grantedCount ?? 0);
    }
  }
  const orphans = useOrgTree ? orphanDirectory(directory) : [];
  const listBody = useOrgTree
    ? html`
        ${renderEnterpriseOrgTree({
          departments: [...(props.orgDepartments ?? [])],
          mode: "navigate",
          selectedSeatId: selectedSeatId(selectedKey),
          query: props.directoryQuery,
          disabled: props.busy,
          emptyLabel: "没有匹配的席位或员工。",
          formatPositionPrimary: (position) =>
            position.member?.displayLabel.trim() || position.seatTitle,
          formatPositionSecondary: (position) => (position.member ? position.seatTitle : "空岗"),
          renderPositionBadge: (position) => {
            const count = grantedBySeat.get(position.seatId) ?? 0;
            return count > 0 ? `${count} 个模型` : null;
          },
          onSelectPosition: (seatId) => props.onSelectSubject?.(`seat:${seatId}`),
        })}
        ${orphans.length > 0 ? renderFlatDirectory(props, orphans, selectedKey) : nothing}
      `
    : subjects.length === 0
      ? html`
          <div class="model-auth-empty">没有匹配的席位或员工。</div>
        `
      : html`
          <div class="model-auth-directory__list" role="tree" aria-label="组织目录">
            ${renderFlatDirectory(props, directory, selectedKey)}
          </div>
        `;
  return html`
    <aside class="model-auth-directory" data-testid="model-auth-directory">
      <div class="model-auth-directory__title">组织目录</div>
      <input
        class="model-auth-directory__search"
        type="search"
        data-testid="model-auth-directory-search"
        placeholder="搜索部门、席位或成员"
        .value=${props.directoryQuery ?? ""}
        ?disabled=${props.busy ?? false}
        @input=${(event: Event) => {
          props.onDirectoryQuery?.((event.target as HTMLInputElement).value);
        }}
      />
      ${listBody}
    </aside>
  `;
}

function renderPreview(
  props: ModelAuthorizationPanelProps,
  directory: readonly ModelAuthorizationDirectoryEntry[],
  preview: { subject: EnterpriseGrantSubjectView; hasRecord: boolean } | null,
) {
  if (!props.view.hasEntitlement) {
    return html`
      <div class="model-auth-preview" data-testid="model-auth-preview">
        <div class="model-auth-preview__title">模型授权</div>
        <div class="model-auth-empty">${props.view.notice}</div>
      </div>
    `;
  }
  if (!preview) {
    return html`
      <div class="model-auth-preview" data-testid="model-auth-preview">
        <div class="model-auth-preview__title">模型授权</div>
        <div class="model-auth-empty">从左侧组织目录选择席位或员工。</div>
      </div>
    `;
  }
  const { subject, hasRecord } = preview;
  const disabled = props.busy ?? false;
  const headline = headlineFor(props, subject, directory);
  const statusLabel = !hasRecord ? "尚未授权" : subject.status === "active" ? "生效中" : "已撤销";
  const roleLabel = props.previewRoleLabel?.trim() || "";
  return html`
    <div class="model-auth-preview" data-testid="model-auth-preview" data-subject-id=${subject.subjectId}>
      <div class="model-auth-preview__toolbar">
        <div class="model-auth-preview__title" title=${headline.tooltip}>${headline.title}</div>
        <button
          class="btn btn--sm danger"
          data-testid="model-auth-revoke"
          ?disabled=${disabled || !hasRecord || subject.status !== "active"}
          @click=${() => props.onRevokeSubject(subject)}
        >
          撤销全部
        </button>
      </div>
      <details class="model-auth-advanced model-auth-preview__meta">
        <summary>授权细节</summary>
        <div>
          状态：${statusLabel}
          ${subject.updatedAt ? html` · 更新于 ${subject.updatedAt}` : nothing}
        </div>
        ${roleLabel ? html`<div>岗位角色：${roleLabel}。可在角色默认档案上微调。</div>` : nothing}
        <div class="model-auth-row__id">${subject.subjectId}</div>
      </details>
      <div class="model-auth-rows">
        ${subject.rows.map((row) => {
          const presented = presentAuthorizedModel(row.modelId, props.modelCatalog);
          const missingFromLibrary =
            !row.withinEntitlement &&
            row.modelId.startsWith("ent/") &&
            props.modelCatalog != null &&
            !props.modelCatalog.byRuntimeId.has(row.modelId);
          const scopeLabel = missingFromLibrary ? "已移除" : "越界";
          const scopeTitle = missingFromLibrary
            ? "模型库里已经没有这个企业模型。取消勾选即可从授权中移除。"
            : "不在企业模型上界内。不能新授权；已勾选的可以取消。";
          // 未授权且不在上界：不能勾上。已经授权的越界行必须能取消，否则整次保存都会被拒。
          const lockedOut = !row.withinEntitlement && !row.granted;
          return html`
            <label class="model-auth-row" data-model-id=${row.modelId}>
              <input
                type="checkbox"
                .checked=${row.granted}
                ?disabled=${disabled || lockedOut}
                @change=${(event: Event) =>
                  props.onToggleModel(
                    subject,
                    row.modelId,
                    (event.target as HTMLInputElement).checked,
                  )}
              />
              <span class="model-auth-row__body">
                <span class="model-auth-row__line">
                  <span class="model-auth-row__title">${presented.title}</span>
                  <span class="model-auth-source model-auth-source--${presented.sourceKind}">
                    ${presented.badge}
                  </span>
                  ${
                    row.withinEntitlement
                      ? nothing
                      : html` <span class="badge warn" title=${scopeTitle}>${scopeLabel}</span> `
                  }
                </span>
                <span class="model-auth-row__id">${row.modelId}</span>
              </span>
            </label>
          `;
        })}
      </div>
    </div>
  `;
}

export function renderModelAuthorizationPanel(props: ModelAuthorizationPanelProps) {
  const directory = props.directory ?? directoryFromView(props.view);
  const preview = resolvePreview(props, directory);
  const selectedKey = props.selectedKey ?? (preview ? subjectKey(preview.subject) : null);
  const unavailable = [...(props.unavailableModelIds ?? unavailableFromView(props.view))];
  const blockedSentence = describeUnavailableModelGrants({
    modelIds: unavailable,
    catalog: props.modelCatalog,
  });
  const errorText = props.error?.trim() || "";
  const showError = errorText.length > 0 && errorText !== blockedSentence;
  const showCeilingModels = props.view.hasEntitlement;
  return html`
    <section class="model-auth-panel" data-testid="model-auth-panel">
      ${
        props.embedded
          ? nothing
          : html`
              <div class="model-auth-heading">模型授权</div>
            `
      }
      <div class="model-auth-ceiling" data-testid="model-auth-summary">
        ${props.summary ? html`<div class="model-auth-kpi">${props.summary}</div>` : nothing}
        ${
          blockedSentence
            ? html`
                <div
                  class="callout danger model-auth-ceiling__blocked"
                  data-testid="model-auth-blocked"
                >
                  ${blockedSentence}
                </div>
              `
            : nothing
        }
        ${
          showCeilingModels || blockedSentence
            ? html`
                <details class="model-auth-advanced" data-testid="model-auth-ceiling-details">
                  <summary>上界明细</summary>
                  ${
                    showCeilingModels
                      ? html`
                          <div class="model-auth-ceiling__models">
                            企业可授权模型（${props.view.entitlementModelIds.length}）：${
                              props.view.entitlementModelIds.join(", ") || "（空）"
                            }
                          </div>
                        `
                      : nothing
                  }
                  ${
                    blockedSentence
                      ? html`<div class="model-auth-ceiling__blocked">${blockedSentence}</div>`
                      : nothing
                  }
                </details>
              `
            : nothing
        }
        ${showError ? html`<div class="callout danger">${errorText}</div>` : nothing}
      </div>
      <div class="model-auth-workbench">
        ${renderDirectory(props, directory, selectedKey)}
        ${renderPreview(props, directory, preview)}
      </div>
    </section>
  `;
}
