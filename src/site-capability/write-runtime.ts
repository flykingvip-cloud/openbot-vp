/**
 * Isolated write extension runtime.
 *
 * Not installed on the process default catalog. A read grant, an OI flag,
 * or a bare account binding cannot dispatch a write. Unknown results are
 * rechecked and are not replayed.
 */

import { randomUUID } from "node:crypto";
import { SAR_DENIAL_CODE, sarDeny, type SarDenial } from "./codes.js";
import { SarExecutionAuthority } from "./execution-authority.js";
import { TrustedOperationFault } from "./operations.js";
import type {
  SiteCompleteness,
  SiteRetryHint,
  SiteRunError,
  SiteRunResult,
  SiteRunStatus,
  SiteVerification,
} from "./result.js";
import type { AccountBinding, ServerPrincipal } from "./session-handle.js";
import {
  authorizeWrite,
  principalOwnsWrite,
  writeGrantKey,
  writeRecordKey,
  type ReadyWrite,
} from "./write-authorize.js";
import {
  SAR_WRITE_FIXTURE_ORIGIN,
  writeArtifactDigest,
  parseWriteCapabilityManifest,
  type SarWriteEffect,
  type WriteCapabilityManifest,
} from "./write-effect.js";
import { ControllableDraftNoteSite, type DraftReceipt } from "./write-fixture.js";
import {
  partitionOf,
  priorWriteMayBeReplayed,
  WriteRecheckStore,
  type WriteConfirmation,
  type WriteLedgerPartition,
} from "./write-recheck-store.js";

export type WriteConcurrency = "reject" | "queue";

export type WriteCapabilityRecord = {
  manifest: WriteCapabilityManifest;
  artifactDigest: string;
  lifecycle: "private" | "approved";
  verification: "unverified" | "passed" | "failed" | "stale";
  disabled: boolean;
  published: false;
  enabled: boolean;
};

export type WriteCapabilityGrant = {
  tenantId: string;
  userId: string;
  capabilityId: string;
  version: string;
  artifactDigest: string;
  effect: string;
  accountBindingIds: readonly string[];
};

export type WriteRecheckView = {
  ok: true;
  status: "confirmed" | "unknown" | "absent" | "digest_mismatch";
  replayed: false;
  runId: string | null;
  artifactDigest: string | null;
  contentDigest: string | null;
  noteId: string | null;
};

const ORDINARY_FAULTS = new Set(["NOTE_NOT_FOUND", "IDEMPOTENCY_CONFLICT"]);

function failure(
  code: string,
  message: string,
  retry: SiteRetryHint,
  ordinaryFailure = true,
): SiteRunError {
  return { code, message, retry, ordinaryFailure };
}

export class WriteExtensionRuntime {
  private readonly records = new Map<string, WriteCapabilityRecord>();
  private readonly grants = new Map<string, WriteCapabilityGrant>();
  private readonly bindings = new Map<string, AccountBinding>();
  private readonly store: WriteRecheckStore;
  private readonly tails = new Map<string, Promise<void>>();
  private readonly concurrency: WriteConcurrency;

  constructor(
    private readonly options: {
      authority: SarExecutionAuthority;
      site: ControllableDraftNoteSite;
      concurrency?: WriteConcurrency;
      now?: () => number;
      mintRunId?: () => string;
      mintEvidenceRef?: () => string;
      /** Optional disk ledger root (R4). Leaves pure memory when omitted. */
      storeRoot?: string;
      /** Injectable ledger (tests). Overrides storeRoot when both set. */
      store?: WriteRecheckStore;
    },
  ) {
    this.concurrency = options.concurrency ?? "reject";
    this.store = options.store ?? new WriteRecheckStore({ storeRoot: options.storeRoot });
  }

