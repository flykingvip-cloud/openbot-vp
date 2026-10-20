import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DATA_SCHEMA_VERSION,
  ensureDataSpace,
  initDataSpaceForConfig,
  isManagedDataMode,
  resolveDataCacheDir,
  resolveDataMode,
  resolveDataRoot,
  resolveDataSpaceManifestPath,
  resolveDataSpaceSubdirs,
  resolveDefaultDataRoot,
} from "./data-space.js";

describe("data-space resolvers", () => {
  it("defaults the data root to ~/OpenBot using the resolved home", () => {
    const env = { HOME: "/home/tester" } as NodeJS.ProcessEnv;
    expect(resolveDefaultDataRoot(env)).toBe(path.resolve("/home/tester/OpenBot"));
  });

  it("honors the OPENBOT_DATA_ROOT override (absolute and ~-expanded)", () => {
    const absolute = {
      HOME: "/home/tester",
      OPENBOT_DATA_ROOT: "/data/custom",
    } as NodeJS.ProcessEnv;
    expect(resolveDefaultDataRoot(absolute)).toBe(path.resolve("/data/custom"));
    const tilde = { HOME: "/home/tester", OPENBOT_DATA_ROOT: "~/space" } as NodeJS.ProcessEnv;
    expect(resolveDefaultDataRoot(tilde)).toBe(path.resolve("/home/tester/space"));
  });

  it("prefers a configured data.root over the default", () => {
    const env = { HOME: "/home/tester" } as NodeJS.ProcessEnv;
    expect(resolveDataRoot({ data: { root: "/srv/OpenBot" } }, env)).toBe(
      path.resolve("/srv/OpenBot"),
    );
    expect(resolveDataRoot({}, env)).toBe(path.resolve("/home/tester/OpenBot"));
  });

  it("resolves the storage mode and managed flag", () => {
    expect(resolveDataMode(undefined)).toBe("local");
    expect(resolveDataMode({})).toBe("local");
    expect(resolveDataMode({ data: { mode: "managed" } })).toBe("managed");
    expect(isManagedDataMode({ data: { mode: "managed" } })).toBe(true);
    expect(isManagedDataMode({ data: { mode: "local" } })).toBe(false);
    expect(isManagedDataMode({})).toBe(false);
  });

  it("derives cacheDir from the root unless explicitly configured", () => {
    const env = { HOME: "/home/tester" } as NodeJS.ProcessEnv;
    expect(resolveDataCacheDir({ data: { root: "/srv/OB" } }, env)).toBe(
      path.resolve("/srv/OB/cache"),
    );
    expect(resolveDataCacheDir({ data: { root: "/srv/OB", cacheDir: "/mnt/cache" } }, env)).toBe(
      path.resolve("/mnt/cache"),
    );
  });
});

describe("ensureDataSpace", () => {
  let scratch = "";
  let root = "";

  beforeEach(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-ds-"));
    root = path.join(scratch, "OpenBot");
  });

  afterEach(() => {
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  it("creates the minimal tree + manifest and is idempotent", () => {
    const first = ensureDataSpace({ root });
    expect(first.created).toBe(true);
    for (const dir of resolveDataSpaceSubdirs(root)) {
      expect(fs.existsSync(dir)).toBe(true);
    }
    const manifestPath = resolveDataSpaceManifestPath(root);
    expect(fs.existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    expect(manifest.schemaVersion).toBe(DATA_SCHEMA_VERSION);
    expect(manifest.mode).toBe("local");

    const second = ensureDataSpace({ root });
    expect(second.created).toBe(false);
    expect(second.manifest.createdAt).toBe(manifest.createdAt);
  });

  it("applies chmod 700 semantics to the root on POSIX", () => {
    if (process.platform === "win32") {
      return;
    }
    ensureDataSpace({ root });
    expect(fs.statSync(root).mode & 0o777).toBe(0o700);
  });

  it("never creates a credentials directory (P1-NO-02)", () => {
    ensureDataSpace({ root });
    expect(fs.existsSync(path.join(root, "credentials"))).toBe(false);
    expect(fs.existsSync(path.join(root, "identity"))).toBe(false);
  });
});

describe("initDataSpaceForConfig", () => {
  let home = "";
  let env: NodeJS.ProcessEnv;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-home-"));
    env = { HOME: home } as NodeJS.ProcessEnv;
  });

  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("fills defaults, marks changed, and creates the tree in local mode", () => {
    const result = initDataSpaceForConfig({}, { env });
    expect(result.changed).toBe(true);
    expect(result.cfg.data?.root).toBe(resolveDefaultDataRoot(env));
    expect(result.cfg.data?.mode).toBe("local");
    expect(result.cfg.data?.schemaVersion).toBe(DATA_SCHEMA_VERSION);
    const expectedRoot = path.join(home, "OpenBot");
    expect(result.ensured?.root).toBe(path.resolve(expectedRoot));
    expect(fs.existsSync(resolveDataSpaceManifestPath(path.resolve(expectedRoot)))).toBe(true);
  });

  it("is a no-op in managed mode (no disk tree, no config change)", () => {
    const result = initDataSpaceForConfig(
      { data: { mode: "managed", root: "/data/tenants/acme/users/u1/OpenBot" } },
      { env },
    );
    expect(result.changed).toBe(false);
    expect(result.ensured).toBeUndefined();
    expect(fs.existsSync(path.join(home, "OpenBot"))).toBe(false);
  });

  it("does not report changed when already initialized", () => {
    const first = initDataSpaceForConfig({}, { env });
    const second = initDataSpaceForConfig(first.cfg, { env });
    expect(second.changed).toBe(false);
  });
});
