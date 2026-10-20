import fs from "node:fs";
import path from "node:path";
import type { ModelRegistry as PiModelRegistry } from "@earendil-works/pi-coding-agent";
import { ensureAuthProfileStore } from "./auth-profiles.js";
import { resolvePiCredentialMapFromStore, type PiCredentialMap } from "./pi-auth-credentials.js";
import { OpenBotAuthStorage } from "./pi-sdk/auth-storage.js";
import { createPiModelRuntime } from "./pi-sdk/model-runtime.js";

export { OpenBotAuthStorage as AuthStorage };
export type { PiModelRegistry as ModelRegistry };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function scrubLegacyStaticAuthJsonEntries(pathname: string): void {
  if (process.env.OPENCLAW_AUTH_STORE_READONLY === "1") {
    return;
  }
  if (!fs.existsSync(pathname)) {
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(pathname, "utf8")) as unknown;
  } catch {
    return;
  }
  if (!isRecord(parsed)) {
    return;
  }

  let changed = false;
  for (const [provider, value] of Object.entries(parsed)) {
    if (!isRecord(value)) {
      continue;
    }
    if (value.type !== "api_key") {
      continue;
    }
    delete parsed[provider];
    changed = true;
  }

  if (!changed) {
    return;
  }

  if (Object.keys(parsed).length === 0) {
    fs.rmSync(pathname, { force: true });
    return;
  }

  fs.writeFileSync(pathname, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  fs.chmodSync(pathname, 0o600);
}

function resolvePiCredentials(agentDir: string): PiCredentialMap {
  const store = ensureAuthProfileStore(agentDir, { allowKeychainPrompt: false });
  return resolvePiCredentialMapFromStore(store);
}

// Compatibility helpers for pi-coding-agent 0.50+ (discover* helpers removed).
export function discoverAuthStorage(agentDir: string): OpenBotAuthStorage {
  const credentials = resolvePiCredentials(agentDir);
  const authPath = path.join(agentDir, "auth.json");
  scrubLegacyStaticAuthJsonEntries(authPath);
  return OpenBotAuthStorage.inMemory(credentials);
}

export async function discoverModels(
  authStorage: OpenBotAuthStorage,
  agentDir: string,
): Promise<PiModelRegistry> {
  const { registry } = await createPiModelRuntime({ authStorage, agentDir });
  return registry;
}
