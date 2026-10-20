/**
 * ConversationTask Runtime — deterministic strong-signal extractor (P1).
 *
 * Precision over recall: patterns fire only on clear, strong cues. Weak/vague
 * phrasing ("多留意一下", "关注下") is intentionally NOT a strong signal, so a
 * genuine-but-fuzzy L2 is missed rather than a false task minted (§6, §13).
 *
 * `analyzeTurn` returns the frozen 8 `TaskSignals` plus lexical cues and the
 * side-effect class. Cues are internal features for the qualifier; the frozen
 * contract surface remains the 8 signals. Pure and side-effect free.
 */

import { isModelCompletionClaim } from "./invariants.js";
import {
  emptyTaskSignals,
  type ConversationTurnInput,
  type SideEffectClass,
  type TaskSignals,
} from "./types.js";

function any(text: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((re) => re.test(text));
}

// --- future intent (excludes 今天/现在/本周/本月/昨天 = current or past) -------
const FUTURE_PATTERNS: readonly RegExp[] = [
  /明天|明早|明晚|后天|大后天/,
  /下周|下下周|下个?月|下季度/,
  /以后|今后|将来/,
  /每天|每周|每月|每晚|每早|每隔|定期|定时/,
  /(周|星期)[一二三四五六日天]/,
  /\d+\s*点|\d+:\d+/,
  /[一二三四五六七八九十两]+\s*点/,
  /月底|月末|年底|季度末|周末/,
  /接下来.{0,6}(天|周|个?月|季度)/,
];

// --- wait condition (concrete external/temporal gate, not a deferral) --------
const WAIT_PATTERNS: readonly RegExp[] = [
  /等[^,，。]{0,8}(回复|确认|通过|完成|同意|反馈|批准)/,
  /直到|一旦/,
  /如果[^,，。]{0,12}就/,
  /超过[^,，。]{0,6}阈值/,
  /异常时|异常就/,
  /每有[^,，。]{0,8}变化/,
  /连续.{0,4}(天|次)[^,，。]{0,6}(下降|上升|失败)/,
  /收到[^,，。]{0,8}后/,
];

// --- multiple stages ---------------------------------------------------------
const MULTI_STAGE_PATTERNS: readonly RegExp[] = [
  /并(通知|归档|记录|汇总|发|整理|预警|存档|推送)/,
  /(整理|汇总|统计|生成|监控|分析|跟踪)[^。]{0,12}(发|通知|归档|推送|预警)/,
  /汇总成|整理成/,
  /(先|首先)[^。]{0,16}(然后|接着|其次)[^。]{0,12}(发|通知|生成|统计|汇总|整理|归档|分析|记录)/,
];

// Explicit workflow labels / enumerated steps. High precision: a lone
// "先查再发" sequential is NOT enough — the user (or their prompt) must
// name the work as multi-step / multi-flow, or enumerate ≥2 steps.
const EXPLICIT_WORKFLOW_PATTERNS: readonly RegExp[] = [
  /多步骤|多流程|多个步骤|多个流程|多步任务|多流程任务/,
  /分步骤|分阶段|按步骤|按流程|走流程|走完流程|整个流程/,
  /分\s*[几两三四1-9]\s*步/,
  /\bmulti[- ]?(?:step|stage)s?\b/i,
];

const STEP_MARK_PATTERN = /第[一二三四五六七八九十1-9]\s*步|步骤\s*[一二三四五1-9]|step\s*[1-9]/gi;

// --- recurring intent --------------------------------------------------------
const RECURRING_PATTERNS: readonly RegExp[] = [
  /每天|每周|每月|每晚|每早|每隔|每次/,
  /定期|周期性|反复|循环/,
  /持续/,
];

// --- deliverable -------------------------------------------------------------
const DELIVERABLE_PATTERNS: readonly RegExp[] = [
  /日报|周报|月报|简报|报告|报表|总结|纪要|清单|方案|文档|表格/,
  /summary|report/i,
];

