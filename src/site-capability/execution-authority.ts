/**
 * Server-side execution ownership for SAR.
 *
 * Authoritative epoch + generation live in the epoch store. UI lease
 * counters and client-presented generations are not fencing tokens.
 * Human takeover and lease revoke bump the generation so an old run cannot
 * dispatch a new action. Already-dispatched work stays observable and is
 * not reported as fully cancelled.
 */

import { randomUUID } from "node:crypto";
import type { LookupFn, SsrFPolicy } from "../infra/net/ssrf.js";
import { SAR_DENIAL_CODE, sarDeny, type SarDenial } from "./codes.js";
import { parseSiteCapabilityManifest, type SiteCapabilityManifest } from "./contract.js";
import {
  setActiveAccountBrowserDesk,
  type DeskClaimResult,
  type DeskKind,
  type DeskLock,
} from "./desk.js";
import { assertSarNavigationAllowed } from "./navigation.js";
import {
  compileSarOperation,
  executeTrustedOperation,
  TrustedOperationFault,
  type TrustedOpValue,
  type TrustedPagePort,
} from "./operations.js";
import {
  assertOpaquePageTarget,
  denialForForbiddenTarget,
  deriveAccountBrowserScopeKey,
  findForbiddenTargetKey,
  parseAccountBinding,
  type AccountBinding,
  type ServerPrincipal,
  type SessionHandle,
} from "./session-handle.js";

export type PersistedEpoch = {
  epoch: string;
  generation: number;
};

export type EpochStore = {
  load(): PersistedEpoch | null;
  save(state: PersistedEpoch): void;
};

export function memoryEpochStore(initial?: PersistedEpoch | null): EpochStore & {
  peek(): PersistedEpoch | null;
} {
  let state = initial ?? null;
  return {
    load: () => (state ? { ...state } : null),
    save: (next) => {
      state = { epoch: next.epoch, generation: next.generation };
    },
    peek: () => (state ? { ...state } : null),
  };
}

export type InFlightStatus =
  | "dispatched"
  | "dispatched_not_stopped"
  | "finished"
  | "finished_after_cancel_request"
  | "finished_after_invalidation";

export type InFlightAction = {
  actionId: string;
  op: string;
  status: InFlightStatus;
};

type RunStatus = "active" | "cancel_requested" | "completed" | "invalidated";

type RunRecord = {
  runId: string;
  handleToken: string;
  scopeKey: string;
  pageTargetId: string;
  bindingId: string;
  capabilityId: string;
  capabilityVersion?: string;
  epoch: string;
  generation: number;
  status: RunStatus;
  inFlight: InFlightAction[];
};

type HandleRecord = {
  token: string;
  binding: AccountBinding;
  principal: ServerPrincipal;
  scopeKey: string;
  pageTargetId: string;
};

export type SarBootResult = {
  epoch: string;
  generation: number;
  previousEpoch: string | null;
  previousGeneration: number | null;
};

export type SarCancelObservation = {
  ok: true;
  runId: string;
  completeCancel: false;
  newActionsAccepted: false;
  notStopped: Array<{ actionId: string; op: string; status: "dispatched_not_stopped" }>;
};

export type SarRunObservation = {
  ok: true;
  runId: string;
  status: RunStatus;
  epoch: string;
  generation: number;
  currentEpoch: string;
  currentGeneration: number;
  scopeKey: string;
  pageTargetId: string;
  inFlight: InFlightAction[];
  completeCancel: false;
};

export type SarDispatchSuccess = {
  ok: true;
  runId: string;
  actionId: string;
  value: TrustedOpValue;
  inFlightStatus: InFlightStatus;
  completeCancel: false;
};

export type SarAuthorityOptions = {
  now?: () => number;
  mintEpoch?: () => string;
  mintToken?: () => string;
  lookupFn?: LookupFn;
  ssrfPolicy?: SsrFPolicy;
};

const FENCE_FIELDS = ["uiLeaseGeneration", "presentedEpoch", "presentedGeneration"] as const;

export class SarExecutionAuthority {
  private epoch = "";
  private generation = 0;
  private booted = false;
  private readonly bindings = new Map<string, AccountBinding>();
  private readonly capabilities = new Map<string, SiteCapabilityManifest>();
  private readonly handles = new Map<string, HandleRecord>();
  private readonly runs = new Map<string, RunRecord>();
  private readonly locks = new Map<string, DeskLock>();

  constructor(
    private readonly store: EpochStore,
    private readonly options: SarAuthorityOptions = {},
  ) {}

