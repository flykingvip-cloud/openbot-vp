/**
 * Gateway orchestration for the local disk read grant.
 *
 * This is where the two-phase flow is sequenced (design 4.1):
 *
 *   resolve ticket -> node canonicalizes -> approval card OR directed grant
 *   -> Turn authorization -> per-call Invocation capability -> node reads
 *
 * The single most important property enforced here: for a proactive read, the
 * resolved path never reaches the model before the user approves. The resolve
 * result feeds the approval card and nothing else, so a model cannot probe the
 * user's disk layout by triggering resolution repeatedly (design 9.1, 9.7).
 *
 * Ports (`NodeInvokePort`, `ApprovalPort`, `AuditSink`) are injected so the whole
 * flow is exercisable without a live gateway, node or UI.
 */

import {
  buildAuditRecord,
  type AuditSink,
  type LocalFilesAuditRecord,
} from "../../local-files/audit.js";
import { declaresLocalFilesCommands } from "../../local-files/capability-profile.js";
import type { LocalDeviceBindingStore } from "../../local-files/device-binding.js";
import {
  evaluateDirectedGrant,
  type DirectedResourceRegistry,
} from "../../local-files/directed-resource.js";
import {
  deriveInvocationCapability,
  issueResolveTicket,
  issueTurnAuthorization,
} from "../../local-files/issue.js";
import type { CapabilitySigningKey } from "../../local-files/keyset.js";
import { prefilterRawPath } from "../../local-files/path-policy.js";
import {
  redeemCapability,
  type RedeemingConnection,
  type RedemptionDeps,
  type RedemptionResult,
  type ResolveTicketRedemptionResult,
} from "../../local-files/redemption.js";
import type { TurnAuthorizationStore } from "../../local-files/turn-authorization.js";
import {
  ARCHIVE_TASK_BUDGET,
  CAPABILITY_CLOCK_SKEW_MS,
  LOCAL_FILES_OPAQUE_DENIAL,
  LOCAL_FILES_READONLY_PROFILE,
  SINGLE_CALL_BUDGET,
  type CapabilityBinding,
  type LocalDeviceBinding,
  type RememberedLocalGrant,
  type FileIdentity,
  type GrantSource,
  type LocalFilesOperation,
  type SignedCapability,
  type TurnBudget,
} from "../../local-files/types.js";

export type NodeInvokeOutcome = {
  ok: boolean;
  payload?: unknown;
  error?: { code?: string; message?: string } | null;
};

export type NodeInvokePort = {
  invoke(params: {
    nodeId: string;
    command: LocalFilesOperation;
    params: Record<string, unknown>;
  }): Promise<NodeInvokeOutcome>;
};

/**
 * The bounded task an approval card describes.
 *
 * The card must say what is actually granted. "Inspect this ZIP" grants the
 * archive budget, not just the first `archive.list`; "list this directory" grants
 * a single listing and no child reads (design 9.2).
 */
export type ApprovalTask = "read-file" | "list-directory" | "inspect-archive";

export type ApprovalDecision = "allow-once" | "allow-always" | "deny" | "timeout";

/**
 * Independent approval type. Deliberately not the shell exec approval policy:
 * the infrastructure for pending/timeout/deny is shared, the policy is not
 * (design 4.11).
 */
export type ApprovalPort = {
  requestLocalFileApproval(params: {
    binding: CapabilityBinding;
    /** Canonical path as returned by the node, never gateway string concatenation. */
    canonicalPath: string;
    targetKind: "file" | "directory";
    task: ApprovalTask;
    budget: TurnBudget;
    nodeDisplayName?: string;
  }): Promise<ApprovalDecision>;
};

/** Live node the chat may bind after the user allows a read. */
export type LocalFilesNodeView = {
  nodeId: string;
  caps: string[];
  commands: string[];
  devicePublicKey?: string;
  displayName?: string;
};

export type LocalFilesNodeDirectory = {
  get(nodeId: string): LocalFilesNodeView | undefined;
  list(): LocalFilesNodeView[];
};

/** Non-blocking status shown for a directed read. Visibility, not approval. */
export type StatusPort = {
  showDirectedReadStatus?(params: { binding: CapabilityBinding; displayPath: string }): void;
};

