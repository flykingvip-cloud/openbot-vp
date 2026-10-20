import type { DataPlaneCase } from "./diagnose-data-plane-cases.js";
import type { EvolutionPrescription } from "./diagnose-evolution-prescription.js";
import {
  DIAGNOSIS_EVOLUTION_PRODUCER,
  produceDiagnoseEvolutionArtifacts,
  type DiagnoseEvolutionProducerOutput,
} from "./diagnose-evolution-producer.js";
import type { GroupMemberExpandResult } from "./diagnose-group-member-expand.js";
/**
 * User-visible diagnose report text. Single write point for Path A inject
 * and Path B tool results. Redacted summaries only — no evidence payloads,
 * chat bodies, or tool/sandbox traces.
 */
import type { DiagnoseGrowthAssessment } from "./diagnose-growth-assessment.js";
import { DIAGNOSE_GROWTH_UNOBSERVED } from "./diagnose-growth-assessment.js";
import {
  buildDiagnoseConversationActions,
  type DiagnoseConversationAction,
} from "./diagnose-next-actions.js";
import { extractDiagnoseSpaceGroupId } from "./diagnose-policy.js";
import {
  BOOTSTRAP_COMPLETE_TEXT,
  BOOTSTRAP_PENDING_TEXT,
  DIAGNOSIS_ZERO_FINDINGS_TEXT,
  GROWTH_LOCATOR_LIMITATION,
  NEXT_ACTION_GATE_TEXT,
  NO_ACTIVITY_MEMORY_TEXT,
  NO_INSTALLED_SKILLS_TEXT,
  ROLE_BASELINE_NOT_INJECTED_TEXT,
  professionalReportId,
} from "./diagnose-professional-protocol.js";
import {
  DATA_PLANE_LOCATOR_FAILED_TEXT,
  DATA_PLANE_EVIDENCE_SLO_TEXT,
  DATA_PLANE_MEMBER_EXPAND_EMPTY_TEXT,
} from "./diagnose-professional-protocol.js";
import type { SkillInstallationPreviewFact } from "./skill-installation-candidate.js";
import type { StructuralPreviewFact } from "./structural-evolution-candidate.js";

const COMPLETION_ZH: Record<string, string> = {
  CONFIRMED: "已确认",
  PROBABLE: "较可能",
  SUSPECTED: "疑似",
  INCONCLUSIVE: "证据不足",
  BLOCKED: "受阻",
  TIMED_OUT: "超时",
};

export type DiagnoseReportTextInput = {
  completion: string;
  findingCount: number;
  findings: Array<{ findingId: string; severity: string; status: string; code?: string }>;
  windowId: string;
  mode: string;
  scope: string;
  scanned: number;
  skipped: number;
  reportId: string | null;
  reportIds: string[];
  reason?: string;
  locators?: Array<{ agentId: string; sessionKey: string }>;
  growths?: DiagnoseGrowthAssessment[];
  prescriptions?: EvolutionPrescription[];
  structuralFacts?: StructuralPreviewFact[];
  skillInstallationFacts?: SkillInstallationPreviewFact[];
  tenantId?: string | null;
  /** Track D / M1 structured cases (not limitations prose). */
  dataPlaneCases?: DataPlaneCase[];
  groupMemberExpand?: GroupMemberExpandResult[];
};

export type ProfessionalDiagnosisSubject = {
  agentId: string;
  agentAssetId: string | null;
  groupId: string | null;
  displayName: string;
};

export type ProfessionalDiagnosisReport = {
  schemaVersion: 1;
  professionalReportId: string;
  sourceReportIds: string[];
  tenantId: string | null;
  subject: ProfessionalDiagnosisSubject[];
  runtimeAssessment: {
    completion: string;
    findingCount: number;
    scanned: number;
    skipped: number;
    findings: DiagnoseReportTextInput["findings"];
  };
  growthAssessment: DiagnoseGrowthAssessment[];
  capabilityAssessment: Array<{
    objectLabel: string;
    evidencedSuccess: string[];
    evidencedUnstable: string[];
    installedUnobserved: string[];
    baselineGapCandidates: string[];
  }>;
  prescriptions: EvolutionPrescription[];
  nextActions: DiagnoseConversationAction[];
  producer: DiagnoseEvolutionProducerOutput;
  limitations: string[];
  /** Structured Track D cases for Track I (never limitations-only). */
  dataPlaneCases?: DataPlaneCase[];
  /** Group → member 1:1 expand rows (A-class Rx prerequisite). */
  groupMemberExpand?: GroupMemberExpandResult[];
  trace: { windowId: string; mode: string; scope: string };
};

