/**
 * In-memory sliding-window rate limiter for vault-sync control plane (P2.5).
 * Fail closed with a stable error message; no plaintext paths in keys.
 */
export type VaultSyncRateLimitConfig = {
  /** Direct putBlob calls per vault+device per window. */
  putBlobPerWindow: number;
  /** createUploadSession calls per vault+device per window. */
  uploadSessionPerWindow: number;
  /** putUploadChunk calls per vault+device per window. */
  putChunkPerWindow: number;
  /** commitRevision calls per vault+device per window. */
  commitRevisionPerWindow: number;
  windowMs: number;
};

export const DEFAULT_VAULT_SYNC_RATE_LIMITS: VaultSyncRateLimitConfig = {
  putBlobPerWindow: 120,
  uploadSessionPerWindow: 30,
  putChunkPerWindow: 600,
  commitRevisionPerWindow: 300,
  windowMs: 60_000,
};

export class VaultSyncRateLimiter {
  private readonly hits = new Map<string, number[]>();
  private readonly config: VaultSyncRateLimitConfig;

  constructor(config?: Partial<VaultSyncRateLimitConfig>) {
    this.config = { ...DEFAULT_VAULT_SYNC_RATE_LIMITS, ...config };
  }

  getConfig(): VaultSyncRateLimitConfig {
    return { ...this.config };
  }

  reset(): void {
    this.hits.clear();
  }

  /** @throws Error("rate limited") when over limit */
  check(action: keyof Omit<VaultSyncRateLimitConfig, "windowMs">, key: string): void {
    const limit = this.config[action];
    if (limit <= 0) {
      return; // disabled
    }
    const now = Date.now();
    const bucketKey = `${action}:${key}`;
    const windowStart = now - this.config.windowMs;
    const prev = this.hits.get(bucketKey) ?? [];
    const recent = prev.filter((t) => t >= windowStart);
    if (recent.length >= limit) {
      this.hits.set(bucketKey, recent);
      throw new Error("rate limited");
    }
    recent.push(now);
    this.hits.set(bucketKey, recent);
  }
}
