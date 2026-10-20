export type ClaimConflictCandidate = {
  claimId: string;
  value: string;
  chunkId?: string;
  claimText?: string;
};

export type ClaimConflictResolutionMeta = {
  normalizedKey?: string;
  subject?: string;
};

export type DedupedClaimOption = {
  dedupeKey: string;
  displayValue: string;
  canonicalClaimId: string;
  claimIds: string[];
  chunkIds: string[];
  contextExcerpt: string | null;
  sourceCount: number;
  isPlaceholder: boolean;
  qualityScore: number;
  recommended: boolean;
};

const PLACEHOLDER_VALUE_RE = /^\{\{[\s\S]*\}\}$/;

export function isPlaceholderClaimValue(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return true;
  }
  return PLACEHOLDER_VALUE_RE.test(trimmed);
}

export function scoreClaimValueQuality(value: string): number {
  const trimmed = value.trim();
  if (!trimmed) {
    return -50;
  }
  if (isPlaceholderClaimValue(trimmed)) {
    return -100;
  }
  let score = 10;
  if (/^https?:\/\//i.test(trimmed)) {
    score += 30;
  }
  if (trimmed.length >= 4) {
    score += 5;
  }
  if (trimmed === "无" || trimmed.toLowerCase() === "none" || trimmed === "—") {
    score += 8;
  }
  return score;
}

function normalizeDedupeKey(value: string): string {
  return value.trim().toLowerCase();
}

function truncateContext(text: string, max = 120): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) {
    return trimmed;
  }
  return `${trimmed.slice(0, max - 1)}…`;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

export function formatClaimSlotLabel(meta: ClaimConflictResolutionMeta): string | null {
  const subject = meta.subject?.trim();
  if (subject) {
    return subject;
  }
  const key = meta.normalizedKey?.trim();
  if (!key) {
    return null;
  }
  return key.replace(/[:/|]/g, " · ");
}

export function parseClaimConflictCandidates(task: {
  taskType: string;
  proposedResolution: Record<string, unknown> | null;
}): { meta: ClaimConflictResolutionMeta; candidates: ClaimConflictCandidate[] } {
  if (task.taskType !== "claim_conflict" || !task.proposedResolution) {
    return { meta: {}, candidates: [] };
  }
  const resolution = task.proposedResolution;
  const meta: ClaimConflictResolutionMeta = {
    normalizedKey:
      typeof resolution.normalizedKey === "string" ? resolution.normalizedKey : undefined,
    subject: typeof resolution.subject === "string" ? resolution.subject : undefined,
  };
  const rawCandidates = resolution.candidates;
  if (Array.isArray(rawCandidates) && rawCandidates.length > 0) {
    const candidates = rawCandidates
      .filter(
        (
          entry,
        ): entry is {
          claimId: string;
          value?: unknown;
          chunkId?: unknown;
          claimText?: unknown;
        } => typeof (entry as { claimId?: unknown })?.claimId === "string",
      )
      .map((entry) => ({
        claimId: entry.claimId,
        value: typeof entry.value === "string" ? entry.value : "",
        chunkId: typeof entry.chunkId === "string" ? entry.chunkId : undefined,
        claimText: typeof entry.claimText === "string" ? entry.claimText : undefined,
      }));
    if (candidates.length > 0) {
      return { meta, candidates };
    }
  }
  const claimIds = Array.isArray(resolution.claimIds)
    ? resolution.claimIds.filter((entry): entry is string => typeof entry === "string")
    : [];
  const values = Array.isArray(resolution.values)
    ? resolution.values.filter((entry): entry is string => typeof entry === "string")
    : [];
  return {
    meta,
    candidates: claimIds.map((claimId, index) => ({
      claimId,
      value: values[index] ?? "",
    })),
  };
}

export function dedupeClaimCandidates(candidates: ClaimConflictCandidate[]): DedupedClaimOption[] {
  const groups = new Map<
    string,
    {
      displayValue: string;
      canonicalClaimId: string;
      claimIds: string[];
      chunkIds: string[];
      claimTexts: string[];
    }
  >();

  for (const candidate of candidates) {
    const displayValue = (candidate.value || candidate.claimText || candidate.claimId).trim();
    const dedupeKey = normalizeDedupeKey(displayValue);
    const existing = groups.get(dedupeKey);
    if (!existing) {
      groups.set(dedupeKey, {
        displayValue,
        canonicalClaimId: candidate.claimId,
        claimIds: [candidate.claimId],
        chunkIds: candidate.chunkId ? [candidate.chunkId] : [],
        claimTexts: candidate.claimText ? [candidate.claimText] : [],
      });
      continue;
    }
    existing.claimIds.push(candidate.claimId);
    if (candidate.chunkId) {
      existing.chunkIds.push(candidate.chunkId);
    }
    if (candidate.claimText) {
      existing.claimTexts.push(candidate.claimText);
    }
    if (scoreClaimValueQuality(displayValue) > scoreClaimValueQuality(existing.displayValue)) {
      existing.displayValue = displayValue;
      existing.canonicalClaimId = candidate.claimId;
    }
  }

  const options = [...groups.values()].map((group): DedupedClaimOption => {
    const qualityScore = scoreClaimValueQuality(group.displayValue);
    const claimTexts = uniqueStrings(group.claimTexts);
    return {
      dedupeKey: normalizeDedupeKey(group.displayValue),
      displayValue: group.displayValue,
      canonicalClaimId: group.canonicalClaimId,
      claimIds: group.claimIds,
      chunkIds: uniqueStrings(group.chunkIds),
      contextExcerpt: claimTexts[0] ? truncateContext(claimTexts[0]) : null,
      sourceCount: Math.max(group.claimIds.length, group.chunkIds.length),
      isPlaceholder: isPlaceholderClaimValue(group.displayValue),
      qualityScore,
      recommended: false,
    };
  });

  options.sort((left, right) => right.qualityScore - left.qualityScore);
  const recommended =
    options.find((option) => !option.isPlaceholder && option.qualityScore > 0) ?? null;
  if (recommended) {
    recommended.recommended = true;
  }
  return options;
}

export function buildClaimConflictOptions(task: {
  taskType: string;
  proposedResolution: Record<string, unknown> | null;
}): { meta: ClaimConflictResolutionMeta; options: DedupedClaimOption[] } {
  const parsed = parseClaimConflictCandidates(task);
  return {
    meta: parsed.meta,
    options: dedupeClaimCandidates(parsed.candidates),
  };
}

export function resolveAdoptedClaimChoice(
  task: {
    taskType: string;
    proposedResolution: Record<string, unknown> | null;
  },
  canonicalClaimId: string,
): { slotLabel: string | null; displayValue: string } | null {
  const { meta, options } = buildClaimConflictOptions(task);
  const option =
    options.find(
      (entry) =>
        entry.canonicalClaimId === canonicalClaimId || entry.claimIds.includes(canonicalClaimId),
    ) ?? null;
  if (!option) {
    return null;
  }
  return {
    slotLabel: formatClaimSlotLabel(meta),
    displayValue: option.displayValue,
  };
}
