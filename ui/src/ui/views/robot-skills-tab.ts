import { html, nothing, type TemplateResult } from "lit";
import type { RobotSkillEntry } from "../controllers/robot-skills.ts";
import type { SkillMessageMap } from "../controllers/skills.ts";

export type RobotSkillsTabProps = {
  loading: boolean;
  skills: RobotSkillEntry[];
  error: string | null;
  busyKey: string | null;
  messages: SkillMessageMap;
  selectedSkillId?: string | null;
  onSelectSkill?: (skillId: string) => void;
  onToggleEnabled: (skillId: string, enabled: boolean) => void;
  onReplace?: (skillId: string) => void;
  onRemove: (skillId: string) => void;
  onRefresh: () => void;
};

function healthLabel(status: RobotSkillEntry["health"]["status"]) {
  switch (status) {
    case "warning":
      return "需关注";
    case "broken":
      return "失效";
    default:
      return "健康";
  }
}

function impactCopy(skill: RobotSkillEntry) {
  const source = skill.sourceRobot?.name ? `来自 ${skill.sourceRobot.name}` : "来自当前工作";
  return `${source} · 已使用 ${skill.usageCount} 次`;
}

function renderCapabilityItem(skill: RobotSkillEntry, props: RobotSkillsTabProps): TemplateResult {
  const busy = props.busyKey === skill.id;
  const message = props.messages[skill.id];
  return html`
    <article class="robot-capability-card ${skill.enabled ? "" : "is-disabled"}">
      <button
        type="button"
        class="robot-capability-card__main"
        @click=${() => props.onSelectSkill?.(skill.id)}
      >
        <span class="robot-capability-card__check" aria-hidden="true">✓</span>
        <span class="robot-capability-card__copy">
          <span class="robot-capability-card__title">${skill.profile.name || "未命名能力"}</span>
          <span class="robot-capability-card__summary">
            ${skill.profile.summary || "这个能力还在积累描述。"}
          </span>
          <span class="robot-capability-card__meta">${impactCopy(skill)}</span>
        </span>
      </button>
      <span class="robot-capability-card__health robot-capability-card__health--${skill.health.status}">
        ${healthLabel(skill.health.status)}
      </span>
      ${
        message
          ? html`
            <div class="robot-capability-card__message robot-capability-card__message--${message.kind}">
              ${message.message}
            </div>
          `
          : nothing
      }
      ${
        !skill.enabled
          ? html`
              <span class="robot-capability-card__disabled">已停用</span>
            `
          : nothing
      }
      <button
        type="button"
        class="btn btn--sm"
        ?disabled=${busy}
        @click=${() => props.onToggleEnabled(skill.id, !skill.enabled)}
      >
        ${busy ? "处理中…" : skill.enabled ? "停用" : "启用"}
      </button>
    </article>
  `;
}

function renderCapabilityDetail(
  skill: RobotSkillEntry | null,
  props: RobotSkillsTabProps,
): TemplateResult | typeof nothing {
  if (!skill) {
    return nothing;
  }
  return html`
    <aside class="robot-capability-detail">
      <div class="robot-capability-detail__head">
        <div>
          <div class="robot-capability-detail__eyebrow">能力详情</div>
          <h3>${skill.profile.name}</h3>
        </div>
        <span class="robot-capability-card__health robot-capability-card__health--${skill.health.status}">
          ${healthLabel(skill.health.status)}
        </span>
      </div>
      <p>${skill.profile.summary || "暂无描述"}</p>
      <div class="robot-capability-detail__section">
        <strong>适合处理</strong>
        <div>${skill.profile.inputDescription || "还没有补充输入说明"}</div>
      </div>
      <div class="robot-capability-detail__section">
        <strong>通常产出</strong>
        <div>${skill.profile.outputDescription || "还没有补充产出说明"}</div>
      </div>
      <div class="robot-capability-detail__tags">
        ${
          skill.profile.tags.length > 0
            ? skill.profile.tags.map((tag) => html`<span>${tag}</span>`)
            : html`
                <span>待补充标签</span>
              `
        }
      </div>
      <div class="robot-capability-detail__actions">
        <button
          type="button"
          class="btn"
          ?disabled=${props.busyKey === skill.id}
          @click=${() => props.onToggleEnabled(skill.id, !skill.enabled)}
        >
          ${skill.enabled ? "停用能力" : "启用能力"}
        </button>
        <button
          type="button"
          class="btn"
          ?disabled=${props.busyKey === skill.id || !props.onReplace}
          @click=${() => props.onReplace?.(skill.id)}
        >
          替换能力
        </button>
        <button
          type="button"
          class="btn btn--danger"
          ?disabled=${props.busyKey === skill.id}
          @click=${() => props.onRemove(skill.id)}
        >
          从机器人移除
        </button>
      </div>
    </aside>
  `;
}

export function renderRobotSkillsTab(props: RobotSkillsTabProps): TemplateResult {
  const selectedSkill =
    props.skills.find((skill) => skill.id === props.selectedSkillId) ?? props.skills[0] ?? null;
  return html`
    <section class="robot-capability-view">
      <header class="robot-capability-view__head">
        <div>
          <h2>机器人能力</h2>
          <p>这里展示这个机器人已经会做什么，能力会从日常工作中自然积累。</p>
        </div>
        <button type="button" class="btn btn--sm" @click=${props.onRefresh}>
          ${props.loading ? "刷新中…" : "刷新"}
        </button>
      </header>
      ${
        props.error
          ? html`
            <div class="callout callout--danger">${props.error}</div>
          `
          : nothing
      }
      <div class="robot-capability-view__layout">
        <div class="robot-capability-view__list">
          ${
            props.skills.length > 0
              ? props.skills.map((skill) => renderCapabilityItem(skill, props))
              : html`
                  <div class="robot-capability-view__empty">
                    这个机器人还没有沉淀出稳定能力。完成几次相似任务后，系统会提示你保存可复用能力。
                  </div>
                `
          }
        </div>
        ${renderCapabilityDetail(selectedSkill, props)}
      </div>
    </section>
  `;
}
