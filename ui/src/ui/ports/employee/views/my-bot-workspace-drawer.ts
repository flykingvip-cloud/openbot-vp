/**
 * My Bots Phase 2 — 640px right drawer with six-block accordion (flat polish).
 * Spec: docs/design/robot-workspace-and-mesh-boundary-plan-2026-08-02.md §3.2 / §3.4
 * Presentation: docs/design/robot-workspace-presentation-plan-2026-08-02.md §2.1
 * S0–S3+: 能力=使用证据+雷达；③职能倾向；成长=任务/协作/能力里程碑证据。
 */

import { html, nothing, type TemplateResult } from "lit";
import type {
  MyBotCapabilityProjection,
  MyBotDomainVector,
  MyBotGrowthSource,
  MyBotGrowthTaskRef,
  MyBotProjection,
} from "../semantic/my-bot-read-model.ts";
import {
  buildCapabilityDomainCallVector,
  buildInstalledDomainPreviewVector,
  computeMyBotIdentityAffinity,
  resolveMyBotCapabilityDomain,
  selectMasteredCapabilities,
  selectPendingCapabilities,
} from "../semantic/my-bot-read-model.ts";
import type { UserOperationalIdentitySnapshot } from "../semantic/view-controller-facade.ts";
import {
  renderRobotOperationalIdentityPanel,
  type RobotOperationalIdentityApplyInput,
} from "./workbench-robot-operational-identity-panel.ts";
import type {
  WorkbenchAuthorizationIdentityTab,
  WorkbenchSettingsRobotEntry,
} from "./workbench-types.ts";

export type MyBotWorkspaceDrawerProps = {
  open: boolean;
  loading: boolean;
  error: string | null;
  saving: boolean;
  canEditIdentity: boolean;
  bot: MyBotProjection | null;
  /** List-row robot entry for operational identity grants (when available). */
  robotEntry: WorkbenchSettingsRobotEntry | null;
  identityDraft: {
    name: string;
    positioning: string;
    role: string;
    personaTraits: string;
    model: string;
  } | null;
  operationalIdentitySnapshot?: UserOperationalIdentitySnapshot | null;
  operationalIdentityBusy?: boolean;
  /** Host re-render hook for drawer-local UI (capability L1 / growth filter). */
  onRequestUpdate?: () => void;
  /** Close drawer → open this bot chat with a draft prompt for the capability. */
  onTryCapability?: (input: {
    agentId: string;
    sessionKey: string;
    capabilityName: string;
    relationId: string;
  }) => void;
  /** @deprecated Install CTA removed from capability map; kept for host wiring compatibility. */
  onInstallCapability?: (robotId: string) => void;
  /** Open a growth task/session/group reference from the timeline. */
  onOpenGrowthTaskRef?: (ref: MyBotGrowthTaskRef) => void;
  onClose: () => void;
  onIdentityDraftChange: (
    patch: Partial<{
      name: string;
      positioning: string;
      role: string;
      personaTraits: string;
      model: string;
    }>,
  ) => void;
  onSaveIdentity: () => void;
  onOpenGroup: (groupId: string) => void;
  onApplyRobotIdentityGrants?: (input: RobotOperationalIdentityApplyInput) => void;
  onOpenPersonalOperationalIdentity?: (opts: {
    openEditor?: boolean;
    agentId?: string;
    authorizationIdentityTab?: WorkbenchAuthorizationIdentityTab;
  }) => void;
};

export type CapabilityDomainId = "research" | "content" | "data" | "collab" | "tools" | "general";

type GrowthFilter = "all" | MyBotGrowthSource;

type DrawerLocalUi = {
  agentId: string | null;
  selectedCapabilityId: string | null;
  growthSourceFilter: GrowthFilter;
  domainFilter: CapabilityDomainId | null;
};

const DOMAIN_DEFS: Array<{
  id: CapabilityDomainId;
  label: string;
  patterns: RegExp[];
}> = [
  {
    id: "research",
    label: "分析研究",
    patterns: [/市场|竞品|行业|研究|分析|调研|情报|战略/],
  },
  {
    id: "content",
    label: "内容产出",
    patterns: [/ppt|pptx|写作|报告|文案|文档|生成|摘要|润色/i],
  },
  {
    id: "data",
    label: "数据统计",
    patterns: [/数据|统计|指标|表格|报表|量化|excel|csv/i],
  },
  {
    id: "collab",
    label: "协作沟通",
    patterns: [/协作|会议|纪要|沟通|群组|团队|排期/],
  },
  {
    id: "tools",
    label: "工具执行",
    patterns: [/工具|自动化|api|脚本|安装|执行|工作流|workflow/i],
  },
];

let localUi: DrawerLocalUi = {
  agentId: null,
  selectedCapabilityId: null,
  growthSourceFilter: "all",
  domainFilter: null,
};

/** @internal test helper */
export function resetMyBotDrawerLocalUiForTests() {
  localUi = {
    agentId: null,
    selectedCapabilityId: null,
    growthSourceFilter: "all",
    domainFilter: null,
  };
}

function syncLocalUi(agentId: string | null) {
  if (localUi.agentId === agentId) {
    return;
  }
  localUi = {
    agentId,
    selectedCapabilityId: null,
    growthSourceFilter: "all",
    domainFilter: null,
  };
}

function bump(props: MyBotWorkspaceDrawerProps) {
  props.onRequestUpdate?.();
}

