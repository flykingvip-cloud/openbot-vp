/**
 * Stage 3 six-column **Plugin/SDK backward** slice (narrow E1/E2).
 *
 * Proposition (§5.2 Plugin/SDK backward compat): extension `package.json`
 * runtime dependencies live under `dependencies` (not only peer/dev).
 *
 * Evidence:
 * - Every `extensions/<id>/package.json`: third-party packages that appear in
 *   peerDependencies or devDependencies also appear under `dependencies`
 *   when they are not host packages (`openclaw` / `@upbeyond/openbot` /
 *   `openbot`). Host packages may stay in peer/dev only.
 * - Plugin install (`src/plugins/install.ts`) sets `hasDeps` from
 *   `manifest.dependencies` only — peer/dev alone do not trigger npm install.
 * - Release-check `collectBundledExtensionRootDependencyGapErrors` mirrors
 *   extension `dependencies` into the root package (peer/dev ignored).
 * - Feishu bundled runtime dep `@larksuiteoapi/node-sdk` is under extension
 *   `dependencies` and mirrored in root `dependencies` (product wire also
 *   covered by `src/plugins/bundled-runtime-deps.test.ts`).
 *
 * Not Stage 3 overall PASS. stage8_eligible stays false.
 * Not Plugin schema / authz / idempotency / errors; not live plugin install
 * fleet; not full npm pack / release-check pack dry-run; not Stage 6 audit.
 *
 * Anchors: `extensions/<id>/package.json`, `src/plugins/install.ts`,
 * `scripts/release-check.ts` (`collectBundledExtensionRootDependencyGapErrors`),
 * `src/plugins/bundled-runtime-deps.test.ts`.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { collectBundledExtensionRootDependencyGapErrors } from "../../scripts/release-check.ts";

const HOST_PACKAGES = new Set(["openclaw", "@upbeyond/openbot", "openbot"]);

type ExtensionManifest = {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

function listExtensionManifests(): Array<{ id: string; manifest: ExtensionManifest }> {
  const extensionsDir = path.resolve("extensions");
  return readdirSync(extensionsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      try {
        const raw = readFileSync(path.join(extensionsDir, entry.name, "package.json"), "utf8");
        return [{ id: entry.name, manifest: JSON.parse(raw) as ExtensionManifest }];
      } catch {
        return [];
      }
    });
}

describe("Stage 3 Plugin/SDK backward — runtime deps in dependencies (E1/E2 narrow)", () => {
  it("extensions keep third-party runtime packages under dependencies (not peer/dev alone)", () => {
    const manifests = listExtensionManifests();
    expect(manifests.length).toBeGreaterThan(10);

    const misplaced: string[] = [];
    for (const { id, manifest } of manifests) {
      const deps = new Set(Object.keys(manifest.dependencies ?? {}));
      for (const field of ["peerDependencies", "devDependencies"] as const) {
        for (const name of Object.keys(manifest[field] ?? {})) {
          if (HOST_PACKAGES.has(name)) {
            continue;
          }
          if (!deps.has(name)) {
            misplaced.push(`${id}: ${name} only in ${field}`);
          }
        }
      }
    }
    expect(misplaced).toEqual([]);
  });

  it("plugin install hasDeps reads manifest.dependencies only (not peer/dev)", () => {
    const source = readFileSync("src/plugins/install.ts", "utf8");
    expect(source).toMatch(/const\s+deps\s*=\s*manifest\.dependencies\s*\?\?\s*\{\s*\}/);
    expect(source).toMatch(/hasDeps/);
    // peer/dev must not drive the install-deps gate on this path.
    const depsBlock = source.slice(
      source.indexOf("const deps = manifest.dependencies"),
      source.indexOf("depsLogMessage"),
    );
    expect(depsBlock).toMatch(/hasDeps/);
    expect(depsBlock).not.toMatch(/peerDependencies/);
    expect(depsBlock).not.toMatch(/devDependencies/);
  });

  it("release-check gap collector keys off extension dependencies (ignores peer-only)", () => {
    const rootPackage = {
      dependencies: { zod: "^4.0.0" },
    };
    // Peer-only third-party must not create a root mirror gap.
    const peerOnly = collectBundledExtensionRootDependencyGapErrors({
      rootPackage,
      extensions: [
        {
          id: "peer-only-demo",
          packageJson: {
            peerDependencies: { "left-pad": "^1.0.0" },
            openclaw: { install: { npmSpec: "@demo/peer-only" } },
          } as never,
        },
      ],
    });
    expect(peerOnly).toEqual([]);

    // Runtime dep missing from root (and not allowlisted) is a gap.
    const missing = collectBundledExtensionRootDependencyGapErrors({
      rootPackage,
      extensions: [
        {
          id: "missing-runtime",
          packageJson: {
            dependencies: { "left-pad": "^1.0.0" },
            openclaw: { install: { npmSpec: "@demo/missing-runtime" } },
          },
        },
      ],
    });
    expect(missing.length).toBe(1);
    expect(missing[0]).toMatch(/missing-runtime/);
    expect(missing[0]).toMatch(/left-pad/);

    // Host package names are excluded from the gap set.
    const hostOk = collectBundledExtensionRootDependencyGapErrors({
      rootPackage,
      extensions: [
        {
          id: "host-dep",
          packageJson: {
            dependencies: { openclaw: "workspace:*", zod: "^4.0.0" },
            openclaw: { install: { npmSpec: "@demo/host-dep" } },
          },
        },
      ],
    });
    expect(hostOk).toEqual([]);
  });

  it("Feishu runtime SDK is under extension dependencies and mirrored in root", () => {
    const root = JSON.parse(readFileSync("package.json", "utf8")) as ExtensionManifest;
    const feishu = JSON.parse(
      readFileSync("extensions/feishu/package.json", "utf8"),
    ) as ExtensionManifest;
    const feishuSpec = feishu.dependencies?.["@larksuiteoapi/node-sdk"];
    const rootSpec = root.dependencies?.["@larksuiteoapi/node-sdk"];
    expect(feishuSpec).toBeTruthy();
    expect(rootSpec).toBe(feishuSpec);
    // Must not be peer/dev-only on the extension.
    expect(feishu.peerDependencies?.["@larksuiteoapi/node-sdk"]).toBeUndefined();
    expect(feishu.devDependencies?.["@larksuiteoapi/node-sdk"]).toBeUndefined();
  });
});
