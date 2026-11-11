import { toTaskResponse } from "./b-server.js";
import {
  assertChecksumMatch,
  decodeBase64Bytes,
  encodeInlineJsonBytes,
  normalizeSha256,
} from "./checksum.js";
import { ExecHttpClient, type ExecClientRuntime } from "./client.js";
import type { ExecProtocolConfig } from "./config.js";
import { ExecProtocolError, isExecProtocolError } from "./errors.js";
import { forbidHostFallback } from "./host-fallback.js";
import { assertIdempotencyKey, canonicalizeIntent } from "./idempotency.js";
import { newTaskId } from "./ids.js";
import { transitionState } from "./state-machine.js";
import { FileExecStore } from "./store.js";
import {
  EXEC_API_VERSION,
  EXEC_API_VERSION_FIELD,
  ROLE_CONTROL_PLANE,
  SUCCESS_HTTP_IDEMPOTENT_OR_READ,
  SUCCESS_HTTP_NEW_ACCEPT,
  isTerminalState,
  type ExecArtifactResponse,
  type ExecLeaseRecord,
  type ExecRevocation,
  type ExecSiteDebug,
  type ExecTaskKind,
  type ExecTaskRecord,
  type ExecTaskResponse,
  type ExecInput,
  type HostCommandProbe,
} from "./types.js";

export type ControlPlaneOptions = {
  config: ExecProtocolConfig;
  store: FileExecStore;
  client: ExecHttpClient;
  maxRequestBodyBytes: number;
  now?: () => number;
  runtime?: ExecClientRuntime;
  hostCommandProbe?: HostCommandProbe;
  subject: string;
};

const TASK_KINDS: ReadonlySet<ExecTaskKind> = new Set([
  "echo",
  "sleep",
  "fail",
  "side-effect-probe",
  "corrupt-checksum",
  "ignore-cancel",
]);

export class AControlPlane {
  readonly role = ROLE_CONTROL_PLANE;
  readonly config: ExecProtocolConfig;
  readonly store: FileExecStore;
  readonly client: ExecHttpClient;
  readonly subject: string;
  private readonly now: () => number;
  readonly hostCommandProbe?: HostCommandProbe;
  private executionsStarted = 0;

  constructor(options: ControlPlaneOptions) {
    this.config = options.config;
    this.store = options.store;
    this.client = options.client;
    this.subject = options.subject;
    this.now = options.now ?? options.runtime?.now ?? (() => Date.now());
    this.hostCommandProbe = options.hostCommandProbe;
  }

  debug(): ExecSiteDebug {
    return {
      role: ROLE_CONTROL_PLANE,
      executionsStarted: this.executionsStarted,
      hostCommands: this.hostCommandProbe?.calls.length ?? 0,
      probes: {},
    };
  }

  async loadAndReconcile(): Promise<void> {
    await this.store.load();
    for (const task of this.store.listTasks()) {
      if (isTerminalState(task.state)) {
        continue;
      }
      await this.reconcileTask(task);
    }
  }

