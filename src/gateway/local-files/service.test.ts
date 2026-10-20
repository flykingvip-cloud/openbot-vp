import { describe, expect, it } from "vitest";
import { NODE_LOCAL_FILES_READONLY_COMMANDS } from "../../infra/node-commands.js";
import { InMemoryAuditSink } from "../../local-files/audit.js";
import { LocalDeviceBindingStore } from "../../local-files/device-binding.js";
import { DirectedResourceRegistry } from "../../local-files/directed-resource.js";
import { generateCapabilitySigningKey, verificationKeyFor } from "../../local-files/keyset.js";
import { NonceLedger } from "../../local-files/nonce-ledger.js";
import { StaticCapabilityKeyResolver } from "../../local-files/redemption.js";
import { TurnAuthorizationStore } from "../../local-files/turn-authorization.js";
import {
  LOCAL_FILES_OPAQUE_DENIAL,
  LOCAL_FILES_READONLY_PROFILE,
  type CapabilityBinding,
  type LocalFilesOperation,
  type SignedCapability,
} from "../../local-files/types.js";
import {
  LocalFilesService,
  type ApprovalDecision,
  type ApprovalTask,
  type NodeInvokeOutcome,
} from "./service.js";

const NOW = 1_800_000_000_000;
const HOME = "/Users/demo";
const NODE_ID = "node-mac";
const DEVICE_KEY = "device-key-mac";
const CANONICAL_ZIP = "/Users/demo/Desktop/box-browser-auth-skills.zip";

const BINDING: CapabilityBinding = {
  tenantId: "t1",
  userId: "u1",
  agentId: "bot-skill",
  sessionKey: "s1",
  turnId: "turn-1",
  nodeId: NODE_ID,
  devicePublicKey: DEVICE_KEY,
};

type NodeCall = { command: string; params: Record<string, unknown> };

function makeHarness(opts?: {
  approval?: ApprovalDecision;
  resolveFails?: boolean;
  nodeReadFails?: boolean;
}) {
  const signingKey = generateCapabilitySigningKey();
  const bindings = new LocalDeviceBindingStore();
  const turnAuthorizations = new TurnAuthorizationStore();
  const directedResources = new DirectedResourceRegistry();
  const audit = new InMemoryAuditSink();
  const nonces = new NonceLedger();
  const keyResolver = new StaticCapabilityKeyResolver([verificationKeyFor(signingKey)]);

  bindings.put({
    tenantId: "t1",
    userId: "u1",
    nodeId: NODE_ID,
    devicePublicKey: DEVICE_KEY,
    allowedAgentIds: ["bot-skill"],
    capabilityProfile: LOCAL_FILES_READONLY_PROFILE,
    status: "active",
    createdAtMs: NOW - 1000,
  });

  const nodeCalls: NodeCall[] = [];
  const approvalPrompts: Array<{ task: ApprovalTask; canonicalPath: string }> = [];
  const statuses: string[] = [];

  const service = new LocalFilesService({
    signingKey,
    bindings,
    turnAuthorizations,
    directedResources,
    redemption: { keyResolver, turnAuthorizations, bindings, nonces },
    audit,
    homeDirForAudit: HOME,
    now: () => NOW,
    node: {
      async invoke({ command, params }): Promise<NodeInvokeOutcome> {
        nodeCalls.push({ command, params });
        if (params.capabilityType === "resolve-ticket") {
          if (opts?.resolveFails) {
            return { ok: false, error: { code: "PERMISSION_DENIED" } };
          }
          return {
            ok: true,
            payload: {
              canonicalPath: CANONICAL_ZIP,
              targetKind: "file",
              fileId: { dev: "16777220", ino: "4242" },
            },
          };
        }
        if (opts?.nodeReadFails) {
          return { ok: false, error: { code: "PERMISSION_DENIED" } };
        }
        if (command === "archive.list") {
          return {
            ok: true,
            payload: { entries: [{ path: "skills/a/SKILL.md", isDirectory: false }] },
          };
        }
        return {
          ok: true,
          payload: {
            text: "# Skill A",
            bytesReturned: 9,
            sha256: "a".repeat(64),
            truncated: false,
          },
        };
      },
    },
    approvals: {
      async requestLocalFileApproval({ task, canonicalPath }) {
        approvalPrompts.push({ task, canonicalPath });
        return opts?.approval ?? "deny";
      },
    },
    status: {
      showDirectedReadStatus({ displayPath }) {
        statuses.push(displayPath);
      },
    },
  });

  return {
    service,
    signingKey,
    bindings,
    turnAuthorizations,
    directedResources,
    audit,
    nonces,
    keyResolver,
    nodeCalls,
    approvalPrompts,
    statuses,
  };
}