export function buildProfessionalDiagnosisReport(
  payload: DiagnoseReportTextInput,
): ProfessionalDiagnosisReport {
  const growths = payload.growths ?? [];
  const sourceReportIds = payload.reportIds.length > 0 ? [...payload.reportIds] : [];
  const subjects = subjectList(payload, growths);
  const locatorMissing = growths.length === 0 || growths.some((row) => !row.agentAssetId);
  const limitations = locatorMissing ? [GROWTH_LOCATOR_LIMITATION] : [];
  const professionalReportIdValue = professionalReportId({
    tenantId: payload.tenantId ?? growths.find((row) => row.tenantId)?.tenantId ?? null,
    sourceReportIds,
    windowId: payload.windowId,
    mode: payload.mode,
  });
  const draft: ProfessionalDiagnosisReport = {
    schemaVersion: 1,
    professionalReportId: professionalReportIdValue,
    sourceReportIds,
    tenantId: payload.tenantId ?? growths.find((row) => row.tenantId)?.tenantId ?? null,
    subject: subjects,
    runtimeAssessment: {
      completion: payload.completion,
      findingCount: payload.findingCount,
      scanned: payload.scanned,
      skipped: payload.skipped,
      findings: payload.findings ?? [],
    },
    growthAssessment: growths,
    capabilityAssessment: growths.map((row) => ({
      objectLabel: row.objectLabel,
      evidencedSuccess: row.capable,
      evidencedUnstable: row.unstable,
      installedUnobserved: row.unused,
      baselineGapCandidates: row.baselineGapCandidates ?? [],
    })),
    prescriptions: payload.prescriptions ?? [],
    nextActions: buildDiagnoseConversationActions(growths),
    producer: {
      producer: DIAGNOSIS_EVOLUTION_PRODUCER,
      evidence: [],
      candidates: [],
      structuralCandidates: [],
      skillInstallationCandidates: [],
    },
    limitations,
    ...(payload.dataPlaneCases && payload.dataPlaneCases.length > 0
      ? { dataPlaneCases: payload.dataPlaneCases }
      : {}),
    ...(payload.groupMemberExpand && payload.groupMemberExpand.length > 0
      ? { groupMemberExpand: payload.groupMemberExpand }
      : {}),
    trace: { windowId: payload.windowId, mode: payload.mode, scope: payload.scope },
  };
  return {
    ...draft,
    producer: produceDiagnoseEvolutionArtifacts({
      ...draft,
      structuralFacts: payload.structuralFacts,
      skillInstallationFacts: payload.skillInstallationFacts,
    }),
  };
}

export function formatDiagnoseReportText(payload: DiagnoseReportTextInput): string {
  return formatProfessionalDiagnosisReport(buildProfessionalDiagnosisReport(payload));
}

export function formatProfessionalDiagnosisReport(report: ProfessionalDiagnosisReport): string {
  const growths = report.growthAssessment;
  const prescriptions = report.prescriptions;
  const blocks = [
    ["【诊断报告】"],
    [
      "一、结论与窗口",
      `对象：${report.subject.map((row) => row.displayName).join("、") || "当前对象"}`,
      `窗口：${report.trace.windowId} · 模式：${report.trace.mode}`,
      `运行结论：${COMPLETION_ZH[report.runtimeAssessment.completion] ?? report.runtimeAssessment.completion}`,
      `成长结论：${growthConclusion(growths)}`,
      `已扫 ${report.runtimeAssessment.scanned} · 跳过 ${report.runtimeAssessment.skipped} · 发现 ${report.runtimeAssessment.findingCount}`,
      `综述：${executiveSummary(report, growths)}`,
    ],
    ["二、运行现状", ...runtimeSection(report, growths)],
    ["三、特征属性", ...identitySection(growths)],
    ["四、任务质量与能力地图", ...capabilitySection(report, growths)],
    ["五、技能、工具与流程", ...skillSection(report, growths)],
    ["六、自我管理处方", ...prescriptionSection(prescriptions)],
    ["七、结构性进化候选", ...structuralCandidateSection(report)],
    ["八、追溯", ...traceSection(report, prescriptions)],
    ["九、可执行建议", ...nextActionSection(report.nextActions)],
  ];
  return blocks.map((block) => block.filter((line) => line !== undefined).join("\n")).join("\n\n");
}