  boot(): SarBootResult {
    const previous = this.store.load();
    const epoch = previous?.epoch ?? (this.options.mintEpoch ?? (() => `epoch_${randomUUID()}`))();
    const generation = (previous?.generation ?? 0) + 1;
    this.epoch = epoch;
    this.generation = generation;
    this.booted = true;
    this.runs.clear();
    this.handles.clear();
    this.locks.clear();
    this.store.save({ epoch, generation });
    setActiveAccountBrowserDesk(this);
    return {
      epoch,
      generation,
      previousEpoch: previous?.epoch ?? null,
      previousGeneration: previous?.generation ?? null,
    };
  }

  dispose(): void {
    setActiveAccountBrowserDesk(null);
  }

  fencing(): { epoch: string; generation: number } {
    return { epoch: this.epoch, generation: this.generation };
  }

  registerBinding(raw: unknown): { ok: true; binding: AccountBinding } | SarDenial {
    const parsed = parseAccountBinding(raw);
    if (!parsed.ok) {
      return parsed;
    }
    const scopeKey = deriveAccountBrowserScopeKey(parsed.binding.tenantId, parsed.binding.userId);
    if (!scopeKey) {
      return sarDeny(SAR_DENIAL_CODE.bindingNotFound, "account browser scope could not be derived");
    }
    this.bindings.set(parsed.binding.bindingId, parsed.binding);
    return parsed;
  }

  registerCapability(raw: unknown): { ok: true; manifest: SiteCapabilityManifest } | SarDenial {
    const parsed = parseSiteCapabilityManifest(raw);
    if (!parsed.ok) {
      return parsed;
    }
    this.capabilities.set(parsed.manifest.id, parsed.manifest);
    this.capabilities.set(`${parsed.manifest.id}@${parsed.manifest.version}`, parsed.manifest);
    return parsed;
  }

  resolveSessionHandle(input: {
    principal: ServerPrincipal;
    bindingId: string;
    pageTargetId: string;
    adapterInput?: unknown;
  }): { ok: true; handle: SessionHandle; scopeKey: string } | SarDenial {
    const ready = this.requireBoot();
    if (ready) {
      return ready;
    }
    if (input.adapterInput !== undefined) {
      const forbidden = findForbiddenTargetKey(input.adapterInput);
      if (forbidden) {
        return denialForForbiddenTarget(forbidden);
      }
    }
    const targetError = assertOpaquePageTarget(input.pageTargetId);
    if (targetError) {
      return targetError;
    }
    const binding = this.bindings.get(input.bindingId);
    if (!binding) {
      return sarDeny(SAR_DENIAL_CODE.bindingNotFound, "account binding is not registered");
    }
    if (
      binding.tenantId !== input.principal.tenantId ||
      binding.userId !== input.principal.userId
    ) {
      return sarDeny(
        SAR_DENIAL_CODE.crossAccount,
        "principal cannot use another tenant or user binding",
      );
    }
    const scopeKey = deriveAccountBrowserScopeKey(binding.tenantId, binding.userId);
    if (!scopeKey) {
      return sarDeny(SAR_DENIAL_CODE.bindingNotFound, "account browser scope could not be derived");
    }
    const token = (this.options.mintToken ?? (() => `sarh_${randomUUID()}`))();
    const handle: SessionHandle = Object.freeze({ token });
    this.handles.set(token, {
      token,
      binding,
      principal: { tenantId: input.principal.tenantId, userId: input.principal.userId },
      scopeKey,
      pageTargetId: input.pageTargetId,
    });
    return { ok: true, handle, scopeKey };
  }

  bindRun(input: {
    handleToken: string;
    runId: string;
    capabilityId: string;
    /** Fixed manifest version. Omitted only for the P0 capability-id gate. */
    version?: string;
  }): { ok: true; runId: string; epoch: string; generation: number; scopeKey: string } | SarDenial {
    const ready = this.requireBoot();
    if (ready) {
      return ready;
    }
    const handle = this.handles.get(input.handleToken);
    if (!handle) {
      return sarDeny(
        SAR_DENIAL_CODE.handleInvalid,
        "session handle is unknown to this server epoch",
      );
    }
    const version = input.version?.trim() || undefined;
    const registered = version
      ? this.capabilities.get(`${input.capabilityId}@${version}`)
      : this.capabilities.get(input.capabilityId);
    if (!registered) {
      return sarDeny(SAR_DENIAL_CODE.invalidManifest, "capability is not registered");
    }
    const claim = this.claim(handle.scopeKey, "sar", input.runId);
    if (!claim.ok) {
      return sarDeny(
        claim.code === "HUMAN_TAKEOVER"
          ? SAR_DENIAL_CODE.humanTakeover
          : SAR_DENIAL_CODE.serialConflict,
        claim.message,
      );
    }
    const run: RunRecord = {
      runId: input.runId,
      handleToken: input.handleToken,
      scopeKey: handle.scopeKey,
      pageTargetId: handle.pageTargetId,
      bindingId: handle.binding.bindingId,
      capabilityId: input.capabilityId,
      capabilityVersion: version,
      epoch: this.epoch,
      generation: this.generation,
      status: "active",
      inFlight: [],
    };
    this.runs.set(input.runId, run);
    return {
      ok: true,
      runId: run.runId,
      epoch: run.epoch,
      generation: run.generation,
      scopeKey: run.scopeKey,
    };
  }

