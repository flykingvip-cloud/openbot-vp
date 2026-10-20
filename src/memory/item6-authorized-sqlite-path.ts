import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const ITEM6_AUTHORIZED_SQLITE_ENV = "OPENBOT_AUTHORIZED_SQLITE_PATH";
export const ITEM6_AUTHORIZED_SQLITE_TRUSTED_ROOT_ENV = "OPENBOT_AUTHORIZED_SQLITE_TRUSTED_ROOT";

export type Item6AuthorizedSqlitePathStatus =
  | "unconfigured"
  | "missing-trusted-root"
  | "path-outside-trusted-root"
  | "rejected-evidence-path"
  | "host-not-production-sot"
  | "rejected-fixture-path"
  | "production-candidate";

export type Item6AuthorizedSqlitePathClassification = {
  status: Item6AuthorizedSqlitePathStatus;
  pathToken: string | null;
  resolved: string | null;
  trustedRoot: string | null;
};

function redactToken(value: string): string {
  return `sha256:${crypto.createHash("sha256").update(value, "utf8").digest("hex").slice(0, 16)}`;
}

function isEvidenceOrDocsPath(resolved: string): boolean {
  return resolved.includes(`${path.sep}docs${path.sep}design${path.sep}evidence`);
}

function isHostProductionSotPath(resolved: string): boolean {
  const host = path.resolve(os.homedir(), ".openbot");
  return resolved === host || resolved.startsWith(`${host}${path.sep}`);
}

/** Reject os tmpdir, /tmp, /private/tmp, /var/tmp, /private/var/tmp, and other explicit fixture roots. */
export function isRejectedFixturePath(resolved: string): boolean {
  const normalized = path.resolve(resolved);
  const fixtureRoots = [
    path.resolve(os.tmpdir()),
    path.resolve("/tmp"),
    path.resolve("/private/tmp"),
    path.resolve("/var/tmp"),
    path.resolve("/private/var/tmp"),
  ];
  for (const root of fixtureRoots) {
    const canonicalRoot = fs.existsSync(root) ? fs.realpathSync.native(root) : root;
    if (
      normalized === root ||
      normalized.startsWith(`${root}${path.sep}`) ||
      normalized === canonicalRoot ||
      normalized.startsWith(`${canonicalRoot}${path.sep}`)
    ) {
      return true;
    }
  }
  if (
    normalized.startsWith(`${path.sep}tmp${path.sep}`) ||
    normalized.startsWith(`${path.sep}private${path.sep}tmp${path.sep}`) ||
    normalized.startsWith(`${path.sep}var${path.sep}tmp${path.sep}`) ||
    normalized.startsWith(`${path.sep}private${path.sep}var${path.sep}tmp${path.sep}`)
  ) {
    return true;
  }
  return false;
}

function resolveRealPathIfExists(candidate: string): string {
  if (!fs.existsSync(candidate)) {
    return path.resolve(candidate);
  }
  return fs.realpathSync.native(candidate);
}

function isUnderTrustedRoot(params: { resolved: string; trustedRoot: string }): boolean {
  const realTrusted = resolveRealPathIfExists(params.trustedRoot);
  const realResolved = resolveRealPathIfExists(params.resolved);
  return realResolved === realTrusted || realResolved.startsWith(`${realTrusted}${path.sep}`);
}

/**
 * Item 6 implementation entry gate. Fail-closed unless the operator issues both
 * OPENBOT_AUTHORIZED_SQLITE_TRUSTED_ROOT and a sqlite path bound under that root.
 */
export function classifyAuthorizedSqlitePath(
  env: NodeJS.ProcessEnv = process.env,
): Item6AuthorizedSqlitePathClassification {
  const explicit =
    typeof env[ITEM6_AUTHORIZED_SQLITE_ENV] === "string"
      ? env[ITEM6_AUTHORIZED_SQLITE_ENV].trim()
      : "";
  if (!explicit) {
    return { status: "unconfigured", pathToken: null, resolved: null, trustedRoot: null };
  }

  const trustedRootExplicit =
    typeof env[ITEM6_AUTHORIZED_SQLITE_TRUSTED_ROOT_ENV] === "string"
      ? env[ITEM6_AUTHORIZED_SQLITE_TRUSTED_ROOT_ENV].trim()
      : "";
  if (!trustedRootExplicit) {
    return {
      status: "missing-trusted-root",
      pathToken: redactToken(path.resolve(explicit)),
      resolved: path.resolve(explicit),
      trustedRoot: null,
    };
  }

  const resolved = path.resolve(explicit);
  const trustedRoot = path.resolve(trustedRootExplicit);

  if (isEvidenceOrDocsPath(resolved) || isEvidenceOrDocsPath(trustedRoot)) {
    return {
      status: "rejected-evidence-path",
      pathToken: redactToken(resolved),
      resolved,
      trustedRoot,
    };
  }
  if (isHostProductionSotPath(resolved) || isHostProductionSotPath(trustedRoot)) {
    return {
      status: "host-not-production-sot",
      pathToken: redactToken(resolved),
      resolved,
      trustedRoot,
    };
  }
  if (isRejectedFixturePath(resolved) || isRejectedFixturePath(trustedRoot)) {
    return {
      status: "rejected-fixture-path",
      pathToken: redactToken(resolved),
      resolved,
      trustedRoot,
    };
  }
  if (!isUnderTrustedRoot({ resolved, trustedRoot })) {
    const realResolved = resolveRealPathIfExists(resolved);
    if (isRejectedFixturePath(realResolved)) {
      return {
        status: "rejected-fixture-path",
        pathToken: redactToken(resolved),
        resolved,
        trustedRoot,
      };
    }
    return {
      status: "path-outside-trusted-root",
      pathToken: redactToken(resolved),
      resolved,
      trustedRoot,
    };
  }

  return {
    status: "production-candidate",
    pathToken: redactToken(resolved),
    resolved,
    trustedRoot,
  };
}

export function requireItem6AuthorizedSqlitePath(
  env: NodeJS.ProcessEnv = process.env,
):
  | { ok: true; resolved: string; pathToken: string; trustedRoot: string }
  | { ok: false; status: Item6AuthorizedSqlitePathStatus } {
  const classified = classifyAuthorizedSqlitePath(env);
  if (
    classified.status !== "production-candidate" ||
    !classified.resolved ||
    !classified.pathToken ||
    !classified.trustedRoot
  ) {
    return { ok: false, status: classified.status };
  }
  return {
    ok: true,
    resolved: classified.resolved,
    pathToken: classified.pathToken,
    trustedRoot: classified.trustedRoot,
  };
}
