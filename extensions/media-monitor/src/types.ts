export type MonitorPlatform = "xhs";

export type MonitorHealthState =
  | "ok"
  | "degraded"
  | "rate_limited"
  | "reauth_required"
  | "failed"
  | "cooldown";

export type MonitorEventType =
  | "content.created"
  | "comment.created"
  | "monitor.failed"
  | "monitor.reauth_required"
  | "monitor.rate_limited";

export type OutboxStatus = "pending" | "sending" | "sent" | "retry" | "dead_letter";

export type MonitorCursor = {
  baselineEstablished: boolean;
  lastRunId?: string;
  lastSuccessAt?: string;
  contentWatermark?: string;
  consecutiveEmptyRuns: number;
  backoffUntil?: string;
  cooldownUntil?: string;
};

export type MonitorTarget = {
  id: string;
  tenantId: string;
  agentId: string;
  platform: MonitorPlatform;
  accountId: string;
  accountUrl: string;
  displayName: string;
  enabled: boolean;
  pollIntervalSeconds: number;
  watchedContentIds: string[];
  lastSuccessAt?: string;
  lastFailureAt?: string;
  healthState: MonitorHealthState;
  cursor: MonitorCursor;
  notifyChannel?: string;
  notifyTo?: string;
  notifyAccountId?: string;
  createdAt: string;
  updatedAt: string;
};

export type MonitorEvent = {
  id: string;
  targetId: string;
  tenantId: string;
  agentId: string;
  platform: MonitorPlatform;
  eventType: MonitorEventType;
  platformObjectId: string;
  parentObjectId?: string;
  contentUrl?: string;
  publishedAt?: string;
  observedAt: string;
  contentHash?: string;
  payloadJson: Record<string, unknown>;
  dedupeKey: string;
  analysisState: "none" | "pending" | "done";
  createdAt: string;
};

export type NotificationOutboxRow = {
  id: string;
  eventId: string;
  targetId: string;
  tenantId: string;
  agentId: string;
  channel: string;
  destination: string;
  accountId?: string;
  status: OutboxStatus;
  attempts: number;
  nextAttemptAt: string;
  lastError?: string;
  sentAt?: string;
  /** Set while a flusher owns the row (status=sending). */
  claimOwner?: string;
  /** ISO expiry; after this, another flusher may reclaim a stuck sending row. */
  claimUntil?: string;
  createdAt: string;
  body: string;
};

export type MonitorLease = {
  targetId: string;
  leaseOwner: string;
  leaseUntil: string;
  heartbeatAt: string;
};

export type AuditEntry = {
  id: string;
  at: string;
  action: string;
  targetId?: string;
  eventId?: string;
  tenantId?: string;
  agentId?: string;
  detail?: Record<string, unknown>;
};

export type MonitorStoreData = {
  version: 1;
  targets: MonitorTarget[];
  events: MonitorEvent[];
  outbox: NotificationOutboxRow[];
  leases: MonitorLease[];
  audit: AuditEntry[];
};

export type CrawlMode = "creator" | "comments";

export type AdapterErrorCategory =
  | "rate_limit"
  | "reauth_required"
  | "captcha"
  | "timeout"
  | "process_error"
  | "invalid_output"
  | "unknown";

export type AdapterHealthState = "ok" | "degraded" | "rate_limited" | "reauth_required" | "failed";

export type AdapterContentItem = {
  type: "content";
  platform_id: string;
  url?: string;
  title?: string;
  text?: string;
  published_at?: string;
  content_hash?: string;
};

export type AdapterCommentItem = {
  type: "comment";
  platform_id: string;
  parent_platform_id: string;
  url?: string;
  text?: string;
  published_at?: string;
  author_name?: string;
  content_hash?: string;
};

export type AdapterSuccessEnvelope = {
  schema_version: 1;
  platform: MonitorPlatform;
  target: {
    account_id: string;
    url?: string;
  };
  run: {
    id: string;
    started_at: string;
    finished_at: string;
    mode: CrawlMode;
  };
  items: Array<AdapterContentItem | AdapterCommentItem>;
  health: {
    state: AdapterHealthState;
  };
};

export type AdapterErrorEnvelope = {
  schema_version: 1;
  error: {
    category: AdapterErrorCategory;
    retryable: boolean;
    provider_code?: string;
    message: string;
  };
};

export type AdapterEnvelope = AdapterSuccessEnvelope | AdapterErrorEnvelope;

export type ProcessRunResult =
  | {
      ok: true;
      envelope: AdapterEnvelope;
      stderr: string;
      exitCode: number;
      timedOut: false;
    }
  | {
      ok: false;
      error: {
        category: AdapterErrorCategory;
        retryable: boolean;
        message: string;
        exitCode?: number | null;
        timedOut?: boolean;
      };
      stderr: string;
      stdout: string;
    };
