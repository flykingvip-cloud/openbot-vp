import { html, nothing } from "lit";
import {
  ORG_WS_WORKSPACE_SUB,
  orgWsBody,
  orgWsField,
  orgWsFooter,
  orgWsHeader,
  orgWsNotice,
} from "./enterprise-org-workspace-template.ts";
import { wrapOrganizationEditorPresentation } from "./enterprise-org-workspace.ts";

export type OrganizationDepartmentEditorMode =
  | "create"
  | "rename"
  | "move"
  | "merge"
  | "delete"
  | null;

export type OrganizationDepartmentEditorState = {
  open: boolean;
  mode: OrganizationDepartmentEditorMode;
  path: string;
  parentPath: string;
  targetPath: string;
  label: string;
  busy: boolean;
  error: string | null;
};

export function createOrganizationDepartmentEditorState(): OrganizationDepartmentEditorState {
  return {
    open: false,
    mode: null,
    path: "",
    parentPath: "",
    targetPath: "",
    label: "",
    busy: false,
    error: null,
  };
}

export function organizationDepartmentEditorTitle(
  mode: OrganizationDepartmentEditorMode,
  parentPath = "",
): string {
  switch (mode) {
    case "create":
      return parentPath.trim() ? "新建子部门" : "新建部门";
    case "rename":
      return "重命名部门";
    case "move":
      return "移动部门";
    case "merge":
      return "合并部门";
    case "delete":
      return "删除部门";
    default:
      return "部门管理";
  }
}

/** 部门编辑器：仅工作区呈现（模态分支已随治理台收敛移除）。 */
export function renderOrganizationDepartmentEditor(params: {
  editor: OrganizationDepartmentEditorState;
  onClose: () => void;
  onLabelChange: (value: string) => void;
  onParentPathChange: (value: string) => void;
  onTargetPathChange: (value: string) => void;
  onSubmit: () => void;
  parentOptions: string[];
  targetOptions: string[];
}) {
  if (!params.editor.open || !params.editor.mode) {
    return nothing;
  }
  const { editor } = params;
  const isDelete = editor.mode === "delete";
  const isMove = editor.mode === "move";
  const isMerge = editor.mode === "merge";
  const isCreate = editor.mode === "create";
  const isRename = editor.mode === "rename";
  const title = organizationDepartmentEditorTitle(editor.mode, editor.parentPath);
  const submitLabel = isDelete ? "确认删除" : isMerge ? "确认合并" : "保存";

  return wrapOrganizationEditorPresentation({
    presentation: "workspace",
    ariaLabel: title,
    panelClass: "enterprise-org-workspace--panel enterprise-org-department-editor",
    onClose: params.onClose,
    content: html`
      ${orgWsHeader({
        title,
        subtitle: editor.path ? `当前：${editor.path}` : ORG_WS_WORKSPACE_SUB,
        onClose: params.onClose,
      })}
      ${orgWsBody(html`
        ${
          isDelete
            ? html`<p class="enterprise-org-ws__hint">
                将删除空部门
                <strong>${editor.path}</strong>。若部门下仍有岗位或子部门，操作会被拒绝。
              </p>`
            : nothing
        }
        ${
          isMerge
            ? html`
                <p class="enterprise-org-ws__hint">
                  将把 <strong>${editor.path}</strong> 及其下属岗位与子部门合并到目标部门。
                </p>
                ${orgWsField({
                  label: "合并到",
                  content: html`
                    <select
                      .value=${editor.targetPath}
                      ?disabled=${editor.busy}
                      @change=${(event: Event) =>
                        params.onTargetPathChange((event.target as HTMLSelectElement).value)}
                    >
                      <option value="">请选择目标部门</option>
                      ${params.targetOptions
                        .filter((path) => path !== editor.path)
                        .map((path) => html`<option value=${path}>${path}</option>`)}
                    </select>
                  `,
                })}
              `
            : nothing
        }
        ${
          isCreate || isRename
            ? orgWsField({
                label: "部门名称",
                content: html`
                  <input
                    type="text"
                    .value=${editor.label}
                    placeholder="例如：华东区"
                    ?disabled=${editor.busy}
                    @input=${(event: Event) =>
                      params.onLabelChange((event.target as HTMLInputElement).value)}
                  />
                `,
              })
            : nothing
        }
        ${
          isCreate || isMove
            ? orgWsField({
                label: "上级部门",
                content: html`
                  <select
                    .value=${editor.parentPath}
                    ?disabled=${editor.busy}
                    @change=${(event: Event) =>
                      params.onParentPathChange((event.target as HTMLSelectElement).value)}
                  >
                    <option value="">（根级部门）</option>
                    ${params.parentOptions.map(
                      (path) => html`<option value=${path}>${path}</option>`,
                    )}
                  </select>
                `,
              })
            : nothing
        }
        ${editor.error ? orgWsNotice({ kind: "danger", content: editor.error }) : nothing}
      `)}
      ${orgWsFooter({
        onCancel: params.onClose,
        primaryLabel: submitLabel,
        onPrimary: () => params.onSubmit(),
        busy: editor.busy,
      })}
    `,
  });
}
