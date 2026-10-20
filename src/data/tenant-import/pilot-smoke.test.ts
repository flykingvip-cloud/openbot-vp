import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildIdRemapPlan } from "./id-remap.js";
import { runLocalTenantImport } from "./import-job.js";
import { buildTenantImportPackage } from "./package.js";
import { textHasSourceAbsolutePath } from "./path-scan.js";

/**
 * §16 pilot-migration post-import smoke — the DATA-verifiable subset, automated.
 *
 * The full §16 checklist mixes runtime checks that need a live gateway (admin login #1, doctor #7,
 * model call #9) with data-level invariants that can be asserted straight off the committed tenant
 * tree. This test covers the data-level ones end to end (package → import → committed tree):
 *   #2 seat count preserved, #3 per-employee agent spaces present, #6 conversation archives
 *   openable, #8 zero source-machine absolute paths, #9(neg) no credential/secret files.
 * The live-gateway checks remain an ops runbook step; this locks down everything that does not
 * need a running gateway so a pilot regression is caught in CI, not in staging.
 */

const fixedNow = () => new Date("2026-07-11T06:10:35.756Z");

/** Recursively list regular files under `root` (empty when missing). */
async function walkFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const abs = path.join(root, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walkFiles(abs)));
    } else if (entry.isFile()) {
      out.push(abs);
    }
  }
  return out;
}

describe("tenant-import §16 pilot post-import smoke (data-level)", () => {
  let scratch = "";
  let controlPlane = "";
  let aliceDir = "";
  let bobDir = "";
  let staging = "";
  let liveRoot = "";

  beforeEach(async () => {
    scratch = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-pilot-"));
    controlPlane = path.join(scratch, "control-plane");
    aliceDir = path.join(scratch, "alice-OpenBot");
    bobDir = path.join(scratch, "bob-OpenBot");
    staging = path.join(scratch, "staging");
    liveRoot = path.join(scratch, "tenants", "acme");

    await fs.mkdir(controlPlane, { recursive: true });
    await fs.writeFile(
      path.join(controlPlane, "seat-assets.json"),
      JSON.stringify({
        seats: [
          { seatId: "seat-a", userId: "u-alice", agentId: "main" },
          { seatId: "seat-b", userId: "u-bob", agentId: "assistant" },
        ],
      }),
    );

    // alice: one agent with a workspace file and a conversation archive.
    await fs.mkdir(path.join(aliceDir, "agents", "main", "workspace"), { recursive: true });
    await fs.writeFile(path.join(aliceDir, "agents", "main", "workspace", "note.md"), "alice note");
    await fs.mkdir(path.join(aliceDir, "agents", "main", "conversations", "archive"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(aliceDir, "agents", "main", "conversations", "archive", "2026-01.jsonl"),
      '{"role":"user","text":"hi from alice"}\n',
    );
    await fs.mkdir(path.join(aliceDir, ".meta"), { recursive: true });
    await fs.writeFile(path.join(aliceDir, ".meta", "manifest.json"), "{}");

    // bob: one agent with a workspace file and a conversation archive.
    await fs.mkdir(path.join(bobDir, "agents", "assistant", "workspace"), { recursive: true });
    await fs.writeFile(
      path.join(bobDir, "agents", "assistant", "workspace", "todo.md"),
      "bob todo",
    );
    await fs.mkdir(path.join(bobDir, "agents", "assistant", "conversations", "archive"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(bobDir, "agents", "assistant", "conversations", "archive", "2026-02.jsonl"),
      '{"role":"assistant","text":"ok from bob"}\n',
    );
    await fs.mkdir(path.join(bobDir, ".meta"), { recursive: true });
    await fs.writeFile(path.join(bobDir, ".meta", "manifest.json"), "{}");
  });

  afterEach(async () => {
    await fs.rm(scratch, { recursive: true, force: true });
  });

  it("imports a two-user tenant and satisfies the data-verifiable §16 checks", async () => {
    const { buffer, manifest } = await buildTenantImportPackage(
      {
        environment: "local-dev",
        sourceTenantId: "src",
        targetTenantId: "acme",
        userDataSpaces: { "u-alice": aliceDir, "u-bob": bobDir },
        controlPlaneDir: controlPlane,
      },
      { now: fixedNow },
    );

    // Baseline counts the pilot reconciles against (§16 #2).
    expect(manifest.stats.userCount).toBe(2);
    expect(manifest.stats.agentCount).toBe(2);

    const plan = buildIdRemapPlan({
      targetTenantId: "acme",
      users: [{ sourceUserId: "u-alice" }, { sourceUserId: "u-bob" }],
      seatIds: ["seat-a", "seat-b"],
      agentIds: ["main", "assistant"],
      newId: (() => {
        let n = 0;
        return () => `id-${++n}`;
      })(),
    });

    const result = await runLocalTenantImport({
      buffer,
      jobTargetTenantId: "acme",
      plan,
      stagingRoot: staging,
      tenantLiveRoot: liveRoot,
    });
    expect(result.ok).toBe(true);
    expect(result.phase).toBe("done");

    // §16 #2 — seat roster preserved in the committed control-plane slice.
    const seatAssets = JSON.parse(
      await fs.readFile(path.join(liveRoot, "control-plane", "seat-assets.json"), "utf-8"),
    ) as { seats: unknown[] };
    expect(seatAssets.seats).toHaveLength(2);

    // §16 #3 — each employee's agent space landed under the remapped user id.
    const aliceUid = plan.users["u-alice"].targetUserId;
    const bobUid = plan.users["u-bob"].targetUserId;
    await expect(
      fs.access(path.join(liveRoot, "users", aliceUid, "OpenBot/agents/main/workspace/note.md")),
    ).resolves.toBeUndefined();
    await expect(
      fs.access(path.join(liveRoot, "users", bobUid, "OpenBot/agents/assistant/workspace/todo.md")),
    ).resolves.toBeUndefined();

    // §16 #6 — conversation archives present and openable.
    await expect(
      fs.readFile(
        path.join(
          liveRoot,
          "users",
          aliceUid,
          "OpenBot/agents/main/conversations/archive/2026-01.jsonl",
        ),
        "utf-8",
      ),
    ).resolves.toContain("hi from alice");

    // §16 #8 — zero source-machine absolute paths anywhere in the committed tenant volume.
    const committed = await walkFiles(liveRoot);
    for (const file of committed) {
      const text = await fs.readFile(file, "utf-8").catch(() => "");
      expect(textHasSourceAbsolutePath(text)).toBe(false);
    }

    // §16 #9 (negative) — no credential/secret material landed in the tenant tree.
    expect(committed.some((f) => /credentials|secrets|\.pem$|\.key$/.test(f))).toBe(false);
  });
});
