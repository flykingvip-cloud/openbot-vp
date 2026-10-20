/**
 * ConversationTask Runtime — P0 offline golden sample set.
 *
 * This is the labelled corpus used by P1 offline replay / evaluation. It is data
 * only: importing it creates no task, writes no ledger, starts no agent. Gold
 * labels encode the *true* class of each turn; the P1 detector/qualifier is scored
 * against them. Recall misses (a fuzzy true-L2 the high-precision detector skips)
 * are intentional and appear as `fuzzy_negative` samples.
 *
 * Required coverage (execution-plan §12 + handoff): ordinary Q&A, one-shot short
 * action, Reminder, Scheduled Action, long-running monitoring, wait-condition that
 * must not escalate, user goal revision, external side-effect authorization,
 * duplicate-message idempotency, model completion self-claims, plus fuzzy/negative
 * and cross-turn cases.
 */

import type { ConversationTurnInput, QualificationKind, SideEffectClass } from "./types.js";

export type SampleCategory =
  | "ordinary_qa"
  | "short_action"
  | "reminder"
  | "scheduled_action"
  | "long_running"
  | "wait_no_escalation"
  | "revision_intent"
  | "side_effect_authorization"
  | "duplicate_idempotency"
  | "model_completion_claim"
  | "fuzzy_negative";

export const SAMPLE_CATEGORIES: readonly SampleCategory[] = [
  "ordinary_qa",
  "short_action",
  "reminder",
  "scheduled_action",
  "long_running",
  "wait_no_escalation",
  "revision_intent",
  "side_effect_authorization",
  "duplicate_idempotency",
  "model_completion_claim",
  "fuzzy_negative",
] as const;

export type ConversationTaskSample = {
  id: string;
  category: SampleCategory;
  input: ConversationTurnInput;
  /** Gold: is the user proposing a work item (true nature)? */
  goldDetected: boolean;
  /** Gold: the true qualification kind. */
  goldQualification: QualificationKind;
  /** Gold: external side-effect class (drives Authorization, not duration). */
  goldSideEffect: SideEffectClass;
  /**
   * For genuine long-running work: would it truly survive beyond the first run
   * (multi-round)? Used by the Task Survival proxy metric.
   */
  goldSurvivesFirstRound?: boolean;
  /**
   * Set when the high-precision detector is expected to miss this sample on
   * purpose (recall < 100% by design, precision preserved).
   */
  expectedDetectorMiss?: boolean;
  notes: string;
};

