/**
 * 大白管家 · 一页组建数字员工团队。
 * 开始引导后同一页只保留候选名录，以及一句可点击的定制引导。
 * 文案不使用「欢迎入驻 OpenBot」。
 * 创建名额与员工工作台导航上限一致（不含大白管家）。
 */

import { EMPLOYEE_WORKBENCH_AGENT_NAV_LIMIT } from "../employee-workbench-nav-quota.ts";

export const DAIBAI_TEAM_MAX = EMPLOYEE_WORKBENCH_AGENT_NAV_LIMIT;

export type DaibaiTeamCategoryId = "all" | "office" | "growth" | "rd" | "ops";
export type DaibaiTeamPath = "catalog" | "describe" | "custom";
export type DaibaiTeamStep = "closed" | "page";

export type DaibaiTeamCatalogAgent = {
  id: string;
  name: string;
  emoji: string;
  specialty: string;
  caps: readonly string[];
  fit: string;
  category: Exclude<DaibaiTeamCategoryId, "all">;
  recommended: boolean;
  reason: string;
};

export type DaibaiTeamCategory = {
  id: DaibaiTeamCategoryId;
  label: string;
};

export const DAIBAI_TEAM_CATEGORIES: readonly DaibaiTeamCategory[] = [
  { id: "all", label: "全部" },
  { id: "office", label: "办公协作" },
  { id: "growth", label: "客户与增长" },
  { id: "rd", label: "研发与数据" },
  { id: "ops", label: "运营与行政" },
];

export const DAIBAI_TEAM_ROLE_CHIPS = [
  "产品经理",
  "销售",
  "研发",
  "运营",
  "人事",
  "财务",
  "客服",
  "市场",
] as const;

