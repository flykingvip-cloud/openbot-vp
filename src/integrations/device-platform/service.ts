import { randomBytes } from "node:crypto";
import { probeDevicePlatformConnection } from "./connection-probe.js";
import type { DevicePlatformControlClient } from "./control-client.js";
import {
  toAdminConnectionDto,
  toUserDeviceDto,
  toUserOperationDto,
  type AdminConnectionDto,
  type UserDeviceDto,
  type UserOperationDto,
} from "./dto.js";
import type { DeviceControlFetch } from "./http-control-client.js";
import { assertBodyHasNoPairingFields } from "./http-control-client.js";
import { bodyHash, dropInflightIdempotency, hashesEqual, sha256Hex } from "./idempotency.js";
import {
  assertFormalRuntime,
  rejectIdentityOverrides,
  requireActiveActor,
  type IdentityDirectory,
  type TrustedActor,
} from "./identity.js";
import { claimKey } from "./paths.js";
import {
  assertCanOperateBinding,
  assertCanSeeAssociation,
  assertCapabilityAccess,
  assertDigitalHumanUse,
  assertPlatformAdmin,
} from "./permissions.js";
import type { DevicePlatformStore } from "./store.js";
import {
  DEVICE_PLATFORM_DISABLED_DISPOSITION,
  DevicePlatformError,
  FOREGROUND_BINDING_STATUSES,
  type DeviceAssociation,
  type DevicePlatformEnvironment,
  type DeviceBinding,
  type DevicePlatformConnection,
  type GrantReference,
  type ManagementOperation,
  type OperationKind,
  type OperationMaterial,
  type StatusProjection,
  type TenantShard,
} from "./types.js";
import {
  assertSafeCallbackUrl,
  assertSafeServiceBaseUrl,
  parseDevicePlatformEnvironment,
} from "./url-safety.js";

const ALLOWED_SCOPES = new Set(["chat", "camera.capture", "media.read"]);
const SECRET_FIELDS = [
  "clientSecret",
  "serviceSecret",
  "devicePrivateKey",
  "vendorKey",
  "rawDiagnostics",
  "secret",
  "authorizationCredential",
];
const OPERATION_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,80}$/;

export type ServiceClientVerifier = (clientId: string, secret: string) => boolean;

export type SubmitOperationInput = {
  operationId: string;
  kind: OperationKind;
  platformId?: string;
  externalDeviceId?: string;
  deviceId?: string;
  digitalHumanId?: string;
  scopes?: string[];
  displayName?: string;
  pairing?: { challenge?: string; proof?: string };
};

export type OperationResult = {
  operation: UserOperationDto;
  device?: UserDeviceDto;
};

export type DevicePlatformServiceOptions = {
  store: DevicePlatformStore;
  directory: IdentityDirectory;
  control: DevicePlatformControlClient;
  verifyServiceClient?: ServiceClientVerifier;
  now?: () => number;
  env?: NodeJS.ProcessEnv;
  /** Formal mode rejects stub debug and force-session switches. */
  mode?: "formal" | "test";
};

/**
 * Shared management service for personal settings and digital-human device lists.
 * Platform admins configure connectors. Users manage their own device relationships.
 */
export class DevicePlatformService {
  private readonly store: DevicePlatformStore;
  private readonly directory: IdentityDirectory;
  private readonly control: DevicePlatformControlClient;
  private readonly verifyServiceClient: ServiceClientVerifier;
  private readonly now: () => number;
  private readonly env: NodeJS.ProcessEnv;
  private readonly mode: "formal" | "test";
  /** Process-local grant credentials. Never written to the tenant shard. */
  private readonly credentials = new Map<string, string>();

  constructor(options: DevicePlatformServiceOptions) {
    this.store = options.store;
    this.directory = options.directory;
    this.control = options.control;
    this.verifyServiceClient = options.verifyServiceClient ?? (() => false);
    this.now = options.now ?? Date.now;
    this.env = options.env ?? process.env;
    this.mode = options.mode ?? "formal";
    this.store.recoverAll(this.iso());
  }

  sessionActor(sessionRef: string | undefined): TrustedActor {
    if (this.mode === "formal") {
      assertFormalRuntime(this.env);
    }
    if (!sessionRef?.trim()) {
      throw new DevicePlatformError("UNAUTHENTICATED", "Login session is required");
    }
    return requireActiveActor(this.directory.resolveActor(sessionRef.trim()));
  }

  listPersonalSettingsDevices(actorIn: TrustedActor): UserDeviceDto[] {
    const actor = this.actor(actorIn);
    return this.visibleDevices(actor);
  }

  /** Enabled connectors the member may target. Names only. No URL or secret. */
  listPersonalPlatforms(actorIn: TrustedActor): Array<{ platformId: string; displayName: string }> {
    this.actor(actorIn);
    return Object.values(this.store.loadConnections().connections)
      .filter((connection) => connection.enabled)
      .map((connection) => ({
        platformId: connection.platformId,
        displayName: connection.displayName,
      }));
  }

  listPersonalDigitalHumans(
    actorIn: TrustedActor,
  ): Array<{ digitalHumanId: string; displayName: string }> {
    const actor = this.actor(actorIn);
    const listed = this.directory.listUsableDigitalHumans?.(actor) ?? [];
    return listed
      .filter(
        (human) =>
          human.tenantId === actor.tenantId && this.directory.hasDigitalHumanUse(actor, human),
      )
      .map((human) => ({
        digitalHumanId: human.digitalHumanId,
        displayName: human.displayName,
      }));
  }

