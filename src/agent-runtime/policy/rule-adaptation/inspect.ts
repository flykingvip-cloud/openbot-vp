import {
  CANDIDATE_BODY_KEYS,
  EXPECTED_POLICY_VERSION_KEYS,
  FORBIDDEN_PROPOSAL_KEY_SET,
  HOST_AUTHORIZATION_STATUSES,
  HOST_COMPATIBILITY_RECORD_KEYS,
  HOST_COMPATIBILITY_STATUSES,
  HOST_EXPECTED_POLICY_STATES,
  HOST_IDENTITY_KEYS,
  HOST_LANES,
  HOST_ROOT_KEYS,
  POLICY_PROPOSAL_ROOT_KEYS,
  PRINCIPAL_TYPES,
  PROPOSAL_ACTIONS,
  PROPOSAL_ITEM_KEYS,
  RULE_CANDIDATE_ROOT_KEYS,
  RUNTIME_RULE_ADAPTATION_MAX_INPUT_DEPTH,
  SCOPE_KEYS,
  SCOPE_TYPES,
  type RuntimeRuleAdaptationReason,
  type RuntimeRuleAdaptationReasonCode,
  type RuntimeRuleAdaptationMissingFact,
} from "../../contracts/rule-adaptation.js";

export { RUNTIME_RULE_ADAPTATION_MAX_INPUT_DEPTH };

/**
 * A plain object is a JSON-like record whose prototype is `Object.prototype`
 * or `null`. Class instances, `Date`, `Map`, `Set`, host objects, and arrays
 * are not plain objects.
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** A plain array is an `Array` instance whose prototype is `Array.prototype`. */
export function isPlainArray(value: unknown): value is unknown[] {
  return Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype;
}

function isAllowedPrimitive(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

/**
 * Walk already-parsed programmatic values. Reject non-plain data, cycles, and
 * depth greater than `RUNTIME_RULE_ADAPTATION_MAX_INPUT_DEPTH` (root is depth
 * 1) with stable reason codes. Never throw on cycle or overflow. This is not a
 * JSON parser.
 */
export function collectInputShapeReasons(
  proposal: unknown,
  hostFacts: unknown,
): RuntimeRuleAdaptationReason[] {
  const out: RuntimeRuleAdaptationReason[] = [];
  inspectTree(proposal, "proposal", out, new WeakSet<object>(), 1);
  if (hostFacts !== undefined) {
    inspectTree(hostFacts, "host", out, new WeakSet<object>(), 1);
  }
  return out;
}

function inspectTree(
  value: unknown,
  path: string,
  out: RuntimeRuleAdaptationReason[],
  visiting: WeakSet<object>,
  depth: number,
): void {
  if (isAllowedPrimitive(value)) {
    return;
  }
  if (depth > RUNTIME_RULE_ADAPTATION_MAX_INPUT_DEPTH) {
    out.push(
      reason(
        "structural_input_too_deep",
        `Programmatic input exceeds the maximum nesting depth of ${RUNTIME_RULE_ADAPTATION_MAX_INPUT_DEPTH} (the top-level argument is depth 1).`,
        path,
      ),
    );
    return;
  }
  if (typeof value !== "object" || value === null) {
    out.push(
      reason(
        "structural_non_plain_object",
        "Programmatic input must be JSON-like acyclic data: plain objects, plain arrays, or allowed primitives. Functions, symbols, and bigints are not plain data.",
        path,
      ),
    );
    return;
  }
  if (visiting.has(value)) {
    out.push(
      reason(
        "structural_circular_reference",
        "Programmatic input contains a circular reference and is rejected without walking further.",
        path,
      ),
    );
    return;
  }
  if (!isPlainObject(value) && !isPlainArray(value)) {
    out.push(
      reason(
        "structural_non_plain_object",
        "Programmatic input must be a plain data object or plain array. Class instances, Date, Map, Set, and other host objects are rejected.",
        path,
      ),
    );
    return;
  }
  visiting.add(value);
  if (isPlainArray(value)) {
    for (const [index, entry] of value.entries()) {
      inspectTree(entry, indexPath(path, index), out, visiting, depth + 1);
    }
  } else {
    for (const [key, child] of Object.entries(value)) {
      inspectTree(child, childPath(path, key), out, visiting, depth + 1);
    }
  }
  visiting.delete(value);
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function isSafeIntegerNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

export function reason(
  code: RuntimeRuleAdaptationReasonCode,
  message: string,
  path?: string,
  missingFact?: RuntimeRuleAdaptationMissingFact,
): RuntimeRuleAdaptationReason {
  const entry: RuntimeRuleAdaptationReason = { code, message };
  if (path !== undefined) {
    entry.path = path;
  }
  if (missingFact !== undefined) {
    entry.missingFact = missingFact;
  }
  return entry;
}

export function childPath(base: string, key: string): string {
  return `${base}.${key}`;
}

export function indexPath(base: string, index: number): string {
  return `${base}[${index}]`;
}

function listUnknownKeys(value: Record<string, unknown>, allowed: readonly string[]): string[] {
  const allowedSet = new Set(allowed);
  return Object.keys(value).filter((key) => !allowedSet.has(key));
}

export function collectForbiddenKeys(
  value: unknown,
  basePath: string,
  out: RuntimeRuleAdaptationReason[],
): void {
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) {
      collectForbiddenKeys(entry, indexPath(basePath, index), out);
    }
    return;
  }
  if (!isPlainObject(value)) {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const path = childPath(basePath, key);
    if (FORBIDDEN_PROPOSAL_KEY_SET.has(key)) {
      out.push(
        reason(
          "structural_forbidden_field",
          `${key} is forbidden on the model proposal. Its presence is a structural reject and must not override trusted host facts, even if the host is unauthorized or the numeric tighten would otherwise have been shadow-legal.`,
          path,
        ),
      );
    }
    collectForbiddenKeys(child, path, out);
  }
}