function recordDirected(
  registry: DirectedResourceRegistry,
  rawPath: string,
  intent: "read" | "inspect-archive" | "unspecified" = "inspect-archive",
) {
  registry.record({
    inboundMessageId: "msg-2026-09-21",
    tenantId: BINDING.tenantId,
    userId: BINDING.userId,
    sessionKey: BINDING.sessionKey,
    turnId: BINDING.turnId,
    nodeId: NODE_ID,
    spans: [
      {
        startOffset: 0,
        endOffset: rawPath.length,
        sourceKind: "authored_text",
        normalizedInput: rawPath,
        requestedIntent: intent,
      },
    ],
    nowMs: NOW,
  });
}

describe("acceptance 6.1: the 2026-09-21 desktop zip, reproduced", () => {
  it("reads a user-named archive with no approval card and a visible status", async () => {
    const h = makeHarness();
    recordDirected(h.directedResources, CANONICAL_ZIP);

    const listed = await h.service.requestAccess({
      binding: BINDING,
      rawPath: CANONICAL_ZIP,
      operation: "archive.list",
      inboundMessageId: "msg-2026-09-21",
    });

    expect(listed.ok).toBe(true);
    expect(listed.ok && listed.grantSource).toBe("user-directed");
    // No second confirmation for a path the user named in this turn.
    expect(h.approvalPrompts).toHaveLength(0);
    // A non-blocking status is shown instead.
    expect(h.statuses).toEqual([CANONICAL_ZIP]);

    // Resolution happened before any read, via fs.stat in resolve mode.
    expect(h.nodeCalls[0]?.command).toBe("fs.stat");
    expect(h.nodeCalls[0]?.params.capabilityType).toBe("resolve-ticket");
    expect(h.nodeCalls.map((c) => c.command)).not.toContain("fs.resolve");
  });

  it("completes the bounded ZIP task without asking again per entry", async () => {
    const h = makeHarness();
    recordDirected(h.directedResources, CANONICAL_ZIP);

    await h.service.requestAccess({
      binding: BINDING,
      rawPath: CANONICAL_ZIP,
      operation: "archive.list",
    });
    const entry = await h.service.requestAccess({
      binding: BINDING,
      rawPath: CANONICAL_ZIP,
      operation: "archive.readEntry",
      archiveEntryPath: "skills/a/SKILL.md",
    });

    expect(entry.ok).toBe(true);
    expect(h.approvalPrompts).toHaveLength(0);
    // One Turn authorization covered both calls.
    expect(h.turnAuthorizations.size()).toBe(1);

    // Every invocation carried a distinct capability.
    const capabilities = h.nodeCalls
      .filter((c) => c.params.capabilityType !== "resolve-ticket")
      .map((c) => (c.params.capability as SignedCapability).claimsJSON);
    expect(new Set(capabilities).size).toBe(capabilities.length);
  });
});

