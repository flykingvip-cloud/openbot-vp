import type {
  ShadowDiffComparison,
  ShadowDiffEntry,
} from "../../contracts/rule-adaptation-shadow.js";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isPlainObject(value) ? value : undefined;
}

export function readCurrentEffectiveValues(hostFacts: unknown): Record<string, unknown> {
  const facts = asRecord(hostFacts);
  const values = facts ? facts.currentEffectiveValues : undefined;
  return asRecord(values) ?? {};
}

function compareValues(current: unknown, proposed: unknown): ShadowDiffComparison {
  if (current === undefined) {
    return "absent";
  }
  if (Object.is(current, proposed)) {
    return "equal";
  }
  if (Number.isSafeInteger(current) && Number.isSafeInteger(proposed)) {
    if ((proposed as number) === (current as number)) {
      return "equal";
    }
    return (proposed as number) < (current as number) ? "tighten" : "widen_or_other";
  }
  return "unknown";
}

/**
 * Compare a proposal against trusted host facts only. Never read current
 * values from the proposal itself.
 */
export function buildShadowDiff(proposal: unknown, hostFacts: unknown): ShadowDiffEntry[] {
  const body = asRecord(proposal);
  if (!body || body.kind !== "policy_proposal" || !Array.isArray(body.items)) {
    return [];
  }
  const currentValues = readCurrentEffectiveValues(hostFacts);
  const diffs: ShadowDiffEntry[] = [];
  for (const raw of body.items) {
    const item = asRecord(raw);
    if (!item || typeof item.field !== "string") {
      continue;
    }
    const current = currentValues[item.field];
    diffs.push({
      field: item.field,
      ...(typeof item.ruleId === "string" ? { ruleId: item.ruleId } : {}),
      currentEffectiveValue: current,
      proposedValue: item.proposedValue,
      comparison: compareValues(current, item.proposedValue),
    });
  }
  return diffs;
}