export function collectUnknownKeys(
  value: unknown,
  basePath: string,
  allowed: readonly string[],
  out: RuntimeRuleAdaptationReason[],
): void {
  if (!isPlainObject(value)) {
    return;
  }
  for (const key of listUnknownKeys(value, allowed)) {
    if (FORBIDDEN_PROPOSAL_KEY_SET.has(key) && basePath === "proposal") {
      continue;
    }
    if (FORBIDDEN_PROPOSAL_KEY_SET.has(key) && basePath.startsWith("proposal")) {
      continue;
    }
    out.push(
      reason(
        "structural_unknown_field",
        `Unknown field '${key}' is not in the closed schema and is a structural reject.`,
        childPath(basePath, key),
      ),
    );
  }
}

export function collectHostUnknownKeys(host: unknown, out: RuntimeRuleAdaptationReason[]): void {
  if (!isPlainObject(host)) {
    return;
  }
  collectUnknownKeys(host, "host", HOST_ROOT_KEYS, out);
  if (isPlainObject(host.identity)) {
    collectUnknownKeys(host.identity, "host.identity", HOST_IDENTITY_KEYS, out);
    if (isPlainObject(host.identity.scope)) {
      collectUnknownKeys(host.identity.scope, "host.identity.scope", SCOPE_KEYS, out);
    }
  }
  if (isPlainObject(host.compatibilityRecord)) {
    collectUnknownKeys(
      host.compatibilityRecord,
      "host.compatibilityRecord",
      HOST_COMPATIBILITY_RECORD_KEYS,
      out,
    );
    if (isPlainObject(host.compatibilityRecord.boundExpectedPolicyVersion)) {
      collectUnknownKeys(
        host.compatibilityRecord.boundExpectedPolicyVersion,
        "host.compatibilityRecord.boundExpectedPolicyVersion",
        EXPECTED_POLICY_VERSION_KEYS,
        out,
      );
    }
  }
}

