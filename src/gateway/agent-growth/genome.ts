import { confirmationTierLines } from "../../agents/confirmation-tiers.js";

/**
 * AgentGenome — 人格与认知的「组合读模型」（件事三 · 决策见
 * docs/design/openbot-evolution-roadmap-alignment-2026-07-12.md §4）。
 *
 * 立项判断：AgentGenome 作为一等对象，但**不是新真相源**——
 *  - identity 真相在 SOUL/IDENTITY 文件与 systemInstructions；
 *  - habits 真相在 GrowthStatus.dimensions.habits；
 *  - learned principles 真相在 AgentLearningAsset（packages/collaboration-core）。
 * 若新建独立存储会与三者重复并产生一致性问题，故 Genome 由 `composeAgentGenome()` 组合上述来源。
 *
 * 唯一**新增**的真相是 `workingStyle`（Working DNA：输出格式 / 汇报节奏 / 决策 / 风险 / 沟通偏好），
 * 这是路线图 Phase 2「行为改变」当前无载体的部分——写入点收敛到此。
 *
 * 本文件是脚手架：纯类型 + 纯组合器 / 应用器，无 I/O、无持久化、暂不接线。
 */

/** 输出格式偏好。 */
export type OutputFormatPreference = "concise" | "detailed" | "structured" | "conversational";
/** 汇报节奏。 */
export type ReportingCadence = "on_completion" | "milestone" | "periodic" | "on_request";
/** 决策偏好。 */
export type DecisionPreference = "autonomous" | "confirm_first" | "escalate";
/** 风险偏好。 */
export type RiskPreference = "conservative" | "balanced" | "aggressive";
/** 沟通语气。 */
export type CommunicationTone = "formal" | "neutral" | "friendly";

/** Working DNA：工作习惯偏好（Phase 2「行为改变」的写入载体）。 */
export interface WorkingStyle {
  outputFormat: OutputFormatPreference;
  reportingCadence: ReportingCadence;
  decisionPreference: DecisionPreference;
  riskPreference: RiskPreference;
  communicationTone: CommunicationTone;
}

/** 身份快照：仅摘要引用 SOUL/IDENTITY 的真相，不复制其内容。 */
export interface GenomeIdentitySnapshot {
  displayName?: string;
  role?: string;
  templateId?: string | null;
}

/**
 * AgentGenome：组合读模型。identity / habits / learningAssetIds 均为对既有真相的引用或快照，
 * 仅 workingStyle 为新增真相。
 */
export interface AgentGenome {
  agentId: string;
  identity: GenomeIdentitySnapshot;
  /** GrowthStatus.dimensions.habits 快照（0–100），便于展示，不重复存储。 */
  habitsScore: number;
  workingStyle: WorkingStyle;
  /** 引用（不内联）已习得的 AgentLearningAsset id。 */
  learningAssetIds: string[];
  composedAtMs: number;
}

/** 默认 Working DNA（安全默认：两档确认、风险平衡、结构化输出）。 */
export const DEFAULT_WORKING_STYLE: WorkingStyle = {
  outputFormat: "structured",
  reportingCadence: "on_completion",
  decisionPreference: "confirm_first",
  riskPreference: "balanced",
  communicationTone: "neutral",
};

export interface ComposeAgentGenomeInput {
  agentId: string;
  identity?: GenomeIdentitySnapshot;
  /** 来自 GrowthStatus.dimensions.habits。 */
  habitsScore?: number;
  /** 已学习到的工作习惯偏差（覆盖默认值）。 */
  workingStyle?: Partial<WorkingStyle>;
  /** 已习得学习资产的 id 引用。 */
  learningAssetIds?: string[];
  nowMs?: number;
}

function clamp0to100(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, value));
}

function dedupe(ids: Iterable<string>): string[] {
  const seen = new Set<string>();
  for (const id of ids) {
    if (typeof id === "string" && id.trim().length > 0) {
      seen.add(id.trim());
    }
  }
  return [...seen];
}