export const DAIBAI_TEAM_CATALOG: readonly DaibaiTeamCatalogAgent[] = [
  {
    id: "calendar",
    name: "日程秘书",
    emoji: "📅",
    specialty: "会议、日程、提醒",
    caps: ["日程同步", "会议安排", "智能提醒"],
    fit: "日程密集的角色",
    category: "office",
    recommended: true,
    reason: "帮你守住会议与截止日期，减少漏排。",
  },
  {
    id: "email",
    name: "邮件助理",
    emoji: "✉️",
    specialty: "收件摘要、草稿回复",
    caps: ["收件摘要", "草稿回复", "优先级"],
    fit: "邮件量大的角色",
    category: "office",
    recommended: true,
    reason: "压缩收件噪音，快速起草回复。",
  },
  {
    id: "minutes",
    name: "会议纪要员",
    emoji: "📝",
    specialty: "录音/笔记整理成纪要与待办",
    caps: ["纪要生成", "待办提取", "纪要分发"],
    fit: "会议频繁的团队",
    category: "office",
    recommended: false,
    reason: "会后自动沉淀纪要与待办。",
  },
  {
    id: "docs",
    name: "文档专员",
    emoji: "📄",
    specialty: "写稿、改稿、资料整理",
    caps: ["写稿", "改稿", "资料整理"],
    fit: "内容与方案输出",
    category: "office",
    recommended: true,
    reason: "加速方案、周报与资料整理。",
  },
  {
    id: "project",
    name: "项目跟催员",
    emoji: "📌",
    specialty: "任务状态同步与阻塞提醒",
    caps: ["状态同步", "阻塞提醒", "进度汇总"],
    fit: "项目与产品",
    category: "office",
    recommended: false,
    reason: "任务状态同步与阻塞早提醒。",
  },
  {
    id: "crm",
    name: "客户跟进助手",
    emoji: "🤝",
    specialty: "CRM 跟进提醒与话术草稿",
    caps: ["跟进提醒", "话术草稿", "客户档案"],
    fit: "客户成功与销售",
    category: "growth",
    recommended: false,
    reason: "提醒跟进节点并起草话术。",
  },
  {
    id: "leads",
    name: "销售线索官",
    emoji: "🎯",
    specialty: "线索清洗与跟进清单",
    caps: ["线索清洗", "跟进清单", "评分建议"],
    fit: "销售与增长",
    category: "growth",
    recommended: false,
    reason: "清洗线索、排出跟进优先级。",
  },
  {
    id: "cs",
    name: "客服应答员",
    emoji: "💬",
    specialty: "常见问题答复草稿",
    caps: ["FAQ 答复", "工单草稿", "语气校准"],
    fit: "客服与支持",
    category: "growth",
    recommended: false,
    reason: "常见问题答复草稿，稳住服务体验。",
  },
  {
    id: "content",
    name: "内容运营官",
    emoji: "📣",
    specialty: "社媒/内容排期与文案",
    caps: ["内容排期", "文案草稿", "话题建议"],
    fit: "市场与运营",
    category: "growth",
    recommended: false,
    reason: "内容排期与文案草稿一站完成。",
  },
  {
    id: "code",
    name: "代码搭档",
    emoji: "💻",
    specialty: "读代码、改 bug、写测试建议",
    caps: ["读代码", "改 bug", "测试建议"],
    fit: "研发工程师",
    category: "rd",
    recommended: false,
    reason: "读代码、改 bug、补测试建议。",
  },
  {
    id: "dashboard",
    name: "数据看板员",
    emoji: "📊",
    specialty: "报表解读与异常提醒",
    caps: ["报表解读", "异常提醒", "指标说明"],
    fit: "数据与运营",
    category: "rd",
    recommended: false,
    reason: "解读报表并提示异常波动。",
  },
  {
    id: "research",
    name: "调研分析师",
    emoji: "🔍",
    specialty: "竞品与行业资料搜集摘要",
    caps: ["竞品调研", "行业摘要", "资料归档"],
    fit: "产品与战略角色",
    category: "rd",
    recommended: false,
    reason: "缩短竞品与行业信息搜集时间。",
  },
  {
    id: "recruit",
    name: "招聘助理",
    emoji: "👔",
    specialty: "JD 起草、简历初筛要点",
    caps: ["JD 起草", "简历要点", "面试清单"],
    fit: "人事与招聘",
    category: "ops",
    recommended: false,
    reason: "JD 与简历初筛要点更省心。",
  },
  {
    id: "expense",
    name: "报销小助手",
    emoji: "🧾",
    specialty: "票据归类与报销单草稿",
    caps: ["票据归类", "报销草稿", "合规检查"],
    fit: "行政与财务",
    category: "ops",
    recommended: false,
    reason: "票据归类与报销单草稿。",
  },
  {
    id: "compliance",
    name: "合规提醒员",
    emoji: "✅",
    specialty: "流程检查清单与到期提醒",
    caps: ["检查清单", "到期提醒", "流程核对"],
    fit: "合规与管理",
    category: "ops",
    recommended: false,
    reason: "流程清单与到期事项不错过。",
  },
  {
    id: "contract",
    name: "合同审查员",
    emoji: "📄",
    specialty: "合同条款风险识别与要点摘要",
    caps: ["风险条款", "要点摘要", "PDF 解析"],
    fit: "法务、商务与采购",
    category: "ops",
    recommended: false,
    reason: "识别合同风险条款并整理审查要点。",
  },
];

const ROLE_PLANS: Record<string, readonly string[]> = {
  产品经理: ["calendar", "docs", "minutes", "project", "research"],
  销售: ["crm", "leads", "email", "calendar", "docs"],
  研发: ["code", "docs", "calendar", "project", "dashboard"],
  运营: ["content", "dashboard", "docs", "calendar", "crm"],
  人事: ["recruit", "docs", "calendar", "email", "compliance"],
  财务: ["expense", "compliance", "docs", "dashboard", "email"],
  客服: ["cs", "email", "docs", "crm", "calendar"],
  市场: ["content", "research", "docs", "leads", "calendar"],
  _default: ["calendar", "email", "docs", "project", "dashboard"],
};