  listDigitalHumanDevices(actorIn: TrustedActor, digitalHumanId: string): UserDeviceDto[] {
    const actor = this.actor(actorIn);
    const human = this.directory.getDigitalHuman(digitalHumanId);
    assertDigitalHumanUse(actor, human, this.permittedIds(actor, human));
    return this.visibleDevices(actor).filter(
      (device) => device.binding?.digitalHumanId === digitalHumanId,
    );
  }

  getDevice(actorIn: TrustedActor, deviceId: string): UserDeviceDto {
    const actor = this.actor(actorIn);
    const shard = this.store.loadTenant(actor.tenantId);
    const association = shard.associations[deviceId];
    if (!association) {
      throw new DevicePlatformError("NOT_FOUND", "Device not found");
    }
    assertCanSeeAssociation(actor, association);
    return toUserDeviceDto(
      association,
      this.foreground(shard, deviceId),
      shard.projections[deviceId],
    );
  }

  upsertConnection(
    actorIn: TrustedActor,
    platformId: string,
    input: {
      displayName?: string;
      environment?: string;
      serviceBaseUrl?: string;
      contractVersion?: string;
      credentialRef?: string;
      clientIdentity?: string;
      registrationNotes?: string;
      callbackAllowlist?: string[];
      serviceClientIds?: string[];
      enabled?: boolean;
    },
    raw?: Record<string, unknown>,
  ): AdminConnectionDto {
    const actor = this.actor(actorIn);
    assertPlatformAdmin(actor);
    if (raw) {
      rejectRequestPayload(raw);
    }
    const environment = parseDevicePlatformEnvironment(input.environment);
    const serviceBaseUrl = assertSafeServiceBaseUrl(input.serviceBaseUrl, environment);
    const credentialRef = requireToken(input.credentialRef, "credentialRef");
    const contractVersion = requireToken(input.contractVersion ?? "1", "contractVersion");
    const serviceClientIds = normalizeClientIds(input.serviceClientIds);
    const clientIdentity = normalizeClientIdentity(input.clientIdentity, serviceClientIds);
    const registrationNotes = normalizeNotes(input.registrationNotes);
    const callbackAllowlist = normalizeCallbackAllowlist(input.callbackAllowlist, environment);
    const id = requireToken(platformId, "platformId");
    const file = this.store.loadConnections();
    const previous = file.connections[id];
    const connection: DevicePlatformConnection = {
      platformId: id,
      displayName: normalizeDisplayName(input.displayName, id),
      environment,
      serviceBaseUrl,
      contractVersion,
      credentialRef,
      clientIdentity,
      registrationNotes,
      callbackAllowlist,
      serviceClientIds,
      enabled: input.enabled !== false,
      disabledDisposition: DEVICE_PLATFORM_DISABLED_DISPOSITION,
      credentialPresent: Boolean(previous?.credentialPresent),
      ...(previous?.credentialRotatedAt
        ? { credentialRotatedAt: previous.credentialRotatedAt }
        : {}),
      health: "unknown",
      updatedAt: this.iso(),
    };
    file.connections[connection.platformId] = connection;
    this.store.saveConnections(file);
    return toAdminConnectionDto(connection);
  }

  /**
   * Store the service Basic password once. The value is not written on the
   * connection record and is never returned. Pass rotate to replace it.
   */
  setConnectionCredential(
    actorIn: TrustedActor,
    platformId: string,
    input: { clientSecret?: string; rotate?: boolean },
    raw?: Record<string, unknown>,
  ): AdminConnectionDto {
    const actor = this.actor(actorIn);
    assertPlatformAdmin(actor);
    if (raw) {
      rejectCredentialPayload(raw);
    }
    const id = requireToken(platformId, "platformId");
    const secret = requireToken(input.clientSecret, "clientSecret");
    if (secret.length < 16) {
      throw new DevicePlatformError("VALIDATION", "clientSecret is too short");
    }
    const file = this.store.loadConnections();
    const connection = file.connections[id];
    if (!connection) {
      throw new DevicePlatformError("NOT_FOUND", "Platform connection not found");
    }
    const credentials = this.store.loadCredentials();
    const existing = credentials.credentials[id];
    if (existing && input.rotate !== true) {
      throw new DevicePlatformError(
        "CONFLICT",
        "Service credential is write-once; rotate to replace it",
      );
    }
    credentials.credentials[id] = { serviceUser: connection.clientIdentity, secret };
    this.store.saveCredentials(credentials);
    connection.credentialPresent = true;
    if (input.rotate === true) {
      connection.credentialRotatedAt = this.iso();
    }
    connection.health = "unknown";
    connection.healthCode = undefined;
    connection.healthError = undefined;
    connection.updatedAt = this.iso();
    this.store.saveConnections(file);
    return toAdminConnectionDto(connection);
  }

  /**
   * Probe the device platform at the configured origin.
   * Health and capabilities must both succeed or the connector stays unhealthy.
   */
  async testConnection(
    actorIn: TrustedActor,
    platformId: string,
    options?: { fetchImpl?: DeviceControlFetch; timeoutMs?: number },
  ): Promise<{
    connection: AdminConnectionDto;
    checks: { health: "ok" | "failed"; capabilities: "ok" | "failed" | "skipped" };
    partial: boolean;
  }> {
    const actor = this.actor(actorIn);
    assertPlatformAdmin(actor);
    const id = requireToken(platformId, "platformId");
    const file = this.store.loadConnections();
    const connection = file.connections[id];
    if (!connection) {
      throw new DevicePlatformError("NOT_FOUND", "Platform connection not found");
    }
    const probed = await probeDevicePlatformConnection({
      connection,
      credential: this.store.loadCredential(id),
      now: this.iso(),
      fetchImpl: options?.fetchImpl,
      timeoutMs: options?.timeoutMs,
    });
    file.connections[id] = probed.connection;
    this.store.saveConnections(file);
    return {
      connection: toAdminConnectionDto(probed.connection),
      checks: probed.checks,
      partial: probed.partial,
    };
  }

