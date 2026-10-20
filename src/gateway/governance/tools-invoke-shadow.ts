/**
 * /tools/invoke capability governance (plan v1.0 PR-7 / E8, PR-P5-2, PR-P5-4).
 *
 * `OPENBOT_GOVERNANCE_TOOLS_INVOKE_MODE` is `legacy | shadow | enforced` and
 * defaults to `shadow`. The code default is never `enforced`.
 *
 * `OPENBOT_GOVERNANCE_TOOLS_INVOKE_SHADOW` defaults off. It does not read the
 * HTTP tools preflight observe switch. Under `shadow` mode the shadow writes
 * one envelope after the HTTP deny list has already accepted the tool, only
 * when this flag is on. It never changes the response and never writes the
 * management audit stream.
 *
 * Under `enforced`, capability is evaluated even when the shadow flag is off.
 * Only an explicit capability `deny` changes the HTTP result (same 404
 * not_found shape as the gateway HTTP deny list). `allow` continues.
 * `skipped` / unevaluated never become allow and never block.
 *
 * `legacy` skips capability evaluate for HTTP: no policy lookup, no HTTP
 * change. When the shadow flag is on it may still record a skipped envelope.
 *
 * No enterprise scope is `skipped` + `legacy`. An enterprise scope evaluates
 * `gateway.tools.tenantCapabilities` (allow | deny | unset). A clear allow or
 * deny is that effect. Unset or a lookup failure stays `skipped` and is never
 * recorded as allow.
 */

import { isTruthyEnvValue } from "../../infra/env.js";
import { resolveGovernanceDecisionIds } from "./decision-id.js";
import {
  classifyDivergence,
  createGovernanceDecision,
  createLegacySkippedDecision,
  type GovernanceDecision,
  type GovernanceEffect,
  type GovernanceMode,
} from "./decision.js";
import { resolveGovernanceModeFromEnv, type GovernanceDefaultMode } from "./mode.js";
import { recordShadowEvaluationFailure } from "./shadow-failure.js";
import { appendGovernanceShadowDecision } from "./shadow-sink.js";
import {
  evaluateToolsInvokeCapability,
  type ToolsInvokeCapabilityLookup,
  type ToolsInvokeCapabilityPolicyTable,
} from "./tools-invoke-capability.js";

export const TOOLS_INVOKE_SHADOW_ENV = "OPENBOT_GOVERNANCE_TOOLS_INVOKE_SHADOW";

export const TOOLS_INVOKE_MODE_ENV = "OPENBOT_GOVERNANCE_TOOLS_INVOKE_MODE";

/** Code default for tools/invoke MODE. Never `enforced`. */
export const TOOLS_INVOKE_MODE_DEFAULT: GovernanceDefaultMode = "shadow";

/** Execution entry stamped on every /tools/invoke envelope. */
const TOOLS_INVOKE_ENTRY = "E8";

export function isToolsInvokeShadowEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return isTruthyEnvValue(env[TOOLS_INVOKE_SHADOW_ENV]);
}

export function resolveToolsInvokeGovernanceMode(
  env: NodeJS.ProcessEnv = process.env,
): GovernanceMode {
  return resolveGovernanceModeFromEnv({
    envName: TOOLS_INVOKE_MODE_ENV,
    defaultMode: TOOLS_INVOKE_MODE_DEFAULT,
    env,
  });
}

/** HTTP rejection aligned with the gateway HTTP deny-list path (404 not_found). */
export type ToolsInvokeCapabilityHttpReject = {
  status: 404;
  body: {
    ok: false;
    error: { type: "not_found"; message: string };
  };
};

export type ToolsInvokeGovernanceApplyResult = {
  /** Set only when MODE is enforced and capability effect is deny. */
  reject?: ToolsInvokeCapabilityHttpReject;
  decision?: GovernanceDecision;
};

function actorIdFromIdentity(params: {
  platformUserId?: string;
  membershipId?: string;
}): string | undefined {
  const platformUserId = params.platformUserId?.trim();
  if (platformUserId) {
    return `platform-user:${platformUserId}`;
  }
  const membershipId = params.membershipId?.trim();
  if (membershipId) {
    return `membership:${membershipId}`;
  }
  return undefined;
}

