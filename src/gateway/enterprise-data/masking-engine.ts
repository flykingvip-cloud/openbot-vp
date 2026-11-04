import { sha256Digest } from "./digest-utils.js";
import type {
  ClassificationRuntimeConfig,
  ConnectorActionRef,
  DataClassification,
  EnterpriseDataStore,
  FieldClassification,
  MaskingPolicy,
  MaskingResult,
} from "./types.js";
import { buildConnectorActionRefKey } from "./types.js";

function collectFieldPaths(value: unknown, prefix = ""): string[] {
  if (value == null || typeof value !== "object") {
    return prefix ? [prefix] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectFieldPaths(item, `${prefix}[${index}]`));
  }
  const record = value as Record<string, unknown>;
  const paths: string[] = [];
  for (const [key, child] of Object.entries(record)) {
    const path = prefix ? `${prefix}.${key}` : key;
    // Recurse into arrays and plain objects. Treating array props (e.g. yonyou
    // `records`) as opaque leaves made fail_closed_redact replace the whole
    // array with "***", so AggregateTemplate wrote Feed count:0 while sync
    // (no masking) still saw rows.
    if (child != null && typeof child === "object") {
      paths.push(...collectFieldPaths(child, path));
    } else if (child != null) {
      paths.push(path);
    }
  }
  return paths;
}

/** Exact path, then `records[0].Code` → `records[*].Code` for seeded wildcards. */
function resolveClassificationForPath(
  classificationByPath: Map<string, FieldClassification>,
  fieldPath: string,
): FieldClassification | undefined {
  const exact = classificationByPath.get(fieldPath);
  if (exact) {
    return exact;
  }
  const starred = fieldPath.replace(/\[\d+\]/g, "[*]");
  if (starred !== fieldPath) {
    return classificationByPath.get(starred);
  }
  return undefined;
}

function getValueAtPath(value: unknown, fieldPath: string): unknown {
  const segments = fieldPath.replace(/\[(\d+)\]/g, ".$1").split(".");
  let current: unknown = value;
  for (const segment of segments) {
    if (current == null || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function setValueAtPath(value: unknown, fieldPath: string, nextValue: unknown): unknown {
  const segments = fieldPath.replace(/\[(\d+)\]/g, ".$1").split(".");
  const clone = structuredClone(value);
  let current: Record<string, unknown> = clone as Record<string, unknown>;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    const child = current[segment];
    if (child == null || typeof child !== "object") {
      current[segment] = {};
    }
    current = current[segment] as Record<string, unknown>;
  }
  current[segments.at(-1)!] = nextValue;
  return clone;
}

function deleteValueAtPath(value: unknown, fieldPath: string): unknown {
  const segments = fieldPath.replace(/\[(\d+)\]/g, ".$1").split(".");
  const clone = structuredClone(value);
  let current: Record<string, unknown> = clone as Record<string, unknown>;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    const child = current[segment];
    if (child == null || typeof child !== "object") {
      return clone;
    }
    current = child as Record<string, unknown>;
  }
  delete current[segments.at(-1)!];
  return clone;
}

function applyMaskingStrategy(strategy: MaskingPolicy["strategy"], raw: unknown): unknown {
  if (raw == null) {
    return raw;
  }
  if (typeof raw !== "string" && typeof raw !== "number" && typeof raw !== "boolean") {
    return raw;
  }
  const text = String(raw);
  switch (strategy) {
    case "partial_phone":
      return text.length >= 7 ? `${text.slice(0, 3)}****${text.slice(-4)}` : "***";
    case "partial_email": {
      const at = text.indexOf("@");
      if (at <= 1) {
        return "***";
      }
      return `${text.slice(0, 1)}***${text.slice(at)}`;
    }
    case "hash":
      return sha256Digest(text).slice(0, 12);
    case "aggregate_only":
      return "[aggregated]";
    case "redact":
    default:
      return "***";
  }
}

export function resolveFieldClassificationsForAction(
  store: EnterpriseDataStore,
  tenantId: string,
  ref: ConnectorActionRef,
): FieldClassification[] {
  const key = buildConnectorActionRefKey(ref);
  return Object.values(store.fieldClassifications).filter(
    (item) => item.tenantId === tenantId && buildConnectorActionRefKey(item) === key,
  );
}

export function applyClassificationMasking(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  ref: ConnectorActionRef;
  payload: unknown;
  runtimeConfig?: ClassificationRuntimeConfig;
}): MaskingResult {
  const runtimeConfig = params.runtimeConfig ??
    params.store.classificationRuntimeConfigs[params.tenantId] ?? {
      tenantId: params.tenantId,
      unknownFieldPolicy: "fail_closed_redact" as const,
      strictMode: true,
      updatedAt: new Date().toISOString(),
    };
  const classifications = resolveFieldClassificationsForAction(
    params.store,
    params.tenantId,
    params.ref,
  );
  const classificationByPath = new Map(classifications.map((item) => [item.fieldPath, item]));
  const classificationDigest = sha256Digest(
    classifications
      .map((item) => ({
        fieldPath: item.fieldPath,
        classification: item.classification,
        maskingPolicyId: item.maskingPolicyId,
        blockDetail: item.blockDetail,
      }))
      .toSorted((left, right) => left.fieldPath.localeCompare(right.fieldPath)),
  );

  let data = structuredClone(params.payload);
  const maskedFields: string[] = [];
  const blockedFields: string[] = [];
  const unknownFields: string[] = [];
  const appliedClassifications = new Set<DataClassification>();

  for (const fieldPath of collectFieldPaths(params.payload)) {
    const classification = resolveClassificationForPath(classificationByPath, fieldPath);
    if (!classification) {
      if (!runtimeConfig.strictMode) {
        continue;
      }
      unknownFields.push(fieldPath);
      const rawUnknown = getValueAtPath(data, fieldPath);
      // Never collapse structured values to a string redact token — only scalars.
      if (rawUnknown != null && typeof rawUnknown === "object") {
        continue;
      }
      if (runtimeConfig.unknownFieldPolicy === "fail_closed_block") {
        data = deleteValueAtPath(data, fieldPath);
        blockedFields.push(fieldPath);
      } else {
        data = setValueAtPath(data, fieldPath, "***");
        maskedFields.push(fieldPath);
      }
      continue;
    }
    appliedClassifications.add(classification.classification);
    if (classification.classification === "RESTRICTED" && classification.blockDetail !== false) {
      data = deleteValueAtPath(data, fieldPath);
      blockedFields.push(fieldPath);
      continue;
    }
    if (classification.classification === "CONFIDENTIAL") {
      const maskingPolicy = classification.maskingPolicyId
        ? params.store.maskingPolicies[classification.maskingPolicyId]
        : undefined;
      const strategy = maskingPolicy?.strategy ?? "redact";
      const raw = getValueAtPath(data, fieldPath);
      data = setValueAtPath(data, fieldPath, applyMaskingStrategy(strategy, raw));
      maskedFields.push(fieldPath);
    }
  }

  return {
    data,
    masked: maskedFields.length > 0 || blockedFields.length > 0 || unknownFields.length > 0,
    maskedFields,
    blockedFields,
    unknownFields,
    classifications: [...appliedClassifications],
    classificationDigest,
  };
}
