import {
  isProfileInCooldown,
  type AuthProfileFailureReason,
  markAuthProfileFailure,
  resolveProfilesUnavailableReason,
} from "../../../agents/auth-profiles.js";
import { FailoverError, resolveFailoverStatus } from "../../../agents/failover-error.js";
import { ensureAuthProfileStore, getApiKeyForModel } from "../../../agents/model-auth.js";
import {
  classifyFailoverReason,
  isFailoverErrorMessage,
  type FailoverReason,
} from "../../../agents/pi-embedded-helpers.js";
import { log } from "../../../agents/pi-embedded-runner/logger.js";
import { describeUnknownError } from "../../../agents/pi-embedded-runner/utils.js";
import type { ThinkLevel } from "../../../auto-reply/thinking.js";
import { computeBackoff, sleepWithAbort } from "../../../infra/backoff.js";
import { getGlobalHookRunner } from "../../../plugins/hook-runner-global.js";
import { resolveModelHookResult } from "../../capabilities/index.js";
import {
  applyProviderCredential,
  createAuthProfileRotation,
  createCopilotTokenRefresh,
  prepareEmbeddedModel,
  resolveRunAuthProfileCandidates,
} from "../../model/index.js";
import {
  OVERLOAD_FAILOVER_BACKOFF_POLICY,
  resolveMaxRunRetryIterations,
} from "../../policy/index.js";
import type { RunEmbeddedPiAgentParams } from "./embedded-request.js";

type EmbeddedModelPrep = Awaited<ReturnType<typeof prepareEmbeddedModel>>;

export type EmbeddedRunSession = {
  provider: string;
  modelId: string;
  thinkLevel: ThinkLevel;
  initialThinkLevel: ThinkLevel;
  attemptedThinking: Set<ThinkLevel>;
  lastProfileId: string | undefined;
  agentDir: string;
  fallbackConfigured: boolean;
  authStorage: EmbeddedModelPrep["authStorage"];
  modelRegistry: EmbeddedModelPrep["modelRegistry"];
  authOverride: EmbeddedModelPrep["authOverride"];
  ctxInfo: EmbeddedModelPrep["ctxInfo"];
  effectiveModel: EmbeddedModelPrep["effectiveModel"];
  authStore: ReturnType<typeof ensureAuthProfileStore>;
  lockedProfileId: string | undefined;
  profileCandidates: string[];
  legacyBeforeAgentStartResult: Awaited<
    ReturnType<typeof resolveModelHookResult>
  >["legacyBeforeAgentStartResult"];
  copilotRefresh: ReturnType<typeof createCopilotTokenRefresh>;
  advanceAuthProfile: () => Promise<boolean>;
  maybeRefreshCopilotForAuthError: (errorText: string, retried: boolean) => Promise<boolean>;
  maybeMarkAuthProfileFailure: (failure: {
    profileId?: string;
    reason?: AuthProfileFailureReason | null;
  }) => Promise<void>;
  maybeBackoffBeforeOverloadFailover: (reason: FailoverReason | null) => Promise<void>;
  resolveAuthProfileFailureReason: (
    reason: FailoverReason | null,
  ) => AuthProfileFailureReason | null;
  MAX_RUN_LOOP_ITERATIONS: number;
};

export type EmbeddedRunLoopOutcome =
  | { action: "continue" }
  | { action: "next" }
  | { action: "return"; result: import("./embedded-result.js").EmbeddedPiRunResult };

