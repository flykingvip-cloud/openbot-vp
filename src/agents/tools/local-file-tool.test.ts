import { describe, expect, it } from "vitest";
import { LocalFilesService } from "../../gateway/local-files/service.js";
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
} from "../../local-files/types.js";
import { assertSharedFsExecMutationAllowed } from "../shared-fs-resource-policy.js";
import {
  assertNotLocalFilesCommand,
  createLocalFileTools,
  isLocalFilesCommand,
  type LocalFileToolIdentity,
} from "./local-file-tool.js";

const NOW = 1_800_000_000_000;
const NODE_ID = "node-mac";
const DEVICE_KEY = "device-key-mac";
const CANONICAL = "/Users/demo/Desktop/pack.zip";

const IDENTITY: LocalFileToolIdentity = {
  tenantId: "t1",
  userId: "u1",
  agentId: "bot-skill",
  sessionKey: "s1",
  turnId: "turn-1",
  inboundMessageId: "msg-1",
};

function makeTools(opts?: { approve?: boolean; noDevice?: boolean; directedPath?: string }) {
  const signingKey = generateCapabilitySigningKey();
  const bindings = new LocalDeviceBindingStore();
  const turnAuthorizations = new TurnAuthorizationStore();
  const directedResources = new DirectedResourceRegistry();
  const audit = new InMemoryAuditSink();

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

  if (opts?.directedPath) {
    directedResources.record({
      inboundMessageId: "msg-1",
      tenantId: "t1",
      userId: "u1",
      sessionKey: "s1",
      turnId: "turn-1",
      nodeId: NODE_ID,
      spans: [
        {
          startOffset: 0,
          endOffset: opts.directedPath.length,
          sourceKind: "authored_text",
          normalizedInput: opts.directedPath,
          requestedIntent: "inspect-archive",
        },
      ],
      nowMs: NOW,
    });
  }

  const approvalPrompts: string[] = [];
  const service = new LocalFilesService({
    signingKey,
    bindings,
    turnAuthorizations,
    directedResources,
    redemption: {
      keyResolver: new StaticCapabilityKeyResolver([verificationKeyFor(signingKey)]),
      turnAuthorizations,
      bindings,
      nonces: new NonceLedger(),
    },
    audit,
    now: () => NOW,
    node: {
      async invoke({ params }) {
        if (params.capabilityType === "resolve-ticket") {
          return {
            ok: true,
            payload: {
              canonicalPath: CANONICAL,
              targetKind: "file",
              fileId: { dev: "1", ino: "2" },
            },
          };
        }
        return {
          ok: true,
          payload: { entries: [{ path: "a.md", isDirectory: false }], bytesReturned: 4 },
        };
      },
    },
    approvals: {
      async requestLocalFileApproval({ canonicalPath }) {
        approvalPrompts.push(canonicalPath);
        return opts?.approve ? "allow-once" : "deny";
      },
    },
  });

  const tools = createLocalFileTools({
    service,
    identity: IDENTITY,
    resolveNodeId: async () =>
      opts?.noDevice ? null : { nodeId: NODE_ID, devicePublicKey: DEVICE_KEY },
  });

  return { tools, audit, approvalPrompts, service };
}

function toolNamed(tools: ReturnType<typeof makeTools>["tools"], name: string) {
  const tool = tools.find((t) => t.name === name);
  if (!tool?.execute) {
    throw new Error(`tool not found: ${name}`);
  }
  return tool;
}

function parseResult(result: unknown): Record<string, unknown> {
  const details = (result as { details?: unknown }).details;
  return (details ?? {}) as Record<string, unknown>;
}

describe("tool surface (design 4.6)", () => {
  it("exposes exactly the five namespaced tools and nothing that writes", () => {
    const { tools } = makeTools();
    expect(tools.map((t) => t.name).toSorted()).toEqual([
      "local_archive.list",
      "local_archive.read_entry",
      "local_file.list",
      "local_file.read",
      "local_file.stat",
    ]);
    for (const forbidden of ["write", "delete", "move", "exec", "chmod"]) {
      expect(tools.some((t) => t.name.includes(forbidden))).toBe(false);
    }
  });

  it("accepts no authorization argument a model could forge (design 5)", () => {
    const { tools } = makeTools();
    for (const tool of tools) {
      const schema = tool.parameters as { properties?: Record<string, unknown> };
      const keys = Object.keys(schema.properties ?? {});
      // Only a path, and an entry path for the archive entry tool.
      expect(keys.toSorted()).toEqual(
        tool.name === "local_archive.read_entry" ? ["entryPath", "path"] : ["path"],
      );
      for (const forbidden of ["userDirected", "capability", "nodeId", "grant", "approved"]) {
        expect(keys).not.toContain(forbidden);
      }
    }
  });

  it("uses flat schemas with no anyOf/oneOf/allOf", () => {
    const { tools } = makeTools();
    for (const tool of tools) {
      const serialized = JSON.stringify(tool.parameters);
      expect(serialized).not.toContain("anyOf");
      expect(serialized).not.toContain("oneOf");
      expect(serialized).not.toContain("allOf");
      expect((tool.parameters as { type?: string }).type).toBe("object");
    }
  });
});