describe("acceptance 6.2: a path the user did not name needs one-time approval", () => {
  it("does not touch the disk when the approval is denied", async () => {
    const h = makeHarness({ approval: "deny" });

    const res = await h.service.requestAccess({
      binding: BINDING,
      rawPath: "~/Downloads",
      operation: "fs.list",
    });

    expect(res.ok).toBe(false);
    expect(!res.ok && res.message).toBe(LOCAL_FILES_OPAQUE_DENIAL);
    expect(h.approvalPrompts).toHaveLength(1);
    // Only the resolve call happened; no read was attempted.
    expect(h.nodeCalls.filter((c) => c.params.capabilityType !== "resolve-ticket")).toHaveLength(0);
  });

  it("treats a timeout as a denial, never as a default allow", async () => {
    const h = makeHarness({ approval: "timeout" });
    const res = await h.service.requestAccess({
      binding: BINDING,
      rawPath: "~/Downloads",
      operation: "fs.list",
    });
    expect(res.ok).toBe(false);
    expect(h.audit.all().some((r) => r.denyReason === "approval:timeout")).toBe(true);
  });

  it("proceeds when the user allows once, and the grant covers only that task", async () => {
    const h = makeHarness({ approval: "allow-once" });
    const res = await h.service.requestAccess({
      binding: BINDING,
      rawPath: "~/Downloads",
      operation: "fs.list",
    });
    expect(res.ok).toBe(true);
    expect(res.ok && res.grantSource).toBe("user-approved-once");

    const authorization = h.turnAuthorizations.allActive(NOW)[0];
    expect(authorization?.claims.operations).toEqual(["fs.list"]);
    expect(authorization?.claims.scope).toBe("exact");
    expect(authorization?.claims.budget.maxCalls).toBe(1);
  });

  it("describes the bounded task on the card, matching what is granted (9.6 case 3)", async () => {
    const h = makeHarness({ approval: "allow-once" });
    recordDirected(h.directedResources, "unrelated-path");

    await h.service.requestAccess({
      binding: BINDING,
      rawPath: CANONICAL_ZIP,
      operation: "archive.list",
    });

    expect(h.approvalPrompts[0]?.task).toBe("inspect-archive");
    const authorization = h.turnAuthorizations.allActive(NOW)[0];
    // "Inspect this ZIP" grants the entry reads too, not just the first list.
    expect(authorization?.claims.operations.toSorted()).toEqual([
      "archive.list",
      "archive.readEntry",
    ]);
  });

  it("shows the card the path the node canonicalized, not a gateway-built string", async () => {
    const h = makeHarness({ approval: "deny" });
    await h.service.requestAccess({
      binding: BINDING,
      rawPath: "~/Desktop/box-browser-auth-skills.zip",
      operation: "archive.list",
    });
    expect(h.approvalPrompts[0]?.canonicalPath).toBe(CANONICAL_ZIP);
  });
});

describe("no read token exists before the node returns a resolve result (9.6 case 1)", () => {
  it("issues no Turn authorization and no read call when resolve fails", async () => {
    const h = makeHarness({ resolveFails: true, approval: "allow-once" });
    recordDirected(h.directedResources, CANONICAL_ZIP);

    const res = await h.service.requestAccess({
      binding: BINDING,
      rawPath: CANONICAL_ZIP,
      operation: "archive.list",
      inboundMessageId: "msg-2026-09-21",
    });

    expect(res.ok).toBe(false);
    // Nothing was authorized, so there is no token carrying a real path.
    expect(h.turnAuthorizations.size()).toBe(0);
    // The only node call was the resolve attempt itself.
    expect(h.nodeCalls).toHaveLength(1);
    expect(h.nodeCalls[0]?.command).toBe("fs.stat");
    expect(h.nodeCalls[0]?.params.capabilityType).toBe("resolve-ticket");
    // The approval card is never shown for a target that did not resolve.
    expect(h.approvalPrompts).toHaveLength(0);
  });

  it("carries the node's canonical path on the token, never the raw user path", async () => {
    const h = makeHarness();
    recordDirected(h.directedResources, "~/Desktop/pack.zip");

    const res = await h.service.requestAccess({
      binding: BINDING,
      rawPath: "~/Desktop/pack.zip",
      operation: "archive.list",
      inboundMessageId: "msg-2026-09-21",
    });

    expect(res.ok).toBe(true);
    const authorizations = h.turnAuthorizations.allActive(NOW);
    expect(authorizations).toHaveLength(1);
    // The gateway cannot expand `~`; the path on the token came back from the node.
    expect(authorizations[0]?.claims.canonicalPath).toBe(CANONICAL_ZIP);
    expect(authorizations[0]?.claims.fileId).toEqual({ dev: "16777220", ino: "4242" });
  });
});

