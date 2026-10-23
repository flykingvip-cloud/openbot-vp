import { assistantFromHuman, type DigitalHumanConfig, type StubConfig } from "./config.js";
import { authInvalid, DeviceDhError, notFound } from "./errors.js";
import { pullMedia, validateImageBytes, type MediaCheck } from "./media.js";
import {
  createPlaceholderModelClient,
  DeviceDhModelError,
  type DeviceDhModelClient,
  type DeviceDhTrustedAgent,
} from "./model.js";
import {
  API_VERSION,
  IDEMPOTENCY_TTL_MS,
  PROTOCOL_VERSION,
  SCHEMA_VERSION,
  type AssistantProfile,
  type AuditRecord,
  type CancelReason,
  type ClientCancelReason,
  type ClientRole,
  type EventEnvelope,
  type RunStatus,
  type ToolResultStatus,
} from "./types.js";
import {
  bodyHash,
  isRecord,
  pkceS256,
  randomId,
  readNumber,
  readString,
  safeEqual,
  sha256Hex,
} from "./util.js";

const IDENTITY_FIELDS = [
  "userId",
  "tenantId",
  "agentId",
  "gatewayAgentId",
  "sessionKey",
  "userSubject",
  "ownerId",
];
const CLIENT_CANCEL: ReadonlySet<string> = new Set(["barge_in", "user", "timeout", "unbind"]);
const TERMINAL: ReadonlySet<RunStatus> = new Set([
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]);
const ALLOWED_TOOL = "camera.capture";

type IdemRecord = {
  hash: string;
  createdAt: number;
  status: number;
  body: Record<string, unknown>;
  /**
   * Tool-result reservation written before the request leaves `pending`.
   * Replaced by the final response after vision. Not a successful completion.
   */
  inflight?: boolean;
};

type AuthCode = {
  codeHash: string;
  serviceAudience: string;
  redirectUri: string;
  codeChallenge: string;
  digitalHumanId: string;
  deviceId: string;
  scopes: string[];
  state: string;
  expiresAt: number;
  consumed: boolean;
};

type GrantRecord = {
  authorizationRef: string;
  credentialHash: string;
  clientId: string;
  digitalHumanId: string;
  deviceId: string;
  userSubject: string;
  tenantId: string;
  scopes: string[];
  bindingVersion: number;
  status: "active" | "revoked";
  issuedAt: number;
  expiresAt: number;
  revokedAt?: number;
  capabilities?: CapabilitySnapshot;
};

type CapabilitySnapshot = {
  schemaVersion: number;
  capabilitiesVersion: number;
  firmwareVersion?: string;
  protocolVersion?: string;
  online: boolean;
  acceptedTools: string[];
  ignoredTools: string[];
  camera?: Record<string, unknown>;
  updatedAt: number;
};

type ConversationRecord = {
  conversationId: string;
  authorizationRef: string;
  externalConversationId?: string;
  digitalHumanId: string;
  deviceId: string;
  bindingVersion: number;
  createdAt: number;
  updatedAt: number;
  closed: boolean;
};

type RunRecord = {
  runId: string;
  conversationId: string;
  turnId: string;
  authorizationRef: string;
  bindingVersion: number;
  deviceId: string;
  digitalHumanId: string;
  traceId?: string;
  inputText: string;
  status: RunStatus;
  errorCode?: string;
  retryable: boolean;
  visibleText?: string;
  messageId?: string;
  approvalId?: string;
  cancelReason?: CancelReason;
  /** Aborts the in-flight gateway chat-completions fetch for this run. */
  modelAbort?: AbortController;
  createdAt: number;
  finishedAt?: number;
  events: EventEnvelope[];
  nextSequence: number;
};

type ToolRequest = {
  requestId: string;
  authorizationRef: string;
  bindingVersion: number;
  runId: string;
  turnId: string;
  deviceId: string;
  traceId?: string;
  toolName: string;
  params: Record<string, unknown>;
  state: "pending" | "fulfilled" | "cancelled" | "expired" | "closed";
  expiresAt: number;
};

type ApprovalRecord = {
  approvalId: string;
  runId: string;
  authorizationRef: string;
  state: "pending" | "approved" | "denied" | "cancelled";
};

type UploadTicket = {
  ticket: string;
  mediaId: string;
  authorizationRef: string;
  requestId: string;
  expiresAt: number;
  used: boolean;
  bytes?: Buffer;
  contentType?: string;
};

type ClientRecord = StubConfig["clients"][number];