  /**
   * Action-dispatch boundary. Ownership is re-checked here, not only at bind.
   * Client epoch / generation / UI lease values are ignored for authorization.
   */
  async dispatch(input: {
    runId: string;
    handleToken: string;
    rawOp: unknown;
    port: TrustedPagePort;
    productEvaluateEnabled?: boolean;
    uiLeaseGeneration?: number;
    presentedEpoch?: string;
    presentedGeneration?: number;
  }): Promise<SarDispatchSuccess | SarDenial> {
    const ready = this.requireBoot();
    if (ready) {
      return ready;
    }
    const run = this.runs.get(input.runId);
    if (!run) {
      if (this.presentedFence(input)) {
        return sarDeny(
          SAR_DENIAL_CODE.uiFence,
          "UI lease counters and client-presented epoch/generation are not fencing tokens",
        );
      }
      return sarDeny(SAR_DENIAL_CODE.runNotBound, "run is not bound on this server");
    }
    if (run.handleToken !== input.handleToken) {
      return sarDeny(SAR_DENIAL_CODE.handleInvalid, "session handle does not match the bound run");
    }
    const boundary = this.checkDispatchBoundary(run);
    if (boundary) {
      return boundary;
    }
    const compiled = compileSarOperation(input.rawOp, {
      productEvaluateEnabled: input.productEvaluateEnabled,
    });
    if (!compiled.ok) {
      return compiled;
    }
    const manifest = this.manifestFor(run);
    if (!manifest || !manifest.permissions.includes(compiled.operation.kind)) {
      return sarDeny(SAR_DENIAL_CODE.policyDenied, "capability does not permit this operation");
    }
    if (compiled.operation.kind === "navigate") {
      const nav = await assertSarNavigationAllowed({
        url: compiled.operation.url,
        allowedOrigins: manifest.allowedOrigins,
        policy: this.options.ssrfPolicy ? { ssrfPolicy: this.options.ssrfPolicy } : undefined,
        lookupFn: this.options.lookupFn,
      });
      if (!nav.ok) {
        return nav;
      }
    }
    const again = this.checkDispatchBoundary(run);
    if (again) {
      return again;
    }
    const action: InFlightAction = {
      actionId: `act_${randomUUID()}`,
      op: compiled.operation.kind,
      status: "dispatched",
    };
    run.inFlight.push(action);
    try {
      const value = await executeTrustedOperation(compiled.operation, input.port);
      action.status = this.finishStatus(run);
      return {
        ok: true,
        runId: run.runId,
        actionId: action.actionId,
        value,
        inFlightStatus: action.status,
        completeCancel: false,
      };
    } catch (err) {
      if (run.status === "active") {
        action.status = "finished";
      } else {
        action.status = "dispatched_not_stopped";
      }
      if (err instanceof TrustedOperationFault) {
        return sarDeny(SAR_DENIAL_CODE.operationFault, err.fault);
      }
      const message = err instanceof Error ? err.message : "operation failed";
      return sarDeny(SAR_DENIAL_CODE.operationFault, message);
    }
  }

  cancel(runId: string): SarCancelObservation | SarDenial {
    const run = this.runs.get(runId);
    if (!run) {
      return sarDeny(SAR_DENIAL_CODE.runNotBound, "run is not bound on this server");
    }
    run.status = "cancel_requested";
    const notStopped: SarCancelObservation["notStopped"] = [];
    for (const action of run.inFlight) {
      if (action.status === "dispatched") {
        action.status = "dispatched_not_stopped";
        notStopped.push({
          actionId: action.actionId,
          op: action.op,
          status: "dispatched_not_stopped",
        });
      }
    }
    return {
      ok: true,
      runId,
      completeCancel: false,
      newActionsAccepted: false,
      notStopped,
    };
  }

  observe(runId: string): SarRunObservation | SarDenial {
    const run = this.runs.get(runId);
    if (!run) {
      return sarDeny(SAR_DENIAL_CODE.runNotBound, "run is not bound on this server");
    }
    return {
      ok: true,
      runId: run.runId,
      status: run.status,
      epoch: run.epoch,
      generation: run.generation,
      currentEpoch: this.epoch,
      currentGeneration: this.generation,
      scopeKey: run.scopeKey,
      pageTargetId: run.pageTargetId,
      inFlight: run.inFlight.map((action) => ({ ...action })),
      completeCancel: false,
    };
  }

