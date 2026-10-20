/**
 * 推送到岗位能力市场对话框（InstallToRobotDialog）
 *
 * 管理员将企业能力资产批量推送给指定岗位。岗位成员随后在员工端能力市场中，
 * 按旗下机器人的职责自行决定是否安装到具体机器人。
 *
 * 功能：
 * 1. 标题 "推送到岗位能力市场" + 能力名称
 * 2. 组织树选择：全员、组织层级整体推送、岗位定向推送
 * 3. 底部：已选N个 + 确认推送 + 取消
 * 4. 结果摘要（lastResult非空）："成功N个"绿 + "失败M个"红 + 失败列表
 * 5. 错误提示
 *
 * 样式：使用 enterprise-components.css 的 .install-to-robot-dialog 类体系。
 *
 * 验证需求：8.4, 8.5, 8.6, 8.7, 8.8
 */

import { html, nothing, type TemplateResult } from "lit";

// ─── Public Types ────────────────────────────────────────────────────────────

/** 岗位选项 */
export type PositionOption = {
  id: string;
  title: string;
  teamLabel: string | null;
  employeeLabel: string | null;
  roleCode: string | null;
  robotCount: number;
  alreadyPushed: boolean;
};

export type OrganizationPushTarget = {
  id: string;
  parentId: string | null;
  label: string;
  kind: "all" | "organization" | "position";
  level: number;
  positionIds: string[];
  meta: string;
  alreadyPushed: boolean;
};

/** 推送结果 */
export type InstallResult = {
  successCount: number;
  failureCount: number;
  failures: Array<{ positionId: string; positionTitle: string; reason: string }>;
  /** Set when the pushed asset is an MCP. Omitted for other assets. */
  mcpMountedCount?: number;
};

/** 对话框 Props */
export type InstallToRobotDialogProps = {
  visible: boolean;
  capabilityName: string;
  targets: OrganizationPushTarget[];
  selectedTargetIds: string[];
  expandedTargetIds: string[];
  installing: boolean;
  installError: string | null;
  lastResult: InstallResult | null;
  onToggleTarget: (targetId: string) => void;
  onToggleExpand: (targetId: string) => void;
  onConfirm: () => void;
  onClose: () => void;
};