  async submit(
    payload: Record<string, unknown>,
    lease: ExecLeaseRecord,
  ): Promise<{ status: number; body: ExecTaskResponse }> {
    const tenantId = requireField(payload, "tenantId");
    const toolCallId = requireField(payload, "toolCallId");
    const kindRaw = requireField(payload, "kind");
    if (!TASK_KINDS.has(kindRaw as ExecTaskKind)) {
      throw new ExecProtocolError("EXEC_INTERNAL", "unsupported isolation task kind");
    }
    const kind = kindRaw as ExecTaskKind;
    const key = assertIdempotencyKey(payload.idempotencyKey, this.config);
    const input = payload.input as ExecInput;
    if (!input || typeof input !== "object") {
      throw new ExecProtocolError("EXEC_INTERNAL", "missing required field input");
    }
    this.validateLocalInput(input);
    const probeId = optionalField(payload, "probeId");
    const sleepMs = optionalNum(payload, "sleepMs");
    const subject = optionalField(payload, "subject") ?? lease.subject ?? this.subject;
    this.assertNotRevoked({ tenantId, subject });

    const intentCanonical = canonicalizeIntent({
      tenantId,
      toolCallId,
      kind,
      input,
      probeId,
      sleepMs,
    });
    const nowMs = this.now();
    const existing = this.store.getIdempotency(tenantId, key);
    if (existing) {
      const existingTask = this.store.getTask(existing.taskId);
      if (existing.expiresAtMs > nowMs) {
        if (existing.intentCanonical !== intentCanonical) {
          throw new ExecProtocolError(
            "EXEC_CONFLICT",
            "idempotency key reused with a different intent",
            {
              taskId: existing.taskId,
              state: existingTask?.state,
            },
          );
        }
        const current = existingTask ?? (await this.tryStatusFromB(tenantId, existing.taskId, key));
        if (!current) {
          throw new ExecProtocolError("EXEC_NOT_FOUND", "idempotent task is missing");
        }
        return { status: SUCCESS_HTTP_IDEMPOTENT_OR_READ, body: toTaskResponse(current) };
      }
      if (!existingTask || !isTerminalState(existingTask.state)) {
        throw new ExecProtocolError(
          "EXEC_CONFLICT",
          "idempotency key expired but the original task is not terminal",
          { taskId: existing.taskId, state: existingTask?.state },
        );
      }
    }

    const taskId = newTaskId();
    const record: ExecTaskRecord = {
      taskId,
      toolCallId,
      tenantId,
      userId: optionalField(payload, "userId"),
      agentId: optionalField(payload, "agentId"),
      subject,
      kind,
      idempotencyKey: key,
      intentCanonical,
      state: "accepted",
      input,
      createdAt: new Date(nowMs).toISOString(),
      updatedAt: new Date(nowMs).toISOString(),
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
      idempotencyExpiresAtMs: nowMs + this.config.idempotencyTtlMs,
      artifacts: [],
      probeId,
      sleepMs,
      bSubmitAttempted: false,
      bAccepted: false,
    };
    await this.store.upsertTask(record);
    await this.store.putIdempotency({
      tenantId,
      idempotencyKey: key,
      taskId,
      intentCanonical,
      createdAtMs: nowMs,
      expiresAtMs: record.idempotencyExpiresAtMs,
    });

    try {
      record.bSubmitAttempted = true;
      await this.store.upsertTask(record);
      const peer = await this.client.submit({
        [EXEC_API_VERSION_FIELD]: EXEC_API_VERSION,
        taskId,
        idempotencyKey: key,
        tenantId,
        toolCallId,
        kind,
        input,
        userId: record.userId,
        agentId: record.agentId,
        subject,
        probeId,
        sleepMs,
      });
      this.applyPeer(record, peer.payload, { accepted: true });
      await this.store.upsertTask(record);
      if (record.bOutcome === "produced") {
        await this.tryFinalizeSuccess(record);
      }
      return { status: SUCCESS_HTTP_NEW_ACCEPT, body: toTaskResponse(record) };
    } catch (error) {
      if (isUnreachable(error)) {
        const recovered = await this.queryAfterSubmitTimeout(record);
        if (recovered) {
          return { status: SUCCESS_HTTP_NEW_ACCEPT, body: toTaskResponse(recovered) };
        }
        await this.store.upsertTask(record);
        throw new ExecProtocolError(
          "EXEC_UNREACHABLE",
          "B' is unreachable; task remains pending and will not run on A'",
          {
            taskId: record.taskId,
            state: record.state,
            cause: error,
          },
        );
      }
      if (isExecProtocolError(error) && error.code === "EXEC_REVOKED") {
        record.errorCode = "EXEC_REVOKED";
        record.errorMessage = error.message;
        await this.store.upsertTask(record);
      }
      throw error;
    }
  }

