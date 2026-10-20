export { formatTimeAgo } from "../../infra/format-time/format-relative.ts";
export { formatDurationPrecise } from "../../infra/format-time/format-duration.ts";

export function formatGatewayAuthUsed(
  auth: {
    token?: string;
    password?: string;
  } | null,
): "token" | "password" | "token+password" | "none" {
  const hasToken = Boolean(auth?.token?.trim());
  const hasPassword = Boolean(auth?.password?.trim());
  if (hasToken && hasPassword) {
    return "token+password";
  }
  if (hasToken) {
    return "token";
  }
  if (hasPassword) {
    return "password";
  }
  return "none";
}

/**
 * Kept as a re-export so existing CLI call sites stay stable; the single
 * implementation now lives in `src/infra/redact-secret-text.ts` and is shared with
 * non-CLI callers that persist error text.
 */
export { redactSecretText as redactSecrets } from "../../infra/redact-secret-text.js";
