import type { SecretInput } from "./types.secrets.js";

export type GatewayBindMode = "auto" | "lan" | "loopback" | "custom" | "tailnet";

export type GatewayTlsConfig = {
  /** Enable TLS for the gateway server. */
  enabled?: boolean;
  /** Auto-generate a self-signed cert if cert/key are missing (default: true). */
  autoGenerate?: boolean;
  /** PEM certificate path for the gateway server. */
  certPath?: string;
  /** PEM private key path for the gateway server. */
  keyPath?: string;
  /** Optional PEM CA bundle for TLS clients (mTLS or custom roots). */
  caPath?: string;
};

export type WideAreaDiscoveryConfig = {
  enabled?: boolean;
  /** Optional unicast DNS-SD domain (e.g. "openclaw.internal"). */
  domain?: string;
};

export type MdnsDiscoveryMode = "off" | "minimal" | "full";

export type MdnsDiscoveryConfig = {
  /**
   * mDNS/Bonjour discovery broadcast mode (default: minimal).
   * - off: disable mDNS entirely
   * - minimal: omit cliPath/sshPort from TXT records
   * - full: include cliPath/sshPort in TXT records
   */
  mode?: MdnsDiscoveryMode;
};

export type DiscoveryConfig = {
  wideArea?: WideAreaDiscoveryConfig;
  mdns?: MdnsDiscoveryConfig;
};

export type CanvasHostConfig = {
  enabled?: boolean;
  /** Directory to serve (default: ~/.openclaw/workspace/canvas). */
  root?: string;
  /** HTTP port to listen on (default: 18793). */
  port?: number;
  /** Enable live-reload file watching + WS reloads (default: true). */
  liveReload?: boolean;
  /**
   * Public base URL advertised to remote nodes (e.g. `https://gw.example.com`).
   * Required when `gateway.bind` is loopback behind a reverse proxy — nodes cannot
   * fetch canvas assets from `http://127.0.0.1:<gateway-port>`.
   * Canvas is served on the gateway HTTP server at `/__openbot__/canvas/`.
   */
  baseUrl?: string;
};

export type TalkProviderConfig = {
  /** Default voice ID for the provider's Talk mode implementation. */
  voiceId?: string;
  /** Optional voice name -> provider voice ID map. */
  voiceAliases?: Record<string, string>;
  /** Default provider model ID for Talk mode. */
  modelId?: string;
  /** Default provider output format (for example pcm_44100). */
  outputFormat?: string;
  /** Provider API key (optional; provider-specific env fallback may apply). */
  apiKey?: SecretInput;
  /** Provider-specific extensions. */
  [key: string]: unknown;
};

export type ResolvedTalkConfig = {
  /** Active Talk TTS provider resolved from the current config payload. */
  provider: string;
  /** Provider config for the active Talk provider. */
  config: TalkProviderConfig;
};

export type TalkConfig = {
  /** Active Talk TTS provider (for example "elevenlabs"). */
  provider?: string;
  /** Provider-specific Talk config keyed by provider id. */
  providers?: Record<string, TalkProviderConfig>;
  /** Stop speaking when user starts talking (default: true). */
  interruptOnSpeech?: boolean;
  /** Milliseconds of user silence before Talk mode sends the transcript after a pause. */
  silenceTimeoutMs?: number;

  /**
   * Legacy ElevenLabs compatibility fields.
   * Kept during rollout while older clients migrate to provider/providers.
   */
  voiceId?: string;
  voiceAliases?: Record<string, string>;
  modelId?: string;
  outputFormat?: string;
  apiKey?: SecretInput;
};

export type TalkConfigResponse = TalkConfig & {
  /** Canonical active Talk payload for clients. */
  resolved?: ResolvedTalkConfig;
};

