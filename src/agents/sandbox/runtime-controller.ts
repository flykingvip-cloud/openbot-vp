/**
 * Runtime Controller (v4.1 §9 gate 4).
 *
 * Gateway may request start, stop, inspect, attach, or reclaim. The body is a
 * lease id plus the trusted scope. Image, mounts, env, volumes, hostPath, and
 * docker settings are rejected. The container spec is built from the lease.
 */

import type { OpenBotConfig } from "../../config/types.js";
import { resolveAccountExecutionPaths } from "../../gateway/account-execution-paths.js";
import { normalizeAgentId } from "../../routing/session-key.js";
import { buildAccountSandboxMountPlan, type AccountMount } from "./account-mounts.js";
import { resolveSharedAccountMountDirs } from "./account-shared-mounts.js";

export const RUNTIME_CONTROLLER_ACTIONS = [
  "start",
  "stop",
  "inspect",
  "attach",
  "reclaim",
] as const;

export type RuntimeControllerAction = (typeof RUNTIME_CONTROLLER_ACTIONS)[number];

export const RUNTIME_CONTROLLER_FORBIDDEN_FIELDS = [
  "image",
  "mounts",
  "mount",
  "env",
  "environment",
  "volumes",
  "volume",
  "hostpath",
  "docker",
  "binds",
  "bind",
  "capadd",
  "network",
  "privileged",
  "entrypoint",
  "cmd",
  "workdir",
  "devices",
  "runtime",
  "pid",
  "ipc",
  "securityopt",
  "sysctls",
] as const;

const REQUEST_FIELDS = new Set([
  "action",
  "runtimeLeaseId",
  "tenantId",
  "userId",
  "agentId",
  "snapshotVersion",
]);

const LEASE_FIELDS = new Set([
  "runtimeLeaseId",
  "tenantId",
  "userId",
  "agentId",
  "executionId",
  "snapshotVersion",
  "expiresAt",
  "revoked",
  "decisionId",
]);

export type RuntimeControllerRequest = {
  action: RuntimeControllerAction;
  runtimeLeaseId: string;
  tenantId: string;
  userId: string;
  agentId: string;
  snapshotVersion: number;
};

export type RuntimeLeaseRegistration = {
  runtimeLeaseId: string;
  tenantId: string;
  userId: string;
  agentId: string;
  executionId: string;
  snapshotVersion: number;
  expiresAt: string;
  revoked: boolean;
  decisionId: string;
};

export type RuntimeContainerSpec = {
  runtimeLeaseId: string;
  snapshotVersion: number;
  /** Exec/sleep container image. Operator-controlled; never from Gateway body. */
  image: string;
  /** Browser sandbox image (Chromium/CDP/noVNC entrypoint). Operator-controlled. */
  browserImage: string;
  execMounts: AccountMount[];
  browserMounts: AccountMount[];
};

export type RuntimeControllerPhase = "idle" | "running" | "stopped" | "reclaimed";

export type RuntimeControllerSuccess = {
  ok: true;
  action: RuntimeControllerAction;
  state: RuntimeControllerPhase;
  spec: RuntimeContainerSpec | null;
};

export class RuntimeControllerRejectedError extends Error {
  readonly reason: string;

  constructor(message: string, reason: string) {
    super(message);
    this.name = "RuntimeControllerRejectedError";
    this.reason = reason;
  }
}

type Session = {
  lease: RuntimeLeaseRegistration;
  phase: RuntimeControllerPhase;
  spec: RuntimeContainerSpec | null;
};

function reject(message: string, reason: string): never {
  throw new RuntimeControllerRejectedError(message, reason);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertAllowedKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  reason: string,
): void {
  for (const key of Object.keys(value)) {
    const folded = key.toLowerCase();
    if (
      (RUNTIME_CONTROLLER_FORBIDDEN_FIELDS as readonly string[]).includes(folded) ||
      !allowed.has(key)
    ) {
      reject(`Gateway cannot pass ${key} to the runtime controller`, reason);
    }
  }
}