describe("tools carry authorization rather than asserting it", () => {
  it("reads a user-named archive without an approval card", async () => {
    const { tools, approvalPrompts } = makeTools({ directedPath: CANONICAL });
    const result = await toolNamed(tools, "local_archive.list").execute?.("call-1", {
      path: CANONICAL,
    });
    const payload = parseResult(result);
    expect(payload.ok).toBe(true);
    expect(approvalPrompts).toHaveLength(0);
  });

  it("returns the opaque denial when approval is refused", async () => {
    const { tools, approvalPrompts } = makeTools({ approve: false });
    const result = await toolNamed(tools, "local_file.read").execute?.("call-1", {
      path: "~/Desktop/other.txt",
    });
    const payload = parseResult(result);
    expect(payload.ok).toBe(false);
    expect(payload.message).toBe(LOCAL_FILES_OPAQUE_DENIAL);
    expect(approvalPrompts).toHaveLength(1);
    // Nothing about the path leaks.
    expect(JSON.stringify(payload)).not.toContain(CANONICAL);
  });

  it("refuses when the user has no active device binding, without guessing one", async () => {
    const { tools } = makeTools({ noDevice: true });
    const result = await toolNamed(tools, "local_file.read").execute?.("call-1", {
      path: "~/Desktop/a.txt",
    });
    const payload = parseResult(result);
    expect(payload.ok).toBe(false);
    expect(payload.message).toBe(LOCAL_FILES_OPAQUE_DENIAL);
  });

  it("requires an entry path for archive entry reads", async () => {
    const { tools } = makeTools({ directedPath: CANONICAL });
    await expect(
      toolNamed(tools, "local_archive.read_entry").execute?.("call-1", { path: CANONICAL }),
    ).rejects.toThrow(/entryPath required/);
  });
});

describe("the generic node invoke route is closed (acceptance 6.9)", () => {
  it("classifies fs.* and archive.* as local files commands", () => {
    for (const command of [
      "fs.stat",
      "fs.list",
      "fs.read",
      "archive.list",
      "archive.readEntry",
      "FS.READ",
      "  fs.read  ",
      "fs.somethingNew",
    ]) {
      expect(isLocalFilesCommand(command)).toBe(true);
    }
  });

  it("leaves unrelated node commands alone", () => {
    for (const command of ["system.run", "browser.proxy", "camera.snap", "device.info"]) {
      expect(isLocalFilesCommand(command)).toBe(false);
      expect(() => assertNotLocalFilesCommand(command)).not.toThrow();
    }
  });

  it("throws for every profile command, naming the sanctioned tools", () => {
    for (const command of ["fs.stat", "fs.list", "fs.read", "archive.list", "archive.readEntry"]) {
      expect(() => assertNotLocalFilesCommand(command)).toThrow(/local_file\.\*|local_archive\.\*/);
    }
  });
});

describe("the gateway workspace exec policy is unchanged (acceptance 6.1)", () => {
  // Acceptance 6.1 ends with "the gateway workspace exec still refuses /dev/null
  // and paths outside the workspace". That is a regression assertion about a
  // neighbouring subsystem: granting a read-only disk capability must not widen
  // the shell tool's path policy. The decision lives in one function
  // (assertSharedFsExecMutationAllowed, src/agents/shared-fs-resource-policy.ts)
  // and this drives it directly, so the assertion is about the policy rather
  // than about a spawned process.
  const WORKSPACE = "/Users/demo/workspace-bot-skill";

  function execWith(command: string, workspaceOnly = true) {
    return () =>
      assertSharedFsExecMutationAllowed({
        command,
        workdir: WORKSPACE,
        workspaceRoot: WORKSPACE,
        workspaceOnly,
      });
  }

  it("leaves /dev/null as a safe sink and still denies real escapes", () => {
    // Main treats /dev/null as a harmless redirect sink. This grant must not
    // change that, and must not start allowing writes outside the workspace.
    expect(execWith("printf 'x\\n' > /dev/null")).not.toThrow();
    expect(execWith("ls 2>/dev/null")).not.toThrow();
  });

  it("still refuses paths outside the workspace", () => {
    for (const command of [
      "printf 'x\\n' > /tmp/escape.txt",
      "touch /Users/demo/Desktop/escape.txt",
      "tee /etc/hosts",
      "cp inside.txt /Users/other/Desktop/out.txt",
    ]) {
      expect(execWith(command)).toThrow(/exec denied: shared-fs-resource intersect/);
    }
  });

  it("still allows a target inside the workspace, so nothing was narrowed either", () => {
    expect(execWith("printf 'x\\n' > ./out.txt")).not.toThrow();
    expect(execWith(`printf 'x\\n' > ${WORKSPACE}/out.txt`)).not.toThrow();
  });

  it("records the two limits this assertion does not claim to cover", () => {
    // 1. The policy is opt-in. tools.fs.workspaceOnly defaults to false, so with
    //    the shipped default nothing here is denied at all. The acceptance case
    //    describes a workspace-scoped agent, which is why the tests above pass
    //    workspaceOnly explicitly.
    expect(execWith("printf 'x\\n' > /dev/null", false)).not.toThrow();
    // 2. Only mutation forms are extracted. Input redirection is not intercepted,
    //    so reads through exec are outside this policy's reach. Asserted so the
    //    gap stays visible rather than being mistaken for coverage.
    expect(execWith("cat < /dev/null")).not.toThrow();
  });
});
