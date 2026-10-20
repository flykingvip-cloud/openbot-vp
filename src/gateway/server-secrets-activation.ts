// Secrets activation coordinator extracted from server.impl.ts.
//
// Centralizes the "serialize secret-snapshot activations + emit
// degraded/recovered system events + escalate startup failures" logic that
// previously lived inline in the gateway composition root. Keeping it
// separate makes the policy testable and trims the orchestrator file by
// ~70 lines of state-machine code.

import type { OpenBotConfig } from "../config/config.js";
import { resolveMainSessionKey } from "../config/sessions.js";
import { enqueueSystemEvent } from "../infra/system-events.js";
import {
  activateSecretsRuntimeSnapshot,
  prepareSecretsRuntimeSnapshot,
} from "../secrets/runtime.js";
import { type SecretsLogger, logGatewayAuthSurfaceDiagnostics } from "./server-auth-runtime.js";

export type SecretsActivationReason = "startup" | "reload" | "restart-check";

export type SecretsActivationParams = {
  reason: SecretsActivationReason;
  /** When true, write the prepared snapshot into the active runtime slot. */
  activate: boolean;
};

export type PreparedSecretsSnapshot = Awaited<ReturnType<typeof prepareSecretsRuntimeSnapshot>>;

export type SecretsActivationLogger = {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
};

export type SecretsActivationCoordinator = {
  activate: (
    config: OpenBotConfig,
    params: SecretsActivationParams,
  ) => Promise<PreparedSecretsSnapshot>;
};

/**
 * Build a coordinator that serializes secret-snapshot activations and
 * tracks degraded/recovered transitions. Activation calls run on a single
 * promise tail so concurrent reloads cannot interleave snapshots.
 */
export function createSecretsActivationCoordinator(opts: {
  logSecrets: SecretsLogger & SecretsActivationLogger;
}): SecretsActivationCoordinator {
  const { logSecrets } = opts;
  let secretsDegraded = false;
  let activationTail: Promise<void> = Promise.resolve();

  const emitSecretsStateEvent = (
    code: "SECRETS_RELOADER_DEGRADED" | "SECRETS_RELOADER_RECOVERED",
    message: string,
    cfg: OpenBotConfig,
  ) => {
    enqueueSystemEvent(`[${code}] ${message}`, {
      sessionKey: resolveMainSessionKey(cfg),
      contextKey: code,
    });
  };

  const runWithLock = async <T>(operation: () => Promise<T>): Promise<T> => {
    const run = activationTail.then(operation, operation);
    activationTail = run.then(
      () => undefined,
      () => undefined,
    );
    return await run;
  };

  return {
    async activate(config, params) {
      return await runWithLock(async () => {
        try {
          const prepared = await prepareSecretsRuntimeSnapshot({ config });
          if (params.activate) {
            activateSecretsRuntimeSnapshot(prepared);
            logGatewayAuthSurfaceDiagnostics(prepared, logSecrets);
          }
          for (const warning of prepared.warnings) {
            logSecrets.warn(`[${warning.code}] ${warning.message}`);
          }
          if (secretsDegraded) {
            const recoveredMessage =
              "Secret resolution recovered; runtime remained on last-known-good during the outage.";
            logSecrets.info(`[SECRETS_RELOADER_RECOVERED] ${recoveredMessage}`);
            emitSecretsStateEvent("SECRETS_RELOADER_RECOVERED", recoveredMessage, prepared.config);
          }
          secretsDegraded = false;
          return prepared;
        } catch (err) {
          const details = String(err);
          if (!secretsDegraded) {
            logSecrets.error(`[SECRETS_RELOADER_DEGRADED] ${details}`);
            if (params.reason !== "startup") {
              emitSecretsStateEvent(
                "SECRETS_RELOADER_DEGRADED",
                `Secret resolution failed; runtime remains on last-known-good snapshot. ${details}`,
                config,
              );
            }
          } else {
            logSecrets.warn(`[SECRETS_RELOADER_DEGRADED] ${details}`);
          }
          secretsDegraded = true;
          if (params.reason === "startup") {
            throw new Error(`Startup failed: required secrets are unavailable. ${details}`, {
              cause: err,
            });
          }
          throw err;
        }
      });
    },
  };
}
