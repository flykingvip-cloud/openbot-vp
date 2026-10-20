#!/usr/bin/env node
/**
 * Generate a CycloneDX 1.6 SBOM JSON from pnpm-lock.yaml (lockfile-complete graph).
 *
 * Usage:
 *   pnpm sbom:cyclonedx
 *   node --import tsx scripts/generate-cyclonedx-sbom.ts [--out path] [--stdout]
 *
 * This is the formal Stage 6 SBOM generator. It does not claim Stage 6 product PASS.
 * Audit / advisory status remains a separate Stage 6 axis.
 */
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";

type LockPkg = {
  resolution?: { integrity?: string; tarball?: string };
};

type CycloneComponent = {
  type: "library";
  "bom-ref": string;
  name: string;
  version: string;
  purl: string;
  hashes?: Array<{ alg: "SHA-512"; content: string }>;
  properties?: Array<{ name: string; value: string }>;
};

const ROOT = process.cwd();
const DEFAULT_OUT = path.join(ROOT, "sbom", "openbot.cdx.json");

function parseArgs(argv: string[]) {
  let out = DEFAULT_OUT;
  let stdout = false;
  let deterministic = true;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out") {
      out = path.resolve(argv[++i] ?? DEFAULT_OUT);
    } else if (a === "--stdout") {
      stdout = true;
    } else if (a === "--non-deterministic") {
      deterministic = false;
    } else if (a === "--help" || a === "-h") {
      process.stdout.write(
        "Usage: generate-cyclonedx-sbom.ts [--out path] [--stdout] [--non-deterministic]\n",
      );
      process.exit(0);
    }
  }
  return { out, stdout, deterministic };
}

function parsePackageKey(key: string): { name: string; version: string } | null {
  // pnpm v9 keys: "name@version" or "@scope/name@version" (version may contain @ for non-registry rarely)
  const at = key.lastIndexOf("@");
  if (at <= 0) {
    return null;
  }
  // scoped: first char @, version @ after scope/
  if (key.startsWith("@")) {
    const slash = key.indexOf("/");
    if (slash < 0) {
      return null;
    }
    const versionAt = key.indexOf("@", slash);
    if (versionAt < 0) {
      return null;
    }
    return { name: key.slice(0, versionAt), version: key.slice(versionAt + 1) };
  }
  return { name: key.slice(0, at), version: key.slice(at + 1) };
}

function toPurl(name: string, version: string): string {
  if (name.startsWith("@")) {
    const [scope, pkg] = name.split("/", 2);
    return `pkg:npm/${encodeURIComponent(scope)}/${pkg}@${encodeURIComponent(version)}`;
  }
  return `pkg:npm/${name}@${encodeURIComponent(version)}`;
}

function integrityToSha512Hex(integrity: string | undefined): string | undefined {
  if (!integrity?.startsWith("sha512-")) {
    return undefined;
  }
  const b64 = integrity.slice("sha512-".length);
  try {
    return Buffer.from(b64, "base64").toString("hex");
  } catch {
    return undefined;
  }
}

function loadRootPackage(): { name: string; version: string; license?: string } {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
    name?: string;
    version?: string;
    license?: string;
  };
  return {
    name: pkg.name ?? "openbot",
    version: pkg.version ?? "0.0.0",
    license: typeof pkg.license === "string" ? pkg.license : undefined,
  };
}

function buildBom(params: {
  lockfileRaw: string;
  packages: Record<string, LockPkg>;
  root: { name: string; version: string; license?: string };
  deterministic: boolean;
}) {
  const components: CycloneComponent[] = [];
  for (const key of Object.keys(params.packages).toSorted()) {
    const parsed = parsePackageKey(key);
    if (!parsed) {
      continue;
    }
    const integrity = params.packages[key]?.resolution?.integrity;
    const sha512 = integrityToSha512Hex(integrity);
    const purl = toPurl(parsed.name, parsed.version);
    const component: CycloneComponent = {
      type: "library",
      "bom-ref": purl,
      name: parsed.name,
      version: parsed.version,
      purl,
    };
    if (sha512) {
      component.hashes = [{ alg: "SHA-512", content: sha512 }];
    }
    if (integrity) {
      component.properties = [{ name: "pnpm:resolution.integrity", value: integrity }];
    }
    components.push(component);
  }

  const lockHash = createHash("sha256").update(params.lockfileRaw).digest("hex");
  const componentsHash = createHash("sha256")
    .update(components.map((c) => c.purl).join("\n"))
    .digest("hex");
  // RFC-4122 version-5-like layout from lockfile SHA-256 (deterministic regenerate).
  const serialNumber = params.deterministic
    ? `urn:uuid:${lockHash.slice(0, 8)}-${lockHash.slice(8, 12)}-5${lockHash.slice(12, 15)}-8${lockHash.slice(15, 18)}-${lockHash.slice(18, 30)}`
    : `urn:uuid:${randomUUID()}`;

  const timestamp = params.deterministic
    ? // Stable placeholder: document that regenerate compares components, not wall-clock.
      "1970-01-01T00:00:00.000Z"
    : new Date().toISOString();

  return {
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    serialNumber,
    version: 1,
    metadata: {
      timestamp,
      tools: {
        components: [
          {
            type: "application",
            name: "openbot-generate-cyclonedx-sbom",
            version: "1.0.0",
            description:
              "Lockfile-derived CycloneDX generator (scripts/generate-cyclonedx-sbom.ts)",
          },
        ],
      },
      component: {
        type: "application",
        "bom-ref": toPurl(params.root.name, params.root.version),
        name: params.root.name,
        version: params.root.version,
        purl: toPurl(params.root.name, params.root.version),
        ...(params.root.license ? { licenses: [{ license: { id: params.root.license } }] } : {}),
      },
      properties: [
        { name: "openbot:sbom:source", value: "pnpm-lock.yaml" },
        { name: "openbot:sbom:lockfileVersion", value: "9.0" },
        { name: "openbot:sbom:lockfileSha256", value: lockHash },
        { name: "openbot:sbom:componentsSha256", value: componentsHash },
        {
          name: "openbot:sbom:scope",
          value: "lockfile-complete (all packages entries; not npm-ls / not audit)",
        },
      ],
    },
    components,
  };
}

function main() {
  const { out, stdout, deterministic } = parseArgs(process.argv.slice(2));
  const lockPath = path.join(ROOT, "pnpm-lock.yaml");
  if (!fs.existsSync(lockPath)) {
    throw new Error(`missing ${lockPath}`);
  }
  const lockfileRaw = fs.readFileSync(lockPath, "utf8");
  const doc = parseYaml(lockfileRaw) as {
    lockfileVersion?: string | number;
    packages?: Record<string, LockPkg>;
  };
  if (!doc.packages || typeof doc.packages !== "object") {
    throw new Error("pnpm-lock.yaml missing packages map");
  }
  const root = loadRootPackage();
  const bom = buildBom({
    lockfileRaw,
    packages: doc.packages,
    root,
    deterministic,
  });
  const json = `${JSON.stringify(bom, null, 2)}\n`;
  if (stdout) {
    process.stdout.write(json);
  } else {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, json, "utf8");
    process.stdout.write(
      `wrote ${out} (${bom.components.length} components, lockfileSha256=${bom.metadata.properties.find((p) => p.name === "openbot:sbom:lockfileSha256")?.value?.slice(0, 12)}…)\n`,
    );
  }
}

main();