function splitOrganizationPath(teamLabel: string | null): string[] {
  const normalized = teamLabel?.trim();
  if (!normalized) {
    return ["未分组"];
  }
  return normalized
    .split(/[/>＞｜|]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function compareTarget(left: OrganizationPushTarget, right: OrganizationPushTarget): number {
  if (left.kind !== right.kind) {
    if (left.kind === "organization") {
      return -1;
    }
    if (right.kind === "organization") {
      return 1;
    }
  }
  return left.label.localeCompare(right.label, "zh-CN");
}

function organizationPathKey(parts: string[]): string {
  return parts.join("/");
}

export function buildOrganizationPushTargets(
  positions: PositionOption[],
): OrganizationPushTarget[] {
  if (positions.length === 0) {
    return [];
  }
  const targets: OrganizationPushTarget[] = [
    {
      id: "all",
      parentId: null,
      label: "全员",
      kind: "all",
      level: 0,
      positionIds: positions.map((position) => position.id),
      meta: `${positions.length} 个岗位`,
      alreadyPushed: positions.every((position) => position.alreadyPushed),
    },
  ];
  const teamPathByPositionId = new Map<string, string>();
  const orgMap = new Map<string, { label: string; level: number; positionIds: Set<string> }>();
  for (const position of positions) {
    const parts = splitOrganizationPath(position.teamLabel);
    teamPathByPositionId.set(position.id, organizationPathKey(parts));
    for (let index = 0; index < parts.length; index += 1) {
      const path = parts.slice(0, index + 1);
      const key = organizationPathKey(path);
      const existing =
        orgMap.get(key) ??
        (() => {
          const next = {
            label: parts[index] ?? key,
            level: index + 1,
            positionIds: new Set<string>(),
          };
          orgMap.set(key, next);
          return next;
        })();
      existing.positionIds.add(position.id);
    }
  }
  const positionById = new Map(positions.map((position) => [position.id, position] as const));
  const orgTargets = Array.from(orgMap.entries())
    .toSorted((left, right) => left[0].localeCompare(right[0], "zh-CN"))
    .map(([key, node]) => {
      const positionIds = [...node.positionIds];
      const pushedCount = positionIds.filter((id) => positionById.get(id)?.alreadyPushed).length;
      const parentPath = key.includes("/") ? key.slice(0, key.lastIndexOf("/")) : "";
      return {
        id: `org:${key}`,
        parentId: parentPath ? `org:${parentPath}` : "all",
        label: node.label,
        kind: "organization" as const,
        level: node.level,
        positionIds,
        meta: `${positionIds.length} 个岗位${pushedCount > 0 ? ` · ${pushedCount} 个已推送` : ""}`,
        alreadyPushed: pushedCount === positionIds.length,
      };
    });
  const positionTargets = positions
    .toSorted((left, right) => left.title.localeCompare(right.title, "zh-CN"))
    .map((position) => ({
      id: `position:${position.id}`,
      parentId: `org:${teamPathByPositionId.get(position.id) ?? "未分组"}`,
      label: position.title,
      kind: "position" as const,
      level: splitOrganizationPath(position.teamLabel).length + 1,
      positionIds: [position.id],
      meta: [
        position.employeeLabel ? `员工：${position.employeeLabel}` : "待绑定员工",
        position.roleCode,
        `${position.robotCount} 个机器人`,
      ]
        .filter(Boolean)
        .join(" · "),
      alreadyPushed: position.alreadyPushed,
    }));
  const targetsByParent = new Map<string, OrganizationPushTarget[]>();
  for (const orgTarget of orgTargets) {
    const path = orgTarget.id.slice("org:".length);
    const parentPath = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    const key = parentPath ? `org:${parentPath}` : "all";
    targetsByParent.set(key, [...(targetsByParent.get(key) ?? []), orgTarget]);
  }
  for (const positionTarget of positionTargets) {
    const position = positionById.get(positionTarget.positionIds[0] ?? "");
    const key = position ? `org:${teamPathByPositionId.get(position.id) ?? "未分组"}` : "all";
    targetsByParent.set(key, [...(targetsByParent.get(key) ?? []), positionTarget]);
  }
  const ordered: OrganizationPushTarget[] = [];
  function visit(target: OrganizationPushTarget): void {
    ordered.push(target);
    for (const child of (targetsByParent.get(target.id) ?? []).toSorted(compareTarget)) {
      visit(child);
    }
  }
  visit(targets[0]);
  return ordered;
}

export function resolveSelectedPositionIds(
  targets: OrganizationPushTarget[],
  selectedTargetIds: string[],
): string[] {
  const selected = new Set(selectedTargetIds);
  const explicitPositionIds = new Set(
    targets
      .filter((target) => selected.has(target.id) && target.kind === "position")
      .flatMap((target) => target.positionIds),
  );
  const positionIds = new Set<string>();
  for (const target of targets) {
    if (!selected.has(target.id) || target.alreadyPushed) {
      continue;
    }
    for (const positionId of target.positionIds) {
      if (target.kind !== "position" && explicitPositionIds.has(positionId)) {
        continue;
      }
      positionIds.add(positionId);
    }
  }
  return [...positionIds];
}

// ─── Internal Helpers ────────────────────────────────────────────────────────

function visibleTargets(
  targets: OrganizationPushTarget[],
  expandedTargetIds: string[],
): OrganizationPushTarget[] {
  const byId = new Map(targets.map((target) => [target.id, target] as const));
  const expanded = new Set(expandedTargetIds);
  return targets.filter((target) => {
    if (target.parentId === null) {
      return true;
    }
    let parentId: string | null = target.parentId;
    while (parentId) {
      if (!expanded.has(parentId)) {
        return false;
      }
      parentId = byId.get(parentId)?.parentId ?? null;
    }
    return true;
  });
}

/** 渲染组织树选择列表 */
function renderTargetList(
  targets: OrganizationPushTarget[],
  selectedTargetIds: string[],
  expandedTargetIds: string[],
  onToggleTarget: (targetId: string) => void,
  onToggleExpand: (targetId: string) => void,
): TemplateResult {
  if (targets.length === 0) {
    return html`
      <div class="install-to-robot-dialog__empty">暂无可选岗位</div>
    `;
  }
  const childrenByParentId = new Map<string, number>();
  for (const target of targets) {
    if (target.parentId) {
      childrenByParentId.set(target.parentId, (childrenByParentId.get(target.parentId) ?? 0) + 1);
    }
  }
  const expanded = new Set(expandedTargetIds);
  const displayTargets = visibleTargets(targets, expandedTargetIds);

  return html`
    ${displayTargets.map((target, index) => {
      const isLast = index === displayTargets.length - 1;
      const isSelected = selectedTargetIds.includes(target.id);
      const isDisabled = target.alreadyPushed;
      const icon = target.kind === "all" ? "全" : target.kind === "organization" ? "组" : "岗";
      const hasChildren = (childrenByParentId.get(target.id) ?? 0) > 0;
      const isExpanded = expanded.has(target.id);

      return html`
        <div
          class="install-to-robot-dialog__item ${
            isLast ? "install-to-robot-dialog__item--last" : ""
          }"
          data-level=${String(target.level)}
        >
          <button
            type="button"
            class="install-to-robot-dialog__expand ${
              hasChildren ? "" : "install-to-robot-dialog__expand--empty"
            }"
            aria-label=${
              hasChildren
                ? `${isExpanded ? "收起" : "展开"} ${target.label}`
                : `${target.label} 无下级`
            }
            .disabled=${!hasChildren}
            @click=${() => {
              if (hasChildren) {
                onToggleExpand(target.id);
              }
            }}
          >
            ${hasChildren ? (isExpanded ? "⌄" : "›") : ""}
          </button>
          <input
            type="checkbox"
            class="install-to-robot-dialog__checkbox ${
              isDisabled ? "install-to-robot-dialog__checkbox--disabled" : ""
            }"
            .checked=${isSelected || target.alreadyPushed}
            .disabled=${isDisabled}
            @change=${() => {
              if (!isDisabled) {
                onToggleTarget(target.id);
              }
            }}
            aria-label=${`选择${target.kind === "position" ? "岗位" : "组织"} ${target.label}`}
          />
          <span class="install-to-robot-dialog__node-icon" aria-hidden="true">${icon}</span>
          <span class="install-to-robot-dialog__name" title=${target.label}>
            ${target.label}
            <small>${target.meta}</small>
          </span>
          ${
            target.alreadyPushed
              ? html`
                  <span class="install-to-robot-dialog__installed-badge">已推送</span>
                `
              : nothing
          }
        </div>
      `;
    })}
  `;
}

