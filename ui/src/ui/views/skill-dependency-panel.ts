import { html, nothing, type TemplateResult } from "lit";
import type { SkillDependencyGraphSnapshot } from "../controllers/skill-dependency.ts";

export type SkillDependencyPanelProps = {
  target: "edit" | "delete";
  graph: SkillDependencyGraphSnapshot;
  onDrillDown: (kind: "robot" | "group" | "skill" | "enterprise", id: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
};

function renderSummaryHeader(props: SkillDependencyPanelProps): TemplateResult {
  const { graph } = props;
  const parts: string[] = [];
  if (graph.installedRobotCount > 0) {
    parts.push(`${graph.installedRobotCount} 个机器人使用`);
  }
  if (graph.sharedGroupCount > 0) {
    parts.push(`${graph.sharedGroupCount} 个协作小组共享`);
  }
  if (graph.dependentSkillCount > 0) {
    parts.push(`${graph.dependentSkillCount} 个能力依赖`);
  }
  if (graph.enterpriseConsumerCount > 0) {
    parts.push(`${graph.enterpriseConsumerCount} 个企业场景使用`);
  }

  const summaryText = parts.length > 0 ? `此能力被 ${parts.join("，")}` : "";

  return html`
    <p class="skill-dependency-panel__summary">${summaryText}</p>
  `;
}

function renderWarningOrInfo(target: "edit" | "delete"): TemplateResult {
  if (target === "delete") {
    return html`
      <p class="skill-dependency-panel__warning skill-dependency-panel__warning--danger">
        确认删除将影响以下使用方
      </p>
    `;
  }
  return html`
    <p class="skill-dependency-panel__warning skill-dependency-panel__warning--info">
      编辑将影响以下使用方
    </p>
  `;
}

function renderCategory(
  title: string,
  items: Array<{ id: string; name?: string; label?: string }>,
  kind: "robot" | "group" | "skill" | "enterprise",
  onDrillDown: SkillDependencyPanelProps["onDrillDown"],
): TemplateResult | typeof nothing {
  if (items.length === 0) {
    return nothing;
  }
  return html`
    <div class="skill-dependency-panel__category">
      <h4 class="skill-dependency-panel__category-title">${title}</h4>
      <ul class="skill-dependency-panel__list">
        ${items.map(
          (item) => html`
            <li class="skill-dependency-panel__list-item">
              <button
                type="button"
                class="skill-dependency-panel__drill-link"
                @click=${() => onDrillDown(kind, item.id)}
              >
                ${item.name ?? item.label ?? item.id}
              </button>
            </li>
          `,
        )}
      </ul>
    </div>
  `;
}

export function renderSkillDependencyPanel(props: SkillDependencyPanelProps): TemplateResult {
  const { target, graph, onDrillDown, onConfirm, onCancel } = props;
  const confirmLabel = target === "delete" ? "确认删除" : "确认编辑";

  return html`
    <section class="skill-dependency-panel" aria-label="能力影响范围">
      ${renderSummaryHeader(props)}
      ${renderWarningOrInfo(target)}

      <div class="skill-dependency-panel__categories">
        ${renderCategory("已安装机器人", graph.installedRobots, "robot", onDrillDown)}
        ${renderCategory("共享协作小组", graph.sharedGroups, "group", onDrillDown)}
        ${renderCategory("依赖此能力", graph.dependentSkills, "skill", onDrillDown)}
        ${renderCategory(
          "企业使用场景",
          graph.enterpriseConsumers.map((c) => ({
            id: c.id ?? "",
            label: c.label,
          })),
          "enterprise",
          onDrillDown,
        )}
      </div>

      <footer class="skill-dependency-panel__actions">
        <button
          type="button"
          class="skill-dependency-panel__btn skill-dependency-panel__btn--cancel"
          @click=${onCancel}
        >
          取消
        </button>
        <button
          type="button"
          class="skill-dependency-panel__btn skill-dependency-panel__btn--confirm"
          @click=${onConfirm}
        >
          ${confirmLabel}
        </button>
      </footer>
    </section>
  `;
}
