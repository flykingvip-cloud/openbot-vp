import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertNotLocalFilesCommand } from "../../agents/tools/local-file-tool.js";
import type { OpenBotConfig } from "../../config/config.js";
import { NODE_LOCAL_FILES_READONLY_COMMANDS } from "../../infra/node-commands.js";
import { InMemoryAuditSink } from "../../local-files/audit.js";
import { createFileBindingPersistence } from "../../local-files/device-binding-persistence.js";
import { LocalDeviceBindingStore } from "../../local-files/device-binding.js";
import { LOCAL_FILES_CAP, LOCAL_FILES_KEYSET_EVENT } from "../../local-files/events.js";
import {
  deriveInvocationCapability,
  issueResolveTicket,
  issueTurnAuthorization,
} from "../../local-files/issue.js";
import { generateCapabilitySigningKey } from "../../local-files/keyset.js";
import {
  ARCHIVE_TASK_BUDGET,
  CAPABILITY_CLOCK_SKEW_MS,
  LOCAL_FILES_OPAQUE_DENIAL,
  LOCAL_FILES_READONLY_PROFILE,
  type LocalFilesOperation,
  type SignedCapability,
  type TurnBudget,
} from "../../local-files/types.js";
import { guardCommand } from "../../node-host/local-files/guard.js";
import {
  handleArchiveList,
  handleArchiveReadEntry,
  handleFsRead,
  handleFsStatResolve,
  type LocalFilesHandlerDeps,
} from "../../node-host/local-files/handlers.js";
import {
  applyLocalFilesKeysetEvent,
  PersistentNodeCapabilityKeyset,
} from "../../node-host/local-files/keyset-store.js";
import { isNodeCommandAllowed, resolveNodeCommandAllowlist } from "../node-command-policy.js";
import { LocalFileApprovalService } from "./approval.js";
import { createLocalDeviceBinding } from "./binding-admin.js";
import { createNodeInvokePort } from "./node-port.js";
import {
  configureLocalFilesRuntime,
  getLocalFilesRuntime,
  resetLocalFilesRuntime,
} from "./runtime.js";

/**
 * Activation test for the whole grant chain.
 *
 * Not a stubbed service test: it drives the real gateway runtime, the real
 * node-side handlers against a real temp filesystem, the real approval lifecycle
 * and the real redemption ledger.
 *
 * What it does NOT cover, stated plainly: the websocket hop is bridged in process,
 * so this proves the logic composes, not that the wire protocol round-trips. The
 * wire path is covered separately by the `localFiles.redeem` handler tests
 * (`src/gateway/server-methods/local-files.test.ts`) and the keyset delivery tests
 * (`src/node-host/local-files/keyset-store.test.ts`). A true two-process run against
 * a live gateway is still outstanding and is tracked in the spec.
 *
 * It also covers design section 10.3: each refusal is proven twice, with the other
 * side relaxed, so neither side is silently carrying the other.
 */

const NODE_ID = "e2e-node";
const DEVICE_KEY = "e2e-device-key";
const ZIP_NAME = "box-browser-auth-skills.zip";

let tmpHome: string;
let zipPath: string;
let nodeKeyset: PersistentNodeCapabilityKeyset;
let nodeDeps: LocalFilesHandlerDeps;
let approvalDecision: "allow-once" | "deny" | "none";
let approvalPrompts: Array<{ canonicalPath: string; task: string }>;
let hasRoute: boolean;
let bridge: ReturnType<typeof buildNodeRegistryBridge>;

function binding(overrides: Record<string, string> = {}) {
  return {
    tenantId: "t1",
    userId: "u1",
    agentId: "bot-skill",
    sessionKey: "s1",
    turnId: "turn-1",
    nodeId: NODE_ID,
    devicePublicKey: DEVICE_KEY,
    ...overrides,
  };
}

/**
 * The node side, wired to the real gateway runtime.
 *
 * `invoke` is what the gateway's NodeInvokePort talks to; inside it we run the real
 * node handlers, whose redemption client calls the real gateway redemption path.
 */
