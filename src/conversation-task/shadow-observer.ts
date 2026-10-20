/**
 * ConversationTask Runtime — P2.5 passive shadow observer + runtime (admission §5 AC2/AC5;
 * design §1/§2).
 *
 * The single passive entry point the gateway calls (fire-and-forget) for each
 * authenticated inbound turn. It runs the frozen chain and stops:
 *
 *   authenticated server context -> trusted tenant -> employee/workbench scope
 *   -> conversation ACL -> detection secondary scope -> detection -> qualification
 *   -> tenant-HMAC shadow log (via the async runner) -> bounded metrics -> stop
 *
 * Guarantees:
 *  - **Passive**: never returns/alters a reply, never touches the dispatcher or the
 *    MsgContext; `observe()` reads a small readonly view and returns a status.
 *  - **Fail-closed**: no trusted tenant, not allow-listed, detection flag OFF, or any
 *    ACL/scope rejection => skip (no shadow write). Every path is wrapped so the
 *    observer never throws into the caller.
 *  - **Never enters the Activation layer**: no `runActivationGate`, no `openTaskStore`,
 *    no Candidate/Task, no Ledger, no Agent. The chain ends at the shadow log.
 *  - **Bounded + async**: the shadow write is handed to `ShadowRunner` (bounded queue,
 *    drop-new, per-item timeout, bounded shutdown), so a slow/failed write cannot slow
 *    or break chat.
 */

import {
  assertConversationTaskAccess,
  assertDetectionScope,
  type ConversationTaskAccess,
} from "./acl.js";
import { evaluateTurn } from "./replay.js";
import { ShadowRunner, type ShadowRunnerEvent } from "./shadow-runner.js";
import { ShadowLogBook, type TenantHmacKeyProvider } from "./shadow.js";
import type { ConversationTurnInput } from "./types.js";

/** Server-derived authenticated context. Every field comes from the gateway, never the client. */
export type ShadowServerContext = {
  /** Trusted tenant id (server-resolved). `null`/empty => skip (fail-closed). */
  tenantId: string | null | undefined;
  /** Authenticated principal id. */
  requesterId: string | null | undefined;
  /** Current authorized conversation id (= SessionKey). */
  conversationId: string | null | undefined;
  /** Server-side visibility set; the passive single-conversation minimum is `{ conversationId }`. */
  authorizedConversationIds: ReadonlySet<string>;
  /** Server-side employee/workbench scope decision. */
  employeeScopeAllowed: boolean;
};

/** The inbound turn, already normalized by the caller (never the raw MsgContext). */
export type ShadowTurn = ConversationTurnInput;

export type ShadowObserveStatus =
  | "observed"
  | "skipped_flag_off"
  | "skipped_no_trusted_tenant"
  | "skipped_not_allowlisted"
  | "skipped_scope_rejected"
  | "error";

export type ShadowMetricEvent =
  | { type: "invocation" }
  | { type: "observe"; status: ShadowObserveStatus }
  | { type: "runner"; event: ShadowRunnerEvent }
  | { type: "write"; outcome: "inserted" | "duplicate" }
  | { type: "write_error"; code: string };

/** A shadow-write job handed to the async runner. */
export type ShadowJob = {
  tenantId: string;
  conversationId: string;
  messageId: string;
  /** Raw text — used only to compute the keyed fingerprint in the store; never persisted. */
  text: string;
  turn: ConversationTurnInput;
};

export type ShadowObserverDeps = {
  /** Detection flag, read through the hot cache (config source). */
  isDetectionEnabled: () => boolean;
  /** Tenant allowlist membership, read through the hot cache. */
  isTenantAllowed: (tenantId: string) => boolean;
  /** Enqueue the shadow write (bound to ShadowRunner.submit). */
  submitShadow: (job: ShadowJob) => "queued" | "dropped";
  onMetric?: (event: ShadowMetricEvent) => void;
};