  register(input: {
    manifest: unknown;
    lifecycle?: string;
    verification?: WriteCapabilityRecord["verification"];
    enabled?: boolean;
    published?: boolean;
    disabled?: boolean;
  }): { ok: true; record: WriteCapabilityRecord } | SarDenial {
    if (input.published === true || input.lifecycle === "published") {
      return sarDeny(SAR_DENIAL_CODE.policyDenied, "write capabilities cannot be published");
    }
    const parsed = parseWriteCapabilityManifest(input.manifest);
    if (!parsed.ok) {
      return parsed;
    }
    if (parsed.manifest.allowedOrigins.some((origin) => origin !== SAR_WRITE_FIXTURE_ORIGIN)) {
      return sarDeny(
        SAR_DENIAL_CODE.policyDenied,
        "write extension only accepts the controllable fixture origin",
      );
    }
    const lifecycle = input.lifecycle === "approved" ? "approved" : "private";
    const verification = input.verification ?? "unverified";
    const enabled =
      lifecycle === "approved" &&
      verification === "passed" &&
      input.enabled === true &&
      input.disabled !== true;
    const record: WriteCapabilityRecord = {
      manifest: parsed.manifest,
      artifactDigest: writeArtifactDigest(parsed.manifest),
      lifecycle,
      verification,
      disabled: input.disabled === true,
      published: false,
      enabled,
    };
    this.records.set(writeRecordKey(parsed.manifest.id, parsed.manifest.version), record);
    return { ok: true, record: { ...record, manifest: { ...record.manifest } } };
  }

  grant(input: WriteCapabilityGrant): { ok: true } | SarDenial {
    if (input.effect === "read") {
      return sarDeny(SAR_DENIAL_CODE.policyDenied, "read effect does not authorize a write");
    }
    const record = this.records.get(writeRecordKey(input.capabilityId, input.version));
    if (!record || !record.enabled) {
      return sarDeny(SAR_DENIAL_CODE.policyDenied, "write capability is not enabled");
    }
    if (input.effect !== record.manifest.effect) {
      return sarDeny(SAR_DENIAL_CODE.policyDenied, "write effect does not match the capability");
    }
    if (input.artifactDigest !== record.artifactDigest) {
      return sarDeny(SAR_DENIAL_CODE.invalidManifest, "artifact digest does not match");
    }
    this.grants.set(
      writeGrantKey(
        input.tenantId,
        input.userId,
        input.capabilityId,
        input.version,
        record.manifest.effect,
      ),
      { ...input, effect: record.manifest.effect, accountBindingIds: [...input.accountBindingIds] },
    );
    return { ok: true };
  }

  registerBinding(raw: unknown): { ok: true; binding: AccountBinding } | SarDenial {
    const registered = this.options.authority.registerBinding(raw);
    if (!registered.ok) {
      return registered;
    }
    this.bindings.set(registered.binding.bindingId, registered.binding);
    return registered;
  }

  async invoke(
    principal: ServerPrincipal,
    input: {
      capabilityId?: string;
      version?: string;
      args?: unknown;
      accountBindingId?: string;
    },
  ): Promise<SiteRunResult> {
    const started = this.now();
    const ready = authorizeWrite({
      principal,
      request: input,
      records: this.records,
      grants: this.grants,
      bindings: this.bindings,
    });
    if (!ready.ok) {
      return this.finish({
        started,
        capabilityId: input.capabilityId?.trim() || "unknown",
        version: input.version?.trim() || "unknown",
        artifactDigest: "",
        status: "failed",
        verification: "failed",
        data: null,
        completeness: "complete",
        error: failure(ready.code, ready.message, "none"),
      });
    }
    const partition = this.ledgerPartition(ready.value);
    return this.store.runExclusive(partition, async () => {
      const prior = this.resolvePrior(ready.value, started);
      if (prior) {
        return prior;
      }
      const runId = this.mintRunId();
      return this.serial(ready.value.scopeKey, runId, () =>
        this.dispatch(ready.value, runId, started),
      );
    });
  }