function buildNodeRegistryBridge() {
  const calls: Array<{ command: string; params: Record<string, unknown> }> = [];
  return {
    calls,
    invoke: async (params: {
      nodeId: string;
      command: string;
      params?: unknown;
      timeoutMs?: number;
    }) => {
      const invokeParams = (params.params ?? {}) as Record<string, unknown>;
      calls.push({ command: params.command, params: invokeParams });

      // Gateway-side allowlist: the first of the two independent gates.
      const allowlist = resolveNodeCommandAllowlist({} as OpenBotConfig, {
        platform: "darwin",
        deviceFamily: "Mac",
        capabilityProfile: LOCAL_FILES_READONLY_PROFILE,
      });
      const allowed = isNodeCommandAllowed({
        command: params.command,
        declaredCommands: [...NODE_LOCAL_FILES_READONLY_COMMANDS],
        allowlist,
      });
      if (!allowed.ok) {
        return { ok: false, error: { code: "INVALID_REQUEST", message: allowed.reason } };
      }

      // Node-side profile guard: the second gate, independent of the first.
      const gate = guardCommand(params.command);
      if (!gate.ok) {
        return { ok: false, error: { code: "UNAVAILABLE", message: "command not supported" } };
      }

      const capability = invokeParams.capability as never;
      const outcome =
        invokeParams.capabilityType === "resolve-ticket"
          ? await handleFsStatResolve({ ticket: capability, deps: nodeDeps })
          : await handleArchiveList({ capability, deps: nodeDeps });

      if (!outcome.ok) {
        return { ok: false, error: { code: "PERMISSION_DENIED", message: outcome.message } };
      }
      return { ok: true, payload: outcome };
    },
  };
}

beforeEach(async () => {
  resetLocalFilesRuntime();
  tmpHome = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "ldrg-e2e-")));
  await fs.mkdir(path.join(tmpHome, "Desktop"), { recursive: true });
  await fs.mkdir(path.join(tmpHome, ".ssh"), { recursive: true });
  await fs.writeFile(path.join(tmpHome, ".ssh", "id_ed25519"), "SECRET KEY");

  const zip = new JSZip();
  zip.file("skills/box-browser-auth/SKILL.md", "# Box Browser Auth\nstep one\n");
  zip.file("skills/box-browser-auth/meta.json", '{"name":"box-browser-auth"}');
  zipPath = path.join(tmpHome, "Desktop", ZIP_NAME);
  await fs.writeFile(zipPath, await zip.generateAsync({ type: "nodebuffer" }));

  approvalDecision = "allow-once";
  approvalPrompts = [];
  hasRoute = true;

  bridge = buildNodeRegistryBridge();
  const approvals = new LocalFileApprovalService({
    events: {
      requested: ({ id, request }) => {
        approvalPrompts.push({ canonicalPath: request.canonicalPath, task: request.task });
        // Stand in for a person clicking a button.
        const decision = approvalDecision;
        if (decision !== "none") {
          setTimeout(() => approvals.resolve({ id, decision }), 0);
        }
      },
      resolved: () => {},
    },
    hasApprovalRoute: () => hasRoute,
    timeoutMs: 250,
  });

  const runtime = configureLocalFilesRuntime({
    node: createNodeInvokePort(bridge, { timeoutMs: 5_000 }),
    // Bindings are persisted under the temp home, never the real state directory.
    bindingPersistence: createFileBindingPersistence(tmpHome),
    approvals,
    homeDirForAudit: tmpHome,
  });
  runtime.bindings.put({
    tenantId: "t1",
    userId: "u1",
    nodeId: NODE_ID,
    devicePublicKey: DEVICE_KEY,
    allowedAgentIds: ["bot-skill"],
    capabilityProfile: LOCAL_FILES_READONLY_PROFILE,
    status: "active",
    createdAtMs: Date.now() - 1000,
  });

  // Node receives the keyset the way it really does: over the connection.
  nodeKeyset = new PersistentNodeCapabilityKeyset(path.join(tmpHome, "keyset.json"));
  const published = runtime.publishKeyset();
  expect(applyLocalFilesKeysetEvent(published, nodeKeyset).ok).toBe(true);

  nodeDeps = {
    keyset: nodeKeyset,
    configuredProfile: LOCAL_FILES_READONLY_PROFILE,
    policy: { homeDir: tmpHome, caseInsensitive: true },
    redemption: {
      // The real gateway redemption path, reached over the authenticated connection.
      redeem: async ({ capability, operation }) => {
        const res = getLocalFilesRuntime()?.service.redeem({
          capability,
          operation,
          connection: {
            nodeId: NODE_ID,
            devicePublicKey: DEVICE_KEY,
            authenticated: true,
            capabilityProfile: LOCAL_FILES_READONLY_PROFILE,
            declaredCommands: [...NODE_LOCAL_FILES_READONLY_COMMANDS],
          },
        });
        return res?.ok ? { ok: true } : { ok: false, reason: res?.reason ?? "no-runtime" };
      },
    },
  };
});