export const DAIBAI_TEAM_COPY = {
  kicker: "组建数字员工团队",
  welcome: "我是大白管家，我来帮你创建专属你的数字员工团队。",
  catalogTitle: "从候选名录挑选",
  catalogBody: "勾选推荐角色，在这一页直接创建。",
  plusGuidance: "结合你的岗位职责和日常工作事务，点击“+”直接定制数字人。",
  pickLead: "已为你预选常用角色，可按需增减。",
  roleGroup: "常见角色",
  taskPlaceholder: "例如：我负责产品方案和周会，每天要改文档、催进度、收邮件。",
  planButton: "帮我规划团队",
  planning: "正在根据你的职责挑选数字员工…",
  replan: "重新描述",
  permission: "权限说明：数字员工仅在你明确授权的工具与数据范围内协助工作，可随时调整或停用。",
  create: "创建所选数字员工",
  creating: "创建中…",
  successTitle: "团队已就绪",
  successBody: "大白管家已为你创建专属数字员工团队，他们随时待命。",
  gapsTitle: "待补齐连接与身份",
  gapsLead: "岗位技能已按模板预装；下列连接 / 身份仍需你或管理员显式申请，不会自动授权。",
  gapsPreloaded: "已预装",
  gapsPending: "待申请",
  gapsRecommended: "建议申请",
  gapsSeatCheck: "需核对",
  gapsEmpty: "该角色暂无额外待申请项。",
  scanTitle: "扫描并申请企业 MCP",
  scanLead:
    "主动扫描企业已登记 / 已发现的 MCP，按岗位过滤后先提交企业审批；通过后由管理员显式开通，不会自动授权。",
  scanButton: "扫描企业 MCP",
  scanScanning: "正在扫描…",
  scanRetry: "重新扫描",
  scanUnavailable: "当前无法扫描（未连接网关）。将显示岗位静态 MCP 提示。",
  scanError: "扫描失败，请稍后重试。已降级为岗位静态 MCP 提示。",
  scanEmptyNoMatch: "未发现与本岗位相关的 MCP 候选。可稍后在数据能力中心查看全部发现结果。",
  scanEmptyNoCandidates: "企业侧暂无 MCP 候选。可请管理员在能力中心登记或 Save 映射。",
  scanEmptyRemote: "远程 tools/list 暂不可用；已降级为岗位静态 MCP 提示（需管理员显式 Save）。",
  scanAuthorized: "已授权可用",
  scanStaticFallback: "静态提示（未自动 grant）",
  scanAdminNote: "提交后进入企业审批；通过后由管理员显式开通（不会自动授权）。",
  scanSubmitSuccess: "已提交申请 #{id}；通过后由管理员显式开通（不会自动授权）。",
  scanSubmitting: "正在提交审批…",
  scanSubmitError: "提交审批失败，请稍后重试。",
  scanSubmitUnavailable: "当前无法提交审批（未连接网关）。",
  scanOpenEdc: "打开 EDC（管理员）",
  scanOiLead: "运营身份需先提交企业审批；通过后由本人或管理员显式开通，不会自动授权。",
  oiSubmitSuccess: "已提交申请 #{id}；通过后由本人或管理员显式开通（不会自动授权）。",
  oiSubmitting: "正在提交审批…",
  oiSubmitError: "提交审批失败，请稍后重试。",
  oiSubmitUnavailable: "当前无法提交审批（未连接网关）。",
  oiOpenAuthorize: "去完成本人开通",
  appsTitle: "我的申请",
  appsLead: "以下是你提交的能力开通申请。批准后仍需管理员显式开通，不会自动授权。",
  appsEmpty: "暂无申请。提交 MCP 扫描或运营身份审批后，会显示在这里。",
  appsLoading: "正在读取我的申请…",
  appsError: "暂时无法读取我的申请，请稍后刷新。",
  appsUnavailable: "当前无法读取我的申请（未连接网关）。",
  appsRefresh: "刷新",
  appsCancel: "撤回",
  appsCancelling: "撤回中…",
  appsCancelError: "撤回失败，请稍后重试。",
  enter: "进入工作台",
  /** Kept in 大白’s thread after the guide is opened or a team is created. */
  retainedNote: "这份引导会留在大白的对话里，你可以随时回看、预览，或继续从这里调整。",
  /** Closest existing capability intro: header「问大白」familiarization ask. */
  exploreCapabilities: "带我了解 OpenBot 的功能",
  /** Personal settings → 账号 → 个人资料, so the steward can work from her profile. */
  completePersonalSetup: "完成配置，让数字人更懂你和熟悉你的工作。",
  selected: "已选",
  people: "位",
  recommended: "推荐",
  fitPrefix: "适合谁",
  quota: `最多选择 ${DAIBAI_TEAM_MAX} 位数字员工（不含大白管家）。`,
  emptySelection: "请至少选择一位数字员工。",
  unavailable: "当前无法创建数字员工。",
  openTeam: "去组建团队",
} as const;

/** Reject the retired onboarding slogan and its spacing/case variants. */
export function containsBannedDabaiWelcome(text: string): boolean {
  return /欢迎入驻\s*openbot/i.test(text);
}

