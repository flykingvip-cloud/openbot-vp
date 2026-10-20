/**
 * Phase 6 — in-process conversation diagnosis state machine.
 * Orchestrates ask/pause/authorize/resume/cancel/timeout.
 * Does not call live Da Bai, write the chat transcript, or execute repair.
 */
import { getEvidenceSourceManifest } from "./catalog.js";
import {
  formatConversationDiagnosisQuestion,
  formatConversationDiagnosisStatus,
  type ConversationLiveChatOutbound,
} from "./conversation-live.js";
import {
  isDiagnosisDaibaiRoute,
  routeDiagnosisDaibaiDelivery,
  type DiagnosisDaibaiDeliveryAuth,
  type DiagnosisDaibaiDeliveryQueue,
} from "./daibai-delivery.js";
import { isPhase1Diagnoser } from "./diagnosers.js";
import { isPhase2Diagnoser } from "./phase2.js";
import type { DiagnosticSignal } from "./signal.js";
import {
  DiagnosisContractError,
  validateDiagnosticPrincipal,
  validateDiagnosticTarget,
  type DiagnosticPrincipal,
  type DiagnosticTarget,
  type EvidenceSourceId,
  type TrustedTenantContext,
} from "./types.js";

export const CONVERSATION_DIAGNOSIS_SCHEMA_VERSION = 1 as const;
export const CONVERSATION_DIAGNOSIS_TTL_MS = 60 * 60 * 1000;

export const CONVERSATION_DIAGNOSIS_STATES = [
  "DETECTED",
  "TRIAGING",
  "COLLECTING_EVIDENCE",
  "DIAGNOSING",
  "WAITING_AUTHORIZATION",
  "VERIFYING",
  "RESOLVED",
  "INCONCLUSIVE",
  "ESCALATED",
  "CANCELLED",
] as const;
export type ConversationDiagnosisState = (typeof CONVERSATION_DIAGNOSIS_STATES)[number];

export const CONVERSATION_DIAGNOSIS_COMMANDS = [
  "start",
  "ask",
  "answer",
  "pause",
  "resume",
  "approve",
  "deny",
  "cancel",
  "timeout",
] as const;
export type ConversationDiagnosisCommand = (typeof CONVERSATION_DIAGNOSIS_COMMANDS)[number];

const TERMINAL_STATES = new Set<ConversationDiagnosisState>([
  "RESOLVED",
  "INCONCLUSIVE",
  "ESCALATED",
  "CANCELLED",
]);

const HAPPY_PATH: Partial<Record<ConversationDiagnosisState, ConversationDiagnosisState>> = {
  DETECTED: "TRIAGING",
  TRIAGING: "COLLECTING_EVIDENCE",
  COLLECTING_EVIDENCE: "DIAGNOSING",
  DIAGNOSING: "VERIFYING",
  VERIFYING: "RESOLVED",
};

export type ConversationPendingQuestion = {
  questionId: string;
  text: string;
};

export type ConversationAuthorization = {
  authorizationId: string;
  capability: string;
  expiresAt: string;
  status: "pending" | "granted" | "denied" | "expired" | "revoked";
  grantedAt?: string;
  grantId?: string;
  missionId?: string;
};

export type ConversationGrantInspector = {
  inspect(grantId: string): { status: string };
};

export type ConversationLayeredRefs = {
  evidenceRefs: string[];
  findingRefs: string[];
  hypothesisRefs: string[];
  recommendationRefs: string[];
};

export type ConversationDiagnosisAuditEvent = {
  transitionId: string;
  commandId: string;
  command: ConversationDiagnosisCommand;
  from: ConversationDiagnosisState;
  to: ConversationDiagnosisState;
  at: string;
  principalId: string;
  reason?: string;
};

export type ConversationDiagnosisRun = {
  schemaVersion: 1;
  conversationRunId: string;
  signalId: string;
  caseId?: string;
  target: DiagnosticTarget;
  tenantId: string | null;
  principal: DiagnosticPrincipal;
  state: ConversationDiagnosisState;
  currentStep: string;
  pendingQuestion?: ConversationPendingQuestion;
  requiredAuthorization?: ConversationAuthorization;
  paused: boolean;
  resumeState?: ConversationDiagnosisState;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  lastEvidenceRefs: string[];
  lastFindingRefs: string[];
  hypothesisRefs: string[];
  recommendationRefs: string[];
  knownEvidenceIds: string[];
  knownFindingIds: string[];
  audit: ConversationDiagnosisAuditEvent[];
};

