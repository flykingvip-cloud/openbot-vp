import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildTenantImportPackage } from "../../data/tenant-import/package.js";
import { resolveRequiredOperatorScopeForMethod } from "../method-scopes.js";
import { guardSessionDomain } from "../platform-auth/session-domain.js";
import { readTenantOperationalStatusAudits } from "../tenant-operational-status.js";
import { platformTenantHandlers } from "./platform-tenant.js";

let scratch = "";
let tenantsRoot = "";

beforeEach(async () => {
  scratch = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-ptenant-"));
  tenantsRoot = path.join(scratch, "tenants");
  process.env.OPENBOT_TENANTS_ROOT = tenantsRoot;
});

afterEach(async () => {
  delete process.env.OPENBOT_TENANTS_ROOT;
  await fs.rm(scratch, { recursive: true, force: true });
});

function makeCall(
  method: keyof typeof platformTenantHandlers,
  params: Record<string, unknown> = {},
) {
  const respond = vi.fn();
  const promise = platformTenantHandlers[method]({
    params,
    respond,
    req: { type: "req" as const, id: "1", method },
    client: null,
    isWebchatConnect: () => false,
    context: {} as never,
  });
  return { respond, promise };
}

async function invoke(
  method: keyof typeof platformTenantHandlers,
  params: Record<string, unknown>,
) {
  const { respond, promise } = makeCall(method, params);
  await promise;
  const call = respond.mock.calls[0];
  return {
    ok: call?.[0] as boolean,
    payload: call?.[1] as Record<string, unknown>,
    error: call?.[2],
  };
}

/** Build a valid tenant-import package on disk; returns its archive path. */
async function writePackage(opts: {
  targetTenantId: string;
  withAbsPath?: boolean;
}): Promise<string> {
  const src = await fs.mkdtemp(path.join(scratch, "src-"));
  const controlPlane = path.join(src, "cp");
  const userDir = path.join(src, "u1-OpenBot");
  await fs.mkdir(controlPlane, { recursive: true });
  await fs.writeFile(
    path.join(controlPlane, "seat-assets.json"),
    JSON.stringify({ seats: [{ seatId: "s1", agentId: "main" }] }),
  );
  await fs.mkdir(path.join(userDir, "agents", "main", "workspace"), { recursive: true });
  await fs.writeFile(path.join(userDir, "agents", "main", "workspace", "note.md"), "hello");
  await fs.mkdir(path.join(userDir, ".meta"), { recursive: true });
  await fs.writeFile(path.join(userDir, ".meta", "manifest.json"), "{}");
  if (opts.withAbsPath) {
    await fs.writeFile(
      path.join(userDir, "agents", "main", "workspace", "cfg.json"),
      JSON.stringify({ workspace: "/Users/daniel/ws-bot-2" }),
    );
  }
  const { buffer } = await buildTenantImportPackage({
    environment: "local-dev",
    sourceTenantId: "src",
    targetTenantId: opts.targetTenantId,
    userDataSpaces: { u1: userDir },
    controlPlaneDir: controlPlane,
  });
  const archivePath = path.join(
    scratch,
    `pkg-${opts.targetTenantId}-${opts.withAbsPath ? "abs" : "ok"}.zip`,
  );
  await fs.writeFile(archivePath, buffer);
  return archivePath;
}