export function collectProposalUnknownKeys(
  proposal: Record<string, unknown>,
  out: RuntimeRuleAdaptationReason[],
): void {
  const kind = proposal.kind;
  const rootAllowed =
    kind === "rule_candidate" ? RULE_CANDIDATE_ROOT_KEYS : POLICY_PROPOSAL_ROOT_KEYS;
  collectUnknownKeys(proposal, "proposal", rootAllowed, out);
  if (isPlainObject(proposal.scope)) {
    collectUnknownKeys(proposal.scope, "proposal.scope", SCOPE_KEYS, out);
  }
  if (isPlainObject(proposal.expectedPolicyVersion)) {
    collectUnknownKeys(
      proposal.expectedPolicyVersion,
      "proposal.expectedPolicyVersion",
      EXPECTED_POLICY_VERSION_KEYS,
      out,
    );
  }
  if (Array.isArray(proposal.items)) {
    for (const [index, item] of proposal.items.entries()) {
      if (isPlainObject(item)) {
        collectUnknownKeys(item, indexPath("proposal.items", index), PROPOSAL_ITEM_KEYS, out);
      }
    }
  }
  if (isPlainObject(proposal.candidate)) {
    collectUnknownKeys(proposal.candidate, "proposal.candidate", CANDIDATE_BODY_KEYS, out);
  }
}

const SCOPE_TYPE_SET = new Set<string>(SCOPE_TYPES);
const PRINCIPAL_TYPE_SET = new Set<string>(PRINCIPAL_TYPES);
const LANE_SET = new Set<string>(HOST_LANES);
const AUTH_STATUS_SET = new Set<string>(HOST_AUTHORIZATION_STATUSES);
const COMPAT_STATUS_SET = new Set<string>(HOST_COMPATIBILITY_STATUSES);
const POLICY_STATE_SET = new Set<string>(HOST_EXPECTED_POLICY_STATES);
const ACTION_SET = new Set<string>(PROPOSAL_ACTIONS);

export function isScopeType(value: unknown): value is (typeof SCOPE_TYPES)[number] {
  return typeof value === "string" && SCOPE_TYPE_SET.has(value);
}

export function isPrincipalType(value: unknown): value is (typeof PRINCIPAL_TYPES)[number] {
  return typeof value === "string" && PRINCIPAL_TYPE_SET.has(value);
}

export function isLane(value: unknown): value is (typeof HOST_LANES)[number] {
  return typeof value === "string" && LANE_SET.has(value);
}

export function isAuthStatus(
  value: unknown,
): value is (typeof HOST_AUTHORIZATION_STATUSES)[number] {
  return typeof value === "string" && AUTH_STATUS_SET.has(value);
}

export function isCompatStatus(
  value: unknown,
): value is (typeof HOST_COMPATIBILITY_STATUSES)[number] {
  return typeof value === "string" && COMPAT_STATUS_SET.has(value);
}

export function isPolicyState(
  value: unknown,
): value is (typeof HOST_EXPECTED_POLICY_STATES)[number] {
  return typeof value === "string" && POLICY_STATE_SET.has(value);
}

export function isAction(value: unknown): value is (typeof PROPOSAL_ACTIONS)[number] {
  return typeof value === "string" && ACTION_SET.has(value);
}

export type ItemView = {
  index: number;
  path: string;
  raw: unknown;
  object: Record<string, unknown> | undefined;
  ruleId: unknown;
  field: unknown;
  action: unknown;
  proposedValue: unknown;
};

export function readItems(proposal: Record<string, unknown>): ItemView[] {
  if (!Array.isArray(proposal.items)) {
    return [];
  }
  return proposal.items.map((raw, index) => {
    const object = isPlainObject(raw) ? raw : undefined;
    return {
      index,
      path: indexPath("proposal.items", index),
      raw,
      object,
      ruleId: object?.ruleId,
      field: object?.field,
      action: object?.action,
      proposedValue: object?.proposedValue,
    };
  });
}

export function policyVersionsEqual(left: unknown, right: unknown): boolean {
  if (!isPlainObject(left) || !isPlainObject(right)) {
    return false;
  }
  return (
    left.policyHash === right.policyHash &&
    left.protocolVersion === right.protocolVersion &&
    left.compilerRevision === right.compilerRevision
  );
}