export const CONVERSATION_TASK_SAMPLES: readonly ConversationTaskSample[] = [
  // --- ordinary Q&A (L0) ---------------------------------------------------
  {
    id: "ct-qa-01",
    category: "ordinary_qa",
    input: { messageId: "m-qa-01", text: "什么是毛利率？" },
    goldDetected: false,
    goldQualification: "chat",
    goldSideEffect: "none",
    notes: "普通问答；不建任务，不建 Ledger。",
  },
  {
    id: "ct-qa-02",
    category: "ordinary_qa",
    input: { messageId: "m-qa-02", text: "帮我解释一下 OKR 和 KPI 的区别" },
    goldDetected: false,
    goldQualification: "chat",
    goldSideEffect: "none",
    notes: "解释类问答，无持续工作。",
  },
  {
    id: "ct-qa-03",
    category: "ordinary_qa",
    input: { messageId: "m-qa-03", text: "SaaS 的 LTV 一般是怎么算的？" },
    goldDetected: false,
    goldQualification: "chat",
    goldSideEffect: "none",
    notes: "知识型提问。",
  },
  {
    id: "ct-qa-04",
    category: "ordinary_qa",
    input: { messageId: "m-qa-04", text: "你觉得这种定价策略合理吗？" },
    goldDetected: false,
    goldQualification: "chat",
    goldSideEffect: "none",
    notes: "征求意见，非工作请求。",
  },

  // --- one-shot short action (L1) -----------------------------------------
  {
    id: "ct-sa-01",
    category: "short_action",
    input: { messageId: "m-sa-01", text: "查一下今天华东区销售额" },
    goldDetected: true,
    goldQualification: "short_action",
    goldSideEffect: "none",
    notes: "当前 run 内可完成；今天=当前，不是未来意图。",
  },
  {
    id: "ct-sa-02",
    category: "short_action",
    input: { messageId: "m-sa-02", text: "把这段话翻译成英文：我们下周一开会" },
    goldDetected: true,
    goldQualification: "short_action",
    goldSideEffect: "none",
    notes: "内嵌“下周一”是内容，不是任务的未来意图。",
  },
  {
    id: "ct-sa-03",
    category: "short_action",
    input: { messageId: "m-sa-03", text: "算一下 1284 乘以 37 是多少" },
    goldDetected: true,
    goldQualification: "short_action",
    goldSideEffect: "none",
    notes: "一次性计算。",
  },
  {
    id: "ct-sa-04",
    category: "short_action",
    input: { messageId: "m-sa-04", text: "看看昨天的订单总数是多少" },
    goldDetected: true,
    goldQualification: "short_action",
    goldSideEffect: "none",
    notes: "一次性查询。",
  },
  {
    id: "ct-sa-05",
    category: "short_action",
    input: { messageId: "m-sa-05", text: "先查一下再发给我" },
    goldDetected: true,
    goldQualification: "short_action",
    goldSideEffect: "none",
    notes: "一轮内顺序动作，未命名多步骤/多流程，不得升级 L2。",
  },
  {
    id: "ct-sa-06",
    category: "short_action",
    input: { messageId: "m-sa-06", text: "分三步把这段话翻译成英文" },
    goldDetected: true,
    goldQualification: "short_action",
    goldSideEffect: "none",
    notes: "虽有分步标签，但仍是当前 run 可完成的一次性翻译。",
  },

  // --- Reminder ------------------------------------------------------------
  {
    id: "ct-rm-01",
    category: "reminder",
    input: { messageId: "m-rm-01", text: "下周一提醒我提交报销" },
    goldDetected: true,
    goldQualification: "reminder",
    goldSideEffect: "none",
    notes: "未来提醒人；无持续 Agent 执行，不建 Long-running Ledger。",
  },
  {
    id: "ct-rm-02",
    category: "reminder",
    input: { messageId: "m-rm-02", text: "明天下午三点提醒我给客户打电话" },
    goldDetected: true,
    goldQualification: "reminder",
    goldSideEffect: "none",
    notes: "一次性提醒。",
  },
  {
    id: "ct-rm-03",
    category: "reminder",
    input: { messageId: "m-rm-03", text: "记得周五提醒我交周报" },
    goldDetected: true,
    goldQualification: "reminder",
    goldSideEffect: "none",
    notes: "提醒人去做，不是系统执行动作。",
  },

  // --- Scheduled Action ----------------------------------------------------
  {
    id: "ct-sch-01",
    category: "scheduled_action",
    input: { messageId: "m-sch-01", text: "明早生成一次日报" },
    goldDetected: true,
    goldQualification: "scheduled_action",
    goldSideEffect: "none",
    notes: "未来一次性动作；不得仅凭未来时间升级 L2。",
  },
  {
    id: "ct-sch-02",
    category: "scheduled_action",
    input: { messageId: "m-sch-02", text: "后天早上八点把周报发到我邮箱" },
    goldDetected: true,
    goldQualification: "scheduled_action",
    goldSideEffect: "outbound_message",
    notes: "一次性定时动作 + 发送副作用；类型仍是 scheduled_action（副作用正交）。",
  },
  {
    id: "ct-sch-03",
    category: "scheduled_action",
    input: { messageId: "m-sch-03", text: "每天早上九点给我发一条当天的天气" },
    goldDetected: true,
    goldQualification: "scheduled_action",
    goldSideEffect: "outbound_message",
    notes: "重复固定动作；重复本身不足以升级 L2（无持久评估状态）。",
  },

  // --- long-running monitoring (L2) ---------------------------------------
  {
    id: "ct-lr-01",
    category: "long_running",
    input: {
      messageId: "m-lr-01",
      text: "每周监控竞品价格，异常时分析并通知我",
    },
    goldDetected: true,
    goldQualification: "long_running_candidate",
    goldSideEffect: "none",
    goldSurvivesFirstRound: true,
    notes: "重复 + 等待条件 + 多阶段 + 持久状态；经典 L2。通知我=对本人，非广播。",
  },
  {
    id: "ct-lr-02",
    category: "long_running",
    input: {
      messageId: "m-lr-02",
      text: "持续跟踪这个项目的进度，每有重大变化就整理成简报发我",
    },
    goldDetected: true,
    goldQualification: "long_running_candidate",
    goldSideEffect: "none",
    goldSurvivesFirstRound: true,
    notes: "持续跟踪 + 等待条件 + 交付物；跨多轮。",
  },
  {
    id: "ct-lr-03",
    category: "long_running",
    input: {
      messageId: "m-lr-03",
      text: "盯着这个客户的合同审批，等法务通过后提醒我并归档",
    },
    goldDetected: true,
    goldQualification: "long_running_candidate",
    goldSideEffect: "none",
    goldSurvivesFirstRound: true,
    notes: "等待外部条件 + 多阶段 + 持久状态。",
  },
  {
    id: "ct-lr-04",
    category: "long_running",
    input: {
      messageId: "m-lr-04",
      text: "接下来一个月每天统计一次转化率，月底汇总成报告，如果连续三天下降就预警",
    },
    goldDetected: true,
    goldQualification: "long_running_candidate",
    goldSideEffect: "none",
    goldSurvivesFirstRound: true,
    notes: "重复 + 多阶段 + 明确验收(连续三天下降) + 交付物 + 持久状态。",
  },
  {
    id: "ct-lr-05",
    category: "long_running",
    input: {
      messageId: "m-lr-05",
      text: "持续监控服务器错误率，超过阈值就记录并通知我",
    },
    goldDetected: true,
    goldQualification: "long_running_candidate",
    goldSideEffect: "none",
    goldSurvivesFirstRound: true,
    notes: "持续监控 + 阈值等待 + 记录/通知。",
  },
  {
    id: "ct-lr-06",
    category: "long_running",
    input: {
      messageId: "m-lr-06",
      text: "这是一个多步骤任务：先调研竞品，再出方案，最后评审通过后落地",
    },
    goldDetected: true,
    goldQualification: "long_running_candidate",
    goldSideEffect: "none",
    goldSurvivesFirstRound: true,
    notes: "用户明确命名多步骤 + 目标；无监控词也应升级 L2。",
  },
  {
    id: "ct-lr-07",
    category: "long_running",
    input: {
      messageId: "m-lr-07",
      text: "按多流程帮我做完：第一步收集资料，第二步写纪要，第三步发给我",
    },
    goldDetected: true,
    goldQualification: "long_running_candidate",
    goldSideEffect: "none",
    goldSurvivesFirstRound: true,
    notes: "提示词枚举步骤 + 多流程标签；跨轮计划状态。",
  },
  {
    id: "ct-lr-08",
    category: "long_running",
    input: {
      messageId: "m-lr-08",
      text: "This is a multi-step task: research competitors, draft a plan, then review it",
    },
    goldDetected: true,
    goldQualification: "long_running_candidate",
    goldSideEffect: "none",
    goldSurvivesFirstRound: true,
    notes: "英文提示词语气：explicit multi-step + 方案交付物。",
  },

  // --- wait condition that must NOT escalate ------------------------------
  {
    id: "ct-wait-01",
    category: "wait_no_escalation",
    input: { messageId: "m-wait-01", text: "等客户回复后继续" },
    goldDetected: true,
    goldQualification: "needs_clarification",
    goldSideEffect: "none",
    notes: "只有等待条件、无明确目标；不得激活，需澄清“继续什么”。",
  },
  {
    id: "ct-wait-02",
    category: "wait_no_escalation",
    input: {
      messageId: "m-wait-02",
      text: "等财务确认后再往下走",
      priorTurns: ["帮我算一下这个季度的奖金池"],
      hasActiveTaskBinding: true,
      turnMode: "wait",
    },
    goldDetected: true,
    goldQualification: "chat",
    goldSideEffect: "none",
    notes: "已有活跃任务时，等待只是 Turn Contract 阻塞闸，不新建任务。",
  },
  {
    id: "ct-wait-03",
    category: "wait_no_escalation",
    input: { messageId: "m-wait-03", text: "等我想好了再说吧" },
    goldDetected: false,
    goldQualification: "chat",
    goldSideEffect: "none",
    notes: "无工作意图。",
  },
  {
    id: "ct-wait-04",
    category: "wait_no_escalation",
    input: { messageId: "m-wait-04", text: "这个先放一放，等下季度再看" },
    goldDetected: false,
    goldQualification: "chat",
    goldSideEffect: "none",
    notes: "推迟，不是持续任务。",
  },

  // --- user revises goal ---------------------------------------------------
  {
    id: "ct-rev-01",
    category: "revision_intent",
    input: {
      messageId: "m-rev-01",
      text: "把 Q2 改成 Q3",
      priorTurns: ["帮我做一份 Q2 的销售复盘"],
      hasActiveTaskBinding: true,
    },
    goldDetected: true,
    goldQualification: "needs_clarification",
    goldSideEffect: "none",
    notes: "修改既有任务目标；P1 不做 active-task 解析，标记为需澄清/交由 P3 绑定，不新建任务。",
  },
  {
    id: "ct-rev-02",
    category: "revision_intent",
    input: {
      messageId: "m-rev-02",
      text: "刚才那个报告，再加一个同比分析",
      priorTurns: ["生成一份本月营收报告"],
      hasActiveTaskBinding: true,
    },
    goldDetected: true,
    goldQualification: "needs_clarification",
    goldSideEffect: "none",
    notes: "对既有交付追加要求；同属 Revision，P1 不新建第二个任务。",
  },

  // --- external side-effect authorization (orthogonal to duration) ---------
  {
    id: "ct-auth-01",
    category: "side_effect_authorization",
    input: {
      messageId: "m-auth-01",
      text: "整理一下发给全部销售",
      priorTurns: ["生成一份本周价格调整说明"],
      hasActiveTaskBinding: true,
    },
    goldDetected: true,
    goldQualification: "short_action",
    goldSideEffect: "broadcast",
    notes: "工作是一次性整理+发送；发送给全部销售=广播副作用，必须 Human Gate。",
  },
  {
    id: "ct-auth-02",
    category: "side_effect_authorization",
    input: { messageId: "m-auth-02", text: "把这个方案同步到 CRM 里" },
    goldDetected: true,
    goldQualification: "short_action",
    goldSideEffect: "external_write",
    notes: "写外部系统副作用；类型仍是短动作。",
  },
  {
    id: "ct-auth-03",
    category: "side_effect_authorization",
    input: { messageId: "m-auth-03", text: "把这个方案整理一下" },
    goldDetected: true,
    goldQualification: "short_action",
    goldSideEffect: "none",
    notes: "ct-auth-02 的无副作用对照项；CT7 要求二者类型一致。",
  },
  {
    id: "ct-auth-04",
    category: "side_effect_authorization",
    input: { messageId: "m-auth-04", text: "帮我给这三个客户群都发一下这个通知" },
    goldDetected: true,
    goldQualification: "short_action",
    goldSideEffect: "broadcast",
    notes: "群发=广播；一次性动作 + 授权分离。",
  },

  // --- duplicate delivery idempotency (same messageId twice) ---------------
  {
    id: "ct-dup-01",
    category: "duplicate_idempotency",
    input: { messageId: "m-dup-777", text: "查一下本周新增用户数" },
    goldDetected: true,
    goldQualification: "short_action",
    goldSideEffect: "none",
    notes: "重复投递第一条；与 ct-dup-02 同 messageId。",
  },
  {
    id: "ct-dup-02",
    category: "duplicate_idempotency",
    input: { messageId: "m-dup-777", text: "查一下本周新增用户数" },
    goldDetected: true,
    goldQualification: "short_action",
    goldSideEffect: "none",
    notes: "重复投递第二条；决策必须与第一条完全一致，不产生重复任务/事件。",
  },

  // --- model completion self-claims (not facts) ----------------------------
  {
    id: "ct-claim-01",
    category: "model_completion_claim",
    input: { messageId: "m-claim-01", text: "这个任务我已经完成了" },
    goldDetected: false,
    goldQualification: "chat",
    goldSideEffect: "none",
    notes: "自述完成不是 Evidence；不写 Ledger、不改 Acceptance。",
  },
  {
    id: "ct-claim-02",
    category: "model_completion_claim",
    input: { messageId: "m-claim-02", text: "报告已经生成好并发出去了" },
    goldDetected: false,
    goldQualification: "chat",
    goldSideEffect: "none",
    notes: "自述完成+自述副作用，均不作为事实。",
  },

  // --- fuzzy / discardable (precision over recall) -------------------------
  {
    id: "ct-fuzzy-01",
    category: "fuzzy_negative",
    input: { messageId: "m-fuzzy-01", text: "这个竞品最近老是变价，你多留意一下" },
    goldDetected: true,
    goldQualification: "long_running_candidate",
    goldSideEffect: "none",
    goldSurvivesFirstRound: true,
    expectedDetectorMiss: true,
    notes: "真实上是隐含的持续监控（L2），但信号太弱；高精度检测器应当漏识别而非误升级。",
  },
  {
    id: "ct-fuzzy-02",
    category: "fuzzy_negative",
    input: { messageId: "m-fuzzy-02", text: "我以后想研究一下这个问题" },
    goldDetected: false,
    goldQualification: "chat",
    goldSideEffect: "none",
    notes: "只是想法/念头；Candidate 可丢弃，不得创建正式任务。",
  },
  {
    id: "ct-fuzzy-03",
    category: "fuzzy_negative",
    input: { messageId: "m-fuzzy-03", text: "有空帮我关注下行业动态" },
    goldDetected: false,
    goldQualification: "chat",
    goldSideEffect: "none",
    notes: "模糊、无持久状态/无验收；不升级。",
  },
];

/** Samples grouped by category. */
export function samplesByCategory(): Map<SampleCategory, ConversationTaskSample[]> {
  const map = new Map<SampleCategory, ConversationTaskSample[]>();
  for (const category of SAMPLE_CATEGORIES) {
    map.set(category, []);
  }
  for (const sample of CONVERSATION_TASK_SAMPLES) {
    map.get(sample.category)!.push(sample);
  }
  return map;
}