  listConnections(actorIn: TrustedActor): AdminConnectionDto[] {
    const actor = this.actor(actorIn);
    assertPlatformAdmin(actor);
    return Object.values(this.store.loadConnections().connections).map(toAdminConnectionDto);
  }

  getConnection(actorIn: TrustedActor, platformId: string): AdminConnectionDto {
    const actor = this.actor(actorIn);
    assertPlatformAdmin(actor);
    const connection = this.store.loadConnections().connections[platformId];
    if (!connection) {
      throw new DevicePlatformError("NOT_FOUND", "Platform connection not found");
    }
    return toAdminConnectionDto(connection);
  }

  async submitOperation(
    actorIn: TrustedActor,
    input: SubmitOperationInput,
    raw?: Record<string, unknown>,
  ): Promise<OperationResult> {
    const actor = this.actor(actorIn);
    if (raw) {
      rejectRequestPayload(raw);
    }
    const material = materialOf(input);
    const hash = bodyHash(material);
    const shard = this.store.loadTenant(actor.tenantId);
    const existing = shard.operations[input.operationId];
    if (existing) {
      return this.replay(actor, existing, hash);
    }
    this.validateMaterial(actor, material);
    const operation: ManagementOperation = {
      operationId: input.operationId,
      kind: material.kind,
      tenantId: actor.tenantId,
      userId: actor.userId,
      bodyHash: hash,
      status: "reserved",
      progress: "reserved",
      retryable: false,
      request: material,
      createdAt: this.iso(),
      updatedAt: this.iso(),
    };
    shard.operations[operation.operationId] = operation;
    this.store.saveTenant(actor.tenantId, shard);
    return this.execute(actor, operation);
  }

  async retryOperation(actorIn: TrustedActor, operationId: string): Promise<OperationResult> {
    const actor = this.actor(actorIn);
    const shard = this.store.loadTenant(actor.tenantId);
    const operation = shard.operations[operationId];
    if (!operation || operation.userId !== actor.userId) {
      throw new DevicePlatformError("NOT_FOUND", "Operation not found");
    }
    if (
      (operation.status !== "failed" && operation.status !== "interrupted") ||
      !operation.retryable
    ) {
      throw new DevicePlatformError("CONFLICT", "Operation cannot be retried");
    }
    operation.status = "in_progress";
    operation.progress = "in_progress";
    operation.failure = undefined;
    operation.updatedAt = this.iso();
    this.store.saveTenant(actor.tenantId, shard);
    return this.execute(actor, operation);
  }

  authorizeCapability(
    actorIn: TrustedActor,
    input: {
      serviceClientId: string;
      serviceSecret: string;
      authorizationRef: string;
      grantCredential: string;
    },
  ): {
    authorizationRef: string;
    bindingVersion: number;
    digitalHumanId: string;
    deviceId: string;
  } {
    const actor = this.actor(actorIn);
    const shard = this.store.loadTenant(actor.tenantId);
    const grant = shard.grants[input.authorizationRef];
    const association = grant ? shard.associations[grant.deviceId] : undefined;
    const connection = association
      ? this.store.loadConnections().connections[association.platformId]
      : undefined;
    if (!connection?.enabled) {
      throw new DevicePlatformError("PLATFORM_DISABLED", "Device platform connection is disabled");
    }
    const authenticated = this.verifyServiceClient(input.serviceClientId, input.serviceSecret);
    const allowed = assertCapabilityAccess({
      actor,
      serviceClientId: input.serviceClientId,
      serviceAuthenticated: authenticated,
      grant,
      allowedServiceClientIds: connection?.serviceClientIds ?? [],
    });
    if (!hashesEqual(allowed.credentialHash, sha256Hex(input.grantCredential))) {
      throw new DevicePlatformError("AUTH_INVALID", "User grant is required");
    }
    return {
      authorizationRef: allowed.authorizationRef,
      bindingVersion: allowed.bindingVersion,
      digitalHumanId: allowed.digitalHumanId,
      deviceId: allowed.deviceId,
    };
  }

  /**
   * Durable tool-result idempotency used by the integration recovery journal.
   * Reserve is written before the caller leaves pending.
   */
  reserveToolResult(
    tenantId: string,
    key: string,
    hash: string,
    authorizationRef?: string,
  ): "reserved" | "duplicate" | "conflict" {
    const shard = this.store.loadTenant(tenantId);
    const existing = shard.idempotency[key];
    if (!existing) {
      shard.idempotency[key] = {
        key,
        hash,
        inflight: true,
        createdAt: this.iso(),
        ...(authorizationRef ? { authorizationRef } : {}),
      };
      this.store.saveTenant(tenantId, shard);
      return "reserved";
    }
    if (!hashesEqual(existing.hash, hash)) {
      return "conflict";
    }
    return "duplicate";
  }

  completeToolResult(
    tenantId: string,
    key: string,
    hash: string,
    response: Record<string, unknown>,
  ): void {
    const shard = this.store.loadTenant(tenantId);
    const existing = shard.idempotency[key];
    if (!existing || !existing.inflight || !hashesEqual(existing.hash, hash)) {
      throw new DevicePlatformError("IDEMPOTENCY_CONFLICT", "Idempotency reservation is missing");
    }
    existing.inflight = false;
    existing.response = response;
    this.store.saveTenant(tenantId, shard);
  }

  dropToolReservations(tenantId: string, authorizationRef: string): void {
    const shard = this.store.loadTenant(tenantId);
    shard.idempotency = dropInflightIdempotency(
      shard.idempotency,
      (record) => record.authorizationRef === authorizationRef,
    );
    this.store.saveTenant(tenantId, shard);
  }