// --- explicit acceptance -----------------------------------------------------
const ACCEPTANCE_PATTERNS: readonly RegExp[] = [
  /验收|完成标准|成功标准|达标/,
  /(算|视为)完成|满足[^,，。]{0,8}条件/,
  /连续.{0,4}(天|次)[^,，。]{0,6}(下降|上升|失败)/,
];

// --- cross-turn dependency ---------------------------------------------------
const CROSS_TURN_PATTERNS: readonly RegExp[] = [
  /继续|接着|上面|之前|刚才|上次|改成|改为|换成|再加|加一个/,
];

// --- persistent state (must survive across runs) -----------------------------
// Persistent state = genuine cross-run EVALUATION state, not bare duration.
// Per spec §6, future time / recurrence / a bounded window alone are NOT
// sufficient for L2, so words like 持续 / 一直 / 接下来一个月 are deliberately
// excluded here (they feed future/recurring signals instead). Blind-test v1
// showed the old bare-duration patterns over-upgraded "接下来一个月每天发日报".
const PERSISTENT_PATTERNS: readonly RegExp[] = [
  /监控|监测|盯着|盯住/,
  /持续跟踪|跟踪[^。]{0,8}进度/,
  /超过[^，。]{0,6}阈值|异常时|异常就|异动/,
  /连续.{0,4}(天|次)[^，。]{0,8}(下降|上升|失败|走高|超时|未处理)/,
  /如果[^，。]{0,16}(预警|告警|升级)/,
  /等[^，。]{0,10}(回复|确认|通过|反馈|批准|签收|到港)/,
  /(到期|逾期|超时)[^，。]{0,6}(就|未处理|提醒|升级|催)/,
  /deadline|截止|在[^，。]{0,10}之前(完成|交付|提交)/,
];

// --- lexical cues (internal features) ---------------------------------------
const IMMEDIATE_ACTION_PATTERNS: readonly RegExp[] = [
  /查一下|查询|查查|看看|看一下|检查/,
  /算一下|算算|算出|计算/,
  /翻译|转换/,
  /搜索|找一下|找找/,
  /整理|同步|列出|列一下/,
];

const PRODUCE_SEND_PATTERNS: readonly RegExp[] = [
  /生成|制作|做一份|出一份|导出|跑一次/,
  /发送|发到|发给|发我|发一(条|封|份|下)|都发|群发|发布|推送/,
  /统计|汇总/,
];

const REMINDER_PATTERNS: readonly RegExp[] = [/提醒|别忘了|记得(?=.{0,6}提醒)|remind/i];

const MONITOR_PATTERNS: readonly RegExp[] = [
  /监控|监测/,
  /持续跟踪|跟踪[^。]{0,8}进度/,
  /盯着|盯住/,
  /\bmonitor\b|\bwatch\b/i,
];

const REVISION_PATTERNS: readonly RegExp[] = [
  /改成|改为|换成|调整为|改到/,
  /再加|加一个|加上|追加|补充一个/,
];

const CONTINUATION_PATTERNS: readonly RegExp[] = [/继续|接着|往下走|往下|接下去/];

const IMPERATIVE_PATTERNS: readonly RegExp[] = [
  /^\s*(帮我|帮忙|请|麻烦)/,
  /(生成|做|发|出|导出)一(下|份|条|封|次)/,
];

const GOAL_ACTION_PATTERNS: readonly RegExp[] = [/统计|分析|预警|汇总|评估|审核|计算|生成/];

function hasEnumeratedSteps(text: string): boolean {
  const marks = text.match(STEP_MARK_PATTERN);
  if (!marks || marks.length < 2) {
    return false;
  }
  const normalized = marks.map((m) => m.replace(/\s+/g, "").toLowerCase());
  return new Set(normalized).size >= 2;
}

export function isExplicitWorkflow(text: string): boolean {
  return any(text, EXPLICIT_WORKFLOW_PATTERNS) || hasEnumeratedSteps(text);
}

