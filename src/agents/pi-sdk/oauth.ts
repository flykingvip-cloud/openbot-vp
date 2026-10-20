import type { OAuthCredentials } from "@earendil-works/pi-ai/compat";
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";

/** Provider ids that historically came from pi-ai `getOAuthProviders()`. */
export type OAuthProvider =
  | "anthropic"
  | "openai-codex"
  | "github-copilot"
  | "google-gemini-cli"
  | "openrouter"
  | "huggingface"
  | "xai"
  | "kimi-coding";

const OAUTH_PROVIDERS: readonly { id: OAuthProvider }[] = [
  { id: "anthropic" },
  { id: "openai-codex" },
  { id: "github-copilot" },
  { id: "google-gemini-cli" },
  { id: "openrouter" },
  { id: "huggingface" },
  { id: "xai" },
  { id: "kimi-coding" },
];

export function getOAuthProviders(): readonly { id: OAuthProvider }[] {
  return OAUTH_PROVIDERS;
}

export async function getOAuthApiKey(
  provider: OAuthProvider,
  credentials: OAuthCredentials,
): Promise<{ apiKey: string; newCredentials?: OAuthCredentials }> {
  if (provider === "google-gemini-cli") {
    return {
      apiKey: JSON.stringify({
        token: credentials.access,
        projectId: credentials.projectId,
      }),
    };
  }
  return { apiKey: credentials.access };
}

export type OpenBotOAuthLoginCallbacks = {
  onAuth: (info: { url: string; instructions?: string }) => void;
  onDeviceCode?: (info: {
    userCode: string;
    verificationUri: string;
    intervalSeconds?: number;
    expiresInSeconds?: number;
  }) => void;
  onPrompt: (prompt: { message: string; placeholder?: string }) => Promise<string>;
  onProgress?: (message: string) => void;
  onSelect?: (prompt: {
    message: string;
    options: Array<{ id: string; label: string }>;
  }) => Promise<string | undefined>;
  signal?: AbortSignal;
};

export async function loginOpenAICodex(
  callbacks: OpenBotOAuthLoginCallbacks,
): Promise<OAuthCredentials | null> {
  const oauth = openaiCodexProvider().auth.oauth;
  if (!oauth) {
    throw new Error("openai-codex OAuth is unavailable");
  }
  const credential = await oauth.login({
    signal: callbacks.signal ?? new AbortController().signal,
    prompt: async (prompt) => {
      if (prompt.type === "select") {
        if (!callbacks.onSelect) {
          throw new Error("OAuth provider selection is not supported in this flow");
        }
        const selected = await callbacks.onSelect({
          message: prompt.message,
          options: prompt.options.map((option) => ({ id: option.id, label: option.label })),
        });
        if (!selected) {
          throw new Error("OAuth provider selection cancelled");
        }
        return selected;
      }
      return callbacks.onPrompt({
        message: prompt.message,
        placeholder: prompt.placeholder,
      });
    },
    notify: (event) => {
      if (event.type === "auth_url") {
        callbacks.onAuth({ url: event.url, instructions: event.instructions });
        return;
      }
      if (event.type === "device_code") {
        callbacks.onDeviceCode?.({
          userCode: event.userCode,
          verificationUri: event.verificationUri,
          intervalSeconds: event.intervalSeconds,
          expiresInSeconds: event.expiresInSeconds,
        });
        return;
      }
      if (event.type === "progress") {
        callbacks.onProgress?.(event.message);
      }
    },
  });
  return credential;
}