export function recommendedDaibaiTeamIds(): string[] {
  return DAIBAI_TEAM_CATALOG.filter((agent) => agent.recommended).map((agent) => agent.id);
}

export function findDaibaiTeamAgent(id: string): DaibaiTeamCatalogAgent | undefined {
  return DAIBAI_TEAM_CATALOG.find((agent) => agent.id === id);
}

export function planDaibaiTeam(role: string | null, taskText: string): string[] {
  const base = ROLE_PLANS[role ?? ""] ?? ROLE_PLANS._default;
  const text = taskText.trim().toLowerCase();
  const extra: string[] = [];
  const push = (id: string, pattern: RegExp) => {
    if (pattern.test(text) && !base.includes(id) && !extra.includes(id)) {
      extra.push(id);
    }
  };
  push("crm", /客户|crm|跟进/);
  push("code", /代码|研发|bug|工程/);
  push("dashboard", /数据|报表|指标/);
  push("recruit", /招聘|简历|jd/);
  push("expense", /报销|财务|票据/);
  push("content", /内容|社媒|运营文案/);
  const cappedExtra = extra.slice(0, DAIBAI_TEAM_MAX);
  const head = base
    .filter((id) => !cappedExtra.includes(id))
    .slice(0, DAIBAI_TEAM_MAX - cappedExtra.length);
  return [...head, ...cappedExtra];
}

export function daibaiTeamPlanIntro(role: string | null): string {
  return role
    ? `结合「${role}」角色与你的事务，我建议这样组建（可开关调整）：`
    : "根据你描述的事务，我建议这样组建（可开关调整）：";
}

export type DaibaiTeamMemberDraft = {
  catalogId: string;
  name: string;
  emoji: string;
  specialty: string;
};

export type DaibaiTeamCreatedMember = {
  catalogId: string;
  agentId: string;
  name: string;
};

export type DaibaiTeamOnboardingState = {
  step: DaibaiTeamStep;
  path: DaibaiTeamPath | null;
  category: DaibaiTeamCategoryId;
  selectedIds: string[];
  role: string | null;
  taskText: string;
  proposedIds: string[];
  customNames: Record<string, string>;
  planning: boolean;
  busy: boolean;
  error: string | null;
  created: DaibaiTeamCreatedMember[];
};

export type DaibaiTeamOnboardingEvent =
  | { name: "onboarding_started"; from: "welcome" }
  | { name: "path_chosen"; path: DaibaiTeamPath; switched?: boolean }
  | { name: "agents_selected"; path: DaibaiTeamPath; agentIds: string[] }
  | { name: "team_created"; path: DaibaiTeamPath | null; team: Array<{ id: string; name: string }> }
  | { name: "onboarding_skipped" }
  | { name: "enter_workbench" };

export type DaibaiTeamOnboardingAction =
  | { type: "start" }
  | { type: "choosePath"; path: DaibaiTeamPath }
  | { type: "setCategory"; category: DaibaiTeamCategoryId }
  | { type: "toggle"; id: string }
  | { type: "setRole"; role: string | null }
  | { type: "setTaskText"; text: string }
  | { type: "beginPlan" }
  | { type: "finishPlan" }
  | { type: "replan" }
  | { type: "rename"; id: string; name: string }
  | { type: "note"; error: string | null }
  | { type: "createStart" }
  | { type: "createSuccess"; created: DaibaiTeamCreatedMember[]; error?: string | null }
  | { type: "createFailure"; error: string }
  | { type: "skip" }
  | { type: "enterWorkbench" }
  | { type: "reset" };

export function createDaibaiTeamOnboardingState(): DaibaiTeamOnboardingState {
  return {
    step: "closed",
    path: null,
    category: "all",
    selectedIds: recommendedDaibaiTeamIds(),
    role: null,
    taskText: "",
    proposedIds: [],
    customNames: {},
    planning: false,
    busy: false,
    error: null,
    created: [],
  };
}

function withError(
  state: DaibaiTeamOnboardingState,
  error: string | null,
): DaibaiTeamOnboardingState {
  return { ...state, error };
}

export function selectedDaibaiTeamAgents(
  state: Pick<DaibaiTeamOnboardingState, "selectedIds" | "customNames">,
): DaibaiTeamMemberDraft[] {
  const drafts: DaibaiTeamMemberDraft[] = [];
  for (const id of state.selectedIds) {
    const agent = findDaibaiTeamAgent(id);
    if (!agent) {
      continue;
    }
    const renamed = state.customNames[id]?.trim();
    drafts.push({
      catalogId: agent.id,
      name: renamed || agent.name,
      emoji: agent.emoji,
      specialty: agent.specialty,
    });
  }
  return drafts;
}

