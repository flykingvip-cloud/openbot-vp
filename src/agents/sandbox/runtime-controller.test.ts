/**
 * Account Computer v4.1 §9 gate 4: Gateway requests carry a lease, not a container spec.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveAccountExecutionPaths } from "../../gateway/account-execution-paths.js";
import { buildAccountSandboxMountPlan } from "./account-mounts.js";
import { resolveSharedAccountMountDirs } from "./account-shared-mounts.js";
import {
  RuntimeController,
  RuntimeControllerRejectedError,
  type RuntimeControllerRequest,
  type RuntimeLeaseRegistration,
} from "./runtime-controller.js";

const ENV_KEYS = [
  "OPENBOT_DATA_MODE",
  "OPENBOT_MULTITENANT",
  "OPENBOT_TENANTS_ROOT",
  "OPENBOT_STATE_DIR",
] as const;
const managedCfg = { data: { mode: "managed" as const } };
const ctx = { tenantId: "tenant-a", userId: "user-a", domain: "employee" as const };

function saveEnv(): Record<string, string | undefined> {
  const prev: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) {
    prev[key] = process.env[key];
  }
  return prev;
}

function restoreEnv(prev: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(prev)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function lease(): RuntimeLeaseRegistration {
  return {
    runtimeLeaseId: "lease-1",
    tenantId: "tenant-a",
    userId: "user-a",
    agentId: "bot",
    executionId: "exec-1",
    snapshotVersion: 2,
    expiresAt: "2026-10-06T00:30:00.000Z",
    revoked: false,
    decisionId: "gd-lease",
  };
}

function request(overrides: Partial<RuntimeControllerRequest> = {}): RuntimeControllerRequest {
  return {
    action: "start",
    runtimeLeaseId: "lease-1",
    tenantId: "tenant-a",
    userId: "user-a",
    agentId: "bot",
    snapshotVersion: 2,
    ...overrides,
  };
}

describe("runtime controller", () => {
  let prev: Record<string, string | undefined> = {};
  let root = "";

  afterEach(() => {
    restoreEnv(prev);
    if (root) {
      fs.rmSync(root, { recursive: true, force: true });
      root = "";
    }
  });

  function controller(onSpec?: (image: string) => void): RuntimeController {
    prev = saveEnv();
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ob-account-rt-"));
    process.env.OPENBOT_DATA_MODE = "managed";
    process.env.OPENBOT_MULTITENANT = "1";
    process.env.OPENBOT_TENANTS_ROOT = root;
    process.env.OPENBOT_STATE_DIR = path.join(root, "operator-state");
    const created = new RuntimeController({
      image: "openbot-account-sandbox:p2",
      browserImage: "openclaw-sandbox-browser:bookworm-slim",
      cfg: managedCfg,
      now: () => Date.parse("2026-10-06T00:05:00.000Z"),
      onSpec: (spec) => onSpec?.(spec.image),
    });
    created.registerLease(lease());
    return created;
  }

  it("rejects image, mounts, env, volumes, hostPath, and docker on start", () => {
    const seen: string[] = [];
    const runtime = controller((image) => seen.push(image));
    const extras = [
      { image: "evil:latest" },
      { mounts: ["/tmp:/tmp"] },
      { env: { PATH: "/tmp" } },
      { volumes: ["/var"] },
      { hostPath: "/var/host" },
      { docker: { privileged: true } },
    ];
    for (const extra of extras) {
      expect(() => runtime.handle({ ...request(), ...extra })).toThrow(
        RuntimeControllerRejectedError,
      );
    }
    expect(seen).toEqual([]);
    expect(() =>
      runtime.registerLease({ ...lease(), hostPath: "/tmp/sock" } as RuntimeLeaseRegistration),
    ).toThrow(/hostPath/);
    expect(() => runtime.handle({ ...request(), action: "register" })).toThrow(/action/);
  });

  it("builds the container spec from the lease", () => {
    const seen: string[] = [];
    const runtime = controller((image) => seen.push(image));
    const started = runtime.handle(request());
    const again = runtime.handle(request());
    expect(started.state).toBe("running");
    expect(again.spec).toBe(started.spec);
    expect(seen).toEqual(["openbot-account-sandbox:p2"]);
    expect(started.spec?.image).toBe("openbot-account-sandbox:p2");
    expect(started.spec?.browserImage).toBe("openclaw-sandbox-browser:bookworm-slim");
    expect(started.spec?.snapshotVersion).toBe(2);

    const paths = resolveAccountExecutionPaths({ ctx, cfg: managedCfg, agentId: "bot" });
    const shared = resolveSharedAccountMountDirs(managedCfg);
    const plan = buildAccountSandboxMountPlan({
      workspaceDir: paths.workspaceDir,
      artifactsDir: paths.artifactsDir,
      browserArtifactsDir: paths.sharedArtifactsDir,
      browserProfileDir: paths.browserProfileDir,
      sharedSkillsDir: shared.sharedSkillsDir,
      sharedCanvasDir: shared.sharedCanvasDir,
    });
    expect(started.spec?.execMounts).toEqual(plan.exec);
    expect(started.spec?.browserMounts).toEqual(plan.browser);
    expect(
      started.spec?.execMounts.some((mount) => mount.containerPath === "/account/skills"),
    ).toBe(Boolean(shared.sharedSkillsDir));
    expect(
      started.spec?.execMounts.some(
        (mount) => mount.containerPath === "/account/canvas" && mount.access === "ro",
      ),
    ).toBe(true);
    expect(JSON.stringify(started.spec)).not.toContain("docker.sock");

    expect(runtime.handle(request({ action: "attach" })).spec).toEqual(started.spec);
    expect(runtime.handle(request({ action: "inspect" })).state).toBe("running");
    expect(runtime.handle(request({ action: "stop" })).state).toBe("stopped");
    expect(() => runtime.handle(request({ action: "attach" }))).toThrow(/not running/);
    expect(runtime.handle(request({ action: "reclaim" })).state).toBe("reclaimed");
    expect(() => runtime.handle(request({ action: "attach" }))).toThrow(/not running/);

    const restarted = runtime.handle(request({ action: "start" }));
    expect(restarted.state).toBe("running");
    expect(restarted.spec?.execMounts).toEqual(plan.exec);
    expect(seen).toEqual(["openbot-account-sandbox:p2", "openbot-account-sandbox:p2"]);
  });

  it("refuses a mismatched, revoked, stale, or unknown lease", () => {
    const seen: string[] = [];
    const runtime = controller((image) => seen.push(image));
    expect(() => runtime.handle(request({ userId: "user-b" }))).toThrow(/scope/);
    runtime.revokeLease("lease-1");
    expect(() => runtime.handle(request())).toThrow(/revoked/);
    expect(seen).toEqual([]);

    expect(() =>
      runtime.registerLease({ ...lease(), runtimeLeaseId: "lease-1", snapshotVersion: 1 }),
    ).toThrow(/stale/);
    runtime.registerLease({ ...lease(), snapshotVersion: 3, revoked: false });
    expect(() => runtime.handle(request())).toThrow(/scope/);
    const started = runtime.handle(request({ snapshotVersion: 3 }));
    expect(started.spec?.snapshotVersion).toBe(3);
    expect(() =>
      runtime.handle(request({ runtimeLeaseId: "lease-missing", snapshotVersion: 3 })),
    ).toThrow(/unknown/);
  });

  it("soft-renew refreshes expiresAt without bumping snapshotVersion", () => {
    prev = saveEnv();
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ob-account-rt-"));
    process.env.OPENBOT_DATA_MODE = "managed";
    process.env.OPENBOT_MULTITENANT = "1";
    process.env.OPENBOT_TENANTS_ROOT = root;
    process.env.OPENBOT_STATE_DIR = path.join(root, "operator-state");
    let nowMs = Date.parse("2026-10-06T00:05:00.000Z");
    const runtime = new RuntimeController({
      image: "openbot-account-sandbox:p2",
      browserImage: "openclaw-sandbox-browser:bookworm-slim",
      cfg: managedCfg,
      now: () => nowMs,
    });
    runtime.registerLease(lease());
    // Soft-renew keeps snapshotVersion, only extends expiresAt (and clock past old expiry).
    nowMs = Date.parse("2026-10-06T00:35:00.000Z");
    runtime.registerLease({
      ...lease(),
      expiresAt: "2026-10-06T12:30:00.000Z",
    });
    const started = runtime.handle(request());
    expect(started.state).toBe("running");
  });
});