  async status(
    payload: Record<string, unknown>,
    lease: ExecLeaseRecord,
  ): Promise<{ status: number; body: ExecTaskResponse }> {
    const tenantId = requireField(payload, "tenantId");
    const task = this.lookupLocal(payload, lease, tenantId);
    const refreshed = await this.refreshFromB(task, { allowUnreachable: true });
    return { status: SUCCESS_HTTP_IDEMPOTENT_OR_READ, body: toTaskResponse(refreshed) };
  }

  async cancel(
    payload: Record<string, unknown>,
    lease: ExecLeaseRecord,
  ): Promise<{ status: number; body: ExecTaskResponse }> {
    const tenantId = requireField(payload, "tenantId");
    const taskId = requireField(payload, "taskId");
    const task = this.requireTask(taskId, tenantId, lease);
    if (isTerminalState(task.state) || task.state === "result_unconfirmed") {
      return { status: SUCCESS_HTTP_IDEMPOTENT_OR_READ, body: toTaskResponse(task) };
    }
    if (task.state !== "cancel_requested") {
      task.state = transitionState(task.state, "cancel_requested", { taskId: task.taskId });
      task.cancelRequestedAtMs = this.now();
      task.updatedAtMs = task.cancelRequestedAtMs;
      task.updatedAt = new Date(task.updatedAtMs).toISOString();
      await this.store.upsertTask(task);
    }
    try {
      const peer = await this.client.cancel({
        [EXEC_API_VERSION_FIELD]: EXEC_API_VERSION,
        tenantId,
        taskId: task.taskId,
        reason: optionalField(payload, "reason"),
      });
      this.applyPeer(task, peer.payload, { accepted: true });
      await this.store.upsertTask(task);
    } catch (error) {
      if (!isUnreachable(error)) {
        throw error;
      }
    }
    this.expireCancelIfNeeded(task);
    await this.store.upsertTask(task);
    return { status: SUCCESS_HTTP_IDEMPOTENT_OR_READ, body: toTaskResponse(task) };
  }

  async artifact(
    payload: Record<string, unknown>,
    lease: ExecLeaseRecord,
  ): Promise<{ status: number; body: ExecArtifactResponse }> {
    const tenantId = requireField(payload, "tenantId");
    const taskId = requireField(payload, "taskId");
    const artifactId = requireField(payload, "artifactId");
    const includeBytes = payload.includeBytes === true;
    const task = this.requireTask(taskId, tenantId, lease);
    let peer: ExecArtifactResponse;
    try {
      const result = await this.client.artifact({
        [EXEC_API_VERSION_FIELD]: EXEC_API_VERSION,
        tenantId,
        taskId,
        artifactId,
        includeBytes: true,
      });
      peer = result.payload;
    } catch (error) {
      if (isUnreachable(error)) {
        throw new ExecProtocolError(
          "EXEC_UNREACHABLE",
          "B' is unreachable; artifact will not be fetched via A' host",
          {
            taskId,
            state: task.state,
            cause: error,
          },
        );
      }
      throw error;
    }
    if (typeof peer.bytesBase64 !== "string") {
      throw new ExecProtocolError(
        "EXEC_CHECKSUM_MISMATCH",
        "artifact bytes were not returned for verification",
        {
          taskId,
          state: task.state,
        },
      );
    }
    const bytes = decodeBase64Bytes(peer.bytesBase64);
    try {
      assertChecksumMatch({
        expectedSha256: peer.sha256,
        expectedByteCount: peer.byteCount,
        actual: bytes,
      });
    } catch (error) {
      this.failChecksum(task, error);
      await this.store.upsertTask(task);
      throw new ExecProtocolError(
        "EXEC_CHECKSUM_MISMATCH",
        task.errorMessage ?? "checksum mismatch",
        {
          taskId,
          state: task.state,
        },
      );
    }

    const ref = {
      artifactId: peer.artifactId,
      sha256: normalizeSha256(peer.sha256),
      byteCount: peer.byteCount,
      toolCallId: task.toolCallId,
      taskId: task.taskId,
    };
    task.artifacts = [ref];
    await this.store.putArtifactBytes(
      {
        artifactId: ref.artifactId,
        taskId: task.taskId,
        toolCallId: task.toolCallId,
        tenantId: task.tenantId,
        sha256: ref.sha256,
        byteCount: ref.byteCount,
        fileName: `${ref.artifactId}.bin`,
      },
      bytes,
    );
    await this.tryFinalizeSuccess(task);
    await this.store.upsertTask(task);
    return {
      status: SUCCESS_HTTP_IDEMPOTENT_OR_READ,
      body: {
        [EXEC_API_VERSION_FIELD]: EXEC_API_VERSION,
        taskId: task.taskId,
        toolCallId: task.toolCallId,
        artifactId: ref.artifactId,
        sha256: ref.sha256,
        byteCount: ref.byteCount,
        delivered: task.state === "succeeded",
        ...(includeBytes ? { bytesBase64: peer.bytesBase64 } : {}),
      },
    };
  }

