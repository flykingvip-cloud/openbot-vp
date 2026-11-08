/**
 * Model caller registry — every production caller of `runWithModelFallback` /
 * `runWithImageModelFallback` (governance closure plan v1.0 §4.8, §7.4).
 *
 * `registered-gap` meant the caller did not yet pass an explicit `governanceMode` (a known
 * listed gap — not "governed because no allowlist was passed"; plan §0.1 #5, ADR-6). After
 * P3-3 every production row is `explicit-mode`: the caller passes `governanceMode` on every
 * call. The `registered-gap` registration value remains in the type for contract history.
 *
 * Direct calls inside test files are not registered. The contract test scans production
 * sources and fails when a call site is missing here.
 */

export type ModelFallbackFunction = "runWithModelFallback" | "runWithImageModelFallback";

export type ModelCallerRegistration = "registered-gap" | "explicit-mode";

export type ModelGovernanceToday =
  /** Passes `entitlementAllowlist` when the enterprise gate resolved one. */
  | "allowlist-when-gated"
  /** Calls without any allowlist. */
  | "no-allowlist"
  /** The fallback function has no entitlement parameter at all. */
  | "no-entitlement-param";

export type ModelCallerEntry = {
  id: string;
  /** Repo-relative production file containing the call. */
  file: string;
  fn: ModelFallbackFunction;
  /** Enclosing function (symbol name, not a line number). */
  caller: string;
  /** Number of call sites of `fn` in `file`. */
  callSites: number;
  /** Execution entry ids from `execution-entry-registry.ts`. */
  inventoryIds: string[];
  governanceToday: ModelGovernanceToday;
  registration: ModelCallerRegistration;
  followUp: string;
  /**
   * Extra production files that carry the caller's governance params (e.g. a helper the
   * call spreads in). The contract test reads them together with `file`.
   */
  evidenceFiles?: string[];
};

export const MODEL_CALLER_REGISTRY: readonly ModelCallerEntry[] = [
  {
    id: "auto-reply",
    file: "src/agent-runtime/model/authorized-session.ts",
    fn: "runWithModelFallback",
    caller: "createAuthorizedModelSession",
    callSites: 1,
    inventoryIds: ["E1", "E14", "E1f", "E4"],
    governanceToday: "allowlist-when-gated",
    registration: "explicit-mode",
    followUp: "P3 enforced after §8.4 (default stays shadow; hard filter until then)",
    evidenceFiles: ["src/agents/embedded-model-governance.ts"],
  },
  // Post-PR-1a (#134): agent.ts spreads resolveAgentCommandModelGovernance(), which passes
  // an explicit governanceMode (legacy when the gate is skipped, shadow by default) and the
  // gate allowlist; the literals live in the helper, so it is listed as evidence.
  {
    id: "agent-command",
    file: "src/agent-runtime/execution/runner/command-lifecycle.ts",
    fn: "runWithModelFallback",
    caller: "createCommandExecutionLifecycle",
    callSites: 1,
    inventoryIds: ["E2", "E3", "E7"],
    governanceToday: "allowlist-when-gated",
    registration: "explicit-mode",
    followUp: "P3 enforced after §8.4 parity (default stays shadow)",
    evidenceFiles: [
      "src/agent-runtime/model/command-governance.ts",
      "src/agent-runtime/model/command-admission-session.ts",
      "src/commands/agent.ts",
    ],
  },
  {
    id: "memory-flush",
    file: "src/auto-reply/reply/agent-runner-memory.ts",
    fn: "runWithModelFallback",
    caller: "runMemoryFlushIfNeeded",
    callSites: 1,
    inventoryIds: ["E1m"],
    governanceToday: "allowlist-when-gated",
    registration: "explicit-mode",
    followUp:
      "P3-2 inherits parent run snapshot; default shadow record-only (governance-mode); P3 enforced after §8.4",
    evidenceFiles: [
      "src/auto-reply/reply/agent-runner-memory.ts",
      "src/auto-reply/reply/agent-runner.ts",
    ],
  },
  {
    id: "image-tool",
    file: "src/agents/tools/image-tool.ts",
    fn: "runWithImageModelFallback",
    caller: "runImagePrompt",
    callSites: 1,
    inventoryIds: ["E10"],
    governanceToday: "allowlist-when-gated",
    registration: "explicit-mode",
    followUp:
      "P3 enforced after §8.4; parent allowlist is looked up by runId; OPENBOT_GOVERNANCE_IMAGE_MODEL_MODE default shadow",
  },
  {
    id: "pdf-tool",
    file: "src/agents/tools/pdf-tool.ts",
    fn: "runWithImageModelFallback",
    caller: "runPdfPrompt",
    callSites: 1,
    inventoryIds: ["E10"],
    governanceToday: "allowlist-when-gated",
    registration: "explicit-mode",
    followUp:
      "P3 enforced after §8.4; parent allowlist is looked up by runId; OPENBOT_GOVERNANCE_IMAGE_MODEL_MODE default shadow",
  },
];
