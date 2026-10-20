/**
 * Inbound media-understanding model shadow (execution entry E19).
 *
 * Why this entry exists at all: before an agent turn starts, the auto-reply pipeline
 * runs `applyMediaUnderstanding`, which picks a model and calls the provider SDK
 * directly (`describeImageWithModel` → `complete`, `transcribeAudio`, video
 * description). That path never touches `runWithModelFallback` /
 * `runWithImageModelFallback`, so:
 *
 *  - it is invisible to the §4.8 model-caller contract, whose coverage rule is
 *    "every production caller of the two fallback helpers", and
 *  - the entitlement allowlist is never consulted, in any mode.
 *
 * It therefore produced no governance row of any class — not even `skipped`. A
 * tenant-001 traffic test on 2026-10-01 attached a PNG, got a description back from
 * `api-proxy-deepseek/deepseek-v4-flash`, and the shadow ledger stayed silent.
 *
 * What this records: one `skipped` envelope per understood attachment, naming the
 * model that actually ran. `skipped` is the honest effect — a model was selected
 * here and governance did not evaluate it — and it makes the gap countable in the
 * offline reports instead of absent. Recording only; it never changes a run, and
 * `enforced` is not implemented for this entry.
 *
 * Attribution comes from the inbound turn (`GatewayClientSessionEnterpriseId` /
 * `GatewayClientPlatformUserId`). There is deliberately no `runId`: this runs before
 * the agent run exists, which is also why no parent model set can be looked up.
 */

import { isTruthyEnvValue } from "../../infra/env.js";
import { newGovernanceDecisionId } from "./decision-id.js";
import {
  classifyDivergence,
  createGovernanceDecision,
  type GovernanceDecision,
  type GovernanceMode,
} from "./decision.js";
import { resolveGovernanceModeFromEnv } from "./mode.js";
import { appendGovernanceShadowDecision } from "./shadow-sink.js";
import { actorIdFromIdentity } from "./spawn-snapshot-handoff.js";

export const MEDIA_UNDERSTANDING_ENTRY = "E19";
export const MEDIA_UNDERSTANDING_MODE_ENV = "OPENBOT_GOVERNANCE_MEDIA_UNDERSTANDING_MODE";
/** Separate opt-in, same shape as the tools-invoke and node-invoke shadow flags. */
export const MEDIA_UNDERSTANDING_SHADOW_ENV = "OPENBOT_GOVERNANCE_MEDIA_UNDERSTANDING_SHADOW";

/**
 * No allowlist is reachable at this point in the pipeline, so the reason names the
 * structural cause rather than a policy outcome.
 */
export const MEDIA_UNDERSTANDING_SKIPPED_REASON = "media-understanding-pre-agent";

export type MediaUnderstandingCapabilityKind = "image" | "audio" | "video";

/** One understood attachment: the capability and the model that actually ran. */
export type MediaUnderstandingModelUse = {
  capability: MediaUnderstandingCapabilityKind;
  provider: string;
  model: string;
};

const OUTPUT_KIND_TO_CAPABILITY: Record<string, MediaUnderstandingCapabilityKind> = {
  "image.description": "image",
  "audio.transcription": "audio",
  "video.description": "video",
};

/**
 * Maps `applyMediaUnderstanding` outputs onto the model uses to record. Kept here so
 * call sites stay a single line and an unrecognized output kind is dropped in one
 * place rather than guessed at per caller.
 */
export function mediaUnderstandingUsesFromOutputs(
  outputs: readonly { kind: string; provider?: string; model?: string }[] | undefined,
): MediaUnderstandingModelUse[] {
  const uses: MediaUnderstandingModelUse[] = [];
  for (const output of outputs ?? []) {
    const capability = OUTPUT_KIND_TO_CAPABILITY[output.kind];
    const provider = output.provider?.trim();
    const model = output.model?.trim();
    if (!capability || !provider || !model) {
      continue;
    }
    uses.push({ capability, provider, model });
  }
  return uses;
}

export function isMediaUnderstandingShadowEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return isTruthyEnvValue(env[MEDIA_UNDERSTANDING_SHADOW_ENV]);
}

export function resolveMediaUnderstandingGovernanceMode(
  env: NodeJS.ProcessEnv = process.env,
): GovernanceMode {
  // Never `enforced` by default, and `enforced` has no filtering behavior here —
  // the allowlist this entry would need does not exist yet at this pipeline stage.
  return resolveGovernanceModeFromEnv({
    envName: MEDIA_UNDERSTANDING_MODE_ENV,
    defaultMode: "shadow",
    env,
  });
}

/** Pure builder. Callers pass `ts` so the map stays testable. */
export function buildMediaUnderstandingDecision(params: {
  use: MediaUnderstandingModelUse;
  mode: GovernanceMode;
  tenantId?: string;
  actorId?: string;
  ts: string;
  uuid?: () => string;
}): GovernanceDecision {
  const tenantId = params.tenantId?.trim() || undefined;
  const actorId = params.actorId?.trim() || undefined;
  const provider = params.use.provider.trim();
  const model = params.use.model.trim();
  return createGovernanceDecision({
    decisionId: newGovernanceDecisionId(params.uuid),
    source: "model-entitlement",
    entry: MEDIA_UNDERSTANDING_ENTRY,
    mode: params.mode,
    effect: "skipped",
    reason: MEDIA_UNDERSTANDING_SKIPPED_REASON,
    matchedRules: [`media-capability:${params.use.capability}`],
    subject: { kind: "model", id: `${provider}/${model}` },
    ...(tenantId ? { tenantId } : {}),
    ...(actorId ? { actorId } : {}),
    shadow: {
      // The run keeps today's behavior: the model was invoked, unfiltered.
      existing: { effect: "allow", source: "model-entitlement", reason: "not-enforced" },
      divergence: classifyDivergence({ existing: "allow", shadow: "skipped" }),
    },
    ts: params.ts,
  });
}

/**
 * Records one envelope per understood attachment. Never throws and never changes the
 * caller's result. Returns the decisions it built, for tests and for callers that want
 * to log a count.
 */
export async function recordMediaUnderstandingShadow(params: {
  uses: readonly MediaUnderstandingModelUse[];
  tenantId?: string;
  /**
   * Inbound turn's platform user. Taken instead of a pre-built `actorId` so the
   * `platform-user:<id>` shape stays defined in one place; callers pass the raw id.
   */
  platformUserId?: string;
  env?: NodeJS.ProcessEnv;
  now?: () => string;
}): Promise<GovernanceDecision[]> {
  const env = params.env ?? process.env;
  if (!isMediaUnderstandingShadowEnabled(env)) {
    return [];
  }
  const uses = params.uses.filter((use) => use.provider?.trim() && use.model?.trim());
  if (uses.length === 0) {
    return [];
  }
  const mode = resolveMediaUnderstandingGovernanceMode(env);
  const actorId = actorIdFromIdentity({ platformUserId: params.platformUserId });
  const decisions: GovernanceDecision[] = [];
  for (const use of uses) {
    try {
      const decision = buildMediaUnderstandingDecision({
        use,
        mode,
        ...(params.tenantId ? { tenantId: params.tenantId } : {}),
        ...(actorId ? { actorId } : {}),
        ts: params.now?.() ?? new Date().toISOString(),
      });
      await appendGovernanceShadowDecision(decision, { env });
      decisions.push(decision);
    } catch (error) {
      console.warn(`[governance] media understanding shadow failed: ${String(error)}`);
    }
  }
  return decisions;
}
