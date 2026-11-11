import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { assertChecksumMatch, decodeBase64Bytes, encodeInlineJsonBytes } from "./checksum.js";
import type { ExecProtocolConfig } from "./config.js";
import { ExecProtocolError, isExecProtocolError } from "./errors.js";
import { defaultExecutorRuntime, runIsolationTask, type ExecutorRuntime } from "./executor.js";
import {
  assertExecApiVersion,
  hasJsonContentType,
  optionalBoolean,
  optionalNumber,
  optionalString,
  parseJsonObject,
  readRequestBody,
  requiredString,
  writeJson,
  writeProtocolError,
} from "./http-json.js";
import { assertIdempotencyKey, canonicalizeIntent } from "./idempotency.js";
import { newArtifactId, newTaskId } from "./ids.js";
import { KeyedLock } from "./keyed-lock.js";
import { hashLeaseToken, parseBearerToken, validateLease } from "./lease.js";
import {
  assertIdenticalApplyReplay,
  conclusionDigest,
  digestForReconcileRequest,
  evidenceKey,
  isClosingReconcileConclusion,
  parseReconcileRequest,
  toReconcileResponse,
} from "./reconcile.js";
import { reconcileTransition, transitionState } from "./state-machine.js";
import { FileExecStore } from "./store.js";
import {
  isTerminalState,
  type ExecInput,
  type ExecLeaseRecord,
  type ExecRevocation,
  type ExecSiteDebug,
  type ExecTaskKind,
  type ExecTaskRecord,
  type ExecTaskResponse,
  type HostCommandProbe,
  EXEC_API_VERSION,
  EXEC_API_VERSION_FIELD,
  ROLE_EXECUTION_SITE,
  SUCCESS_HTTP_IDEMPOTENT_OR_READ,
  SUCCESS_HTTP_NEW_ACCEPT,
} from "./types.js";

export type BServerOptions = {
  config: ExecProtocolConfig;
  store: FileExecStore;
  maxRequestBodyBytes: number;
  runtime?: ExecutorRuntime;
  now?: () => number;
  hostCommandProbe?: HostCommandProbe;
  autoStartExecution?: boolean;
};

const TASK_KINDS: ReadonlySet<ExecTaskKind> = new Set([
  "echo",
  "sleep",
  "fail",
  "side-effect-probe",
  "corrupt-checksum",
  "ignore-cancel",
]);

function isTaskKind(value: string): value is ExecTaskKind {
  return TASK_KINDS.has(value as ExecTaskKind);
}