describe("the model never learns a path's existence before approval (9.6 case 10)", () => {
  it("returns the identical opaque denial whether resolve or approval refused", async () => {
    const resolveDenied = makeHarness({ resolveFails: true });
    const approvalDenied = makeHarness({ approval: "deny" });

    const a = await resolveDenied.service.requestAccess({
      binding: BINDING,
      rawPath: "~/Desktop/secret.txt",
      operation: "fs.read",
    });
    const b = await approvalDenied.service.requestAccess({
      binding: BINDING,
      rawPath: "~/Desktop/exists.txt",
      operation: "fs.read",
    });

    expect(a.ok).toBe(false);
    expect(b.ok).toBe(false);
    expect(!a.ok && a.message).toBe(!b.ok && b.message);
  });

  it("never returns the canonical path, size, inode or type to the caller", async () => {
    const h = makeHarness({ approval: "deny" });
    const res = await h.service.requestAccess({
      binding: BINDING,
      rawPath: "~/Desktop/exists.txt",
      operation: "fs.read",
    });
    const serialized = JSON.stringify(res);
    expect(serialized).not.toContain(CANONICAL_ZIP);
    expect(serialized).not.toContain("4242");
    expect(serialized).not.toContain("targetKind");
  });

  it("does not leak existence through repeated resolve attempts", async () => {
    const h = makeHarness({ approval: "deny" });
    const results: string[] = [];
    for (const candidate of ["~/Desktop/a.txt", "~/Desktop/b.txt", "~/Desktop/c.txt"]) {
      const res = await h.service.requestAccess({
        binding: BINDING,
        rawPath: candidate,
        operation: "fs.read",
      });
      results.push(JSON.stringify(res));
    }
    // Every probe is byte-identical, so nothing can be inferred from the shape.
    expect(new Set(results).size).toBe(1);
  });
});

describe("binding refusals (acceptance 6.11)", () => {
  it("refuses another digital human", async () => {
    const h = makeHarness();
    const res = await h.service.requestAccess({
      binding: { ...BINDING, agentId: "bot-other" },
      rawPath: CANONICAL_ZIP,
      operation: "archive.list",
    });
    expect(res.ok).toBe(false);
    expect(h.nodeCalls).toHaveLength(0);
    expect(h.audit.all().some((r) => r.denyReason === "binding:agent-not-allowed")).toBe(true);
  });

  it("refuses a different tenant", async () => {
    const h = makeHarness();
    const res = await h.service.requestAccess({
      binding: { ...BINDING, tenantId: "t2" },
      rawPath: CANONICAL_ZIP,
      operation: "archive.list",
    });
    expect(res.ok).toBe(false);
    expect(h.audit.all().some((r) => r.denyReason === "binding:tenant-mismatch")).toBe(true);
  });

  it("refuses a revoked binding", async () => {
    const h = makeHarness();
    h.bindings.revoke(NODE_ID, NOW);
    const res = await h.service.requestAccess({
      binding: BINDING,
      rawPath: CANONICAL_ZIP,
      operation: "archive.list",
    });
    expect(res.ok).toBe(false);
    expect(h.audit.all().some((r) => r.denyReason === "binding:revoked")).toBe(true);
  });
});