  async upload(
    payload: Record<string, unknown>,
    lease: ExecLeaseRecord,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const tenantId = requireField(payload, "tenantId");
    this.assertNotRevoked({ tenantId, subject: lease.subject ?? this.subject });
    try {
      return await this.client.upload({
        [EXEC_API_VERSION_FIELD]: EXEC_API_VERSION,
        tenantId,
        bytesBase64: requireField(payload, "bytesBase64"),
        sha256: requireField(payload, "sha256"),
        byteCount: optionalNum(payload, "byteCount") as number,
      });
    } catch (error) {
      if (isUnreachable(error)) {
        throw new ExecProtocolError(
          "EXEC_UNREACHABLE",
          "B' is unreachable; A' will not store or execute the upload locally",
          {
            cause: error,
          },
        );
      }
      throw error;
    }
  }

  async revoke(
    payload: Record<string, unknown>,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const nowMs = this.now();
    const revocation: ExecRevocation = {
      tenantId: optionalField(payload, "tenantId"),
      subject: optionalField(payload, "subject"),
      taskId: optionalField(payload, "taskId"),
      revokedAt: new Date(nowMs).toISOString(),
      revokedAtMs: nowMs,
    };
    if (!revocation.tenantId && !revocation.subject && !revocation.taskId) {
      throw new ExecProtocolError(
        "EXEC_INTERNAL",
        "revoke scope requires tenantId, subject, or taskId",
      );
    }
    await this.store.addRevocation(revocation);
    for (const task of this.store.listTasks()) {
      if (!matchesScope(revocation, task)) {
        continue;
      }
      if (isTerminalState(task.state) || task.state === "result_unconfirmed") {
        continue;
      }
      if (task.state !== "cancel_requested") {
        task.state = transitionState(task.state, "cancel_requested", { taskId: task.taskId });
        task.cancelRequestedAtMs = nowMs;
        task.updatedAtMs = nowMs;
        task.updatedAt = new Date(nowMs).toISOString();
        await this.store.upsertTask(task);
      }
    }
    try {
      await this.client.revoke({
        [EXEC_API_VERSION_FIELD]: EXEC_API_VERSION,
        tenantId: revocation.tenantId,
        subject: revocation.subject,
        taskId: revocation.taskId,
      });
    } catch (error) {
      if (!isUnreachable(error)) {
        throw error;
      }
    }
    return {
      status: SUCCESS_HTTP_IDEMPOTENT_OR_READ,
      body: { [EXEC_API_VERSION_FIELD]: EXEC_API_VERSION, revoked: true },
    };
  }

  neverRunOnHost(reason: string, taskId?: string): never {
    return forbidHostFallback(reason, taskId);
  }