function matchesRevocation(
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

export class BExecutionServer {
  readonly role = ROLE_EXECUTION_SITE;
  readonly config: ExecProtocolConfig;
  readonly store: FileExecStore;
  readonly maxRequestBodyBytes: number;
  private readonly runtime: ExecutorRuntime;
  private readonly now: () => number;
  private server: Server | undefined;
  private address: { host: string; port: number } | undefined;
  private readonly abortControllers = new Map<string, AbortController>();
  private readonly running = new Map<string, Promise<void>>();
  private executionsStarted = 0;
  private readonly hostCommandProbe?: HostCommandProbe;
  private readonly autoStartExecution: boolean;
  private shuttingDown = false;
  private readonly submitLocks = new KeyedLock();
  private dropReconcileApplyResponsesRemaining = 0;

  constructor(options: BServerOptions) {
    this.config = options.config;
    this.store = options.store;
    this.maxRequestBodyBytes = options.maxRequestBodyBytes;
    this.runtime = options.runtime ?? defaultExecutorRuntime();
    this.now = options.now ?? options.runtime?.now ?? (() => Date.now());
    this.hostCommandProbe = options.hostCommandProbe;
    this.autoStartExecution = options.autoStartExecution !== false;
  }

  async start(): Promise<{ host: string; port: number }> {
    await this.store.load();
    try {
      await this.reconcileAfterRestart();
      const server = createServer((req, res) => {
        void this.handle(req, res);
      });
      this.server = server;
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(this.config.port, this.config.bind, () => resolve());
      });
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        throw new ExecProtocolError("EXEC_INTERNAL", "B' server failed to bind a TCP port");
      }
      this.address = { host: addr.address, port: addr.port };
      return this.address;
    } catch (error) {
      this.server = undefined;
      this.address = undefined;
      await this.store.close();
      throw error;
    }
  }

  dropNextReconcileApplyResponses(count = 1): void {
    if (!Number.isInteger(count) || count <= 0) {
      throw new Error("dropNextReconcileApplyResponses count must be a positive integer");
    }
    this.dropReconcileApplyResponsesRemaining += count;
  }

  get listenAddress(): { host: string; port: number } {
    if (!this.address) {
      throw new ExecProtocolError("EXEC_INTERNAL", "B' server is not listening");
    }
    return this.address;
  }

  get baseUrl(): string {
    const addr = this.listenAddress;
    const bind = this.config.bind === "localhost" ? "127.0.0.1" : this.config.bind;
    const host = bind.includes(":") ? `[${bind}]` : bind;
    return `http://${host}:${addr.port}`;
  }

  async stop(): Promise<void> {
    this.shuttingDown = true;
    for (const controller of this.abortControllers.values()) {
      controller.abort();
    }
    const running = [...this.running.values()];
    await Promise.allSettled(running);
    const server = this.server;
    this.server = undefined;
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
    await this.store.close();
  }

  debug(): ExecSiteDebug {
    return {
      role: ROLE_EXECUTION_SITE,
      executionsStarted: this.executionsStarted,
      hostCommands: this.hostCommandProbe?.calls.length ?? 0,
      probes: { ...this.store.data().probes },
    };
  }

  async registerLease(record: ExecLeaseRecord): Promise<void> {
    await this.store.putLease(record);
  }

  private async reconcileAfterRestart(): Promise<void> {
    for (const task of this.store.listTasks()) {
      if (
        task.state === "running" ||
        task.state === "queued" ||
        task.state === "cancel_requested"
      ) {
        if (task.sideEffectApplied || task.kind === "side-effect-probe") {
          task.state = transitionState(
            task.state === "queued" ? "queued" : task.state,
            "result_unconfirmed",
            {
              taskId: task.taskId,
            },
          );
          task.bOutcome = "unconfirmed";
          task.errorMessage =
            "B' restarted while execution was in progress; side-effect is not replayed";
          task.updatedAtMs = this.now();
          task.updatedAt = new Date(task.updatedAtMs).toISOString();
          await this.store.upsertTask(task);
          continue;
        }
        if (task.state === "running" || task.state === "queued") {
          task.state = transitionState(task.state, "failed", { taskId: task.taskId });
          task.bOutcome = "failed";
          task.errorMessage =
            "B' restarted before execution completed; no external side effect was recorded";
          task.updatedAtMs = this.now();
          task.updatedAt = new Date(task.updatedAtMs).toISOString();
          await this.store.upsertTask(task);
        }
      }
    }
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const method = req.method ?? "GET";
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (method !== "POST") {
        throw new ExecProtocolError(
          "EXEC_INTERNAL",
          "isolation protocol routes accept POST JSON only",
        );
      }
      if (!hasJsonContentType(req.headers["content-type"])) {
        throw new ExecProtocolError(
          "EXEC_INTERNAL",
          "Content-Type must be application/json; charset=utf-8",
        );
      }
      const body = await readRequestBody(
        req,
        this.maxRequestBodyBytes,
        this.config.requestTimeoutMs,
      );
      const payload = parseJsonObject(body);
      assertExecApiVersion(payload);

      const token = parseBearerToken(req.headers.authorization);
      const hash = token && hashLeaseToken(token);
      const leaseRecord = hash ? this.store.getLeaseByHash(hash) : undefined;
      const tenantHint = optionalString(payload, "tenantId");
      const lease = validateLease({
        token,
        record: leaseRecord,
        nowMs: this.now(),
        config: this.config,
        requestTenantId: tenantHint,
      });

      const path = url.pathname.replace(/\/+$/, "") || "/";
      if (path === "/v1/tasks") {
        await this.handleSubmit(payload, lease, res);
        return;
      }
      if (path === "/v1/tasks/status") {
        this.handleStatus(payload, lease, res);
        return;
      }
      if (path === "/v1/tasks/cancel") {
        await this.handleCancel(payload, lease, res);
        return;
      }
      if (path === "/v1/tasks/artifact") {
        await this.handleArtifact(payload, lease, res);
        return;
      }
      if (path === "/v1/artifacts/upload") {
        await this.handleUpload(payload, lease, res);
        return;
      }
      if (path === "/v1/tasks/reconcile-apply") {
        await this.handleReconcileApply(payload, lease, res);
        return;
      }
      if (path === "/v1/revoke") {
        await this.handleRevoke(payload, lease, res);
        return;
      }
      if (path === "/v1/debug/site") {
        writeJson(res, SUCCESS_HTTP_IDEMPOTENT_OR_READ, {
          [EXEC_API_VERSION_FIELD]: EXEC_API_VERSION,
          ...this.debug(),
        });
        return;
      }
      throw new ExecProtocolError("EXEC_NOT_FOUND", "unknown protocol route");
    } catch (error) {
      if (isExecProtocolError(error)) {
        const includeTask =
          error.code !== "EXEC_UNAUTHORIZED" && error.code !== "EXEC_VERSION_UNSUPPORTED";
        writeProtocolError(res, error, { includeTask });
        return;
      }
      writeProtocolError(
        res,
        new ExecProtocolError(
          "EXEC_INTERNAL",
          error instanceof Error ? error.message : String(error),
        ),
      );
    }
  }

  private assertNotRevoked(scope: { tenantId: string; subject: string; taskId?: string }): void {
    for (const revocation of this.store.listRevocations()) {
      if (matchesRevocation(revocation, scope)) {
        throw new ExecProtocolError("EXEC_REVOKED", "execution authorization has been revoked", {
          taskId: scope.taskId,
        });
      }
    }
  }

  private authorizeTask(
    task: ExecTaskRecord | undefined,
    lease: ExecLeaseRecord,
    tenantId: string,
  ): ExecTaskRecord {
    if (!task || task.tenantId !== tenantId) {
      throw new ExecProtocolError("EXEC_NOT_FOUND", "task not found");
    }
    if (lease.tenantId && task.tenantId !== lease.tenantId) {
      throw new ExecProtocolError("EXEC_NOT_FOUND", "task not found");
    }
    return task;
  }

  private async handleSubmit(
    payload: Record<string, unknown>,
    lease: ExecLeaseRecord,
    res: ServerResponse,
  ): Promise<void> {
    const tenantId = requiredString(payload, "tenantId");
    const toolCallId = requiredString(payload, "toolCallId");
    const kindRaw = requiredString(payload, "kind");
    if (!isTaskKind(kindRaw)) {
      throw new ExecProtocolError("EXEC_INTERNAL", "unsupported isolation task kind");
    }
    const key = assertIdempotencyKey(payload.idempotencyKey, this.config);
    const input = parseInput(payload.input);
    const probeId = optionalString(payload, "probeId");
    const sleepMs = optionalNumber(payload, "sleepMs");
    const subject = optionalString(payload, "subject") ?? lease.subject;
    this.assertNotRevoked({ tenantId, subject });

    if (input.kind === "inline-json") {
      assertChecksumMatch({
        expectedSha256: input.sha256,
        expectedByteCount: input.byteCount,
        actual: encodeInlineJsonBytes(input.json),
      });
    } else if (input.kind === "inline-bytes") {
      assertChecksumMatch({
        expectedSha256: input.sha256,
        expectedByteCount: input.byteCount,
        actual: decodeBase64Bytes(input.bytesBase64),
      });
    } else if (!this.store.getArtifactMeta(input.artifactId)) {
      throw new ExecProtocolError("EXEC_NOT_FOUND", "input artifactId was not uploaded on B'");
    }

    const intentCanonical = canonicalizeIntent({
      tenantId,
      toolCallId,
      kind: kindRaw,
      input,
      probeId,
      sleepMs,
    });
    await this.submitLocks.run(`${tenantId}\0${key}`, () =>
      this.handleSubmitSerialized({
        payload,
        lease,
        tenantId,
        toolCallId,
        kindRaw,
        key,
        input,
        probeId,
        sleepMs,
        subject,
        intentCanonical,
        res,
      }),
    );
  }

  private async handleSubmitSerialized(params: {
    payload: Record<string, unknown>;
    lease: ExecLeaseRecord;
    tenantId: string;
    toolCallId: string;
    kindRaw: ExecTaskKind;
    key: string;
    input: ExecInput;
    probeId?: string;
    sleepMs?: number;
    subject: string;
    intentCanonical: string;
    res: ServerResponse;
  }): Promise<void> {
    const {
      payload,
      tenantId,
      toolCallId,
      kindRaw,
      key,
      input,
      probeId,
      sleepMs,
      subject,
      intentCanonical,
      res,
    } = params;
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
        writeJson(
          res,
          SUCCESS_HTTP_IDEMPOTENT_OR_READ,
          toTaskResponse(existingTask ?? missingTask(existing.taskId, tenantId)),
        );
        return;
      }
      if (!existingTask || !isTerminalState(existingTask.state)) {
        throw new ExecProtocolError(
          "EXEC_CONFLICT",
          "idempotency key expired but the original task is not terminal",
          { taskId: existing.taskId, state: existingTask?.state },
        );
      }
    }

    const requestedTaskId = optionalString(payload, "taskId");
    if (requestedTaskId && this.store.getTask(requestedTaskId)) {
      throw new ExecProtocolError("EXEC_CONFLICT", "taskId already exists on B'", {
        taskId: requestedTaskId,
      });
    }
    const taskId = requestedTaskId ?? newTaskId();
    const record: ExecTaskRecord = {
      taskId,
      toolCallId,
      tenantId,
      userId: optionalString(payload, "userId"),
      agentId: optionalString(payload, "agentId"),
      subject,
      kind: kindRaw,
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
      bAccepted: true,
      stateVersion: 1,
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
    record.state = transitionState(record.state, "queued", { taskId });
    record.updatedAtMs = this.now();
    record.updatedAt = new Date(record.updatedAtMs).toISOString();
    await this.store.upsertTask(record);
    if (this.autoStartExecution) {
      this.scheduleExecution(record.taskId);
    }
    writeJson(res, SUCCESS_HTTP_NEW_ACCEPT, toTaskResponse(record));
  }

  private handleStatus(
    payload: Record<string, unknown>,
    lease: ExecLeaseRecord,
    res: ServerResponse,
  ): void {
    const tenantId = requiredString(payload, "tenantId");
    const task = this.lookupTask(payload, lease, tenantId);
    this.expireCancelIfNeeded(task);
    writeJson(res, SUCCESS_HTTP_IDEMPOTENT_OR_READ, toTaskResponse(task));
  }

  private async handleCancel(
    payload: Record<string, unknown>,
    lease: ExecLeaseRecord,
    res: ServerResponse,
  ): Promise<void> {
    const tenantId = requiredString(payload, "tenantId");
    const taskId = requiredString(payload, "taskId");
    const task = this.authorizeTask(this.store.getTask(taskId), lease, tenantId);
    if (isTerminalState(task.state) || task.state === "result_unconfirmed") {
      writeJson(res, SUCCESS_HTTP_IDEMPOTENT_OR_READ, toTaskResponse(task));
      return;
    }
    if (task.state !== "cancel_requested") {
      task.state = transitionState(task.state, "cancel_requested", { taskId: task.taskId });
      task.cancelRequestedAtMs = this.now();
      task.updatedAtMs = task.cancelRequestedAtMs;
      task.updatedAt = new Date(task.updatedAtMs).toISOString();
      await this.store.upsertTask(task);
    }
    if (task.kind !== "ignore-cancel") {
      this.abortControllers.get(task.taskId)?.abort();
    }
    writeJson(res, SUCCESS_HTTP_IDEMPOTENT_OR_READ, toTaskResponse(task));
  }

  private async handleArtifact(
    payload: Record<string, unknown>,
    lease: ExecLeaseRecord,
    res: ServerResponse,
  ): Promise<void> {
    const tenantId = requiredString(payload, "tenantId");
    const taskId = requiredString(payload, "taskId");
    const artifactId = requiredString(payload, "artifactId");
    const includeBytes = optionalBoolean(payload, "includeBytes") ?? false;
    const task = this.authorizeTask(this.store.getTask(taskId), lease, tenantId);
    const loaded = await this.store.getArtifactBytes(artifactId);
    if (!loaded || loaded.meta.taskId !== task.taskId || loaded.meta.tenantId !== tenantId) {
      throw new ExecProtocolError("EXEC_NOT_FOUND", "artifact not found", { taskId });
    }
    writeJson(res, SUCCESS_HTTP_IDEMPOTENT_OR_READ, {
      [EXEC_API_VERSION_FIELD]: EXEC_API_VERSION,
      taskId: task.taskId,
      toolCallId: task.toolCallId,
      artifactId,
      sha256: loaded.meta.sha256,
      byteCount: loaded.meta.byteCount,
      delivered: false,
      ...(includeBytes ? { bytesBase64: loaded.bytes.toString("base64") } : {}),
    });
  }

  private async handleUpload(
    payload: Record<string, unknown>,
    lease: ExecLeaseRecord,
    res: ServerResponse,
  ): Promise<void> {
    const tenantId = requiredString(payload, "tenantId");
    this.assertNotRevoked({ tenantId, subject: lease.subject });
    const bytesBase64 = requiredString(payload, "bytesBase64");
    const sha256 = requiredString(payload, "sha256");
    const byteCount = optionalNumber(payload, "byteCount");
    if (byteCount === undefined) {
      throw new ExecProtocolError("EXEC_INTERNAL", "missing required field byteCount");
    }
    const bytes = decodeBase64Bytes(bytesBase64);
    const checked = assertChecksumMatch({
      expectedSha256: sha256,
      expectedByteCount: byteCount,
      actual: bytes,
    });
    const artifactId = newArtifactId();
    await this.store.putArtifactBytes(
      {
        artifactId,
        taskId: "",
        toolCallId: "",
        tenantId,
        sha256: checked.sha256,
        byteCount: checked.byteCount,
        fileName: `${artifactId}.bin`,
      },
      bytes,
    );
    writeJson(res, SUCCESS_HTTP_NEW_ACCEPT, {
      [EXEC_API_VERSION_FIELD]: EXEC_API_VERSION,
      artifactId,
      sha256: checked.sha256,
      byteCount: checked.byteCount,
    });
  }

  private async handleReconcileApply(
    payload: Record<string, unknown>,
    lease: ExecLeaseRecord,
    res: ServerResponse,
  ): Promise<void> {
    const request = parseReconcileRequest(payload, this.config);
    const requestDigest = digestForReconcileRequest(request);
    const existing = this.store.getReconcileIndex(request.tenantId, request.reconcileRequestId);
    if (existing) {
      const storedDigest =
        existing.conclusionDigest ||
        conclusionDigest({
          taskId: existing.taskId,
          conclusion: existing.conclusion,
          evidenceKey: existing.evidenceKey,
        });
      // Identity is reconcileRequestId + conclusion digest. Do not compare
      // request.expectedStateVersion (A's CAS identity) to B.stateVersion.
      assertIdenticalApplyReplay({
        stored: { taskId: existing.taskId, conclusionDigest: storedDigest },
        request: { taskId: request.taskId, conclusionDigest: requestDigest },
      });
      const existingTask = this.authorizeTask(
        this.store.getTask(existing.taskId),
        lease,
        request.tenantId,
      );
      this.writeReconcileApplyResponse(
        res,
        toReconcileResponse({
          task: existingTask,
          audit: {
            reconcileRequestId: existing.reconcileRequestId,
            operator: existing.operator,
            at: existing.at,
            previousState: existing.previousState as ExecTaskRecord["state"],
            newState: existing.newState as ExecTaskRecord["state"],
            conclusion: request.conclusion,
            reason: existing.reason,
          },
          conclusionDigest: storedDigest,
          applyConfirmed: true,
        }),
      );
      return;
    }

    const stored = this.authorizeTask(this.store.getTask(request.taskId), lease, request.tenantId);
    const task = structuredClone(stored);
    this.assertNoOutOfOrderClosingApply(task, request);
    if (isTerminalState(task.state)) {
      if (request.conclusion !== "remain_unconfirmed" && task.state === request.conclusion) {
        this.writeReconcileApplyResponse(
          res,
          toReconcileResponse({
            task,
            audit: {
              reconcileRequestId: request.reconcileRequestId,
              operator: lease.subject,
              at: task.updatedAt,
              previousState: task.state,
              newState: task.state,
              conclusion: request.conclusion,
              reason: request.reason,
            },
            conclusionDigest: requestDigest,
            applyConfirmed: true,
          }),
        );
        return;
      }
      throw new ExecProtocolError(
        "EXEC_CONFLICT",
        `B' will not overwrite terminal state ${task.state}`,
        { taskId: task.taskId, state: task.state },
      );
    }
    if (task.state !== "result_unconfirmed") {
      throw new ExecProtocolError(
        "EXEC_CONFLICT",
        "B' reconcile-apply requires local state result_unconfirmed",
        { taskId: task.taskId, state: task.state },
      );
    }
    if (request.conclusion === "succeeded") {
      if (request.evidenceRef.kind !== "artifact-verified") {
        throw new ExecProtocolError(
          "EXEC_CONFLICT",
          "succeeded requires evidenceRef.kind artifact-verified",
          { taskId: task.taskId, state: task.state },
        );
      }
      const loaded = await this.store.getArtifactBytes(request.evidenceRef.artifactId);
      if (!loaded) {
        throw new ExecProtocolError(
          "EXEC_CONFLICT",
          "B' has no local artifact bytes to verify for succeeded",
          { taskId: task.taskId, state: task.state },
        );
      }
      if (loaded.meta.taskId !== task.taskId || loaded.meta.tenantId !== task.tenantId) {
        throw new ExecProtocolError("EXEC_CONFLICT", "artifact does not belong to this task", {
          taskId: task.taskId,
          state: task.state,
        });
      }
      try {
        assertChecksumMatch({
          expectedSha256: request.evidenceRef.sha256,
          expectedByteCount: request.evidenceRef.byteCount,
          actual: loaded.bytes,
        });
      } catch (error) {
        throw new ExecProtocolError(
          "EXEC_CHECKSUM_MISMATCH",
          error instanceof Error ? error.message : "checksum mismatch",
          { taskId: task.taskId, state: task.state },
        );
      }
    }

    const previousState = task.state;
    const previousStateVersion = task.stateVersion ?? 0;
    const nowMs = this.now();
    const newState = reconcileTransition(task.state, request.conclusion, { taskId: task.taskId });
    task.state = newState;
    task.updatedAtMs = nowMs;
    task.updatedAt = new Date(nowMs).toISOString();
    const audit = {
      taskId: task.taskId,
      tenantId: task.tenantId,
      operator: lease.subject,
      at: task.updatedAt,
      atMs: nowMs,
      previousState,
      newState,
      conclusion: request.conclusion,
      reason: request.reason,
      evidenceRef: request.evidenceRef,
      reconcileRequestId: request.reconcileRequestId,
      previousStateVersion,
      newStateVersion: previousStateVersion,
    };
    const index = {
      tenantId: request.tenantId,
      reconcileRequestId: request.reconcileRequestId,
      taskId: request.taskId,
      conclusion: request.conclusion,
      expectedStateVersion: request.expectedStateVersion,
      evidenceKey: evidenceKey(request.evidenceRef),
      conclusionDigest: requestDigest,
      operator: lease.subject,
      at: task.updatedAt,
      atMs: nowMs,
      previousState,
      newState,
      reason: request.reason,
      previousStateVersion,
      newStateVersion: previousStateVersion,
    };
    await this.store.commitReconcile({ task, audit, index });
    this.writeReconcileApplyResponse(
      res,
      toReconcileResponse({
        task,
        audit,
        conclusionDigest: requestDigest,
        applyConfirmed: true,
      }),
    );
  }

  private writeReconcileApplyResponse(res: ServerResponse, body: unknown): void {
    if (this.dropReconcileApplyResponsesRemaining > 0) {
      this.dropReconcileApplyResponsesRemaining -= 1;
      res.destroy();
      return;
    }
    writeJson(res, SUCCESS_HTTP_IDEMPOTENT_OR_READ, body);
  }

  private assertNoOutOfOrderClosingApply(
    task: ExecTaskRecord,
    request: ReturnType<typeof parseReconcileRequest>,
  ): void {
    const prior = this.store
      .listReconcileAudits(task.taskId)
      .find((entry) => isClosingReconcileConclusion(entry.conclusion));
    if (!prior) {
      return;
    }
    if (prior.reconcileRequestId === request.reconcileRequestId) {
      return;
    }
    throw new ExecProtocolError(
      "EXEC_CONFLICT",
      "B' rejected a stale, out-of-order, or conflicting reconcile-apply based on local preconditions",
      { taskId: task.taskId, state: task.state },
    );
  }

  private async handleRevoke(
    payload: Record<string, unknown>,
    lease: ExecLeaseRecord,
    res: ServerResponse,
  ): Promise<void> {
    const nowMs = this.now();
    const revocation: ExecRevocation = {
      tenantId: optionalString(payload, "tenantId"),
      subject: optionalString(payload, "subject"),
      taskId: optionalString(payload, "taskId"),
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
    const affected = this.store.listTasks().filter((task) => matchesRevocation(revocation, task));
    for (const task of affected) {
      if (
        isTerminalState(task.state) ||
        task.state === "result_unconfirmed" ||
        task.state === "cancel_requested"
      ) {
        continue;
      }
      task.state = transitionState(task.state, "cancel_requested", { taskId: task.taskId });
      task.cancelRequestedAtMs = nowMs;
      task.updatedAtMs = nowMs;
      task.updatedAt = new Date(nowMs).toISOString();
      await this.store.upsertTask(task);
      if (task.kind !== "ignore-cancel") {
        this.abortControllers.get(task.taskId)?.abort();
      }
    }
    writeJson(res, SUCCESS_HTTP_IDEMPOTENT_OR_READ, {
      [EXEC_API_VERSION_FIELD]: EXEC_API_VERSION,
      revoked: true,
      subject: lease.subject,
    });
  }

  private lookupTask(
    payload: Record<string, unknown>,
    lease: ExecLeaseRecord,
    tenantId: string,
  ): ExecTaskRecord {
    const taskId = optionalString(payload, "taskId");
    const idempotencyKey = optionalString(payload, "idempotencyKey");
    if (!taskId && !idempotencyKey) {
      throw new ExecProtocolError("EXEC_INTERNAL", "status requires taskId or idempotencyKey");
    }
    if (taskId) {
      return this.authorizeTask(this.store.getTask(taskId), lease, tenantId);
    }
    const index = this.store.getIdempotency(tenantId, idempotencyKey as string);
    return this.authorizeTask(
      index ? this.store.getTask(index.taskId) : undefined,
      lease,
      tenantId,
    );
  }

  private expireCancelIfNeeded(task: ExecTaskRecord): void {
    if (task.state !== "cancel_requested" || task.cancelRequestedAtMs === undefined) {
      return;
    }
    if (this.now() - task.cancelRequestedAtMs <= this.config.cancelDeadlineMs) {
      return;
    }
    if (this.abortControllers.has(task.taskId)) {
      task.state = transitionState(task.state, "result_unconfirmed", { taskId: task.taskId });
      task.bOutcome = "unconfirmed";
      task.errorMessage = "cancel deadline exceeded before B' confirmed stop";
      task.updatedAtMs = this.now();
      task.updatedAt = new Date(task.updatedAtMs).toISOString();
      void this.store.upsertTask(task);
    }
  }

  startQueued(taskId: string): void {
    this.scheduleExecution(taskId);
  }

  private scheduleExecution(taskId: string): void {
    if (this.running.has(taskId)) {
      return;
    }
    const work = this.execute(taskId).finally(() => {
      this.running.delete(taskId);
      this.abortControllers.delete(taskId);
    });
    this.running.set(taskId, work);
  }

  private async execute(taskId: string): Promise<void> {
    const task = this.store.getTask(taskId);
    if (!task) {
      return;
    }
    if (task.state !== "queued") {
      return;
    }
    if (
      this.store
        .listReconcileAudits(taskId)
        .some((entry) => isClosingReconcileConclusion(entry.conclusion))
    ) {
      return;
    }
    const controller = new AbortController();
    this.abortControllers.set(taskId, controller);
    task.state = transitionState(task.state, "running", { taskId });
    task.executionStartedAtMs = this.now();
    task.updatedAtMs = task.executionStartedAtMs;
    task.updatedAt = new Date(task.updatedAtMs).toISOString();
    this.executionsStarted += 1;
    await this.store.appendJournal({
      atMs: task.updatedAtMs,
      at: task.updatedAt,
      taskId,
      role: ROLE_EXECUTION_SITE,
      event: "execution-started",
    });
    await this.store.upsertTask(task);

    const result = await runIsolationTask({
      task,
      store: this.store,
      config: this.config,
      runtime: this.runtime,
      signal: controller.signal,
    });

    const latest = this.store.getTask(taskId);
    if (!latest) {
      return;
    }
    if (result.artifact) {
      const reportedSha = result.artifact.sha256;
      const reportedBytes = result.artifact.byteCount;
      await this.store.putArtifactBytes(
        {
          artifactId: result.artifact.artifactId,
          taskId: latest.taskId,
          toolCallId: latest.toolCallId,
          tenantId: latest.tenantId,
          sha256: reportedSha,
          byteCount: reportedBytes,
          fileName: `${result.artifact.artifactId}.bin`,
        },
        result.artifact.bytes,
      );
      latest.artifacts = [
        {
          artifactId: result.artifact.artifactId,
          sha256: reportedSha,
          byteCount: reportedBytes,
          toolCallId: latest.toolCallId,
          taskId: latest.taskId,
        },
      ];
    }
    latest.sideEffectApplied = result.sideEffectApplied ?? latest.sideEffectApplied;
    latest.errorMessage = result.errorMessage;
    latest.updatedAtMs = this.now();
    latest.updatedAt = new Date(latest.updatedAtMs).toISOString();

    if (this.shuttingDown) {
      if (latest.sideEffectApplied || latest.kind === "side-effect-probe") {
        if (latest.state !== "result_unconfirmed" && !isTerminalState(latest.state)) {
          if (latest.state === "accepted") {
            latest.state = "result_unconfirmed";
          } else {
            latest.state = transitionState(latest.state, "result_unconfirmed", { taskId });
          }
        }
        latest.bOutcome = "unconfirmed";
        latest.errorMessage = "B' stopped during execution; side-effect is not replayed";
      } else if (!isTerminalState(latest.state) && latest.state !== "result_unconfirmed") {
        latest.errorMessage = "B' stopped during execution; awaiting reconciliation";
      }
      await this.store.upsertTask(latest);
      return;
    }

    if (latest.state === "cancel_requested" || result.outcome === "cancelled") {
      if (latest.state !== "cancel_requested") {
        latest.state = transitionState(latest.state, "cancel_requested", { taskId });
      }
      latest.state = transitionState(latest.state, "cancelled", { taskId });
      latest.bOutcome = "cancelled";
      await this.store.upsertTask(latest);
      return;
    }

    if (result.outcome === "produced") {
      latest.bOutcome = "produced";
      await this.store.upsertTask(latest);
      return;
    }
    if (result.outcome === "unconfirmed") {
      latest.state = transitionState(latest.state, "result_unconfirmed", { taskId });
      latest.bOutcome = "unconfirmed";
      await this.store.upsertTask(latest);
      return;
    }
    if (result.outcome === "timeout") {
      latest.state = transitionState(
        latest.state,
        latest.sideEffectApplied ? "result_unconfirmed" : "failed",
        { taskId },
      );
      latest.bOutcome = latest.sideEffectApplied ? "unconfirmed" : "timeout";
      latest.errorMessage = result.errorMessage ?? "execution timeout";
      await this.store.upsertTask(latest);
      return;
    }
    latest.state = transitionState(latest.state, "failed", { taskId });
    latest.bOutcome = "failed";
    await this.store.upsertTask(latest);
  }
}

