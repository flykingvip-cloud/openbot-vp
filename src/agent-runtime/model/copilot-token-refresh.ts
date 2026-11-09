/** Request-scoped provider credential refresh. Does not schedule tasks or model turns. */
type CopilotTokenState = {
  githubToken: string;
  expiresAt: number;
  refreshTimer?: ReturnType<typeof setTimeout>;
  refreshInFlight?: Promise<void>;
};

const COPILOT_REFRESH_MARGIN_MS = 5 * 60 * 1000;
const COPILOT_REFRESH_RETRY_MS = 60 * 1000;
const COPILOT_REFRESH_MIN_DELAY_MS = 5 * 1000;
export function createCopilotTokenRefresh(input: {
  enabled: boolean;
  setRuntimeApiKey: (token: string) => void;
  describeError: (error: unknown) => string;
  log: { debug: (message: string) => void; warn: (message: string) => void };
}) {
  const { log } = input;
  const copilotTokenState: CopilotTokenState | null = input.enabled
    ? { githubToken: "", expiresAt: 0 }
    : null;
  let copilotRefreshCancelled = false;
  const hasCopilotGithubToken = () => Boolean(copilotTokenState?.githubToken.trim());

  const clearCopilotRefreshTimer = () => {
    if (!copilotTokenState?.refreshTimer) {
      return;
    }
    clearTimeout(copilotTokenState.refreshTimer);
    copilotTokenState.refreshTimer = undefined;
  };

  const stopCopilotRefreshTimer = () => {
    if (!copilotTokenState) {
      return;
    }
    copilotRefreshCancelled = true;
    clearCopilotRefreshTimer();
  };

  const refreshCopilotToken = async (reason: string): Promise<void> => {
    if (!copilotTokenState) {
      return;
    }
    if (copilotTokenState.refreshInFlight) {
      await copilotTokenState.refreshInFlight;
      return;
    }
    const { resolveCopilotApiToken } = await import("../../providers/github-copilot-token.js");
    copilotTokenState.refreshInFlight = (async () => {
      const githubToken = copilotTokenState.githubToken.trim();
      if (!githubToken) {
        throw new Error("Copilot refresh requires a GitHub token.");
      }
      log.debug(`Refreshing GitHub Copilot token (${reason})...`);
      const copilotToken = await resolveCopilotApiToken({
        githubToken,
      });
      input.setRuntimeApiKey(copilotToken.token);
      copilotTokenState.expiresAt = copilotToken.expiresAt;
      const remaining = copilotToken.expiresAt - Date.now();
      log.debug(
        `Copilot token refreshed; expires in ${Math.max(0, Math.floor(remaining / 1000))}s.`,
      );
    })()
      .catch((err) => {
        log.warn(`Copilot token refresh failed: ${input.describeError(err)}`);
        throw err;
      })
      .finally(() => {
        copilotTokenState.refreshInFlight = undefined;
      });
    await copilotTokenState.refreshInFlight;
  };

  const scheduleCopilotRefresh = (): void => {
    if (!copilotTokenState || copilotRefreshCancelled) {
      return;
    }
    if (!hasCopilotGithubToken()) {
      log.warn("Skipping Copilot refresh scheduling; GitHub token missing.");
      return;
    }
    clearCopilotRefreshTimer();
    const now = Date.now();
    const refreshAt = copilotTokenState.expiresAt - COPILOT_REFRESH_MARGIN_MS;
    const delayMs = Math.max(COPILOT_REFRESH_MIN_DELAY_MS, refreshAt - now);
    const timer = setTimeout(() => {
      if (copilotRefreshCancelled) {
        return;
      }
      refreshCopilotToken("scheduled")
        .then(() => scheduleCopilotRefresh())
        .catch(() => {
          if (copilotRefreshCancelled) {
            return;
          }
          const retryTimer = setTimeout(() => {
            if (copilotRefreshCancelled) {
              return;
            }
            refreshCopilotToken("scheduled-retry")
              .then(() => scheduleCopilotRefresh())
              .catch(() => undefined);
          }, COPILOT_REFRESH_RETRY_MS);
          copilotTokenState.refreshTimer = retryTimer;
          if (copilotRefreshCancelled) {
            clearTimeout(retryTimer);
            copilotTokenState.refreshTimer = undefined;
          }
        });
    }, delayMs);
    copilotTokenState.refreshTimer = timer;
    if (copilotRefreshCancelled) {
      clearTimeout(timer);
      copilotTokenState.refreshTimer = undefined;
    }
  };

  return {
    enabled: input.enabled,
    remember(githubToken: string, expiresAt: number) {
      if (copilotTokenState) {
        copilotTokenState.githubToken = githubToken;
        copilotTokenState.expiresAt = expiresAt;
      }
    },
    refresh: refreshCopilotToken,
    schedule: scheduleCopilotRefresh,
    stop: stopCopilotRefreshTimer,
  };
}