function subjectList(
  payload: DiagnoseReportTextInput,
  growths: DiagnoseGrowthAssessment[],
): ProfessionalDiagnosisSubject[] {
  if (growths.length > 0) {
    return growths.map((row) => ({
      agentId: row.agentId,
      agentAssetId: row.agentAssetId,
      groupId: row.groupId,
      displayName: row.displayName ?? (row.groupId ? `协作小组 ${row.groupId}` : row.objectLabel),
    }));
  }
  if (payload.locators && payload.locators.length > 0) {
    const seen = new Set<string>();
    const subjects: ProfessionalDiagnosisSubject[] = [];
    for (const row of payload.locators) {
      const groupId = extractDiagnoseSpaceGroupId(row.sessionKey);
      const displayName = groupId ? `协作小组 ${groupId}` : row.agentId;
      if (seen.has(displayName)) {
        continue;
      }
      seen.add(displayName);
      subjects.push({
        agentId: row.agentId,
        agentAssetId: null,
        groupId,
        displayName,
      });
    }
    return subjects;
  }
  return [
    {
      agentId: "",
      agentAssetId: null,
      groupId: null,
      displayName: payload.scope === "all" ? "名册（封顶部分）" : "当前对象",
    },
  ];
}

function executiveSummary(
  report: ProfessionalDiagnosisReport,
  growths: DiagnoseGrowthAssessment[],
): string {
  const runtime =
    COMPLETION_ZH[report.runtimeAssessment.completion] ?? report.runtimeAssessment.completion;
  if (growths.length === 0) {
    return `运行面${runtime}；成长面未评估。`;
  }
  const bits = [`运行面${runtime}`];
  const identityGap = growths.some(
    (row) =>
      !row.identity.readable ||
      row.identity.bootstrapPending ||
      !row.identity.identityInitialized ||
      !row.identity.userInitialized,
  );
  if (identityGap) {
    bits.push("身份或主人字段未齐");
  }
  if (growths.some((row) => row.memoryJudgedMissing)) {
    bits.push("记忆缺失需补写");
  } else if (growths.some((row) => row.memory.fresh)) {
    bits.push("近窗有记忆或产出落盘");
  }
  const identityConfirmed = growths.every(
    (row) => row.identity.identityInitialized && row.identity.userInitialized,
  );
  if (!identityGap && identityConfirmed && growths.length > 0) {
    bits.push("身份与主人字段已确认");
  }
  const unused = uniqueIds(growths.flatMap((row) => row.unused));
  if (unused.length > 0) {
    bits.push(`已装未观察：${unused.join("、")}`);
  }
  const readable = growths.filter((row) => row.identity.readable);
  if (readable.length > 0 && readable.every((row) => (row.installedSkillIds ?? []).length === 0)) {
    bits.push("工作区未安装技能");
  } else if (growths.some((row) => !row.identity.readable)) {
    bits.push("工作区不可读，成长事实受限");
  }
  return `${bits.join("；")}。`;
}