function existingHttpAllow() {
  return {
    effect: "allow" as const,
    source: "capability" as const,
    reason: "not-enforced",
  };
}

function enterpriseCapabilityDecision(params: {
  toolName: string;
  tenantId: string;
  actorId?: string;
  requestId?: string;
  decisionId: string;
  mode: GovernanceMode;
  capabilityPolicy?: ToolsInvokeCapabilityPolicyTable | null;
  capabilityLookup?: ToolsInvokeCapabilityLookup;
  ts: string;
}): GovernanceDecision {
  const evaluation = evaluateToolsInvokeCapability({
    tenantId: params.tenantId,
    toolName: params.toolName,
    policy: params.capabilityPolicy,
    lookup: params.capabilityLookup,
  });
  const effect: GovernanceEffect =
    evaluation.effect === "allow" || evaluation.effect === "deny" ? evaluation.effect : "skipped";
  const reason =
    effect === "allow" || effect === "deny"
      ? evaluation.effect === "allow"
        ? "tenant-capability-allow"
        : "tenant-capability-deny"
      : evaluation.absence === "absent"
        ? "capability-policy-absent"
        : "tenant-capability-not-enforced";
  const existing = existingHttpAllow();
  return createGovernanceDecision({
    effect,
    decisionId: params.decisionId,
    source: "capability",
    entry: TOOLS_INVOKE_ENTRY,
    mode: params.mode,
    reason,
    ...(params.requestId ? { requestId: params.requestId } : {}),
    tenantId: params.tenantId,
    ...(params.actorId ? { actorId: params.actorId } : {}),
    subject: { kind: "capability", id: params.toolName },
    ...(params.mode === "shadow"
      ? {
          shadow: {
            existing,
            divergence: classifyDivergence({
              existing: "allow",
              shadow: effect,
            }),
          },
        }
      : {}),
    ts: params.ts,
  });
}

function buildToolsInvokeDecision(params: {
  toolName: string;
  enterpriseId?: string;
  platformUserId?: string;
  membershipId?: string;
  requestId?: string;
  mode: GovernanceMode;
  capabilityPolicy?: ToolsInvokeCapabilityPolicyTable | null;
  capabilityLookup?: ToolsInvokeCapabilityLookup;
}): GovernanceDecision {
  const ids = resolveGovernanceDecisionIds({ source: "capability" });
  const tenantId = params.enterpriseId?.trim() || undefined;
  const actorId = actorIdFromIdentity(params);
  const subject = { kind: "capability" as const, id: params.toolName };
  const existing = existingHttpAllow();
  const ts = new Date().toISOString();

  if (params.mode === "legacy") {
    return createLegacySkippedDecision({
      decisionId: ids.decisionId,
      source: "capability",
      entry: TOOLS_INVOKE_ENTRY,
      reason: tenantId ? "legacy" : "no-enterprise-scope",
      ...(params.requestId ? { requestId: params.requestId } : {}),
      ...(tenantId ? { tenantId } : {}),
      ...(actorId ? { actorId } : {}),
      subject,
      shadow: {
        existing,
        divergence: classifyDivergence({
          existing: "allow",
          shadow: "skipped",
        }),
      },
      ts,
    });
  }

  if (!tenantId) {
    return createLegacySkippedDecision({
      decisionId: ids.decisionId,
      source: "capability",
      entry: TOOLS_INVOKE_ENTRY,
      reason: "no-enterprise-scope",
      ...(params.requestId ? { requestId: params.requestId } : {}),
      ...(actorId ? { actorId } : {}),
      subject,
      shadow: {
        existing,
        divergence: classifyDivergence({
          existing: "allow",
          shadow: "skipped",
        }),
      },
      ts,
    });
  }

  return enterpriseCapabilityDecision({
    toolName: params.toolName,
    tenantId,
    ...(actorId ? { actorId } : {}),
    ...(params.requestId ? { requestId: params.requestId } : {}),
    decisionId: ids.decisionId,
    mode: params.mode,
    capabilityPolicy: params.capabilityPolicy,
    capabilityLookup: params.capabilityLookup,
    ts,
  });
}