export type ServiceOptions = {
  config: StubConfig;
  now?: () => number;
  approvalToken?: string;
  idempotencyTtlMs?: number;
  maxEvents?: number;
  rateLimitPerMinute?: number;
  toolTimeoutMs?: number;
  maxImageBytes?: number;
  maxPixels?: number;
  mediaAllowOrigins?: string[];
  mediaTimeoutMs?: number;
  grantTtlMs?: number;
  codeTtlMs?: number;
  onAudit?: (record: AuditRecord) => void;
  /** Defaults to the offline placeholder hatch. Pass a gateway client for real replies. */
  models?: DeviceDhModelClient;
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class DeviceDhService {
  private readonly now: () => number;
  private readonly clients = new Map<string, ClientRecord>();
  private readonly humans = new Map<string, DigitalHumanConfig>();
  private readonly codes = new Map<string, AuthCode>();
  private readonly grants = new Map<string, GrantRecord>();
  private readonly conversations = new Map<string, ConversationRecord>();
  private readonly runs = new Map<string, RunRecord>();
  private readonly toolRequests = new Map<string, ToolRequest>();
  private readonly approvals = new Map<string, ApprovalRecord>();
  private readonly tickets = new Map<string, UploadTicket>();
  private readonly media = new Map<string, { bytes: Buffer; contentType: string }>();
  private readonly idem = new Map<string, IdemRecord>();
  private readonly deviceEvents = new Map<string, EventEnvelope[]>();
  private readonly deviceSeq = new Map<string, number>();
  private readonly runSubs = new Map<string, Set<(event: EventEnvelope) => void>>();
  private readonly deviceSubs = new Map<string, Set<(event: EventEnvelope) => void>>();
  private readonly auditLog: AuditRecord[] = [];
  private readonly hits = new Map<string, { window: number; count: number }>();
  private readonly approvalToken: string;
  private readonly idempotencyTtlMs: number;
  private readonly maxEvents: number;
  private readonly rateLimitPerMinute: number;
  private readonly toolTimeoutMs: number;
  private readonly maxImageBytes: number;
  private readonly maxPixels: number;
  private readonly mediaAllowOrigins: string[];
  private readonly mediaTimeoutMs: number;
  private readonly grantTtlMs: number;
  private readonly codeTtlMs: number;
  private readonly onAudit?: (record: AuditRecord) => void;
  private readonly models: DeviceDhModelClient;

  constructor(options: ServiceOptions) {
    this.now = options.now ?? Date.now;
    this.approvalToken = options.approvalToken ?? "dev-approval-token";
    this.idempotencyTtlMs = options.idempotencyTtlMs ?? IDEMPOTENCY_TTL_MS;
    this.maxEvents = options.maxEvents ?? 1000;
    this.rateLimitPerMinute = options.rateLimitPerMinute ?? 6000;
    this.toolTimeoutMs = options.toolTimeoutMs ?? 30_000;
    this.maxImageBytes = options.maxImageBytes ?? 2_000_000;
    this.maxPixels = options.maxPixels ?? 8_000_000;
    this.mediaAllowOrigins = options.mediaAllowOrigins ?? [];
    this.mediaTimeoutMs = options.mediaTimeoutMs ?? 3_000;
    this.grantTtlMs = options.grantTtlMs ?? 30 * 24 * 60 * 60 * 1000;
    this.codeTtlMs = options.codeTtlMs ?? 60_000;
    this.onAudit = options.onAudit;
    this.models = options.models ?? createPlaceholderModelClient();
    for (const client of options.config.clients) {
      this.clients.set(client.clientId, client);
    }
    for (const human of options.config.digitalHumans) {
      this.humans.set(human.digitalHumanId, human);
    }
  }

  takeRate(key: string): void {
    if (this.rateLimitPerMinute <= 0) {
      return;
    }
    const window = Math.floor(this.now() / 60_000);
    const row = this.hits.get(key);
    if (!row || row.window !== window) {
      this.hits.set(key, { window, count: 1 });
      return;
    }
    row.count += 1;
    if (row.count > this.rateLimitPerMinute) {
      throw new DeviceDhError("RATE_LIMITED", "Too many requests", {
        headers: { "Retry-After": "60" },
      });
    }
  }

  sweep(): void {
    for (const request of this.toolRequests.values()) {
      if (request.expiresAt > this.now()) {
        continue;
      }
      const run = this.runs.get(request.runId);
      // Vision is still part of accepting the result. A deadline that wins
      // during that await must not be overwritten by a later completion.
      const visionOpen =
        request.state === "fulfilled" && run !== undefined && !TERMINAL.has(run.status);
      if (request.state !== "pending" && !visionOpen) {
        continue;
      }
      request.state = "expired";
      if (visionOpen) {
        run.modelAbort?.abort();
      }
      if (run && !TERMINAL.has(run.status)) {
        this.failRun(run, "TOOL_TIMEOUT", "Device tool timed out", true);
      }
      this.audit({
        action: "tool.timeout",
        outcome: "error",
        authorizationRef: request.authorizationRef,
        deviceId: request.deviceId,
        runId: request.runId,
        requestId: request.requestId,
        code: "TOOL_TIMEOUT",
        traceId: request.traceId,
      });
    }
  }

  authenticate(clientId: string, secret: string, role: ClientRole): ClientRecord {
    const client = this.clients.get(clientId);
    const known = client?.secret ?? "missing-client-secret";
    if (!client || client.role !== role || !safeEqual(known, secret)) {
      this.audit({ action: "auth.rejected", outcome: "denied", clientId, code: "AUTH_INVALID" });
      throw authInvalid();
    }
    return client;
  }

  requireGrant(
    client: ClientRecord,
    credential: string | undefined,
    allowRevoked = false,
  ): GrantRecord {
    if (!credential) {
      throw authInvalid();
    }
    const hash = sha256Hex(credential);
    let found: GrantRecord | undefined;
    for (const grant of this.grants.values()) {
      if (grant.clientId === client.clientId && safeEqual(grant.credentialHash, hash)) {
        found = grant;
        break;
      }
    }
    if (!found) {
      this.audit({
        action: "auth.rejected",
        outcome: "denied",
        clientId: client.clientId,
        code: "AUTH_INVALID",
      });
      throw authInvalid();
    }
    if (found.expiresAt <= this.now() && found.status === "active") {
      found.status = "revoked";
      found.revokedAt = this.now();
    }
    if (found.status === "revoked" && !allowRevoked) {
      throw new DeviceDhError("AUTH_REVOKED", "Authorization is revoked");
    }
    return found;
  }

  issueAuthorizationCode(client: ClientRecord, body: Record<string, unknown>, traceId?: string) {
    this.rejectIdentity(body);
    const serviceAudience = requireText(body, "serviceAudience");
    const redirectUri = requireText(body, "redirectUri");
    const codeChallenge = requireText(body, "codeChallenge");
    const method = requireText(body, "codeChallengeMethod");
    const digitalHumanId = requireText(body, "digitalHumanId");
    const deviceId = requireText(body, "deviceId");
    const state = requireText(body, "state");
    const scopes = requireStringArray(body, "scopes");
    if (method !== "S256") {
      throw new DeviceDhError("PARAM_UNSUPPORTED", "Only PKCE S256 is supported");
    }
    const audience = this.clients.get(serviceAudience);
    if (!audience || audience.role !== "service" || !audience.redirectUris?.includes(redirectUri)) {
      throw new DeviceDhError(
        "PARAM_UNSUPPORTED",
        "redirectUri is not registered for the service audience",
      );
    }
    if (
      !client.allowedDigitalHumanIds?.includes(digitalHumanId) ||
      !this.humans.has(digitalHumanId)
    ) {
      throw notFound();
    }
    const allowed = new Set(client.scopes ?? []);
    if (scopes.length === 0 || scopes.some((scope) => !allowed.has(scope))) {
      throw new DeviceDhError("SCOPE_DENIED", "Requested scope is not allowed");
    }
    const human = this.humans.get(digitalHumanId);
    if (!human || human.status === "disabled") {
      throw notFound();
    }
    const raw = `code_${randomId(18)}`;
    const record: AuthCode = {
      codeHash: sha256Hex(raw),
      serviceAudience,
      redirectUri,
      codeChallenge,
      digitalHumanId,
      deviceId,
      scopes,
      state,
      expiresAt: this.now() + this.codeTtlMs,
      consumed: false,
    };
    this.codes.set(record.codeHash, record);
    this.audit({
      action: "authorization_code.issued",
      outcome: "ok",
      clientId: client.clientId,
      digitalHumanId,
      deviceId,
      traceId,
    });
    return {
      authorizationCode: raw,
      expiresAt: new Date(record.expiresAt).toISOString(),
      state,
      digitalHumanId,
      deviceId,
    };
  }

  exchangeGrant(
    client: ClientRecord,
    body: Record<string, unknown>,
    idempotencyKey?: string,
    traceId?: string,
  ) {
    this.rejectIdentity(body);
    const material = idempotencyMaterial(body);
    const scope = idempotencyKey ? `exchange:${client.clientId}:${idempotencyKey}` : undefined;
    if (scope && idempotencyKey) {
      const prior = this.takeIdem(scope, bodyHash(material));
      if (prior) {
        return { ...clone(prior.body), disposition: "duplicate", duplicate: true };
      }
    }
    const authorizationCode = requireText(body, "authorizationCode");
    const codeVerifier = requireText(body, "codeVerifier");
    const redirectUri = requireText(body, "redirectUri");
    const code = this.codes.get(sha256Hex(authorizationCode));
    if (
      !code ||
      code.consumed ||
      code.expiresAt <= this.now() ||
      code.serviceAudience !== client.clientId ||
      code.redirectUri !== redirectUri
    ) {
      throw authInvalid();
    }
    if (!safeEqual(pkceS256(codeVerifier), code.codeChallenge)) {
      throw authInvalid();
    }
    const human = this.humans.get(code.digitalHumanId);
    if (!human) {
      throw notFound();
    }
    code.consumed = true;
    const credential = `obgc_${randomId(24)}`;
    const grant: GrantRecord = {
      authorizationRef: `azr_${randomId()}`,
      credentialHash: sha256Hex(credential),
      clientId: client.clientId,
      digitalHumanId: human.digitalHumanId,
      deviceId: code.deviceId,
      userSubject: human.userSubject,
      tenantId: human.tenantId,
      scopes: [...code.scopes],
      bindingVersion: 1,
      status: "active",
      issuedAt: this.now(),
      expiresAt: this.now() + this.grantTtlMs,
    };
    this.grants.set(grant.authorizationRef, grant);
    this.deviceEvents.set(grant.authorizationRef, []);
    const response = {
      ...this.grantView(grant),
      authorizationCredential: credential,
      disposition: "accepted",
    };
    if (scope) {
      this.remember(scope, bodyHash(material), 200, response);
    }
    this.audit({
      action: "grant.exchanged",
      outcome: "ok",
      clientId: client.clientId,
      authorizationRef: grant.authorizationRef,
      digitalHumanId: grant.digitalHumanId,
      deviceId: grant.deviceId,
      userSubject: grant.userSubject,
      tenantId: grant.tenantId,
      traceId,
    });
    return response;
  }

  getGrant(grant: GrantRecord, authorizationRef: string) {
    this.assertSameGrant(grant, authorizationRef);
    return this.grantView(grant);
  }

  revokeGrant(grant: GrantRecord, authorizationRef: string, traceId?: string) {
    this.assertSameGrant(grant, authorizationRef);
    if (grant.status !== "revoked") {
      grant.status = "revoked";
      grant.revokedAt = this.now();
      this.cancelGrantWork(grant, "revoked");
      this.pushDeviceEvent(grant, "authorization.revoked", {
        authorizationRef: grant.authorizationRef,
        bindingVersion: grant.bindingVersion,
        digitalHumanId: grant.digitalHumanId,
        deviceId: grant.deviceId,
        revokedAt: new Date(grant.revokedAt).toISOString(),
      });
      this.audit({
        action: "grant.revoked",
        outcome: "ok",
        clientId: grant.clientId,
        authorizationRef: grant.authorizationRef,
        digitalHumanId: grant.digitalHumanId,
        deviceId: grant.deviceId,
        userSubject: grant.userSubject,
        tenantId: grant.tenantId,
        traceId,
      });
    }
    return {
      authorizationRef: grant.authorizationRef,
      status: "revoked" as const,
      bindingVersion: grant.bindingVersion,
      digitalHumanId: grant.digitalHumanId,
      deviceId: grant.deviceId,
      revokedAt: new Date(grant.revokedAt ?? this.now()).toISOString(),
    };
  }

  rebind(
    client: ClientRecord,
    authorizationRef: string,
    body: Record<string, unknown>,
    traceId?: string,
  ) {
    this.rejectIdentity(body);
    const grant = this.grants.get(authorizationRef);
    if (!grant || grant.status !== "active") {
      throw notFound();
    }
    const digitalHumanId = requireText(body, "digitalHumanId");
    if (
      !client.allowedDigitalHumanIds?.includes(digitalHumanId) ||
      !this.humans.has(digitalHumanId)
    ) {
      throw notFound();
    }
    const human = this.humans.get(digitalHumanId);
    if (!human || human.status === "disabled") {
      throw notFound();
    }
    this.cancelGrantWork(grant, "unbind");
    grant.bindingVersion += 1;
    grant.digitalHumanId = human.digitalHumanId;
    grant.userSubject = human.userSubject;
    grant.tenantId = human.tenantId;
    for (const conversation of this.conversations.values()) {
      if (conversation.authorizationRef === grant.authorizationRef && !conversation.closed) {
        conversation.closed = true;
        conversation.updatedAt = this.now();
      }
    }
    this.pushDeviceEvent(grant, "binding.updated", {
      authorizationRef: grant.authorizationRef,
      bindingVersion: grant.bindingVersion,
      digitalHumanId: grant.digitalHumanId,
      deviceId: grant.deviceId,
    });
    this.audit({
      action: "grant.rebind",
      outcome: "ok",
      clientId: client.clientId,
      authorizationRef: grant.authorizationRef,
      digitalHumanId: grant.digitalHumanId,
      deviceId: grant.deviceId,
      traceId,
    });
    return this.grantView(grant);
  }

  putCapabilities(grant: GrantRecord, authorizationRef: string, body: Record<string, unknown>) {
    this.assertSameGrant(grant, authorizationRef);
    this.assertBinding(grant, body);
    if (readString(body, "deviceId") && readString(body, "deviceId") !== grant.deviceId) {
      throw new DeviceDhError("BINDING_MISMATCH", "deviceId does not match the authorization");
    }
    const accepted: string[] = [];
    const ignored: string[] = [];
    const tools = Array.isArray(body.tools) ? body.tools : [];
    for (const tool of tools) {
      if (!isRecord(tool) || typeof tool.name !== "string") {
        throw new DeviceDhError("PARAM_UNSUPPORTED", "Tool name is required");
      }
      const available = tool.available !== false;
      if (tool.name === ALLOWED_TOOL && available && grant.scopes.includes(ALLOWED_TOOL)) {
        accepted.push(ALLOWED_TOOL);
      } else {
        ignored.push(tool.name);
      }
    }
    const camera = isRecord(body.camera) ? body.camera : undefined;
    if (camera && !tools.length && grant.scopes.includes(ALLOWED_TOOL)) {
      accepted.push(ALLOWED_TOOL);
    }
    const version = readNumber(body, "capabilitiesVersion") ?? 1;
    grant.capabilities = {
      schemaVersion: readNumber(body, "schemaVersion") ?? 1,
      capabilitiesVersion: version,
      firmwareVersion: readString(body, "firmwareVersion"),
      protocolVersion: readString(body, "protocolVersion"),
      online: body.online !== false,
      acceptedTools: [...new Set(accepted)],
      ignoredTools: ignored,
      camera,
      updatedAt: this.now(),
    };
    this.audit({
      action: "device.capabilities",
      outcome: "ok",
      clientId: grant.clientId,
      authorizationRef: grant.authorizationRef,
      deviceId: grant.deviceId,
      digitalHumanId: grant.digitalHumanId,
    });
    return {
      authorizationRef: grant.authorizationRef,
      bindingVersion: grant.bindingVersion,
      deviceId: grant.deviceId,
      capabilitiesVersion: version,
      acceptedTools: grant.capabilities.acceptedTools,
      ignoredTools: grant.capabilities.ignoredTools,
    };
  }

  digitalHuman(grant: GrantRecord, digitalHumanId: string) {
    if (grant.digitalHumanId !== digitalHumanId) {
      throw notFound();
    }
    return {
      assistant: this.assistant(grant),
      digitalHumanId,
      bindingVersion: grant.bindingVersion,
    };
  }

  createConversation(grant: GrantRecord, body: Record<string, unknown>, traceId?: string) {
    this.rejectIdentity(body);
    this.assertActive(grant);
    this.assertBinding(grant, body);
    const deviceId = readString(body, "deviceId") ?? grant.deviceId;
    if (deviceId !== grant.deviceId) {
      throw new DeviceDhError("BINDING_MISMATCH", "deviceId does not match the authorization");
    }
    if (
      readString(body, "authorizationRef") &&
      readString(body, "authorizationRef") !== grant.authorizationRef
    ) {
      throw new DeviceDhError("BINDING_MISMATCH", "authorizationRef does not match the credential");
    }
    const externalConversationId = readString(body, "externalConversationId");
    if (externalConversationId) {
      for (const existing of this.conversations.values()) {
        if (
          existing.authorizationRef === grant.authorizationRef &&
          existing.externalConversationId === externalConversationId &&
          existing.bindingVersion === grant.bindingVersion &&
          !existing.closed
        ) {
          return this.conversationView(existing, grant);
        }
      }
    }
    const conversation: ConversationRecord = {
      conversationId: `conv_${randomId()}`,
      authorizationRef: grant.authorizationRef,
      externalConversationId,
      digitalHumanId: grant.digitalHumanId,
      deviceId: grant.deviceId,
      bindingVersion: grant.bindingVersion,
      createdAt: this.now(),
      updatedAt: this.now(),
      closed: false,
    };
    this.conversations.set(conversation.conversationId, conversation);
    this.audit({
      action: "conversation.created",
      outcome: "ok",
      clientId: grant.clientId,
      authorizationRef: grant.authorizationRef,
      conversationId: conversation.conversationId,
      deviceId: grant.deviceId,
      digitalHumanId: grant.digitalHumanId,
      userSubject: grant.userSubject,
      tenantId: grant.tenantId,
      traceId,
    });
    return this.conversationView(conversation, grant);
  }

  getConversation(grant: GrantRecord, conversationId: string) {
    const conversation = this.conversations.get(conversationId);
    if (!conversation || conversation.authorizationRef !== grant.authorizationRef) {
      throw notFound();
    }
    return this.conversationView(conversation, grant);
  }

  closeConversation(grant: GrantRecord, conversationId: string) {
    const conversation = this.requireConversation(grant, conversationId);
    conversation.closed = true;
    conversation.updatedAt = this.now();
    return {
      conversationId,
      status: "closed" as const,
      bindingVersion: conversation.bindingVersion,
    };
  }

  async submitTurn(
    grant: GrantRecord,
    conversationId: string,
    body: Record<string, unknown>,
    idempotencyKey: string | undefined,
    traceId?: string,
  ) {
    this.sweep();
    this.rejectIdentity(body);
    this.assertActive(grant);
    if (!idempotencyKey) {
      throw new DeviceDhError("PARAM_UNSUPPORTED", "Idempotency-Key is required");
    }
    const bodyKey = readString(body, "idempotencyKey");
    if (bodyKey && bodyKey !== idempotencyKey) {
      throw new DeviceDhError("PARAM_UNSUPPORTED", "idempotencyKey does not match Idempotency-Key");
    }
    const conversation = this.requireConversation(grant, conversationId);
    if (conversation.closed || conversation.bindingVersion !== grant.bindingVersion) {
      throw new DeviceDhError("BINDING_MISMATCH", "Conversation binding is no longer current");
    }
    this.assertBinding(grant, body);
    const text = this.turnText(body);
    const turnId = requireText(body, "turnId");
    const material = idempotencyMaterial({ ...body, turnId, text, conversationId });
    const scope = `turn:${grant.clientId}:${grant.authorizationRef}:${conversationId}:${idempotencyKey}`;
    const prior = this.takeIdem(scope, bodyHash(material));
    if (prior) {
      const priorRunId = prior.body.runId;
      const run = typeof priorRunId === "string" ? this.runs.get(priorRunId) : undefined;
      this.audit({
        action: "turn.duplicate",
        outcome: "ok",
        authorizationRef: grant.authorizationRef,
        runId: run?.runId,
        traceId,
      });
      return {
        ...clone(prior.body),
        disposition: "duplicate",
        duplicate: true,
        status: run?.status ?? prior.body.status,
      };
    }
    if (this.conversationBusy(conversationId)) {
      throw new DeviceDhError("SESSION_BUSY", "Conversation already has an active run", {
        headers: { "Retry-After": "1" },
      });
    }
    for (const run of this.runs.values()) {
      if (run.conversationId === conversationId && run.turnId === turnId) {
        throw new DeviceDhError("IDEMPOTENCY_CONFLICT", "turnId was already used");
      }
    }
    const run: RunRecord = {
      runId: `run_${randomId()}`,
      conversationId,
      turnId,
      authorizationRef: grant.authorizationRef,
      bindingVersion: grant.bindingVersion,
      deviceId: grant.deviceId,
      digitalHumanId: grant.digitalHumanId,
      traceId,
      inputText: text,
      status: "accepted",
      retryable: false,
      createdAt: this.now(),
      events: [],
      nextSequence: 1,
    };
    this.runs.set(run.runId, run);
    conversation.updatedAt = this.now();
    this.beginRun(run);
    const response: Record<string, unknown> = {
      runId: run.runId,
      turnId,
      conversationId,
      authorizationRef: grant.authorizationRef,
      bindingVersion: grant.bindingVersion,
      deviceId: grant.deviceId,
      digitalHumanId: grant.digitalHumanId,
      status: "accepted",
      disposition: "accepted",
    };
    // Idempotency is recorded before the model call. An in-flight retry with
    // the same key and body replays this runId instead of SESSION_BUSY.
    this.remember(scope, bodyHash(material), 202, response);
    this.audit({
      action: "turn.accepted",
      outcome: "ok",
      clientId: grant.clientId,
      authorizationRef: grant.authorizationRef,
      deviceId: grant.deviceId,
      digitalHumanId: grant.digitalHumanId,
      userSubject: grant.userSubject,
      tenantId: grant.tenantId,
      runId: run.runId,
      traceId,
    });
    void this.routeTurn(grant, run, text).catch((error) => {
      if (!TERMINAL.has(run.status)) {
        this.failModel(run, error);
      }
    });
    return {
      ...response,
      status: run.status,
    };
  }

  getRun(grant: GrantRecord, runId: string) {
    this.sweep();
    const run = this.requireRun(grant, runId);
    return this.runView(run);
  }

  cancelRun(grant: GrantRecord, runId: string, body: Record<string, unknown>, traceId?: string) {
    this.sweep();
    const run = this.requireRun(grant, runId);
    const reason = readString(body, "reason") ?? "user";
    if (!CLIENT_CANCEL.has(reason)) {
      throw new DeviceDhError("PARAM_UNSUPPORTED", "Cancel reason is not supported");
    }
    const turnId = readString(body, "turnId");
    if (turnId && turnId !== run.turnId) {
      throw new DeviceDhError("BINDING_MISMATCH", "turnId does not match the run");
    }
    if (run.status === "completed" || run.status === "failed" || run.status === "interrupted") {
      return {
        runId,
        accepted: false,
        status: run.status,
        sideEffectsRolledBack: false,
      };
    }
    if (run.status === "cancelled") {
      return {
        runId,
        accepted: true,
        status: "cancelled" as const,
        sideEffectsRolledBack: false,
        duplicate: true,
        reason: run.cancelReason,
      };
    }
    this.markCancelled(run, reason as ClientCancelReason);
    this.audit({
      action: "run.cancelled",
      outcome: "ok",
      authorizationRef: grant.authorizationRef,
      runId,
      traceId,
      deviceId: grant.deviceId,
    });
    return {
      runId,
      accepted: true,
      status: "cancelled" as const,
      sideEffectsRolledBack: false,
      reason,
    };
  }

  listRunEvents(grant: GrantRecord, runId: string, cursor: string | undefined): EventEnvelope[] {
    this.sweep();
    const run = this.requireRun(grant, runId);
    return this.sliceEvents(run.events, cursor);
  }

  listDeviceEvents(
    grant: GrantRecord,
    authorizationRef: string,
    cursor: string | undefined,
  ): EventEnvelope[] {
    this.sweep();
    this.assertSameGrant(grant, authorizationRef);
    return this.sliceEvents(this.deviceEvents.get(grant.authorizationRef) ?? [], cursor);
  }

  subscribeRun(runId: string, listener: (event: EventEnvelope) => void): () => void {
    const set = this.runSubs.get(runId) ?? new Set();
    set.add(listener);
    this.runSubs.set(runId, set);
    return () => set.delete(listener);
  }

  subscribeDevice(authorizationRef: string, listener: (event: EventEnvelope) => void): () => void {
    const set = this.deviceSubs.get(authorizationRef) ?? new Set();
    set.add(listener);
    this.deviceSubs.set(authorizationRef, set);
    return () => set.delete(listener);
  }

  runIsTerminal(grant: GrantRecord, runId: string): boolean {
    const run = this.requireRun(grant, runId);
    return TERMINAL.has(run.status);
  }

  async submitToolResult(
    grant: GrantRecord,
    requestId: string,
    body: Record<string, unknown>,
    idempotencyKey: string | undefined,
    traceId?: string,
  ) {
    this.sweep();
    if (!idempotencyKey) {
      throw new DeviceDhError("PARAM_UNSUPPORTED", "Idempotency-Key is required");
    }
    const request = this.toolRequests.get(requestId);
    if (!request || request.authorizationRef !== grant.authorizationRef) {
      throw notFound();
    }
    // Replay an accepted result before pending/terminal checks. A lost-response
    // retry must not be LATE_RESULT and must not run the tool again. Revoke after
    // success still replays that record; a different body is IDEMPOTENCY_CONFLICT.
    const material = idempotencyMaterial(body);
    const hash = bodyHash(material);
    const scope = `tool:${grant.clientId}:${grant.authorizationRef}:${requestId}:${idempotencyKey}`;
    const prior = this.takeIdem(scope, hash);
    if (prior) {
      if (prior.inflight) {
        const bindingVersion = readNumber(body, "bindingVersion");
        // The attempt is still open only while the run has not been closed.
        // A cancel, revoke, rebind, or timeout must not replay as a success.
        this.assertInflightToolReplay(grant, request, bindingVersion, traceId);
      }
      this.audit({
        action: "tool.result.duplicate",
        outcome: "ok",
        authorizationRef: grant.authorizationRef,
        requestId,
        runId: request.runId,
        traceId,
      });
      const replay = clone(prior.body);
      if (prior.inflight) {
        const live = this.runs.get(request.runId);
        if (live) {
          replay.runStatus = live.status;
        }
      }
      return { ...replay, duplicate: true };
    }
    this.assertActive(grant);
    if (!grant.scopes.includes("media.read") && readString(body, "status") === "ok") {
      throw new DeviceDhError("SCOPE_DENIED", "media.read scope is required");
    }
    const bindingVersion = readNumber(body, "bindingVersion");
    const status = readString(body, "status") as ToolResultStatus | undefined;
    let run = this.assertToolStillOpen(grant, request, bindingVersion, traceId);
    if (!status) {
      throw new DeviceDhError("PARAM_UNSUPPORTED", "status is required");
    }
    if (status !== "ok") {
      request.state = "closed";
      this.applyNegativeToolStatus(run, status, readString(body, "errorCode"));
      const response = {
        requestId,
        status: "accepted" as const,
        runId: run.runId,
        runStatus: run.status,
      };
      this.remember(scope, hash, 200, response);
      this.audit({
        action: "tool.result",
        outcome: "ok",
        authorizationRef: grant.authorizationRef,
        requestId,
        runId: run.runId,
        code: run.errorCode,
        traceId,
      });
      return response;
    }
    // Reserve the key before leaving pending and before either await. A retry
    // with the same body joins this attempt; it does not pull media or call vision.
    const processing = {
      requestId,
      status: "accepted" as const,
      runId: run.runId,
      runStatus: run.status,
    };
    this.remember(scope, hash, 200, processing, true);
    try {
      const result = isRecord(body.result) ? body.result : {};
      const media = await this.resolveMedia(grant, request, result);
      // The pull yields. Cancel, revoke, rebind, or timeout may have closed the run.
      // Claim the success only after this re-check; do not emit a reply otherwise.
      this.sweep();
      run = this.assertToolStillOpen(grant, request, bindingVersion, traceId);
      this.remember(
        scope,
        hash,
        200,
        { ...processing, runStatus: run.status, mediaId: media.mediaId },
        true,
      );
      request.state = "fulfilled";
      this.media.set(media.mediaId, { bytes: media.bytes, contentType: media.contentType });
      this.audit({
        action: "media.accepted",
        outcome: "ok",
        authorizationRef: grant.authorizationRef,
        requestId: request.requestId,
        runId: request.runId,
      });
      const messageId = `msg_${randomId()}`;
      run.messageId = messageId;
      const human = this.humans.get(grant.digitalHumanId);
      const signal = this.bindModelAbort(run);
      try {
        const vision = await this.models.describeImage({
          userText: run.inputText,
          bytes: media.bytes,
          contentType: media.contentType,
          width: media.width,
          height: media.height,
          digitalHumanId: grant.digitalHumanId,
          displayName: human?.displayName ?? grant.digitalHumanId,
          locale: human?.locale,
          conversationId: run.conversationId,
          trustedAgent: this.trustedAgent(grant),
          signal,
          onDelta: (delta) => {
            if (!delta || TERMINAL.has(run.status)) {
              return;
            }
            this.pushRunEvent(
              run,
              "assistant.delta",
              { text: delta, speakable: false, stable: false },
              messageId,
            );
          },
        });
        this.sweep();
        run = this.assertToolStillOpen(grant, request, bindingVersion, traceId, "fulfilled");
        this.finishVisible(run, vision);
      } catch (error) {
        if (isToolCloseError(error) || TERMINAL.has(run.status)) {
          this.sweep();
          this.assertToolStillOpen(grant, request, bindingVersion, traceId, "fulfilled");
          throw error;
        }
        this.failModel(run, error);
      }
      const response = {
        requestId,
        status: "accepted" as const,
        runId: run.runId,
        runStatus: run.status,
        mediaId: media.mediaId,
      };
      this.remember(scope, hash, 200, response);
      this.audit({
        action: "tool.result",
        outcome: "ok",
        authorizationRef: grant.authorizationRef,
        requestId,
        runId: run.runId,
        traceId,
        deviceId: grant.deviceId,
      });
      return response;
    } catch (error) {
      // Validation and close errors must not stay reserved as a completion.
      this.releaseInflight(scope);
      throw error;
    }
  }

  createUploadTicket(grant: GrantRecord, body: Record<string, unknown>) {
    this.assertActive(grant);
    this.assertBinding(grant, body);
    if (!grant.scopes.includes("media.read")) {
      throw new DeviceDhError("SCOPE_DENIED", "media.read scope is required");
    }
    const requestId = requireText(body, "requestId");
    const request = this.toolRequests.get(requestId);
    if (
      !request ||
      request.authorizationRef !== grant.authorizationRef ||
      request.state !== "pending"
    ) {
      throw notFound();
    }
    const contentType = readString(body, "contentType");
    if (contentType && contentType !== "image/jpeg" && contentType !== "image/png") {
      throw new DeviceDhError("MEDIA_INVALID", "Only JPEG and PNG images are accepted");
    }
    const ticket = `tk_${randomId(18)}`;
    const mediaId = `media_${randomId()}`;
    const record: UploadTicket = {
      ticket,
      mediaId,
      authorizationRef: grant.authorizationRef,
      requestId,
      expiresAt: this.now() + 5 * 60_000,
      used: false,
    };
    this.tickets.set(ticket, record);
    return {
      mediaId,
      ticket,
      uploadPath: `/api/integrations/v1/media/uploads/${ticket}`,
      method: "PUT" as const,
      expiresAt: new Date(record.expiresAt).toISOString(),
      contentType: contentType ?? "image/png",
    };
  }

  acceptUpload(ticketId: string, bytes: Buffer, contentTypeHeader: string | undefined) {
    const ticket = this.tickets.get(ticketId);
    if (!ticket || ticket.used || ticket.expiresAt <= this.now()) {
      throw notFound();
    }
    if (
      contentTypeHeader &&
      contentTypeHeader !== "image/jpeg" &&
      contentTypeHeader !== "image/png" &&
      contentTypeHeader !== "application/octet-stream"
    ) {
      throw new DeviceDhError("MEDIA_INVALID", "Only JPEG and PNG images are accepted");
    }
    const inspected = validateImageBytes(
      bytes,
      {},
      {
        maxBytes: this.maxImageBytes,
        maxPixels: this.maxPixels,
      },
    );
    ticket.used = true;
    ticket.bytes = Buffer.from(bytes);
    ticket.contentType = inspected.contentType;
    this.media.set(ticket.mediaId, { bytes: ticket.bytes, contentType: inspected.contentType });
    this.audit({
      action: "media.uploaded",
      outcome: "ok",
      authorizationRef: ticket.authorizationRef,
      requestId: ticket.requestId,
    });
    return {
      mediaId: ticket.mediaId,
      contentType: inspected.contentType,
      width: inspected.width,
      height: inspected.height,
      byteLength: bytes.length,
    };
  }

  decideApproval(token: string | undefined, approvalId: string, body: Record<string, unknown>) {
    if (!token || !safeEqual(token, this.approvalToken)) {
      throw authInvalid();
    }
    const approval = this.approvals.get(approvalId);
    if (!approval || approval.state !== "pending") {
      throw notFound();
    }
    const decision = readString(body, "decision");
    const run = this.runs.get(approval.runId);
    if (!run || TERMINAL.has(run.status)) {
      approval.state = "cancelled";
      throw notFound();
    }
    if (decision === "approve") {
      approval.state = "approved";
      const text = "已记录候选变更。业务服务尚未提交，不能播报库存已更新。";
      this.finishVisible(run, text);
      this.audit({
        action: "approval.decided",
        outcome: "ok",
        authorizationRef: approval.authorizationRef,
        runId: run.runId,
      });
      return { approvalId, decision: "approve" as const, runId: run.runId, status: run.status };
    }
    if (decision === "deny") {
      approval.state = "denied";
      this.failRun(run, "USER_DENIED", "Approval was denied inside OpenBot", false);
      this.audit({
        action: "approval.decided",
        outcome: "denied",
        authorizationRef: approval.authorizationRef,
        runId: run.runId,
        code: "USER_DENIED",
      });
      return { approvalId, decision: "deny" as const, runId: run.runId, status: run.status };
    }
    throw new DeviceDhError("PARAM_UNSUPPORTED", "decision must be approve or deny");
  }

  listAudit(token: string | undefined): { records: AuditRecord[] } {
    if (!token || !safeEqual(token, this.approvalToken)) {
      throw authInvalid();
    }
    return { records: this.auditLog.map((record) => clone(record)) };
  }

  private async resolveMedia(
    grant: GrantRecord,
    request: ToolRequest,
    result: Record<string, unknown>,
  ): Promise<{
    mediaId: string;
    bytes: Buffer;
    contentType: string;
    width: number;
    height: number;
  }> {
    const declared: MediaCheck = {
      contentType: readString(result, "contentType"),
      width: readNumber(result, "width"),
      height: readNumber(result, "height"),
      byteLength: readNumber(result, "byteLength"),
      checksum: readString(result, "checksum"),
    };
    const mediaId = readString(result, "mediaId");
    const readUrl = readString(result, "readUrl");
    let bytes: Buffer | undefined;
    if (readUrl) {
      bytes = await pullMedia(readUrl, {
        allowOrigins: this.mediaAllowOrigins,
        maxBytes: this.maxImageBytes,
        maxPixels: this.maxPixels,
        timeoutMs: this.mediaTimeoutMs,
      });
    } else if (mediaId) {
      const stored = this.media.get(mediaId);
      const owned = [...this.tickets.values()].some(
        (ticket) =>
          ticket.mediaId === mediaId &&
          ticket.requestId === request.requestId &&
          ticket.authorizationRef === grant.authorizationRef,
      );
      if (!stored || !owned) {
        throw new DeviceDhError("MEDIA_INVALID", "mediaId is not available for this request");
      }
      bytes = stored.bytes;
    }
    if (!bytes) {
      throw new DeviceDhError("MEDIA_INVALID", "A readUrl or uploaded mediaId is required");
    }
    const inspected = validateImageBytes(bytes, declared, {
      maxBytes: this.maxImageBytes,
      maxPixels: this.maxPixels,
    });
    return {
      mediaId: mediaId ?? `media_${randomId()}`,
      bytes,
      contentType: inspected.contentType,
      width: inspected.width,
      height: inspected.height,
    };
  }

  /**
   * An in-flight reservation is replayable only while this attempt can still
   * finish. Once cancel, revoke, rebind, or timeout has closed it, the retry
   * gets that close error instead of a successful completion.
   */
  private assertInflightToolReplay(
    grant: GrantRecord,
    request: ToolRequest,
    bindingVersion: number | undefined,
    traceId?: string,
  ): void {
    const run = this.runs.get(request.runId);
    const closed =
      grant.status !== "active" ||
      grant.expiresAt <= this.now() ||
      bindingVersion !== grant.bindingVersion ||
      bindingVersion !== request.bindingVersion ||
      (run !== undefined && run.bindingVersion !== grant.bindingVersion) ||
      !run ||
      TERMINAL.has(run.status) ||
      request.state === "expired" ||
      request.state === "cancelled" ||
      request.state === "closed";
    if (!closed) {
      return;
    }
    this.assertToolStillOpen(grant, request, bindingVersion, traceId, "fulfilled");
  }

  /**
   * Authorization, binding, and terminal state after any await.
   * A closed run must not be completed from a late media pull or a late vision call.
   * `fulfilled` allows the request that this attempt already claimed.
   */
  private assertToolStillOpen(
    grant: GrantRecord,
    request: ToolRequest,
    bindingVersion: number | undefined,
    traceId?: string,
    mode: "pending" | "fulfilled" = "pending",
  ): RunRecord {
    const run = this.runs.get(request.runId);
    if (grant.status !== "active" || grant.expiresAt <= this.now()) {
      this.audit({
        action: "tool.late_result",
        outcome: "denied",
        authorizationRef: grant.authorizationRef,
        requestId: request.requestId,
        runId: request.runId,
        code: "AUTH_REVOKED",
        traceId,
      });
      throw new DeviceDhError("AUTH_REVOKED", "Authorization is revoked");
    }
    if (
      bindingVersion !== grant.bindingVersion ||
      bindingVersion !== request.bindingVersion ||
      (run !== undefined && run.bindingVersion !== grant.bindingVersion)
    ) {
      this.audit({
        action: "tool.late_result",
        outcome: "denied",
        authorizationRef: grant.authorizationRef,
        requestId: request.requestId,
        runId: request.runId,
        code: "BINDING_MISMATCH",
        traceId,
      });
      throw new DeviceDhError(
        "BINDING_MISMATCH",
        "bindingVersion does not match the open tool request",
      );
    }
    const claimed = mode === "fulfilled" && request.state === "fulfilled";
    if ((!claimed && request.state !== "pending") || !run || TERMINAL.has(run.status)) {
      if (request.state === "pending") {
        request.state = "closed";
      }
      this.audit({
        action: "tool.late_result",
        outcome: "denied",
        authorizationRef: grant.authorizationRef,
        requestId: request.requestId,
        runId: request.runId,
        code: "LATE_RESULT",
        traceId,
      });
      throw new DeviceDhError("LATE_RESULT", "Tool result arrived after the run was closed");
    }
    return run;
  }

  private applyNegativeToolStatus(
    run: RunRecord,
    status: ToolResultStatus,
    errorCode: string | undefined,
  ) {
    if (status === "cancelled") {
      this.markCancelled(run, "user");
      return;
    }
    const mapped = mapToolFailure(status, errorCode);
    this.failRun(run, mapped.code, mapped.message, mapped.retryable);
  }

  private async routeTurn(grant: GrantRecord, run: RunRecord, text: string): Promise<void> {
    if (wantsApproval(text)) {
      this.openApproval(run);
      return;
    }
    if (wantsCamera(text)) {
      this.openCamera(grant, run);
      return;
    }
    if (TERMINAL.has(run.status)) {
      return;
    }
    const messageId = `msg_${randomId()}`;
    run.messageId = messageId;
    const human = this.humans.get(grant.digitalHumanId);
    const signal = this.bindModelAbort(run);
    try {
      const visible = await this.models.completeTurn({
        text,
        digitalHumanId: grant.digitalHumanId,
        displayName: human?.displayName ?? grant.digitalHumanId,
        locale: human?.locale,
        conversationId: run.conversationId,
        trustedAgent: this.trustedAgent(grant),
        signal,
        onDelta: (delta) => {
          if (!delta || TERMINAL.has(run.status)) {
            return;
          }
          this.pushRunEvent(
            run,
            "assistant.delta",
            { text: delta, speakable: false, stable: false },
            messageId,
          );
        },
      });
      if (!TERMINAL.has(run.status)) {
        this.finishVisible(run, visible);
      }
    } catch (error) {
      if (!TERMINAL.has(run.status)) {
        this.failModel(run, error);
      }
    }
  }

  private openApproval(run: RunRecord): void {
    const approvalId = `appr_${randomId()}`;
    run.approvalId = approvalId;
    run.status = "waiting_approval";
    this.approvals.set(approvalId, {
      approvalId,
      runId: run.runId,
      authorizationRef: run.authorizationRef,
      state: "pending",
    });
    this.pushRunEvent(run, "approval.required", {
      approvalId,
      speakable: false,
      reason: "confirmation_required",
      message: "需要在 OpenBot 内确认。设备平台不能代为批准。",
    });
    this.audit({
      action: "approval.required",
      outcome: "ok",
      authorizationRef: run.authorizationRef,
      runId: run.runId,
    });
  }

  private openCamera(grant: GrantRecord, run: RunRecord): void {
    if (!grant.scopes.includes(ALLOWED_TOOL)) {
      this.failRun(run, "SCOPE_DENIED", "camera.capture is not granted", false);
      return;
    }
    const caps = grant.capabilities;
    if (!caps || !caps.online) {
      this.failRun(run, "DEVICE_OFFLINE", "Device capabilities are offline or missing", true);
      return;
    }
    if (!caps.acceptedTools.includes(ALLOWED_TOOL)) {
      this.failRun(run, "PARAM_UNSUPPORTED", "camera.capture is not currently available", true);
      return;
    }
    const messageId = `msg_${randomId()}`;
    run.messageId = messageId;
    run.visibleText = "我先看一下画面。";
    this.pushRunEvent(
      run,
      "assistant.visible",
      {
        text: "我先看一下画面。",
        speakable: true,
        stable: true,
      },
      messageId,
    );
    const request: ToolRequest = {
      requestId: `req_${randomId()}`,
      authorizationRef: grant.authorizationRef,
      bindingVersion: grant.bindingVersion,
      runId: run.runId,
      turnId: run.turnId,
      deviceId: grant.deviceId,
      traceId: run.traceId,
      toolName: ALLOWED_TOOL,
      params: { format: "image/jpeg" },
      state: "pending",
      expiresAt: this.now() + this.toolTimeoutMs,
    };
    this.toolRequests.set(request.requestId, request);
    run.status = "waiting_tool";
    this.pushRunEvent(run, "tool.request", {
      requestId: request.requestId,
      toolName: request.toolName,
      speakable: false,
      expiresAt: new Date(request.expiresAt).toISOString(),
    });
    this.pushDeviceEvent(grant, "tool.request", {
      requestId: request.requestId,
      authorizationRef: grant.authorizationRef,
      bindingVersion: grant.bindingVersion,
      runId: run.runId,
      turnId: run.turnId,
      toolName: request.toolName,
      params: request.params,
      expiresAt: new Date(request.expiresAt).toISOString(),
      traceId: run.traceId,
    });
    this.audit({
      action: "tool.requested",
      outcome: "ok",
      authorizationRef: grant.authorizationRef,
      deviceId: grant.deviceId,
      runId: run.runId,
      requestId: request.requestId,
      traceId: run.traceId,
    });
  }

  private beginRun(run: RunRecord): void {
    this.pushRunEvent(run, "run.accepted", { status: "accepted" });
    run.status = "running";
    this.pushRunEvent(run, "run.started", { status: "running" });
  }

  private finishVisible(run: RunRecord, text: string): void {
    if (TERMINAL.has(run.status)) {
      return;
    }
    const messageId = run.messageId ?? `msg_${randomId()}`;
    run.messageId = messageId;
    run.visibleText = text;
    run.status = "completed";
    run.finishedAt = this.now();
    this.pushRunEvent(run, "assistant.visible", { text, speakable: true, stable: true }, messageId);
    this.pushRunEvent(
      run,
      "assistant.final",
      {
        text,
        speakable: false,
        stable: true,
        reconciliation: true,
      },
      messageId,
    );
    this.pushRunEvent(run, "run.completed", { status: "completed", messageId });
  }

  private failModel(run: RunRecord, error: unknown): void {
    const message =
      error instanceof DeviceDhModelError ? error.message : "OpenBot agent request failed";
    this.failRun(run, "INTERNAL", message, false);
    this.audit({
      action: "model.failed",
      outcome: "error",
      authorizationRef: run.authorizationRef,
      deviceId: run.deviceId,
      digitalHumanId: run.digitalHumanId,
      runId: run.runId,
      code: "INTERNAL",
      traceId: run.traceId,
    });
  }

  private failRun(run: RunRecord, code: string, message: string, retryable: boolean): void {
    if (TERMINAL.has(run.status)) {
      return;
    }
    run.status = "failed";
    run.errorCode = code;
    run.retryable = retryable;
    run.finishedAt = this.now();
    this.pushRunEvent(run, "run.failed", { errorCode: code, message, retryable });
  }

  private markCancelled(run: RunRecord, reason: CancelReason): void {
    if (TERMINAL.has(run.status)) {
      return;
    }
    run.status = "cancelled";
    run.cancelReason = reason;
    run.finishedAt = this.now();
    run.modelAbort?.abort();
    for (const request of this.toolRequests.values()) {
      if (request.runId === run.runId && request.state === "pending") {
        request.state = "cancelled";
        const grant = this.grants.get(request.authorizationRef);
        if (grant) {
          this.pushDeviceEvent(grant, "run.cancelled", {
            requestId: request.requestId,
            runId: run.runId,
            reason,
            bindingVersion: run.bindingVersion,
          });
        }
      }
    }
    if (run.approvalId) {
      const approval = this.approvals.get(run.approvalId);
      if (approval?.state === "pending") {
        approval.state = "cancelled";
      }
    }
    this.pushRunEvent(run, "run.cancelled", {
      status: "cancelled",
      reason,
      sideEffectsRolledBack: false,
    });
  }

  private cancelGrantWork(grant: GrantRecord, reason: CancelReason): void {
    for (const run of this.runs.values()) {
      if (run.authorizationRef === grant.authorizationRef && !TERMINAL.has(run.status)) {
        this.markCancelled(run, reason);
      }
    }
    for (const request of this.toolRequests.values()) {
      if (request.authorizationRef === grant.authorizationRef && request.state === "pending") {
        request.state = "cancelled";
      }
    }
  }

  private pushRunEvent(
    run: RunRecord,
    type: string,
    payload: Record<string, unknown>,
    messageId?: string,
  ): EventEnvelope {
    const sequence = run.nextSequence;
    run.nextSequence += 1;
    const event = this.envelope({
      sequence,
      type,
      payload,
      bindingVersion: run.bindingVersion,
      runId: run.runId,
      turnId: run.turnId,
      conversationId: run.conversationId,
      authorizationRef: run.authorizationRef,
      traceId: run.traceId,
      messageId,
    });
    run.events.push(event);
    this.trim(run.events);
    for (const listener of this.runSubs.get(run.runId) ?? []) {
      listener(event);
    }
    return event;
  }

  private pushDeviceEvent(
    grant: GrantRecord,
    type: string,
    payload: Record<string, unknown>,
  ): EventEnvelope {
    const sequence = (this.deviceSeq.get(grant.authorizationRef) ?? 0) + 1;
    this.deviceSeq.set(grant.authorizationRef, sequence);
    const event = this.envelope({
      sequence,
      type,
      payload,
      bindingVersion: grant.bindingVersion,
      authorizationRef: grant.authorizationRef,
      traceId: typeof payload.traceId === "string" ? payload.traceId : undefined,
    });
    const list = this.deviceEvents.get(grant.authorizationRef) ?? [];
    list.push(event);
    this.trim(list);
    this.deviceEvents.set(grant.authorizationRef, list);
    for (const listener of this.deviceSubs.get(grant.authorizationRef) ?? []) {
      listener(event);
    }
    return event;
  }

  private envelope(input: {
    sequence: number;
    type: string;
    payload: Record<string, unknown>;
    bindingVersion: number;
    runId?: string;
    turnId?: string;
    conversationId?: string;
    authorizationRef?: string;
    traceId?: string;
    messageId?: string;
  }): EventEnvelope {
    const eventId = `evt_${randomId()}`;
    return {
      schemaVersion: SCHEMA_VERSION,
      apiVersion: API_VERSION,
      protocolVersion: PROTOCOL_VERSION,
      eventId,
      sequence: input.sequence,
      seq: input.sequence,
      cursor: String(input.sequence),
      ...(input.runId ? { runId: input.runId } : {}),
      ...(input.turnId ? { turnId: input.turnId } : {}),
      ...(input.conversationId ? { conversationId: input.conversationId } : {}),
      ...(input.authorizationRef ? { authorizationRef: input.authorizationRef } : {}),
      bindingVersion: input.bindingVersion,
      type: input.type,
      payload: input.payload,
      data: input.payload,
      createdAt: new Date(this.now()).toISOString(),
      ...(input.traceId ? { traceId: input.traceId } : {}),
      ...(input.messageId ? { messageId: input.messageId } : {}),
    };
  }

  private sliceEvents(events: EventEnvelope[], cursor: string | undefined): EventEnvelope[] {
    const after = this.cursorSequence(events, cursor);
    return events.filter((event) => event.sequence > after);
  }

  private cursorSequence(events: EventEnvelope[], cursor: string | undefined): number {
    if (!cursor) {
      if (events[0] && events[0].sequence > 1) {
        throw new DeviceDhError("CURSOR_EXPIRED", "Event cursor is no longer available");
      }
      return 0;
    }
    let after = 0;
    if (/^\d+$/.test(cursor)) {
      after = Number(cursor);
    } else {
      const found = events.find((event) => event.eventId === cursor);
      if (!found) {
        throw new DeviceDhError("CURSOR_EXPIRED", "Event cursor is no longer available");
      }
      after = found.sequence;
    }
    const oldest = events[0]?.sequence;
    if (oldest !== undefined && after + 1 < oldest) {
      throw new DeviceDhError("CURSOR_EXPIRED", "Event cursor is no longer available");
    }
    if (events.length === 0 && after > 0) {
      throw new DeviceDhError("CURSOR_EXPIRED", "Event cursor is no longer available");
    }
    return after;
  }

  private trim(events: EventEnvelope[]): void {
    while (events.length > this.maxEvents) {
      events.shift();
    }
  }

  private takeIdem(scope: string, hash: string): IdemRecord | undefined {
    this.pruneIdem();
    const existing = this.idem.get(scope);
    if (!existing) {
      return undefined;
    }
    if (existing.hash !== hash) {
      throw new DeviceDhError(
        "IDEMPOTENCY_CONFLICT",
        "Idempotency key was reused with a different request",
      );
    }
    return existing;
  }

  private remember(
    scope: string,
    hash: string,
    status: number,
    body: Record<string, unknown>,
    inflight = false,
  ): void {
    const existing = this.idem.get(scope);
    this.idem.set(scope, {
      hash,
      createdAt: existing?.hash === hash ? existing.createdAt : this.now(),
      status,
      body,
      ...(inflight ? { inflight: true } : {}),
    });
  }

  /** Drop a reservation that did not become a final response. */
  private releaseInflight(scope: string): void {
    const existing = this.idem.get(scope);
    if (existing?.inflight) {
      this.idem.delete(scope);
    }
  }

  private pruneIdem(): void {
    const cutoff = this.now() - this.idempotencyTtlMs;
    for (const [key, record] of this.idem) {
      if (record.createdAt < cutoff) {
        this.idem.delete(key);
      }
    }
  }

  private conversationBusy(conversationId: string): boolean {
    for (const run of this.runs.values()) {
      if (run.conversationId === conversationId && !TERMINAL.has(run.status)) {
        return true;
      }
    }
    return false;
  }

  private turnText(body: Record<string, unknown>): string {
    const input = isRecord(body.input) ? body.input : undefined;
    const inputText = input ? readString(input, "text") : undefined;
    const text = readString(body, "text") ?? inputText;
    if (!text || text.trim().length === 0) {
      throw new DeviceDhError("PARAM_UNSUPPORTED", "text is required");
    }
    if (input && input.type !== undefined && input.type !== "text") {
      throw new DeviceDhError("PARAM_UNSUPPORTED", "Only text input is supported");
    }
    if (readString(body, "text") && inputText && readString(body, "text") !== inputText) {
      throw new DeviceDhError("PARAM_UNSUPPORTED", "text and input.text do not match");
    }
    return text;
  }

  private assertBinding(grant: GrantRecord, body: Record<string, unknown>): void {
    if ("bindingVersion" in body && readNumber(body, "bindingVersion") !== grant.bindingVersion) {
      throw new DeviceDhError(
        "BINDING_MISMATCH",
        "bindingVersion does not match the authorization",
      );
    }
    const human = readString(body, "digitalHumanId");
    if (human && human !== grant.digitalHumanId) {
      throw new DeviceDhError(
        "BINDING_MISMATCH",
        "digitalHumanId does not match the authorization",
      );
    }
  }

  private assertActive(grant: GrantRecord): void {
    if (grant.status !== "active" || grant.expiresAt <= this.now()) {
      throw new DeviceDhError("AUTH_REVOKED", "Authorization is revoked");
    }
  }

  private assertSameGrant(grant: GrantRecord, authorizationRef: string): void {
    if (grant.authorizationRef !== authorizationRef) {
      throw notFound();
    }
  }

  private requireConversation(grant: GrantRecord, conversationId: string): ConversationRecord {
    const conversation = this.conversations.get(conversationId);
    if (!conversation || conversation.authorizationRef !== grant.authorizationRef) {
      throw notFound();
    }
    return conversation;
  }

  private requireRun(grant: GrantRecord, runId: string): RunRecord {
    const run = this.runs.get(runId);
    if (!run || run.authorizationRef !== grant.authorizationRef) {
      throw notFound();
    }
    return run;
  }

  private rejectIdentity(body: Record<string, unknown>): void {
    for (const field of IDENTITY_FIELDS) {
      if (body[field] != null) {
        throw new DeviceDhError("PARAM_UNSUPPORTED", `Field ${field} cannot be set by the client`);
      }
    }
  }

  private trustedAgent(grant: GrantRecord): DeviceDhTrustedAgent {
    const human = this.humans.get(grant.digitalHumanId);
    return {
      grantDigitalHumanId: grant.digitalHumanId,
      humanDigitalHumanId: human?.digitalHumanId,
      gatewayAgentId: human?.gatewayAgentId,
      allowedGatewayAgentIds: human?.allowedGatewayAgentIds,
    };
  }

  private bindModelAbort(run: RunRecord): AbortSignal {
    const controller = new AbortController();
    run.modelAbort = controller;
    if (TERMINAL.has(run.status)) {
      controller.abort();
    }
    return controller.signal;
  }

  private assistant(grant: GrantRecord): AssistantProfile {
    const human = this.humans.get(grant.digitalHumanId);
    if (!human) {
      throw notFound();
    }
    return assistantFromHuman(human);
  }

  private grantView(grant: GrantRecord) {
    return {
      authorizationRef: grant.authorizationRef,
      status: grant.status,
      bindingVersion: grant.bindingVersion,
      digitalHumanId: grant.digitalHumanId,
      deviceId: grant.deviceId,
      scopes: [...grant.scopes],
      userSubject: grant.userSubject,
      tenantId: grant.tenantId,
      clientId: grant.clientId,
      issuedAt: new Date(grant.issuedAt).toISOString(),
      expiresAt: new Date(grant.expiresAt).toISOString(),
      assistant: this.assistant(grant),
    };
  }

  /**
   * Firmware-facing read model over existing runs for one conversation.
   * Does not allocate a second conversation store.
   */
  listConversationMessages(grant: GrantRecord, conversationId: string) {
    this.assertActive(grant);
    const conversation = this.requireConversation(grant, conversationId);
    type Msg = {
      id: string;
      role: "user" | "assistant" | "system";
      text: string;
      turnId?: string;
      runId?: string;
      createdAt: string;
    };
    const messages: Msg[] = [];
    for (const run of this.runs.values()) {
      if (
        run.conversationId !== conversationId ||
        run.authorizationRef !== grant.authorizationRef
      ) {
        continue;
      }
      messages.push({
        id: `user_${run.turnId}`,
        role: "user",
        text: run.inputText,
        turnId: run.turnId,
        runId: run.runId,
        createdAt: new Date(run.createdAt).toISOString(),
      });
      if (run.visibleText) {
        messages.push({
          id: run.messageId ?? `asst_${run.turnId}`,
          role: "assistant",
          text: run.visibleText,
          turnId: run.turnId,
          runId: run.runId,
          createdAt: new Date(run.finishedAt ?? run.createdAt).toISOString(),
        });
      }
    }
    messages.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return {
      conversationId: conversation.conversationId,
      bindingVersion: conversation.bindingVersion,
      messages,
    };
  }

  private conversationView(conversation: ConversationRecord, grant: GrantRecord) {
    return {
      conversationId: conversation.conversationId,
      authorizationRef: conversation.authorizationRef,
      externalConversationId: conversation.externalConversationId,
      digitalHumanId: conversation.digitalHumanId,
      deviceId: conversation.deviceId,
      bindingVersion: conversation.bindingVersion,
      status: conversation.closed ? "closed" : "open",
      createdAt: new Date(conversation.createdAt).toISOString(),
      updatedAt: new Date(conversation.updatedAt).toISOString(),
      assistant: this.assistant(grant),
    };
  }

  private runView(run: RunRecord) {
    const grant = this.grants.get(run.authorizationRef);
    return {
      runId: run.runId,
      conversationId: run.conversationId,
      turnId: run.turnId,
      authorizationRef: run.authorizationRef,
      bindingVersion: run.bindingVersion,
      deviceId: run.deviceId,
      digitalHumanId: run.digitalHumanId,
      status: run.status,
      errorCode: run.errorCode ?? null,
      retryable: run.retryable,
      assistant: {
        ...(grant
          ? this.assistant(grant)
          : { digitalHumanId: run.digitalHumanId, displayName: "", status: "active" as const }),
        ...(run.visibleText ? { visibleText: run.visibleText } : {}),
        ...(run.messageId ? { messageId: run.messageId } : {}),
      },
    };
  }

  private audit(partial: Omit<AuditRecord, "auditId" | "at">): void {
    const record: AuditRecord = {
      auditId: `aud_${randomId(8)}`,
      at: new Date(this.now()).toISOString(),
      ...partial,
    };
    this.auditLog.push(record);
    if (this.auditLog.length > 500) {
      this.auditLog.shift();
    }
    this.onAudit?.(record);
  }
}

function isToolCloseError(error: unknown): boolean {
  return (
    error instanceof DeviceDhError &&
    (error.code === "LATE_RESULT" ||
      error.code === "AUTH_REVOKED" ||
      error.code === "BINDING_MISMATCH")
  );
}

function idempotencyMaterial(body: Record<string, unknown>): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...body };
  delete copy.traceId;
  delete copy.timestamp;
  delete copy.idempotencyKey;
  return copy;
}