export type GatewayControlUiConfig = {
  /** If false, the Gateway will not serve the Control UI (default /). */
  enabled?: boolean;
  /** Optional base path prefix for the Control UI (e.g. "/openclaw"). */
  basePath?: string;
  /** Optional filesystem root for Control UI assets (defaults to dist/control-ui). */
  root?: string;
  /** Allowed browser origins for Control UI/WebChat websocket connections. */
  allowedOrigins?: string[];
  /**
   * DANGEROUS: Keep Host-header origin fallback behavior.
   * Supported long-term for deployments that intentionally rely on this policy.
   */
  dangerouslyAllowHostHeaderOriginFallback?: boolean;
  /**
   * Insecure-auth toggle.
   * Control UI still requires secure context + device identity unless
   * dangerouslyDisableDeviceAuth is enabled.
   */
  allowInsecureAuth?: boolean;
  /** DANGEROUS: Disable device identity checks for the Control UI (default: false). */
  dangerouslyDisableDeviceAuth?: boolean;
};

export type GatewayAuthMode = "none" | "token" | "password" | "trusted-proxy";

/**
 * Configuration for trusted reverse proxy authentication.
 * Used when Clawdbot runs behind an identity-aware proxy (Pomerium, Caddy + OAuth, etc.)
 * that handles authentication and passes user identity via headers.
 */
export type GatewayTrustedProxyConfig = {
  /**
   * Header name containing the authenticated user identity (required).
   * Common values: "x-forwarded-user", "x-remote-user", "x-pomerium-claim-email"
   */
  userHeader: string;
  /** Optional header containing a human-readable display name for the user. */
  displayNameHeader?: string;
  /** Optional header containing the enterprise/tenant id selected by the platform layer. */
  tenantHeader?: string;
  /** Optional header containing the effective gateway role ("operator" or "node"). */
  roleHeader?: string;
  /** Optional header containing the effective gateway scopes for this session. */
  scopesHeader?: string;
  /**
   * Optional built-in platform auth for Control UI users on the local gateway entry.
   * When enabled, end users can register/login through the Control UI, and the
   * gateway will translate the resulting cookie session into trusted-proxy auth.
   */
  platformAuth?: GatewayPlatformAuthConfig;
  /**
   * Additional headers that MUST be present for the request to be trusted.
   * Use this to verify the request actually came through the proxy.
   * Example: ["x-forwarded-proto", "x-forwarded-host"]
   */
  requiredHeaders?: string[];
  /**
   * Optional allowlist of user identities that can access the gateway.
   * If empty or omitted, all authenticated users from the proxy are allowed.
   * Example: ["nick@example.com", "admin@company.org"]
   */
  allowUsers?: string[];
  /**
   * Opt-in: adopt a configured platform-auth identity for DIRECT LOOPBACK
   * (127.0.0.1) connections that present no proxy identity header and no
   * platform session cookie. Lets the local Control UI resolve a real
   * employee/enterprise tenant instead of an identity-less "local" principal.
   *
   * SECURITY TRADEOFF: enabling this treats anyone with direct loopback access
   * to the gateway as this operator. Only enable on a host where loopback
   * access already implies operator trust. Never applies to proxied/remote
   * connections (strictly gated by loopback detection), and fails closed to the
   * anonymous local principal when the user cannot be resolved to an active
   * enterprise membership.
   */
  localOperator?: GatewayLoopbackOperatorConfig;
  /**
   * Isolation tight path (off by default). When true, a client that is merely
   * from 127.0.0.1/::1 cannot become an arbitrary user by sending `userHeader`
   * (for example X-Forwarded-User). Default production trusted-proxy behavior
   * is unchanged: loopback addresses listed in `gateway.trustedProxies` may
   * still present identity headers. Platform-auth cookie sessions continue to
   * work. A designated entry hop may still inject identity headers if it
   * presents `entryHopCredential`. This flag does not change or pre-approve
   * Hong Kong LIVE `trustedProxies` or HK→A auth translation.
   */
  rejectDirectLoopbackIdentityHeaders?: boolean;
  /**
   * Header name the designated entry hop uses to present `entryHopCredential`.
   * Default: `x-openbot-entry-hop`. Used only when
   * `rejectDirectLoopbackIdentityHeaders` is true.
   */
  entryHopHeader?: string;
  /**
   * Shared hop credential the designated isolation entry presents so loopback
   * identity headers can be trusted in tight mode. Never log this value.
   * Omit to reject all direct-loopback identity headers in tight mode
   * (platform-auth sessions still work).
   */
  entryHopCredential?: string;
};

