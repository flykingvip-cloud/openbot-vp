/**
 * Fail-closed mapping from Gateway perception payloads onto visible rows.
 *
 * Drops rows without a fact id, keeps `system` out of the learned set, and
 * refuses payloads that are not `access=read-only` and `persisted=false`.
 * Claim grade: runtime-enabled. Not production-proven.
 */

import { EVOLUTION_PERCEPTION_COPY } from "./copy.ts";
import { stripEvolutionEmptyNarration } from "./display.ts";
import {
  EMPTY_EVOLUTION_NARRATION,
  evolutionItemId,
  isSystemEvolutionDomain,
  narrationEqualsEmpty,
  traceableFactIds,
  type EvolutionAutomaticAction,
  type EvolutionAutonomyBudget,
  type EvolutionBeforeAfter,
  type EvolutionChangeObject,
  type EvolutionEvidence,
  type EvolutionFactDetail,
  type EvolutionFactIds,
  type EvolutionImpactScope,
  type EvolutionPerceptionNarrationView,
  type EvolutionPerceptionPanels,
  type EvolutionPerceptionPanelsRead,
  type EvolutionPerceptionProjectSlice,
  type EvolutionPerceptionQueryView,
  type EvolutionPerceptionReadState,
  type EvolutionPerceptionWindow,
  type EvolutionProvenanceField,
  type EvolutionReason,
  type EvolutionTarget,
  type EvolutionTimelineItem,
} from "./types.ts";

export const EVOLUTION_PERCEPTION_READ_ONLY_ACCESS = "read-only";

const LEARNED_CLAIM = "学会了";
const AUTONOMY_MODES = new Set(["off", "assist", "auto"]);

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string");
}

