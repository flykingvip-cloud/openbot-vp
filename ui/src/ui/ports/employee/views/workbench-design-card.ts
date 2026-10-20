import { html, nothing } from "lit";
import {
  DESIGN_ROLE_FAMILIES,
  addDesignTag,
  beginAddingDesignTag,
  cancelAddingDesignTag,
  commitCustomDesignTag,
  findDesignFamily,
  findDesignRole,
  labelForDesignTag,
  removeDesignTag,
  resolveTagDraft,
  rolesInFamily,
  selectDesignFamily,
  selectDesignRole,
  suggestionsForCategory,
} from "./workbench-design-catalog.ts";
import {
  hasBlockingDesignGaps,
  labelForRole,
  summarizeDesignCapabilities,
} from "./workbench-design-labels.ts";
import type {
  WorkbenchAgentDesignState,
  WorkbenchDesignTagCategory,
  WorkbenchDesignTagDraft,
} from "./workbench-types.ts";

export function emptyWorkbenchAgentDesignState(): WorkbenchAgentDesignState {
  return {
    intentText: "",
    revisionText: "",
    busy: false,
    sessionId: null,
    sessionStatus: null,
    mapping: null,
    tagDraft: null,
    canConfirm: false,
    confirmed: false,
    validationStatus: null,
    createRequest: null,
    instantiateNote: null,
  };
}

export function renderWorkbenchDesignIntent(params: {
  design: WorkbenchAgentDesignState;
  onIntentChange: (value: string) => void;
}) {
  return html`
    <section class="employee-workbench__creator-form employee-workbench__creator-form--agent">
      <label class="employee-workbench__creator-field employee-workbench__creator-field--wide">
        <span class="employee-workbench__creator-label-row">
          <span class="employee-workbench__creator-label-title">你想要什么样的数字员工</span>
        </span>
        <textarea
          rows="4"
          .value=${params.design.intentText}
          placeholder="例如：创建销售助理，跟进 CRM，每周一给我销售周报"
          @input=${(event: Event) =>
            params.onIntentChange((event.currentTarget as HTMLTextAreaElement).value)}
        ></textarea>
      </label>
    </section>
  `;
}

const TAG_SECTIONS: Array<{
  category: WorkbenchDesignTagCategory;
  title: string;
  addLabel: string;
  placeholder: string;
}> = [
  { category: "capability", title: "能力", addLabel: "添加能力", placeholder: "例如：会议纪要" },
  {
    category: "workMode",
    title: "工作方式",
    addLabel: "添加工作方式",
    placeholder: "例如：每日巡检",
  },
  { category: "permission", title: "权限", addLabel: "添加权限", placeholder: "例如：只读日历" },
];