export type ConversationDiagnosisCommandInput = {
  commandId: string;
  command: ConversationDiagnosisCommand;
  conversationRunId?: string;
  principal: DiagnosticPrincipal;
  trusted: TrustedTenantContext;
  signal?: DiagnosticSignal;
  caseId?: string;
  question?: string;
  answer?: string;
  evidenceRefs?: string[];
  findingRefs?: string[];
  hypothesisRef?: string;
  recommendationRef?: string;
  diagnoserId?: string;
  evidenceSourceId?: string;
  authorization?: Omit<ConversationAuthorization, "status" | "grantedAt">;
  escalate?: boolean;
  daibaiAuth?: DiagnosisDaibaiDeliveryAuth;
};

export type ConversationDiagnosisReceipt = {
  commandId: string;
  transitionId: string;
  conversationRunId: string;
  state: ConversationDiagnosisState;
  idempotent: boolean;
  reason?: string;
};

export type ConversationDiagnosisStore = {
  get(conversationRunId: string): ConversationDiagnosisRun | undefined;
  put(run: ConversationDiagnosisRun): void;
  findOpen(
    tenantId: string | null,
    principalId: string,
    signalId: string,
  ): ConversationDiagnosisRun | undefined;
  getCommand(commandId: string): ConversationDiagnosisReceipt | undefined;
  putCommand(commandId: string, receipt: ConversationDiagnosisReceipt): void;
  list(tenantId?: string | null): ConversationDiagnosisRun[];
};

export type ConversationDiagnosisMachine = {
  dispatch(input: ConversationDiagnosisCommandInput): ConversationDiagnosisReceipt;
  get(conversationRunId: string): ConversationDiagnosisRun | undefined;
  restore(
    snapshot: ConversationDiagnosisRun,
    trusted: TrustedTenantContext,
  ): ConversationDiagnosisRun;
  list(tenantId?: string | null): ConversationDiagnosisRun[];
};

export function isConversationDiagnosisTerminal(state: ConversationDiagnosisState): boolean {
  return TERMINAL_STATES.has(state);
}

export function isRegisteredConversationDiagnoser(id: string): boolean {
  return isPhase1Diagnoser(id) || isPhase2Diagnoser(id);
}

export function isRegisteredConversationEvidenceSource(id: string): boolean {
  try {
    getEvidenceSourceManifest(id as EvidenceSourceId);
    return true;
  } catch {
    return false;
  }
}

export function createMemoryConversationDiagnosisStore(): ConversationDiagnosisStore {
  const runs = new Map<string, ConversationDiagnosisRun>();
  const commands = new Map<string, ConversationDiagnosisReceipt>();
  return {
    get: (id) => runs.get(id),
    put: (run) => {
      runs.set(run.conversationRunId, run);
    },
    findOpen: (tenantId, principalId, signalId) => {
      for (const run of runs.values()) {
        if (
          run.tenantId === tenantId &&
          run.principal.principalId === principalId &&
          run.signalId === signalId &&
          !TERMINAL_STATES.has(run.state)
        ) {
          return run;
        }
      }
      return undefined;
    },
    getCommand: (commandId) => commands.get(commandId),
    putCommand: (commandId, receipt) => {
      commands.set(commandId, receipt);
    },
    list: (tenantId) =>
      [...runs.values()].filter((run) => tenantId === undefined || run.tenantId === tenantId),
  };
}