function optionalTrimmed(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function acceptEvolutionItems(items: EvolutionTimelineItem[]): EvolutionTimelineItem[] {
  return items.filter((item) => traceableFactIds(item.factIds).length > 0);
}

/** Digital-human learned set. Platform / `system` rows are removed. */
export function learnedEvolutionItems(items: EvolutionTimelineItem[]): EvolutionTimelineItem[] {
  return acceptEvolutionItems(items).filter((item) => !isSystemEvolutionDomain(item));
}

export function rollbackEvolutionItems(items: EvolutionTimelineItem[]): EvolutionTimelineItem[] {
  return acceptEvolutionItems(items).filter((item) => item.bucket === "rolled_back");
}

export function guardEvolutionNarration(input: {
  learned: string[];
  platform: string[];
  other: string[];
  items: EvolutionTimelineItem[];
  narrationGuard?: string | null;
}): EvolutionPerceptionNarrationView {
  const guard = input.narrationGuard?.trim() ?? "";
  if (guard.length > 0) {
    return { ...EMPTY_EVOLUTION_NARRATION };
  }
  const allowedIds = learnedEvolutionItems(input.items).flatMap((item) =>
    traceableFactIds(item.factIds),
  );
  return {
    learned: input.learned.filter((sentence) => sentenceIsVisible(sentence, allowedIds, true)),
    platform: input.platform.filter((sentence) => sentenceIsVisible(sentence, [], false)),
    other: input.other.filter((sentence) => sentenceIsVisible(sentence, [], false)),
  };
}

export function sentenceIsVisible(
  sentence: string,
  allowedFactIds: readonly string[],
  allowLearnedClaim: boolean,
): boolean {
  const trimmed = sentence.trim();
  if (!trimmed) {
    return false;
  }
  if (trimmed.includes(LEARNED_CLAIM)) {
    if (!allowLearnedClaim) {
      return false;
    }
    return allowedFactIds.some((id) => id.length > 0 && trimmed.includes(id));
  }
  return true;
}

export function acceptEvolutionQuery(payload: unknown): EvolutionPerceptionQueryView {
  const envelope = asRecord(payload);
  if (!envelope) {
    return emptyQuery("", "untrusted");
  }
  const intent = readString(envelope.intent) ?? "";
  if (envelope.access !== EVOLUTION_PERCEPTION_READ_ONLY_ACCESS || envelope.persisted !== false) {
    return emptyQuery(intent, "untrusted");
  }
  const denial = asRecord(envelope.denial);
  if (denial?.denied === true) {
    return emptyQuery(intent, "denied");
  }
  if (envelope.result != null && !asRecord(envelope.result)) {
    return emptyQuery(intent, "untrusted");
  }
  const result = asRecord(envelope.result);
  if (!timelineFieldIsArray(result?.items) || !timelineFieldIsArray(result?.platformItems)) {
    return emptyQuery(intent, "untrusted");
  }
  const sourceItems = acceptEvolutionItems(readTimelineItems(result?.items));
  const acceptedPlatform = acceptEvolutionItems(readTimelineItems(result?.platformItems));
  const items = dedupeItems([
    ...sourceItems.filter((item) => !isSystemEvolutionDomain(item)),
    ...acceptedPlatform.filter((item) => !isSystemEvolutionDomain(item)),
  ]);
  const platformItems = dedupeItems([
    ...sourceItems.filter((item) => isSystemEvolutionDomain(item)),
    ...acceptedPlatform.filter((item) => isSystemEvolutionDomain(item)),
  ]);
  const narrationBody = asRecord(envelope.narration);
  const narration = stripEvolutionEmptyNarration(
    guardEvolutionNarration({
      learned: readStringList(narrationBody?.learned),
      platform: readStringList(narrationBody?.platform),
      other: readStringList(narrationBody?.other),
      items: [...items, ...platformItems],
      narrationGuard: readString(envelope.narrationGuard) ?? null,
    }),
  );
  const completeness = readString(result?.completeness) ?? "empty";
  const unresolvedIntents = readStringList(result?.unresolvedIntents);
  const state: EvolutionPerceptionReadState =
    items.length === 0 && platformItems.length === 0 && narrationEqualsEmpty(narration)
      ? "empty"
      : "ready";
  return {
    state,
    intent,
    items,
    platformItems,
    narration,
    completeness,
    unresolvedIntents,
  };
}

export function acceptEvolutionProject(payload: unknown): EvolutionPerceptionProjectSlice {
  const envelope = asRecord(payload);
  if (!envelope) {
    return emptySlice("", "untrusted");
  }
  const operation = readString(envelope.operation) ?? "";
  if (envelope.access !== EVOLUTION_PERCEPTION_READ_ONLY_ACCESS || envelope.persisted !== false) {
    return emptySlice(operation, "untrusted");
  }
  const denial = asRecord(envelope.denial);
  if (denial?.denied === true) {
    return emptySlice(operation, "denied");
  }
  if (envelope.projection != null && !asRecord(envelope.projection)) {
    return emptySlice(operation, "untrusted");
  }
  const projection = asRecord(envelope.projection);
  if (
    !timelineFieldIsArray(projection?.items) ||
    !timelineFieldIsArray(projection?.learnedItems) ||
    !timelineFieldIsArray(projection?.actions) ||
    !timelineFieldIsArray(projection?.digitalHumanItems) ||
    !timelineFieldIsArray(projection?.platformItems)
  ) {
    return emptySlice(operation, "untrusted");
  }
  const items = acceptEvolutionItems(readTimelineItems(projection?.items));
  const learned = learnedEvolutionItems(
    projection && Array.isArray(projection.learnedItems)
      ? readTimelineItems(projection.learnedItems)
      : items,
  );
  const actions = readActions(projection?.actions)
    .map((raw) => {
      const item = acceptTimelineItem(raw.item);
      if (!item || traceableFactIds(item.factIds).length === 0) {
        return null;
      }
      return {
        item,
        budget: readBudget(raw.budget, item.changeObject.surfaceId),
      } satisfies EvolutionAutomaticAction;
    })
    .filter((action): action is EvolutionAutomaticAction => action !== null);
  const observation = acceptEvolutionItems(readTimelineItems(projection?.items));
  const digitalHuman = learnedEvolutionItems(readTimelineItems(projection?.digitalHumanItems));
  const platform = acceptEvolutionItems(readTimelineItems(projection?.platformItems)).filter(
    (item) => isSystemEvolutionDomain(item),
  );
  const populated =
    items.length > 0 ||
    learned.length > 0 ||
    actions.length > 0 ||
    digitalHuman.length > 0 ||
    platform.length > 0;
  return {
    operation,
    state: populated ? "ready" : "empty",
    items,
    learnedItems: learned,
    actions,
    observationItems: observation,
    observationDigitalHuman: digitalHuman,
    observationPlatform: platform,
  };
}

export function evolutionPanelsFromSlices(
  slices: EvolutionPerceptionProjectSlice[],
): EvolutionPerceptionPanelsRead {
  if (slices.some((slice) => slice.state === "denied")) {
    return { status: "denied" };
  }
  if (slices.some((slice) => slice.state === "untrusted")) {
    return { status: "untrusted" };
  }
  const slice = (operation: string) => slices.find((entry) => entry.operation === operation);
  const timeline = acceptEvolutionItems(slice("timeline")?.items ?? []);
  const learnedSource = slice("timeline")?.learnedItems ?? timeline;
  const observationSlice = slice("observation");
  const observation = dedupeItems([
    ...(observationSlice?.observationItems ?? []),
    ...(observationSlice?.observationDigitalHuman ?? []),
    ...(observationSlice?.observationPlatform ?? []),
  ]);
  const panels: EvolutionPerceptionPanels = {
    timeline,
    learned: learnedEvolutionItems(learnedSource),
    digest: acceptEvolutionItems(slice("digest")?.items ?? []),
    pending: acceptEvolutionItems(slice("pending")?.items ?? []),
    automatic: (slice("automatic")?.actions ?? []).filter(
      (action) => traceableFactIds(action.item.factIds).length > 0,
    ),
    observation,
    rollback: rollbackEvolutionItems(timeline),
  };
  return { status: "loaded", panels };
}

function dedupeItems(items: EvolutionTimelineItem[]): EvolutionTimelineItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = evolutionItemId(item);
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function readBudget(raw: unknown, fallbackSurface: string): EvolutionAutonomyBudget {
  const record = asRecord(raw);
  if (!record) {
    return { kind: "unavailable", surfaceId: fallbackSurface };
  }
  const surfaceId = optionalTrimmed(record.surfaceId) ?? fallbackSurface;
  const mode = readString(record.mode);
  const maxApplications = record.maxApplications;
  const usedApplications = record.usedApplications;
  const remainingApplications = record.remainingApplications;
  if (
    record.available !== true ||
    !mode ||
    !AUTONOMY_MODES.has(mode) ||
    typeof maxApplications !== "number" ||
    typeof usedApplications !== "number" ||
    typeof remainingApplications !== "number"
  ) {
    return { kind: "unavailable", surfaceId };
  }
  const expires = optionalTrimmed(record.expiresAt);
  return {
    kind: "provided",
    surfaceId,
    mode,
    maxApplications,
    usedApplications,
    remainingApplications,
    ...(expires ? { expiresAt: expires } : {}),
    ...(typeof record.killSwitch === "boolean" ? { killSwitch: record.killSwitch } : {}),
  };
}

function emptyQuery(
  intent: string,
  state: EvolutionPerceptionReadState,
): EvolutionPerceptionQueryView {
  return {
    state,
    intent,
    items: [],
    platformItems: [],
    narration: { ...EMPTY_EVOLUTION_NARRATION },
    completeness: "empty",
    unresolvedIntents: [],
  };
}

function emptySlice(
  operation: string,
  state: EvolutionPerceptionReadState,
): EvolutionPerceptionProjectSlice {
  return {
    operation,
    state,
    items: [],
    learnedItems: [],
    actions: [],
    observationItems: [],
    observationDigitalHuman: [],
    observationPlatform: [],
  };
}

function timelineFieldIsArray(value: unknown): boolean {
  return value == null || Array.isArray(value);
}

function readTimelineItems(value: unknown): EvolutionTimelineItem[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const items: EvolutionTimelineItem[] = [];
  for (const entry of value) {
    const item = acceptTimelineItem(entry);
    if (item) {
      items.push(item);
    }
  }
  return items;
}

function readActions(value: unknown): Array<{ item: unknown; budget: unknown }> {
  if (!Array.isArray(value)) {
    return [];
  }
  const actions: Array<{ item: unknown; budget: unknown }> = [];
  for (const entry of value) {
    const record = asRecord(entry);
    if (!record || !("item" in record)) {
      continue;
    }
    actions.push({ item: record.item, budget: record.budget });
  }
  return actions;
}

function decodeTarget(value: unknown): EvolutionTarget | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  switch (record.domain) {
    case "agent":
      return typeof record.agentId === "string"
        ? { domain: "agent", agentId: record.agentId }
        : null;
    case "knowledge":
      return typeof record.assetId === "string"
        ? { domain: "knowledge", assetId: record.assetId }
        : null;
    case "capability":
      return typeof record.skillId === "string"
        ? { domain: "capability", skillId: record.skillId }
        : null;
    case "organization":
      return typeof record.groupId === "string"
        ? { domain: "organization", groupId: record.groupId }
        : null;
    case "system":
      return typeof record.componentId === "string"
        ? { domain: "system", componentId: record.componentId }
        : null;
    default:
      return null;
  }
}