  humanTakeover(scopeKey: string, humanSessionKey: string): { epoch: string; generation: number } {
    const session = humanSessionKey.trim() || "human";
    this.bumpGeneration();
    this.locks.set(scopeKey, { kind: "human", runId: session });
    this.invalidateScope(scopeKey);
    return this.fencing();
  }

  revokeLease(scopeKey: string): { epoch: string; generation: number } {
    this.bumpGeneration();
    const lock = this.locks.get(scopeKey);
    if (lock?.kind !== "human") {
      this.locks.delete(scopeKey);
    }
    this.invalidateScope(scopeKey);
    return this.fencing();
  }

  handBack(scopeKey: string): void {
    const lock = this.locks.get(scopeKey);
    if (lock?.kind === "human") {
      this.locks.delete(scopeKey);
    }
  }

  releaseRun(runId: string): void {
    const run = this.runs.get(runId);
    if (!run) {
      return;
    }
    if (run.status === "active") {
      run.status = "completed";
    }
    const lock = this.locks.get(run.scopeKey);
    if (lock && lock.runId === runId && lock.kind !== "human") {
      this.locks.delete(run.scopeKey);
    }
  }

  release(scopeKey: string, kind: Exclude<DeskKind, "human">, runId: string): void {
    const lock = this.locks.get(scopeKey);
    if (lock && lock.kind === kind && lock.runId === runId) {
      this.locks.delete(scopeKey);
    }
  }

  claim(scopeKey: string, kind: Exclude<DeskKind, "human">, runId: string): DeskClaimResult {
    const lock = this.locks.get(scopeKey);
    if (lock?.kind === "human") {
      return {
        ok: false,
        code: "HUMAN_TAKEOVER",
        message: "human takeover holds the account browser",
      };
    }
    if (lock && (lock.runId !== runId || lock.kind !== kind)) {
      return {
        ok: false,
        code: "SERIAL_CONFLICT",
        message: `account browser is held by ${lock.kind}:${lock.runId}`,
      };
    }
    this.locks.set(scopeKey, { kind, runId });
    return { ok: true };
  }

  private manifestFor(run: RunRecord): SiteCapabilityManifest | undefined {
    if (run.capabilityVersion) {
      return this.capabilities.get(`${run.capabilityId}@${run.capabilityVersion}`);
    }
    return this.capabilities.get(run.capabilityId);
  }

  private presentedFence(input: {
    uiLeaseGeneration?: number;
    presentedEpoch?: string;
    presentedGeneration?: number;
  }): boolean {
    return FENCE_FIELDS.some((field) => input[field] !== undefined);
  }

  private requireBoot(): SarDenial | null {
    if (!this.booted) {
      return sarDeny(SAR_DENIAL_CODE.notBooted, "execution authority has not booted");
    }
    return null;
  }

  private checkDispatchBoundary(run: RunRecord): SarDenial | null {
    const lock = this.locks.get(run.scopeKey);
    if (lock?.kind === "human") {
      return sarDeny(
        SAR_DENIAL_CODE.humanTakeover,
        "human takeover rejected a new action on the old run",
      );
    }
    if (run.epoch !== this.epoch || run.generation !== this.generation) {
      return sarDeny(
        SAR_DENIAL_CODE.staleGeneration,
        "run epoch/generation does not match the server fencing token",
      );
    }
    if (run.status === "cancel_requested") {
      return sarDeny(SAR_DENIAL_CODE.cancelRequested, "run is not accepting new actions");
    }
    if (run.status === "invalidated") {
      return sarDeny(
        SAR_DENIAL_CODE.staleGeneration,
        "run was invalidated by takeover or lease revoke",
      );
    }
    if (run.status !== "active") {
      return sarDeny(SAR_DENIAL_CODE.runNotBound, "run is not active");
    }
    if (lock && (lock.runId !== run.runId || lock.kind !== "sar")) {
      return sarDeny(SAR_DENIAL_CODE.serialConflict, "account browser is held by another dispatch");
    }
    return null;
  }

  private finishStatus(run: RunRecord): InFlightStatus {
    if (run.status === "cancel_requested") {
      return "finished_after_cancel_request";
    }
    if (run.status === "invalidated") {
      return "finished_after_invalidation";
    }
    return "finished";
  }

  private bumpGeneration(): void {
    this.generation += 1;
    this.store.save({ epoch: this.epoch, generation: this.generation });
  }

  private invalidateScope(scopeKey: string): void {
    for (const run of this.runs.values()) {
      if (run.scopeKey !== scopeKey) {
        continue;
      }
      if (run.status === "active" || run.status === "cancel_requested") {
        run.status = "invalidated";
      }
      for (const action of run.inFlight) {
        if (action.status === "dispatched") {
          action.status = "dispatched_not_stopped";
        }
      }
    }
  }
}