/** Sanctioned loopback operator identity for direct-loopback gateway access. */
export type GatewayLoopbackOperatorConfig = {
  /**
   * Explicitly enable the sanctioned loopback operator identity. Defaults to
   * false so the feature is strictly opt-in (fail closed).
   */
  enabled?: boolean;
  /**
   * Platform-auth user email to adopt for direct-loopback connections. Must
   * exist as an active user with an enterprise membership in the platform-auth
   * store; otherwise resolution fails closed.
   */
  user: string;
};

export type GatewayPlatformAuthConfig = {
  /** Enable built-in platform registration/login for local Control UI access. */
  enabled?: boolean;
  /** Optional JSON store path for users, tenants, and sessions. */
  store?: string;
  /** Deprecated legacy flag kept for config compatibility. */
  allowRegistration?: boolean;
  /** Session TTL in hours. Default: 168 (7 days). */
  sessionTtlHours?: number;
  /** Deprecated legacy invite TTL kept for config compatibility. */
  inviteTtlHours?: number;
  /** Enterprise admin activation TTL in hours. Default: 72 (3 days). */
  activationTtlHours?: number;
  /** Password reset TTL in minutes. Default: 30. */
  passwordResetTtlMinutes?: number;
  /** Cookie name used for the signed session token. */
  cookieName?: string;
  /**
   * Optional parent domain shared by platform-auth entry points (for example
   * `openbot.example.com`). Omit to keep the safer host-only cookie default.
   */
  cookieDomain?: string;
  /**
   * Require TOTP MFA for platform-grade (super-admin / admin) logins.
   * Default: true. When false, platform logins succeed without MFA but any
   * supplied mfaCode is still verified.
   */
  requireMfaForPlatformAdmins?: boolean;
};

export type GatewayEnterpriseSeatAssetsBackendKind = "json" | "sqlite";

export type GatewayEnterpriseSeatAssetsConfig = {
  /** Canonical store backend for enterprise seat assets. Default: json */
  backend?: GatewayEnterpriseSeatAssetsBackendKind;
  /** Optional store path override for the selected backend. */
  store?: string;
  /** SQLite busy_timeout in milliseconds when backend=sqlite. Default: 5000. */
  sqliteBusyTimeoutMs?: number;
};

export type GatewayAuthConfig = {
  /** Authentication mode for Gateway connections. Defaults to token when unset. */
  mode?: GatewayAuthMode;
  /** Shared token for token mode (plaintext or SecretRef). */
  token?: SecretInput;
  /** Shared password for password mode (consider env instead). */
  password?: SecretInput;
  /** Allow Tailscale identity headers when serve mode is enabled. */
  allowTailscale?: boolean;
  /** Rate-limit configuration for failed authentication attempts. */
  rateLimit?: GatewayAuthRateLimitConfig;
  /**
   * Configuration for trusted-proxy auth mode.
   * Required when mode is "trusted-proxy".
   */
  trustedProxy?: GatewayTrustedProxyConfig;
};

export type GatewayAuthRateLimitConfig = {
  /** Maximum failed attempts per IP before blocking.  @default 10 */
  maxAttempts?: number;
  /** Sliding window duration in milliseconds.  @default 60000 (1 min) */
  windowMs?: number;
  /** Lockout duration in milliseconds after the limit is exceeded.  @default 300000 (5 min) */
  lockoutMs?: number;
  /** Exempt localhost/loopback addresses from auth rate limiting.  @default true */
  exemptLoopback?: boolean;
};

export type GatewayTailscaleMode = "off" | "serve" | "funnel";