  private validateLocalInput(input: ExecInput): void {
    if (input.kind === "inline-json") {
      if (
        !Object.hasOwn(input, "json") ||
        typeof input.sha256 !== "string" ||
        typeof input.byteCount !== "number"
      ) {
        throw new ExecProtocolError(
          "EXEC_INTERNAL",
          "inline-json input requires json, sha256, and byteCount",
        );
      }
      assertChecksumMatch({
        expectedSha256: input.sha256,
        expectedByteCount: input.byteCount,
        actual: encodeInlineJsonBytes(input.json),
      });
      return;
    }
    if (input.kind === "inline-bytes") {
      if (
        typeof input.bytesBase64 !== "string" ||
        typeof input.sha256 !== "string" ||
        typeof input.byteCount !== "number"
      ) {
        throw new ExecProtocolError(
          "EXEC_INTERNAL",
          "inline-bytes input requires bytesBase64, sha256, and byteCount",
        );
      }
      assertChecksumMatch({
        expectedSha256: input.sha256,
        expectedByteCount: input.byteCount,
        actual: decodeBase64Bytes(input.bytesBase64),
      });
      return;
    }
    if (input.kind !== "artifact" || typeof input.artifactId !== "string" || !input.artifactId) {
      throw new ExecProtocolError(
        "EXEC_INTERNAL",
        "input.kind must be inline-json, inline-bytes, or artifact",
      );
    }
  }

  private assertNotRevoked(scope: { tenantId: string; subject: string; taskId?: string }): void {
    for (const revocation of this.store.listRevocations()) {
      if (matchesScope(revocation, scope)) {
        throw new ExecProtocolError("EXEC_REVOKED", "execution authorization has been revoked", {
          taskId: scope.taskId,
        });
      }
    }
  }

  private lookupLocal(
    payload: Record<string, unknown>,
    lease: ExecLeaseRecord,
    tenantId: string,
  ): ExecTaskRecord {
    const taskId = optionalField(payload, "taskId");
    const idempotencyKey = optionalField(payload, "idempotencyKey");
    if (!taskId && !idempotencyKey) {
      throw new ExecProtocolError("EXEC_INTERNAL", "status requires taskId or idempotencyKey");
    }
    if (taskId) {
      return this.requireTask(taskId, tenantId, lease);
    }
    const index = this.store.getIdempotency(tenantId, idempotencyKey as string);
    if (!index) {
      throw new ExecProtocolError("EXEC_NOT_FOUND", "task not found");
    }
    return this.requireTask(index.taskId, tenantId, lease);
  }

  private requireTask(taskId: string, tenantId: string, lease: ExecLeaseRecord): ExecTaskRecord {
    const task = this.store.getTask(taskId);
    if (!task || task.tenantId !== tenantId) {
      throw new ExecProtocolError("EXEC_NOT_FOUND", "task not found");
    }
    if (lease.tenantId && task.tenantId !== lease.tenantId) {
      throw new ExecProtocolError("EXEC_NOT_FOUND", "task not found");
    }
    return task;
  }

  private applyPeer(
    local: ExecTaskRecord,
    peer: ExecTaskResponse,
    opts: { accepted: boolean },
  ): void {
    if (opts.accepted) {
      local.bAccepted = true;
    }
    if (peer.toolCallId && peer.toolCallId !== local.toolCallId) {
      throw new ExecProtocolError("EXEC_CONFLICT", "toolCallId mismatch between A' and B'", {
        taskId: local.taskId,
        state: local.state,
      });
    }
    if (peer.artifacts?.length) {
      local.artifacts = peer.artifacts;
    }
    if (peer.bOutcome) {
      local.bOutcome = peer.bOutcome;
    }
    if (peer.errorCode) {
      local.errorCode = peer.errorCode;
    }
    if (peer.errorMessage) {
      local.errorMessage = peer.errorMessage;
    }
    this.mergePeerState(local, peer.state);
    local.updatedAtMs = this.now();
    local.updatedAt = new Date(local.updatedAtMs).toISOString();
  }

