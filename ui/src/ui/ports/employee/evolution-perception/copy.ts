/**
 * User-facing copy for the employee evolution perception panel.
 * Aligned with OpenBotKit `EvolutionPerceptionCopy`.
 * Empty, denial, and untrusted states never invent a learned-nothing claim.
 * Claim grade: runtime-enabled. Not production-proven.
 */

export const EVOLUTION_PERCEPTION_COPY = {
  empty: "暂无可投影的记录",
  denied: "当前会话无权读取进化投影。",
  untrusted: "投影不是只读响应，已关闭。",
  readOnlyReminder: "只读投影；不会写入、批准或应用。",
  readOnlyBadge: "只读",
  weekChangeTitle: "本周变化",
  moreProjections: "更多投影",
  moreProjectionsUnavailable: "更多投影（无法加载）",
  projectionsEmpty: "当前时间窗下暂无其他投影。",
  projectionsLoadFailed: "投影加载失败。",
  platformBadge: "平台",
  digitalHumanSection: "数字人",
  platformSection: "平台",
  learnedPanelTitle: "数字人变化",
  loading: "正在加载本周进化记录…",
  loadingLegacy: "读取本周变化",
  offline: "网关未连接，无法读取进化投影。",
  refresh: "刷新",
  retry: "重试",
  provenanceTitle: "溯源",
  close: "关闭",
  learnedNarration: "数字人叙述",
  platformNarration: "平台叙述",
  otherNarration: "其他",
  automaticTitle: "自动动作",
  timelineTitle: "时间线",
  digestTitle: "周报",
  pendingTitle: "待决定",
  observationTitle: "观察队列",
  rollbackTitle: "回滚史",
  missing: "未提供",
  unavailableSummary: "前后版本不可用",
  budgetUnavailablePrefix: "自治预算未随投影提供",
  successEmptyLead: "这一周（{from} — {to}）没有新的数字人变化。",
  successEmptyHint: "这是正常状态。当前周窗口内没有新的进化事件。",
  successEmptySpanHint: "这是正常状态。这 {days} 天的窗口内没有新的进化事件。",
  successEmptyLastChangeUnknown: "本窗口里查不到上次变化的时间。要看更早的记录，使用「相对上周」。",
  successEmptyRelativeNext: "本窗口里查不到上次变化的时间。相对上周有 {count} 条，建议先查看。",
  freshnessHint: "查询截至 {asOf}。刷新是手动的，数量只统计当前周窗口。",
  freshnessManual: "刷新是手动的，数量只统计当前周窗口。",
  lowSignalFact: "这条记录还没有可查看的变化细节。",
  errorLead: "暂时无法加载进化记录。",
  errorHint: "请检查网络后重试。若持续失败，把时间窗和截图发给管理员。",
  ctaViewDiff: "查看相对上周",
  ctaExpandProjections: "展开更多投影",
  foldedAutomatic: "有自动执行的变化",
  foldedApproved: "有经批准的变化",
  foldedObserving: "有观察中的变化",
  foldedRolledBack: "有已回滚的变化",
  foldedPlatform: "有平台变化",
  countUnavailable: "—",
  countLoading: "…",
} as const;

/** Toolbar navigation. Other intents stay in the projection payload, not as chips. */
export const EVOLUTION_PERCEPTION_INTENTS = [
  { id: "learned_this_week", title: EVOLUTION_PERCEPTION_COPY.weekChangeTitle },
  { id: "diff_from_last_week", title: "相对上周" },
] as const;

export type EvolutionPerceptionIntentId = (typeof EVOLUTION_PERCEPTION_INTENTS)[number]["id"];

export const DEFAULT_EVOLUTION_PERCEPTION_INTENT: EvolutionPerceptionIntentId = "learned_this_week";

/** Legacy / core empty-template lines that must not render as success content. */
export const EVOLUTION_EMPTY_NARRATION_TEMPLATES = [
  "本窗口没有可追溯的数字人变化。",
  "相对上一窗口，没有新的可追溯变化。",
  "本窗口没有自动执行的可追溯变化。",
  "本窗口没有经批准的可追溯变化。",
  "本窗口没有观察中的可追溯变化。",
  "本窗口没有已回滚的可追溯变化。",
  "本窗口没有平台可追溯变化。",
  "这一周还没有可查看的数字人变化。",
  "相对上周还没有可查看的变化。",
  "这一周还没有自动执行的变化。",
  "这一周还没有经批准的变化。",
  "这一周还没有观察中的变化。",
  "这一周还没有已回滚的变化。",
  "这一周还没有平台升级相关变化。",
] as const;