  /** Test and bridge hook. Not an HTTP route. Loading a service does not replay these. */
  recordIntegrationRecovery(
    tenantId: string,
    patch: Partial<
      Pick<TenantShard, "runs" | "events" | "toolRequests" | "idempotency" | "grants">
    >,
  ): void {
    const shard = this.store.loadTenant(tenantId);
    if (patch.runs) {
      Object.assign(shard.runs, patch.runs);
    }
    if (patch.events) {
      shard.events.push(...patch.events);
    }
    if (patch.toolRequests) {
      Object.assign(shard.toolRequests, patch.toolRequests);
    }
    if (patch.idempotency) {
      Object.assign(shard.idempotency, patch.idempotency);
    }
    if (patch.grants) {
      Object.assign(shard.grants, patch.grants);
    }
    this.store.saveTenant(tenantId, shard);
  }

  private async execute(
    actor: TrustedActor,
    operation: ManagementOperation,
  ): Promise<OperationResult> {
    const shard = this.store.loadTenant(actor.tenantId);
    const current = shard.operations[operation.operationId] ?? operation;
    current.status = "in_progress";
    current.progress = "in_progress";
    current.updatedAt = this.iso();
    shard.operations[current.operationId] = current;
    this.store.saveTenant(actor.tenantId, shard);
    try {
      const device = await this.drive(actor, current);
      const done = this.store.loadTenant(actor.tenantId);
      const stored = done.operations[current.operationId];
      if (stored) {
        stored.status = "succeeded";
        stored.progress = device.binding?.status ?? "succeeded";
        stored.retryable = false;
        stored.failure = undefined;
        stored.result = { device: device as unknown as Record<string, unknown> };
        stored.deviceId = device.deviceId;
        stored.bindingId = device.binding?.bindingId;
        stored.updatedAt = this.iso();
        this.store.saveTenant(actor.tenantId, done);
        return {
          operation: toUserOperationDto(stored, { disposition: "accepted" }),
          device,
        };
      }
      return { operation: toUserOperationDto(current, { disposition: "accepted" }), device };
    } catch (error) {
      const failed = this.store.loadTenant(actor.tenantId);
      const stored = failed.operations[current.operationId];
      if (stored && stored.status !== "succeeded") {
        stored.status = "failed";
        stored.progress = "failed";
        stored.retryable = retryableCode(error);
        stored.failure = {
          code: error instanceof DevicePlatformError ? error.code : "PLATFORM_UNAVAILABLE",
          message: error instanceof Error ? error.message : "Operation failed",
        };
        stored.updatedAt = this.iso();
        this.store.saveTenant(actor.tenantId, failed);
      }
      throw error;
    }
  }

  private replay(
    actor: TrustedActor,
    existing: ManagementOperation,
    hash: string,
  ): OperationResult {
    if (existing.userId !== actor.userId || existing.tenantId !== actor.tenantId) {
      throw new DevicePlatformError("NOT_FOUND", "Operation not found");
    }
    if (!hashesEqual(existing.bodyHash, hash)) {
      throw new DevicePlatformError(
        "IDEMPOTENCY_CONFLICT",
        "operationId was used with a different body",
      );
    }
    if (existing.status === "reserved" || existing.status === "in_progress") {
      return {
        operation: toUserOperationDto(existing, { disposition: "duplicate", inflight: true }),
      };
    }
    const device = existing.result?.device as UserDeviceDto | undefined;
    return {
      operation: toUserOperationDto(existing, { disposition: "duplicate" }),
      ...(device ? { device } : {}),
    };
  }

  private async drive(actor: TrustedActor, operation: ManagementOperation): Promise<UserDeviceDto> {
    if (operation.kind === "add") {
      return this.driveAdd(actor, operation);
    }
    if (operation.kind === "rebind") {
      return this.driveRebind(actor, operation);
    }
    return this.driveRevoke(actor, operation);
  }

  private async driveAdd(
    actor: TrustedActor,
    operation: ManagementOperation,
  ): Promise<UserDeviceDto> {
    const request = operation.request;
    const connection = this.requireEnabledConnection(request.platformId ?? "");
    const claimed = this.ensureClaim(actor, operation, connection.platformId);
    const health = await this.control.health(connection.platformId);
    this.writeHealth(connection.platformId, health.status);
    if (health.status !== "ok") {
      throw new DevicePlatformError("PLATFORM_UNAVAILABLE", "Device platform health check failed");
    }
    let binding = this.ensureAddBinding(actor, operation, claimed);
    let paired: { ok: boolean; pendingConfirm?: boolean };
    try {
      paired = await this.control.verifyPairingChallenge({
        platformId: connection.platformId,
        externalDeviceId: claimed.externalDeviceId,
        challenge: request.challenge ?? "",
        proof: request.proof ?? "",
      });
    } catch (error) {
      this.markBinding(actor.tenantId, binding.bindingId, {
        status: "error",
        failureCode: error instanceof DevicePlatformError ? error.code : "PLATFORM_UNAVAILABLE",
      });
      throw error;
    }
    if (!paired.ok) {
      if (paired.pendingConfirm) {
        this.markBinding(actor.tenantId, binding.bindingId, {
          status: "pending_pair",
          failureCode: "PAIRING_PENDING",
        });
        throw new DevicePlatformError(
          "PAIRING_PENDING",
          "Confirm the pairing on the device, then try again",
        );
      }
      this.markBinding(actor.tenantId, binding.bindingId, {
        status: "error",
        failureCode: "VALIDATION",
      });
      throw new DevicePlatformError("VALIDATION", "Pairing challenge was rejected");
    }
    binding = this.markBinding(actor.tenantId, binding.bindingId, { status: "pending_auth" });
    if (!binding.authorizationRef) {
      const grant = this.issueGrant(actor, binding, connection.serviceClientIds[0] ?? "");
      binding = this.markBinding(actor.tenantId, binding.bindingId, {
        status: "applying",
        authorizationRef: grant.authorizationRef,
        authorizationEstablished: true,
        platformApplied: false,
      });
    } else {
      binding = this.markBinding(actor.tenantId, binding.bindingId, { status: "applying" });
    }
    await this.applyAndSync(actor.tenantId, binding);
    return this.readDevice(actor, claimed.deviceId);
  }