export function inferCapabilityDomain(name: string): CapabilityDomainId {
  const text = name.trim();
  for (const domain of DOMAIN_DEFS) {
    if (domain.patterns.some((pattern) => pattern.test(text))) {
      return domain.id;
    }
  }
  return "general";
}

function resolveCapabilityDomain(cap: MyBotCapabilityProjection): CapabilityDomainId {
  return resolveMyBotCapabilityDomain(cap) as CapabilityDomainId;
}

export function growthSourceLabel(source: MyBotGrowthSource): string {
  switch (source) {
    case "group":
      return "协作履约";
    case "skill_upgrade":
      return "能力里程碑";
    default:
      return "任务完成";
  }
}

function inferGrowthEventSource(
  event: { text: string; source?: MyBotGrowthSource },
  botSources: MyBotGrowthSource[],
): MyBotGrowthSource {
  if (event.source) {
    return event.source;
  }
  const text = event.text;
  if (/技能|安装|能力升级|掌握|skill/i.test(text)) {
    return "skill_upgrade";
  }
  if (/群组|协作|小组|对齐|角色分配/.test(text)) {
    return "group";
  }
  if (botSources.includes("skill_upgrade") && /升级|安装|掌握/.test(text)) {
    return "skill_upgrade";
  }
  return "personal";
}

function buildCapabilityInsight(caps: MyBotCapabilityProjection[]) {
  const total = caps.length;
  const callTotal = caps.reduce((sum, cap) => sum + Math.max(0, cap.callCount ?? 0), 0);
  const strong = caps.filter((cap) => (cap.callCount ?? 0) >= 5 || cap.stars >= 4).length;
  return { total, callTotal, strong };
}

function buildCapabilityDomains(caps: MyBotCapabilityProjection[]) {
  const buckets = new Map<
    CapabilityDomainId,
    { id: CapabilityDomainId; label: string; calls: number; count: number }
  >();
  for (const def of DOMAIN_DEFS) {
    buckets.set(def.id, { id: def.id, label: def.label, calls: 0, count: 0 });
  }
  buckets.set("general", { id: "general", label: "综合", calls: 0, count: 0 });

  for (const cap of caps) {
    const domainId = resolveCapabilityDomain(cap);
    const bucket = buckets.get(domainId)!;
    bucket.calls += Math.max(0, cap.callCount ?? Math.max(1, cap.stars));
    bucket.count += 1;
  }

  return [...buckets.values()]
    .filter((bucket) => bucket.id !== "general" || bucket.count > 0)
    .map((bucket) => ({
      id: bucket.id,
      label: bucket.label,
      count: bucket.count,
      calls: bucket.calls,
    }));
}

function relativeDayLabel(iso: string | undefined, nowMs = Date.now()): string {
  if (!iso) {
    return "时间未知";
  }
  const atMs = Date.parse(iso);
  if (!Number.isFinite(atMs)) {
    return iso.slice(0, 10);
  }
  const startOfToday = new Date(nowMs);
  startOfToday.setHours(0, 0, 0, 0);
  const startOfThat = new Date(atMs);
  startOfThat.setHours(0, 0, 0, 0);
  const dayDiff = Math.round((startOfToday.getTime() - startOfThat.getTime()) / 86_400_000);
  const time = new Date(atMs).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  if (dayDiff === 0) {
    return `今天 ${time}`;
  }
  if (dayDiff === 1) {
    return `昨天 ${time}`;
  }
  if (dayDiff > 1 && dayDiff < 7) {
    return `${dayDiff} 天前`;
  }
  return iso.slice(0, 10);
}

function groupEventsByDay<T extends { text: string; at?: string; source: MyBotGrowthSource }>(
  events: T[],
) {
  const groups: Array<{ key: string; label: string; items: T[] }> = [];
  const index = new Map<string, number>();
  for (const event of events) {
    const key = event.at?.slice(0, 10) || "unknown";
    const existing = index.get(key);
    if (existing === undefined) {
      index.set(key, groups.length);
      groups.push({
        key,
        label: relativeDayLabel(event.at),
        items: [event],
      });
    } else {
      groups[existing].items.push(event);
    }
  }
  return groups;
}

function statusLabel(status: MyBotProjection["identity"]["status"]): string {
  switch (status) {
    case "online":
      return "可用";
    case "degraded":
      return "异常";
    case "offline":
      return "离线";
    default:
      return "未知";
  }
}

