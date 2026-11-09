import type { ResolvedProviderAuth } from "../../agents/model-auth.js";
import type { createCopilotTokenRefresh } from "./copilot-token-refresh.js";

/** Apply one resolved credential; profile traversal and model retries belong to the caller. */
export async function applyProviderCredential(input: {
  provider: string;
  candidate?: string;
  credential: ResolvedProviderAuth;
  setRuntimeApiKey: (provider: string, token: string) => void;
  copilotRefresh: Pick<
    ReturnType<typeof createCopilotTokenRefresh>,
    "enabled" | "remember" | "schedule"
  >;
}): Promise<string | undefined> {
  const { credential, provider } = input;
  if (!credential.apiKey) {
    if (credential.mode !== "aws-sdk") {
      throw new Error(
        `No API key resolved for provider "${provider}" (auth mode: ${credential.mode}).`,
      );
    }
    return credential.profileId ?? input.candidate;
  }
  if (provider === "github-copilot") {
    const { resolveCopilotApiToken } = await import("../../providers/github-copilot-token.js");
    const token = await resolveCopilotApiToken({ githubToken: credential.apiKey });
    input.setRuntimeApiKey(provider, token.token);
    if (input.copilotRefresh.enabled) {
      input.copilotRefresh.remember(credential.apiKey, token.expiresAt);
      input.copilotRefresh.schedule();
    }
  } else {
    input.setRuntimeApiKey(provider, credential.apiKey);
  }
  return credential.profileId;
}
