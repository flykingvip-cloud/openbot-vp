import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mergeLedgerSources } from "./runtime-namespace-ledger-merge.js";
import {
  AUDIT_FILENAME,
  MANIFEST_FILENAME,
  MIGRATED_TO_FILENAME,
  decideCopy,
  isRoundFactFile,
  runRuntimeNamespaceMigration,
  type MigrationOptions,
} from "./runtime-namespace-migration.js";
import { inferGroupTenant, tenantHintFromPath } from "./runtime-namespace-tenant-inference.js";

let tmp: string;
let legacyRoot: string;
let tenantsRoot: string;

const sha = (buf: Buffer | string) => createHash("sha256").update(buf).digest("hex");
const nsDir = (tenantId: string, groupId: string) =>
  path.join(
    tenantsRoot,
    tenantId,
    "collaboration",
    "groups",
    encodeURIComponent(groupId),
    "runtime",
  );
const legacyDir = (groupId: string) => path.join(legacyRoot, encodeURIComponent(groupId));

async function write(file: string, content: string) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
}

async function snapshot(root: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const walk = async (dir: string) => {
    for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        await walk(p);
      } else {
        out[path.relative(root, p)] = sha(await fs.readFile(p));
      }
    }
  };
  await walk(root);
  return out;
}

const rec = (kind: string, recordedAtMs: number, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ kind, groupId: "g", recordedAtMs, ...extra });

async function seedGroup(
  groupId: string,
  opts: {
    rounds?: Record<string, string>;
    ledger?: string;
    flatLedger?: string;
    operatingState?: Record<string, unknown>;
  } = {},
) {
  const dir = legacyDir(groupId);
  await write(path.join(dir, "operating-state.json"), JSON.stringify(opts.operatingState ?? {}));
  await write(path.join(dir, "memory", "notes.md"), "keep me");
  for (const [roundId, state] of Object.entries(opts.rounds ?? {})) {
    await write(
      path.join(dir, "runtime", "rounds", `${roundId}.json`),
      `${JSON.stringify({ roundId, groupId, state, stateVersion: 3 }, null, 2)}\n`,
    );
    await write(path.join(dir, "runtime", "rounds", `${roundId}.events.jsonl`), `{"seq":1}\n`);
  }
  if (opts.rounds) {
    await write(path.join(dir, "runtime", "rounds", "stale.lock"), "lock");
  }
  if (opts.ledger !== undefined) {
    await write(path.join(dir, "ledger", "collaboration.jsonl"), opts.ledger);
  }
  if (opts.flatLedger !== undefined) {
    await write(path.join(dir, "collaboration-ledger.jsonl"), opts.flatLedger);
  }
}

function run(extra: Partial<MigrationOptions> = {}) {
  let t = 1_760_000_000_000;
  return runRuntimeNamespaceMigration({
    sourceGroupsRoot: legacyRoot,
    target: { profile: "managed_enterprise", tenantsRoot },
    runId: "test-run",
    now: () => (t += 1),
    ...extra,
  });
}

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-ns-migrate-"));
  legacyRoot = path.join(tmp, "host", "collaboration", "groups");
  tenantsRoot = path.join(tmp, "tenants");
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("ledger merge / dedupe", () => {
  const a = rec("governance", 100, { id: "a" });
  const b = rec("dispatch", 200, { id: "b" });
  const bReordered = JSON.stringify({ recordedAtMs: 200, id: "b", groupId: "g", kind: "dispatch" });
  const c = rec("execution", 150, { id: "c" });
  const noTs = JSON.stringify({ kind: "governance", id: "z" });

  test("dedupes by canonical JSON, canonical file wins, ordered by recordedAtMs", () => {
    const merged = mergeLedgerSources({
      sources: [
        { label: "ledger/collaboration.jsonl", content: `${b}\n${a}\n` },
        {
          label: "collaboration-ledger.jsonl",
          content: `${noTs}\n${bReordered}\n${c}\nnot json\n`,
        },
      ],
    });
    expect(merged.content).toBe(`${a}\n${c}\n${b}\n${noTs}\nnot json\n`);
    expect(merged.duplicatesDropped).toBe(1);
    expect(merged.parseErrors).toBe(1);
    expect(merged.lines).toBe(5);
    expect(merged.sourceLines).toBe(6);
  });

  test("deterministic across runs and incremental append is idempotent", () => {
    const sources = [
      { label: "x", content: `${a}\n${b}\n` },
      { label: "y", content: `${c}\n${a}\n` },
    ];
    const first = mergeLedgerSources({ sources });
    expect(mergeLedgerSources({ sources }).sha256).toBe(first.sha256);
    const again = mergeLedgerSources({ sources, existingTarget: first.content });
    expect(again.appended).toBe(0);
    expect(again.content).toBe(first.content);
    const d = rec("governance", 50, { id: "d" });
    const grown = mergeLedgerSources({
      sources: [...sources, { label: "z", content: `${d}\n` }],
      existingTarget: first.content,
    });
    expect(grown.content).toBe(`${first.content}${d}\n`);
  });
});

