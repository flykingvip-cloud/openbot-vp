/**
 * Design 10.4: the audit evidence submission.
 *
 * That section asks for redacted audit records from a real run, covering seven
 * outcomes, checked field by field against design 4.12, and proven to carry no
 * content, no credentials and no complete local path.
 *
 * So this is not a shape test over hand-built records. Every record below comes
 * out of the real gateway service driving the real node handlers against a real
 * temp filesystem, exactly as `activation.test.ts` does. The assertions are the
 * gate; the artifact is a by-product.
 *
 * Regenerate the committed artifact with:
 *   OPENBOT_LDRG_WRITE_AUDIT_EVIDENCE=1 pnpm vitest --run \
 *     src/gateway/local-files/audit-evidence.test.ts
 * It is written only under that flag, so an ordinary test run never touches the
 * working tree.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NODE_LOCAL_FILES_READONLY_COMMANDS } from "../../infra/node-commands.js";
import {
  findForbiddenAuditFields,
  InMemoryAuditSink,
  type LocalFilesAuditRecord,
} from "../../local-files/audit.js";
import { createFileBindingPersistence } from "../../local-files/device-binding-persistence.js";
import { LOCAL_FILES_READONLY_PROFILE } from "../../local-files/types.js";
import {
  handleArchiveList,
  handleArchiveReadEntry,
  handleFsRead,
  handleFsStatResolve,
  classifyHandlerFailure,
  type LocalFilesHandlerDeps,
} from "../../node-host/local-files/handlers.js";
import {
  applyLocalFilesKeysetEvent,
  PersistentNodeCapabilityKeyset,
} from "../../node-host/local-files/keyset-store.js";
import { LocalFileApprovalService } from "./approval.js";
import {
  configureLocalFilesRuntime,
  getLocalFilesRuntime,
  resetLocalFilesRuntime,
} from "./runtime.js";

const NODE_ID = "evidence-node";
const DEVICE_KEY = "evidence-device-key";
const ZIP_NAME = "box-browser-auth-skills.zip";
const ARTIFACT = path.join(
  process.cwd(),
  ".kiro",
  "specs",
  "local-disk-read-grant",
  "audit-evidence.jsonl",
);

/** The seven outcomes design 10.4 requires, in the order it lists them. */
type Category =
  | "directed-read-allowed"
  | "approved-once-allowed"
  | "denied"
  | "approval-timeout"
  | "budget-exhausted"
  | "redemption-failed"
  | "open-failed";

let tmpHome: string;
let zipPath: string;
let audit: InMemoryAuditSink;
let nodeDeps: LocalFilesHandlerDeps;
let approvalDecision: "allow-once" | "deny" | "none";
let redeemOverride: (() => { ok: false; reason: string }) | null;
const collected = new Map<Category, LocalFilesAuditRecord>();

function binding(overrides: Record<string, string> = {}) {
  return {
    tenantId: "acme",
    userId: "u-1042",
    agentId: "bot-skill",
    sessionKey: "s-77",
    turnId: "turn-1",
    nodeId: NODE_ID,
    devicePublicKey: DEVICE_KEY,
    ...overrides,
  };
}

/** The node side, running the real handlers behind the gateway's invoke port. */
function nodeBridge() {
  return {
    invoke: async (params: { command: string; params?: unknown }) => {
      const invokeParams = (params.params ?? {}) as Record<string, unknown>;
      const capability = invokeParams.capability as never;
      const outcome =
        invokeParams.capabilityType === "resolve-ticket"
          ? await handleFsStatResolve({ ticket: capability, deps: nodeDeps })
          : params.command === "archive.list"
            ? await handleArchiveList({ capability, deps: nodeDeps })
            : params.command === "archive.readEntry"
              ? await handleArchiveReadEntry({ capability, deps: nodeDeps })
              : await handleFsRead({ capability, deps: nodeDeps });
      if (!outcome.ok) {
        // Same mapping the real dispatcher uses: a coarse class, never the detail.
        return {
          ok: false,
          error: { code: classifyHandlerFailure(outcome.detail), message: outcome.message },
        };
      }
      return { ok: true, payload: outcome };
    },
  };
}

