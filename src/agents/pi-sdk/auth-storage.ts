import type {
  AuthOperationOptions,
  Credential,
  CredentialInfo,
  CredentialStore,
} from "@earendil-works/pi-ai/compat";

export type OpenBotAuthStorageData = Record<string, Credential>;

/**
 * OpenBot-owned credential store for Earendil 0.84.
 *
 * `@earendil-works/pi-coding-agent` no longer exports `AuthStorage` on its public
 * index. This wrapper implements `CredentialStore` and keeps the Mario 0.57
 * methods OpenBot still calls (`hasAuth`, `get`, `getApiKey`, `setRuntimeApiKey`).
 * Runtime API keys stay in-memory and are never written to auth.json.
 */
export class OpenBotAuthStorage implements CredentialStore {
  private data: OpenBotAuthStorageData;
  private readonly runtimeApiKeys = new Map<string, string>();

  private constructor(data: OpenBotAuthStorageData) {
    this.data = { ...data };
  }

  static inMemory(data?: OpenBotAuthStorageData): OpenBotAuthStorage {
    return new OpenBotAuthStorage(data ?? {});
  }

  hasAuth(provider: string): boolean {
    return this.runtimeApiKeys.has(provider) || this.data[provider] !== undefined;
  }

  get(provider: string): Credential | undefined {
    return this.data[provider];
  }

  setRuntimeApiKey(provider: string, apiKey: string): void {
    this.runtimeApiKeys.set(provider, apiKey);
  }

  removeRuntimeApiKey(provider: string): void {
    this.runtimeApiKeys.delete(provider);
  }

  async getApiKey(provider: string): Promise<string | undefined> {
    const runtime = this.runtimeApiKeys.get(provider);
    if (runtime) {
      return runtime;
    }
    const credential = this.data[provider];
    if (!credential) {
      return undefined;
    }
    if (credential.type === "api_key") {
      return credential.key;
    }
    return credential.access;
  }

  async read(providerId: string, options?: AuthOperationOptions): Promise<Credential | undefined> {
    options?.signal?.throwIfAborted();
    const runtime = this.runtimeApiKeys.get(providerId);
    if (runtime) {
      return { type: "api_key", key: runtime };
    }
    return this.data[providerId];
  }

  async list(options?: AuthOperationOptions): Promise<readonly CredentialInfo[]> {
    options?.signal?.throwIfAborted();
    const providers = new Set([...Object.keys(this.data), ...this.runtimeApiKeys.keys()]);
    const entries: CredentialInfo[] = [];
    for (const providerId of providers) {
      if (this.runtimeApiKeys.has(providerId)) {
        entries.push({ providerId, type: "api_key" });
        continue;
      }
      const credential = this.data[providerId];
      if (credential) {
        entries.push({ providerId, type: credential.type });
      }
    }
    return entries;
  }

  async modify(
    providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
    options?: AuthOperationOptions,
  ): Promise<Credential | undefined> {
    options?.signal?.throwIfAborted();
    const next = await fn(this.data[providerId]);
    if (next === undefined) {
      return this.data[providerId];
    }
    this.data[providerId] = next;
    return next;
  }

  async delete(providerId: string, options?: AuthOperationOptions): Promise<void> {
    options?.signal?.throwIfAborted();
    delete this.data[providerId];
    this.runtimeApiKeys.delete(providerId);
  }
}