function parseInput(raw: unknown): ExecInput {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ExecProtocolError("EXEC_INTERNAL", "missing required field input");
  }
  const input = raw as Record<string, unknown>;
  const kind = input.kind;
  if (kind === "inline-json") {
    if (!Object.hasOwn(input, "json")) {
      throw new ExecProtocolError("EXEC_INTERNAL", "missing required field input.json");
    }
    const sha256 = requiredFrom(input, "sha256");
    const byteCount = input.byteCount;
    if (typeof byteCount !== "number") {
      throw new ExecProtocolError("EXEC_INTERNAL", "missing required field input.byteCount");
    }
    return { kind: "inline-json", json: input.json, sha256, byteCount };
  }
  if (kind === "inline-bytes") {
    return {
      kind: "inline-bytes",
      bytesBase64: requiredFrom(input, "bytesBase64"),
      sha256: requiredFrom(input, "sha256"),
      byteCount: requireNumber(input, "byteCount"),
    };
  }
  if (kind === "artifact") {
    return { kind: "artifact", artifactId: requiredFrom(input, "artifactId") };
  }
  throw new ExecProtocolError(
    "EXEC_INTERNAL",
    "input.kind must be inline-json, inline-bytes, or artifact",
  );
}

function requiredFrom(input: Record<string, unknown>, field: string): string {
  const value = input[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new ExecProtocolError("EXEC_INTERNAL", `missing required field input.${field}`);
  }
  return value;
}

