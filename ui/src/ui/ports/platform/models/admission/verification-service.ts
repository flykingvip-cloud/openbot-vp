/**
 * Switchable capability verification service registry.
 * Default: local_protocol (formal). Demo is opt-in and isolated.
 */

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
  });
}

/** Active service used by controller / UI. Defaults to local_protocol. */
export function getCapabilityVerificationService(): CapabilityVerificationService {
  if (!activeService) {
    activeService = createCapabilityVerificationService({ mode: activeMode });
  }
  return activeService;
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
  return activeService;
}

export function __resetCapabilityVerificationServiceForTest() {
  activeService = null;
  activeMode = "local_protocol";
}

export {
  createDefaultProtocolRunner,
  createInjectedProtocolRunner,
  createLocalProtocolVerificationService,
  createDemoCapabilityVerificationService,
};
export type { CapabilityCheckRunner, CapabilityVerificationService, DemoSimulateOptions };