function httpRejectForCapabilityDeny(toolName: string): ToolsInvokeCapabilityHttpReject {
  return {
    status: 404,
    body: {
      ok: false,
      error: {
        type: "not_found",
        message: `Tool not available: ${toolName}`,
      },
    },
  };
}

/**
 * Applies tools/invoke governance for the HTTP path.
 *
 * - `legacy`: no capability evaluate; optional skipped envelope when shadow flag on; never rejects.
 * - `shadow` (default): evaluate + append only when shadow flag on; never rejects.
 * - `enforced`: always evaluate; append when possible; reject HTTP only on explicit deny.
 */
export async function applyToolsInvokeGovernance(params: {
  toolName: string;
  enterpriseId?: string;
  platformUserId?: string;
  membershipId?: string;
  requestId?: string;
  env?: NodeJS.ProcessEnv;
  /** `gateway.tools.tenantCapabilities`. Omitted means the table is not configured. */
  capabilityPolicy?: ToolsInvokeCapabilityPolicyTable | null;
  /** Test and caller hook. A throw is a lookup failure, not an allow. */
  capabilityLookup?: ToolsInvokeCapabilityLookup;
}): Promise<ToolsInvokeGovernanceApplyResult> {
  const env = params.env ?? process.env;
  const mode = resolveToolsInvokeGovernanceMode(env);
  const shadowFlagOn = isToolsInvokeShadowEnabled(env);

  // Shadow mode stays opt-in via TOOLS_INVOKE_SHADOW (default off).
  // Legacy only records when that flag is on (and never evaluates policy).
  // Enforced always evaluates so deny can change HTTP.
  if (mode === "shadow" && !shadowFlagOn) {
    return {};
  }
  if (mode === "legacy" && !shadowFlagOn) {
    return {};
  }

  try {
    const decision = buildToolsInvokeDecision({
      toolName: params.toolName,
      enterpriseId: params.enterpriseId,
      platformUserId: params.platformUserId,
      membershipId: params.membershipId,
      requestId: params.requestId,
      mode,
      capabilityPolicy: params.capabilityPolicy,
      capabilityLookup: params.capabilityLookup,
    });
    await appendGovernanceShadowDecision(decision, { env });

    if (mode === "enforced" && decision.effect === "deny") {
      return {
        decision,
        reject: httpRejectForCapabilityDeny(params.toolName),
      };
    }
    return { decision };
  } catch (error) {
    console.warn(`[governance] /tools/invoke governance failed: ${String(error)}`);
    // D6: the evaluation threw. Record it; the request continues on the existing path
    // (no reject, including under `enforced`).
    recordShadowEvaluationFailure({
      env,
      fields: () => {
        const tenantId = params.enterpriseId?.trim() || undefined;
        return {
          source: "capability",
          entry: TOOLS_INVOKE_ENTRY,
          mode,
          existing: existingHttpAllow(),
          requestId: params.requestId,
          tenantId,
          actorId: actorIdFromIdentity(params),
          subject: { kind: "capability", id: params.toolName },
        };
      },
    });
    return {};
  }
}

/**
 * Shadow-only helper preserved for unit tests and callers that only want the
 * envelope path. Under default `shadow` mode this matches pre-P5-4 behavior.
 * It never rejects HTTP; use `applyToolsInvokeGovernance` on the HTTP path.
 */
export async function recordToolsInvokeShadow(params: {
  toolName: string;
  enterpriseId?: string;
  platformUserId?: string;
  membershipId?: string;
  requestId?: string;
  env?: NodeJS.ProcessEnv;
  capabilityPolicy?: ToolsInvokeCapabilityPolicyTable | null;
  capabilityLookup?: ToolsInvokeCapabilityLookup;
}): Promise<void> {
  const env = params.env ?? process.env;
  // Force shadow-path semantics for this helper: never HTTP-reject.
  // If caller did not set MODE, default shadow applies. If they set enforced,
  // still only record (tests that need reject should call applyToolsInvokeGovernance).
  const mode = resolveToolsInvokeGovernanceMode(env);
  if (mode === "enforced") {
    // Record via apply but strip reject — this helper is observe-only.
    const result = await applyToolsInvokeGovernance(params);
    void result;
    return;
  }
  await applyToolsInvokeGovernance(params);
}