describe("budget exhaustion and failed opens", () => {
  it("stops after the turn budget is spent (acceptance 6.13)", async () => {
    const h = makeHarness({ approval: "allow-once" });
    // A single-call grant: the second attempt on the same grant must fail.
    await h.service.requestAccess({
      binding: BINDING,
      rawPath: "~/Desktop/notes.txt",
      operation: "fs.read",
    });
    const second = await h.service.requestAccess({
      binding: BINDING,
      rawPath: "~/Desktop/notes.txt",
      operation: "fs.read",
    });
    expect(second.ok).toBe(false);
    expect(h.audit.all().some((r) => r.denyReason?.startsWith("derive:"))).toBe(true);
  });

  it("does not silently retry or reissue when the node's open fails (9.6 case 17)", async () => {
    const h = makeHarness({ nodeReadFails: true });
    recordDirected(h.directedResources, CANONICAL_ZIP);

    const res = await h.service.requestAccess({
      binding: BINDING,
      rawPath: CANONICAL_ZIP,
      operation: "archive.list",
    });
    expect(res.ok).toBe(false);
    // Exactly one read attempt: resolve plus a single archive.list.
    const reads = h.nodeCalls.filter((c) => c.params.capabilityType !== "resolve-ticket");
    expect(reads).toHaveLength(1);
    expect(h.audit.all().some((r) => r.decision === "denied")).toBe(true);
  });
});

describe("audit output (acceptance 6.14)", () => {
  it("records the decision, bytes and hash without content or full path", async () => {
    const h = makeHarness();
    recordDirected(h.directedResources, CANONICAL_ZIP, "read");

    await h.service.requestAccess({
      binding: BINDING,
      rawPath: CANONICAL_ZIP,
      operation: "fs.read",
      inboundMessageId: "msg-2026-09-21",
    });

    const allowed = h.audit.all().find((r) => r.decision === "allowed");
    expect(allowed).toBeDefined();
    expect(allowed?.grantSource).toBe("user-directed");
    expect(allowed?.bytesReturned).toBe(9);
    expect(allowed?.contentHash).toBe("a".repeat(64));
    expect(allowed?.inboundMessageId).toBe("msg-2026-09-21");

    const serialized = JSON.stringify(h.audit.all());
    expect(serialized).not.toContain("# Skill A");
    expect(serialized).not.toContain(CANONICAL_ZIP);
    expect(serialized).not.toContain("claimsJSON");
  });
});