function formatBytes(bytes: number | undefined): string {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes <= 0) {
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

function sourceLabel(source: MyBotCapabilityProjection["source"]): string {
  switch (source) {
    case "personal":
      return "个人";
    case "group":
      return "小组";
    case "enterprise":
      return "企业";
    default:
      return "市场";
  }
}

function renderKvRows(rows: Array<{ label: string; value: string }>) {
  return html`
    <div class="employee-workbench__mybot-drawer-kv" role="list">
      ${rows.map(
        (row) => html`
          <div class="employee-workbench__mybot-drawer-kv-row" role="listitem">
            <span class="employee-workbench__mybot-drawer-kv-label">${row.label}</span>
            <span class="employee-workbench__mybot-drawer-kv-value">${row.value}</span>
          </div>
        `,
      )}
    </div>
  `;
}

function renderSectionLead(text: string) {
  return html`<p class="employee-workbench__mybot-drawer-lead">${text}</p>`;
}

function renderIdentityAvatar(bot: MyBotProjection) {
  const avatar = bot.identity.avatar?.trim();
  const initial = (bot.identity.name?.trim() || bot.agentId).slice(0, 1).toUpperCase();
  if (avatar && /^https?:\/\//i.test(avatar)) {
    return html`<img
      class="employee-workbench__mybot-identity-avatar"
      src=${avatar}
      alt=""
      width="48"
      height="48"
    />`;
  }
  if (avatar && avatar.length <= 3) {
    return html`<div class="employee-workbench__mybot-identity-avatar employee-workbench__mybot-identity-avatar--emoji" aria-hidden="true">
      ${avatar}
    </div>`;
  }
  return html`<div class="employee-workbench__mybot-identity-avatar employee-workbench__mybot-identity-avatar--initial" aria-hidden="true">
    ${initial}
  </div>`;
}

function renderIdentityChips(bot: MyBotProjection) {
  const chips = [
    bot.identity.positioning ? { label: "定位", value: bot.identity.positioning } : null,
    bot.identity.role ? { label: "角色", value: bot.identity.role } : null,
    bot.identity.personaTraits ? { label: "人格", value: bot.identity.personaTraits } : null,
  ].filter((chip): chip is { label: string; value: string } => Boolean(chip));
  if (chips.length === 0) {
    return nothing;
  }
  return html`
    <div class="employee-workbench__mybot-identity-chips">
      ${chips.map(
        (chip) => html`
          <span class="employee-workbench__mybot-identity-chip">
            <em>${chip.label}</em>${chip.value}
          </span>
        `,
      )}
    </div>
  `;
}

function renderIdentityBlock(props: MyBotWorkspaceDrawerProps, bot: MyBotProjection) {
  const draft = props.identityDraft;
  if (props.canEditIdentity && draft) {
    return html`
      <div class="employee-workbench__mybot-identity">
        ${renderSectionLead("编辑名称、定位与人格，让助手更容易被识别。")}
        <div class="employee-workbench__mybot-drawer-form employee-workbench__mybot-drawer-form--stack">
          <label>
            <span>名称</span>
            <input
              type="text"
              .value=${draft.name}
              @input=${(event: Event) =>
                props.onIdentityDraftChange({
                  name: (event.target as HTMLInputElement).value,
                })}
            />
          </label>
          <label>
            <span>定位</span>
            <input
              type="text"
              .value=${draft.positioning}
              placeholder="例如：行业研究专家"
              @input=${(event: Event) =>
                props.onIdentityDraftChange({
                  positioning: (event.target as HTMLInputElement).value,
                })}
            />
          </label>
          <label>
            <span>角色</span>
            <input
              type="text"
              .value=${draft.role}
              placeholder="例如：市场助手"
              @input=${(event: Event) =>
                props.onIdentityDraftChange({
                  role: (event.target as HTMLInputElement).value,
                })}
            />
          </label>
          <label>
            <span>人格</span>
            <input
              type="text"
              .value=${draft.personaTraits}
              placeholder="例如：专业、谨慎"
              @input=${(event: Event) =>
                props.onIdentityDraftChange({
                  personaTraits: (event.target as HTMLInputElement).value,
                })}
            />
          </label>
          <label>
            <span>模型</span>
            <input
              type="text"
              .value=${draft.model}
              @input=${(event: Event) =>
                props.onIdentityDraftChange({
                  model: (event.target as HTMLInputElement).value,
                })}
            />
          </label>
        </div>
      </div>
    `;
  }

  return html`
    <div class="employee-workbench__mybot-identity">
      <div class="employee-workbench__mybot-identity-profile">
        ${renderIdentityAvatar(bot)}
        <div class="employee-workbench__mybot-identity-profile-copy">
          <div class="employee-workbench__mybot-identity-name">${bot.identity.name}</div>
          ${
            bot.identity.intro?.trim()
              ? html`<p class="employee-workbench__mybot-identity-intro">${bot.identity.intro}</p>`
              : html`
                  <p class="employee-workbench__mybot-drawer-hint">尚未填写一句介绍。</p>
                `
          }
        </div>
      </div>
      ${renderIdentityChips(bot)}
      ${renderKvRows([
        { label: "模型", value: bot.identity.model || "—" },
        { label: "状态", value: statusLabel(bot.identity.status) },
        {
          label: "创建",
          value: bot.identity.createdAt ? bot.identity.createdAt.slice(0, 10) : "—",
        },
      ])}
      ${
        props.canEditIdentity
          ? nothing
          : html`
              <p class="employee-workbench__mybot-drawer-hint">参与中的机器人身份为只读。</p>
            `
      }
    </div>
  `;
}

function renderRadarChart(vector: MyBotDomainVector, opts?: { preview?: boolean }) {
  const preview = opts?.preview === true;
  const axes = DOMAIN_DEFS.filter((d) => d.id !== "general");
  const cx = 80;
  const cy = 80;
  const radius = 58;
  const levels = [0.25, 0.5, 0.75, 1];
  const pointAt = (index: number, value: number) => {
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / axes.length;
    const r = radius * Math.max(0, Math.min(1, value));
    return {
      x: cx + Math.cos(angle) * r,
      y: cy + Math.sin(angle) * r,
    };
  };
  const polygon = axes
    .map((axis, index) => {
      const p = pointAt(index, vector[axis.id as keyof MyBotDomainVector] ?? 0);
      return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
    })
    .join(" ");

  return html`
    <div
      class="employee-workbench__mybot-radar ${
        preview ? "employee-workbench__mybot-radar--preview" : ""
      }"
      data-cap-radar
    >
      <svg viewBox="0 0 160 160" role="img" aria-label="能力雷达图">
        ${levels.map((level) => {
          const ring = axes
            .map((_, index) => {
              const p = pointAt(index, level);
              return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
            })
            .join(" ");
          return html`<polygon class="employee-workbench__mybot-radar-grid" points=${ring}></polygon>`;
        })}
        ${axes.map((_, index) => {
          const tip = pointAt(index, 1);
          return html`<line
            class="employee-workbench__mybot-radar-axis"
            x1=${cx}
            y1=${cy}
            x2=${tip.x.toFixed(1)}
            y2=${tip.y.toFixed(1)}
          ></line>`;
        })}
        <polygon class="employee-workbench__mybot-radar-area" points=${polygon}></polygon>
        ${axes.map((axis, index) => {
          const tip = pointAt(index, 1.18);
          return html`<text
            class="employee-workbench__mybot-radar-label"
            x=${tip.x.toFixed(1)}
            y=${tip.y.toFixed(1)}
            text-anchor="middle"
            dominant-baseline="middle"
          >
            ${axis.label.slice(0, 2)}
          </text>`;
        })}
      </svg>
    </div>
  `;
}

function renderPersonaBlock(bot: MyBotProjection) {
  const affinity = computeMyBotIdentityAffinity({
    identity: bot.identity,
    capabilities: bot.capabilities,
  });
  return html`
    <div class="employee-workbench__mybot-persona">
      ${renderSectionLead("根据职责设定与能力调用证据，识别更贴近的职能倾向。")}
      <div class="employee-workbench__mybot-affinity" data-identity-affinity>
        ${
          affinity.primary
            ? html`
                <div class="employee-workbench__mybot-affinity-primary">
                  <strong>${affinity.primary.label}</strong>
                  <span>匹配 ${affinity.primary.score}%</span>
                </div>
                ${
                  affinity.secondary
                    ? html`
                        <div class="employee-workbench__mybot-affinity-secondary">
                          辅倾向：${affinity.secondary.label} · ${affinity.secondary.score}%
                        </div>
                      `
                    : nothing
                }
                <ul class="employee-workbench__mybot-affinity-scores">
                  ${affinity.scores.slice(0, 3).map(
                    (score) => html`
                      <li>
                        <span>${score.label}</span>
                        <div class="employee-workbench__mybot-cap-meter-track">
                          <div
                            class="employee-workbench__mybot-cap-meter-fill"
                            style=${`width:${Math.max(0, Math.min(100, score.score))}%`}
                          ></div>
                        </div>
                        <span>${score.score}%</span>
                      </li>
                    `,
                  )}
                </ul>
                <p class="employee-workbench__mybot-drawer-hint">
                  ${
                    affinity.lowConfidence
                      ? affinity.evidenceCallTotal === 0 && bot.capabilities.length > 0
                        ? "基于已安装能力与职责描述推断，完成首次调用后会自动校准。"
                        : "证据较少，倾向仅供参考。完善定位或完成更多任务后会更准确。"
                      : `基于 ${affinity.evidenceCallTotal} 次能力调用与职责描述推断。`
                  }
                </p>
              `
            : html`
                <p class="employee-workbench__mybot-drawer-hint">
                  暂无法识别职能倾向。请完善「定位 / 角色」，或通过对话产生能力调用证据。
                </p>
              `
        }
      </div>
      ${
        bot.personas.length === 0
          ? nothing
          : html`
              <div class="employee-workbench__settings-field-label">对话面具（可选）</div>
              <ul class="employee-workbench__mybot-persona-grid">
                ${bot.personas.map(
                  (persona) => html`
                    <li class="employee-workbench__mybot-persona-card">
                      <strong>${persona.label}</strong>
                      ${
                        persona.description
                          ? html`<span>${persona.description}</span>`
                          : html`
                              <span class="employee-workbench__mybot-drawer-hint">可切换角色</span>
                            `
                      }
                    </li>
                  `,
                )}
              </ul>
            `
      }
    </div>
  `;
}

function renderCollaborationBlock(props: MyBotWorkspaceDrawerProps, bot: MyBotProjection) {
  return html`
    <div class="employee-workbench__mybot-collab">
      ${renderSectionLead("只读参与关系；编辑请前往「我的协作小组」。")}
      ${
        bot.collaborations.length === 0
          ? html`
              <p class="employee-workbench__mybot-drawer-hint">尚未参与协作小组。</p>
            `
          : html`
              <ul class="employee-workbench__mybot-collab-list">
                ${bot.collaborations.map(
                  (group) => html`
                    <li>
                      <button
                        type="button"
                        class="employee-workbench__mybot-collab-link"
                        @click=${() => props.onOpenGroup(group.groupId)}
                      >
                        <span class="employee-workbench__mybot-collab-title">${group.title}</span>
                        <span class="employee-workbench__mybot-collab-action">打开</span>
                      </button>
                    </li>
                  `,
                )}
              </ul>
            `
      }
    </div>
  `;
}

function renderDataBlock(bot: MyBotProjection) {
  const metrics = [
    { label: "记忆容量", value: formatBytes(bot.data.memorySize) },
    { label: "长期记忆", value: String(bot.data.longTermCount ?? 0) },
    { label: "知识库", value: String(bot.data.kbCount ?? 0) },
  ];
  return html`
    <div class="employee-workbench__mybot-data">
      <div class="employee-workbench__mybot-data-metrics" role="list">
        ${metrics.map(
          (metric) => html`
            <div class="employee-workbench__mybot-data-metric" role="listitem">
              <span class="employee-workbench__mybot-data-metric-label">${metric.label}</span>
              <strong class="employee-workbench__mybot-data-metric-value">${metric.value}</strong>
            </div>
          `,
        )}
      </div>
      <p class="employee-workbench__mybot-drawer-hint">不含 Token / GPU / Runtime 主机信息。</p>
      ${
        bot.data.recentLearning.length === 0
          ? nothing
          : html`
              <div class="employee-workbench__settings-field-label">最近学习</div>
              <ul class="employee-workbench__mybot-data-learning">
                ${bot.data.recentLearning.map(
                  (item) => html`
                    <li>
                      <span class="employee-workbench__mybot-growth-dot" aria-hidden="true"></span>
                      <div>
                        <strong>${item.text}</strong>
                        ${item.at ? html`<small>${relativeDayLabel(item.at)}</small>` : nothing}
                      </div>
                    </li>
                  `,
                )}
              </ul>
            `
      }
    </div>
  `;
}

function renderAccordion(
  id: string,
  title: string,
  open: boolean,
  body: TemplateResult | typeof nothing,
  footer?: TemplateResult | typeof nothing,
) {
  return html`
    <details class="employee-workbench__mybot-drawer-block" data-block=${id} ?open=${open}>
      <summary class="employee-workbench__mybot-drawer-block-summary">${title}</summary>
      <div class="employee-workbench__mybot-drawer-block-body">${body}</div>
      ${
        footer
          ? html`<div class="employee-workbench__mybot-drawer-block-footer">${footer}</div>`
          : nothing
      }
    </details>
  `;
}

function renderCapabilityL1(
  props: MyBotWorkspaceDrawerProps,
  cap: MyBotCapabilityProjection,
  bot: MyBotProjection,
) {
  const domainId = resolveCapabilityDomain(cap);
  const domainLabel =
    DOMAIN_DEFS.find((item) => item.id === domainId)?.label ??
    (domainId === "general" ? "综合" : domainId);
  const relatedGrowth = bot.growth.recentEvents
    .filter(
      (event) =>
        event.capabilityRef === cap.relationId ||
        event.text.includes(cap.name) ||
        /能力|技能|掌握/.test(event.text),
    )
    .slice(0, 3);
  const sessionKey = props.robotEntry?.sessionKey?.trim() || `agent:${bot.agentId}:main`;
  const callCount = Math.max(0, cap.callCount ?? 0);
  const description =
    (typeof cap.description === "string" && cap.description.trim()) ||
    "该能力已有使用证据。可在对话中继续调用以加深掌握。";

  return html`
    <div class="employee-workbench__mybot-cap-l1" data-capability-l1=${cap.relationId}>
      <button
        type="button"
        class="employee-workbench__mybot-cap-l1-back"
        @click=${() => {
          localUi.selectedCapabilityId = null;
          bump(props);
        }}
      >
        ← 返回能力地图
      </button>
      <div class="employee-workbench__mybot-cap-l1-head">
        <h3 class="employee-workbench__mybot-cap-l1-title">${cap.name}</h3>
        <div class="employee-workbench__mybot-cap-l1-meta">
          <span class="employee-workbench__settings-pill" data-cap-calls>调用 ${callCount} 次</span>
          <span class="employee-workbench__settings-pill">${sourceLabel(cap.source)}</span>
          <span class="employee-workbench__settings-pill">${domainLabel}</span>
        </div>
      </div>
      <p class="employee-workbench__mybot-drawer-hint" data-cap-description>${description}</p>
      ${
        cap.lastImprovedAt
          ? html`<p class="employee-workbench__mybot-drawer-hint">
              最近使用：${relativeDayLabel(cap.lastImprovedAt)}
            </p>`
          : nothing
      }
      ${
        relatedGrowth.length === 0
          ? nothing
          : html`
              <div class="employee-workbench__settings-field-label">最近相关成长</div>
              <ul class="employee-workbench__mybot-event-list">
                ${relatedGrowth.map(
                  (event) => html`
                    <li>
                      <span>${event.text}</span>
                      ${event.at ? html`<small>${relativeDayLabel(event.at)}</small>` : nothing}
                    </li>
                  `,
                )}
              </ul>
            `
      }
      <div class="employee-workbench__mybot-cap-l1-actions">
        <button
          type="button"
          class="btn btn--primary"
          data-cap-action="try"
          @click=${() =>
            props.onTryCapability?.({
              agentId: bot.agentId,
              sessionKey,
              capabilityName: cap.name,
              relationId: cap.relationId,
            })}
        >
          在对话中试用
        </button>
      </div>
    </div>
  `;
}

function renderCapabilitiesBlock(props: MyBotWorkspaceDrawerProps, bot: MyBotProjection) {
  const mastered = selectMasteredCapabilities(bot.capabilities);
  const pending = selectPendingCapabilities(bot.capabilities);
  const caps = mastered;
  const selectedId = localUi.selectedCapabilityId;
  const selected =
    selectedId != null
      ? (mastered.find((cap) => cap.relationId === selectedId) ??
        pending.find((cap) => cap.relationId === selectedId) ??
        null)
      : null;

  if (selected) {
    return renderCapabilityL1(props, selected, bot);
  }

  if (mastered.length === 0 && pending.length === 0) {
    return html`
      <div class="employee-workbench__mybot-cap-map employee-workbench__mybot-cap-map--empty">
        <p class="employee-workbench__mybot-drawer-hint">
          尚无能力安装记录。为机器人安装技能后，这里会按分析 / 内容 / 数据等维度形成能力地图。
        </p>
        ${renderRadarChart({ research: 0, content: 0, data: 0, collab: 0, tools: 0 })}
      </div>
    `;
  }

  if (mastered.length === 0 && pending.length > 0) {
    const preview = buildInstalledDomainPreviewVector(pending);
    const sortedPending = [...pending].toSorted((a, b) => a.name.localeCompare(b.name, "zh"));
    return html`
      <div class="employee-workbench__mybot-cap-map employee-workbench__mybot-cap-map--preview">
        <p class="employee-workbench__mybot-cap-insight" data-cap-insight>
          已安装 ${pending.length} 项能力 · 待首次调用形成使用证据
        </p>
        ${renderRadarChart(preview, { preview: true })}
        <div class="employee-workbench__settings-field-label">待激活能力</div>
        <ul class="employee-workbench__mybot-cap-list">
          ${sortedPending.map(
            (cap) => html`
              <li>
                <button
                  type="button"
                  class="employee-workbench__mybot-cap-row employee-workbench__mybot-cap-row--pending"
                  data-capability-id=${cap.relationId}
                  @click=${() => {
                    localUi.selectedCapabilityId = cap.relationId;
                    bump(props);
                  }}
                >
                  <div class="employee-workbench__mybot-cap-main">
                    <strong>${cap.name}</strong>
                    <small class="employee-workbench__mybot-cap-calls">待首次调用</small>
                  </div>
                  <span class="employee-workbench__settings-pill employee-workbench__settings-pill--muted"
                    >${sourceLabel(cap.source)}</span
                  >
                </button>
              </li>
            `,
          )}
        </ul>
        <p class="employee-workbench__mybot-drawer-hint">
          与机器人对话并触发上述能力后，雷达图与调用次数会在此更新。
        </p>
      </div>
    `;
  }

  const insight = buildCapabilityInsight(caps);
  const domains = buildCapabilityDomains(caps);
  const radar = buildCapabilityDomainCallVector(caps);
  const domainFilter = localUi.domainFilter;
  const visibleCaps = domainFilter
    ? caps.filter((cap) => resolveCapabilityDomain(cap) === domainFilter)
    : caps;
  const sortedCaps = [...visibleCaps].toSorted((a, b) => {
    const callDiff = (b.callCount ?? 0) - (a.callCount ?? 0);
    if (callDiff !== 0) {
      return callDiff;
    }
    return a.name.localeCompare(b.name, "zh");
  });
  const maxDomainCalls = Math.max(...domains.map((d) => d.calls), 1);

  return html`
    <div class="employee-workbench__mybot-cap-map">
      <p class="employee-workbench__mybot-cap-insight" data-cap-insight>
        已掌握 ${insight.total} 项 · 累计调用 ${insight.callTotal} 次 · 高频 ${insight.strong} 项
      </p>
      ${renderRadarChart(radar)}
      <div class="employee-workbench__mybot-cap-domain-list" role="list">
        ${domains.map((domain) => {
          const active = domainFilter === domain.id;
          const pct = (domain.calls / maxDomainCalls) * 100;
          return html`
            <button
              type="button"
              class="employee-workbench__mybot-cap-domain-row ${
                active ? "employee-workbench__mybot-cap-domain-row--active" : ""
              }"
              role="listitem"
              ?disabled=${domain.count === 0}
              @click=${() => {
                localUi.domainFilter =
                  domainFilter === domain.id || domain.count === 0 ? null : domain.id;
                bump(props);
              }}
            >
              <span class="employee-workbench__mybot-cap-domain-label">${domain.label}</span>
              <div class="employee-workbench__mybot-cap-meter-track">
                <div
                  class="employee-workbench__mybot-cap-meter-fill"
                  style=${`width:${pct}%`}
                ></div>
              </div>
              <span class="employee-workbench__mybot-cap-domain-count"
                >${domain.count === 0 ? "—" : `${domain.calls} 次 · ${domain.count}`}</span
              >
            </button>
          `;
        })}
      </div>
      ${
        domainFilter
          ? html`
              <button
                type="button"
                class="employee-workbench__mybot-cap-clear-filter"
                @click=${() => {
                  localUi.domainFilter = null;
                  bump(props);
                }}
              >
                清除域筛选
              </button>
            `
          : nothing
      }
      <div class="employee-workbench__settings-field-label">已使用能力</div>
      <ul class="employee-workbench__mybot-cap-list">
        ${sortedCaps.map(
          (cap) => html`
            <li>
              <button
                type="button"
                class="employee-workbench__mybot-cap-row"
                data-capability-id=${cap.relationId}
                @click=${() => {
                  localUi.selectedCapabilityId = cap.relationId;
                  bump(props);
                }}
              >
                <div class="employee-workbench__mybot-cap-main">
                  <strong>${cap.name}</strong>
                  <small class="employee-workbench__mybot-cap-calls"
                    >调用 ${Math.max(0, cap.callCount ?? 0)} 次</small
                  >
                  ${
                    cap.lastImprovedAt
                      ? html`<small class="employee-workbench__mybot-cap-improved"
                          >最近 ${relativeDayLabel(cap.lastImprovedAt)}</small
                        >`
                      : nothing
                  }
                </div>
                <span class="employee-workbench__settings-pill">${sourceLabel(cap.source)}</span>
              </button>
            </li>
          `,
        )}
      </ul>
      ${
        pending.length > 0
          ? html`
              <div class="employee-workbench__settings-field-label">待激活能力</div>
              <ul class="employee-workbench__mybot-cap-list">
                ${pending.map(
                  (cap) => html`
                    <li>
                      <button
                        type="button"
                        class="employee-workbench__mybot-cap-row employee-workbench__mybot-cap-row--pending"
                        data-capability-id=${cap.relationId}
                        @click=${() => {
                          localUi.selectedCapabilityId = cap.relationId;
                          bump(props);
                        }}
                      >
                        <div class="employee-workbench__mybot-cap-main">
                          <strong>${cap.name}</strong>
                          <small class="employee-workbench__mybot-cap-calls">待首次调用</small>
                        </div>
                        <span
                          class="employee-workbench__settings-pill employee-workbench__settings-pill--muted"
                          >${sourceLabel(cap.source)}</span
                        >
                      </button>
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

function renderGrowthBlock(props: MyBotWorkspaceDrawerProps, bot: MyBotProjection) {
  const sources =
    bot.growth.sources.length > 0 ? bot.growth.sources : (["personal"] as MyBotGrowthSource[]);
  const filter = localUi.growthSourceFilter;
  const events = bot.growth.recentEvents
    .map((event) => ({
      text: event.text,
      at: event.at,
      source: inferGrowthEventSource(event, sources),
      taskRef: event.taskRef,
      capabilityRef: event.capabilityRef,
    }))
    .filter((event) => (filter === "all" ? true : event.source === filter))
    .toSorted((a, b) => {
      const aMs = a.at ? Date.parse(a.at) : 0;
      const bMs = b.at ? Date.parse(b.at) : 0;
      return bMs - aMs;
    });
  const groups = groupEventsByDay(events);
  const filters: Array<{ id: GrowthFilter; label: string }> = [
    { id: "all", label: "全部" },
    { id: "personal", label: "任务完成" },
    { id: "group", label: "协作履约" },
    { id: "skill_upgrade", label: "能力里程碑" },
  ];
  const sourceCounts = bot.growth.sourceCounts;
  const taskCount = sourceCounts?.personal ?? 0;
  const milestoneCount = sourceCounts?.skill_upgrade ?? 0;
  const collabCount = sourceCounts?.group ?? 0;

  return html`
    <div class="employee-workbench__mybot-growth">
      <div class="employee-workbench__mybot-growth-head">
        <div class="employee-workbench__mybot-growth-level" data-growth-level>
          Lv.${bot.growth.level}
        </div>
        <div class="employee-workbench__mybot-growth-sources" data-growth-period>
          <span class="employee-workbench__settings-pill">任务 ${taskCount}</span>
          <span class="employee-workbench__settings-pill">协作 ${collabCount}</span>
          <span class="employee-workbench__settings-pill">能力 ${milestoneCount}</span>
        </div>
      </div>
      ${renderSectionLead("成长由完成的任务、协作角色与能力里程碑支撑，而非时间流逝。")}
      <div class="employee-workbench__mybot-growth-filters" role="toolbar" aria-label="成长证据筛选">
        ${filters.map(
          (item) => html`
            <button
              type="button"
              class="employee-workbench__mybot-growth-filter ${
                filter === item.id ? "employee-workbench__mybot-growth-filter--active" : ""
              }"
              @click=${() => {
                localUi.growthSourceFilter = item.id;
                bump(props);
              }}
            >
              ${item.label}
            </button>
          `,
        )}
      </div>
      ${
        events.length === 0
          ? html`
              <p class="employee-workbench__mybot-drawer-hint">
                ${
                  bot.identity.createdAt
                    ? `创建于 ${bot.identity.createdAt.slice(0, 10)}。完成第一个有结果的任务后，成长才会开始累计。`
                    : "完成第一个有结果的任务后，成长才会开始累计。"
                }
              </p>
            `
          : html`
              <ol class="employee-workbench__mybot-growth-timeline">
                ${groups.map(
                  (group) => html`
                    <li class="employee-workbench__mybot-growth-day">
                      <div class="employee-workbench__mybot-growth-day-label">${group.label}</div>
                      <ul class="employee-workbench__mybot-growth-day-events">
                        ${group.items.map(
                          (event) => html`
                            <li class="employee-workbench__mybot-growth-event">
                              <span class="employee-workbench__mybot-growth-dot" aria-hidden="true"></span>
                              <div class="employee-workbench__mybot-growth-event-body">
                                <strong>${event.text}</strong>
                                <span class="employee-workbench__settings-pill"
                                  >${growthSourceLabel(event.source)}</span
                                >
                                ${
                                  event.taskRef
                                    ? html`
                                        <button
                                          type="button"
                                          class="employee-workbench__mybot-growth-task-link"
                                          data-growth-task-kind=${event.taskRef.kind}
                                          @click=${() =>
                                            props.onOpenGrowthTaskRef?.(event.taskRef!)}
                                        >
                                          关联：${event.taskRef.title}
                                        </button>
                                      `
                                    : nothing
                                }
                                ${
                                  event.capabilityRef
                                    ? html`
                                        <button
                                          type="button"
                                          class="employee-workbench__mybot-growth-task-link"
                                          data-growth-cap-ref=${event.capabilityRef}
                                          @click=${() => {
                                            localUi.selectedCapabilityId =
                                              event.capabilityRef ?? null;
                                            const block = document.querySelector(
                                              '[data-block="capabilities"]',
                                            );
                                            if (block instanceof HTMLDetailsElement) {
                                              block.open = true;
                                            }
                                            bump(props);
                                          }}
                                        >
                                          查看能力
                                        </button>
                                      `
                                    : nothing
                                }
                              </div>
                            </li>
                          `,
                        )}
                      </ul>
                    </li>
                  `,
                )}
              </ol>
            `
      }
    </div>
  `;
}

export function renderMyBotWorkspaceDrawer(props: MyBotWorkspaceDrawerProps) {
  if (!props.open) {
    syncLocalUi(null);
    return nothing;
  }
  const bot = props.bot;
  const draft = props.identityDraft;
  const robotEntry = props.robotEntry;
  syncLocalUi(bot?.agentId ?? null);

  return html`
    <div
      class="employee-workbench__mybot-drawer-backdrop"
      @click=${() => {
        syncLocalUi(null);
        props.onClose();
      }}
      role="presentation"
    ></div>
    <aside
      class="employee-workbench__mybot-drawer"
      role="dialog"
      aria-modal="true"
      aria-label="我的 AI 助手详情"
      @click=${(event: Event) => event.stopPropagation()}
    >
      <header class="employee-workbench__mybot-drawer-head" data-wb-settings-toolbar>
        <div class="employee-workbench__mybot-drawer-heading">
          <div class="employee-workbench__mybot-drawer-kicker">我的机器人 · 详情</div>
          <div class="employee-workbench__mybot-drawer-title-row">
            ${bot ? renderIdentityAvatar(bot) : nothing}
            <div class="employee-workbench__mybot-drawer-title-stack">
              <h2 class="employee-workbench__mybot-drawer-title">
                ${bot?.identity.name ?? "加载中…"}
              </h2>
              ${
                bot
                  ? html`<div class="employee-workbench__mybot-drawer-status-line">
                      <span
                        class="employee-workbench__mybot-status-pill employee-workbench__mybot-status-pill--${
                          bot.identity.status
                        }"
                        >${statusLabel(bot.identity.status)}</span
                      >
                      ${
                        bot.identity.createdAt
                          ? html`<span>创建 ${bot.identity.createdAt.slice(0, 10)}</span>`
                          : nothing
                      }
                    </div>`
                  : nothing
              }
            </div>
          </div>
        </div>
        <button
          type="button"
          class="btn"
          @click=${() => {
            syncLocalUi(null);
            props.onClose();
          }}
        >
          关闭
        </button>
      </header>

      ${
        props.loading
          ? html`
              <div class="employee-workbench__mybot-drawer-status">正在加载详情…</div>
            `
          : nothing
      }
      ${
        props.error
          ? html`<div class="employee-workbench__mybot-drawer-error" role="alert">${props.error}</div>`
          : nothing
      }

      ${
        !bot
          ? nothing
          : html`
            <div class="employee-workbench__mybot-drawer-scroll">
              ${renderAccordion(
                "identity",
                "① 身份",
                true,
                renderIdentityBlock(props, bot),
                props.canEditIdentity && draft
                  ? html`
                      <button
                        type="button"
                        class="btn btn--primary"
                        ?disabled=${props.saving}
                        @click=${() => props.onSaveIdentity()}
                      >
                        ${props.saving ? "保存中…" : "保存身份"}
                      </button>
                    `
                  : nothing,
              )}

              ${renderAccordion(
                "capabilities",
                "② 能力",
                true,
                renderCapabilitiesBlock(props, bot),
              )}

              ${renderAccordion("persona", "③ 职能倾向", false, renderPersonaBlock(bot))}

              ${renderAccordion("growth", "④ 成长", true, renderGrowthBlock(props, bot))}

              ${renderAccordion(
                "collaboration",
                "⑤ 协作",
                false,
                renderCollaborationBlock(props, bot),
              )}

              ${renderAccordion("data", "⑥ 数据", false, renderDataBlock(bot))}

              <details class="employee-workbench__mybot-advanced-config" data-block="advanced-config">
                <summary class="employee-workbench__mybot-advanced-config-summary">
                  高级配置 · 运营身份授权
                </summary>
                <div class="employee-workbench__mybot-advanced-config-body">
                  ${renderSectionLead("配置机器人可调用的运营身份，与职能倾向 / 对话面具无关。")}
                  ${
                    robotEntry
                      ? renderRobotOperationalIdentityPanel({
                          entry: robotEntry,
                          snapshot: props.operationalIdentitySnapshot,
                          busy: Boolean(props.operationalIdentityBusy),
                          onApply: (input) => props.onApplyRobotIdentityGrants?.(input),
                          onAddPersonal: () =>
                            props.onOpenPersonalOperationalIdentity?.({
                              openEditor: true,
                              agentId: robotEntry.id,
                            }),
                          onOpenEnterpriseBinding: () =>
                            props.onOpenPersonalOperationalIdentity?.({
                              agentId: robotEntry.id,
                              authorizationIdentityTab: "enterprise",
                            }),
                        })
                      : html`
                          <p class="employee-workbench__mybot-drawer-hint">暂无机器人条目，无法配置运营身份。</p>
                        `
                  }
                </div>
              </details>
            </div>
          `
      }
    </aside>
  `;
}