export function parseRuntimeControllerRequest(body: unknown): RuntimeControllerRequest {
  if (!isRecord(body)) {
    reject("runtime controller request must be an object", "invalid-request");
  }
  assertAllowedKeys(body, REQUEST_FIELDS, "forbidden-field");
  const action = body.action;
  if (
    typeof action !== "string" ||
    !(RUNTIME_CONTROLLER_ACTIONS as readonly string[]).includes(action)
  ) {
    reject(
      "runtime controller action must be start, stop, inspect, attach, or reclaim",
      "invalid-action",
    );
  }
  const runtimeLeaseId = typeof body.runtimeLeaseId === "string" ? body.runtimeLeaseId.trim() : "";
  const tenantId = typeof body.tenantId === "string" ? body.tenantId.trim() : "";
  const userId = typeof body.userId === "string" ? body.userId.trim() : "";
  const agentId = typeof body.agentId === "string" ? body.agentId.trim() : "";
  const snapshotVersion = body.snapshotVersion;
  if (!runtimeLeaseId || !tenantId || !userId || !agentId) {
    reject("runtime controller request requires a lease id and trusted scope", "invalid-request");
  }
  if (!Number.isInteger(snapshotVersion) || (snapshotVersion as number) < 1) {
    reject("snapshotVersion must be a positive integer", "invalid-request");
  }
  return {
    action: action as RuntimeControllerAction,
    runtimeLeaseId,
    tenantId,
    userId,
    agentId,
    snapshotVersion: snapshotVersion as number,
  };
}

export class RuntimeController {
  private readonly sessions = new Map<string, Session>();

  constructor(
    private readonly options: {
      /** Operator exec image. Never read from a Gateway request. */
      image: string;
      /** Operator browser sandbox image. Never read from a Gateway request. */
      browserImage: string;
      cfg: OpenBotConfig;
      env?: NodeJS.ProcessEnv;
      now?: () => number;
      onSpec?: (spec: RuntimeContainerSpec) => void;
    },
  ) {
    if (!options.image.trim()) {
      throw new Error("runtime controller image is required");
    }
    if (!options.browserImage.trim()) {
      throw new Error("runtime controller browserImage is required");
    }
  }

  registerLease(input: RuntimeLeaseRegistration): RuntimeLeaseRegistration {
    if (!isRecord(input)) {
      reject("lease registration must be an object", "invalid-lease");
    }
    assertAllowedKeys(input, LEASE_FIELDS, "forbidden-field");
    const lease = normalizeLease(input);
    const existing = this.sessions.get(lease.runtimeLeaseId);
    if (existing && lease.snapshotVersion < existing.lease.snapshotVersion) {
      reject("stale lease cannot replace a newer snapshot", "stale-snapshot");
    }
    if (existing && lease.snapshotVersion === existing.lease.snapshotVersion) {
      // Soft-renew (extendLeaseIfStillEntitled) keeps snapshotVersion but refreshes
      // expiresAt/revoked on disk. Must update in-memory lease or assertLeaseUsable
      // keeps rejecting with "runtime lease is expired" until process restart.
      existing.lease = {
        ...existing.lease,
        expiresAt: lease.expiresAt,
        revoked: lease.revoked,
      };
      return existing.lease;
    }
    this.sessions.set(lease.runtimeLeaseId, {
      lease,
      phase: existing?.phase ?? "idle",
      spec: existing?.spec ?? null,
    });
    return lease;
  }

  revokeLease(runtimeLeaseId: string): void {
    const session = this.sessions.get(runtimeLeaseId.trim());
    if (!session) {
      reject("unknown runtime lease", "unknown-lease");
    }
    session.lease = { ...session.lease, revoked: true };
    if (session.phase === "running") {
      session.phase = "stopped";
    }
  }

  handle(body: unknown): RuntimeControllerSuccess {
    const request = parseRuntimeControllerRequest(body);
    const session = this.sessions.get(request.runtimeLeaseId);
    if (!session) {
      reject("unknown runtime lease", "unknown-lease");
    }
    this.assertScope(session.lease, request);
    switch (request.action) {
      case "start":
        return this.start(session);
      case "stop":
        session.phase = session.phase === "reclaimed" ? "reclaimed" : "stopped";
        return this.ok("stop", session);
      case "inspect":
        return this.ok("inspect", session);
      case "attach":
        if (session.phase !== "running" || !session.spec) {
          reject("runtime is not running", "not-running");
        }
        return this.ok("attach", session);
      case "reclaim":
        session.phase = "reclaimed";
        return this.ok("reclaim", session);
      default:
        reject("unsupported runtime controller action", "invalid-action");
    }
  }