describe("platform.tenant.* RPC", () => {
  it("provision creates the tenant tree and rejects an invalid tenantId", async () => {
    const ok = await invoke("platform.tenant.provision", { tenantId: "acme" });
    expect(ok.ok).toBe(true);
    for (const sub of ["control-plane", "shared", "users"]) {
      await expect(fs.access(path.join(tenantsRoot, "acme", sub))).resolves.toBeUndefined();
    }
    const bad = await invoke("platform.tenant.provision", { tenantId: "../evil" });
    expect(bad.ok).toBe(false);
  });

  it("preflight rejects a non-provisioned tenant and a cross-tenant package (SAAS-T-01)", async () => {
    const missing = await invoke("platform.tenant.import.preflight", {
      targetTenantId: "acme",
      archivePath: await writePackage({ targetTenantId: "acme" }),
    });
    expect(missing.ok).toBe(false); // tenant not provisioned

    await invoke("platform.tenant.provision", { tenantId: "globex" });
    const crossTenant = await invoke("platform.tenant.import.preflight", {
      targetTenantId: "globex",
      archivePath: await writePackage({ targetTenantId: "acme" }), // manifest target = acme
    });
    expect(crossTenant.ok).toBe(true); // preflight ran
    expect((crossTenant.payload as { ok?: boolean }).ok).toBe(false); // but report is not ok
  });

  it("import.start commits into the tenant tree end-to-end", async () => {
    await invoke("platform.tenant.provision", { tenantId: "acme" });
    const archivePath = await writePackage({ targetTenantId: "acme" });
    const res = await invoke("platform.tenant.import.start", {
      targetTenantId: "acme",
      archivePath,
      importJobId: "job-1",
    });
    expect(res.ok).toBe(true);
    expect(res.payload.status).toBe("done");
    expect(res.payload.committedFiles).toBe(3);
    await expect(
      fs.access(path.join(tenantsRoot, "acme", "control-plane", "seat-assets.json")),
    ).resolves.toBeUndefined();
  });

  it("import.start is idempotent by importJobId (SAAS-T-02)", async () => {
    await invoke("platform.tenant.provision", { tenantId: "acme" });
    const archivePath = await writePackage({ targetTenantId: "acme" });
    const first = await invoke("platform.tenant.import.start", {
      targetTenantId: "acme",
      archivePath,
      importJobId: "job-idem",
    });
    const second = await invoke("platform.tenant.import.start", {
      targetTenantId: "acme",
      archivePath,
      importJobId: "job-idem",
    });
    expect(second.payload.idempotentReplay).toBe(true);
    expect(second.payload.committedFiles).toBe(first.payload.committedFiles);
  });

  it("import.start fails at preflight and commits nothing on a residual absolute path (SAAS-T-03)", async () => {
    await invoke("platform.tenant.provision", { tenantId: "acme" });
    const archivePath = await writePackage({ targetTenantId: "acme", withAbsPath: true });
    const res = await invoke("platform.tenant.import.start", {
      targetTenantId: "acme",
      archivePath,
      importJobId: "job-fail",
    });
    expect(res.payload.status).toBe("failed");
    expect(res.payload.phase).toBe("preflight");
    // Nothing committed into the live tenant tree.
    await expect(
      fs.access(path.join(tenantsRoot, "acme", "control-plane", "seat-assets.json")),
    ).rejects.toThrow();
  });

  it("import.status returns the recorded job and errors on unknown", async () => {
    await invoke("platform.tenant.provision", { tenantId: "acme" });
    const archivePath = await writePackage({ targetTenantId: "acme" });
    await invoke("platform.tenant.import.start", {
      targetTenantId: "acme",
      archivePath,
      importJobId: "job-status",
    });
    const status = await invoke("platform.tenant.import.status", { importJobId: "job-status" });
    expect(status.ok).toBe(true);
    expect(status.payload.importJobId).toBe("job-status");
    const missing = await invoke("platform.tenant.import.status", { importJobId: "nope" });
    expect(missing.ok).toBe(false);
  });

  it("gates platform.tenant.* to platform sessions (employee token rejected)", () => {
    // Employee-domain sessions cannot invoke platform.tenant.* (session-domain gate = the 403).
    for (const method of [
      "platform.tenant.provision",
      "platform.tenant.import.preflight",
      "platform.tenant.import.start",
      "platform.tenant.import.status",
    ]) {
      expect(guardSessionDomain(method, "employee").allowed).toBe(false);
      expect(guardSessionDomain(method, "platform").allowed).toBe(true);
    }
  });

  it("pauses and resumes tenant operational status without an agent lifecycle field", async () => {
    for (const method of ["platform.tenant.pause", "platform.tenant.resume"]) {
      expect(guardSessionDomain(method, "employee").allowed).toBe(false);
      expect(guardSessionDomain(method, "platform").allowed).toBe(true);
      expect(resolveRequiredOperatorScopeForMethod(method)).toBe("operator.admin");
    }
    const missingReason = await invoke("platform.tenant.pause", { tenantId: "acme" });
    expect(missingReason.ok).toBe(false);
    const paused = await invoke("platform.tenant.pause", {
      tenantId: "acme",
      reason: "billing hold",
    });
    expect(paused.ok).toBe(true);
    expect(paused.payload).toEqual({
      tenantId: "acme",
      status: "suspended",
      previousStatus: "active",
    });
    expect(paused.payload).not.toHaveProperty("lifecycle");
    const again = await invoke("platform.tenant.pause", {
      tenantId: "acme",
      reason: "still holding",
    });
    expect(again.payload).toEqual({
      tenantId: "acme",
      status: "suspended",
      previousStatus: "suspended",
    });
    const resumed = await invoke("platform.tenant.resume", {
      tenantId: "acme",
      reason: "hold lifted",
    });
    expect(resumed.payload).toEqual({
      tenantId: "acme",
      status: "active",
      previousStatus: "suspended",
    });
    const audits = await readTenantOperationalStatusAudits("acme");
    expect(audits.map((entry) => entry.reason)).toEqual([
      "billing hold",
      "still holding",
      "hold lifted",
    ]);
    expect(audits.every((entry) => entry.actor === "operator")).toBe(true);
  });
});