function isTrusted(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * Passive shadow observer. `observe()` is synchronous, non-throwing, and only ever
 * reads its inputs — it decides whether to enqueue a shadow write and returns why.
 */
export class ShadowObserver {
  private readonly deps: ShadowObserverDeps;

  constructor(deps: ShadowObserverDeps) {
    this.deps = deps;
  }

  private emit(event: ShadowMetricEvent): void {
    try {
      this.deps.onMetric?.(event);
    } catch {
      // metrics must never break the observer
    }
  }

  private finish(status: ShadowObserveStatus): ShadowObserveStatus {
    this.emit({ type: "observe", status });
    return status;
  }

  observe(ctx: ShadowServerContext, turn: ShadowTurn): ShadowObserveStatus {
    this.emit({ type: "invocation" });
    try {
      // 1) trusted tenant (channel inbound without a resolved tenant => skip, fail-closed)
      if (!isTrusted(ctx.tenantId)) {
        return this.finish("skipped_no_trusted_tenant");
      }
      const tenantId = ctx.tenantId;
      // 2) internal allowlist (default empty / read-fail => not allowed)
      if (!this.deps.isTenantAllowed(tenantId)) {
        return this.finish("skipped_not_allowlisted");
      }
      // 3) detection flag OFF => no behavior at all
      if (!this.deps.isDetectionEnabled()) {
        return this.finish("skipped_flag_off");
      }
      if (!isTrusted(ctx.conversationId)) {
        return this.finish("skipped_scope_rejected");
      }
      const conversationId = ctx.conversationId;
      // 4) fail-closed ACL + 5) detection secondary scope (server-supplied scope only)
      const access: ConversationTaskAccess = {
        tenantId,
        conversationId,
        requesterId: isTrusted(ctx.requesterId) ? ctx.requesterId : "",
        authorizedConversationIds: ctx.authorizedConversationIds,
        employeeScopeAllowed: ctx.employeeScopeAllowed,
      };
      try {
        assertConversationTaskAccess(access);
        assertDetectionScope(access, conversationId);
      } catch {
        return this.finish("skipped_scope_rejected");
      }
      // 6/7) detection + qualification are pure; 8) hand the write to the bounded runner.
      const job: ShadowJob = {
        tenantId,
        conversationId,
        messageId: turn.messageId,
        text: turn.text,
        turn,
      };
      this.deps.submitShadow(job);
      return this.finish("observed");
    } catch {
      // The chain must never throw into the reply path.
      return this.finish("error");
    }
  }
}

/**
 * Per-tenant ShadowLogBook registry: opens each tenant's book **once** and reuses the
 * single connection (never a DB per message). Used by the runner's write handler.
 */
export class ShadowBookRegistry {
  private readonly books = new Map<string, ShadowLogBook>();
  private readonly keyProvider: TenantHmacKeyProvider;
  private readonly storeRoot?: string;
  private readonly now?: () => number;

  constructor(options: {
    keyProvider: TenantHmacKeyProvider;
    storeRoot?: string;
    now?: () => number;
  }) {
    this.keyProvider = options.keyProvider;
    this.storeRoot = options.storeRoot;
    this.now = options.now;
  }

  book(tenantId: string): ShadowLogBook {
    let book = this.books.get(tenantId);
    if (!book) {
      book = new ShadowLogBook({
        tenantId,
        keyProvider: this.keyProvider,
        ...(this.storeRoot ? { storeRoot: this.storeRoot } : undefined),
        ...(this.now ? { now: this.now } : undefined),
      });
      this.books.set(tenantId, book);
    }
    return book;
  }

  closeAll(): void {
    for (const book of this.books.values()) {
      try {
        book.close();
      } catch {
        // ignore
      }
    }
    this.books.clear();
  }
}

/**
 * Build the runner write handler: for each job, evaluate the turn (pure) and append a
 * shadow log to the tenant's reused book. The store enforces keyed fingerprint, HMAC id
 * columns and composite-unique idempotency; a missing/expired HMAC key throws here and is
 * captured by the runner as a failure (chat unaffected). Emits write / write_error metrics.
 */
export function makeShadowWriteHandler(
  registry: ShadowBookRegistry,
  onMetric?: (event: ShadowMetricEvent) => void,
): (job: ShadowJob) => void {
  return (job: ShadowJob) => {
    const decision = evaluateTurn(job.turn);
    try {
      const stored = registry.book(job.tenantId).append({
        conversationId: job.conversationId,
        messageId: job.messageId,
        text: job.text,
        log: decision.log,
      });
      onMetric?.({ type: "write", outcome: stored.inserted ? "inserted" : "duplicate" });
    } catch (err) {
      const code =
        err instanceof Error && "code" in err ? String((err as { code: unknown }).code) : "unknown";
      onMetric?.({ type: "write_error", code });
      throw err; // let the runner record a failure event (fail-safe: never reaches chat)
    }
  };
}

export type ShadowRuntime = {
  observer: ShadowObserver;
  runner: ShadowRunner<ShadowJob>;
  registry: ShadowBookRegistry;
  shutdown: (capMs?: number) => Promise<void>;
};

export type CreateShadowRuntimeOptions = {
  isDetectionEnabled: () => boolean;
  isTenantAllowed: (tenantId: string) => boolean;
  keyProvider: TenantHmacKeyProvider;
  storeRoot?: string;
  now?: () => number;
  onMetric?: (event: ShadowMetricEvent) => void;
  maxQueue?: number;
  maxConcurrency?: number;
  itemTimeoutMs?: number;
};

/** Wire config caches + runner + per-tenant book registry + observer into one runtime. */
export function createShadowRuntime(options: CreateShadowRuntimeOptions): ShadowRuntime {
  const registry = new ShadowBookRegistry({
    keyProvider: options.keyProvider,
    ...(options.storeRoot ? { storeRoot: options.storeRoot } : undefined),
    ...(options.now ? { now: options.now } : undefined),
  });
  const handler = makeShadowWriteHandler(registry, options.onMetric);
  const runner = new ShadowRunner<ShadowJob>({
    handler,
    ...(options.maxQueue != null ? { maxQueue: options.maxQueue } : undefined),
    ...(options.maxConcurrency != null ? { maxConcurrency: options.maxConcurrency } : undefined),
    ...(options.itemTimeoutMs != null ? { itemTimeoutMs: options.itemTimeoutMs } : undefined),
    onEvent: (event) => options.onMetric?.({ type: "runner", event }),
  });
  const observer = new ShadowObserver({
    isDetectionEnabled: options.isDetectionEnabled,
    isTenantAllowed: options.isTenantAllowed,
    submitShadow: (job) => runner.submit(job),
    ...(options.onMetric ? { onMetric: options.onMetric } : undefined),
  });
  return {
    observer,
    runner,
    registry,
    shutdown: async (capMs?: number) => {
      await runner.shutdown(capMs);
      registry.closeAll();
    },
  };
}
