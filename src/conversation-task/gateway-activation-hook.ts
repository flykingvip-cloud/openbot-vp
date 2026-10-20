/**
 * ConversationTask Runtime — inbound Activation bridge.
 *
 * Mirrors `gateway-shadow-hook`: one synchronous, fail-safe call from the
 * reply choke point. When the env activation flag is ON and the turn qualifies
 * as `long_running_candidate`, this opens the Task store and runs the
 * Activation Gate. It never throws into `chat.send` and never opens
 * orchestration / browser / node live invoke.
 */

import { runActivationGate, type ActivationMode } from "./activation.js";
import type { ActivationControlPlane } from "./control-plane.js";
import { detectTurn } from "./detector.js";
import { readConversationTaskFlags, type ConversationTaskFlags } from "./feature.js";
import { qualifyTurn } from "./qualification.js";
import { analyzeTurn } from "./signals.js";
import { openTaskStore, type StoredConversationTask } from "./store.js";

/** Personal / unscoped daemon tenant when the requester is authenticated. */
export const LOCAL_ACTIVATION_TENANT_ID = "local";

export type GatewayActivationInput = {
  tenantId: string | null | undefined;
  requesterId: string | null | undefined;
  conversationId: string | null | undefined;
  employeeScopeAllowed: boolean;
  messageId: string;
  text: string;
  authorizedConversationIds?: ReadonlySet<string>;
};

export type ActivationObserveStatus =
  | "uninitialized"
  | "skipped_flag_off"
  | "skipped_no_trusted_tenant"
  | "skipped_no_requester"
  | "skipped_no_conversation"
  | "skipped_tenant_not_allowed"
  | "not_detected"
  | "not_eligible"
  | ActivationMode
  | "error";

export type ActivationLedgerBinder = (task: StoredConversationTask) => void | Promise<void>;

export type InitActivationHookOptions = {
  storeRoot: string;
  flags?: () => ConversationTaskFlags;
  isTenantAllowed: (tenantId: string) => boolean;
  controlPlane: ActivationControlPlane;
  now?: () => number;
  bindLedger?: ActivationLedgerBinder;
  onStatus?: (status: ActivationObserveStatus) => void;
};

type ActivationRuntime = {
  storeRoot: string;
  flags: () => ConversationTaskFlags;
  isTenantAllowed: (tenantId: string) => boolean;
  controlPlane: ActivationControlPlane;
  now: () => number;
  bindLedger?: ActivationLedgerBinder;
  onStatus?: (status: ActivationObserveStatus) => void;
};

let runtime: ActivationRuntime | null = null;

export function resolveActivationTenantId(
  tenantId: string | null | undefined,
  requesterId: string | null | undefined,
): string | null {
  const trusted = typeof tenantId === "string" ? tenantId.trim() : "";
  if (trusted) {
    return trusted;
  }
  const requester = typeof requesterId === "string" ? requesterId.trim() : "";
  return requester ? LOCAL_ACTIVATION_TENANT_ID : null;
}

export function initActivationHook(options: InitActivationHookOptions): void {
  if (runtime) {
    return;
  }
  runtime = {
    storeRoot: options.storeRoot,
    flags: options.flags ?? (() => readConversationTaskFlags()),
    isTenantAllowed: options.isTenantAllowed,
    controlPlane: options.controlPlane,
    now: options.now ?? Date.now,
    ...(options.bindLedger ? { bindLedger: options.bindLedger } : {}),
    ...(options.onStatus ? { onStatus: options.onStatus } : {}),
  };
}

export function isActivationHookInitialized(): boolean {
  return runtime !== null;
}

/**
 * Activate a ConversationTask for one inbound turn. Synchronous, never throws.
 * Ledger seeding is handed off through `bindLedger` and must not block the reply.
 */
export function observeInboundTurnActivation(
  input: GatewayActivationInput,
): ActivationObserveStatus {
  const rt = runtime;
  if (!rt) {
    return "uninitialized";
  }
  const finish = (status: ActivationObserveStatus): ActivationObserveStatus => {
    rt.onStatus?.(status);
    return status;
  };
  try {
    const flags = rt.flags();
    if (!flags.activation) {
      return finish("skipped_flag_off");
    }
    const requesterId = typeof input.requesterId === "string" ? input.requesterId.trim() : "";
    if (!requesterId) {
      return finish("skipped_no_requester");
    }
    const conversationId =
      typeof input.conversationId === "string" ? input.conversationId.trim() : "";
    if (!conversationId) {
      return finish("skipped_no_conversation");
    }
    const tenantId = resolveActivationTenantId(input.tenantId, requesterId);
    if (!tenantId) {
      return finish("skipped_no_trusted_tenant");
    }
    if (!rt.isTenantAllowed(tenantId)) {
      return finish("skipped_tenant_not_allowed");
    }

    const turn = {
      messageId: input.messageId.trim() || `turn-${rt.now()}`,
      text: input.text ?? "",
    };
    const features = analyzeTurn(turn);
    const detection = detectTurn(turn, features);
    if (!detection.detected) {
      return finish("not_detected");
    }
    const qualification = qualifyTurn(turn, features);

    const store = openTaskStore({
      tenantId,
      storeRoot: rt.storeRoot,
      now: rt.now,
    });
    try {
      const outcome = runActivationGate(
        store,
        {
          turn,
          qualification,
          features,
          access: {
            tenantId,
            conversationId,
            requesterId,
            authorizedConversationIds: input.authorizedConversationIds ?? new Set([conversationId]),
            employeeScopeAllowed: input.employeeScopeAllowed || Boolean(requesterId),
          },
          messageConversationId: conversationId,
          activationEpoch: 1,
          ownerId: requesterId,
        },
        flags,
        rt.controlPlane,
      );
      if (
        (outcome.mode === "activated" || outcome.mode === "already_active") &&
        outcome.task &&
        rt.bindLedger
      ) {
        void Promise.resolve(rt.bindLedger(outcome.task)).catch(() => {
          // Ledger bind must never surface on the reply path.
        });
      }
      return finish(outcome.mode);
    } finally {
      store.close();
    }
  } catch {
    return finish("error");
  }
}

export function resetActivationHookForTests(): void {
  runtime = null;
}
