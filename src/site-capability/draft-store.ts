/**
 * Private declarative drafts. A draft is a candidate, not an enabled capability.
 * The plan uses the finite operation set only. Artifact bytes stay immutable.
 */

import { createHash } from "node:crypto";
import type { SkillLifecycleHint } from "../gateway/skill-capability-contract.js";
import { SAR_DENIAL_CODE, sarDeny, type SarDenial } from "./codes.js";
import { parseSiteCapabilityManifest, type SiteCapabilityManifest } from "./contract.js";
import { findSarScriptKey } from "./operations.js";
import type { SiteVerification } from "./result.js";
import type { SiteCapabilityRecord, SiteInputField, SitePlanStep } from "./runtime.js";

const CONTEXT_NAMES = new Set(["session", "page", "search", "detail"]);
const FIELD_NAME = /^[A-Za-z][A-Za-z0-9_]{0,32}$/;

const STEP_KEYS: Record<SitePlanStep["op"], readonly string[]> = {
  navigate: ["op", "urlTemplate"],
  read_page: ["op", "fields"],
  request_context: ["op", "name"],
  capture_result: ["op", "fields"],
};

export type VerifiedSuccessEvidence = {
  evidenceRef: string;
  runId: string;
  capabilityId: string;
  version: string;
  artifactDigest: string;
  args: Readonly<Record<string, string>>;
  plan: readonly SitePlanStep[];
  manifest: SiteCapabilityManifest;
  inputFields: readonly SiteInputField[];
  accountBindingId: string;
  tenantId: string;
  userId: string;
  packageId: string;
  output: unknown;
  completeness: "complete";
  status: "succeeded";
  /** Copied from the run. Completeness does not force this to `passed`. */
  verification: SiteVerification;
};

export type PrivatePlanDraft = {
  draftId: string;
  capabilityId: string;
  version: string;
  lifecycle: Extract<SkillLifecycleHint, "private" | "approved">;
  enabled: boolean;
  published: false;
  manifest: SiteCapabilityManifest;
  plan: readonly SitePlanStep[];
  inputFields: readonly SiteInputField[];
  artifactDigest: string;
  sourceEvidenceRef: string;
  generationParams: Readonly<Record<string, string>>;
  accountBindingIds: readonly string[];
  tenantId: string;
  userId: string;
  packageId: string;
  createdAt: string;
  revisionOf?: string;
};

export type DraftAcceptance = {
  draftId: string;
  capabilityId: string;
  version: string;
  artifactDigest: string;
  lifecycle: "approved";
  enabled: true;
  published: false;
  validationRecordId: string;
  reviewer: string;
  acceptedAt: string;
};

export function declarativeArtifactDigest(
  capabilityId: string,
  version: string,
  plan: readonly SitePlanStep[],
): string {
  const body = JSON.stringify({ capabilityId, version, plan });
  return `sha256:${createHash("sha256").update(body).digest("hex")}`;
}

export function nextPrivateVersion(version: string): string {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) {
    return `${version}-r1`;
  }
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}

export function copyPlan(plan: readonly SitePlanStep[]): SitePlanStep[] {
  return JSON.parse(JSON.stringify(plan)) as SitePlanStep[];
}

function asRecord(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  return raw as Record<string, unknown>;
}

function parseFields(raw: unknown, op: string): { ok: true; fields: string[] } | SarDenial {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 32) {
    return sarDeny(SAR_DENIAL_CODE.opNotInSet, `${op} requires a bounded fields array`);
  }
  const fields: string[] = [];
  for (const field of raw) {
    if (typeof field !== "string" || !FIELD_NAME.test(field)) {
      return sarDeny(SAR_DENIAL_CODE.evaluate, "plan fields cannot carry a script");
    }
    fields.push(field);
  }
  return { ok: true, fields };
}