  private mergePeerState(local: ExecTaskRecord, peerState: ExecTaskRecord["state"]): void {
    if (local.state === "succeeded") {
      return;
    }
    if (peerState === "succeeded") {
      return;
    }
    if (local.state === peerState) {
      return;
    }
    if (isTerminalState(local.state)) {
      return;
    }
    if (peerState === "queued" && local.state === "accepted") {
      local.state = transitionState(local.state, "queued", { taskId: local.taskId });
      return;
    }
    if (peerState === "running" && (local.state === "accepted" || local.state === "queued")) {
      if (local.state === "accepted") {
        local.state = transitionState(local.state, "queued", { taskId: local.taskId });
      }
      local.state = transitionState(local.state, "running", { taskId: local.taskId });
      return;
    }
    if (peerState === "failed" && (local.state === "queued" || local.state === "running")) {
      local.state = transitionState(local.state, "failed", { taskId: local.taskId });
      return;
    }
    if (peerState === "cancelled") {
      if (local.state !== "cancel_requested") {
        if (local.state === "accepted" || local.state === "queued" || local.state === "running") {
          local.state = transitionState(local.state, "cancel_requested", { taskId: local.taskId });
        }
      }
      if (local.state === "cancel_requested") {
        local.state = transitionState(local.state, "cancelled", { taskId: local.taskId });
      }
      return;
    }
    if (
      peerState === "cancel_requested" &&
      (local.state === "accepted" || local.state === "queued" || local.state === "running")
    ) {
      local.state = transitionState(local.state, "cancel_requested", { taskId: local.taskId });
      return;
    }
    if (peerState === "result_unconfirmed" && !isTerminalState(local.state)) {
      if (local.state === "accepted") {
        local.state = "result_unconfirmed";
        return;
      }
      local.state = transitionState(local.state, "result_unconfirmed", { taskId: local.taskId });
    }
  }

  private async tryFinalizeSuccess(task: ExecTaskRecord): Promise<void> {
    if (
      task.state === "succeeded" ||
      isTerminalState(task.state) ||
      task.state === "result_unconfirmed"
    ) {
      return;
    }
    if (task.bOutcome !== "produced" || task.artifacts.length === 0) {
      return;
    }
    const artifact = task.artifacts[0];
    const loaded = await this.store.getArtifactBytes(artifact.artifactId);
    if (!loaded) {
      return;
    }
    try {
      assertChecksumMatch({
        expectedSha256: artifact.sha256,
        expectedByteCount: artifact.byteCount,
        actual: loaded.bytes,
      });
    } catch (error) {
      task.errorCode = "EXEC_CHECKSUM_MISMATCH";
      task.errorMessage = error instanceof Error ? error.message : String(error);
      if (task.state === "running" || task.state === "queued") {
        task.state = transitionState(
          task.state,
          task.sideEffectApplied ? "result_unconfirmed" : "failed",
          {
            taskId: task.taskId,
          },
        );
      }
      await this.store.upsertTask(task);
      return;
    }
    if (task.state === "accepted") {
      task.state = transitionState(task.state, "queued", { taskId: task.taskId });
    }
    if (task.state === "queued") {
      task.state = transitionState(task.state, "running", { taskId: task.taskId });
    }
    if (task.state === "running") {
      task.state = transitionState(task.state, "succeeded", { taskId: task.taskId });
      await this.store.upsertTask(task);
    }
  }

  private async queryAfterSubmitTimeout(
    record: ExecTaskRecord,
  ): Promise<ExecTaskRecord | undefined> {
    try {
      const peer = await this.client.status({
        [EXEC_API_VERSION_FIELD]: EXEC_API_VERSION,
        tenantId: record.tenantId,
        idempotencyKey: record.idempotencyKey,
      });
      this.applyPeer(record, peer.payload, { accepted: true });
      if (record.bOutcome === "produced") {
        await this.fetchAndVerifyArtifacts(record);
      }
      await this.store.upsertTask(record);
      return record;
    } catch {
      return undefined;
    }
  }