  private async driveRebind(
    actor: TrustedActor,
    operation: ManagementOperation,
  ): Promise<UserDeviceDto> {
    const shard = this.store.loadTenant(actor.tenantId);
    const association = this.requireOwnAssociation(actor, shard, operation.request.deviceId ?? "");
    const current = this.foreground(shard, association.deviceId);
    if (!current || current.status !== "active") {
      throw new DevicePlatformError("BINDING_BUSY", "Device has no active binding to rebind");
    }
    const human = assertDigitalHumanUse(
      actor,
      this.directory.getDigitalHuman(operation.request.digitalHumanId ?? ""),
      this.permittedIds(
        actor,
        this.directory.getDigitalHuman(operation.request.digitalHumanId ?? ""),
      ),
    );
    const connection = this.requireEnabledConnection(association.platformId);
    this.pushHistory(actor.tenantId, current);
    const previousRef = current.authorizationRef;
    if (previousRef) {
      this.revokeGrant(actor.tenantId, previousRef);
      this.dropToolReservations(actor.tenantId, previousRef);
    }
    const nextVersion = current.expectedBindingVersion + 1;
    let binding = this.markBinding(actor.tenantId, current.bindingId, {
      digitalHumanId: human.digitalHumanId,
      scopes: operation.request.scopes ?? current.scopes,
      expectedBindingVersion: nextVersion,
      status: "applying",
      authorizationEstablished: false,
      platformApplied: false,
      authorizationRef: undefined,
    });
    const grant = this.issueGrant(actor, binding, connection.serviceClientIds[0] ?? "");
    binding = this.markBinding(actor.tenantId, binding.bindingId, {
      authorizationRef: grant.authorizationRef,
      authorizationEstablished: true,
      platformApplied: false,
      status: "applying",
    });
    const shardAfter = this.store.loadTenant(actor.tenantId);
    shardAfter.events.push({
      eventId: randomId("evt"),
      tenantId: actor.tenantId,
      type: "binding.updated",
      authorizationRef: grant.authorizationRef,
      deviceId: binding.deviceId,
      bindingVersion: binding.expectedBindingVersion,
      at: this.iso(),
    });
    this.store.saveTenant(actor.tenantId, shardAfter);
    await this.applyAndSync(actor.tenantId, binding);
    const latest = this.store.loadTenant(actor.tenantId);
    const stored = latest.operations[operation.operationId];
    if (stored) {
      stored.bindingId = binding.bindingId;
      stored.deviceId = binding.deviceId;
      this.store.saveTenant(actor.tenantId, latest);
    }
    return this.readDevice(actor, association.deviceId);
  }

  private async driveRevoke(
    actor: TrustedActor,
    operation: ManagementOperation,
  ): Promise<UserDeviceDto> {
    const shard = this.store.loadTenant(actor.tenantId);
    const association = this.requireOwnAssociation(actor, shard, operation.request.deviceId ?? "");
    const current = this.foreground(shard, association.deviceId);
    if (!current) {
      throw new DevicePlatformError("NOT_FOUND", "Device not found");
    }
    assertCanOperateBinding(actor, current);
    const revoking = this.markBinding(actor.tenantId, current.bindingId, { status: "revoking" });
    if (revoking.authorizationRef) {
      this.dropToolReservations(actor.tenantId, revoking.authorizationRef);
    }
    await this.control.stopOrRevoke({
      platformId: association.platformId,
      externalDeviceId: association.externalDeviceId,
      authorizationRef: revoking.authorizationRef,
      expectedBindingVersion: revoking.expectedBindingVersion,
    });
    if (revoking.authorizationRef) {
      this.revokeGrant(actor.tenantId, revoking.authorizationRef);
    }
    this.pushHistory(actor.tenantId, revoking);
    const revoked = this.markBinding(actor.tenantId, revoking.bindingId, {
      status: "revoked",
      platformApplied: false,
      revokedAt: this.iso(),
    });
    const after = this.store.loadTenant(actor.tenantId);
    after.events.push({
      eventId: randomId("evt"),
      tenantId: actor.tenantId,
      type: "authorization.revoked",
      authorizationRef: revoked.authorizationRef,
      deviceId: revoked.deviceId,
      bindingVersion: revoked.expectedBindingVersion,
      at: this.iso(),
    });
    this.store.saveTenant(actor.tenantId, after);
    return this.readDevice(actor, association.deviceId);
  }

