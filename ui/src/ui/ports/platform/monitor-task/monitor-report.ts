/**
 * D9 monitor report: machine-readable block + Chinese summary + fix guidance.
 * Export is the primary action. The document has no role, score, confirm, or repair entry.
 */

export type MonitorCadence = "off" | "daily" | "tick";
export type MonitorTrigger = "manual" | "daily" | "tick";

export type MonitorMetric = {
  value: number | null;
  threshold: number | null;
  breached: boolean;
};

export type MonitorViolation = {
  ruleId: string;
  severity: "high" | "medium";
  evidence: string;
  symptom: string;
};

export type MonitorRepairGuidance = {
  ruleId: string;
  symptom: string;
  where: string;
  reproduce: string;
  accept: string;
};

export type MonitorReportDocument = {
  tenantId: string;
  tenantLabel: string;
  runId: string;
  agentId: string | null;
  groupId: string | null;
  roundId: string | null;
  cadence: MonitorCadence;
  trigger: MonitorTrigger;
  window: { start: string; end: string };
  metrics: { failure: MonitorMetric; efficiency: MonitorMetric };
  violations: MonitorViolation[];
  summary: string;
  guidance: MonitorRepairGuidance[];
};

export type MonitorJobMatch = {
  sourceRunId: string;
  eventId: string;
  agentId: string | null;
  groupId: string | null;
  failure: boolean;
  efficiencyBreach: boolean;
};

export type MonitorJobReportSource = {
  tenantId: string;
  runId: string;
  filter: {
    agentId?: string | null;
    agentIds?: string[] | null;
    groupId?: string | null;
    failure?: { enabled?: boolean; minCount?: number | null } | null;
    efficiency?: { maxTotalMs?: number | null; maxTtftMs?: number | null } | null;
  };
  matched: MonitorJobMatch[];
};

const FAILURE_RULE = "m1.failure";
const EFFICIENCY_RULE = "m1.efficiency";

export function monitorReportFilename(doc: MonitorReportDocument, ext: "md" | "yaml"): string {
  return `m1-monitor-${safeToken(doc.tenantId)}-${safeToken(doc.runId)}.${ext}`;
}

export function monitorReportFromJob(input: {
  tenantLabel: string;
  cadence: MonitorCadence;
  trigger: MonitorTrigger;
  roundId: string | null;
  window: { start: string; end: string };
  report: MonitorJobReportSource;
}): MonitorReportDocument {
  const filter = input.report.filter;
  const failureCount = input.report.matched.filter((row) => row.failure).length;
  const efficiencyCount = input.report.matched.filter((row) => row.efficiencyBreach).length;
  const failureThreshold =
    filter.failure?.enabled === true && typeof filter.failure.minCount === "number"
      ? filter.failure.minCount
      : null;
  const efficiencyThreshold =
    typeof filter.efficiency?.maxTotalMs === "number" ? filter.efficiency.maxTotalMs : null;
  const metrics = {
    failure: {
      value: failureCount,
      threshold: failureThreshold,
      breached: failureThreshold != null && failureCount >= failureThreshold,
    },
    efficiency: {
      value: efficiencyCount,
      threshold: efficiencyThreshold,
      breached: efficiencyThreshold != null && efficiencyCount > 0,
    },
  };
  const violations = violationsFromMatches(input.report.matched);
  const agentIds = [...(filter.agentId ? [filter.agentId] : []), ...(filter.agentIds ?? [])].filter(
    (id, index, all) => id && all.indexOf(id) === index,
  );
  const summary = buildSummary({
    tenantLabel: input.tenantLabel,
    window: input.window,
    metrics,
    violations,
  });
  return {
    tenantId: input.report.tenantId,
    tenantLabel: input.tenantLabel,
    runId: input.report.runId,
    agentId: agentIds.length === 1 ? agentIds[0] : null,
    groupId: filter.groupId ?? null,
    roundId: input.roundId,
    cadence: input.cadence,
    trigger: input.trigger,
    window: input.window,
    metrics,
    violations,
    summary,
    guidance: violations.map(guidanceFor),
  };
}