function readFactIds(value: unknown): EvolutionFactIds | null {
  const record = asRecord(value);
  if (!record || typeof record.ledgerEventId !== "string") {
    return null;
  }
  const factIds: EvolutionFactIds = { ledgerEventId: record.ledgerEventId };
  if (typeof record.proposalId === "string") {
    factIds.proposalId = record.proposalId;
  }
  if (typeof record.applicationId === "string") {
    factIds.applicationId = record.applicationId;
  }
  if (typeof record.verificationId === "string") {
    factIds.verificationId = record.verificationId;
  }
  if (traceableFactIds(factIds).length === 0) {
    return null;
  }
  return factIds;
}

function readBeforeAfter(value: unknown): EvolutionBeforeAfter {
  const record = asRecord(value);
  if (!record) {
    return { summary: "unavailable" };
  }
  return {
    ...(typeof record.versionBefore === "string" ? { versionBefore: record.versionBefore } : {}),
    ...(typeof record.versionAfter === "string" ? { versionAfter: record.versionAfter } : {}),
    summary: typeof record.summary === "string" ? record.summary : "unavailable",
  };
}

function readReason(value: unknown): EvolutionReason {
  const record = asRecord(value);
  if (!record) {
    return { status: "unspecified", sourceEvidenceRefs: [], findingIds: [] };
  }
  return {
    status: typeof record.status === "string" ? record.status : "unspecified",
    sourceEvidenceRefs: readStringList(record.sourceEvidenceRefs),
    ...(typeof record.sourceMechanismRef === "string"
      ? { sourceMechanismRef: record.sourceMechanismRef }
      : {}),
    ...(typeof record.caseId === "string" ? { caseId: record.caseId } : {}),
    findingIds: readStringList(record.findingIds),
  };
}