describe("helpers", () => {
  test("three-way copy decision", () => {
    expect(decideCopy("s", null)).toBe("copy");
    expect(decideCopy("s", "s")).toBe("unchanged");
    expect(decideCopy("s2", "s1", "s1")).toBe("overwrite");
    expect(decideCopy("s1", "d2", "s1")).toBe("dest_newer");
    expect(decideCopy("s2", "d2", "s1")).toBe("conflict");
    expect(decideCopy("s2", "d2")).toBe("conflict");
  });

  test("round fact files exclude locks and temp files", () => {
    expect(isRoundFactFile("r.json")).toBe(true);
    expect(isRoundFactFile("r.events.jsonl")).toBe(true);
    expect(isRoundFactFile("r.txn")).toBe(true);
    expect(isRoundFactFile("r.lock")).toBe(false);
    expect(isRoundFactFile("r.json.tmp")).toBe(false);
  });

  test("tenant inference precedence and quarantine", async () => {
    const dir = path.join(tmp, "g");
    await write(path.join(dir, "operating-state.json"), "{}");
    await expect(inferGroupTenant({ groupId: "g", legacyGroupDir: dir })).resolves.toMatchObject({
      status: "resolved",
      tenantId: "001",
      reason: "owner-default-tenant-001",
    });
    await expect(
      inferGroupTenant({
        groupId: "g",
        legacyGroupDir: dir,
        tenantMap: { g: "upbeyond-91aeea3c" },
      }),
    ).resolves.toMatchObject({ tenantId: "001", reason: "tenant-map" });
    await expect(
      inferGroupTenant({ groupId: "g", legacyGroupDir: dir, tenantMap: { g: "../x" } }),
    ).resolves.toMatchObject({ status: "quarantine", reason: "invalid-tenant" });
    await write(path.join(dir, "operating-state.json"), JSON.stringify({ tenantId: "002" }));
    await expect(inferGroupTenant({ groupId: "g", legacyGroupDir: dir })).resolves.toMatchObject({
      tenantId: "002",
      reason: "group-record",
    });
    await write(path.join(dir, "profile.json"), JSON.stringify({ tenantId: "003" }));
    await expect(inferGroupTenant({ groupId: "g", legacyGroupDir: dir })).resolves.toMatchObject({
      status: "quarantine",
      reason: "tenant-conflict",
      candidates: ["002", "003"],
    });
    const aclRoot = path.join(tmp, "acl-tenants");
    const dir2 = path.join(tmp, "g2");
    await write(path.join(dir2, "operating-state.json"), "{}");
    await write(path.join(aclRoot, "004", "collaboration", "groups", "g2", "members.json"), "{}");
    await expect(
      inferGroupTenant({ groupId: "g2", legacyGroupDir: dir2, tenantsRoot: aclRoot }),
    ).resolves.toMatchObject({ status: "resolved", tenantId: "004", reason: "group-acl" });
    await write(path.join(aclRoot, "006", "collaboration", "groups", "g2", "members.json"), "{}");
    await expect(
      inferGroupTenant({ groupId: "g2", legacyGroupDir: dir2, tenantsRoot: aclRoot }),
    ).resolves.toMatchObject({ status: "quarantine", candidates: ["004", "006"] });
    expect(tenantHintFromPath("/srv/tenants/007/collaboration/groups/g")).toBe("007");
    expect(tenantHintFromPath("/home/tenants/me/.openbot/collaboration/groups/g")).toBeNull();
  });
});