  /**
   * Read the ledger and, when a receipt exists, confirm an unknown write.
   * Never calls apply_draft.
   */
  recheck(
    principal: ServerPrincipal,
    input: { runId: string; artifactDigest: string },
  ): WriteRecheckView | { ok: false; code: string; message: string } {
    const entry = this.store.findByRunId(input.runId);
    if (!entry) {
      return {
        ok: true,
        status: "absent",
        replayed: false,
        runId: null,
        artifactDigest: null,
        contentDigest: null,
        noteId: null,
      };
    }
    const allowed = principalOwnsWrite(
      principal,
      this.bindings.get(entry.bindingId),
      this.grants,
      entry.capabilityId,
      entry.version,
      entry.effect,
    );
    if (!allowed) {
      return { ok: false, code: "NOT_AUTHORIZED", message: "capability is not available" };
    }
    if (entry.artifactDigest !== input.artifactDigest) {
      return {
        ok: true,
        status: "digest_mismatch",
        replayed: false,
        runId: entry.runId,
        artifactDigest: entry.artifactDigest,
        contentDigest: null,
        noteId: null,
      };
    }
    if (priorWriteMayBeReplayed(entry.result)) {
      throw new Error("write extension must not blind-replay from recheck");
    }
    const confirmation = this.confirmFromReceipt(entry);
    if (confirmation) {
      return {
        ok: true,
        status: "confirmed",
        replayed: false,
        runId: confirmation.confirmedFromRunId,
        artifactDigest: confirmation.artifactDigest,
        contentDigest: confirmation.contentDigest,
        noteId: confirmation.noteId,
      };
    }
    if (entry.status === "confirmed" && entry.contentDigest && entry.noteId) {
      return {
        ok: true,
        status: "confirmed",
        replayed: false,
        runId: entry.runId,
        artifactDigest: entry.artifactDigest,
        contentDigest: entry.contentDigest,
        noteId: entry.noteId,
      };
    }
    return {
      ok: true,
      status: "unknown",
      replayed: false,
      runId: entry.runId,
      artifactDigest: entry.artifactDigest,
      contentDigest: null,
      noteId: null,
    };
  }

  private resolvePrior(ready: ReadyWrite, started: number): SiteRunResult | null {
    const decision = this.store.disposition({
      ...this.ledgerPartition(ready),
      artifactDigest: ready.record.artifactDigest,
      payloadDigest: ready.payloadDigest,
    });
    if (decision.kind === "absent") {
      return null;
    }
    if (decision.kind === "intent") {
      // Another in-flight attempt holds the key; treat as unknown (no second apply).
      return this.echoUnknown(
        ready,
        started,
        decision.entry.runId,
        decision.entry.result.error?.code ?? "RESULT_UNKNOWN",
      );
    }
    if (priorWriteMayBeReplayed(decision.entry.result)) {
      throw new Error("write extension must not blind-replay before confirmation");
    }
    if (decision.kind === "digest_mismatch") {
      return this.finishDenied(
        ready,
        started,
        "ARTIFACT_DIGEST_MISMATCH",
        "artifact digest does not match the recorded write",
      );
    }
    if (decision.kind === "payload_conflict") {
      return this.finishDenied(
        ready,
        started,
        "IDEMPOTENCY_CONFLICT",
        "idempotency key was already used for a different payload",
      );
    }
    if (decision.kind === "confirmed") {
      const receipt = this.options.site.observe(ready.binding.bindingId, ready.args.idempotencyKey);
      if (!receipt || receipt.contentDigest !== decision.confirmation.contentDigest) {
        return this.echoUnknown(ready, started, decision.entry.runId, "RESULT_UNKNOWN");
      }
      return this.echoConfirmed(ready, started, decision.confirmation, receipt);
    }
    const confirmation = this.confirmFromReceipt(decision.entry);
    if (confirmation) {
      const receipt = this.options.site.observe(ready.binding.bindingId, ready.args.idempotencyKey);
      if (receipt) {
        return this.echoConfirmed(ready, started, confirmation, receipt);
      }
    }
    return this.echoUnknown(
      ready,
      started,
      decision.entry.runId,
      decision.entry.result.error?.code ?? "RESULT_UNKNOWN",
    );
  }