  private async fetchAndVerifyArtifacts(task: ExecTaskRecord): Promise<void> {
    try {
      for (const artifact of task.artifacts) {
        const result = await this.client.artifact({
          [EXEC_API_VERSION_FIELD]: EXEC_API_VERSION,
          tenantId: task.tenantId,
          taskId: task.taskId,
          artifactId: artifact.artifactId,
          includeBytes: true,
        });
        if (typeof result.payload.bytesBase64 !== "string") {
          throw new ExecProtocolError(
            "EXEC_CHECKSUM_MISMATCH",
            "artifact bytes missing during verification",
            {
              taskId: task.taskId,
            },
          );
        }
        const bytes = decodeBase64Bytes(result.payload.bytesBase64);
        assertChecksumMatch({
          expectedSha256: result.payload.sha256,
          expectedByteCount: result.payload.byteCount,
          actual: bytes,
        });
        await this.store.putArtifactBytes(
          {
            artifactId: artifact.artifactId,
            taskId: task.taskId,
            toolCallId: task.toolCallId,
            tenantId: task.tenantId,
            sha256: normalizeSha256(result.payload.sha256),
            byteCount: result.payload.byteCount,
            fileName: `${artifact.artifactId}.bin`,
          },
          bytes,
        );
      }
    } catch (error) {
      if (isExecProtocolError(error) && error.code === "EXEC_CHECKSUM_MISMATCH") {
        task.errorCode = "EXEC_CHECKSUM_MISMATCH";
        task.errorMessage = error.message;
        if (task.state === "accepted") {
          task.state = transitionState(task.state, "queued", { taskId: task.taskId });
        }
        if (task.state === "queued") {
          task.state = transitionState(task.state, "running", { taskId: task.taskId });
        }
        if (task.state === "running") {
          task.state = transitionState(
            task.state,
            task.sideEffectApplied || task.kind === "side-effect-probe"
              ? "result_unconfirmed"
              : "failed",
            { taskId: task.taskId },
          );
        }
        await this.store.upsertTask(task);
        return;
      }
      throw error;
    }
    await this.tryFinalizeSuccess(task);
  }

  private async refreshFromB(
    task: ExecTaskRecord,
    opts: { allowUnreachable: boolean },
  ): Promise<ExecTaskRecord> {
    this.expireCancelIfNeeded(task);
    if (isTerminalState(task.state) && task.state !== "succeeded") {
      await this.store.upsertTask(task);
      return task;
    }
    try {
      const peer = await this.client.status({
        [EXEC_API_VERSION_FIELD]: EXEC_API_VERSION,
        tenantId: task.tenantId,
        taskId: task.taskId,
      });
      this.applyPeer(task, peer.payload, { accepted: true });
      if (task.bOutcome === "produced") {
        await this.fetchAndVerifyArtifacts(task);
      }
      await this.store.upsertTask(task);
      return task;
    } catch (error) {
      if (isUnreachable(error)) {
        if (!opts.allowUnreachable) {
          throw error;
        }
        await this.store.upsertTask(task);
        return task;
      }
      if (isExecProtocolError(error) && error.code === "EXEC_NOT_FOUND" && !task.bAccepted) {
        return task;
      }
      throw error;
    }
  }

  private async tryStatusFromB(
    tenantId: string,
    taskId: string,
    idempotencyKey: string,
  ): Promise<ExecTaskRecord | undefined> {
    try {
      const peer = await this.client.status({
        [EXEC_API_VERSION_FIELD]: EXEC_API_VERSION,
        tenantId,
        taskId,
        idempotencyKey,
      });
      const local: ExecTaskRecord = {
        taskId: peer.payload.taskId,
        toolCallId: peer.payload.toolCallId,
        tenantId: peer.payload.tenantId,
        subject: this.subject,
        kind: "echo",
        idempotencyKey,
        intentCanonical: "",
        state: peer.payload.state,
        input: { kind: "inline-json", json: {}, sha256: "0".repeat(64), byteCount: 2 },
        createdAt: peer.payload.createdAt,
        updatedAt: peer.payload.updatedAt,
        createdAtMs: Date.parse(peer.payload.createdAt) || this.now(),
        updatedAtMs: Date.parse(peer.payload.updatedAt) || this.now(),
        idempotencyExpiresAtMs: this.now() + this.config.idempotencyTtlMs,
        artifacts: peer.payload.artifacts,
        bAccepted: true,
      };
      await this.store.upsertTask(local);
      return local;
    } catch {
      return undefined;
    }
  }

