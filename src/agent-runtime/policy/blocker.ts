/** Existing blocker classification only. No probes, I/O, clocks, state changes or scheduling. */
export const BLOCKER_GRADES = ["mainline", "side_path", "already_cleared"] as const;
export type BlockerGrade = (typeof BLOCKER_GRADES)[number];

export type EnvProbe = {
  reason: string;
  passed: boolean;
};

const SIDE_PATH_RE =
  /task_ledger(?:\.json)?|memory\/task_ledger|chmod|非交付文件|幽灵任务|清表|清理任务/iu;

export function isSidePathLabel(text: string): boolean {
  return SIDE_PATH_RE.test(text);
}

export function gradeBlocker(params: {
  narrative: string;
  deliverableProducible: boolean;
  clearedReasons?: readonly string[];
  probes?: readonly EnvProbe[];
}): BlockerGrade {
  const narrative = params.narrative;
  const probes = params.probes ?? [];
  for (const probe of probes) {
    if (!probe.passed) {
      continue;
    }
    if (
      params.clearedReasons?.includes(probe.reason) ||
      assistantRestopsCleared(narrative, probe)
    ) {
      return "already_cleared";
    }
  }
  if (isSidePathLabel(narrative) && params.deliverableProducible) {
    return "side_path";
  }
  if (isSidePathLabel(narrative) && !isMainlineBlockNarrative(narrative)) {
    return "side_path";
  }
  return "mainline";
}

export function assistantRestopsCleared(narrative: string, probe: EnvProbe): boolean {
  if (!probe.passed) {
    return false;
  }
  if (probe.reason === "node") {
    return /node\s*v?18|只有\s*18|需要\s*node\s*20|升(?:级)?\s*node/iu.test(narrative);
  }
  if (probe.reason === "playwright") {
    return /没有\s*playwright|playwright\s*不可用|缺少\s*playwright|安装\s*playwright/iu.test(
      narrative,
    );
  }
  return (
    narrative.toLowerCase().includes(probe.reason.toLowerCase()) &&
    /不可用|缺少|没有|仍缺/.test(narrative)
  );
}

export function isMainlineBlockNarrative(text: string): boolean {
  return /渲染引擎缺失|无法产生交付物|无法写出成果正文|mainline_block|成果正文写不出来/u.test(text);
}