  private confirmFromReceipt(entry: {
    runId: string;
    capabilityId: string;
    idempotencyKey: string;
    artifactDigest: string;
    payloadDigest: string;
    effect: SarWriteEffect;
    tenantId: string;
    userId: string;
    bindingId: string;
    status: "intent" | "confirmed" | "unknown";
    contentDigest: string | null;
    noteId: string | null;
  }): WriteConfirmation | null {
    const existing = this.store.confirmationFor(partitionOf(entry));
    if (existing) {
      return existing;
    }
    const receipt = this.options.site.observe(entry.bindingId, entry.idempotencyKey);
    if (!receipt) {
      return null;
    }
    if (receipt.payloadDigest !== entry.payloadDigest || receipt.effect !== entry.effect) {
      return null;
    }
    return this.store.confirm({
      runId: entry.runId,
      idempotencyKey: entry.idempotencyKey,
      capabilityId: entry.capabilityId,
      artifactDigest: entry.artifactDigest,
      payloadDigest: entry.payloadDigest,
      noteId: receipt.noteId,
      contentDigest: receipt.contentDigest,
      tenantId: entry.tenantId,
      userId: entry.userId,
      bindingId: entry.bindingId,
    });
  }

  private async dispatch(
    ready: ReadyWrite,
    runId: string,
    started: number,
  ): Promise<SiteRunResult> {
    const partition = this.ledgerPartition(ready);
    const intentPlaceholder = this.finish({
      started,
      runId,
      capabilityId: ready.record.manifest.id,
      version: ready.record.manifest.version,
      artifactDigest: ready.record.artifactDigest,
      status: "unknown",
      verification: "not_performed",
      data: null,
      completeness: "partial",
      error: failure(
        "RESULT_UNKNOWN",
        "write intent reserved; result not yet confirmed",
        "not_ordinary",
        false,
      ),
    });
    const reserved = this.store.reserveIntent({
      runId,
      idempotencyKey: ready.args.idempotencyKey,
      capabilityId: ready.record.manifest.id,
      version: ready.record.manifest.version,
      artifactDigest: ready.record.artifactDigest,
      effect: ready.record.manifest.effect,
      tenantId: partition.tenantId,
      userId: partition.userId,
      bindingId: partition.bindingId,
      payloadDigest: ready.payloadDigest,
      status: "intent",
      noteId: null,
      contentDigest: null,
      evidenceRef: intentPlaceholder.evidenceRef,
      result: intentPlaceholder,
    });
    if (!("reserved" in reserved)) {
      // Lost the race after exclusive wait; resolve from ledger without applying.
      if (reserved.kind === "digest_mismatch") {
        return this.finishDenied(
          ready,
          started,
          "ARTIFACT_DIGEST_MISMATCH",
          "artifact digest does not match the recorded write",
        );
      }
      if (reserved.kind === "payload_conflict") {
        return this.finishDenied(
          ready,
          started,
          "IDEMPOTENCY_CONFLICT",
          "idempotency key was already used for a different payload",
        );
      }
      if (reserved.kind === "confirmed") {
        const receipt = this.options.site.observe(
          ready.binding.bindingId,
          ready.args.idempotencyKey,
        );
        if (receipt && receipt.contentDigest === reserved.confirmation.contentDigest) {
          return this.echoConfirmed(ready, started, reserved.confirmation, receipt);
        }
        return this.echoUnknown(ready, started, reserved.entry.runId, "RESULT_UNKNOWN");
      }
      if (reserved.kind === "absent") {
        return this.echoUnknown(ready, started, runId, "RESULT_UNKNOWN");
      }
      return this.echoUnknown(
        ready,
        started,
        reserved.entry.runId,
        reserved.entry.result.error?.code ?? "RESULT_UNKNOWN",
      );
    }
    try {
      const applied = await this.options.site.applyDraft({
        bindingId: ready.binding.bindingId,
        effect: ready.record.manifest.effect,
        idempotencyKey: ready.args.idempotencyKey,
        noteId: ready.args.noteId,
        title: ready.args.title,
        body: ready.args.body,
        payloadDigest: ready.payloadDigest,
      });
      const result = this.finish({
        started,
        runId,
        capabilityId: ready.record.manifest.id,
        version: ready.record.manifest.version,
        artifactDigest: ready.record.artifactDigest,
        status: "succeeded",
        verification: "passed",
        data: noteData(applied.note, ready.record.manifest.effect, false),
        completeness: "complete",
      });
      this.store.record({
        runId: result.runId,
        idempotencyKey: ready.args.idempotencyKey,
        capabilityId: ready.record.manifest.id,
        version: ready.record.manifest.version,
        artifactDigest: ready.record.artifactDigest,
        effect: ready.record.manifest.effect,
        tenantId: ready.binding.tenantId,
        userId: ready.binding.userId,
        bindingId: ready.binding.bindingId,
        payloadDigest: ready.payloadDigest,
        status: "confirmed",
        noteId: applied.note.noteId,
        contentDigest: applied.note.contentDigest,
        evidenceRef: result.evidenceRef,
        result,
      });
      return result;
    } catch (err) {
      const fault = err instanceof TrustedOperationFault ? err.fault : "RESULT_UNKNOWN";
      if (!ORDINARY_FAULTS.has(fault)) {
        const code = fault === "TIMEOUT" ? "TIMEOUT" : "RESULT_UNKNOWN";
        const result = this.finish({
          started,
          runId,
          capabilityId: ready.record.manifest.id,
          version: ready.record.manifest.version,
          artifactDigest: ready.record.artifactDigest,
          status: "unknown",
          verification: "not_performed",
          data: null,
          completeness: "partial",
          error: failure(
            code,
            "result is unknown and must not be retried as an ordinary failure",
            "not_ordinary",
            false,
          ),
        });
        if (priorWriteMayBeReplayed(result)) {
          throw new Error("write extension must not blind-replay an unknown result", {
            cause: err,
          });
        }
        this.store.record({
          runId: result.runId,
          idempotencyKey: ready.args.idempotencyKey,
          capabilityId: ready.record.manifest.id,
          version: ready.record.manifest.version,
          artifactDigest: ready.record.artifactDigest,
          effect: ready.record.manifest.effect,
          tenantId: ready.binding.tenantId,
          userId: ready.binding.userId,
          bindingId: ready.binding.bindingId,
          payloadDigest: ready.payloadDigest,
          status: "unknown",
          noteId: null,
          contentDigest: null,
          evidenceRef: result.evidenceRef,
          result,
        });
        return result;
      }
      return this.finish({
        started,
        runId,
        capabilityId: ready.record.manifest.id,
        version: ready.record.manifest.version,
        artifactDigest: ready.record.artifactDigest,
        status: "failed",
        verification: "failed",
        data: null,
        completeness: "complete",
        error: failure(fault, fault, "none"),
      });
    }
  }