afterEach(async () => {
  resetLocalFilesRuntime();
  await fs.rm(tmpHome, { recursive: true, force: true });
});

function bridgeCalls(): Array<{ command: string; params: Record<string, unknown> }> {
  return bridge.calls;
}

/**
 * Mint a real, correctly signed Invocation capability straight into the runtime,
 * skipping the gateway's own resolve, policy and approval steps.
 *
 * This is the "relax the gateway" lever for design 10.3: the node receives a token
 * the gateway would never have issued, so anything the node then refuses is proof
 * the node's own rules stand on their own.
 */
function mintCapabilityFor(params: {
  canonicalPath: string;
  operation: LocalFilesOperation;
  archiveEntryPath?: string;
  targetKind?: "file" | "directory";
  budget?: TurnBudget;
}): SignedCapability {
  const runtime = getLocalFilesRuntime()!;
  const nowMs = Date.now();
  const issued = issueTurnAuthorization({
    binding: binding(),
    canonicalPath: params.canonicalPath,
    // A real fileId is not needed: every path here is refused before the identity
    // check, and the tests assert the refusal rather than a specific stage.
    fileId: { dev: "1", ino: "1" },
    targetKind: params.targetKind ?? "file",
    operations: [params.operation],
    grantSource: "user-approved-once",
    budget: params.budget,
    signingKey: runtime.signingKey,
    store: runtime.turnAuthorizations,
    nowMs,
    expiresAtMs: nowMs + 120_000,
  });
  if (!issued.ok) {
    throw new Error(`fixture: ${issued.reason}`);
  }
  const derived = deriveInvocationCapability({
    authorizationId: issued.claims.authorizationId,
    operation: params.operation,
    archiveEntryPath: params.archiveEntryPath,
    signingKey: runtime.signingKey,
    store: runtime.turnAuthorizations,
    nowMs,
    clockSkewMs: CAPABILITY_CLOCK_SKEW_MS,
  });
  if (!derived.ok) {
    throw new Error(`fixture: ${derived.reason}`);
  }
  return derived.signed;
}

