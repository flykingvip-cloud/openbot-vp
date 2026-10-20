import { isNonSecretApiKeyMarker } from "../agents/model-auth-markers.js";
import type { OpenBotConfig } from "../config/config.js";
import { REDACTED_SENTINEL } from "../config/redact-snapshot.js";
import { isPlainObject } from "../utils.js";

/**
 * Read-only governance audit (task 2.10): detect provider `apiKey` values stored
 * as inline plaintext in the config (rather than a SecretRef / env reference).
 *
 * This does NOT modify storage — it only surfaces a reminder. Auto-materializing
 * plaintext into file SecretRefs is deferred write-side hardening (task 2.9),
 * to be designed together with the tenant-keyed credential store (2.2/C).
 */

const ENV_TEMPLATE_PATTERN = /^\$\{?[A-Za-z_][A-Za-z0-9_]*\}?$/;

/** True when a provider apiKey string is a real inline secret (not a ref/env/marker/sentinel). */
function isInlinePlaintextSecret(value: unknown): value is string {
  if (typeof value !== "string") {
    return false; // SecretRef objects (and absent keys) are not plaintext
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  if (trimmed === REDACTED_SENTINEL) {
    return false;
  }
  if (ENV_TEMPLATE_PATTERN.test(trimmed)) {
    return false; // ${VAR} / $VAR reference
  }
  if (isNonSecretApiKeyMarker(trimmed)) {
    return false; // env-var-name / OAuth / secret-ref markers
  }
  return true;
}

/** Provider ids whose `models.providers.<id>.apiKey` is stored as inline plaintext. */
export function findInlinePlaintextProviderApiKeys(config: OpenBotConfig): string[] {
  const providers = config.models?.providers;
  if (!isPlainObject(providers)) {
    return [];
  }
  const flagged: string[] = [];
  for (const [providerId, provider] of Object.entries(providers)) {
    if (
      isPlainObject(provider) &&
      isInlinePlaintextSecret((provider as { apiKey?: unknown }).apiKey)
    ) {
      flagged.push(providerId);
    }
  }
  return flagged.toSorted();
}

/**
 * Build a read-only governance note when any provider apiKey is inline plaintext.
 * Returns null when there is nothing to report.
 */
export function buildPlaintextApiKeyGovernanceNote(config: OpenBotConfig): string | null {
  const flagged = findInlinePlaintextProviderApiKeys(config);
  if (flagged.length === 0) {
    return null;
  }
  return [
    `Provider API key(s) stored as inline plaintext: ${flagged.join(", ")}.`,
    "These work as-is, but the value sits in openbot.json in cleartext.",
    "Planned hardening: store as a file SecretRef (tracked as ops-decommission task 2.9).",
    "No action required now; this is a governance reminder only.",
  ].join("\n");
}