export function renderMonitorMachineYaml(doc: MonitorReportDocument): string {
  const lines = [
    "# openbot.m1.monitor-report",
    `tenantId: ${yamlScalar(doc.tenantId)}`,
    `runId: ${yamlScalar(doc.runId)}`,
    `agentId: ${yamlScalar(doc.agentId)}`,
    `groupId: ${yamlScalar(doc.groupId)}`,
    `roundId: ${yamlScalar(doc.roundId)}`,
    `cadence: ${yamlScalar(doc.cadence)}`,
    `trigger: ${yamlScalar(doc.trigger)}`,
    "window:",
    `  start: ${yamlScalar(doc.window.start)}`,
    `  end: ${yamlScalar(doc.window.end)}`,
    "metrics:",
    "  failure:",
    `    value: ${yamlScalar(doc.metrics.failure.value)}`,
    `    threshold: ${yamlScalar(doc.metrics.failure.threshold)}`,
    `    breached: ${yamlScalar(doc.metrics.failure.breached)}`,
    "  efficiency:",
    `    value: ${yamlScalar(doc.metrics.efficiency.value)}`,
    `    threshold: ${yamlScalar(doc.metrics.efficiency.threshold)}`,
    `    breached: ${yamlScalar(doc.metrics.efficiency.breached)}`,
    "violations:",
  ];
  if (doc.violations.length === 0) {
    lines.push("  []");
  } else {
    for (const row of doc.violations) {
      lines.push(
        `  - ruleId: ${yamlScalar(row.ruleId)}`,
        `    severity: ${yamlScalar(row.severity)}`,
        `    evidence: ${yamlScalar(row.evidence)}`,
        `    symptom: ${yamlScalar(row.symptom)}`,
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

export function renderMonitorReportMarkdown(doc: MonitorReportDocument): string {
  const guidance =
    doc.guidance.length === 0
      ? "本窗没有 violation。\n"
      : doc.guidance
          .map(
            (row) =>
              `### ${row.ruleId}\n\n${row.symptom}\n\n- 建议改哪里：${row.where}\n- 复现步骤：${row.reproduce}\n- 验收标准：${row.accept}\n`,
          )
          .join("\n");
  return [
    `# 监测报告 ${doc.tenantLabel}`,
    "",
    "## 机器可读",
    "",
    "```yaml",
    renderMonitorMachineYaml(doc).trimEnd(),
    "```",
    "",
    "## 中文摘要",
    "",
    doc.summary,
    "",
    "## 修复指引",
    "",
    guidance.trimEnd(),
    "",
  ].join("\n");
}

export function renderMonitorReportYaml(doc: MonitorReportDocument): string {
  const guidance =
    doc.guidance.length === 0
      ? ["guidance: []"]
      : [
          "guidance:",
          ...doc.guidance.flatMap((row) => [
            `  - ruleId: ${yamlScalar(row.ruleId)}`,
            `    symptom: ${yamlScalar(row.symptom)}`,
            `    where: ${yamlScalar(row.where)}`,
            `    reproduce: ${yamlScalar(row.reproduce)}`,
            `    accept: ${yamlScalar(row.accept)}`,
          ]),
        ];
  return `${renderMonitorMachineYaml(doc).trimEnd()}\n# 中文摘要\nsummary: ${yamlScalar(doc.summary)}\n# 修复指引\n${guidance.join("\n")}\n`;
}

export function downloadTextFile(filename: string, contents: string, mime: string): void {
  if (typeof document === "undefined") {
    return;
  }
  const blob = new Blob([contents], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function violationsFromMatches(matched: readonly MonitorJobMatch[]): MonitorViolation[] {
  const violations: MonitorViolation[] = [];
  for (const row of matched) {
    const evidence = `${row.sourceRunId} ${row.eventId}`.trim();
    if (row.failure) {
      violations.push({
        ruleId: FAILURE_RULE,
        severity: "high",
        evidence,
        symptom: "失败计数命中 M1 失败分类。",
      });
    }
    if (row.efficiencyBreach) {
      violations.push({
        ruleId: EFFICIENCY_RULE,
        severity: "medium",
        evidence,
        symptom: "耗时越过效率阈值。",
      });
    }
  }
  return violations;
}

function guidanceFor(row: MonitorViolation): MonitorRepairGuidance {
  const where =
    row.ruleId === EFFICIENCY_RULE
      ? "对照 evidence 里的耗时，收紧该机器人或协作小组的慢调用。"
      : "对照 evidence 定位失败分类（execution、failureAttribution），改对应机器人或协作小组的失败路径。";
  return {
    ruleId: row.ruleId,
    symptom: row.symptom,
    where,
    reproduce: "用同一租户和范围再执行一次监测 Run，窗口与本报告一致。",
    accept: "该 ruleId 的 metric.breached 为 false，且 violations 不再包含此 evidence。",
  };
}

function buildSummary(input: {
  tenantLabel: string;
  window: { start: string; end: string };
  metrics: MonitorReportDocument["metrics"];
  violations: MonitorViolation[];
}): string {
  const failure = input.metrics.failure.breached ? "失败已越界" : "失败未越界";
  const efficiency = input.metrics.efficiency.breached ? "效率已越界" : "效率未越界";
  const ruleIds = [...new Set(input.violations.map((row) => row.ruleId))];
  const rules = ruleIds.length > 0 ? ruleIds.join("、") : "无";
  return `${input.tenantLabel} · 窗 ${input.window.start} → ${input.window.end}。${failure}，${efficiency}。主要 ruleId：${rules}。`;
}

function yamlScalar(value: string | number | boolean | null): string {
  if (value === null) {
    return "null";
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value.length > 0 && /^[A-Za-z0-9_./:+-]+$/.test(value)) {
    return value;
  }
  return JSON.stringify(value);
}

function safeToken(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned || "unknown";
}