beforeEach(async () => {
  resetLocalFilesRuntime();
  tmpHome = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "ldrg-audit-")));
  await fs.mkdir(path.join(tmpHome, "Desktop"), { recursive: true });
  await fs.mkdir(path.join(tmpHome, ".ssh"), { recursive: true });
  await fs.writeFile(path.join(tmpHome, ".ssh", "id_ed25519"), "SECRET KEY MATERIAL");

  const zip = new JSZip();
  zip.file("skills/box-browser-auth/SKILL.md", "# Box Browser Auth\nstep one\n");
  zip.file("skills/box-browser-auth/meta.json", '{"name":"box-browser-auth"}');
  zipPath = path.join(tmpHome, "Desktop", ZIP_NAME);
  await fs.writeFile(zipPath, await zip.generateAsync({ type: "nodebuffer" }));

  approvalDecision = "allow-once";
  redeemOverride = null;
  audit = new InMemoryAuditSink();

  const approvals = new LocalFileApprovalService({
    events: {
      requested: ({ id }) => {
        const decision = approvalDecision;
        if (decision !== "none") {
          setTimeout(() => approvals.resolve({ id, decision }), 0);
        }
      },
      resolved: () => {},
    },
    hasApprovalRoute: () => true,
    timeoutMs: 60,
  });

  const runtime = configureLocalFilesRuntime({
    node: nodeBridge(),
    bindingPersistence: createFileBindingPersistence(tmpHome),
    approvals,
    audit,
    homeDirForAudit: tmpHome,
  });
  runtime.bindings.put({
    tenantId: "acme",
    userId: "u-1042",
    nodeId: NODE_ID,
    devicePublicKey: DEVICE_KEY,
    allowedAgentIds: ["bot-skill"],
    capabilityProfile: LOCAL_FILES_READONLY_PROFILE,
    status: "active",
    createdAtMs: Date.now() - 1000,
  });

  const keyset = new PersistentNodeCapabilityKeyset(path.join(tmpHome, "keyset.json"));
  expect(applyLocalFilesKeysetEvent(runtime.publishKeyset(), keyset).ok).toBe(true);

  nodeDeps = {
    keyset,
    configuredProfile: LOCAL_FILES_READONLY_PROFILE,
    policy: { homeDir: tmpHome, caseInsensitive: true },
    redemption: {
      redeem: async ({ capability, operation }) => {
        if (redeemOverride) {
          return redeemOverride();
        }
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

function recordDirected(rawPath: string, turnId = "turn-1") {
  getLocalFilesRuntime()!.directedResources.record({
    inboundMessageId: "msg-2026-09-21",
    tenantId: "acme",
    userId: "u-1042",
    sessionKey: "s-77",
    turnId,
    nodeId: NODE_ID,
    spans: [
      {
        startOffset: 0,
        endOffset: rawPath.length,
        sourceKind: "authored_text",
        normalizedInput: rawPath,
        requestedIntent: "inspect-archive",
      },
    ],
    nowMs: Date.now(),
  });
}

/** Take the last record and file it under a category. */
function capture(category: Category): LocalFilesAuditRecord {
  const all = audit.all();
  const record = all[all.length - 1];
  expect(record, `no audit record produced for ${category}`).toBeDefined();
  collected.set(category, record);
  return record;
}

describe("audit evidence for design 10.4, from a real run", () => {
  it("1. a directed read that was allowed", async () => {
    recordDirected(`~/Desktop/${ZIP_NAME}`);
    const res = await getLocalFilesRuntime()!.service.requestAccess({
      binding: binding(),
      rawPath: `~/Desktop/${ZIP_NAME}`,
      operation: "archive.list",
      inboundMessageId: "msg-2026-09-21",
    });
    expect(res.ok).toBe(true);

    const record = capture("directed-read-allowed");
    expect(record.decision).toBe("allowed");
    expect(record.grantSource).toBe("user-directed");
  });

  it("2. a read allowed by a one-time approval", async () => {
    // No directed record, so the card is the only way through.
    const res = await getLocalFilesRuntime()!.service.requestAccess({
      binding: binding(),
      rawPath: `~/Desktop/${ZIP_NAME}`,
      operation: "archive.list",
      inboundMessageId: "msg-2026-09-21",
    });
    expect(res.ok).toBe(true);

    const record = capture("approved-once-allowed");
    expect(record.decision).toBe("allowed");
    expect(record.grantSource).toBe("user-approved-once");
  });

  it("3. a refusal", async () => {
    const res = await getLocalFilesRuntime()!.service.requestAccess({
      binding: binding(),
      rawPath: "~/.ssh/id_ed25519",
      operation: "fs.read",
      inboundMessageId: "msg-2026-09-21",
    });
    expect(res.ok).toBe(false);

    const record = capture("denied");
    expect(record.decision).toBe("denied");
    expect(record.denyReason).toMatch(/^prefilter:/);
  });

  it("4. an approval that timed out", async () => {
    approvalDecision = "none";
    const res = await getLocalFilesRuntime()!.service.requestAccess({
      binding: binding(),
      rawPath: `~/Desktop/${ZIP_NAME}`,
      operation: "archive.list",
      inboundMessageId: "msg-2026-09-21",
    });
    expect(res.ok).toBe(false);

    const record = capture("approval-timeout");
    expect(record.decision).toBe("denied");
    expect(record.denyReason).toBe("approval:timeout");
  });

  it("5. a budget that ran out", async () => {
    const runtime = getLocalFilesRuntime()!;
    recordDirected(`~/Desktop/${ZIP_NAME}`);
    const first = await runtime.service.requestAccess({
      binding: binding(),
      rawPath: `~/Desktop/${ZIP_NAME}`,
      operation: "archive.list",
      inboundMessageId: "msg-2026-09-21",
    });
    expect(first.ok).toBe(true);

    // Spend the byte budget the way a real read would, then ask again.
    const authorization = runtime.turnAuthorizations.allActive(Date.now())[0];
    runtime.turnAuthorizations.recordBytes(
      authorization.claims.authorizationId,
      authorization.claims.budget.maxTotalExpandedBytes,
    );
    const second = await runtime.service.requestAccess({
      binding: binding(),
      rawPath: `~/Desktop/${ZIP_NAME}`,
      operation: "archive.readEntry",
      archiveEntryPath: "skills/box-browser-auth/SKILL.md",
      inboundMessageId: "msg-2026-09-21",
    });
    expect(second.ok).toBe(false);

    const record = capture("budget-exhausted");
    expect(record.decision).toBe("denied");
    expect(record.denyReason).toMatch(/budget-exhausted/);
  });

  it("6. a redemption the gateway refused", async () => {
    recordDirected(`~/Desktop/${ZIP_NAME}`);
    redeemOverride = () => ({ ok: false, reason: "nonce-already-consumed" });

    const res = await getLocalFilesRuntime()!.service.requestAccess({
      binding: binding(),
      rawPath: `~/Desktop/${ZIP_NAME}`,
      operation: "archive.list",
      inboundMessageId: "msg-2026-09-21",
    });
    expect(res.ok).toBe(false);

    const record = capture("redemption-failed");
    expect(record.decision).toBe("denied");
    // Distinguishable from a failed open, which is the point of the failure class.
    expect(record.errorCode).toBe("REDEMPTION_REFUSED");
    expect(record.denyReason).toBe("node:REDEMPTION_REFUSED");
  });

  it("7. an open that failed after redemption succeeded", async () => {
    recordDirected(`~/Desktop/${ZIP_NAME}`);
    const runtime = getLocalFilesRuntime()!;

    // First call resolves, is approved, and pins the file identity on the
    // authorization. The bounded ZIP task covers readEntry too.
    const first = await runtime.service.requestAccess({
      binding: binding(),
      rawPath: `~/Desktop/${ZIP_NAME}`,
      operation: "archive.list",
      inboundMessageId: "msg-2026-09-21",
    });
    expect(first.ok).toBe(true);

    // Swap the file for a different one at the same path. Same name, new inode.
    const replacement = new JSZip();
    replacement.file("skills/box-browser-auth/SKILL.md", "# substituted\n");
    await fs.rm(zipPath);
    await fs.writeFile(zipPath, await replacement.generateAsync({ type: "nodebuffer" }));

    // The second call reuses the open authorization, so it skips resolve and goes
    // straight to the read: redemption succeeds and the identity check then fails.
    const second = await runtime.service.requestAccess({
      binding: binding(),
      rawPath: `~/Desktop/${ZIP_NAME}`,
      operation: "archive.readEntry",
      archiveEntryPath: "skills/box-browser-auth/SKILL.md",
      inboundMessageId: "msg-2026-09-21",
    });
    expect(second.ok).toBe(false);

    const record = capture("open-failed");
    expect(record.decision).toBe("denied");
    // Redemption had already succeeded, so this is not a permission refusal.
    expect(record.errorCode).toBe("OPEN_FAILED");
    expect(record.grantSource).toBeDefined();
  });
});

describe("every collected record satisfies design 4.12", () => {
  // Runs last: the suite above fills `collected`, which persists across the
  // per-test temp directories because it keys on category, not on run.
  const REQUIRED: Array<keyof LocalFilesAuditRecord> = [
    "at",
    "durationMs",
    "tenantId",
    "userId",
    "agentId",
    "sessionKey",
    "turnId",
    "inboundMessageId",
    "nodeId",
    "operation",
    "pathHash",
    "pathDisplay",
    "decision",
  ];

  it("covers all seven outcomes", () => {
    expect([...collected.keys()].toSorted()).toEqual(
      [
        "approval-timeout",
        "approved-once-allowed",
        "budget-exhausted",
        "denied",
        "directed-read-allowed",
        "open-failed",
        "redemption-failed",
      ].toSorted(),
    );
  });

  it("carries every required field on every record", () => {
    for (const [category, record] of collected) {
      for (const field of REQUIRED) {
        expect(record[field], `${category}.${field}`).toBeDefined();
      }
      // A denial states why; an allowed read accounts for its bytes.
      if (record.decision === "denied") {
        expect(record.denyReason, category).toBeDefined();
      } else {
        expect(record.bytesReturned, category).toBeDefined();
        expect(record.grantSource, category).toBeDefined();
      }
    }
  });

  it("carries no content, no credential and no capability material", () => {
    for (const [category, record] of collected) {
      expect(findForbiddenAuditFields(record), category).toEqual([]);
      const serialized = JSON.stringify(record);
      for (const forbidden of ["SECRET KEY MATERIAL", "Box Browser Auth", "step one", "BEGIN"]) {
        expect(serialized.includes(forbidden), `${category} leaked ${forbidden}`).toBe(false);
      }
    }
  });

  it("carries no complete local path", () => {
    for (const [category, record] of collected) {
      const serialized = JSON.stringify(record);
      // The temp home is this run's real local path. No record may contain it,
      // nor a full filename, nor an absolute path of any kind.
      expect(serialized.includes(tmpHome), category).toBe(false);
      expect(serialized.includes(ZIP_NAME), category).toBe(false);
      expect(serialized.includes("id_ed25519"), category).toBe(false);
      expect(record.pathDisplay.startsWith("/Users/"), category).toBe(false);
      // What remains is a hash plus an elided display form.
      expect(record.pathHash).toMatch(/^[0-9a-f]{64}$/);
      expect(record.pathDisplay).toContain("\u2026");
    }
  });

  it("writes the artifact when asked to", async () => {
    if (process.env.OPENBOT_LDRG_WRITE_AUDIT_EVIDENCE !== "1") {
      expect(collected.size).toBe(7);
      return;
    }
    const lines = [...collected.entries()].map(([category, record]) =>
      JSON.stringify({ category, ...record }),
    );
    await fs.writeFile(ARTIFACT, `${lines.join("\n")}\n`, "utf8");
    expect((await fs.stat(ARTIFACT)).size).toBeGreaterThan(0);
  });
});