function readEvidence(value: unknown): EvolutionEvidence {
  const record = asRecord(value);
  if (!record) {
    return { evidenceRefs: [] };
  }
  return {
    evidenceRefs: readStringList(record.evidenceRefs),
    ...(typeof record.reportId === "string" ? { reportId: record.reportId } : {}),
    ...(typeof record.verificationId === "string" ? { verificationId: record.verificationId } : {}),
  };
}

function readImpact(value: unknown): EvolutionImpactScope {
  const record = asRecord(value);
  if (!record) {
    return { label: "unspecified" };
  }
  return {
    ...(typeof record.confidentialityScope === "string"
      ? { confidentialityScope: record.confidentialityScope }
      : {}),
    ...(typeof record.tenantScope === "string" ? { tenantScope: record.tenantScope } : {}),
    label: typeof record.label === "string" ? record.label : "unspecified",
  };
}

export function acceptTimelineItem(raw: unknown): EvolutionTimelineItem | null {
  const record = asRecord(raw);
  if (!record) {
    return null;
  }
  const factIds = readFactIds(record.factIds);
  const change = asRecord(record.changeObject);
  const target = change ? decodeTarget(change.target) : null;
  if (!factIds || !change || !target || typeof change.surfaceId !== "string") {
    return null;
  }
  if (record.proposalSchema !== 1 && record.proposalSchema !== 2) {
    return null;
  }
  const domain =
    typeof change.domain === "string" && change.domain.length > 0 ? change.domain : target.domain;
  const system =
    domain === "system" || target.domain === "system" || record.audience === "platform";
  const display =
    typeof change.domainDisplayName === "string" ? change.domainDisplayName.trim() : "";
  const before = readBeforeAfter(record.beforeAfter);
  const hasVersions = Boolean(before.versionBefore?.trim()) && Boolean(before.versionAfter?.trim());
  const changeObject: EvolutionChangeObject = {
    target,
    surfaceId: change.surfaceId,
    domain,
    domainDisplayName: display.length > 0 ? display : domain,
  };
  return {
    schemaVersion: typeof record.schemaVersion === "number" ? record.schemaVersion : 1,
    proposalSchema: record.proposalSchema,
    legacy: typeof record.legacy === "boolean" ? record.legacy : record.proposalSchema === 1,
    factIds,
    audience: system ? "platform" : "digital_human",
    changeObject,
    beforeAfter: {
      ...(before.versionBefore !== undefined ? { versionBefore: before.versionBefore } : {}),
      ...(before.versionAfter !== undefined ? { versionAfter: before.versionAfter } : {}),
      summary: hasVersions ? before.summary : "unavailable",
    },
    reason: readReason(record.reason),
    executionMode: typeof record.executionMode === "string" ? record.executionMode : "unknown",
    evidence: readEvidence(record.evidence),
    result: typeof record.result === "string" ? record.result : "unspecified",
    ...(typeof record.bucket === "string" ? { bucket: record.bucket } : {}),
    impactScope: readImpact(record.impactScope),
    reversible: record.reversible === true,
    completeness: hasVersions
      ? typeof record.completeness === "string"
        ? record.completeness
        : "complete"
      : "partial",
  };
}