export type LocalFilesServiceDeps = {
  signingKey: CapabilitySigningKey;
  bindings: LocalDeviceBindingStore;
  turnAuthorizations: TurnAuthorizationStore;
  directedResources: DirectedResourceRegistry;
  redemption: RedemptionDeps;
  node: NodeInvokePort;
  approvals: ApprovalPort;
  /** Connected nodes. Required before a missing binding can become a grant. */
  nodes?: LocalFilesNodeDirectory;
  audit: AuditSink;
  status?: StatusPort;
  now?: () => number;
  /** Home directory used only to redact audit paths. */
  homeDirForAudit?: string;
};

export type AccessRequest = {
  binding: CapabilityBinding;
  /** Raw path exactly as the user wrote it, or as the model supplied it. */
  rawPath: string;
  operation: LocalFilesOperation;
  /** Entry inside an archive, for `archive.readEntry`. */
  archiveEntryPath?: string;
  inboundMessageId?: string;
};

/** What the model is allowed to see. Failures are uniform by construction. */
export type AccessResult =
  | { ok: true; payload: unknown; grantSource: GrantSource }
  | { ok: false; message: typeof LOCAL_FILES_OPAQUE_DENIAL };

type ResolvedTarget = {
  canonicalPath: string;
  targetKind: "file" | "directory";
  fileId: FileIdentity;
};

function opaque(): AccessResult {
  return { ok: false, message: LOCAL_FILES_OPAQUE_DENIAL };
}

function taskForOperation(
  operation: LocalFilesOperation,
  targetKind: "file" | "directory",
): { task: ApprovalTask; operations: LocalFilesOperation[]; budget: TurnBudget } {
  if (operation === "archive.list" || operation === "archive.readEntry") {
    // One bounded task covering the listing and the entry reads that follow.
    return {
      task: "inspect-archive",
      operations: ["archive.list", "archive.readEntry"],
      budget: { ...ARCHIVE_TASK_BUDGET },
    };
  }
  if (targetKind === "directory") {
    return { task: "list-directory", operations: ["fs.list"], budget: { ...SINGLE_CALL_BUDGET } };
  }
  return { task: "read-file", operations: [operation], budget: { ...SINGLE_CALL_BUDGET } };
}

export class LocalFilesService {
  constructor(private readonly deps: LocalFilesServiceDeps) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private audit(params: Parameters<typeof buildAuditRecord>[0]): LocalFilesAuditRecord {
    const record = buildAuditRecord({ ...params, homeDir: this.deps.homeDirForAudit });
    this.deps.audit.write(record);
    return record;
  }

  /**
   * Stage one. Returns the resolved target to the caller inside the gateway only.
   *
   * Nothing from here is returned to the model before authorization: not whether
   * the path exists, not its size, inode or type.
   */
  private async resolve(request: AccessRequest): Promise<ResolvedTarget | null> {
    const startedAtMs = this.now();

    // Gateway copy of the hard-deny rules, applied to the path as written. It can
    // only refuse, never admit (design 4.9): the node still runs all three layers
    // on the canonical path. This exists so an obvious denial costs no round trip,
    // and so the refusal is proven independently on this side too (design 10.3).
    const prefiltered = prefilterRawPath(request.rawPath);
    if (prefiltered && !prefiltered.allowed) {
      this.audit({
        binding: request.binding,
        inboundMessageId: request.inboundMessageId,
        operation: "resolve",
        canonicalPath: request.rawPath,
        decision: "denied",
        denyReason: `prefilter:${prefiltered.layer}`,
        startedAtMs,
        nowMs: this.now(),
      });
      return null;
    }

    const ticket = issueResolveTicket({
      binding: request.binding,
      rawPath: request.rawPath,
      intendedOperation: request.operation,
      signingKey: this.deps.signingKey,
      nowMs: startedAtMs,
    });

    const outcome = await this.deps.node.invoke({
      nodeId: request.binding.nodeId,
      command: "fs.stat",
      // The mode is what makes this a resolution rather than a metadata read.
      // There is no separate fs.resolve command (design 9.7).
      params: { capabilityType: "resolve-ticket", capability: ticket.signed },
    });

    if (!outcome.ok || !outcome.payload || typeof outcome.payload !== "object") {
      this.audit({
        binding: request.binding,
        inboundMessageId: request.inboundMessageId,
        operation: "resolve",
        // The raw path is hashed, so a failed resolve does not log a real path.
        canonicalPath: request.rawPath,
        decision: "denied",
        // Namespaced the same way as a failed read, so the audit reads uniformly
        // and design 4.12's error code is present at the resolve stage too.
        denyReason: `node:${outcome.error?.code ?? "resolve-failed"}`,
        errorCode: outcome.error?.code,
        startedAtMs,
        nowMs: this.now(),
      });
      return null;
    }

    const payload = outcome.payload as Partial<ResolvedTarget>;
    if (
      typeof payload.canonicalPath !== "string" ||
      (payload.targetKind !== "file" && payload.targetKind !== "directory") ||
      !payload.fileId
    ) {
      return null;
    }
    return {
      canonicalPath: payload.canonicalPath,
      targetKind: payload.targetKind,
      fileId: payload.fileId,
    };
  }