describe("redemption endpoint is reachable through the service", () => {
  it("refuses a capability presented from the wrong connection", () => {
    const h = makeHarness();
    const fabricated: SignedCapability = {
      alg: "Ed25519",
      keyId: "cap-nope",
      claimsJSON: "{}",
      signature: "x",
    };
    const res = h.service.redeem({
      capability: fabricated,
      operation: "fs.read" as LocalFilesOperation,
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

  it("refuses an unauthenticated connection outright", () => {
    const h = makeHarness();
    const res = h.service.redeem({
      capability: { alg: "Ed25519", keyId: "k", claimsJSON: "{}", signature: "x" },
      operation: "fs.read" as LocalFilesOperation,
      connection: {
        nodeId: NODE_ID,
        devicePublicKey: DEVICE_KEY,
        authenticated: false,
        capabilityProfile: LOCAL_FILES_READONLY_PROFILE,
        declaredCommands: [...NODE_LOCAL_FILES_READONLY_COMMANDS],
      },
    });
    expect(res.ok).toBe(false);
    expect(!res.ok && res.reason).toBe("connection-not-authenticated");
  });
});

describe("a paired Mac with no binding yet", () => {
  const DESKTOP = "/Users/demo/Desktop";

  function pairedNode() {
    return {
      nodeId: NODE_ID,
      caps: ["system", "local-files"],
      commands: ["system.run", ...NODE_LOCAL_FILES_READONLY_COMMANDS],
      devicePublicKey: DEVICE_KEY,
      displayName: "UPBEYOND Mac",
    };
  }

  function unboundHarness(opts?: {
    approval?: ApprovalDecision;
    resolveFails?: boolean;
    listNames?: string[];
  }) {
    const signingKey = generateCapabilitySigningKey();
    const bindings = new LocalDeviceBindingStore();
    const turnAuthorizations = new TurnAuthorizationStore();
    const directedResources = new DirectedResourceRegistry();
    const audit = new InMemoryAuditSink();
    const nonces = new NonceLedger();
    const keyResolver = new StaticCapabilityKeyResolver([verificationKeyFor(signingKey)]);
    const approvalPrompts: string[] = [];
    const node = pairedNode();
    const service = new LocalFilesService({
      signingKey,
      bindings,
      turnAuthorizations,
      directedResources,
      redemption: { keyResolver, turnAuthorizations, bindings, nonces },
      audit,
      now: () => NOW,
      nodes: {
        get: (id) => (id === NODE_ID ? node : undefined),
        list: () => [node],
      },
      node: {
        async invoke({ command, params }) {
          if (params.capabilityType === "resolve-ticket") {
            if (opts?.resolveFails) {
              return { ok: false, error: { code: "PERMISSION_DENIED" } };
            }
            return {
              ok: true,
              payload: {
                canonicalPath: DESKTOP,
                targetKind: "directory",
                fileId: { dev: "1", ino: "9" },
              },
            };
          }
          if (command === "fs.list") {
            return {
              ok: true,
              payload: {
                entries: (opts?.listNames ?? ["Notes.txt", "Archive"]).map((name) => ({ name })),
              },
            };
          }
          return { ok: true, payload: {} };
        },
      },
      approvals: {
        async requestLocalFileApproval({ canonicalPath }) {
          approvalPrompts.push(canonicalPath);
          return opts?.approval ?? "deny";
        },
      },
    });
    return { service, bindings, approvalPrompts, turnAuthorizations };
  }

  it("raises a card for ~/Desktop and lists children after Allow Once", async () => {
    const h = unboundHarness({ approval: "allow-once", listNames: ["Notes.txt", "Archive"] });
    const res = await h.service.requestAccess({
      binding: BINDING,
      rawPath: "~/Desktop",
      operation: "fs.list",
    });
    expect(h.approvalPrompts).toEqual([DESKTOP]);
    expect(res.ok).toBe(true);
    const entries = res.ok ? (res.payload as { entries?: Array<{ name: string }> }).entries : [];
    expect(entries?.map((entry) => entry.name)).toEqual(["Notes.txt", "Archive"]);
    const stored = h.bindings.listActiveForUser({ tenantId: "t1", userId: "u1" });
    expect(stored).toHaveLength(1);
    expect(stored[0]?.allowedAgentIds).toEqual(["bot-skill"]);
    expect(stored[0]?.capabilityProfile).toBe(LOCAL_FILES_READONLY_PROFILE);
  });

  it("lists ~/Desktop children after Allow Once when the paired Mac also runs commands", async () => {
    // Live failure: the card resolved, the binding stayed active, and fs.list
    // still came back opaque. The node redeems the invocation against a
    // session whose profile is unset because the Mac declares system.run too.
    const signingKey = generateCapabilitySigningKey();
    const bindings = new LocalDeviceBindingStore();
    const turnAuthorizations = new TurnAuthorizationStore();
    const directedResources = new DirectedResourceRegistry();
    const audit = new InMemoryAuditSink();
    const nonces = new NonceLedger();
    const keyResolver = new StaticCapabilityKeyResolver([verificationKeyFor(signingKey)]);
    const approvalPrompts: string[] = [];
    const macCommands = [
      "browser.proxy",
      "system.run",
      "system.run.prepare",
      "system.which",
      ...NODE_LOCAL_FILES_READONLY_COMMANDS,
    ];
    const macConnection = {
      nodeId: NODE_ID,
      devicePublicKey: DEVICE_KEY,
      authenticated: true,
      capabilityProfile: undefined,
      declaredCommands: macCommands,
    };
    const node = pairedNode();
    const service = new LocalFilesService({
      signingKey,
      bindings,
      turnAuthorizations,
      directedResources,
      redemption: { keyResolver, turnAuthorizations, bindings, nonces },
      audit,
      now: () => NOW,
      nodes: {
        get: (id) => (id === NODE_ID ? node : undefined),
        list: () => [node],
      },
      node: {
        async invoke({ command, params }) {
          const capability = params.capability as SignedCapability;
          if (params.capabilityType === "resolve-ticket") {
            const redeemed = service.redeem({
              capability,
              operation: "fs.stat",
              connection: macConnection,
            });
            if (!redeemed.ok) {
              return {
                ok: false,
                error: { code: "PERMISSION_DENIED", message: LOCAL_FILES_OPAQUE_DENIAL },
              };
            }
            return {
              ok: true,
              payload: {
                canonicalPath: DESKTOP,
                targetKind: "directory",
                fileId: { dev: "1", ino: "9" },
              },
            };
          }
          if (command === "fs.list") {
            const redeemed = service.redeem({
              capability,
              operation: "fs.list",
              connection: macConnection,
            });
            if (!redeemed.ok) {
              return {
                ok: false,
                error: { code: "PERMISSION_DENIED", message: LOCAL_FILES_OPAQUE_DENIAL },
              };
            }
            return {
              ok: true,
              payload: { entries: [{ name: "Notes.txt" }, { name: "Archive" }] },
            };
          }
          return { ok: false, error: { code: "UNAVAILABLE" } };
        },
      },
      approvals: {
        async requestLocalFileApproval({ canonicalPath }) {
          approvalPrompts.push(canonicalPath);
          return "allow-once";
        },
      },
    });

    const res = await service.requestAccess({
      binding: BINDING,
      rawPath: "~/Desktop",
      operation: "fs.list",
    });
    expect(approvalPrompts).toEqual([DESKTOP]);
    expect(res.ok).toBe(true);
    const entries =
      res.ok && res.payload && typeof res.payload === "object"
        ? (res.payload as { entries?: Array<{ name: string }> }).entries
        : undefined;
    expect(entries?.map((entry) => entry.name)).toEqual(["Notes.txt", "Archive"]);
    expect(!res.ok && res.message).not.toBe(LOCAL_FILES_OPAQUE_DENIAL);
    expect(bindings.listActiveForUser({ tenantId: "t1", userId: "u1" })).toHaveLength(1);
  });

  it("remembers the exact directory after Allow Always and does not ask on the next turn", async () => {
    const h = unboundHarness({ approval: "allow-always" });
    const first = await h.service.requestAccess({
      binding: BINDING,
      rawPath: "~/Desktop",
      operation: "fs.list",
    });
    expect(first.ok).toBe(true);
    expect(h.approvalPrompts).toHaveLength(1);
    const second = await h.service.requestAccess({
      binding: { ...BINDING, turnId: "turn-2" },
      rawPath: "~/Desktop",
      operation: "fs.list",
    });
    expect(second.ok).toBe(true);
    expect(h.approvalPrompts).toHaveLength(1);
  });

  it("keeps a hard-deny path opaque and does not raise a card or a binding", async () => {
    const h = unboundHarness({ approval: "allow-once" });
    const res = await h.service.requestAccess({
      binding: BINDING,
      rawPath: "~/.ssh/id_ed25519",
      operation: "fs.read",
    });
    expect(res.ok).toBe(false);
    expect(!res.ok && res.message).toBe(LOCAL_FILES_OPAQUE_DENIAL);
    expect(h.approvalPrompts).toHaveLength(0);
    expect(h.bindings.listActiveForUser({ tenantId: "t1", userId: "u1" })).toHaveLength(0);
  });

  it("does not keep a binding when the user denies the card", async () => {
    const h = unboundHarness({ approval: "deny" });
    const res = await h.service.requestAccess({
      binding: BINDING,
      rawPath: "~/Desktop",
      operation: "fs.list",
    });
    expect(res.ok).toBe(false);
    expect(h.approvalPrompts).toEqual([DESKTOP]);
    expect(h.bindings.listActiveForUser({ tenantId: "t1", userId: "u1" })).toHaveLength(0);
  });
});