export function renderWorkbenchDesignReview(params: {
  design: WorkbenchAgentDesignState;
  onTagDraftChange?: (draft: WorkbenchDesignTagDraft) => void;
  onUseTemplatePath?: () => void;
}) {
  const mapping = params.design.mapping;
  if (!mapping) {
    return nothing;
  }
  const draft = resolveTagDraft(params.design);
  const readOnly = params.design.confirmed;
  const family = findDesignFamily(draft.familyId);
  const selectedRole = findDesignRole(draft.roleId);
  const familyRoles = rolesInFamily(draft.familyId);
  const missing = mapping.gaps.missing;
  const unresolved = mapping.gaps.unresolved;
  const intentPreview = params.design.intentText.trim();

  const emit = (next: WorkbenchDesignTagDraft) => {
    if (!readOnly) {
      params.onTagDraftChange?.(next);
    }
  };

  return html`
    <section class="employee-workbench__creator-form employee-workbench__creator-form--agent">
      <div class="employee-workbench__creator-field employee-workbench__creator-field--wide">
        <div class="employee-workbench__creator-panel-title">${mapping.headline}</div>
        ${
          intentPreview
            ? html`<p class="employee-workbench__creator-review-lead">根据「${intentPreview}」，建议这样配置：</p>`
            : nothing
        }
      </div>

      <div class="employee-workbench__creator-tag-section">
        <div class="employee-workbench__creator-tag-section-head">
          <div class="employee-workbench__creator-label-title">角色</div>
          ${
            readOnly || !params.onUseTemplatePath
              ? nothing
              : html`
                  <button
                    type="button"
                    class="employee-workbench__creator-text-link"
                    @click=${() => params.onUseTemplatePath?.()}
                  >
                    改用预设模板
                  </button>
                `
          }
        </div>
        <div class="employee-workbench__creator-tag-row" role="list" aria-label="角色领域">
          ${DESIGN_ROLE_FAMILIES.map((entry) => {
            const selected = entry.id === family?.id;
            return html`
              <button
                type="button"
                class="employee-workbench__tag-chip ${selected ? "is-selected" : ""}"
                role="listitem"
                ?disabled=${readOnly || params.design.busy}
                @click=${() => emit(selectDesignFamily(draft, entry.id))}
              >
                ${entry.label}
              </button>
            `;
          })}
        </div>
        <div class="employee-workbench__creator-tag-row" role="list" aria-label="具体角色">
          ${familyRoles.map((role) => {
            const selected = role.id === selectedRole?.id;
            return html`
              <button
                type="button"
                class="employee-workbench__tag-card employee-workbench__tag-card--choice ${selected ? "is-selected" : ""}"
                role="listitem"
                ?disabled=${readOnly || params.design.busy}
                @click=${() => emit(selectDesignRole(draft, role.id))}
              >
                <span class="employee-workbench__tag-card-emoji">${role.emoji}</span>
                <span class="employee-workbench__tag-card-label">${role.label}</span>
              </button>
            `;
          })}
        </div>
      </div>

      ${TAG_SECTIONS.map((section) =>
        renderTagCategory({
          draft,
          section,
          readOnly,
          busy: params.design.busy,
          onChange: emit,
        }),
      )}

      ${
        missing.length > 0
          ? html`
              <div class="employee-workbench__creator-notice" role="status">
                <div class="employee-workbench__creator-notice-title">需要补充后才能确认</div>
                ${missing.map((text) => html`<div>${text}</div>`)}
              </div>
            `
          : nothing
      }
      ${
        unresolved.length > 0
          ? html`
              <div class="employee-workbench__creator-notice employee-workbench__creator-notice--warn" role="status">
                <div class="employee-workbench__creator-notice-title">创建后还需配置</div>
                <div>${unresolved.map((key) => labelForDesignTag(key, "capability", draft)).join("、")}</div>
              </div>
            `
          : nothing
      }
    </section>
  `;
}