function requireText(body: Record<string, unknown>, key: string): string {
  const value = readString(body, key);
  if (!value) {
    throw new DeviceDhError("PARAM_UNSUPPORTED", `${key} is required`);
  }
  return value;
}

function requireStringArray(body: Record<string, unknown>, key: string): string[] {
  const value = body[key];
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== "string") ||
    value.length === 0
  ) {
    throw new DeviceDhError("PARAM_UNSUPPORTED", `${key} must be a non-empty string array`);
  }
  return value;
}

function wantsCamera(text: string): boolean {
  return /看看|拍照|照片|冰箱|camera|picture|photo/i.test(text);
}

function wantsApproval(text: string): boolean {
  return /记下|确认更新|更新库存|删除库存|覆盖/.test(text);
}

function mapToolFailure(
  status: ToolResultStatus,
  errorCode: string | undefined,
): { code: DeviceDhError["code"]; message: string; retryable: boolean } {
  if (status === "busy") {
    return { code: "CAMERA_BUSY", message: "Camera is busy", retryable: true };
  }
  if (status === "timeout") {
    return { code: "TOOL_TIMEOUT", message: "Device tool timed out", retryable: true };
  }
  if (status === "denied") {
    return { code: "USER_DENIED", message: "Device declined the tool request", retryable: false };
  }
  if (status === "unsupported") {
    return {
      code: "PARAM_UNSUPPORTED",
      message: "Device does not support the tool parameters",
      retryable: false,
    };
  }
  if (status === "unknown") {
    return {
      code: "UNKNOWN_AFTER_RESTART",
      message: "Device result is unknown and will not be retried automatically",
      retryable: true,
    };
  }
  if (errorCode === "UPLOAD_FAILED") {
    return { code: "UPLOAD_FAILED", message: "Device upload failed", retryable: true };
  }
  return { code: "RUN_FAILED", message: "Device tool failed", retryable: false };
}