/** before_model_resolve hooks, auth profiles, Copilot refresh, rotation, failure marks, overload backoff. */
export async function prepareEmbeddedRunAuth(args: {
  params: RunEmbeddedPiAgentParams;
  provider: string;
  modelId: string;
  agentDir: string;
  fallbackConfigured: boolean;
  resolvedWorkspace: string;
  workspaceAgentId: string;
}): Promise<EmbeddedRunSession> {
  const params = args.params;
  const agentDir = args.agentDir;
  const fallbackConfigured = args.fallbackConfigured;
  const resolvedWorkspace = args.resolvedWorkspace;
  const session = {
    provider: args.provider,
    modelId: args.modelId,
    thinkLevel: params.thinkLevel ?? "off",
    initialThinkLevel: params.thinkLevel ?? "off",
    attemptedThinking: new Set<ThinkLevel>(),
    lastProfileId: undefined as string | undefined,
  } as EmbeddedRunSession;

  // Run before_model_resolve hooks early so plugins can override the
  // session.provider/model before await resolveModel().
  //
  // Legacy compatibility: before_agent_start is also checked for override
  // fields if present. New hook takes precedence when both are set.
  const hookRunner = getGlobalHookRunner();
  const hookCtx = {
    agentId: args.workspaceAgentId,
    sessionKey: params.sessionKey,
    sessionId: params.sessionId,
    workspaceDir: resolvedWorkspace,
    messageProvider: params.messageProvider ?? undefined,
    trigger: params.trigger,
    channelId: params.messageChannel ?? params.messageProvider ?? undefined,
  };
  const { modelResolveOverride, legacyBeforeAgentStartResult } = await resolveModelHookResult({
    prompt: params.prompt,
    hookCtx,
    hookRunner,
    warn: (message) => log.warn(message),
  });
  if (modelResolveOverride?.providerOverride) {
    session.provider = modelResolveOverride.providerOverride;
    log.info(`[hooks] provider overridden to ${session.provider}`);
  }
  if (modelResolveOverride?.modelOverride) {
    session.modelId = modelResolveOverride.modelOverride;
    log.info(`[hooks] model overridden to ${session.modelId}`);
  }

  const { authStorage, modelRegistry, authOverride, ctxInfo, effectiveModel } =
    await prepareEmbeddedModel({
      config: params.config,
      provider: session.provider,
      modelId: session.modelId,
      agentDir,
      providerAuthOverride: params.providerAuthOverride,
      log,
    });

  const authStore = ensureAuthProfileStore(agentDir, { allowKeychainPrompt: false });
  const { lockedProfileId, profileCandidates } = resolveRunAuthProfileCandidates({
    config: params.config,
    store: authStore,
    provider: session.provider,
    authProfileId: params.authProfileId,
    authProfileIdSource: params.authProfileIdSource,
  });

  const initialThinkLevel = params.thinkLevel ?? "off";
  const copilotRefresh = createCopilotTokenRefresh({
    enabled: effectiveModel.provider === "github-copilot",
    setRuntimeApiKey: (token) => authStorage.setRuntimeApiKey(effectiveModel.provider, token),
    describeError: describeUnknownError,
    log,
  });

  const resolveAuthProfileFailoverReason = (params: {
    allInCooldown: boolean;
    message: string;
    profileIds?: Array<string | undefined>;
  }): FailoverReason => {
    if (params.allInCooldown) {
      const profileIds = (params.profileIds ?? profileCandidates).filter(
        (id): id is string => typeof id === "string" && id.length > 0,
      );
      return (
        resolveProfilesUnavailableReason({
          store: authStore,
          profileIds,
        }) ?? "rate_limit"
      );
    }
    const classified = classifyFailoverReason(params.message);
    return classified ?? "auth";
  };

  const throwAuthProfileFailover = (params: {
    allInCooldown: boolean;
    message?: string;
    error?: unknown;
  }): never => {
    const fallbackMessage = `No available auth profile for ${session.provider} (all in cooldown or unavailable).`;
    const message =
      params.message?.trim() ||
      (params.error ? describeUnknownError(params.error).trim() : "") ||
      fallbackMessage;
    const reason = resolveAuthProfileFailoverReason({
      allInCooldown: params.allInCooldown,
      message,
      profileIds: profileCandidates,
    });
    if (fallbackConfigured) {
      throw new FailoverError(message, {
        reason,
        provider: session.provider,
        model: session.modelId,
        status: resolveFailoverStatus(reason),
        cause: params.error,
      });
    }
    if (params.error instanceof Error) {
      throw params.error;
    }
    throw new Error(message);
  };

  const resolveApiKeyForCandidate = async (candidate?: string) => {
    return getApiKeyForModel({
      model: effectiveModel,
      cfg: params.config,
      profileId: candidate,
      store: authStore,
      agentDir,
      ...(authOverride?.apiKey
        ? {
            authOverride: {
              apiKey: authOverride.apiKey,
              ...(authOverride.source ? { source: authOverride.source } : {}),
            },
          }
        : {}),
    });
  };

  const applyApiKeyInfo = async (candidate?: string): Promise<void> => {
    const credential = await resolveApiKeyForCandidate(candidate);
    session.lastProfileId = await applyProviderCredential({
      provider: effectiveModel.provider,
      candidate,
      credential,
      setRuntimeApiKey: (provider, token) => authStorage.setRuntimeApiKey(provider, token),
      copilotRefresh,
    });
  };

  const authRotation = createAuthProfileRotation({
    candidates: profileCandidates,
    lockedProfileId,
    inCooldown: (candidate) => isProfileInCooldown(authStore, candidate),
    apply: applyApiKeyInfo,
  });
  const advanceAuthProfile = async (): Promise<boolean> => {
    const advanced = await authRotation.advance();
    if (advanced) {
      session.thinkLevel = initialThinkLevel;
      session.attemptedThinking.clear();
    }
    return advanced;
  };

  try {
    const autoProfileCandidates = profileCandidates.filter(
      (candidate): candidate is string =>
        typeof candidate === "string" && candidate.length > 0 && candidate !== lockedProfileId,
    );
    const allAutoProfilesInCooldown =
      autoProfileCandidates.length > 0 &&
      autoProfileCandidates.every((candidate) => isProfileInCooldown(authStore, candidate));
    const unavailableReason = allAutoProfilesInCooldown
      ? (resolveProfilesUnavailableReason({
          store: authStore,
          profileIds: autoProfileCandidates,
        }) ?? "rate_limit")
      : null;
    const allowTransientCooldownProbe =
      params.allowTransientCooldownProbe === true &&
      allAutoProfilesInCooldown &&
      (unavailableReason === "rate_limit" ||
        unavailableReason === "overloaded" ||
        unavailableReason === "billing");
    const initialized = await authRotation.initialize({
      allowTransientCooldownProbe,
      onProbe: () =>
        log.warn(
          "probing cooldowned auth profile for " +
            session.provider +
            "/" +
            session.modelId +
            " due to " +
            (unavailableReason ?? "transient") +
            " unavailability",
        ),
    });
    if (!initialized) {
      throwAuthProfileFailover({ allInCooldown: true });
    }
  } catch (err) {
    if (err instanceof FailoverError) {
      throw err;
    }
    if (authRotation.current === lockedProfileId) {
      throwAuthProfileFailover({ allInCooldown: false, error: err });
    }
    const advanced = await advanceAuthProfile();
    if (!advanced) {
      throwAuthProfileFailover({ allInCooldown: false, error: err });
    }
  }

  const maybeRefreshCopilotForAuthError = async (
    errorText: string,
    retried: boolean,
  ): Promise<boolean> => {
    if (!copilotRefresh.enabled || retried) {
      return false;
    }
    if (!isFailoverErrorMessage(errorText)) {
      return false;
    }
    if (classifyFailoverReason(errorText) !== "auth") {
      return false;
    }
    try {
      await copilotRefresh.refresh("auth-error");
      copilotRefresh.schedule();
      return true;
    } catch {
      return false;
    }
  };

  const MAX_RUN_LOOP_ITERATIONS = resolveMaxRunRetryIterations(profileCandidates.length);
  const maybeMarkAuthProfileFailure = async (failure: {
    profileId?: string;
    reason?: AuthProfileFailureReason | null;
    config?: RunEmbeddedPiAgentParams["config"];
    agentDir?: RunEmbeddedPiAgentParams["agentDir"];
  }) => {
    const { profileId, reason } = failure;
    if (!profileId || !reason || reason === "timeout") {
      return;
    }
    await markAuthProfileFailure({
      store: authStore,
      profileId,
      reason,
      cfg: params.config,
      agentDir,
      runId: params.runId,
    });
  };
  const resolveAuthProfileFailureReason = (
    failoverReason: FailoverReason | null,
  ): AuthProfileFailureReason | null => {
    // Timeouts are transport/model-path failures, not auth health signals,
    // so they should not persist auth-profile failure state.
    if (!failoverReason || failoverReason === "timeout") {
      return null;
    }
    return failoverReason;
  };
  let overloadFailoverAttempts = 0;
  const maybeBackoffBeforeOverloadFailover = async (reason: FailoverReason | null) => {
    if (reason !== "overloaded") {
      return;
    }
    overloadFailoverAttempts += 1;
    const delayMs = computeBackoff(OVERLOAD_FAILOVER_BACKOFF_POLICY, overloadFailoverAttempts);
    log.warn(
      `overload backoff before failover for ${session.provider}/${session.modelId}: attempt=${overloadFailoverAttempts} delayMs=${delayMs}`,
    );
    try {
      await sleepWithAbort(delayMs, params.abortSignal);
    } catch (err) {
      if (params.abortSignal?.aborted) {
        const abortErr = new Error("Operation aborted", { cause: err });
        abortErr.name = "AbortError";
        throw abortErr;
      }
      throw err;
    }
  };

  session.agentDir = agentDir;
  session.fallbackConfigured = fallbackConfigured;
  session.authStorage = authStorage;
  session.modelRegistry = modelRegistry;
  session.authOverride = authOverride;
  session.ctxInfo = ctxInfo;
  session.effectiveModel = effectiveModel;
  session.authStore = authStore;
  session.lockedProfileId = lockedProfileId;
  session.profileCandidates = profileCandidates;
  session.legacyBeforeAgentStartResult = legacyBeforeAgentStartResult;
  session.copilotRefresh = copilotRefresh;
  session.advanceAuthProfile = advanceAuthProfile;
  session.maybeRefreshCopilotForAuthError = maybeRefreshCopilotForAuthError;
  session.maybeMarkAuthProfileFailure = maybeMarkAuthProfileFailure;
  session.maybeBackoffBeforeOverloadFailover = maybeBackoffBeforeOverloadFailover;
  session.resolveAuthProfileFailureReason = resolveAuthProfileFailureReason;
  session.MAX_RUN_LOOP_ITERATIONS = MAX_RUN_LOOP_ITERATIONS;
  session.initialThinkLevel = initialThinkLevel;
  return session;
}