function renderTagCategory(params: {
  draft: WorkbenchDesignTagDraft;
  section: (typeof TAG_SECTIONS)[number];
  readOnly: boolean;
  busy: boolean;
  onChange: (draft: WorkbenchDesignTagDraft) => void;
}) {
  const ids =
    params.section.category === "capability"
      ? params.draft.capabilities
      : params.section.category === "workMode"
        ? params.draft.workModes
        : params.draft.permissions;
  const suggestions = params.readOnly
    ? []
    : suggestionsForCategory(params.draft, params.section.category);
  const adding = params.draft.addingCategory === params.section.category;
  return html`
    <div class="employee-workbench__creator-tag-section">
      <div class="employee-workbench__creator-label-title">${params.section.title}</div>
      <div class="employee-workbench__creator-tag-row" role="list" aria-label=${params.section.title}>
        ${ids.map((id) => {
          const label = labelForDesignTag(id, params.section.category, params.draft);
          return html`
            <div class="employee-workbench__tag-card is-selected" role="listitem">
              <span class="employee-workbench__tag-card-label">${label}</span>
              ${
                params.readOnly
                  ? nothing
                  : html`
                      <button
                        type="button"
                        class="employee-workbench__tag-card-remove"
                        aria-label=${`移除${label}`}
                        ?disabled=${params.busy}
                        @click=${() =>
                          params.onChange(
                            removeDesignTag(params.draft, params.section.category, id),
                          )}
                      >
                        ×
                      </button>
                    `
              }
            </div>
          `;
        })}
        ${suggestions.map(
          (tag) => html`
            <button
              type="button"
              class="employee-workbench__tag-card employee-workbench__tag-card--suggest"
              role="listitem"
              ?disabled=${params.busy}
              @click=${() => params.onChange(addDesignTag(params.draft, params.section.category, tag.id))}
            >
              <span class="employee-workbench__tag-card-label">+ ${tag.label}</span>
            </button>
          `,
        )}
        ${
          params.readOnly
            ? nothing
            : adding
              ? html`
                  <div class="employee-workbench__tag-add">
                    <input
                      type="text"
                      class="employee-workbench__tag-add-input"
                      maxlength="16"
                      placeholder=${params.section.placeholder}
                      .value=${params.draft.addingText}
                      @input=${(event: Event) =>
                        params.onChange({
                          ...params.draft,
                          addingText: (event.currentTarget as HTMLInputElement).value,
                        })}
                      @keydown=${(event: KeyboardEvent) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          params.onChange(commitCustomDesignTag(params.draft));
                        }
                        if (event.key === "Escape") {
                          event.preventDefault();
                          params.onChange(cancelAddingDesignTag(params.draft));
                        }
                      }}
                    />
                    <button
                      type="button"
                      class="employee-workbench__creator-text-link"
                      @click=${() => params.onChange(commitCustomDesignTag(params.draft))}
                    >
                      添加
                    </button>
                    <button
                      type="button"
                      class="employee-workbench__creator-text-link"
                      @click=${() => params.onChange(cancelAddingDesignTag(params.draft))}
                    >
                      取消
                    </button>
                  </div>
                `
              : html`
                  <button
                    type="button"
                    class="employee-workbench__tag-card employee-workbench__tag-card--add"
                    ?disabled=${params.busy}
                    @click=${() =>
                      params.onChange(beginAddingDesignTag(params.draft, params.section.category))}
                  >
                    + ${params.section.addLabel}
                  </button>
                `
        }
      </div>
    </div>
  `;
}

export function renderWorkbenchDesignSummary(params: {
  design: WorkbenchAgentDesignState;
  expanded: boolean;
  onToggle: () => void;
}) {
  const mapping = params.design.mapping;
  if (!mapping) {
    return nothing;
  }
  const draft = resolveTagDraft(params.design);
  const role = findDesignRole(draft.roleId);
  const roleLabel = role?.label ?? labelForRole(mapping.role.display || mapping.role.blueprintId);
  const capabilities = summarizeDesignCapabilities(mapping, params.design);
  return html`
    <div class="employee-workbench__creator-design-summary">
      <button
        type="button"
        class="employee-workbench__creator-design-summary-toggle"
        @click=${params.onToggle}
      >
        <span class="employee-workbench__creator-design-summary-copy">
          <span class="employee-workbench__creator-design-summary-title">${roleLabel}</span>
          <span class="employee-workbench__creator-design-summary-meta">${capabilities}</span>
        </span>
        <span class="employee-workbench__creator-design-summary-action">
          ${params.expanded ? "收起设计" : "查看设计"}
        </span>
      </button>
    </div>
  `;
}

export function designConfirmBlockedReason(design: WorkbenchAgentDesignState): string | null {
  if (!design.mapping) {
    return "请先生成设计";
  }
  if (design.busy) {
    return "正在理解需求…";
  }
  if (hasBlockingDesignGaps(design) || !design.canConfirm) {
    return "还有需要补充的事项，请先调整设计";
  }
  return null;
}