/** 渲染安装结果摘要 */
function renderInstallResult(result: InstallResult): TemplateResult {
  return html`
    <div class="install-to-robot-dialog__result">
      <div class="install-to-robot-dialog__result-header">
        ${
          result.successCount > 0
            ? html`<span class="install-to-robot-dialog__success-text"
              >成功 ${result.successCount} 个</span
            >`
            : nothing
        }
        ${
          typeof result.mcpMountedCount === "number"
            ? html`<span class="install-to-robot-dialog__success-text"
              >MCP 已挂到 ${result.mcpMountedCount} 个机器人</span
            >`
            : nothing
        }
        ${
          result.failureCount > 0
            ? html`<span class="install-to-robot-dialog__failure-text"
              >失败 ${result.failureCount} 个</span
            >`
            : nothing
        }
      </div>
      ${
        result.failures.length > 0
          ? html`
            <ul class="install-to-robot-dialog__failure-list">
              ${result.failures.map(
                (f) => html`
                  <li class="install-to-robot-dialog__failure-item">
                    <span class="install-to-robot-dialog__failure-name">${f.positionTitle}</span>
                    <span class="install-to-robot-dialog__failure-reason">${f.reason}</span>
                  </li>
                `,
              )}
            </ul>
          `
          : nothing
      }
    </div>
  `;
}

// ─── Main Render Function ────────────────────────────────────────────────────

/**
 * 渲染推送到岗位能力市场对话框。
 *
 * 验证需求：8.4, 8.5, 8.6, 8.7, 8.8
 */
export function renderInstallToRobotDialog(
  props: InstallToRobotDialogProps,
): TemplateResult | typeof nothing {
  const {
    visible,
    capabilityName,
    targets,
    selectedTargetIds,
    expandedTargetIds,
    installing,
    installError,
    lastResult,
    onToggleTarget,
    onToggleExpand,
    onConfirm,
    onClose,
  } = props;

  if (!visible) {
    return nothing;
  }

  const selectedPositionCount = resolveSelectedPositionIds(targets, selectedTargetIds).length;
  const canConfirm = selectedPositionCount > 0 && !installing;

  return html`
    <div
      class="install-to-robot-dialog__overlay"
      @click=${(e: Event) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        class="install-to-robot-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="install-dialog-title"
      >
        <!-- Header -->
        <div class="install-to-robot-dialog__header">
          <h2 id="install-dialog-title" class="install-to-robot-dialog__title">推送到岗位能力市场</h2>
          <div class="install-to-robot-dialog__subtitle">能力：${capabilityName}</div>
          <p class="install-to-robot-dialog__subtitle">
            选择全员时，MCP 会挂到本企业全部机器人，成员打开对应机器人即可调用。其他能力仍进入岗位能力市场，由成员自行安装。
          </p>
        </div>

        <!-- Error -->
        ${
          installError !== null
            ? html`<div class="install-to-robot-dialog__error">${installError}</div>`
            : nothing
        }

        <div class="install-to-robot-dialog__limit-warning">
          可选择全员、某个组织层级，或展开到具体岗位进行定向推送。
        </div>

        <!-- Content: Result or Position List -->
        ${
          lastResult !== null
            ? renderInstallResult(lastResult)
            : html`<div class="install-to-robot-dialog__list">
              ${renderTargetList(
                targets,
                selectedTargetIds,
                expandedTargetIds,
                onToggleTarget,
                onToggleExpand,
              )}
            </div>`
        }

        <!-- Footer -->
        <div class="install-to-robot-dialog__footer">
          <span class="install-to-robot-dialog__selected-count">
            ${lastResult !== null ? "" : `将推送 ${selectedPositionCount} 个岗位`}
          </span>
          <div class="install-to-robot-dialog__actions">
            ${
              lastResult !== null
                ? html`
                  <button
                    type="button"
                    class="enterprise-btn enterprise-btn--ghost"
                    @click=${onClose}
                  >
                    关闭
                  </button>
                `
                : html`
                  <button
                    type="button"
                    class="enterprise-btn enterprise-btn--ghost"
                    @click=${onClose}
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    class="enterprise-btn enterprise-btn--primary"
                    .disabled=${!canConfirm}
                    @click=${() => {
                      if (canConfirm) {
                        onConfirm();
                      }
                    }}
                  >
                    ${installing ? "推送中…" : "确认推送"}
                  </button>
                `
            }
          </div>
        </div>
      </div>
    </div>
  `;
}