  /**
   * Full flow for one model-visible request.
   *
   * Reuses an existing Turn authorization for the same target when one is already
   * open, which is what lets a bounded ZIP task make several calls without asking
   * the user again.
   */
  async requestAccess(request: AccessRequest): Promise<AccessResult> {
    const startedAtMs = this.now();
    const { binding } = request;

    // Device binding decides tenant, user, digital human and device (design 4.3).
    const bindingCheck = this.deps.bindings.authorizeBinding(binding);
    if (!bindingCheck.ok) {
      // No binding yet is a grant the user can make from the chat card.
      // A mismatched tenant, a revoked row, or a different digital human stays
      // a hard refusal and never opens that card.
      if (bindingCheck.reason === "not-bound") {
        return await this.requestAccessWithoutBinding(request, startedAtMs);
      }
      this.audit({
        binding,
        inboundMessageId: request.inboundMessageId,
        operation: request.operation,
        canonicalPath: request.rawPath,
        decision: "denied",
        denyReason: `binding:${bindingCheck.reason}`,
        startedAtMs,
        nowMs: this.now(),
      });
      return opaque();
    }

    const existing = this.findOpenAuthorization(request);
    const resolved = existing
      ? {
          canonicalPath: existing.canonicalPath,
          targetKind: existing.targetKind,
          fileId: existing.fileId,
        }
      : await this.resolve(request);
    if (!resolved) {
      return opaque();
    }

    const authorizationId =
      existing?.authorizationId ??
      (await this.establishTurnAuthorization({ request, resolved, startedAtMs }));
    if (!authorizationId) {
      return opaque();
    }

    return await this.performOperation({ request, resolved, authorizationId, startedAtMs });
  }

  /** An already-granted, still-valid authorization for this exact target. */
  private findOpenAuthorization(request: AccessRequest):
    | {
        authorizationId: string;
        canonicalPath: string;
        targetKind: "file" | "directory";
        fileId: FileIdentity;
        grantSource: GrantSource;
      }
    | undefined {
    const nowMs = this.now();
    for (const record of this.deps.turnAuthorizations.allActive(nowMs)) {
      const claims = record.claims;
      if (claims.binding.turnId !== request.binding.turnId) {
        continue;
      }
      if (claims.binding.sessionKey !== request.binding.sessionKey) {
        continue;
      }
      if (!claims.operations.includes(request.operation)) {
        continue;
      }
      return {
        authorizationId: claims.authorizationId,
        canonicalPath: claims.canonicalPath,
        targetKind: claims.targetKind,
        fileId: claims.fileId,
        grantSource: claims.grantSource,
      };
    }
    return undefined;
  }

