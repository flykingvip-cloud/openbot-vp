/**
 * Agent Growth OS — 创建向导模板选择器（spec: agent-growth-lifecycle, P1/P2 任务 15.2 / R15）。
 *
 * 纯渲染组件：渲染 `agents.list-templates` 返回的模板为可选列表，选中回调返回 templateId。
 * 默认 `generic_worker`。接线进创建向导抽屉 + 把 templateId 带入 `agents.create` 由 cursor 完成
 * （网关 schema 已支持 templateId，见 agents-models-skills.ts）。
 *
 * 自包含、无跨包导入。
 */

import { html, nothing, type TemplateResult } from "lit";

export type AgentTemplateOption = {
  templateId: string;
  displayName: string;
  /** required 能力条数（用于提示「需 N 项能力」）。 */
  requiredCount: number;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

/** 归一化 agents.list-templates 响应 → 选项列表（保证 generic_worker 在首位）。 */
export function normalizeTemplateOptions(value: unknown): AgentTemplateOption[] {
  const root = asRecord(value);
  const list =
    root && Array.isArray(root.templates) ? root.templates : Array.isArray(value) ? value : [];
  const options: AgentTemplateOption[] = [];
  for (const entry of list) {
    const e = asRecord(entry);
    if (!e || typeof e.templateId !== "string") {
      continue;
    }
    const required = Array.isArray(e.requiredCapabilities)
      ? e.requiredCapabilities.filter((c) => {
          const cr = asRecord(c);
          return cr ? cr.required === true : false;
        }).length
      : 0;
    options.push({
      templateId: e.templateId,
      displayName: typeof e.displayName === "string" ? e.displayName : e.templateId,
      requiredCount: required,
    });
  }
  // generic_worker 置顶（默认项）。
  options.sort((a, b) =>
    a.templateId === "generic_worker" ? -1 : b.templateId === "generic_worker" ? 1 : 0,
  );
  return options;
}

export type TemplatePickerProps = {
  options: AgentTemplateOption[];
  /** 当前选中 templateId；缺省视为 generic_worker。 */
  selectedTemplateId?: string | null;
  onSelect?: ((templateId: string) => void) | null;
};

/** 渲染模板选择器；无选项时渲染 nothing（向导可回退 generic_worker）。 */
export function renderTemplatePicker(props: TemplatePickerProps): TemplateResult | typeof nothing {
  if (props.options.length === 0) {
    return nothing;
  }
  const selected = props.selectedTemplateId ?? "generic_worker";
  return html`<div class="workbench-template-picker" data-template-picker>
    <p class="workbench-template-picker__title">选择角色模板</p>
    <div class="workbench-template-picker__options">
      ${props.options.map((opt) => {
        const isSelected = opt.templateId === selected;
        return html`<button
          type="button"
          class="workbench-template-picker__option ${
            isSelected ? "workbench-template-picker__option--selected" : ""
          }"
          data-template-id=${opt.templateId}
          aria-pressed=${isSelected ? "true" : "false"}
          @click=${() => props.onSelect?.(opt.templateId)}
        >
          <span class="workbench-template-picker__name">${opt.displayName}</span>
          ${
            opt.requiredCount > 0
              ? html`<span class="workbench-template-picker__req">需 ${opt.requiredCount} 项能力</span>`
              : nothing
          }
        </button>`;
      })}
    </div>
  </div>`;
}
