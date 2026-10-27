/**
 * Switchable capability verification service registry.
 * Default: local_protocol (formal). Demo is opt-in and isolated.
 */

import { requestOpenBotAppRerender } from "../../../../request-app-rerender.ts";
import {
  __clearLiveVerificationTasksForTest,
  interruptOrphanedInFlightVerificationTasks,
} from "../model-admission-store.ts";
import { hasSuccessfulModelConnection } from "../model-connection-gate.ts";
import {
  createDemoCapabilityVerificationService,
  type DemoSimulateOptions,
} from "./demo-adapter.ts";
import {
  createDefaultProtocolRunner,
  createInjectedProtocolRunner,
  createLocalProtocolVerificationService,
  type LocalProtocolAdapterOptions,
} from "./local-protocol-adapter.ts";
import type {
  CapabilityCheckRunner,
  CapabilityVerificationService,
} from "./verification-contract.ts";

/** Default formal connection check: uses session/persisted gate + fingerprint. */
function defaultResolveConnectionOk(modelRef: string, fingerprint?: string): boolean {
  return hasSuccessfulModelConnection({
    modelId: modelRef,
    ...(fingerprint ? { connectionFingerprint: fingerprint } : {}),
  });
}

export type VerificationServiceMode = "local_protocol" | "demo" | "unavailable";

export type VerificationServiceRegistryOptions = {
  mode?: VerificationServiceMode;
  local?: LocalProtocolAdapterOptions;
  demoSimulate?: DemoSimulateOptions;
};

let activeService: CapabilityVerificationService | null = null;
let activeMode: VerificationServiceMode = "local_protocol";

function buildUnavailableService(): CapabilityVerificationService {
  const notWired = async () => {
    throw new Error("能力验证服务尚未接入后端 RPC");
  };
  return {
    kind: "unavailable",
    authority: "formal",
    discoverCapabilities: async (req) => ({
      modelRef: req.modelRef,
      adapter: "unavailable",
      capabilities: [],
    }),
    createVerificationTask: notWired,
    getVerificationTask: async () => null,
    listVerificationTasks: async () => [],
    cancelVerificationTask: async () => null,
    setRoutingEligibility: async (req) => ({
      status: "not_wired",
      modelRef: req.modelRef,
      draft: {
        autoRouting: req.autoRouting,
        reason: req.reason,
        taskCategories: req.taskCategories,
      },
      message: "路由资格后端尚未接入",
    }),
    createBatchVerificationTasks: notWired,
  };
}

/**
 * Recover orphaned in-flight tasks left by a prior page/session.
 * Live tasks registered in this process are left alone (opening a detail
 * drawer must not globally interrupt everything).
 */
function recoverOrphanedInFlightOnInit() {
  const interrupted = interruptOrphanedInFlightVerificationTasks(
    "已中断，可重试（页面刷新或执行上下文丢失）",
  );
  if (interrupted.length > 0) {
    try {
      requestOpenBotAppRerender();
    } catch {
      // ignore missing app host in unit tests
    }
  }
  return interrupted;
}

export function createCapabilityVerificationService(
  options: VerificationServiceRegistryOptions = {},
): CapabilityVerificationService {
  const mode = options.mode ?? "local_protocol";
  if (mode === "demo") {
    return createDemoCapabilityVerificationService({ simulate: options.demoSimulate });
  }
  if (mode === "unavailable") {
    return buildUnavailableService();
  }
  const local = options.local ?? {};
  return createLocalProtocolVerificationService({
    ...local,
    resolveConnectionOk: local.resolveConnectionOk ?? defaultResolveConnectionOk,
    onTaskSettled: local.onTaskSettled ?? (() => requestOpenBotAppRerender()),
  });
}

/** Active service used by controller / UI. Defaults to local_protocol. */
export function getCapabilityVerificationService(): CapabilityVerificationService {
  if (!activeService) {
    activeService = createCapabilityVerificationService({ mode: activeMode });
    // First materialization after page load / process start: orphan prior-page tasks.
    recoverOrphanedInFlightOnInit();
  }
  return activeService;
}

/**
 * Page / models-surface init hook.
 * Ensures the formal service exists and prior-page orphaned tasks are interrupted.
 * Safe to call on every models surface render: live tasks started in this process
 * are preserved; only orphaned queued/running rows are interrupted.
 * Callers do not need to invoke recover helpers manually.
 */
export function ensureCapabilityVerificationLifecycle(): {
  interruptedCount: number;
} {
  // Orphan recovery first so the returned count reflects this init pass even when
  // getCapabilityVerificationService also recovers on first create.
  const interrupted = interruptOrphanedInFlightVerificationTasks(
    "已中断，可重试（页面刷新或执行上下文丢失）",
  );
  getCapabilityVerificationService();
  if (interrupted.length > 0) {
    try {
      requestOpenBotAppRerender();
    } catch {
      // ignore missing app host in unit tests
    }
  }
  return { interruptedCount: interrupted.length };
}

export function setCapabilityVerificationService(
  service: CapabilityVerificationService,
  mode?: VerificationServiceMode,
) {
  activeService = service;
  if (mode) {
    activeMode = mode;
  }
}

export function configureCapabilityVerificationService(
  options: VerificationServiceRegistryOptions,
) {
  activeMode = options.mode ?? "local_protocol";
  activeService = createCapabilityVerificationService(options);
  // Replacing the service drops in-memory timers; orphan non-live persisted rows.
  recoverOrphanedInFlightOnInit();
  return activeService;
}

export function __resetCapabilityVerificationServiceForTest() {
  activeService = null;
  activeMode = "local_protocol";
  // Simulate process/page death: live task registry does not survive refresh.
  __clearLiveVerificationTasksForTest();
}

export {
  createDefaultProtocolRunner,
  createInjectedProtocolRunner,
  createLocalProtocolVerificationService,
  createDemoCapabilityVerificationService,
};
export type { CapabilityCheckRunner, CapabilityVerificationService, DemoSimulateOptions };