  private async establishTurnAuthorization(args: {
    request: AccessRequest;
    resolved: ResolvedTarget;
    startedAtMs: number;
  }): Promise<string | null> {
    const { request, resolved, startedAtMs } = args;
    const plan = taskForOperation(request.operation, resolved.targetKind);

    // A path the user named in this turn, with read intent, needs no card.
    const directed = evaluateDirectedGrant({
      record: this.deps.directedResources.find({
        tenantId: request.binding.tenantId,
        userId: request.binding.userId,
        sessionKey: request.binding.sessionKey,
        turnId: request.binding.turnId,
        rawPath: request.rawPath,
      }),
      turn: request.binding,
    });

    let grantSource: GrantSource;
    if (directed.granted) {
      grantSource = "user-directed";
      // Visibility only; this is not an approval gate (design 4.11).
      this.deps.status?.showDirectedReadStatus?.({
        binding: request.binding,
        displayPath: request.rawPath,
      });
    } else if (this.rememberedGrantCovers(request, resolved)) {
      grantSource = "user-approved-once";
    } else {
      const decision = await this.deps.approvals.requestLocalFileApproval({
        binding: request.binding,
        canonicalPath: resolved.canonicalPath,
        targetKind: resolved.targetKind,
        task: plan.task,
        budget: plan.budget,
        nodeDisplayName: this.nodeDisplayName(request.binding.nodeId),
      });
      if (decision !== "allow-once" && decision !== "allow-always") {
        // Deny and timeout are both refusals. There is no default-allow.
        this.audit({
          binding: request.binding,
          inboundMessageId: request.inboundMessageId,
          operation: request.operation,
          canonicalPath: resolved.canonicalPath,
          decision: "denied",
          denyReason: `approval:${decision}`,
          startedAtMs,
          nowMs: this.now(),
        });
        return null;
      }
      if (decision === "allow-always") {
        await this.rememberExactGrant(request, resolved, plan.operations);
      }
      grantSource = "user-approved-once";
    }

    return await this.issueGrantedTurn({
      request,
      resolved,
      plan,
      grantSource,
      startedAtMs,
    });
  }

  private async issueGrantedTurn(args: {
    request: AccessRequest;
    resolved: ResolvedTarget;
    plan: { operations: LocalFilesOperation[]; budget: TurnBudget };
    grantSource: GrantSource;
    startedAtMs: number;
  }): Promise<string | null> {
    const { request, resolved, plan, grantSource, startedAtMs } = args;
    const nowMs = this.now();
    const issued = issueTurnAuthorization({
      binding: request.binding,
      canonicalPath: resolved.canonicalPath,
      fileId: resolved.fileId,
      targetKind: resolved.targetKind,
      operations: plan.operations,
      grantSource,
      budget: plan.budget,
      signingKey: this.deps.signingKey,
      store: this.deps.turnAuthorizations,
      nowMs,
      // Expires with the turn.
      expiresAtMs: nowMs + 10 * 60_000,
    });
    if (!issued.ok) {
      this.audit({
        binding: request.binding,
        inboundMessageId: request.inboundMessageId,
        operation: request.operation,
        canonicalPath: resolved.canonicalPath,
        decision: "denied",
        denyReason: `issue:${issued.reason}`,
        startedAtMs,
        nowMs: this.now(),
      });
      return null;
    }
    return issued.claims.authorizationId;
  }

  private async performOperation(args: {
    request: AccessRequest;
    resolved: ResolvedTarget;
    authorizationId: string;
    startedAtMs: number;
  }): Promise<AccessResult> {
    const { request, resolved, authorizationId, startedAtMs } = args;

    const derived = deriveInvocationCapability({
      authorizationId,
      operation: request.operation,
      archiveEntryPath: request.archiveEntryPath,
      signingKey: this.deps.signingKey,
      store: this.deps.turnAuthorizations,
      nowMs: this.now(),
      clockSkewMs: CAPABILITY_CLOCK_SKEW_MS,
    });
    if (!derived.ok) {
      this.audit({
        binding: request.binding,
        inboundMessageId: request.inboundMessageId,
        operation: request.operation,
        canonicalPath: resolved.canonicalPath,
        decision: "denied",
        denyReason: `derive:${derived.reason}`,
        startedAtMs,
        nowMs: this.now(),
      });
      return opaque();
    }

    const outcome = await this.deps.node.invoke({
      nodeId: request.binding.nodeId,
      command: request.operation,
      params: { capability: derived.signed },
    });

    const record = this.deps.turnAuthorizations.get(authorizationId);
    const grantSource = record?.claims.grantSource ?? "user-approved-once";

    if (!outcome.ok) {
      this.audit({
        binding: request.binding,
        inboundMessageId: request.inboundMessageId,
        operation: request.operation,
        canonicalPath: resolved.canonicalPath,
        grantSource,
        decision: "denied",
        // The node's coarse failure class, namespaced so the audit shows which
        // side refused. `detail` never crosses, so this is all there is to go on.
        denyReason: `node:${outcome.error?.code ?? "refused"}`,
        errorCode: outcome.error?.code,
        startedAtMs,
        nowMs: this.now(),
      });
      // A failed open is not retried and no replacement capability is minted
      // (design 9.3 step 4, acceptance 9.6 case 17).
      return opaque();
    }

    const payload = (outcome.payload ?? {}) as Record<string, unknown>;
    const bytes = typeof payload.bytesReturned === "number" ? payload.bytesReturned : 0;
    if (bytes > 0) {
      this.deps.turnAuthorizations.recordBytes(authorizationId, bytes);
    }

    this.audit({
      binding: request.binding,
      inboundMessageId: request.inboundMessageId,
      operation: request.operation,
      canonicalPath: resolved.canonicalPath,
      grantSource,
      decision: "allowed",
      bytesReturned: bytes,
      contentHash: typeof payload.sha256 === "string" ? payload.sha256 : undefined,
      truncated: typeof payload.truncated === "boolean" ? payload.truncated : undefined,
      startedAtMs,
      nowMs: this.now(),
    });

    return { ok: true, payload: outcome.payload, grantSource };
  }