/** 组合 AgentGenome：聚合既有真相 + 应用已学习的 workingStyle 偏差（覆盖默认）。 */
export function composeAgentGenome(input: ComposeAgentGenomeInput): AgentGenome {
  return {
    agentId: input.agentId,
    identity: input.identity ?? {},
    habitsScore: clamp0to100(input.habitsScore ?? 0),
    workingStyle: { ...DEFAULT_WORKING_STYLE, ...input.workingStyle },
    learningAssetIds: dedupe(input.learningAssetIds ?? []),
    composedAtMs: input.nowMs ?? Date.now(),
  };
}

/**
 * 应用一次 Working DNA 偏差（Phase 2「行为改变」的写入原语）。
 * 纯合并：仅覆盖 delta 中出现的字段，其余保持不变。
 */
export function applyWorkingStyleDelta(
  current: WorkingStyle,
  delta: Partial<WorkingStyle>,
): WorkingStyle {
  return { ...current, ...delta };
}

/**
 * 把 Working DNA 渲染为可注入系统提示词的简短指令（Phase 2「行为改变」生效于对话）。
 * `riskPreference:"balanced"` 与 `communicationTone:"neutral"` 为中性默认，不产出指令（控噪）。
 * 无任何指令 → 返回空串（调用方据此跳过注入）。
 */
export function renderWorkingStyleInstructions(style: WorkingStyle): string {
  const lines: string[] = [];
  switch (style.outputFormat) {
    case "concise":
      lines.push("Keep replies concise and to the point.");
      break;
    case "detailed":
      lines.push("Provide detailed, thorough replies.");
      break;
    case "structured":
      lines.push("Structure replies clearly with headings or lists where useful.");
      break;
    case "conversational":
      lines.push("Keep a natural, conversational tone.");
      break;
  }
  switch (style.reportingCadence) {
    case "on_completion":
      lines.push("Report back when a task completes.");
      break;
    case "milestone":
      lines.push("Report progress at meaningful milestones.");
      break;
    case "periodic":
      lines.push("Give periodic progress updates.");
      break;
    case "on_request":
      lines.push("Share progress only when asked.");
      break;
  }
  switch (style.decisionPreference) {
    case "autonomous":
      lines.push(
        "Act on already-clear internal steps without asking. The must-ask tier still requires confirmation.",
      );
      lines.push(...confirmationTierLines());
      break;
    case "confirm_first":
      lines.push(...confirmationTierLines());
      break;
    case "escalate":
      lines.push("Escalate the must-ask tier to a human before acting.");
      lines.push(...confirmationTierLines());
      break;
  }
  if (style.riskPreference === "conservative") {
    lines.push("Prefer conservative, low-risk approaches.");
  } else if (style.riskPreference === "aggressive") {
    lines.push("Favor bold, fast approaches when the downside is limited.");
  }
  if (style.communicationTone === "formal") {
    lines.push("Use a formal, professional tone.");
  } else if (style.communicationTone === "friendly") {
    lines.push("Use a warm, friendly tone.");
  }
  if (lines.length === 0) {
    return "";
  }
  return [
    "Apply your learned working style (adapted from past task outcomes):",
    ...lines.map((line) => `- ${line}`),
  ].join("\n");
}

/**
 * 运营信号子集（结构化入参，避免 genome.ts 依赖 operational-score 模块）。
 * 字段允许 null（与 OperationalScoreSignals 契约一致）；下方 `typeof === "number"` 守卫会正确排除 null。
 */
export type OperationalSignalsForStyle = {
  taskSuccessRate?: number | null;
  toolSuccessRate?: number | null;
  satisfaction?: number | null;
  humanTakeoverRate?: number | null;
  /** 累计任务样本数；低于门槛时不产生任何 Working DNA 变更。 */
  tasksTotal?: number | null;
};

/** 允许任意 Working DNA 学习写入的最小任务样本数。 */
export const WORKING_STYLE_MIN_SAMPLES_LEARNING = 5;
/** 提升为 autonomous 的更高门槛（防单次偶然成功固化权限）。 */
export const WORKING_STYLE_MIN_SAMPLES_AUTONOMOUS = 10;

export type WorkingStyleEvidenceGate = {
  tasksTotal: number;
  minSamplesForLearning: number;
  minSamplesForAutonomous: number;
  learningEligible: boolean;
  autonomousEligible: boolean;
};

