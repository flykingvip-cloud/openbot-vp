import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildIdRemapPlan } from "./id-remap.js";
import { runLocalTenantImport } from "./import-job.js";
import { buildTenantImportPackage } from "./package.js";

const fixedNow = () => new Date("2026-07-11T06:10:35.756Z");

describe("runLocalTenantImport", () => {
  let scratch = "";
  let controlPlane = "";
  let userDir = "";
  let staging = "";
  let liveRoot = "";

  beforeEach(async () => {
    scratch = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-job-"));
    controlPlane = path.join(scratch, "control-plane");
    userDir = path.join(scratch, "u-src-OpenBot");
    staging = path.join(scratch, "staging");
    liveRoot = path.join(scratch, "tenants", "acme");
    await fs.mkdir(controlPlane, { recursive: true });
    await fs.writeFile(
      path.join(controlPlane, "seat-assets.json"),
      JSON.stringify({ seats: [{ seatId: "s1", agentId: "main" }] }),
    );
    await fs.mkdir(path.join(userDir, "agents", "main", "workspace"), { recursive: true });
    await fs.writeFile(path.join(userDir, "agents", "main", "workspace", "note.md"), "hello");
    await fs.mkdir(path.join(userDir, ".meta"), { recursive: true });
    await fs.writeFile(path.join(userDir, ".meta", "manifest.json"), "{}");
  });

  afterEach(async () => {
    await fs.rm(scratch, { recursive: true, force: true });
  });

  function baseSource(extra?: Record<string, string>) {
    return {
      environment: "local-dev",
      sourceTenantId: "src",
      targetTenantId: "acme",
      userDataSpaces: { "u-src": userDir },
      controlPlaneDir: controlPlane,
      ...extra,
    };
  }

  function planForImport() {
    return buildIdRemapPlan({
      targetTenantId: "acme",
      users: [{ sourceUserId: "u-src" }],
      seatIds: ["s1"],
      agentIds: ["main"],
      newId: (() => {
        let n = 0;
        return () => `id-${++n}`;
      })(),
    });
  }

  it("runs preflight → stage → rewrite → verify → commit and rewrites ids into the live tree", async () => {
    const { buffer } = await buildTenantImportPackage(baseSource(), { now: fixedNow });
    const plan = planForImport(); // u-src -> id-1, s1 -> id-2, main stays main

    const result = await runLocalTenantImport({
      buffer,
      jobTargetTenantId: "acme",
      plan,
      stagingRoot: staging,
      tenantLiveRoot: liveRoot,
    });

    expect(result.ok).toBe(true);
    expect(result.phase).toBe("done");
    expect(result.committedFiles).toBe(3);
    expect(result.stats.rewrittenFiles).toBeGreaterThanOrEqual(1);

    // User dir renamed; note landed under the target user id.
    await expect(
      fs.readFile(path.join(liveRoot, "users/id-1/OpenBot/agents/main/workspace/note.md"), "utf-8"),
    ).resolves.toBe("hello");
    // Seat id reference rewritten in the committed control-plane slice.
    const seat = JSON.parse(
      await fs.readFile(path.join(liveRoot, "control-plane/seat-assets.json"), "utf-8"),
    );
    expect(seat.seats[0].seatId).toBe("id-2");
    expect(seat.seats[0].agentId).toBe("main"); // no collision, semantic id kept
  });

  it("fails at preflight and never stages when a config retains a source absolute path (§10.3)", async () => {
    await fs.writeFile(
      path.join(userDir, "agents", "main", "workspace", "cfg.json"),
      JSON.stringify({ workspace: "/Users/daniel/ws-bot-2" }),
    );
    const { buffer } = await buildTenantImportPackage(baseSource(), { now: fixedNow });

    const result = await runLocalTenantImport({
      buffer,
      jobTargetTenantId: "acme",
      plan: planForImport(),
      stagingRoot: staging,
      tenantLiveRoot: liveRoot,
    });

    expect(result.ok).toBe(false);
    // Caught read-only at preflight, before any staging I/O (was previously caught late at verify).
    expect(result.phase).toBe("preflight");
    expect(result.errors.some((e) => e.includes("绝对路径"))).toBe(true);
    await expect(fs.access(staging)).rejects.toThrow(); // never staged
    // Nothing committed: the live tenant tree was never written.
    await expect(
      fs.access(path.join(liveRoot, "control-plane/seat-assets.json")),
    ).rejects.toThrow();
  });

  it("fails at preflight on a cross-tenant package and commits nothing (§4.1)", async () => {
    const { buffer } = await buildTenantImportPackage(baseSource(), { now: fixedNow });

    const result = await runLocalTenantImport({
      buffer,
      jobTargetTenantId: "globex", // != manifest target "acme"
      plan: planForImport(),
      stagingRoot: staging,
      tenantLiveRoot: liveRoot,
    });

    expect(result.ok).toBe(false);
    expect(result.phase).toBe("preflight");
    await expect(fs.access(staging)).rejects.toThrow(); // never staged
  });
});