export type GatewayTailscaleConfig = {
  /** Tailscale exposure mode for the Gateway control UI. */
  mode?: GatewayTailscaleMode;
  /** Reset serve/funnel configuration on shutdown. */
  resetOnExit?: boolean;
};

export type GatewayRemoteConfig = {
  /** Remote Gateway WebSocket URL (ws:// or wss://). */
  url?: string;
  /** Transport for macOS remote connections (ssh tunnel or direct WS). */
  transport?: "ssh" | "direct";
  /** Token for remote auth (when the gateway requires token auth). */
  token?: SecretInput;
  /** Password for remote auth (when the gateway requires password auth). */
  password?: SecretInput;
  /** Expected TLS certificate fingerprint (sha256) for remote gateways. */
  tlsFingerprint?: string;
  /** SSH target for tunneling remote Gateway (user@host). */
  sshTarget?: string;
  /** SSH identity file path for tunneling remote Gateway. */
  sshIdentity?: string;
};

export type GatewayReloadMode = "off" | "restart" | "hot" | "hybrid";

export type GatewayReloadConfig = {
  /** Reload strategy for config changes (default: hybrid). */
  mode?: GatewayReloadMode;
  /** Debounce window for config reloads (ms). Default: 300. */
  debounceMs?: number;
};

export type GatewayHttpChatCompletionsConfig = {
  /**
   * If false, the Gateway will not serve `POST /v1/chat/completions`.
   * Default: false when absent.
   */
  enabled?: boolean;
  /**
   * Max request body size in bytes for `/v1/chat/completions`.
   * Default: 20MB.
   */
  maxBodyBytes?: number;
  /**
   * Max number of `image_url` parts processed from the latest user message.
   * Default: 8.
   */
  maxImageParts?: number;
  /**
   * Max cumulative decoded image bytes for all `image_url` parts in one request.
   * Default: 20MB.
   */
  maxTotalImageBytes?: number;
  /** Image input controls for `image_url` parts. */
  images?: GatewayHttpChatCompletionsImagesConfig;
};

export type GatewayHttpChatCompletionsImagesConfig = {
  /** Allow URL fetches for `image_url` parts. Default: false. */
  allowUrl?: boolean;
  /**
   * Optional hostname allowlist for URL fetches.
   * Supports exact hosts and `*.example.com` wildcards.
   */
  urlAllowlist?: string[];
  /** Allowed MIME types (case-insensitive). */
  allowedMimes?: string[];
  /** Max bytes per image. Default: 10MB. */
  maxBytes?: number;
  /** Max redirects when fetching a URL. Default: 3. */
  maxRedirects?: number;
  /** Fetch timeout in ms. Default: 10s. */
  timeoutMs?: number;
};

export type GatewayHttpResponsesConfig = {
  /**
   * If false, the Gateway will not serve `POST /v1/responses` (OpenResponses API).
   * Default: false when absent.
   */
  enabled?: boolean;
  /**
   * Max request body size in bytes for `/v1/responses`.
   * Default: 20MB.
   */
  maxBodyBytes?: number;
  /**
   * Max number of URL-based `input_file` + `input_image` parts per request.
   * Default: 8.
   */
  maxUrlParts?: number;
  /** File inputs (input_file). */
  files?: GatewayHttpResponsesFilesConfig;
  /** Image inputs (input_image). */
  images?: GatewayHttpResponsesImagesConfig;
};

export type GatewayHttpResponsesFilesConfig = {
  /** Allow URL fetches for input_file. Default: true. */
  allowUrl?: boolean;
  /**
   * Optional hostname allowlist for URL fetches.
   * Supports exact hosts and `*.example.com` wildcards.
   */
  urlAllowlist?: string[];
  /** Allowed MIME types (case-insensitive). */
  allowedMimes?: string[];
  /** Max bytes per file. Default: 5MB. */
  maxBytes?: number;
  /** Max decoded characters per file. Default: 200k. */
  maxChars?: number;
  /** Max redirects when fetching a URL. Default: 3. */
  maxRedirects?: number;
  /** Fetch timeout in ms. Default: 10s. */
  timeoutMs?: number;
  /** PDF handling (application/pdf). */
  pdf?: GatewayHttpResponsesPdfConfig;
};

