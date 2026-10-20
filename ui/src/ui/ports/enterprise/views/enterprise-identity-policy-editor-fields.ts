import { html, nothing } from "lit";
import { renderOrgTargetPicker } from "../../../views/enterprise-data-capability/org-target-picker.ts";
import { resolveIdentityPolicyActionGroups } from "../semantic/enterprise-identity-policy-actions.ts";
import type { EnterprisePortReadModel } from "../semantic/enterprise-read-model.ts";
import type { EnterpriseSurfaceProps } from "./enterprise-surface-types.ts";

type IdentityPolicyEditor = EnterpriseSurfaceProps["identityManagementEditor"];

function parseCsv(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parsePipePaths(value: string): string[] {
  return value
    .split("|")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function joinCsv(values: string[]): string {
  return values.join(", ");
}

function joinPipePaths(values: string[]): string {
  return values.join("|");
}

function resolveIdentityProvider(
  editor: IdentityPolicyEditor,
  readModel: EnterprisePortReadModel,
): string {
  const identity = readModel.identitySummaries.find(
    (entry) => entry.identityId === editor.identityId,
  );
  return identity?.provider ?? "";
}

export function renderEnterpriseIdentityPolicyEditorFields(params: {
  editor: IdentityPolicyEditor;
  readModel: EnterprisePortReadModel;
}): ReturnType<typeof html> {
  const { editor, readModel } = params;
  const selectedSeatIds = new Set(parseCsv(editor.seatIds));
  const selectedDepartmentPaths = new Set(parsePipePaths(editor.policyDepartmentPaths));
  const selectedActions = new Set(parseCsv(editor.allowedActions));

  const provider = resolveIdentityProvider(editor, readModel);
  const { verifiedActions, unavailableActions } = resolveIdentityPolicyActionGroups({
    readModel,
    identityId: editor.identityId,
    provider,
  });
  const operationalActions = verifiedActions;

  const toggleSeat = (seatId: string) => {
    const next = new Set(selectedSeatIds);
    if (next.has(seatId)) {
      next.delete(seatId);
    } else {
      next.add(seatId);
    }
    editor.onSeatIdsChange(joinCsv([...next]));
  };

  const toggleDepartment = (departmentPath: string) => {
    const next = new Set(selectedDepartmentPaths);
    if (next.has(departmentPath)) {
      next.delete(departmentPath);
    } else {
      next.add(departmentPath);
    }
    editor.onPolicyDepartmentPathsChange(joinPipePaths([...next]));
  };

  const toggleAction = (action: string) => {
    const next = new Set(selectedActions);
    if (next.has(action)) {
      next.delete(action);
    } else {
      next.add(action);
    }
    editor.onAllowedActionsChange(joinCsv([...next]));
  };

  return html`
    <label class="enterprise-settings-field">
      <span>身份</span>
      <select
        .value=${editor.identityId}
        ?disabled=${editor.busy}
        @change=${(event: Event) =>
          editor.onIdentityIdChange((event.target as HTMLSelectElement).value)}
      >
        <option value="">选择身份</option>
        ${editor.identityOptions.map(
          (entry) => html`
            <option value=${entry.identityId}>
              ${entry.displayName} (${entry.providerLabel})
            </option>
          `,
        )}
      </select>
    </label>

    <div class="enterprise-settings-field enterprise-identity-policy-editor__field">
      <span>授权岗位</span>
      <p class="enterprise-identity-policy-editor__help">
        从组织目录勾选部门或岗位；勾选部门将覆盖该部门（含子部门）下全部岗位。
      </p>
      ${renderOrgTargetPicker({
        readModel,
        query: editor.policyPickerQuery,
        selectedSeatIds,
        selectedDepartmentPaths,
        disabled: editor.busy,
        hint: "可多选岗位；也可勾选整个部门批量授权。",
        onQueryChange: editor.onPolicyPickerQueryChange,
        onToggleSeat: toggleSeat,
        onToggleDepartment: toggleDepartment,
        onRemoveSeat: (seatId) => {
          const next = new Set(selectedSeatIds);
          next.delete(seatId);
          editor.onSeatIdsChange(joinCsv([...next]));
        },
        onRemoveDepartment: (departmentPath) => {
          const next = new Set(selectedDepartmentPaths);
          next.delete(departmentPath);
          editor.onPolicyDepartmentPathsChange(joinPipePaths([...next]));
        },
        onClearAll: () => {
          editor.onSeatIdsChange("");
          editor.onPolicyDepartmentPathsChange("");
        },
      })}
    </div>

    <div class="enterprise-settings-field enterprise-identity-policy-editor__field">
      <div class="enterprise-identity-policy-editor__field-head">
        <span>允许动作</span>
        ${
          operationalActions.length > 0
            ? html`
                <div class="enterprise-identity-policy-editor__field-actions">
                  <button
                    class="btn btn--sm btn--ghost"
                    type="button"
                    ?disabled=${editor.busy}
                    @click=${() =>
                      editor.onAllowedActionsChange(
                        joinCsv(operationalActions.map((entry) => entry.action)),
                      )}
                  >
                    全选
                  </button>
                  <button
                    class="btn btn--sm btn--ghost"
                    type="button"
                    ?disabled=${editor.busy}
                    @click=${() => editor.onAllowedActionsChange("")}
                  >
                    清空
                  </button>
                </div>
              `
            : nothing
        }
      </div>
      <p class="enterprise-identity-policy-editor__help">
        勾选岗位成员可执行的业务动作；员工在其端将身份绑定到自有机器人后生效。
      </p>
      ${
        operationalActions.length > 0
          ? html`
              <div class="enterprise-identity-policy-editor__choices">
                ${operationalActions.map(
                  (entry) => html`
                    <label class="enterprise-identity-policy-editor__choice">
                      <input
                        type="checkbox"
                        .checked=${selectedActions.has(entry.action)}
                        ?disabled=${editor.busy}
                        @change=${() => toggleAction(entry.action)}
                      />
                      <span>
                        <strong>${entry.label}</strong>
                        <span class="enterprise-identity-policy-editor__muted">${entry.action}</span>
                      </span>
                    </label>
                  `,
                )}
              </div>
            `
          : html`<div class="enterprise-settings-empty">
              ${
                editor.identityId
                  ? "该身份通道暂未配置可授权动作。"
                  : "请先选择身份，再配置允许动作。"
              }
            </div>`
      }
      ${
        unavailableActions.length > 0
          ? html`
              <div class="enterprise-identity-policy-editor__unavailable">
                <div class="enterprise-identity-policy-editor__group-label">
                  未验证能力（不可勾选）
                </div>
                <div class="enterprise-identity-policy-editor__choices">
                  ${unavailableActions.map(
                    (entry) => html`
                      <label
                        class="enterprise-identity-policy-editor__choice enterprise-identity-policy-editor__choice--disabled"
                      >
                        <input type="checkbox" disabled />
                        <span>
                          <strong>${entry.label}</strong>
                          <span class="enterprise-identity-policy-editor__muted">${entry.action}</span>
                          <span class="enterprise-identity-policy-editor__muted">${entry.reason}</span>
                        </span>
                      </label>
                    `,
                  )}
                </div>
              </div>
            `
          : nothing
      }
    </div>
  `;
}