  /**
   * The user asked to read a path and this turn has no device binding yet.
   *
   * Hard-deny paths stay opaque and never raise a card. A grant-eligible path
   * (Desktop, for example) resolves on the single paired computer and then
   * waits on the chat approval card. Allow Once / Always writes the binding
   * and continues the same turn; deny writes nothing.
   */
  private async requestAccessWithoutBinding(
    request: AccessRequest,
    startedAtMs: number,
  ): Promise<AccessResult> {
    const prefiltered = prefilterRawPath(request.rawPath);
    if (prefiltered && !prefiltered.allowed) {
      this.audit({
        binding: request.binding,
        inboundMessageId: request.inboundMessageId,
        operation: request.operation,
        canonicalPath: request.rawPath,
        decision: "denied",
        denyReason: `prefilter:${prefiltered.layer}`,
        startedAtMs,
        nowMs: this.now(),
      });
      return opaque();
    }

    const live = this.deps.nodes?.get(request.binding.nodeId);
    if (!this.nodeCanHostLocalFiles(live, request.binding.devicePublicKey)) {
      this.audit({
        binding: request.binding,
        inboundMessageId: request.inboundMessageId,
        operation: request.operation,
        canonicalPath: request.rawPath,
        decision: "denied",
        denyReason: "binding:not-bound",
        startedAtMs,
        nowMs: this.now(),
      });
      return opaque();
    }

    // Resolve redemption checks the binding, so the row has to exist first.
    // It is revoked again unless this turn actually grants the read.
    const persisted = await this.persistChatBinding(request.binding);
    if (!persisted) {
      return opaque();
    }

    const resolved = await this.resolve(request);
    if (!resolved) {
      await this.revokeChatBinding(request.binding.nodeId);
      return opaque();
    }

    const plan = taskForOperation(request.operation, resolved.targetKind);
    const directed = evaluateDirectedGrant({
      record: this.deps.directedResources.find({
        tenantId: request.binding.tenantId,
        userId: request.binding.userId,
        sessionKey: request.binding.sessionKey,
        turnId: request.binding.turnId,
        rawPath: request.rawPath,
      }),
      turn: request.binding,
    });

    let grantSource: GrantSource;
    if (directed.granted) {
      grantSource = "user-directed";
      this.deps.status?.showDirectedReadStatus?.({
        binding: request.binding,
        displayPath: request.rawPath,
      });
    } else {
      const decision = await this.deps.approvals.requestLocalFileApproval({
        binding: request.binding,
        canonicalPath: resolved.canonicalPath,
        targetKind: resolved.targetKind,
        task: plan.task,
        budget: plan.budget,
        nodeDisplayName: live?.displayName,
      });
      if (decision !== "allow-once" && decision !== "allow-always") {
        await this.revokeChatBinding(request.binding.nodeId);
        this.audit({
          binding: request.binding,
          inboundMessageId: request.inboundMessageId,
          operation: request.operation,
          canonicalPath: resolved.canonicalPath,
          decision: "denied",
          denyReason: `approval:${decision}`,
          startedAtMs,
          nowMs: this.now(),
        });
        return opaque();
      }
      if (decision === "allow-always") {
        await this.rememberExactGrant(request, resolved, plan.operations);
      }
      grantSource = "user-approved-once";
    }

    const authorizationId = await this.issueGrantedTurn({
      request,
      resolved,
      plan,
      grantSource,
      startedAtMs,
    });
    if (!authorizationId) {
      return opaque();
    }
    return await this.performOperation({ request, resolved, authorizationId, startedAtMs });
  }