export type GatewayHttpResponsesPdfConfig = {
  /** Max pages to parse/render. Default: 4. */
  maxPages?: number;
  /** Max pixels per rendered page. Default: 4M. */
  maxPixels?: number;
  /** Minimum extracted text length to skip rasterization. Default: 200 chars. */
  minTextChars?: number;
};

export type GatewayHttpResponsesImagesConfig = {
  /** Allow URL fetches for input_image. Default: true. */
  allowUrl?: boolean;
  /**
   * Optional hostname allowlist for URL fetches.
   * Supports exact hosts and `*.example.com` wildcards.
   */
  urlAllowlist?: string[];
  /** Allowed MIME types (case-insensitive). */
  allowedMimes?: string[];
  /** Max bytes per image. Default: 10MB. */
  maxBytes?: number;
  /** Max redirects when fetching a URL. Default: 3. */
  maxRedirects?: number;
  /** Fetch timeout in ms. Default: 10s. */
  timeoutMs?: number;
};

export type GatewayHttpEndpointsConfig = {
  chatCompletions?: GatewayHttpChatCompletionsConfig;
  responses?: GatewayHttpResponsesConfig;
};

export type GatewayHttpSecurityHeadersConfig = {
  /**
   * Value for the Strict-Transport-Security response header.
   * Set to false to disable explicitly.
   *
   * Example: "max-age=31536000; includeSubDomains"
   */
  strictTransportSecurity?: string | false;
};

export type GatewayHttpConfig = {
  endpoints?: GatewayHttpEndpointsConfig;
  securityHeaders?: GatewayHttpSecurityHeadersConfig;
};

export type GatewayNodesConfig = {
  /** Browser routing policy for node-hosted browser proxies. */
  browser?: {
    /** Routing mode (default: auto). */
    mode?: "auto" | "manual" | "off";
    /** Pin to a specific node id/name (optional). */
    node?: string;
  };
  /** Additional node.invoke commands to allow on the gateway. */
  allowCommands?: string[];
  /** Commands to deny even if they appear in the defaults or node claims. */
  denyCommands?: string[];
};

export type GatewayToolsConfig = {
  /** Tools to deny via gateway HTTP /tools/invoke (extends defaults). */
  deny?: string[];
  /** Tools to explicitly allow (removes from default deny list). */
  allow?: string[];
  /**
   * Per-tenant capability table (`allow` | `deny`) for POST /tools/invoke governance.
   * Under the default `shadow` value of OPENBOT_GOVERNANCE_TOOLS_INVOKE_MODE it is read
   * only when OPENBOT_GOVERNANCE_TOOLS_INVOKE_SHADOW is on, and it only feeds the shadow
   * envelope: HTTP status and body do not change. Under `enforced` it is always read, and
   * an explicit `deny` returns the same 404 `not_found` as the gateway HTTP deny list.
   * `legacy` does not read it. A missing tenant or tool is unset and never blocks.
   */
  tenantCapabilities?: Readonly<
    Record<string, Readonly<Record<string, "allow" | "deny">> | undefined>
  >;
};

export type GatewayPlatformModelsMode = "native" | "aor_enhanced";

export type GatewayPlatformModelsAorConfig = {
  gatewayUrl?: string;
  toolsBaseUrl?: string;
  banditStatePath?: string;
  liveCodingArchivePath?: string;
  auditLogPath?: string;
  enableBandit?: boolean;
  enableRoutingExplanations?: boolean;
  enableOptimizationMetrics?: boolean;
};

/**
 * Runtime model entitlement enforcement mode (model-entitlement-chain P1).
 * - `off`: gate disabled (current behavior).
 * - `missing-allow` (default): unconfigured tenants pass; resolved entitlements are
 *   enforced (empty resolved set = hard deny).
 * - `strict`: unconfigured tenants are also denied.
 */