export function createConversationDiagnosisMachine(
  deps: {
    now?: () => number;
    ttlMs?: number;
    store?: ConversationDiagnosisStore;
    delivery?: DiagnosisDaibaiDeliveryQueue;
    liveChat?: ConversationLiveChatOutbound;
    grantInspector?: ConversationGrantInspector;
  } = {},
): ConversationDiagnosisMachine {
  const now = deps.now ?? Date.now;
  const ttlMs = deps.ttlMs ?? CONVERSATION_DIAGNOSIS_TTL_MS;
  const store = deps.store ?? createMemoryConversationDiagnosisStore();

  function fail(code: string, message: string, path = "command"): never {
    throw new DiagnosisContractError(code, message, path);
  }

  const stepFor = (state: ConversationDiagnosisState): string => {
    if (state === "WAITING_AUTHORIZATION") {
      return "authorize";
    }
    if (state === "COLLECTING_EVIDENCE") {
      return "collect";
    }
    if (TERMINAL_STATES.has(state)) {
      return "close";
    }
    return state.toLowerCase();
  };

  const assertActor = (run: ConversationDiagnosisRun, input: ConversationDiagnosisCommandInput) => {
    const principal = validateDiagnosticPrincipal(input.principal, input.trusted, "principal");
    if (principal.principalId !== run.principal.principalId) {
      fail("principal_mismatch", "conversation run principal does not match", "principal");
    }
    if (principal.tenantId !== run.tenantId || input.trusted.tenantId !== run.tenantId) {
      fail("tenant_mismatch", "conversation run tenant does not match", "tenantId");
    }
  };

  const refreshAuth = (run: ConversationDiagnosisRun, nowMs: number): ConversationDiagnosisRun => {
    const auth = run.requiredAuthorization;
    if (!auth || (auth.status !== "pending" && auth.status !== "granted")) {
      return run;
    }
    if (Date.parse(auth.expiresAt) <= nowMs) {
      return {
        ...run,
        requiredAuthorization: { ...auth, status: "expired" },
        updatedAt: toIso(nowMs),
      };
    }
    if (auth.grantId && deps.grantInspector) {
      const inspected = deps.grantInspector.inspect(auth.grantId).status;
      if (inspected === "EXPIRED") {
        return {
          ...run,
          requiredAuthorization: { ...auth, status: "expired" },
          updatedAt: toIso(nowMs),
        };
      }
      if (inspected === "REVOKED") {
        return {
          ...run,
          requiredAuthorization: { ...auth, status: "revoked" },
          updatedAt: toIso(nowMs),
        };
      }
      if (inspected === "DENIED") {
        return {
          ...run,
          requiredAuthorization: { ...auth, status: "denied" },
          updatedAt: toIso(nowMs),
        };
      }
    }
    return run;
  };

  const persist = (
    run: ConversationDiagnosisRun,
    input: ConversationDiagnosisCommandInput,
    from: ConversationDiagnosisState,
    reason?: string,
    idempotent = false,
  ): ConversationDiagnosisReceipt => {
    const transitionId = `txn:${input.commandId}`;
    const next: ConversationDiagnosisRun = {
      ...run,
      currentStep: stepFor(run.state),
      updatedAt: toIso(now()),
      audit:
        idempotent || (from === run.state && !reason)
          ? run.audit
          : [
              ...run.audit,
              {
                transitionId,
                commandId: input.commandId,
                command: input.command,
                from,
                to: run.state,
                at: toIso(now()),
                principalId: input.principal.principalId,
                ...(reason ? { reason } : {}),
              },
            ],
    };
    store.put(next);
    if (deps.liveChat && !idempotent) {
      if (next.pendingQuestion?.text && input.command === "ask") {
        void deps.liveChat.publish(formatConversationDiagnosisQuestion(next.pendingQuestion.text));
      }
      if (TERMINAL_STATES.has(next.state) && from !== next.state) {
        void deps.liveChat.publish(
          formatConversationDiagnosisStatus({
            state: next.state,
            summary: reason ?? next.currentStep,
          }),
        );
      }
    }
    const receipt: ConversationDiagnosisReceipt = {
      commandId: input.commandId,
      transitionId,
      conversationRunId: next.conversationRunId,
      state: next.state,
      idempotent,
      ...(reason ? { reason } : {}),
    };
    store.putCommand(input.commandId, receipt);
    return receipt;
  };

  const assertCanCollect = (run: ConversationDiagnosisRun) => {
    if (run.state === "WAITING_AUTHORIZATION" || run.paused) {
      fail("collection_paused", "collection and diagnosis are paused", "state");
    }
    const auth = run.requiredAuthorization;
    if (
      auth &&
      (auth.status === "denied" || auth.status === "expired" || auth.status === "revoked")
    ) {
      fail("authorization_revoked", "authorization is no longer valid", "requiredAuthorization");
    }
    if (auth?.grantId && deps.grantInspector) {
      const grantStatus = deps.grantInspector.inspect(auth.grantId).status;
      if (grantStatus !== "APPROVED") {
        fail("authorization_revoked", "linked grant is not approved", "grantId");
      }
    }
    if (TERMINAL_STATES.has(run.state)) {
      fail("illegal_transition", "terminal conversation run cannot collect", "state");
    }
  };

  const attachLayers = (
    run: ConversationDiagnosisRun,
    input: ConversationDiagnosisCommandInput,
  ) => {
    if (input.diagnoserId && !isRegisteredConversationDiagnoser(input.diagnoserId)) {
      fail(
        "unregistered_diagnoser",
        `Diagnoser ${input.diagnoserId} is not registered`,
        "diagnoserId",
      );
    }
    if (input.evidenceSourceId && !isRegisteredConversationEvidenceSource(input.evidenceSourceId)) {
      fail(
        "unregistered_evidence_source",
        `Evidence Source ${input.evidenceSourceId} is not registered`,
        "evidenceSourceId",
      );
    }
    const evidenceRefs = uniqueRefs(
      run.lastEvidenceRefs,
      input.evidenceRefs,
      run.knownEvidenceIds,
      "evidenceRefs",
    );
    const findingRefs = uniqueRefs(
      run.lastFindingRefs,
      input.findingRefs,
      run.knownFindingIds,
      "findingRefs",
    );
    if (input.hypothesisRef?.startsWith("model:") || input.hypothesisRef === "MODEL_INFERRED") {
      fail("model_rca_forbidden", "model output cannot become formal RCA", "hypothesisRef");
    }
    return {
      ...run,
      lastEvidenceRefs: evidenceRefs,
      lastFindingRefs: findingRefs,
      hypothesisRefs: uniqueOptional(run.hypothesisRefs, input.hypothesisRef),
      recommendationRefs: uniqueOptional(run.recommendationRefs, input.recommendationRef),
    };
  };

  const startRun = (
    input: ConversationDiagnosisCommandInput,
    nowMs: number,
  ): ConversationDiagnosisRun => {
    const signal = input.signal;
    if (!signal) {
      fail("missing_field", "start requires a DiagnosticSignal", "signal");
    }
    const principal = validateDiagnosticPrincipal(input.principal, input.trusted, "principal");
    const target = validateDiagnosticTarget(signal.target, input.trusted, "signal.target");
    if (signal.tenantId !== input.trusted.tenantId || target.tenantId !== input.trusted.tenantId) {
      fail("tenant_mismatch", "signal tenant must match trusted tenant", "signal.tenantId");
    }
    const existing = store.findOpen(signal.tenantId, principal.principalId, signal.signalId);
    if (existing) {
      return existing;
    }
    const conversationRunId = `crun:${signal.signalId}:${principal.principalId}`;
    return {
      schemaVersion: CONVERSATION_DIAGNOSIS_SCHEMA_VERSION,
      conversationRunId,
      signalId: signal.signalId,
      ...((input.caseId ?? signal.caseId) ? { caseId: input.caseId ?? signal.caseId } : {}),
      target,
      tenantId: signal.tenantId,
      principal,
      state: "DETECTED",
      currentStep: "detect",
      paused: false,
      createdAt: toIso(nowMs),
      updatedAt: toIso(nowMs),
      expiresAt: toIso(nowMs + ttlMs),
      lastEvidenceRefs: [...signal.evidenceIds],
      lastFindingRefs: [...signal.findingIds],
      hypothesisRefs: [],
      recommendationRefs: [],
      knownEvidenceIds: [...signal.evidenceIds],
      knownFindingIds: [...signal.findingIds],
      audit: [],
    };
  };

  return {
    dispatch(input) {
      const cached = store.getCommand(input.commandId);
      if (cached) {
        return { ...cached, idempotent: true };
      }
      if (!(CONVERSATION_DIAGNOSIS_COMMANDS as readonly string[]).includes(input.command)) {
        fail("invalid_literal", `unknown conversation command ${input.command}`, "command");
      }
      const nowMs = now();
      if (input.command === "start") {
        let run = startRun(input, nowMs);
        if (run.state !== "DETECTED" && !TERMINAL_STATES.has(run.state)) {
          return persist(run, input, run.state, "existing_open_run", true);
        }
        const from = run.state;
        run = { ...run, state: "TRIAGING" };
        if (deps.delivery && input.signal && input.daibaiAuth) {
          const route = routeDiagnosisDaibaiDelivery(input.signal, input.daibaiAuth);
          if (!isDiagnosisDaibaiRoute(route)) {
            fail(
              "authorization_required",
              "Da Bai delivery requires an explicit route",
              "daibaiAuth",
            );
          }
          void deps.delivery.enqueue(input.signal, input.daibaiAuth);
        }
        return persist(run, input, from);
      }
      const conversationRunId = input.conversationRunId;
      if (!conversationRunId) {
        fail("missing_field", "conversationRunId is required", "conversationRunId");
      }
      const loaded = store.get(conversationRunId);
      if (!loaded) {
        fail("not_found", "conversation run not found", "conversationRunId");
      }
      assertActor(loaded, input);
      let run = refreshAuth(loaded, nowMs);
      if (
        Date.parse(run.expiresAt) <= nowMs &&
        input.command !== "timeout" &&
        input.command !== "cancel"
      ) {
        fail("run_expired", "conversation run has expired", "expiresAt");
      }
      const from = run.state;
      if (input.command === "cancel") {
        if (TERMINAL_STATES.has(run.state)) {
          return persist(run, input, from, "already_terminal", true);
        }
        return persist(
          { ...run, state: "CANCELLED", paused: true, pendingQuestion: undefined },
          input,
          from,
        );
      }
      if (input.command === "timeout") {
        if (TERMINAL_STATES.has(run.state)) {
          return persist(run, input, from, "already_terminal", true);
        }
        const auth = run.requiredAuthorization;
        return persist(
          {
            ...run,
            state: input.escalate ? "ESCALATED" : "INCONCLUSIVE",
            paused: true,
            pendingQuestion: undefined,
            ...(auth?.status === "pending"
              ? { requiredAuthorization: { ...auth, status: "expired" as const } }
              : {}),
          },
          input,
          from,
          input.escalate ? "timeout_escalated" : "timeout_inconclusive",
        );
      }
      if (TERMINAL_STATES.has(run.state)) {
        fail("illegal_transition", `cannot ${input.command} a ${run.state} run`, "state");
      }
      if (input.command === "ask") {
        if (run.state === "WAITING_AUTHORIZATION" || run.paused) {
          fail("collection_paused", "cannot ask while collection is paused", "state");
        }
        if (input.authorization) {
          return persist(
            {
              ...run,
              state: "WAITING_AUTHORIZATION",
              resumeState: run.state,
              requiredAuthorization: { ...input.authorization, status: "pending" },
              pendingQuestion: input.question
                ? { questionId: `q:${input.commandId}`, text: input.question }
                : run.pendingQuestion,
            },
            input,
            from,
          );
        }
        const question = input.question;
        if (!question) {
          fail("missing_field", "ask requires a question", "question");
        }
        return persist(
          {
            ...run,
            pendingQuestion: { questionId: `q:${input.commandId}`, text: question },
          },
          input,
          from,
        );
      }
      if (input.command === "answer") {
        assertCanCollect(run);
        run = attachLayers(run, input);
        const nextState = HAPPY_PATH[run.state];
        if (!nextState) {
          fail("illegal_transition", `cannot answer from ${run.state}`, "state");
        }
        return persist({ ...run, state: nextState, pendingQuestion: undefined }, input, from);
      }
      if (input.command === "pause") {
        if (run.paused) {
          return persist(run, input, from, "already_paused", true);
        }
        return persist({ ...run, paused: true }, input, from, "paused");
      }
      if (input.command === "resume") {
        if (run.state === "WAITING_AUTHORIZATION") {
          fail("authorization_required", "approve authorization before resume", "state");
        }
        if (run.requiredAuthorization?.status === "expired") {
          fail("authorization_expired", "authorization has expired", "requiredAuthorization");
        }
        if (!run.paused) {
          return persist(run, input, from, "already_running", true);
        }
        return persist({ ...run, paused: false }, input, from, "resumed");
      }
      if (input.command === "approve") {
        if (run.state !== "WAITING_AUTHORIZATION") {
          if (run.requiredAuthorization?.status === "granted") {
            return persist(run, input, from, "already_approved", true);
          }
          fail(
            "illegal_transition",
            "approve is only valid while waiting for authorization",
            "state",
          );
        }
        const pendingAuth = run.requiredAuthorization;
        if (!pendingAuth || pendingAuth.status === "expired") {
          fail("authorization_expired", "authorization has expired", "requiredAuthorization");
        }
        if (pendingAuth.status === "denied" || pendingAuth.status === "revoked") {
          return persist(
            {
              ...run,
              state: input.escalate ? "ESCALATED" : "INCONCLUSIVE",
              paused: true,
              pendingQuestion: undefined,
            },
            input,
            from,
            pendingAuth.status,
          );
        }
        if (pendingAuth.grantId && deps.grantInspector) {
          const grantStatus = deps.grantInspector.inspect(pendingAuth.grantId).status;
          if (grantStatus === "REQUESTED" || grantStatus === "missing") {
            fail("authorization_required", "linked grant is not approved yet", "grantId");
          }
          if (
            grantStatus === "DENIED" ||
            grantStatus === "REVOKED" ||
            grantStatus === "EXPIRED" ||
            grantStatus === "SUSPENDED" ||
            grantStatus === "CONSUMED"
          ) {
            return persist(
              {
                ...run,
                state: input.escalate ? "ESCALATED" : "INCONCLUSIVE",
                paused: true,
                pendingQuestion: undefined,
                requiredAuthorization: {
                  ...pendingAuth,
                  status:
                    grantStatus === "REVOKED"
                      ? "revoked"
                      : grantStatus === "DENIED"
                        ? "denied"
                        : "expired",
                },
              },
              input,
              from,
              grantStatus.toLowerCase(),
            );
          }
        }
        if (pendingAuth.status !== "pending") {
          fail(
            "illegal_transition",
            `cannot approve authorization in status ${pendingAuth.status}`,
            "requiredAuthorization",
          );
        }
        const grantedAuth: ConversationAuthorization = {
          ...pendingAuth,
          status: "granted",
          grantedAt: toIso(nowMs),
        };
        return persist(
          {
            ...run,
            state: run.resumeState ?? "TRIAGING",
            resumeState: undefined,
            paused: false,
            requiredAuthorization: grantedAuth,
          },
          input,
          from,
        );
      }
      if (input.command === "deny") {
        const existingAuth = run.requiredAuthorization;
        if (!existingAuth) {
          fail(
            "illegal_transition",
            "deny requires a pending or granted authorization",
            "requiredAuthorization",
          );
        }
        const revoked: ConversationAuthorization["status"] =
          existingAuth.status === "granted" ? "revoked" : "denied";
        const deniedAuth: ConversationAuthorization = { ...existingAuth, status: revoked };
        return persist(
          {
            ...run,
            state: "INCONCLUSIVE",
            paused: true,
            pendingQuestion: undefined,
            requiredAuthorization: deniedAuth,
          },
          input,
          from,
          revoked,
        );
      }
      throw new DiagnosisContractError(
        "illegal_transition",
        "unhandled conversation command",
        "command",
      );
    },
    get: (conversationRunId) => store.get(conversationRunId),
    restore(snapshot, trusted) {
      const principal = validateDiagnosticPrincipal(snapshot.principal, trusted, "principal");
      validateDiagnosticTarget(snapshot.target, trusted, "target");
      if (snapshot.tenantId !== trusted.tenantId || principal.tenantId !== snapshot.tenantId) {
        fail("tenant_mismatch", "restored run tenant does not match trusted tenant", "tenantId");
      }
      const restored = refreshAuth(
        {
          ...snapshot,
          principal,
        },
        now(),
      );
      store.put(restored);
      return restored;
    },
    list: (tenantId) => store.list(tenantId),
  };
}

function uniqueRefs(
  current: string[],
  incoming: string[] | undefined,
  allowed: string[],
  path: string,
): string[] {
  if (!incoming?.length) {
    return current;
  }
  for (const id of incoming) {
    if (!allowed.includes(id)) {
      throw new DiagnosisContractError(
        "unknown_evidence_ref",
        `${path} must reference known catalog ids`,
        path,
      );
    }
  }
  return [...new Set([...current, ...incoming])];
}

function uniqueOptional(current: string[], incoming: string | undefined): string[] {
  if (!incoming) {
    return current;
  }
  return [...new Set([...current, incoming])];
}

function toIso(nowMs: number): string {
  return new Date(nowMs).toISOString();
}
