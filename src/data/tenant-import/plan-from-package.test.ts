import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildTenantImportPackage } from "./package.js";
import { buildRemapPlanFromPackage } from "./plan-from-package.js";

const fixedNow = () => new Date("2026-07-11T06:10:35.756Z");

describe("buildRemapPlanFromPackage", () => {
  let scratch = "";
  let controlPlane = "";
  let userDir = "";

  beforeEach(async () => {
    scratch = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-planpkg-"));
    controlPlane = path.join(scratch, "control-plane");
    userDir = path.join(scratch, "u-src-OpenBot");
    await fs.mkdir(controlPlane, { recursive: true });
    await fs.writeFile(
      path.join(controlPlane, "platform-auth-slice.json"),
      JSON.stringify({ users: [{ id: "u-src", email: "Alice@Acme.com" }] }),
    );
    await fs.writeFile(
      path.join(controlPlane, "seat-assets.json"),
      JSON.stringify({ seats: [{ seatId: "s1", agentId: "main" }] }),
    );
    for (const agent of ["main", "bot-2"]) {
      await fs.mkdir(path.join(userDir, "agents", agent, "workspace"), { recursive: true });
      await fs.writeFile(path.join(userDir, "agents", agent, "workspace", "n.md"), "x");
    }
    await fs.mkdir(path.join(userDir, ".meta"), { recursive: true });
    await fs.writeFile(path.join(userDir, ".meta", "manifest.json"), "{}");
  });

  afterEach(async () => {
    await fs.rm(scratch, { recursive: true, force: true });
  });

  it("derives users (with email merge), agents (with collision), and seats from the package", async () => {
    const { buffer } = await buildTenantImportPackage(
      {
        environment: "local-dev",
        sourceTenantId: "src",
        targetTenantId: "acme",
        userDataSpaces: { "u-src": userDir },
        controlPlaneDir: controlPlane,
      },
      { now: fixedNow },
    );

    let n = 0;
    const plan = await buildRemapPlanFromPackage({
      buffer,
      targetTenantId: "acme",
      existingUsersByEmail: { "alice@acme.com": "u-existing" },
      existingAgentIds: ["main"],
      newId: () => `id-${++n}`,
    });

    expect(plan.tenantId).toBe("acme");
    // OQ-3 merge by email (case-insensitive).
    expect(plan.users["u-src"]).toEqual({ targetUserId: "u-existing", merged: true });
    // Agent collision → -imported; free agent kept.
    expect(plan.agents.main).toBe("main-imported");
    expect(plan.agents["bot-2"]).toBe("bot-2");
    // Seat id extracted from the seat-assets slice and remapped.
    expect(plan.seats.s1).toBe("id-1");
  });

  it("tolerates a package without control-plane slices (users from manifest only)", async () => {
    const onlyUser = path.join(scratch, "u2-OpenBot");
    await fs.mkdir(path.join(onlyUser, "agents", "main"), { recursive: true });
    await fs.writeFile(path.join(onlyUser, "agents", "main", "note.md"), "y");
    const { buffer } = await buildTenantImportPackage(
      {
        environment: "local-dev",
        sourceTenantId: "src",
        targetTenantId: "acme",
        userDataSpaces: { u2: onlyUser },
      },
      { now: fixedNow },
    );

    let n = 0;
    const plan = await buildRemapPlanFromPackage({
      buffer,
      targetTenantId: "acme",
      newId: () => `new-${++n}`,
    });
    // No email slice → new uuid; no seats.
    expect(plan.users.u2.merged).toBe(false);
    expect(plan.users.u2.targetUserId).toBe("new-1");
    expect(Object.keys(plan.seats)).toEqual([]);
  });
});