export function reduceDaibaiTeamOnboarding(
  state: DaibaiTeamOnboardingState,
  action: DaibaiTeamOnboardingAction,
): { state: DaibaiTeamOnboardingState; events: DaibaiTeamOnboardingEvent[] } {
  switch (action.type) {
    case "start":
      return {
        state: {
          ...state,
          step: "page",
          path: null,
          error: null,
          busy: false,
          planning: false,
        },
        events: [{ name: "onboarding_started", from: "welcome" }],
      };
    case "choosePath": {
      const collapse = state.path === action.path;
      const switched = state.path != null && state.path !== action.path;
      return {
        state: {
          ...state,
          step: "page",
          path: collapse ? null : action.path,
          planning: false,
          error: null,
          ...(action.path === "describe" && !collapse ? { proposedIds: [] } : {}),
        },
        events: collapse
          ? []
          : [
              {
                name: "path_chosen",
                path: action.path,
                ...(switched ? { switched: true } : {}),
              },
            ],
      };
    }
    case "setCategory":
      return { state: { ...state, category: action.category }, events: [] };
    case "toggle": {
      const selected = state.selectedIds.includes(action.id);
      if (selected) {
        return {
          state: {
            ...state,
            selectedIds: state.selectedIds.filter((id) => id !== action.id),
            error: null,
          },
          events: [],
        };
      }
      if (state.selectedIds.length >= DAIBAI_TEAM_MAX) {
        return { state: withError(state, DAIBAI_TEAM_COPY.quota), events: [] };
      }
      if (!findDaibaiTeamAgent(action.id)) {
        return { state, events: [] };
      }
      return {
        state: { ...state, selectedIds: [...state.selectedIds, action.id], error: null },
        events: [],
      };
    }
    case "setRole":
      return { state: { ...state, role: action.role, error: null }, events: [] };
    case "setTaskText":
      return { state: { ...state, taskText: action.text }, events: [] };
    case "beginPlan":
      return {
        state: { ...state, planning: true, proposedIds: [], error: null },
        events: [],
      };
    case "finishPlan": {
      const ids = planDaibaiTeam(state.role, state.taskText);
      return {
        state: {
          ...state,
          planning: false,
          proposedIds: ids,
          selectedIds: ids,
          error: null,
        },
        events: [{ name: "agents_selected", path: "describe", agentIds: ids }],
      };
    }
    case "replan":
      return {
        state: { ...state, planning: false, proposedIds: [], error: null },
        events: [],
      };
    case "note":
      return { state: withError(state, action.error), events: [] };
    case "rename": {
      const agent = findDaibaiTeamAgent(action.id);
      const name = action.name.trim() || agent?.name || "";
      return {
        state: { ...state, customNames: { ...state.customNames, [action.id]: name } },
        events: [],
      };
    }
    case "createStart": {
      const path = state.path === "catalog" || state.path === "describe" ? state.path : null;
      return {
        state: { ...state, busy: true, error: null },
        events: path
          ? [{ name: "agents_selected" as const, path, agentIds: [...state.selectedIds] }]
          : [],
      };
    }
    case "createSuccess":
      return {
        state: {
          ...state,
          busy: false,
          step: "page",
          created: action.created,
          error: action.error ?? null,
        },
        events: [
          {
            name: "team_created",
            path: state.path,
            team: action.created.map((member) => ({ id: member.catalogId, name: member.name })),
          },
        ],
      };
    case "createFailure":
      return { state: { ...state, busy: false, error: action.error }, events: [] };
    case "skip":
      // Side actions (了解功能 / 个人配置 / 能力缺口) must not erase the guide
      // transcript. Once the page is open it stays in 大白’s conversation.
      return {
        state: state.step === "page" ? state : createDaibaiTeamOnboardingState(),
        events: [{ name: "onboarding_skipped" }],
      };
    case "enterWorkbench":
      return {
        state: state.step === "page" ? state : createDaibaiTeamOnboardingState(),
        events: [{ name: "enter_workbench" }],
      };
    case "reset":
      return { state: createDaibaiTeamOnboardingState(), events: [] };
    default:
      return { state, events: [] };
  }
}