export type GatewayPlatformModelsEntitlementEnforceMode = "off" | "missing-allow" | "strict";

/**
 * Runtime entitlement enforcement SCOPE (model-entitlement-chain P5).
 * Orthogonal to `enforce` (which decides how a managed run is judged); `scope`
 * decides WHICH runs are managed:
 * - `employee-chat` (default): only the employee webchat 1:1 main turn (P1 behavior).
 * - `all-bot-runs`: also followup / collaboration multi-bot turns / cron / external-channel
 *   inbound, resolved by the bot's owning seat. Unresolvable ownership is always allowed
 *   (never kills a production bot).
 */
export type GatewayPlatformModelsEntitlementScope = "employee-chat" | "all-bot-runs";

export type GatewayPlatformModelsEntitlementRoutingMode = "legacy" | "tier";

export type GatewayPlatformModelsEntitlementConfig = {
  enforce?: GatewayPlatformModelsEntitlementEnforceMode;
  scope?: GatewayPlatformModelsEntitlementScope;
  /**
   * 套餐权益解析模式（Package V2 Phase 2）。
   * - `legacy`（默认）：binding.allowedModelIds 为真源。
   * - `tier`：binding.allowedTiers → Resource Catalog 投影模型池。
   */
  routingMode?: GatewayPlatformModelsEntitlementRoutingMode;
};

/**
 * Runtime model credential resolution mode (model-entitlement-chain P4).
 * - `legacy` (default): existing multi-source chain (auth-profiles → env → inline → secrets);
 *   ambient env vars can shadow the configured provider apiKey.
 * - `catalog`: the platform-catalog-configured provider credential (inline apiKey / SecretRef)
 *   is the single authoritative source and takes priority over BOTH stale auth-profiles and
 *   ambient env vars, making resolution unique and traceable to one credentialRef. Only an
 *   explicit profileId request and the aws-sdk auth mode rank above it. Falls back to the
 *   legacy chain (auth-profiles → env → inline) when no catalog credential is configured
 *   (rollback-safe). Auto-enabled when a provider key is saved via the platform console, so
 *   an admin-configured key takes effect without any manual mode toggle.
 */
export type GatewayPlatformModelsCredentialsMode = "legacy" | "catalog";

export type GatewayPlatformModelsCredentialsConfig = {
  mode?: GatewayPlatformModelsCredentialsMode;
};

/** Control-plane model management integration mode (native vs AOR-enhanced). */
export type GatewayPlatformModelsConfig = {
  mode?: GatewayPlatformModelsMode;
  aor?: GatewayPlatformModelsAorConfig;
  /** Runtime model entitlement enforcement (model-entitlement-chain P1). */
  entitlement?: GatewayPlatformModelsEntitlementConfig;
  /** Runtime credential convergence (model-entitlement-chain P4). */
  credentials?: GatewayPlatformModelsCredentialsConfig;
};

export type GatewayUserModelingTenantConfig = {
  /** Per-tenant override for deterministic user modeling. */
  enabled?: boolean;
  /** Per-tenant override for LLM profile inference. */
  inferEnabled?: boolean;
};

export type GatewayUserModelingConfig = {
  /** Global default for deterministic user modeling (default: on when env unset). */
  enabled?: boolean;
  /** Global default for LLM inference (default: off). */
  inferEnabled?: boolean;
  /** Per-tenant overrides; take precedence over global gateway.userModeling fields. */
  tenants?: Record<string, GatewayUserModelingTenantConfig>;
};

export type GatewayPlatformConfig = {
  models?: GatewayPlatformModelsConfig;
};

export type GatewayConversationsConfig = {
  catalog?: { enabled?: boolean };
  historyCursor?: { enabled?: boolean };
};

export type TenantRetentionConversationPolicy = {
  activeDays?: number;
  archiveDays?: number;
  deleteAfterDays?: number;
};

export type TenantRetentionPolicy = {
  conversation?: TenantRetentionConversationPolicy;
  memory?: { deleteAfterDays?: number | null };
  task?: { archiveAfterDays?: number; deleteAfterDays?: number };
  complianceProfile?: "standard" | "financial" | "custom";
};