function presentField(
  fields: EvolutionProvenanceField[],
  label: string,
  value: string | undefined,
): void {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    return;
  }
  fields.push({ label, value: trimmed });
}

function requiredField(
  fields: EvolutionProvenanceField[],
  label: string,
  value: string | undefined,
): void {
  const trimmed = value?.trim() ?? "";
  fields.push({
    label,
    value: trimmed.length > 0 ? trimmed : EVOLUTION_PERCEPTION_COPY.missing,
  });
}

function joined(values: readonly string[]): string | undefined {
  const kept = values.map((value) => value.trim()).filter((value) => value.length > 0);
  return kept.length > 0 ? kept.join("、") : undefined;
}

export function makeEvolutionFactDetail(
  item: EvolutionTimelineItem,
  window?: EvolutionPerceptionWindow,
): EvolutionFactDetail {
  const fields: EvolutionProvenanceField[] = [];
  presentField(fields, "账本事件", item.factIds.ledgerEventId);
  presentField(fields, "提案", item.factIds.proposalId);
  presentField(fields, "应用", item.factIds.applicationId);
  presentField(fields, "验证", item.factIds.verificationId);
  requiredField(fields, "领域", item.changeObject.domain);
  const audience = isSystemEvolutionDomain(item)
    ? EVOLUTION_PERCEPTION_COPY.platformBadge
    : EVOLUTION_PERCEPTION_COPY.digitalHumanSection;
  requiredField(fields, "受众", audience);
  requiredField(fields, "前版本", item.beforeAfter.versionBefore);
  requiredField(fields, "后版本", item.beforeAfter.versionAfter);
  const summary =
    item.beforeAfter.summary === "unavailable"
      ? EVOLUTION_PERCEPTION_COPY.unavailableSummary
      : item.beforeAfter.summary;
  requiredField(fields, "摘要", summary);
  requiredField(fields, "原因状态", item.reason.status);
  requiredField(fields, "来源证据", joined(item.reason.sourceEvidenceRefs));
  requiredField(fields, "机制引用", item.reason.sourceMechanismRef);
  requiredField(fields, "案例", item.reason.caseId);
  requiredField(fields, "发现", joined(item.reason.findingIds));
  requiredField(fields, "证据引用", joined(item.evidence.evidenceRefs));
  requiredField(fields, "报告", item.evidence.reportId);
  requiredField(fields, "证据验证", item.evidence.verificationId);
  requiredField(fields, "执行", item.executionMode);
  requiredField(fields, "结果", item.result);
  requiredField(fields, "分桶", item.bucket);
  requiredField(fields, "影响范围", item.impactScope.label);
  requiredField(fields, "可逆", item.reversible ? "是" : "否");
  requiredField(fields, "完整度", item.completeness);
  if (window) {
    requiredField(fields, "窗口", `${window.from} – ${window.to}`);
  }
  return {
    audienceLabel: audience,
    isPlatform: isSystemEvolutionDomain(item),
    fields,
  };
}

export function evolutionFactDetailValue(
  detail: EvolutionFactDetail,
  label: string,
): string | undefined {
  return detail.fields.find((field) => field.label === label)?.value;
}