// --- side effects (broadcast > external write > outbound > none) -------------
const BROADCAST_PATTERNS: readonly RegExp[] = [
  /全部|全体|所有(人|销售|客户|同事)?|大家|群发|客户群|各(个|位)|广播|每个人/,
];
const EXTERNAL_WRITE_PATTERNS: readonly RegExp[] = [
  /同步到|写入|录入|更新到|存入|保存到|导入到/,
  /CRM|ERP|工单系统|数据库/i,
];
const OUTBOUND_MESSAGE_PATTERNS: readonly RegExp[] = [
  /发送|发到|发一(条|封|份)|发邮件|邮箱|推送|短信/,
];

export function classifySideEffect(text: string): SideEffectClass {
  if (any(text, BROADCAST_PATTERNS)) {
    return "broadcast";
  }
  if (any(text, EXTERNAL_WRITE_PATTERNS)) {
    return "external_write";
  }
  if (any(text, OUTBOUND_MESSAGE_PATTERNS)) {
    return "outbound_message";
  }
  return "none";
}

export function extractSignals(input: ConversationTurnInput): TaskSignals {
  const text = input.text;
  const hasCrossTurn = (input.priorTurns?.length ?? 0) > 0 || any(text, CROSS_TURN_PATTERNS);
  return {
    ...emptyTaskSignals(),
    hasFutureIntent: any(text, FUTURE_PATTERNS),
    hasWaitCondition: any(text, WAIT_PATTERNS),
    hasMultipleStages: any(text, MULTI_STAGE_PATTERNS) || isExplicitWorkflow(text),
    hasRecurringIntent: any(text, RECURRING_PATTERNS),
    hasDeliverable: any(text, DELIVERABLE_PATTERNS),
    hasCrossTurnDependency: hasCrossTurn,
    hasExplicitAcceptance: any(text, ACCEPTANCE_PATTERNS),
    hasPersistentState: any(text, PERSISTENT_PATTERNS),
  };
}

export type TurnFeatures = {
  signals: TaskSignals;
  sideEffect: SideEffectClass;
  leadImmediateAction: boolean;
  produceSendVerb: boolean;
  reminderIntent: boolean;
  monitorIntent: boolean;
  revisionIntent: boolean;
  continuationIntent: boolean;
  completionClaim: boolean;
  /** A concrete goal/action exists (not merely "continue" / a bare wait). */
  hasGoalOrAction: boolean;
  /** The turn is a fresh imperative request (distinguishes claims from asks). */
  imperativeRequest: boolean;
  /**
   * User or prompt language names the work as a multi-step / multi-flow plan.
   * Distinct from a one-run sequential ("先查再发").
   */
  explicitWorkflow: boolean;
};

export function analyzeTurn(input: ConversationTurnInput): TurnFeatures {
  const text = input.text;
  const signals = extractSignals(input);
  const leadImmediateAction = any(text, IMMEDIATE_ACTION_PATTERNS);
  const produceSendVerb = any(text, PRODUCE_SEND_PATTERNS);
  const monitorIntent = any(text, MONITOR_PATTERNS);
  const explicitWorkflow = isExplicitWorkflow(text);
  const hasContextForRevision =
    (input.priorTurns?.length ?? 0) > 0 || input.hasActiveTaskBinding === true;
  const revisionIntent = hasContextForRevision && any(text, REVISION_PATTERNS);
  const hasGoalOrAction =
    leadImmediateAction ||
    produceSendVerb ||
    monitorIntent ||
    signals.hasDeliverable ||
    signals.hasMultipleStages ||
    any(text, GOAL_ACTION_PATTERNS);
  return {
    signals,
    sideEffect: classifySideEffect(text),
    leadImmediateAction,
    produceSendVerb,
    reminderIntent: any(text, REMINDER_PATTERNS),
    monitorIntent,
    revisionIntent,
    continuationIntent: any(text, CONTINUATION_PATTERNS),
    completionClaim: isModelCompletionClaim(text),
    hasGoalOrAction,
    imperativeRequest: leadImmediateAction || any(text, IMPERATIVE_PATTERNS),
    explicitWorkflow,
  };
}