export type GatewayTenantPolicyEntry = {
  retention?: TenantRetentionPolicy;
};

export type GatewayTenantPoliciesConfig = Record<string, GatewayTenantPolicyEntry>;

/**
 * Deployment security profile (Data Governance v2 Gate 0).
 * Server-controlled only — never accept from client requests.
 */
export type GatewaySecurityConfig = {
  /** Explicit trust model. Prefer OPENBOT_SECURITY_PROFILE env in production. */
  profile?: "personal_local" | "managed_enterprise";
  /**
   * Managed Enterprise execution boundary. Production requires `dedicated`
   * until shared-process I3 isolation is proven.
   */
  tenantExecutionBoundary?: "dedicated" | "shared_process";
  /**
   * True when a tenant data root is configured out-of-band (e.g. secret mount).
   * Use when OPENBOT_TENANTS_ROOT cannot be placed in process env for ops reasons.
   * Never store the actual path here in committed config.
   */
  tenantsRootConfigured?: boolean;
  /** Fail closed when true — shared browser state across tenants. */
  sharedBrowserRoot?: boolean;
  /** Fail closed when true — shared credential root across tenants. */
  sharedCredentialRoot?: boolean;
  /** Fail closed when true — shared queue/cache across tenants. */
  sharedQueueOrCache?: boolean;
  /** Plugin tenant filesystem access. Default restricted. */
  pluginTenantAccess?: "restricted" | "unrestricted";
};

/**
 * Isolation-only gateway facade for talking to the exec-protocol control
 * plane (A') with the existing client. Off by default. This is not a
 * production execution profile. Callers must pass every isolation key
 * explicitly (config object or environment); missing keys are refused
 * rather than filled from signed isolation defaults.
 */
export type GatewayExecProtocolConfig = {
  /** Opt-in. Default false. */
  enabled?: boolean;
  /** Bearer lease token used to call A'. Never log this value. */
  leaseToken?: string;
  /**
   * Optional explicit A' base URL (loopback only). When omitted, the
   * facade constructs `http://{bind}:{port}` from the explicit isolation
   * bind and port.
   */
  controlPlaneUrl?: string;
  profileName?: "exec-protocol-v1-isolation";
  bind?: string;
  port?: number;
  connectTimeoutMs?: number;
  requestTimeoutMs?: number;
  executionTimeoutMs?: number;
  maxTransportRetries?: number;
  transportBackoffMs?: number[];
  idempotencyTtlMs?: number;
  cancelDeadlineMs?: number;
  leaseTtlMs?: number;
  maxClockSkewMs?: number;
};