describe("runRuntimeNamespaceMigration (forward)", () => {
  test("dry-run is the default and writes nothing anywhere", async () => {
    await seedGroup("grp-a", {
      rounds: { r1: "ROUND_COMPLETE" },
      ledger: `${rec("governance", 1)}\n`,
    });
    const before = await snapshot(tmp);
    const report = await run();
    expect(report.mode).toBe("dry-run");
    expect(report.groups[0]).toMatchObject({
      status: "planned",
      namespaceRoot: nsDir("001", "grp-a"),
    });
    expect(report.groups[0].files.map((f) => f.action)).toEqual(["copy", "copy", "copy"]);
    expect(await snapshot(tmp)).toEqual(before);
  });

  test("apply copies (never moves) with 100% sha256 match, manifest, audit and marker", async () => {
    await seedGroup("grp-a", {
      rounds: { r1: "ROUND_COMPLETE", r2: "PRIMARY_QUEUE" },
      ledger: `${rec("governance", 1)}\n${rec("dispatch", 2)}\n`,
    });
    const legacyBefore = await snapshot(legacyRoot);
    const report = await run({ apply: true });
    const group = report.groups[0];
    expect(group.status).toBe("migrated");
    expect(report.totals).toMatchObject({ migrated: 1, verifyFailures: 0, conflicts: 0 });
    expect(report.totals.verified).toBe(report.totals.files);
    // Every source file has a byte-identical copy (sha256) in the namespace.
    const ns = nsDir("001", "grp-a");
    for (const name of ["r1.json", "r1.events.jsonl", "r2.json", "r2.events.jsonl"]) {
      expect(sha(await fs.readFile(path.join(ns, "rounds", name)))).toBe(
        legacyBefore[path.join("grp-a", "runtime", "rounds", name)],
      );
    }
    await expect(fs.stat(path.join(ns, "rounds", "stale.lock"))).rejects.toThrow();
    expect(sha(await fs.readFile(path.join(ns, "ledger", "collaboration.jsonl")))).toBe(
      legacyBefore[path.join("grp-a", "ledger", "collaboration.jsonl")],
    );
    // Copy only: legacy bytes untouched (only the MIGRATED_TO marker is added).
    const legacyAfter = await snapshot(legacyRoot);
    delete legacyAfter[path.join("grp-a", MIGRATED_TO_FILENAME)];
    expect(legacyAfter).toEqual(legacyBefore);
    const manifest = JSON.parse(
      await fs.readFile(path.join(ns, "migration", MANIFEST_FILENAME), "utf8"),
    );
    expect(manifest.files["rounds/r1.json"].baselineSha256).toBe(
      legacyBefore[path.join("grp-a", "runtime", "rounds", "r1.json")],
    );
    const audit = (await fs.readFile(path.join(ns, "migration", AUDIT_FILENAME), "utf8"))
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(audit).toEqual([
      expect.objectContaining({
        actor: "migration",
        reason: "owner-default-tenant-001",
        tenantId: "001",
        from: legacyDir("grp-a"),
        to: ns,
        groupId: "grp-a",
        status: "migrated",
      }),
    ]);
    // Non-terminal round copied as-is and listed.
    expect(group.nonTerminalRounds).toEqual([
      { roundId: "r2", state: "PRIMARY_QUEUE", file: "r2.json" },
    ]);
    expect(group.retainedOnLegacyStore).toEqual(["memory/", "operating-state.json"]);
  });

  test("dual ledgers are merged + deduped, and the rerun is idempotent", async () => {
    const shared = rec("dispatch", 20, { roundId: "r" });
    await seedGroup("grp-dual", {
      ledger: `${rec("governance", 10)}\n${shared}\n`,
      flatLedger: `${JSON.stringify(JSON.parse(shared), Object.keys(JSON.parse(shared)).toReversed())}\n${rec("execution", 15)}\n`,
    });
    const first = await run({ apply: true });
    const entry = first.groups[0].files.find((f) => f.fact === "ledger/collaboration.jsonl");
    expect(entry).toMatchObject({
      action: "merge",
      duplicatesDropped: 1,
      lines: 3,
      verified: true,
    });
    expect(entry?.from).toHaveLength(2);
    const merged = await fs.readFile(
      path.join(nsDir("001", "grp-dual"), "ledger", "collaboration.jsonl"),
      "utf8",
    );
    expect(merged).toBe(`${rec("governance", 10)}\n${rec("execution", 15)}\n${shared}\n`);
    const second = await run({ apply: true });
    expect(second.groups[0].status).toBe("unchanged");
    const audit = await fs.readFile(
      path.join(nsDir("001", "grp-dual"), "migration", AUDIT_FILENAME),
      "utf8",
    );
    expect(audit.trim().split("\n")).toHaveLength(1);
  });

  test("incremental rerun: new + changed files copied, both-sides-changed is a conflict", async () => {
    await seedGroup("grp-i", { rounds: { r1: "ROUND_COMPLETE", r2: "ROUND_COMPLETE" } });
    await run({ apply: true });
    const lr = path.join(legacyDir("grp-i"), "runtime", "rounds");
    const nr = path.join(nsDir("001", "grp-i"), "rounds");
    await write(path.join(lr, "r3.json"), '{"roundId":"r3","state":"ROUND_COMPLETE"}');
    await write(path.join(lr, "r1.events.jsonl"), '{"seq":1}\n{"seq":2}\n');
    await write(path.join(lr, "r2.events.jsonl"), '{"seq":1}\n{"src":2}\n');
    await write(path.join(nr, "r2.events.jsonl"), '{"seq":1}\n{"dst":2}\n');
    const report = await run({ apply: true });
    const actions = Object.fromEntries(report.groups[0].files.map((f) => [f.fact, f.action]));
    expect(actions).toMatchObject({
      "rounds/r3.json": "copy",
      "rounds/r1.events.jsonl": "overwrite",
      "rounds/r2.events.jsonl": "conflict",
      "rounds/r1.json": "unchanged",
    });
    expect(report.groups[0].status).toBe("failed");
    expect(await fs.readFile(path.join(nr, "r2.events.jsonl"), "utf8")).toBe(
      '{"seq":1}\n{"dst":2}\n',
    );
  });

  test("tenant-map / group records route groups; conflicts are quarantined untouched", async () => {
    await seedGroup("grp-map", { ledger: `${rec("governance", 1)}\n` });
    await seedGroup("grp-rec", {
      ledger: `${rec("governance", 1)}\n`,
      operatingState: { tenantId: "002" },
    });
    await seedGroup("grp-bad", {
      ledger: `${rec("governance", 1)}\n`,
      operatingState: { tenantId: "002" },
    });
    await write(
      path.join(legacyDir("grp-bad"), "profile.json"),
      JSON.stringify({ tenantId: "003" }),
    );
    const report = await run({ apply: true, tenantMap: { "grp-map": "005" } });
    const byId = Object.fromEntries(report.groups.map((g) => [g.groupId, g]));
    expect(byId["grp-map"].namespaceRoot).toBe(nsDir("005", "grp-map"));
    expect(byId["grp-rec"].namespaceRoot).toBe(nsDir("002", "grp-rec"));
    expect(byId["grp-bad"]).toMatchObject({
      status: "quarantined",
      namespaceRoot: null,
      files: [],
    });
    expect(byId["grp-bad"].audit).toMatchObject({ reason: "tenant-conflict", to: null });
    expect(report.totals.quarantined).toBe(1);
    expect((await fs.readdir(tenantsRoot)).toSorted()).toEqual(["002", "005"]);
  });

  test("a group already migrated is not re-homed when inference changes", async () => {
    await seedGroup("grp-m", { ledger: `${rec("governance", 1)}\n` });
    await run({ apply: true });
    const report = await run({ apply: true, tenantMap: { "grp-m": "009" } });
    expect(report.groups[0]).toMatchObject({
      status: "quarantined",
      tenant: { reason: "tenant-changed-since-last-migration", candidates: ["001", "009"] },
    });
    await expect(fs.stat(path.join(tenantsRoot, "009"))).rejects.toThrow();
  });

  test("personal_local: rounds stay in place, ledger moves under runtime/", async () => {
    await seedGroup("grp-p", {
      rounds: { r1: "ROUND_COMPLETE" },
      ledger: `${rec("governance", 1)}\n`,
    });
    const report = await run({
      apply: true,
      target: { profile: "personal_local", groupsRoot: legacyRoot },
    });
    const files = report.groups[0].files;
    expect(
      files.filter((f) => f.fact.startsWith("rounds/")).every((f) => f.action === "same_path"),
    ).toBe(true);
    expect(files.find((f) => f.fact.startsWith("ledger"))).toMatchObject({
      action: "copy",
      to: path.join(legacyDir("grp-p"), "runtime", "ledger", "collaboration.jsonl"),
      verified: true,
    });
    expect(report.groups[0].audit).toMatchObject({ tenantKey: "_local", reason: "personal-local" });
  });
});