  private async reconcileTask(task: ExecTaskRecord): Promise<void> {
    try {
      const peer = await this.client.status({
        [EXEC_API_VERSION_FIELD]: EXEC_API_VERSION,
        tenantId: task.tenantId,
        taskId: task.taskId,
      });
      this.applyPeer(task, peer.payload, { accepted: true });
      if (task.bOutcome === "produced") {
        await this.fetchAndVerifyArtifacts(task);
      }
      await this.store.upsertTask(task);
    } catch (error) {
      if (isUnreachable(error)) {
        if (task.state === "running" || task.bSubmitAttempted) {
          if (task.state !== "result_unconfirmed" && !isTerminalState(task.state)) {
            if (task.state === "accepted") {
              task.state = "result_unconfirmed";
            } else {
              task.state = transitionState(task.state, "result_unconfirmed", {
                taskId: task.taskId,
              });
            }
            task.errorMessage = "A' restarted and B' is unreachable; marked pending reconciliation";
            task.updatedAtMs = this.now();
            task.updatedAt = new Date(task.updatedAtMs).toISOString();
            await this.store.upsertTask(task);
          }
        }
        return;
      }
      if (isExecProtocolError(error) && error.code === "EXEC_NOT_FOUND" && !task.bAccepted) {
        return;
      }
    }
  }

  private failChecksum(task: ExecTaskRecord, error: unknown): void {
    task.errorCode = "EXEC_CHECKSUM_MISMATCH";
    task.errorMessage = error instanceof Error ? error.message : String(error);
    const unconfirmed = Boolean(task.sideEffectApplied || task.kind === "side-effect-probe");
    const next = unconfirmed ? "result_unconfirmed" : "failed";
    if (task.state === "accepted") {
      task.state = transitionState(task.state, "queued", { taskId: task.taskId });
    }
    if (task.state === "queued") {
      task.state = transitionState(task.state, "running", { taskId: task.taskId });
    }
    if (task.state === "running") {
      task.state = transitionState(task.state, next, { taskId: task.taskId });
    }
  }

  private expireCancelIfNeeded(task: ExecTaskRecord): void {
    if (task.state !== "cancel_requested" || task.cancelRequestedAtMs === undefined) {
      return;
    }
    if (this.now() - task.cancelRequestedAtMs <= this.config.cancelDeadlineMs) {
      return;
    }
    task.state = transitionState(task.state, "result_unconfirmed", { taskId: task.taskId });
    task.errorMessage = "cancel deadline exceeded before B' confirmed stop";
    task.updatedAtMs = this.now();
    task.updatedAt = new Date(task.updatedAtMs).toISOString();
  }
}

function isUnreachable(error: unknown): boolean {
  return isExecProtocolError(error) && error.code === "EXEC_UNREACHABLE";
}

function requireField(payload: Record<string, unknown>, field: string): string {
  const value = payload[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new ExecProtocolError("EXEC_INTERNAL", `missing required field ${field}`);
  }
  return value;
}

function optionalField(payload: Record<string, unknown>, field: string): string | undefined {
  const value = payload[field];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new ExecProtocolError("EXEC_INTERNAL", `${field} must be a string`);
  }
  return value;
}

function optionalNum(payload: Record<string, unknown>, field: string): number | undefined {
  const value = payload[field];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ExecProtocolError("EXEC_INTERNAL", `${field} must be a number`);
  }
  return value;
}

function matchesScope(
  scope: ExecRevocation,
  task: { tenantId: string; subject: string; taskId?: string },
): boolean {
  if (scope.taskId && scope.taskId !== task.taskId) {
    return false;
  }
  if (scope.tenantId && scope.tenantId !== task.tenantId) {
    return false;
  }
  if (scope.subject && scope.subject !== task.subject) {
    return false;
  }
  return Boolean(scope.taskId || scope.tenantId || scope.subject);
}
