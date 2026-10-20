/**
 * Process-wide holder for the local file read grant runtime.
 *
 * The service needs a signing key, several stores and three ports. Building it
 * lazily here keeps that composition in one place and lets the gateway RPC handler
 * stay thin.
 *
 * Fail closed by default: until something installs a runtime, redemption is
 * refused. That is the correct posture for the non-production prototype — a
 * gateway that was never configured for this capability must not serve reads
 * (design 9.3).
 */

import { InMemoryAuditSink, type AuditSink } from "../../local-files/audit.js";
import {
  createFileBindingPersistence,
  type LocalDeviceBindingPersistence,
} from "../../local-files/device-binding-persistence.js";
import { LocalDeviceBindingStore } from "../../local-files/device-binding.js";
import { DirectedResourceRegistry } from "../../local-files/directed-resource.js";
import {
  generateCapabilitySigningKey,
  signKeysetDocument,
  verificationKeyFor,
  type CapabilitySigningKey,
  type SignedKeysetDocument,
} from "../../local-files/keyset.js";
import { NonceLedger } from "../../local-files/nonce-ledger.js";
import { StaticCapabilityKeyResolver } from "../../local-files/redemption.js";
import { TurnAuthorizationStore } from "../../local-files/turn-authorization.js";
import {
  LocalFilesService,
  type ApprovalPort,
  type LocalFilesNodeDirectory,
  type NodeInvokePort,
} from "./service.js";

/** How long a published keyset stays valid before the node must refresh. */
const KEYSET_TTL_MS = 10 * 60_000;

export type LocalFilesRuntime = {
  service: LocalFilesService;
  /** The approval port, exposed so the resolve RPC can settle a pending card. */
  approvals: ApprovalPort;
  bindings: LocalDeviceBindingStore;
  directedResources: DirectedResourceRegistry;
  turnAuthorizations: TurnAuthorizationStore;
  nonces: NonceLedger;
  audit: AuditSink;
  signingKey: CapabilitySigningKey;
  trustRoot: CapabilitySigningKey;
  /** Connected nodes a chat turn may bind. Absent in tests that do not need one. */
  nodes?: LocalFilesNodeDirectory;
  /**
   * Sign the current verification set for delivery to a node.
   *
   * `trustRootPublicKey` is included so a node pairing for the first time can pin
   * the root. This is trust on first use over an already-authenticated device
   * connection: it is only as strong as that first connection, and a node that has
   * already pinned a different root will reject the document rather than re-pin.
   * Production should distribute the root out of band instead.
   */
  publishKeyset(nowMs?: number): SignedKeysetDocument & { trustRootPublicKey: string };
};

let runtime: LocalFilesRuntime | null = null;

export type LocalFilesRuntimeOptions = {
  node: NodeInvokePort;
  approvals: ApprovalPort;
  audit?: AuditSink;
  homeDirForAudit?: string;
  /**
   * Keys are generated when absent. A prototype gateway restart therefore mints a
   * new trust root, which invalidates every previously issued capability — the
   * fail-closed direction.
   */
  signingKey?: CapabilitySigningKey;
  trustRoot?: CapabilitySigningKey;
  /**
   * Where bindings are persisted. Defaults to the state directory. Pass an
   * in-memory implementation in tests, or omit persistence entirely by passing
   * `null` when durability is not wanted.
   */
  bindingPersistence?: LocalDeviceBindingPersistence | null;
  nodes?: LocalFilesNodeDirectory;
};

export function configureLocalFilesRuntime(options: LocalFilesRuntimeOptions): LocalFilesRuntime {
  const signingKey = options.signingKey ?? generateCapabilitySigningKey();
  const trustRoot = options.trustRoot ?? generateCapabilitySigningKey("root");
  const bindingPersistence =
    options.bindingPersistence === null
      ? undefined
      : (options.bindingPersistence ?? createFileBindingPersistence());
  const bindings = new LocalDeviceBindingStore(bindingPersistence);
  const turnAuthorizations = new TurnAuthorizationStore();
  const directedResources = new DirectedResourceRegistry();
  const nonces = new NonceLedger();
  const audit = options.audit ?? new InMemoryAuditSink();
  const keyResolver = new StaticCapabilityKeyResolver([verificationKeyFor(signingKey)]);

  const service = new LocalFilesService({
    signingKey,
    bindings,
    turnAuthorizations,
    directedResources,
    redemption: { keyResolver, turnAuthorizations, bindings, nonces },
    node: options.node,
    approvals: options.approvals,
    nodes: options.nodes,
    audit,
    homeDirForAudit: options.homeDirForAudit,
  });

  runtime = {
    service,
    approvals: options.approvals,
    bindings,
    directedResources,
    turnAuthorizations,
    nonces,
    audit,
    signingKey,
    trustRoot,
    nodes: options.nodes,
    publishKeyset(nowMs = Date.now()) {
      const signed = signKeysetDocument({
        trustRoot,
        keys: [verificationKeyFor(signingKey)],
        issuedAtMs: nowMs,
        expiresAtMs: nowMs + KEYSET_TTL_MS,
      });
      return { ...signed, trustRootPublicKey: verificationKeyFor(trustRoot).publicKey };
    },
  };
  return runtime;
}

export function getLocalFilesRuntime(): LocalFilesRuntime | null {
  return runtime;
}

/** Test seam. */
export function resetLocalFilesRuntime(): void {
  runtime = null;
}