/** Finite declarative steps only. Script keys and unknown operations are rejected. */
export function parseDeclarativePlan(raw: unknown): { ok: true; plan: SitePlanStep[] } | SarDenial {
  const scriptKey = findSarScriptKey(raw);
  if (scriptKey) {
    return sarDeny(
      SAR_DENIAL_CODE.evaluate,
      `SAR rejects page script payload (${scriptKey}) even when browser evaluate is enabled`,
    );
  }
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 16) {
    return sarDeny(SAR_DENIAL_CODE.opNotInSet, "declarative plan must be a bounded step list");
  }
  const plan: SitePlanStep[] = [];
  for (const stepRaw of raw) {
    const step = asRecord(stepRaw);
    if (!step) {
      return sarDeny(SAR_DENIAL_CODE.opNotInSet, "plan step must be an object");
    }
    const op = step.op;
    if (op === "evaluate" || op === "eval" || op === "js") {
      return sarDeny(
        SAR_DENIAL_CODE.evaluate,
        "SAR rejects page script payload (evaluate) even when browser evaluate is enabled",
      );
    }
    if (
      op !== "navigate" &&
      op !== "read_page" &&
      op !== "request_context" &&
      op !== "capture_result"
    ) {
      return sarDeny(
        SAR_DENIAL_CODE.opNotInSet,
        `operation is outside the finite set: ${String(op)}`,
      );
    }
    for (const key of Object.keys(step)) {
      if (!STEP_KEYS[op].includes(key)) {
        return sarDeny(SAR_DENIAL_CODE.opNotInSet, `unexpected field ${key} on ${op}`);
      }
    }
    if (op === "navigate") {
      if (typeof step.urlTemplate !== "string" || !step.urlTemplate.startsWith("https://")) {
        return sarDeny(SAR_DENIAL_CODE.opNotInSet, "navigate requires an https url template");
      }
      plan.push({ op: "navigate", urlTemplate: step.urlTemplate });
      continue;
    }
    if (op === "request_context") {
      if (typeof step.name !== "string" || !CONTEXT_NAMES.has(step.name)) {
        return sarDeny(SAR_DENIAL_CODE.opNotInSet, "request_context name is not in the allowlist");
      }
      plan.push({
        op: "request_context",
        name: step.name as "session" | "page" | "search" | "detail",
      });
      continue;
    }
    const fields = parseFields(step.fields, op);
    if (!fields.ok) {
      return fields;
    }
    plan.push(op === "read_page" ? { op, fields: fields.fields } : { op, fields: fields.fields });
  }
  return { ok: true, plan };
}

export function sameParams(
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>,
): boolean {
  const leftKeys = Object.keys(left).toSorted();
  const rightKeys = Object.keys(right).toSorted();
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }
  return leftKeys.every((key, index) => key === rightKeys[index] && left[key] === right[key]);
}

export function draftToSiteRecord(
  draft: PrivatePlanDraft,
  verification: SiteCapabilityRecord["verification"],
): SiteCapabilityRecord {
  const required = draft.inputFields.filter((field) => field.required).map((field) => field.name);
  return {
    manifest: draft.manifest,
    inputFields: draft.inputFields,
    inputSchema: {
      type: "object",
      properties: Object.fromEntries(
        draft.inputFields.map((field) => [field.name, { type: "string" }]),
      ),
      required,
      additionalProperties: false,
    },
    outputSchema: { type: "object" },
    accountSummary:
      draft.manifest.authMode === "browser_session"
        ? "Requires the signed-in account browser session for this capability."
        : "No site login. Runs in the caller's account browser.",
    verification,
    artifactDigest: draft.artifactDigest,
    disabled: false,
    packageId: draft.packageId,
    plan: copyPlan(draft.plan),
    lifecycle: draft.lifecycle,
  };
}

export function candidateRecord(input: {
  manifest: SiteCapabilityManifest;
  inputFields: readonly SiteInputField[];
  plan: readonly SitePlanStep[];
  packageId: string;
}): SiteCapabilityRecord {
  return draftToSiteRecord(
    {
      draftId: "candidate",
      capabilityId: input.manifest.id,
      version: input.manifest.version,
      lifecycle: "private",
      enabled: false,
      published: false,
      manifest: input.manifest,
      plan: input.plan,
      inputFields: input.inputFields,
      artifactDigest: declarativeArtifactDigest(
        input.manifest.id,
        input.manifest.version,
        input.plan,
      ),
      sourceEvidenceRef: "",
      generationParams: {},
      accountBindingIds: [],
      tenantId: "",
      userId: "",
      packageId: input.packageId,
      createdAt: "",
    },
    "unverified",
  );
}

export class DraftStore {
  private readonly drafts = new Map<string, PrivatePlanDraft>();

  put(draft: PrivatePlanDraft): void {
    this.drafts.set(draft.draftId, draft);
  }

  get(draftId: string): PrivatePlanDraft | undefined {
    const found = this.drafts.get(draftId);
    return found ? { ...found, plan: copyPlan(found.plan) } : undefined;
  }

  list(): PrivatePlanDraft[] {
    return [...this.drafts.values()].map((draft) => ({ ...draft, plan: copyPlan(draft.plan) }));
  }

  markApproved(draftId: string): { ok: true; draft: PrivatePlanDraft } | SarDenial {
    const found = this.drafts.get(draftId);
    if (!found) {
      return sarDeny(SAR_DENIAL_CODE.invalidManifest, "draft was not found");
    }
    const next: PrivatePlanDraft = {
      ...found,
      lifecycle: "approved",
      enabled: true,
      published: false,
    };
    this.drafts.set(draftId, next);
    return { ok: true, draft: { ...next, plan: copyPlan(next.plan) } };
  }
}

export function parseDraftManifest(
  raw: unknown,
): { ok: true; manifest: SiteCapabilityManifest } | SarDenial {
  return parseSiteCapabilityManifest(raw);
}