describe("runRuntimeNamespaceMigration (reverse)", () => {
  test("syncs post-cutover namespace writes back, idempotent, no data loss on re-enable", async () => {
    const l1 = rec("governance", 1);
    const flat = rec("execution", 2);
    await seedGroup("grp-r", {
      rounds: { r1: "ROUND_COMPLETE" },
      ledger: `${l1}\n`,
      flatLedger: `${flat}\n`,
    });
    await run({ apply: true });
    const ns = nsDir("001", "grp-r");
    // Post-cutover writes (flag on) land only in the namespace.
    await write(path.join(ns, "rounds", "r9.json"), '{"roundId":"r9","state":"PRIMARY_QUEUE"}');
    const l9 = rec("dispatch", 9);
    await fs.appendFile(path.join(ns, "ledger", "collaboration.jsonl"), `${l9}\n`);
    await write(
      path.join(nsDir("001", "grp-new"), "rounds", "n1.json"),
      '{"roundId":"n1","state":"ROUND_COMPLETE"}',
    );

    const preview = await run({ direction: "reverse" });
    expect(preview.mode).toBe("dry-run");
    await expect(
      fs.stat(path.join(legacyDir("grp-r"), "runtime", "rounds", "r9.json")),
    ).rejects.toThrow();

    const report = await run({ apply: true, direction: "reverse" });
    const byId = Object.fromEntries(report.groups.map((g) => [g.groupId, g]));
    expect(byId["grp-r"].status).toBe("migrated");
    expect(byId["grp-new"].status).toBe("migrated");
    expect(byId["grp-r"].nonTerminalRounds).toEqual([
      { roundId: "r9", state: "PRIMARY_QUEUE", file: "r9.json" },
    ]);
    const legacyLedger = await fs.readFile(
      path.join(legacyDir("grp-r"), "ledger", "collaboration.jsonl"),
      "utf8",
    );
    // Only the missing record is appended; the flat file's record is not duplicated.
    expect(legacyLedger).toBe(`${l1}\n${l9}\n`);
    expect(
      await fs.readFile(path.join(legacyDir("grp-r"), "collaboration-ledger.jsonl"), "utf8"),
    ).toBe(`${flat}\n`);
    expect(
      sha(await fs.readFile(path.join(legacyDir("grp-r"), "runtime", "rounds", "r9.json"))),
    ).toBe(sha(await fs.readFile(path.join(ns, "rounds", "r9.json"))));
    expect(
      await fs.readFile(path.join(legacyDir("grp-new"), "runtime", "rounds", "n1.json"), "utf8"),
    ).toContain("n1");

    const again = await run({ apply: true, direction: "reverse" });
    expect(again.groups.every((g) => g.status === "unchanged")).toBe(true);
    // Re-enabling (forward again) finds nothing to change: nothing lost either way.
    const forward = await run({ apply: true, groupIds: ["grp-r"] });
    expect(forward.groups[0].status).toBe("unchanged");
  });

  test("same groupId under two tenants is quarantined on reverse", async () => {
    await write(path.join(nsDir("001", "grp-x"), "rounds", "a.json"), "{}");
    await write(path.join(nsDir("002", "grp-x"), "rounds", "b.json"), "{}");
    const report = await run({ apply: true, direction: "reverse" });
    expect(report.groups[0]).toMatchObject({ groupId: "grp-x", status: "quarantined" });
    await expect(fs.stat(legacyRoot)).rejects.toThrow();
  });
});