  private nodeCanHostLocalFiles(
    live: LocalFilesNodeView | undefined,
    devicePublicKey: string,
  ): boolean {
    if (!live) {
      return false;
    }
    const key = live.devicePublicKey?.trim() ?? "";
    if (!key || key !== devicePublicKey) {
      return false;
    }
    return declaresLocalFilesCommands(live.commands);
  }

  private nodeDisplayName(nodeId: string): string | undefined {
    const name = this.deps.nodes?.get(nodeId)?.displayName?.trim();
    return name || undefined;
  }

  private async revokeChatBinding(nodeId: string): Promise<void> {
    await this.deps.bindings.revokePersisted(nodeId, this.now());
  }

  /** Write the binding the chat approval just consented to. */
  private async persistChatBinding(binding: CapabilityBinding): Promise<boolean> {
    const existing = this.deps.bindings.get(binding.nodeId);
    if (existing && existing.status === "active") {
      return (
        existing.tenantId === binding.tenantId &&
        existing.userId === binding.userId &&
        existing.devicePublicKey === binding.devicePublicKey &&
        existing.allowedAgentIds.includes(binding.agentId)
      );
    }
    const record: LocalDeviceBinding = {
      tenantId: binding.tenantId,
      userId: binding.userId,
      nodeId: binding.nodeId,
      devicePublicKey: binding.devicePublicKey,
      allowedAgentIds: [binding.agentId],
      capabilityProfile: LOCAL_FILES_READONLY_PROFILE,
      status: "active",
      createdAtMs: this.now(),
    };
    await this.deps.bindings.putPersisted(record);
    return true;
  }

  private rememberedGrantCovers(request: AccessRequest, resolved: ResolvedTarget): boolean {
    const stored = this.deps.bindings.get(request.binding.nodeId);
    if (!stored || stored.status !== "active") {
      return false;
    }
    if (stored.tenantId !== request.binding.tenantId || stored.userId !== request.binding.userId) {
      return false;
    }
    if (!stored.allowedAgentIds.includes(request.binding.agentId)) {
      return false;
    }
    return (stored.rememberedGrants ?? []).some(
      (grant) =>
        grant.canonicalPath === resolved.canonicalPath &&
        grant.operations.includes(request.operation),
    );
  }

  private async rememberExactGrant(
    request: AccessRequest,
    resolved: ResolvedTarget,
    operations: readonly LocalFilesOperation[],
  ): Promise<void> {
    const stored = this.deps.bindings.get(request.binding.nodeId);
    if (!stored || stored.status !== "active") {
      return;
    }
    const grants: RememberedLocalGrant[] = (stored.rememberedGrants ?? []).map((grant) => ({
      ...grant,
      operations: [...grant.operations],
    }));
    const existing = grants.find((grant) => grant.canonicalPath === resolved.canonicalPath);
    if (existing) {
      existing.operations = [...new Set([...existing.operations, ...operations])];
    } else {
      grants.push({
        canonicalPath: resolved.canonicalPath,
        targetKind: resolved.targetKind,
        operations: [...operations],
      });
    }
    await this.deps.bindings.putPersisted({
      ...stored,
      allowedAgentIds: [...stored.allowedAgentIds],
      rememberedGrants: grants,
    });
  }

  /**
   * Redemption endpoint body, called by the node over its authenticated
   * connection. Thin on purpose: all the checks live in
   * `redeemCapability` so ordering and atomicity live in one place.
   */
  redeem(params: {
    capability: SignedCapability;
    operation: LocalFilesOperation;
    connection: RedeemingConnection;
  }): RedemptionResult | ResolveTicketRedemptionResult {
    // Dispatches on capability kind: a resolve ticket and an Invocation capability
    // are redeemed through the same ledger but in separate nonce spaces (design 9.3).
    return redeemCapability(
      {
        capability: params.capability,
        connection: params.connection,
        operation: params.operation,
      },
      this.deps.redemption,
      this.now(),
    );
  }
}