  private async serial(
    scopeKey: string,
    runId: string,
    task: () => Promise<SiteRunResult>,
  ): Promise<SiteRunResult> {
    if (this.concurrency === "queue") {
      const previous = this.tails.get(scopeKey) ?? Promise.resolve();
      let releaseTail: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        releaseTail = resolve;
      });
      this.tails.set(
        scopeKey,
        previous.then(() => gate),
      );
      await previous;
      try {
        return await this.claimed(scopeKey, runId, task);
      } finally {
        releaseTail();
      }
    }
    return this.claimed(scopeKey, runId, task);
  }

  private async claimed(
    scopeKey: string,
    runId: string,
    task: () => Promise<SiteRunResult>,
  ): Promise<SiteRunResult> {
    const claim = this.options.authority.claim(scopeKey, "sar", runId);
    if (!claim.ok) {
      return this.finish({
        started: this.now(),
        runId,
        capabilityId: "unknown",
        version: "unknown",
        artifactDigest: "",
        status: "failed",
        verification: "failed",
        data: null,
        completeness: "complete",
        error: failure(
          claim.code === "HUMAN_TAKEOVER"
            ? SAR_DENIAL_CODE.humanTakeover
            : SAR_DENIAL_CODE.serialConflict,
          claim.message,
          "none",
        ),
      });
    }
    try {
      return await task();
    } finally {
      this.options.authority.release(scopeKey, "sar", runId);
    }
  }

  private echoConfirmed(
    ready: ReadyWrite,
    started: number,
    confirmation: WriteConfirmation,
    receipt: DraftReceipt,
  ): SiteRunResult {
    return this.finish({
      started,
      capabilityId: ready.record.manifest.id,
      version: ready.record.manifest.version,
      artifactDigest: ready.record.artifactDigest,
      status: "succeeded",
      verification: "passed",
      data: {
        noteId: receipt.noteId,
        title: receipt.title,
        body: receipt.body,
        revision: receipt.revision,
        contentDigest: receipt.contentDigest,
        effect: receipt.effect,
        replayed: false,
        idempotent: true,
        confirmedFromRunId: confirmation.confirmedFromRunId,
      },
      completeness: "complete",
    });
  }

  private echoUnknown(
    ready: ReadyWrite,
    started: number,
    confirmedFromRunId: string,
    code: string,
  ): SiteRunResult {
    const errorCode = code === "TIMEOUT" ? "TIMEOUT" : "RESULT_UNKNOWN";
    return this.finish({
      started,
      capabilityId: ready.record.manifest.id,
      version: ready.record.manifest.version,
      artifactDigest: ready.record.artifactDigest,
      status: "unknown",
      verification: "not_performed",
      data: { replayed: false, confirmedFromRunId },
      completeness: "partial",
      error: failure(
        errorCode,
        "result is unknown and must not be retried as an ordinary failure",
        "not_ordinary",
        false,
      ),
    });
  }

  private finishDenied(
    ready: ReadyWrite,
    started: number,
    code: string,
    message: string,
  ): SiteRunResult {
    return this.finish({
      started,
      capabilityId: ready.record.manifest.id,
      version: ready.record.manifest.version,
      artifactDigest: ready.record.artifactDigest,
      status: "failed",
      verification: "failed",
      data: { replayed: false },
      completeness: "complete",
      error: failure(code, message, "none"),
    });
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private mintRunId(): string {
    return this.options.mintRunId?.() ?? `wrun_${randomUUID()}`;
  }

  private ledgerPartition(ready: ReadyWrite): WriteLedgerPartition {
    return {
      tenantId: ready.binding.tenantId,
      userId: ready.binding.userId,
      bindingId: ready.binding.bindingId,
      capabilityId: ready.record.manifest.id,
      idempotencyKey: ready.args.idempotencyKey,
    };
  }

  private finish(input: {
    started: number;
    runId?: string;
    capabilityId: string;
    version: string;
    artifactDigest: string;
    status: SiteRunStatus;
    verification: SiteVerification;
    data: unknown;
    completeness: SiteCompleteness;
    error?: SiteRunError;
  }): SiteRunResult {
    const runId = input.runId ?? this.mintRunId();
    const evidenceRef = this.options.mintEvidenceRef?.() ?? `ev_${randomUUID()}`;
    return {
      runId,
      capabilityId: input.capabilityId,
      version: input.version,
      status: input.status,
      verification: input.verification,
      data: input.data,
      completeness: input.completeness,
      ...(input.error ? { error: input.error } : {}),
      evidenceRef,
      durationMs: Math.max(0, this.now() - input.started),
      repair: "none",
    };
  }
}

function noteData(
  note: { noteId: string; title: string; body: string; revision: number; contentDigest: string },
  effect: SarWriteEffect,
  idempotent: boolean,
): Record<string, unknown> {
  return {
    noteId: note.noteId,
    title: note.title,
    body: note.body,
    revision: note.revision,
    contentDigest: note.contentDigest,
    effect,
    replayed: false,
    idempotent,
  };
}