export function describeWorkingStyleEvidenceGate(
  signals: OperationalSignalsForStyle,
): WorkingStyleEvidenceGate {
  const tasksTotal =
    typeof signals.tasksTotal === "number" && Number.isFinite(signals.tasksTotal)
      ? Math.max(0, Math.floor(signals.tasksTotal))
      : 0;
  return {
    tasksTotal,
    minSamplesForLearning: WORKING_STYLE_MIN_SAMPLES_LEARNING,
    minSamplesForAutonomous: WORKING_STYLE_MIN_SAMPLES_AUTONOMOUS,
    learningEligible: tasksTotal >= WORKING_STYLE_MIN_SAMPLES_LEARNING,
    autonomousEligible: tasksTotal >= WORKING_STYLE_MIN_SAMPLES_AUTONOMOUS,
  };
}

/**
 * 从运营信号确定性派生 Working DNA 变更（Phase 2「行为改变」的信号→行为映射）。
 * 只返回需要变更的字段（空对象表示不变），规则保守且可解释：
 *  - tasksTotal < MIN_SAMPLES_LEARNING → 不变（样本不足，禁止首次学习）。
 *  - 高人工接管率(≥0.5) + 足够样本 → conservative + confirm_first。
 *    confirm_first 渲染为两档（必须问 / 不必问），不是更常发问。
 *  - 低接管(≤0.1) 且 高任务成功率(≥0.9) + tasksTotal ≥ MIN_SAMPLES_AUTONOMOUS → autonomous。
 *  - 低任务成功率(<0.5) + 足够样本 → conservative。
 */
export function deriveWorkingStyleDelta(
  signals: OperationalSignalsForStyle,
): Partial<WorkingStyle> {
  const gate = describeWorkingStyleEvidenceGate(signals);
  if (!gate.learningEligible) {
    return {};
  }

  const delta: Partial<WorkingStyle> = {};
  const takeover = signals.humanTakeoverRate;
  const success = signals.taskSuccessRate;

  if (typeof takeover === "number" && takeover >= 0.5) {
    delta.riskPreference = "conservative";
    delta.decisionPreference = "confirm_first";
  } else if (
    gate.autonomousEligible &&
    typeof takeover === "number" &&
    takeover <= 0.1 &&
    typeof success === "number" &&
    success >= 0.9
  ) {
    delta.decisionPreference = "autonomous";
  }

  if (typeof success === "number" && success < 0.5) {
    delta.riskPreference = "conservative";
  }

  return delta;
}

/** 两个 Working DNA 变更 delta 是否等价（相同键集 + 相同值）。用于回滚后的振荡抑制。纯函数。 */
export function sameWorkingStyleDelta(a: Partial<WorkingStyle>, b: Partial<WorkingStyle>): boolean {
  const keys: Array<keyof WorkingStyle> = [
    "outputFormat",
    "reportingCadence",
    "decisionPreference",
    "riskPreference",
    "communicationTone",
  ];
  return keys.every((key) => a[key] === b[key]);
}

/** 二阶反馈：一次 Working DNA 变更后的实战表现走向。 */
export type WorkingStyleEffectStatus = "improved" | "regressed" | "inconclusive";

/**
 * 二阶反馈评估：对比"变更时的基线 operationalScore"与"当前 operationalScore"，判断行为改变是否
 * 真的提升了实战表现。任一分缺失或变化幅度小于 `minDelta`（默认 5，滤噪）→ inconclusive。纯函数。
 */
export function evaluateWorkingStyleEffect(
  baseline: number | null | undefined,
  current: number | null | undefined,
  opts?: { minDelta?: number },
): { status: WorkingStyleEffectStatus; deltaScore: number | null } {
  const minDelta = opts?.minDelta ?? 5;
  if (typeof baseline !== "number" || typeof current !== "number") {
    return { status: "inconclusive", deltaScore: null };
  }
  const deltaScore = current - baseline;
  if (Math.abs(deltaScore) < minDelta) {
    return { status: "inconclusive", deltaScore };
  }
  return { status: deltaScore > 0 ? "improved" : "regressed", deltaScore };
}