  private async applyAndSync(tenantId: string, binding: DeviceBinding): Promise<void> {
    const applied = await this.control.applyBinding({
      platformId: binding.platformId,
      externalDeviceId: binding.externalDeviceId,
      digitalHumanId: binding.digitalHumanId,
      authorizationRef: binding.authorizationRef ?? "",
      scopes: binding.scopes,
      expectedBindingVersion: binding.expectedBindingVersion,
      ...(binding.authorizationRef
        ? { grantCredential: this.peekGrantCredential(binding.authorizationRef) }
        : {}),
    });
    const status = await this.control.getBindingApplicationStatus({
      platformId: binding.platformId,
      externalDeviceId: binding.externalDeviceId,
      expectedBindingVersion: binding.expectedBindingVersion,
    });
    const appliedVersion = status.appliedBindingVersion ?? applied.appliedBindingVersion ?? 0;
    const platformApplied =
      status.state === "applied" && appliedVersion === binding.expectedBindingVersion;
    this.markBinding(tenantId, binding.bindingId, {
      appliedBindingVersion: appliedVersion,
      platformApplied,
      status: platformApplied ? "active" : "applying",
      authorizationEstablished: Boolean(binding.authorizationRef),
    });
    const sync = await this.control.syncStatus({
      platformId: binding.platformId,
      externalDeviceId: binding.externalDeviceId,
    });
    const presence = sync.presence ?? (sync.online ? "online" : "offline");
    const projection: StatusProjection = {
      deviceId: binding.deviceId,
      online: presence === "online",
      presence,
      ...(sync.lastSeen ? { lastSeen: sync.lastSeen } : {}),
      capabilities: [...sync.capabilities],
      ...(sync.firmware ? { firmware: sync.firmware } : {}),
      ...(sync.model ? { model: sync.model } : {}),
      ...(sync.anomalySummary ? { anomalySummary: sync.anomalySummary } : {}),
      updatedAt: this.iso(),
    };
    const shard = this.store.loadTenant(tenantId);
    shard.projections[binding.deviceId] = projection;
    this.store.saveTenant(tenantId, shard);
    await this.control.queryDevices({ tenantId, userId: binding.userId });
  }

  private ensureClaim(
    actor: TrustedActor,
    operation: ManagementOperation,
    platformId: string,
  ): DeviceAssociation {
    const externalDeviceId = operation.request.externalDeviceId ?? "";
    const claims = this.store.loadClaims();
    const key = claimKey(platformId, externalDeviceId);
    const existingClaim = claims.claims[key];
    if (existingClaim && existingClaim.claimingUserId !== actor.userId) {
      throw new DevicePlatformError("DEVICE_CLAIMED", "Device is already claimed");
    }
    if (existingClaim && existingClaim.tenantId !== actor.tenantId) {
      throw new DevicePlatformError("DEVICE_CLAIMED", "Device is already claimed");
    }
    const shard = this.store.loadTenant(actor.tenantId);
    if (existingClaim) {
      const association = shard.associations[existingClaim.deviceId];
      if (!association) {
        throw new DevicePlatformError("CONFLICT", "Device claim is missing its association");
      }
      const foreground = this.foreground(shard, association.deviceId);
      if (foreground && operation.bindingId && foreground.bindingId !== operation.bindingId) {
        throw new DevicePlatformError("BINDING_BUSY", "Device already has a foreground binding");
      }
      if (foreground && !operation.bindingId && !foregroundAllowsAnotherAdd(foreground.status)) {
        throw new DevicePlatformError("BINDING_BUSY", "Device already has a foreground binding");
      }
      operation.deviceId = association.deviceId;
      return association;
    }
    const deviceId = randomId("dev");
    const now = this.iso();
    const association: DeviceAssociation = {
      deviceId,
      platformId,
      externalDeviceId,
      tenantId: actor.tenantId,
      claimingUserId: actor.userId,
      displayName: operation.request.displayName?.trim() || externalDeviceId,
      createdAt: now,
      updatedAt: now,
    };
    claims.claims[key] = {
      platformId,
      externalDeviceId,
      tenantId: actor.tenantId,
      deviceId,
      claimingUserId: actor.userId,
    };
    shard.associations[deviceId] = association;
    operation.deviceId = deviceId;
    const stored = shard.operations[operation.operationId];
    if (stored) {
      stored.deviceId = deviceId;
    }
    this.store.saveClaims(claims);
    this.store.saveTenant(actor.tenantId, shard);
    return association;
  }

  private ensureAddBinding(
    actor: TrustedActor,
    operation: ManagementOperation,
    association: DeviceAssociation,
  ): DeviceBinding {
    const shard = this.store.loadTenant(actor.tenantId);
    const existing = operation.bindingId
      ? shard.bindings[operation.bindingId]
      : this.foreground(shard, association.deviceId);
    if (existing && existing.status !== "revoked") {
      if (foregroundAllowsAnotherAdd(existing.status)) {
        existing.digitalHumanId = operation.request.digitalHumanId || existing.digitalHumanId;
        existing.scopes = [...(operation.request.scopes ?? existing.scopes)];
        existing.status = "pending_pair";
        existing.failureCode = undefined;
        existing.authorizationEstablished = false;
        existing.platformApplied = false;
        existing.updatedAt = this.iso();
        delete existing.authorizationRef;
        this.store.saveTenant(actor.tenantId, shard);
      }
      operation.bindingId = existing.bindingId;
      return existing;
    }
    const now = this.iso();
    const binding: DeviceBinding = {
      bindingId: randomId("bind"),
      deviceId: association.deviceId,
      platformId: association.platformId,
      externalDeviceId: association.externalDeviceId,
      tenantId: actor.tenantId,
      userId: actor.userId,
      digitalHumanId: operation.request.digitalHumanId ?? "",
      scopes: [...(operation.request.scopes ?? [])],
      expectedBindingVersion: 1,
      appliedBindingVersion: 0,
      status: "pending_pair",
      authorizationEstablished: false,
      platformApplied: false,
      createdAt: now,
      updatedAt: now,
    };
    shard.bindings[binding.bindingId] = binding;
    operation.bindingId = binding.bindingId;
    const stored = shard.operations[operation.operationId];
    if (stored) {
      stored.bindingId = binding.bindingId;
      stored.deviceId = association.deviceId;
    }
    this.store.saveTenant(actor.tenantId, shard);
    return binding;
  }

