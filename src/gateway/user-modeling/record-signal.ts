import type { OpenBotConfig } from "../../config/config.js";
import { logVerbose } from "../../globals.js";
import { userModelingEnabled, userModelingInferEnabled } from "./config.js";
import {
  detectPreferredTimezone,
  detectReplyLanguage,
  detectUserPreferenceDirectives,
  type UserInteractionSignals,
} from "./derive.js";
import {
  inferUserProfileSignals,
  mergeUserInteractionSignals,
  type UserProfileInferCaller,
} from "./infer.js";
import type { UserModelingKey } from "./user-key.js";
import {
  applyUserInteractionSignals,
  assessAndMarkUserProfileEffect,
  frictionFromSignals,
  readUserProfileChange,
  readUserProfileOrDefault,
} from "./user-profile-store.js";

let productionInferCaller: UserProfileInferCaller | null | undefined;

async function resolveProductionInferCaller(
  cfg: OpenBotConfig,
  tenantId?: string | null,
): Promise<UserProfileInferCaller | null> {
  if (!userModelingInferEnabled(cfg, tenantId)) {
    return null;
  }
  if (productionInferCaller !== undefined) {
    return productionInferCaller;
  }
  try {
    const { createAgentKnowledgeLlmCaller } =
      await import("../knowledge/agent-knowledge-generator.js");
    const knowledgeCaller = createAgentKnowledgeLlmCaller({ cfg });
    productionInferCaller = knowledgeCaller
      ? async (prompt) => {
          const result = await knowledgeCaller({ prompt, maxTokens: 256 });
          return result?.text?.trim() || null;
        }
      : async () => null;
  } catch {
    productionInferCaller = async () => null;
  }
  return productionInferCaller;
}

/** Test hook: override or reset the lazy production infer caller. */
export function setUserProfileInferCallerForTests(caller: UserProfileInferCaller | null): void {
  productionInferCaller = caller;
}

function buildSignals(inboundText: string): UserInteractionSignals {
  return {
    directives: detectUserPreferenceDirectives(inboundText),
    replyLanguage: detectReplyLanguage(inboundText),
    preferredTimezone: detectPreferredTimezone(inboundText),
  };
}

async function enrichSignals(
  cfg: OpenBotConfig,
  key: UserModelingKey,
  signals: UserInteractionSignals,
  callerOverride?: UserProfileInferCaller | null,
): Promise<UserInteractionSignals> {
  if (!userModelingInferEnabled(cfg, key.tenantId)) {
    return signals;
  }
  const profile = await readUserProfileOrDefault(cfg, key);
  const caller =
    callerOverride !== undefined
      ? callerOverride
      : await resolveProductionInferCaller(cfg, key.tenantId);
  const inferred = await inferUserProfileSignals({
    cfg,
    profile,
    signals,
    caller,
    tenantId: key.tenantId,
  });
  return mergeUserInteractionSignals(signals, inferred);
}

/** Fire-and-forget user preference capture; never throws to callers. */
export async function recordUserInteractionSignalSafely(
  cfg: OpenBotConfig,
  key: UserModelingKey,
  inboundText: string,
  opts?: { inferCaller?: UserProfileInferCaller | null },
): Promise<void> {
  if (!userModelingEnabled(cfg, key.tenantId)) {
    return;
  }
  const trimmed = inboundText.trim();
  if (!trimmed) {
    return;
  }
  try {
    let signals = buildSignals(trimmed);
    signals = await enrichSignals(cfg, key, signals, opts?.inferCaller);
    const change = await readUserProfileChange(cfg, key);
    const baselineFriction = change?.baselineFriction ?? null;
    const currentFriction = frictionFromSignals(change, signals);
    if (change && change.assessedAtMs === null) {
      await assessAndMarkUserProfileEffect(cfg, key, currentFriction);
    }
    await applyUserInteractionSignals(cfg, key, signals, baselineFriction);
  } catch (err) {
    logVerbose(
      `user-modeling: record signal failed (${err instanceof Error ? err.name : "error"})`,
    );
  }
}
