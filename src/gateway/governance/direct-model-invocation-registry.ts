/**
 * Direct model-invocation registry (governance closure plan v1.0 §4.8, §7.4).
 *
 * `model-caller-registry.ts` enumerates callers of `runWithModelFallback` /
 * `runWithImageModelFallback`, and the contract test proves that list is complete by
 * counting calls to those two helpers across production sources.
 *
 * That coverage rule has a blind spot: a path that invokes a model **without** either
 * helper is structurally undetectable by it. Such a path cannot be "a missing row" —
 * it is not a row the rule can look for at all. The inbound media-understanding
 * pipeline sat in that blind spot and invoked a model on real user attachments with no
 * governance envelope of any class.
 *
 * This registry closes the rule, not just the instance: every production site that
 * reaches a model provider directly must be listed here with an explicit disposition,
 * and the contract test fails on an unregistered one. Adding such a path is then a
 * deliberate contract change rather than a silent gap.
 *
 * Scope note: `invocation: "pi-complete"` rows are the ones the contract test can scan
 * for mechanically (it matches `complete(` against files importing
 * `@earendil-works/pi-ai/compat`). `invocation: "provider-http"` rows reach a vendor
 * HTTP endpoint directly and are listed for completeness — they are covered by the
 * same execution entry, not by a text scan.
 */

export type DirectModelInvocationKind = "pi-complete" | "provider-http";

export type DirectModelInvocationDisposition =
  /** A governance envelope is recorded for this invocation. */
  | "instrumented"
  /** Deliberately outside governance, with a reason. Never user traffic. */
  | "exempt";

export type DirectModelInvocationEntry = {
  id: string;
  /** Repo-relative production file containing the invocation. */
  file: string;
  invocation: DirectModelInvocationKind;
  /** Enclosing function (symbol name, not a line number). */
  caller: string;
  /** Execution entry ids from `execution-entry-registry.ts`; empty only when exempt. */
  inventoryIds: string[];
  disposition: DirectModelInvocationDisposition;
  /** Required for `exempt`. */
  exemptReason?: string;
  /** Where the envelope is written, for `instrumented` rows. */
  evidenceFiles?: string[];
  note?: string;
};

export const DIRECT_MODEL_INVOCATION_REGISTRY: readonly DirectModelInvocationEntry[] = [
  {
    id: "interaction-completion",
    file: "src/agent-runtime/model/interaction-completion.ts",
    invocation: "pi-complete",
    caller: "invokeInteractionCompletion",
    inventoryIds: ["E1"],
    disposition: "instrumented",
    evidenceFiles: [
      "src/agent-runtime/model/authorized-session.ts",
      "src/agent-runtime/command/prepared-interaction.ts",
    ],
    note: "Prepared interaction completion uses shared governed fallback and accounting; not yet enabled on production ingress.",
  },
  {
    id: "media-understanding-image",
    file: "src/media-understanding/providers/image.ts",
    invocation: "pi-complete",
    caller: "describeImageWithModel",
    inventoryIds: ["E19"],
    disposition: "instrumented",
    evidenceFiles: ["src/gateway/governance/media-understanding-shadow.ts"],
    note: "Pre-agent inbound attachment description. Uses the active chat model (resolveActiveModelEntry), not agents.defaults.imageModel, and no allowlist is reachable this early — the envelope is skipped + media-understanding-pre-agent.",
  },
  {
    id: "media-understanding-audio",
    file: "src/media-understanding/runner.entries.ts",
    invocation: "provider-http",
    caller: "runProviderEntry",
    inventoryIds: ["E19"],
    disposition: "instrumented",
    evidenceFiles: ["src/gateway/governance/media-understanding-shadow.ts"],
    note: "Audio transcription and video description reach vendor HTTP endpoints via the provider registry rather than pi-ai; same entry and same envelope as the image branch.",
  },
  {
    id: "model-scan",
    file: "src/agents/model-scan.ts",
    invocation: "pi-complete",
    caller: "probeTool / probeImage",
    inventoryIds: [],
    disposition: "exempt",
    exemptReason:
      "Catalog capability probe (tool-call and image-input support) against the model directory, not a user turn. It carries no tenant, no run, and no user content, so there is no decision to attribute.",
  },
  {
    id: "catalog-health-probe",
    file: "src/commands/models/catalog-health-completion.ts",
    invocation: "pi-complete",
    caller: "invokeCatalogHealthCompletion",
    inventoryIds: [],
    disposition: "exempt",
    exemptReason:
      "Platform catalog and connection probe (models.probe and models status). A fixed one-shot completion against the configured provider, with no tenant, no user content, and no account sandbox. Agent turns stay on runEmbeddedPiAgent and still fail closed without a server-derived account.",
  },
];