  private issueGrant(
    actor: TrustedActor,
    binding: DeviceBinding,
    serviceClientId: string,
  ): GrantReference {
    const connection = this.store.loadConnections().connections[binding.platformId];
    if (!connection?.enabled) {
      throw new DevicePlatformError("PLATFORM_DISABLED", "Device platform connection is disabled");
    }
    const credential = `obgc_${randomBytes(24).toString("hex")}`;
    const grant: GrantReference = {
      authorizationRef: randomId("azr"),
      credentialHash: sha256Hex(credential),
      serviceClientId,
      digitalHumanId: binding.digitalHumanId,
      deviceId: binding.deviceId,
      userId: actor.userId,
      tenantId: actor.tenantId,
      scopes: [...binding.scopes],
      bindingVersion: binding.expectedBindingVersion,
      status: "active",
      issuedAt: this.iso(),
    };
    const shard = this.store.loadTenant(actor.tenantId);
    shard.grants[grant.authorizationRef] = grant;
    this.rememberCredential(grant.authorizationRef, credential);
    this.store.saveTenant(actor.tenantId, shard);
    return grant;
  }

  private rememberCredential(authorizationRef: string, credential: string): void {
    this.credentials.set(authorizationRef, credential);
  }

  /** In-process only. Never serialized and never returned by user or admin DTOs. */
  peekGrantCredential(authorizationRef: string): string | undefined {
    return this.credentials.get(authorizationRef);
  }

  private revokeGrant(tenantId: string, authorizationRef: string): void {
    const shard = this.store.loadTenant(tenantId);
    const grant = shard.grants[authorizationRef];
    if (!grant || grant.status === "revoked") {
      return;
    }
    grant.status = "revoked";
    grant.revokedAt = this.iso();
    this.credentials.delete(authorizationRef);
    this.store.saveTenant(tenantId, shard);
  }

  private markBinding(
    tenantId: string,
    bindingId: string,
    patch: Partial<DeviceBinding>,
  ): DeviceBinding {
    const shard = this.store.loadTenant(tenantId);
    const binding = shard.bindings[bindingId];
    if (!binding) {
      throw new DevicePlatformError("NOT_FOUND", "Binding not found");
    }
    Object.assign(binding, patch, { updatedAt: this.iso() });
    if (
      patch.authorizationRef === undefined &&
      Object.prototype.hasOwnProperty.call(patch, "authorizationRef")
    ) {
      delete binding.authorizationRef;
    }
    this.store.saveTenant(tenantId, shard);
    return binding;
  }

  private pushHistory(tenantId: string, binding: DeviceBinding): void {
    const shard = this.store.loadTenant(tenantId);
    shard.bindingHistory.push({
      historyId: randomId("hist"),
      bindingId: binding.bindingId,
      deviceId: binding.deviceId,
      digitalHumanId: binding.digitalHumanId,
      authorizationRef: binding.authorizationRef,
      expectedBindingVersion: binding.expectedBindingVersion,
      appliedBindingVersion: binding.appliedBindingVersion,
      status: binding.status,
      recordedAt: this.iso(),
    });
    this.store.saveTenant(tenantId, shard);
  }

  private async readDevice(actor: TrustedActor, deviceId: string): Promise<UserDeviceDto> {
    return this.getDevice(actor, deviceId);
  }

  private visibleDevices(actor: TrustedActor): UserDeviceDto[] {
    const shard = this.store.loadTenant(actor.tenantId);
    return Object.values(shard.associations)
      .filter((association) => association.claimingUserId === actor.userId)
      .map((association) =>
        toUserDeviceDto(
          association,
          this.foreground(shard, association.deviceId),
          shard.projections[association.deviceId],
        ),
      );
  }

  private foreground(shard: TenantShard, deviceId: string): DeviceBinding | undefined {
    return Object.values(shard.bindings).find(
      (binding) => binding.deviceId === deviceId && FOREGROUND_BINDING_STATUSES.has(binding.status),
    );
  }

  private requireOwnAssociation(
    actor: TrustedActor,
    shard: TenantShard,
    deviceId: string,
  ): DeviceAssociation {
    const association = shard.associations[deviceId];
    if (!association) {
      throw new DevicePlatformError("NOT_FOUND", "Device not found");
    }
    assertCanSeeAssociation(actor, association);
    return association;
  }

  private requireEnabledConnection(platformId: string): DevicePlatformConnection {
    const connection = this.store.loadConnections().connections[platformId];
    if (!connection) {
      throw new DevicePlatformError("NOT_FOUND", "Platform connection not found");
    }
    if (!connection.enabled) {
      throw new DevicePlatformError("PLATFORM_DISABLED", "Device platform connection is disabled");
    }
    return connection;
  }

  private writeHealth(platformId: string, status: "ok" | "down"): void {
    const file = this.store.loadConnections();
    const connection = file.connections[platformId];
    if (!connection) {
      return;
    }
    connection.health = status;
    connection.healthCheckedAt = this.iso();
    connection.healthCode = status;
    this.store.saveConnections(file);
  }