export type GatewayConfig = {
  /** Single multiplexed port for Gateway WS + HTTP (default: 18789). */
  port?: number;
  /**
   * Data Governance v2 security profile and managed isolation gates.
   * See `src/gateway/security-profile.ts`.
   */
  security?: GatewaySecurityConfig;
  /**
   * Explicit gateway mode. When set to "remote", local gateway start is disabled.
   * When set to "local", the CLI may start the gateway locally.
   */
  mode?: "local" | "remote";
  /**
   * Bind address policy for the Gateway WebSocket + Control UI HTTP server.
   * - auto: Loopback (127.0.0.1) if available, else 0.0.0.0 (fallback to all interfaces)
   * - lan: 0.0.0.0 (all interfaces, no fallback)
   * - loopback: 127.0.0.1 (local-only)
   * - tailnet: Tailnet IPv4 if available (100.64.0.0/10), else loopback
   * - custom: User-specified IP, fallback to 0.0.0.0 if unavailable (requires customBindHost)
   * Default: loopback (127.0.0.1).
   */
  bind?: GatewayBindMode;
  /** Custom IP address for bind="custom" mode. Fallback: 0.0.0.0. */
  customBindHost?: string;
  controlUi?: GatewayControlUiConfig;
  /**
   * OpenBot Fabric control plane (tool execution governance). Default OFF.
   * Platform-level toggle: when enabled, all tenants + end users are covered.
   * Equivalent to the OPENBOT_FABRIC_ENABLED env flag (env OR config wins).
   */
  fabric?: { enabled?: boolean };
  /**
   * Task Progress Ledger (event-sourced execution observability). Default OFF.
   * Equivalent to the OPENBOT_PROGRESS_LEDGER_ENABLED env flag (env OR config wins).
   */
  progressLedger?: { enabled?: boolean };
  /**
   * Development Supervisor (autonomous dev task orchestration). Default OFF.
   * Equivalent to the OPENBOT_SUPERVISOR_ENABLED env flag (env OR config wins).
   */
  supervisor?: {
    enabled?: boolean;
    budget?: {
      maxIterations?: number;
      maxCostUsd?: number;
      maxDurationMinutes?: number;
    };
    /** Bounded queue runner (M4.3): lease + worker pool instead of naive cron sweep. */
    runner?: {
      enabled?: boolean;
      maxConcurrency?: number;
      leaseTtlMs?: number;
      tickIntervalMs?: number;
    };
  };
  /**
   * DeliveryLane (tip → seal → merge_ready). Default OFF.
   * Equivalent to OPENBOT_DELIVERY_LANE_ENABLED (env OR config wins).
   * Tip A: no GitHub merge; path1CrossBot forces cross-bot acceptSeal.
   */
  deliveryLane?: {
    enabled?: boolean;
    /** When true, acceptSeal must be issued by a different bot (path-1). */
    path1CrossBot?: boolean;
    /** Tip E: max concurrent helpers per lane (default 2). */
    maxLaneHelpers?: number;
  };
  /**
   * Cross-session user preference modeling (deterministic capture + optional LLM infer).
   * Tenant overrides in `userModeling.tenants` take precedence over global fields.
   * `OPENBOT_USER_MODELING=off` is a platform hard-off regardless of config.
   */
  userModeling?: GatewayUserModelingConfig;
  /** Conversation catalog + retention policy controls (context lifecycle P1). */
  conversations?: GatewayConversationsConfig;
  /** Per-tenant data retention overrides (platform default key: `default`). */
  tenantPolicies?: GatewayTenantPoliciesConfig;
  auth?: GatewayAuthConfig;
  enterpriseSeatAssets?: GatewayEnterpriseSeatAssetsConfig;
  tailscale?: GatewayTailscaleConfig;
  remote?: GatewayRemoteConfig;
  reload?: GatewayReloadConfig;
  tls?: GatewayTlsConfig;
  http?: GatewayHttpConfig;
  nodes?: GatewayNodesConfig;
  /**
   * IPs of trusted reverse proxies (e.g. Traefik, nginx). When a connection
   * arrives from one of these IPs, the Gateway trusts `x-forwarded-for`
   * to determine the client IP for local pairing and HTTP checks.
   */
  trustedProxies?: string[];
  /**
   * Allow `x-real-ip` as a fallback only when `x-forwarded-for` is missing.
   * Default: false (safer fail-closed behavior).
   */
  allowRealIpFallback?: boolean;
  /**
   * Isolation-only HTTP facade for the exec-protocol control plane (A').
   * Off by default. Enabling this does not implement or enable a production
   * execution profile. All isolation config keys must be provided explicitly;
   * signed isolation numbers are never auto-filled. Never set
   * OPENBOT_PRODUCTION_EXECUTION_MODE=production.
   */
  execProtocol?: GatewayExecProtocolConfig;
  /** Tool access restrictions for HTTP /tools/invoke endpoint. */
  tools?: GatewayToolsConfig;
  /** Platform control-plane extensions (model management mode, etc.). */
  platform?: GatewayPlatformConfig;
  /**
   * Channel health monitor interval in minutes.
   * Periodically checks channel health and restarts unhealthy channels.
   * Set to 0 to disable. Default: 5.
   */
  channelHealthCheckMinutes?: number;
};