function requireNumber(input: Record<string, unknown>, field: string): number {
  const value = input[field];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ExecProtocolError("EXEC_INTERNAL", `missing required field input.${field}`);
  }
  return value;
}

export function toTaskResponse(task: ExecTaskRecord): ExecTaskResponse {
  return {
    [EXEC_API_VERSION_FIELD]: EXEC_API_VERSION,
    taskId: task.taskId,
    toolCallId: task.toolCallId,
    tenantId: task.tenantId,
    state: task.state,
    artifacts: task.artifacts,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    errorCode: task.errorCode,
    errorMessage: task.errorMessage,
    bOutcome: task.bOutcome,
    stateVersion: task.stateVersion ?? 0,
    sideEffectApplied: task.sideEffectApplied,
  };
}

function missingTask(taskId: string, tenantId: string): ExecTaskRecord {
  const now = new Date(0).toISOString();
  return {
    taskId,
    toolCallId: "",
    tenantId,
    subject: "",
    kind: "echo",
    idempotencyKey: "missing-idempotency",
    intentCanonical: "",
    state: "failed",
    input: { kind: "inline-json", json: {}, sha256: "0".repeat(64), byteCount: 0 },
    createdAt: now,
    updatedAt: now,
    createdAtMs: 0,
    updatedAtMs: 0,
    idempotencyExpiresAtMs: 0,
    artifacts: [],
    errorCode: "EXEC_INTERNAL",
    errorMessage: "idempotent hit is missing its task record",
    stateVersion: 0,
  };
}

export { parseInput, matchesRevocation };