function uniqueIds(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function growthConclusion(growths: DiagnoseGrowthAssessment[]): string {
  if (growths.length === 0) {
    return "成长面未评估";
  }
  const identityGap = growths.some(
    (row) =>
      !row.identity.readable ||
      row.identity.bootstrapPending ||
      !row.identity.identityInitialized ||
      !row.identity.userInitialized,
  );
  const memoryGap = growths.some((row) => row.memoryJudgedMissing);
  const unused = growths.some((row) => row.unused.length > 0);
  const skillGap = growths.some((row) => (row.baselineGapCandidates ?? []).length > 0);
  if (identityGap || memoryGap) {
    return "特征或记忆未齐";
  }
  if (unused) {
    return "能力地图有已装未观察";
  }
  if (skillGap) {
    return "能力地图有缺口候选";
  }
  return "已评估，本窗未见特征缺口";
}

function runtimeSection(
  report: ProfessionalDiagnosisReport,
  growths: DiagnoseGrowthAssessment[],
): string[] {
  const findings = report.runtimeAssessment.findings.slice(0, 8);
  const lines = [
    findings.length === 0
      ? DIAGNOSIS_ZERO_FINDINGS_TEXT
      : findings
          .map((finding) => {
            const code = finding.code?.trim() || finding.findingId;
            return `- ${finding.severity} ${finding.status} ${code}`;
          })
          .join("\n"),
  ];
  if (findings.some((finding) => finding.code === "locator_failed")) {
    lines.unshift(DATA_PLANE_LOCATOR_FAILED_TEXT);
  }
  if (findings.some((finding) => (finding.code ?? "").startsWith("evidence_slo_"))) {
    lines.unshift(DATA_PLANE_EVIDENCE_SLO_TEXT);
  }
  for (const expand of report.groupMemberExpand ?? []) {
    if (expand.emptyReason) {
      lines.push(
        expand.emptyReason === "无成员绑定"
          ? DATA_PLANE_MEMBER_EXPAND_EMPTY_TEXT
          : `成员展开：${expand.emptyReason}`,
      );
    } else {
      lines.push(`成员展开：${expand.members.length} 人`);
      for (const row of expand.members.slice(0, 12)) {
        const key = row.sessionKey1to1 ?? "无1:1会话";
        lines.push(`- ${row.memberKind} ${row.userId} → ${key}`);
      }
    }
  }
  for (const growth of growths) {
    const roster = growth.sessionRoster ?? {
      main: 0,
      cron: 0,
      other: 0,
      freshCron: 0,
      freshMain: 0,
    };
    const sources =
      (growth.activitySources ?? []).length > 0
        ? growth.activitySources.join("、")
        : "无近窗活动源";
    if (growths.length > 1) {
      lines.push(growth.objectLabel);
    }
    lines.push(
      "扫描范围",
      `主会话：${roster.main}（近窗 ${roster.freshMain}）`,
      `cron：${roster.cron}（近窗 ${roster.freshCron}）`,
      `技能事件源：${growth.activitySources.includes("skill_invocation") ? "有" : "无"}`,
      `近窗产出：${growth.freshArtifactCount}`,
      `活动源：${sources}`,
    );
  }
  return lines;
}

function identitySection(growths: DiagnoseGrowthAssessment[]): string[] {
  if (growths.length === 0) {
    return [DIAGNOSE_GROWTH_UNOBSERVED];
  }
  return growths.flatMap((row, index) => {
    const identityLabel = row.identity.identityInitialized
      ? "IDENTITY 已确认"
      : (row.identityMissingFields ?? []).length > 0
        ? `IDENTITY 未确认（缺 ${row.identityMissingFields.join("、")}）`
        : "IDENTITY 未确认";
    const userLabel = row.identity.userInitialized
      ? "USER 已确认"
      : (row.userMissingFields ?? []).length > 0
        ? `USER 未确认（缺 ${row.userMissingFields.join("、")}）`
        : "USER 未确认";
    const memory = memoryLine(row);
    const lines = [
      ...(growths.length > 1 ? [row.objectLabel] : []),
      row.identity.readable ? "工作区：可读" : "工作区：不可读",
      row.identity.bootstrapPending ? BOOTSTRAP_PENDING_TEXT : BOOTSTRAP_COMPLETE_TEXT,
      identityLabel,
      userLabel,
      memory.startsWith("记忆") ? memory : `记忆：${memory}`,
    ];
    if (index < growths.length - 1) {
      lines.push("");
    }
    return lines;
  });
}

function memoryLine(row: DiagnoseGrowthAssessment): string {
  if (row.memoryJudgedMissing) {
    return "记忆缺失（本窗有任务活动且文件未更新）";
  }
  if (row.memory.fresh) {
    return `记忆近窗有落盘（${row.memoryFileCount} 份，近窗产出 ${row.freshArtifactCount}）`;
  }
  if (row.memory.present) {
    return `有历史记忆 ${row.memoryFileCount} 份，本窗未更新`;
  }
  if (row.hadTaskActivity) {
    return "记忆文件已过窗";
  }
  return NO_ACTIVITY_MEMORY_TEXT;
}

function capabilitySection(
  report: ProfessionalDiagnosisReport,
  growths: DiagnoseGrowthAssessment[],
): string[] {
  if (report.capabilityAssessment.length === 0) {
    return [DIAGNOSE_GROWTH_UNOBSERVED];
  }
  return report.capabilityAssessment.flatMap((row, index) => {
    const growth = growths.find((item) => item.objectLabel === row.objectLabel);
    const lines = [
      ...(report.capabilityAssessment.length > 1 ? [row.objectLabel] : []),
      `有成功证据：${joinOrUnobserved(row.evidencedSuccess)}`,
      `有不稳定证据：${joinOrUnobserved(row.evidencedUnstable)}`,
      `已安装但本窗未观察到使用：${installedLine(row.installedUnobserved, growth)}`,
      `预期能力缺口候选：${baselineLine(row.baselineGapCandidates, growth)}`,
    ];
    if (index < report.capabilityAssessment.length - 1) {
      lines.push("");
    }
    return lines;
  });
}

function installedLine(values: string[], growth?: DiagnoseGrowthAssessment): string {
  if (values.length > 0) {
    return values.map((id) => unusedSkillLabel(id, growth)).join("、");
  }
  if ((growth?.installedSkillIds.length ?? 0) === 0) {
    return NO_INSTALLED_SKILLS_TEXT;
  }
  return "本窗均有观察";
}

function baselineLine(values: string[], growth?: DiagnoseGrowthAssessment): string {
  if (values.length > 0) {
    return values.join("、");
  }
  if (!growth?.roleBaselineInjected) {
    return ROLE_BASELINE_NOT_INJECTED_TEXT;
  }
  return "本窗未见角色基线缺口";
}

function skillSection(
  report: ProfessionalDiagnosisReport,
  growths: DiagnoseGrowthAssessment[],
): string[] {
  const lines: string[] = [];
  for (const growth of growths) {
    const prefix = growths.length > 1 ? `${growth.objectLabel} ` : "";
    if (growth.unstable.length > 0) {
      lines.push(`${prefix}失败或超时统计：${growth.unstable.join("、")}`);
    }
    if ((growth.installedSkillIds ?? []).length > 0) {
      lines.push(`${prefix}已安装技能：${growth.installedSkillIds.join("、")}`);
    } else if (growth.identity.readable) {
      lines.push(`${prefix}${NO_INSTALLED_SKILLS_TEXT}`);
    }
  }
  for (const finding of report.runtimeAssessment.findings.slice(0, 8)) {
    const code = finding.code?.trim() || finding.findingId;
    lines.push(`运行码：${finding.severity} ${code}`);
  }
  return lines.length > 0 ? lines : [DIAGNOSE_GROWTH_UNOBSERVED];
}

function prescriptionSection(prescriptions: EvolutionPrescription[]): string[] {
  if (prescriptions.length === 0) {
    return ["自我管理处方是 cron 任务，不修改心跳配置。", DIAGNOSE_GROWTH_UNOBSERVED];
  }
  const primary = prescriptions[0];
  const primaryState = primary ? (PRESCRIPTION_STATE_ZH[primary.state] ?? primary.state) : "";
  return [
    "自我管理处方是 cron 任务，不修改心跳配置。",
    ...(primary ? [`优先处理：${primary.purposeLabel}（${primaryState}）`] : []),
    ...prescriptions.flatMap((row, index) => {
      const state = PRESCRIPTION_STATE_ZH[row.state] ?? row.state;
      const lines = [
        ...(index > 0 || prescriptions.length > 1 ? [row.purposeLabel] : []),
        `处方编号 ${row.prescriptionId} · ${row.kind} · ${row.purposeLabel} · ${row.cadenceLabel} · 预期：${row.expectedEffect} · ${state}`,
        `类型：${row.kind}`,
        `节奏：${row.cadenceLabel}`,
        `预期：${row.expectedEffect}`,
        `状态：${state}`,
      ];
      if (index < prescriptions.length - 1) {
        lines.push("");
      }
      return lines;
    }),
  ];
}

function structuralCandidateSection(report: ProfessionalDiagnosisReport): string[] {
  const rows = report.producer.structuralCandidates;
  const skillRows = report.producer.skillInstallationCandidates;
  if (rows.length === 0 && skillRows.length === 0) {
    return ["preview only", "未提交统一控制面", "普通诊断默认不生成结构性候选。"];
  }
  return [
    "preview only",
    "未提交",
    "需确认后提交统一控制面",
    ...rows.flatMap((row, index) => {
      const lines = [
        ...(rows.length + skillRows.length > 1 ? [`候选 ${index + 1}`] : []),
        `意图：${row.structuralIntent}`,
        `变更：${row.proposedChange.field}=${row.proposedChange.value}`,
        `机制：${row.mechanismRef}`,
        `基线：${row.baselineHash}`,
        `版本：${row.candidateVersion}`,
        "状态：preview only · 未提交 · 需确认后提交统一控制面",
      ];
      if (index < rows.length - 1 || skillRows.length > 0) {
        lines.push("");
      }
      return lines;
    }),
    ...skillRows.flatMap((row, index) => {
      const lines = [
        ...(rows.length + skillRows.length > 1 ? [`候选 ${rows.length + index + 1}`] : []),
        `意图：${row.structuralIntent}`,
        `变更：install ${row.proposedChange.skillId}`,
        `机制：${row.mechanismRef}`,
        `基线：${row.baselineHash}`,
        `版本：${row.candidateVersion}`,
        "状态：preview only · 未提交 · 需确认后提交统一控制面",
      ];
      if (index < skillRows.length - 1) {
        lines.push("");
      }
      return lines;
    }),
  ];
}

function traceSection(
  report: ProfessionalDiagnosisReport,
  prescriptions: EvolutionPrescription[],
): string[] {
  const lines = [
    report.sourceReportIds.length > 0 ? `报告：${report.sourceReportIds.join("、")}` : "报告：无",
    `专业报告：${report.professionalReportId}`,
    prescriptions.length > 0
      ? `处方：${prescriptions.map((row) => row.prescriptionId).join("、")}`
      : "处方：无",
  ];
  if (report.producer.evidence.length > 0) {
    lines.push(`证据：${report.producer.evidence.map((row) => row.evidenceRef).join("、")}`);
  }
  if (report.producer.structuralCandidates.length > 0) {
    lines.push(
      `结构性候选预览：${report.producer.structuralCandidates.map((row) => row.candidateVersion).join("、")}`,
    );
  }
  if (report.producer.skillInstallationCandidates.length > 0) {
    lines.push(
      `技能安装候选预览：${report.producer.skillInstallationCandidates.map((row) => row.candidateVersion).join("、")}`,
    );
  }
  if ((report.dataPlaneCases?.length ?? 0) > 0) {
    lines.push(
      `数据面Case：${report.dataPlaneCases!.map((row) => `${row.caseKind}:${row.status}`).join("、")}`,
    );
  }
  if (report.limitations.length > 0) {
    lines.push(...report.limitations);
  }
  return lines;
}

function unusedSkillLabel(id: string, growth?: DiagnoseGrowthAssessment): string {
  const lastSeen = growth?.skillLastSeenMs?.[id];
  if (!lastSeen) {
    return `${id}（从未观察到调用）`;
  }
  return `${id}（上次观察 ${new Date(lastSeen).toISOString().slice(0, 10)}，在窗外）`;
}

function nextActionSection(actions: DiagnoseConversationAction[]): string[] {
  if (actions.length === 0) {
    return [NEXT_ACTION_GATE_TEXT, "本窗没有需要对话修复的项。"];
  }
  return [
    NEXT_ACTION_GATE_TEXT,
    ...actions.flatMap((action, index) => [
      `[${action.title}]`,
      `执行者：${action.actorLabel}`,
      `通道：${action.handoffChannel === "diagnosed_agent_session" ? "数字人会话" : "大白管家"}`,
      ...(action.targetSessionKey ? [`会话：${action.targetSessionKey}`] : []),
      `说明：${action.reason}`,
      `任务：${action.handoffChannel === "diagnosed_agent_session" ? action.agentPrompt : action.prompt}`,
      ...(index < actions.length - 1 ? [""] : []),
    ]),
  ];
}

function joinOrUnobserved(values: string[]): string {
  return values.length > 0 ? values.join("、") : DIAGNOSE_GROWTH_UNOBSERVED;
}

const PRESCRIPTION_STATE_ZH: Record<string, string> = {
  PENDING_CONFIRMATION: "待确认",
  ALREADY_SCHEDULED: "已有定时任务",
  APPLYING: "写入中",
  APPLIED: "已写入定时任务",
  EXPIRED: "已过期",
  REVOKED: "授权已撤销",
  NOT_CONFIRMABLE: "不可确认",
  FAILED: "写入失败",
};