  private validateMaterial(actor: TrustedActor, material: OperationMaterial): void {
    if (material.scopes) {
      if (
        material.scopes.length === 0 ||
        material.scopes.some((scope) => !ALLOWED_SCOPES.has(scope))
      ) {
        throw new DevicePlatformError("VALIDATION", "scopes are invalid");
      }
    }
    if (material.kind === "add") {
      requireToken(material.platformId, "platformId");
      requireToken(material.externalDeviceId, "externalDeviceId");
      requireToken(material.digitalHumanId, "digitalHumanId");
      requireToken(material.challenge, "challenge");
      requireToken(material.proof, "proof");
      if (!material.scopes || material.scopes.length === 0) {
        throw new DevicePlatformError("VALIDATION", "scopes are required");
      }
      const human = this.directory.getDigitalHuman(material.digitalHumanId ?? "");
      assertDigitalHumanUse(actor, human, this.permittedIds(actor, human));
      this.requireEnabledConnection(material.platformId ?? "");
      const claims = this.store.loadClaims();
      const claim =
        claims.claims[claimKey(material.platformId ?? "", material.externalDeviceId ?? "")];
      if (claim && (claim.claimingUserId !== actor.userId || claim.tenantId !== actor.tenantId)) {
        throw new DevicePlatformError("DEVICE_CLAIMED", "Device is already claimed");
      }
      if (claim) {
        const shard = this.store.loadTenant(actor.tenantId);
        const foreground = this.foreground(shard, claim.deviceId);
        if (foreground && !foregroundAllowsAnotherAdd(foreground.status)) {
          throw new DevicePlatformError("BINDING_BUSY", "Device already has a foreground binding");
        }
      }
    }
    if (material.kind === "rebind" || material.kind === "revoke") {
      requireToken(material.deviceId, "deviceId");
      const shard = this.store.loadTenant(actor.tenantId);
      this.requireOwnAssociation(actor, shard, material.deviceId ?? "");
    }
    if (material.kind === "rebind") {
      requireToken(material.digitalHumanId, "digitalHumanId");
      const human = this.directory.getDigitalHuman(material.digitalHumanId ?? "");
      assertDigitalHumanUse(actor, human, this.permittedIds(actor, human));
    }
  }

  private permittedIds(
    actor: TrustedActor,
    human: ReturnType<IdentityDirectory["getDigitalHuman"]>,
  ): string[] {
    if (!human) {
      return [];
    }
    return this.directory.hasDigitalHumanUse(actor, human)
      ? [human.digitalHumanId, human.gatewayAgentId]
      : [];
  }

  private actor(actor: TrustedActor): TrustedActor {
    if (this.mode === "formal") {
      assertFormalRuntime(this.env);
    }
    return requireActiveActor(actor);
  }

  private iso(): string {
    return new Date(this.now()).toISOString();
  }
}

function materialOf(input: SubmitOperationInput): OperationMaterial {
  if (!OPERATION_ID.test(input.operationId)) {
    throw new DevicePlatformError("VALIDATION", "operationId is invalid");
  }
  if (input.kind !== "add" && input.kind !== "rebind" && input.kind !== "revoke") {
    throw new DevicePlatformError("VALIDATION", "kind is invalid");
  }
  return {
    kind: input.kind,
    platformId: input.platformId,
    externalDeviceId: input.externalDeviceId,
    deviceId: input.deviceId,
    digitalHumanId: input.digitalHumanId,
    scopes: input.scopes ? [...input.scopes] : undefined,
    displayName: input.displayName,
    challenge: input.pairing?.challenge,
    proof: input.pairing?.proof,
  };
}

function rejectRequestPayload(body: Record<string, unknown>): void {
  rejectIdentityOverrides(body);
  assertBodyHasNoPairingFields(body);
  for (const field of SECRET_FIELDS) {
    if (body[field] !== undefined) {
      throw new DevicePlatformError("SECRET_REJECTED", "Secrets are not accepted on this API");
    }
  }
}

const CREDENTIAL_FIELDS = new Set(["clientSecret", "rotate"]);

function rejectCredentialPayload(body: Record<string, unknown>): void {
  rejectIdentityOverrides(body);
  assertBodyHasNoPairingFields(body);
  for (const field of SECRET_FIELDS) {
    if (field !== "clientSecret" && body[field] !== undefined) {
      throw new DevicePlatformError("SECRET_REJECTED", "Secrets are not accepted on this API");
    }
  }
  for (const key of Object.keys(body)) {
    if (!CREDENTIAL_FIELDS.has(key)) {
      throw new DevicePlatformError("VALIDATION", "Credential body is invalid");
    }
  }
}

function requireToken(value: string | undefined, label: string): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    throw new DevicePlatformError("VALIDATION", `${label} is required`);
  }
  return trimmed;
}

function normalizeClientIds(value: string[] | undefined): string[] {
  if (
    !value ||
    value.length === 0 ||
    value.some((id) => typeof id !== "string" || id.trim() === "")
  ) {
    throw new DevicePlatformError("VALIDATION", "serviceClientIds is required");
  }
  return value.map((id) => id.trim());
}

function normalizeClientIdentity(value: string | undefined, serviceClientIds: string[]): string {
  const identity = (value?.trim() || serviceClientIds[0] || "").trim();
  if (!identity || identity.includes(":") || /\s/.test(identity)) {
    throw new DevicePlatformError("VALIDATION", "clientIdentity is invalid");
  }
  return identity;
}

function normalizeDisplayName(value: string | undefined, platformId: string): string {
  const name = value?.trim() || platformId;
  if (name.length > 80) {
    throw new DevicePlatformError("VALIDATION", "displayName is too long");
  }
  return name;
}

function normalizeNotes(value: string | undefined): string {
  const notes = value?.trim() ?? "";
  if (notes.length > 4000) {
    throw new DevicePlatformError("VALIDATION", "registrationNotes is too long");
  }
  return notes;
}

function normalizeCallbackAllowlist(
  value: string[] | undefined,
  environment: DevicePlatformEnvironment,
): string[] {
  if (!value) {
    return [];
  }
  return value.map((entry) => assertSafeCallbackUrl(entry, environment));
}

function retryableCode(error: unknown): boolean {
  return (
    error instanceof DevicePlatformError &&
    (error.code === "PLATFORM_UNAVAILABLE" ||
      error.code === "PLATFORM_DISABLED" ||
      error.code === "PAIRING_PENDING")
  );
}

function foregroundAllowsAnotherAdd(status: DeviceBinding["status"]): boolean {
  return status === "error" || status === "pending_pair";
}

function randomId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString("hex")}`;
}