  private start(session: Session): RuntimeControllerSuccess {
    this.assertLeaseUsable(session.lease);
    if (session.phase === "running" && session.spec) {
      return this.ok("start", session);
    }
    const spec = this.buildSpec(session.lease);
    session.spec = spec;
    session.phase = "running";
    this.options.onSpec?.(spec);
    return this.ok("start", session);
  }

  private buildSpec(lease: RuntimeLeaseRegistration): RuntimeContainerSpec {
    const paths = resolveAccountExecutionPaths({
      ctx: { tenantId: lease.tenantId, userId: lease.userId, domain: "employee" },
      cfg: this.options.cfg,
      agentId: lease.agentId,
      env: this.options.env,
    });
    // Must match applyAccountSandboxConfig: shared skills/canvas at /account/skills|/account/canvas.
    // After DIGEST, rebuild aw-exec leases — old containers do not pick up new mounts.
    const shared = resolveSharedAccountMountDirs(this.options.cfg);
    const plan = buildAccountSandboxMountPlan({
      workspaceDir: paths.workspaceDir,
      artifactsDir: paths.artifactsDir,
      browserArtifactsDir: paths.sharedArtifactsDir,
      browserProfileDir: paths.browserProfileDir,
      sharedSkillsDir: shared.sharedSkillsDir,
      sharedCanvasDir: shared.sharedCanvasDir,
    });
    return {
      runtimeLeaseId: lease.runtimeLeaseId,
      snapshotVersion: lease.snapshotVersion,
      image: this.options.image,
      browserImage: this.options.browserImage,
      execMounts: plan.exec,
      browserMounts: plan.browser,
    };
  }

  private assertScope(lease: RuntimeLeaseRegistration, request: RuntimeControllerRequest): void {
    if (
      lease.tenantId !== request.tenantId ||
      lease.userId !== request.userId ||
      normalizeAgentId(lease.agentId) !== normalizeAgentId(request.agentId) ||
      lease.snapshotVersion !== request.snapshotVersion
    ) {
      reject("request scope does not match the lease", "scope-mismatch");
    }
  }

  private assertLeaseUsable(lease: RuntimeLeaseRegistration): void {
    if (lease.revoked) {
      reject("runtime lease is revoked", "revoked");
    }
    const now = this.options.now?.() ?? Date.now();
    const expiresAt = Date.parse(lease.expiresAt);
    if (!Number.isFinite(expiresAt) || now >= expiresAt) {
      reject("runtime lease is expired", "lease-expired");
    }
  }

  private ok(action: RuntimeControllerAction, session: Session): RuntimeControllerSuccess {
    return {
      ok: true,
      action,
      state: session.phase,
      spec: session.spec,
    };
  }
}

function normalizeLease(input: RuntimeLeaseRegistration): RuntimeLeaseRegistration {
  const runtimeLeaseId = input.runtimeLeaseId.trim();
  const tenantId = input.tenantId.trim();
  const userId = input.userId.trim();
  const agentId = input.agentId.trim();
  const executionId = input.executionId.trim();
  const decisionId = input.decisionId.trim();
  const expiresAt = input.expiresAt.trim();
  if (!runtimeLeaseId || !tenantId || !userId || !agentId || !executionId || !decisionId) {
    reject("lease registration is missing a trusted field", "invalid-lease");
  }
  if (!decisionId.startsWith("gd-")) {
    reject("lease decisionId must be a gd- governance decision id", "invalid-lease");
  }
  if (!Number.isInteger(input.snapshotVersion) || input.snapshotVersion < 1) {
    reject("lease snapshotVersion must be a positive integer", "invalid-lease");
  }
  if (!Number.isFinite(Date.parse(expiresAt))) {
    reject("lease expiresAt must be a timestamp", "invalid-lease");
  }
  return {
    runtimeLeaseId,
    tenantId,
    userId,
    agentId,
    executionId,
    snapshotVersion: input.snapshotVersion,
    expiresAt,
    revoked: input.revoked,
    decisionId,
  };
}