describe("activation: the 2026-09-21 desktop zip, end to end", () => {
  it("resolves, asks once, then lists the archive without extracting it", async () => {
    const runtime = getLocalFilesRuntime()!;

    const result = await runtime.service.requestAccess({
      binding: binding(),
      rawPath: `~/Desktop/${ZIP_NAME}`,
      operation: "archive.list",
      inboundMessageId: "msg-2026-09-21",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const payload = result.payload as { entries?: Array<{ path: string }> };
    expect(payload.entries?.map((e) => e.path)).toContain("skills/box-browser-auth/SKILL.md");

    // The card showed the node's canonical path and the bounded task.
    expect(approvalPrompts).toHaveLength(1);
    expect(approvalPrompts[0]?.canonicalPath).toBe(zipPath);
    expect(approvalPrompts[0]?.task).toBe("inspect-archive");

    // Resolution ran first, as fs.stat in resolve mode. No fs.resolve exists.
    const calls = bridgeCalls();
    expect(calls[0]?.command).toBe("fs.stat");
    expect(calls[0]?.params.capabilityType).toBe("resolve-ticket");
    expect(calls.map((c) => c.command)).not.toContain("fs.resolve");

    // Nothing was extracted next to the archive.
    expect((await fs.readdir(path.join(tmpHome, "Desktop"))).toSorted()).toEqual([ZIP_NAME]);

    // Audit recorded the read, and carries neither content nor the full path.
    const records = (runtime.audit as InMemoryAuditSink).all();
    expect(records.some((record) => record.decision === "allowed")).toBe(true);
    expect(records.some((record) => record.grantSource === "user-approved-once")).toBe(true);
    const serialized = JSON.stringify(records);
    expect(serialized).not.toContain("SKILL.md");
    expect(serialized).not.toContain(zipPath);
    expect(serialized).not.toContain("claimsJSON");
  });

  it("treats a denial as no read at all", async () => {
    approvalDecision = "deny";
    const runtime = getLocalFilesRuntime()!;

    const result = await runtime.service.requestAccess({
      binding: binding(),
      rawPath: `~/Desktop/${ZIP_NAME}`,
      operation: "archive.list",
    });
    expect(result.ok).toBe(false);
    // Only the resolve call happened; archive.list was never attempted.
    expect(bridgeCalls().filter((c) => c.params.capabilityType !== "resolve-ticket")).toHaveLength(
      0,
    );
  });

  it("treats an unanswered card as a denial", async () => {
    approvalDecision = "none";
    const runtime = getLocalFilesRuntime()!;
    const result = await runtime.service.requestAccess({
      binding: binding(),
      rawPath: `~/Desktop/${ZIP_NAME}`,
      operation: "archive.list",
    });
    expect(result.ok).toBe(false);
  });

  it("refuses immediately when no surface can render the card", async () => {
    hasRoute = false;
    const runtime = getLocalFilesRuntime()!;
    const result = await runtime.service.requestAccess({
      binding: binding(),
      rawPath: `~/Desktop/${ZIP_NAME}`,
      operation: "archive.list",
    });
    expect(result.ok).toBe(false);
    expect(approvalPrompts).toHaveLength(0);
  });

  it("refuses a credential path the user named explicitly", async () => {
    const runtime = getLocalFilesRuntime()!;
    const result = await runtime.service.requestAccess({
      binding: binding(),
      rawPath: "~/.ssh/id_ed25519",
      operation: "fs.read",
    });
    expect(result.ok).toBe(false);
    // Resolution refused it, so no approval was even offered.
    expect(approvalPrompts).toHaveLength(0);
  });

  it("refuses an unbound digital human before touching the node", async () => {
    const runtime = getLocalFilesRuntime()!;
    const result = await runtime.service.requestAccess({
      binding: binding({ agentId: "bot-other" }),
      rawPath: `~/Desktop/${ZIP_NAME}`,
      operation: "archive.list",
    });
    expect(result.ok).toBe(false);
    expect(bridgeCalls()).toHaveLength(0);
  });
});

describe("dual-side rejection, each side proven with the other relaxed (design 10.3)", () => {
  it("gateway refuses system.run even when the node would answer it", () => {
    const allowlist = resolveNodeCommandAllowlist({} as OpenBotConfig, {
      platform: "darwin",
      deviceFamily: "Mac",
      capabilityProfile: LOCAL_FILES_READONLY_PROFILE,
    });
    // Node side deliberately relaxed: it declares system.run.
    const res = isNodeCommandAllowed({
      command: "system.run",
      declaredCommands: [...NODE_LOCAL_FILES_READONLY_COMMANDS, "system.run"],
      allowlist,
    });
    expect(res.ok).toBe(false);
    expect(!res.ok && res.reason).toBe("command not allowlisted");
  });

  it("node refuses system.run even when the gateway would forward it", () => {
    // Gateway side deliberately relaxed: pretend the command was allowlisted and
    // forwarded. The node must still refuse on arrival.
    const gate = guardCommand("system.run");
    expect(gate.ok).toBe(false);
    expect(!gate.ok && gate.failure.kind).toBe("command-denied");
  });

  it("node refuses a read whose capability never redeemed, even with a valid signature", async () => {
    // Gateway redemption relaxed to always refuse; the node must not read.
    const refusing: LocalFilesHandlerDeps = {
      ...nodeDeps,
      redemption: { redeem: async () => ({ ok: false, reason: "forced-refusal" }) },
    };
    const runtime = getLocalFilesRuntime()!;
    // Obtain a genuinely signed resolve ticket via the normal path.
    await runtime.service.requestAccess({
      binding: binding(),
      rawPath: `~/Desktop/${ZIP_NAME}`,
      operation: "archive.list",
    });
    const resolveCall = bridgeCalls().find((c) => c.params.capabilityType === "resolve-ticket");
    expect(resolveCall).toBeDefined();

    const outcome = await handleFsStatResolve({
      ticket: resolveCall!.params.capability as never,
      deps: refusing,
    });
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.detail).toContain("redemption-refused");
  });

  it("gateway refuses a capability that the node signature check would accept", () => {
    const runtime = getLocalFilesRuntime()!;
    // A structurally valid but unknown-keyId capability: the node's keyset would
    // reject it, and so does the gateway independently.
    const res = runtime.service.redeem({
      capability: {
        alg: "Ed25519",
        keyId: "cap-unknown",
        claimsJSON: "{}",
        signature: "AAAA",
      },
      operation: "archive.list",
      connection: {
        nodeId: NODE_ID,
        devicePublicKey: DEVICE_KEY,
        authenticated: true,
        capabilityProfile: LOCAL_FILES_READONLY_PROFILE,
        declaredCommands: [...NODE_LOCAL_FILES_READONLY_COMMANDS],
      },
    });
    expect(res.ok).toBe(false);
  });

  // ---- Row 2: the generic invoke route for fs.* / archive.* ----

  it("gateway closes the generic invoke route even though the node serves the command", () => {
    // Node side relaxed: guardCommand admits fs.read, so the node would answer.
    expect(guardCommand("fs.read").ok).toBe(true);
    // The gateway-side route is still shut, and it names the sanctioned tools.
    expect(() => assertNotLocalFilesCommand("fs.read")).toThrow(/local_file\.\*|local_archive\.\*/);
    expect(() => assertNotLocalFilesCommand("archive.readEntry")).toThrow();
  });

  it("node refuses fs.read with no capability even when the gateway forwarded it", async () => {
    // Gateway side relaxed: pretend the generic route let the call through with no
    // Invocation capability attached, which is what a bypass would look like.
    const outcome = await handleFsRead({ capability: undefined as never, deps: nodeDeps });
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.message).toBe(LOCAL_FILES_OPAQUE_DENIAL);
    // Nothing was read, so redemption was never even attempted.
    expect(bridgeCalls()).toHaveLength(0);
  });

  // ---- Row 3: hard-denied paths and sensitive file types ----

  it("gateway refuses a credential path without spending a node round trip", async () => {
    const runtime = getLocalFilesRuntime()!;
    const res = await runtime.service.requestAccess({
      binding: binding(),
      rawPath: "~/.ssh/id_ed25519",
      operation: "fs.read",
    });
    expect(res.ok).toBe(false);
    // The point of the gateway copy of the rule: the node is never contacted.
    expect(bridgeCalls()).toHaveLength(0);
  });

  it("node refuses a credential path the gateway did sign a capability for", async () => {
    // Gateway side fully relaxed: mint a real Turn authorization straight into the
    // store for ~/.ssh/id_ed25519, which the gateway would never issue itself.
    const capability = mintCapabilityFor({
      canonicalPath: path.join(tmpHome, ".ssh", "id_ed25519"),
      operation: "fs.read",
    });
    const outcome = await handleFsRead({ capability, deps: nodeDeps });
    expect(outcome.ok).toBe(false);
    // The node is the last line, and it refuses on its own policy.
    expect(!outcome.ok && outcome.detail).toMatch(/system-path|sensitive-name/);
  });

  // ---- Row 4 (node half): signature refusal without contacting redemption ----

  it("node refuses a foreign-signed token and never asks a permissive gateway", async () => {
    let redeemAttempts = 0;
    // Gateway side relaxed to the extreme: redemption always succeeds.
    const permissive: LocalFilesHandlerDeps = {
      ...nodeDeps,
      redemption: {
        redeem: async () => {
          redeemAttempts += 1;
          return { ok: true };
        },
      },
    };
    const foreign = generateCapabilitySigningKey("evil");
    const forged = issueResolveTicket({
      binding: binding(),
      rawPath: `~/Desktop/${ZIP_NAME}`,
      intendedOperation: "archive.list",
      signingKey: foreign,
      nowMs: Date.now(),
    }).signed;

    const outcome = await handleFsStatResolve({ ticket: forged, deps: permissive });
    expect(outcome.ok).toBe(false);
    // Verification is local and comes first, so the permissive gateway is unused.
    expect(redeemAttempts).toBe(0);
  });

  // ---- Row 5 (gateway half): replay refused even though the node would read ----

  it("gateway refuses a replayed capability even though the node would serve it", async () => {
    const runtime = getLocalFilesRuntime()!;
    const capability = mintCapabilityFor({ canonicalPath: zipPath, operation: "archive.list" });
    const connection = {
      nodeId: NODE_ID,
      devicePublicKey: DEVICE_KEY,
      authenticated: true,
      capabilityProfile: LOCAL_FILES_READONLY_PROFILE,
      declaredCommands: [...NODE_LOCAL_FILES_READONLY_COMMANDS],
    };

    expect(runtime.service.redeem({ capability, operation: "archive.list", connection }).ok).toBe(
      true,
    );
    // Node side relaxed: the file is real and readable, so only the gateway's
    // consumed-nonce record can stop the second use.
    const replay = runtime.service.redeem({ capability, operation: "archive.list", connection });
    expect(replay.ok).toBe(false);
    expect(!replay.ok && replay.reason).toBe("nonce-already-consumed");
  });

  it("gateway refuses a drifted command set even though the capability is valid", () => {
    const runtime = getLocalFilesRuntime()!;
    const capability = mintCapabilityFor({ canonicalPath: zipPath, operation: "archive.list" });
    // Node side relaxed all the way: a genuinely signed capability, the bound key,
    // a real readable file. Only the connection's declared command set drifted, and
    // that alone must stop the redemption (design 9.5).
    const res = runtime.service.redeem({
      capability,
      operation: "archive.list",
      connection: {
        nodeId: NODE_ID,
        devicePublicKey: DEVICE_KEY,
        authenticated: true,
        capabilityProfile: LOCAL_FILES_READONLY_PROFILE,
        declaredCommands: [...NODE_LOCAL_FILES_READONLY_COMMANDS, "system.run"],
      },
    });
    expect(res.ok).toBe(false);
    expect(!res.ok && res.reason).toBe("connection-identity-mismatch");
  });

  // ---- Row 6: path escape and symlinks ----

  it("gateway refuses a system path before the node is asked", async () => {
    const runtime = getLocalFilesRuntime()!;
    for (const rawPath of ["/etc/hosts", "/System/Library/a.plist", "/Volumes/USB/a.txt"]) {
      const res = await runtime.service.requestAccess({
        binding: binding(),
        rawPath,
        operation: "fs.read",
      });
      expect(res.ok).toBe(false);
    }
    // Recognisable from the raw string alone, so no round trip is spent.
    expect(bridgeCalls()).toHaveLength(0);
  });

  it("leaves another user's home to the node, which refuses it", async () => {
    // Deliberately not prefiltered. The gateway knows the platform user id but not
    // the bound account's local username, so it cannot tell /Users/<someone> from
    // the user's own home without canonicalizing on the node. Refusing on a guess
    // would be the wrong direction for a filter that may only deny.
    const runtime = getLocalFilesRuntime()!;
    const res = await runtime.service.requestAccess({
      binding: binding(),
      rawPath: "/Users/someone-else/Desktop/a.txt",
      operation: "fs.read",
    });
    expect(res.ok).toBe(false);
    // One resolve attempt, then the node's outside-user-home layer refuses.
    expect(bridgeCalls()).toHaveLength(1);
    expect(bridgeCalls()[0]?.params.capabilityType).toBe("resolve-ticket");
  });

  it("node refuses a symlink out of bounds after its own level-by-level check", async () => {
    const link = path.join(tmpHome, "Desktop", "shortcut.txt");
    await fs.symlink(path.join(tmpHome, ".ssh", "id_ed25519"), link);
    // Gateway relaxed: a capability naming the link, as if the pre-check passed.
    const capability = mintCapabilityFor({ canonicalPath: link, operation: "fs.read" });

    const outcome = await handleFsRead({ capability, deps: nodeDeps });
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.message).toBe(LOCAL_FILES_OPAQUE_DENIAL);
  });

  // ---- Row 7: ZIP escape and compression bombs ----

  it("gateway hands down a bounded ZIP budget rather than an open task", async () => {
    const runtime = getLocalFilesRuntime()!;
    const res = await runtime.service.requestAccess({
      binding: binding(),
      rawPath: `~/Desktop/${ZIP_NAME}`,
      operation: "archive.list",
    });
    expect(res.ok).toBe(true);

    const authorizations = runtime.turnAuthorizations.allActive(Date.now());
    expect(authorizations).toHaveLength(1);
    // The node can never be handed an unbounded archive task: the limits travel
    // on the signed authorization, which is the gateway half of this row.
    expect(authorizations[0]?.claims.budget).toEqual(ARCHIVE_TASK_BUDGET);
    expect(authorizations[0]?.claims.operations).toEqual(["archive.list", "archive.readEntry"]);
  });

  it("node refuses a Zip Slip entry under a budget large enough to allow it", async () => {
    const evil = new JSZip();
    evil.file("../../escaped.txt", "nope");
    const evilPath = path.join(tmpHome, "Desktop", "evil.zip");
    await fs.writeFile(evilPath, await evil.generateAsync({ type: "nodebuffer" }));
    const escapedTarget = path.join(path.dirname(path.dirname(tmpHome)), "escaped.txt");

    // Gateway relaxed: budget far above the design ceiling, so only the node's
    // entry-name rule can refuse.
    const capability = mintCapabilityFor({
      canonicalPath: evilPath,
      operation: "archive.readEntry",
      archiveEntryPath: "../../escaped.txt",
      budget: { maxCalls: 999, maxEntriesRead: 999, maxTotalExpandedBytes: 64 * 1024 * 1024 },
    });

    const outcome = await handleArchiveReadEntry({ capability, deps: nodeDeps });
    expect(outcome.ok).toBe(false);
    // And nothing escaped onto the disk.
    await expect(fs.stat(escapedTarget)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("a binding created through the ceremony enables a real read", () => {
  /** A live node session as the gateway would see it. */
  function liveSession() {
    return {
      get: (id: string) =>
        id === NODE_ID
          ? {
              nodeId: NODE_ID,
              caps: [LOCAL_FILES_CAP],
              commands: [...NODE_LOCAL_FILES_READONLY_COMMANDS],
              devicePublicKey: DEVICE_KEY,
            }
          : undefined,
    };
  }

  it("refuses every read until a binding exists, then reads once one does", async () => {
    const runtime = getLocalFilesRuntime()!;
    // Start from no bindings at all, which is the state a fresh gateway is in.
    await runtime.bindings.revokePersisted(NODE_ID, Date.now());

    const before = await runtime.service.requestAccess({
      binding: binding(),
      rawPath: `~/Desktop/${ZIP_NAME}`,
      operation: "archive.list",
    });
    expect(before.ok).toBe(false);
    expect(
      (runtime.audit as InMemoryAuditSink)
        .all()
        .some((r) => r.denyReason === "binding:revoked" || r.denyReason === "binding:not-bound"),
    ).toBe(true);

    // The explicit binding action, with the device key taken from the live session.
    const created = await createLocalDeviceBinding({
      nodeId: NODE_ID,
      tenantId: "t1",
      userId: "u1",
      allowedAgentIds: ["bot-skill"],
      bindings: runtime.bindings,
      nodes: liveSession(),
    });
    expect(created.ok).toBe(true);

    const after = await runtime.service.requestAccess({
      binding: binding(),
      rawPath: `~/Desktop/${ZIP_NAME}`,
      operation: "archive.list",
    });
    expect(after.ok).toBe(true);
  });

  it("survives a gateway restart: a rehydrated binding still authorizes", async () => {
    const runtime = getLocalFilesRuntime()!;
    await runtime.bindings.revokePersisted(NODE_ID, Date.now());
    await createLocalDeviceBinding({
      nodeId: NODE_ID,
      tenantId: "t1",
      userId: "u1",
      allowedAgentIds: ["bot-skill"],
      bindings: runtime.bindings,
      nodes: liveSession(),
    });

    // A fresh store over the same persistence stands in for the restart.
    const restarted = new LocalDeviceBindingStore(createFileBindingPersistence(tmpHome));
    expect(await restarted.hydrate()).toBeGreaterThan(0);
    expect(
      restarted.authorize({
        nodeId: NODE_ID,
        tenantId: "t1",
        userId: "u1",
        agentId: "bot-skill",
        devicePublicKey: DEVICE_KEY,
      }).ok,
    ).toBe(true);
  });

  it("refuses to bind a node that also offers system.run", async () => {
    const runtime = getLocalFilesRuntime()!;
    await runtime.bindings.revokePersisted(NODE_ID, Date.now());
    const created = await createLocalDeviceBinding({
      nodeId: NODE_ID,
      tenantId: "t1",
      userId: "u1",
      allowedAgentIds: ["bot-skill"],
      bindings: runtime.bindings,
      nodes: {
        get: () => ({
          nodeId: NODE_ID,
          caps: [LOCAL_FILES_CAP],
          commands: [...NODE_LOCAL_FILES_READONLY_COMMANDS, "system.run"],
          devicePublicKey: DEVICE_KEY,
        }),
      },
    });
    expect(created.ok).toBe(false);
    expect(!created.ok && created.reason).toBe("node-command-set-mismatch");
  });
});

describe("keyset is required before any read", () => {
  it("refuses every read when the node never received a keyset", async () => {
    const emptyKeyset = new PersistentNodeCapabilityKeyset(path.join(tmpHome, "empty-keyset.json"));
    const depsWithoutKeyset: LocalFilesHandlerDeps = { ...nodeDeps, keyset: emptyKeyset };
    const runtime = getLocalFilesRuntime()!;
    await runtime.service.requestAccess({
      binding: binding(),
      rawPath: `~/Desktop/${ZIP_NAME}`,
      operation: "archive.list",
    });
    const resolveCall = bridgeCalls().find((c) => c.params.capabilityType === "resolve-ticket");

    const outcome = await handleFsStatResolve({
      ticket: resolveCall!.params.capability as never,
      deps: depsWithoutKeyset,
    });
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.detail).toContain("no-keyset");
  });

  it("advertises the capability name the gateway keys keyset delivery on", () => {
    expect(LOCAL_FILES_CAP).toBe("local-files");
    expect(LOCAL_FILES_KEYSET_EVENT).toBe("localFiles.keyset");
  });
});
