import fs from "node:fs";
import { formatCliCommand } from "../cli/command-format.js";
import type { OpenBotConfig } from "../config/config.js";
import {
  DATA_SCHEMA_VERSION,
  ensureDataSpace,
  isManagedDataMode,
  resolveDataRoot,
  resolveDataSpaceManifestPath,
} from "../config/data-space.js";
import { note } from "../terminal/note.js";
import { shortenHomePath } from "../utils.js";

type DoctorPrompterLike = {
  confirmSkipInNonInteractive: (params: {
    message: string;
    initialValue?: boolean;
  }) => Promise<boolean>;
};

function existsDir(dir: string): boolean {
  try {
    return fs.existsSync(dir) && fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

function existsFile(filePath: string): boolean {
  try {
    return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function canWriteDir(dir: string): boolean {
  try {
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function readManifestSchemaVersion(manifestPath: string): number | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as {
      schemaVersion?: unknown;
    };
    return typeof parsed.schemaVersion === "number" ? parsed.schemaVersion : null;
  } catch {
    return null;
  }
}

/**
 * Doctor check for the OpenBot Data Space (`data.root`) introduced in Phase 1
 * (docs/design/openbot-data-directory-product-spec-2026-07-10.md §6/§7, acceptance
 * P1-BEH-06). Verifies the user-visible data root exists, is writable, has a manifest,
 * and flags path drift (stale `data.previousRoot`, unreachable external volumes).
 *
 * SaaS/managed mode is skipped: the tenant/user root is provisioned server-side and is
 * never a local disk path.
 */
export async function noteDataSpaceIntegrity(cfg: OpenBotConfig, prompter: DoctorPrompterLike) {
  if (isManagedDataMode(cfg)) {
    return;
  }

  const warnings: string[] = [];
  const changes: string[] = [];
  const root = resolveDataRoot(cfg);
  const display = shortenHomePath(root);
  const configuredRoot = cfg.data?.root?.trim();

  if (!existsDir(root)) {
    if (configuredRoot) {
      // A configured root that is missing usually means an unmounted external/NAS volume
      // (product spec §7.5) or a moved directory — surface it as blocking guidance.
      warnings.push(
        [
          `- Data Space root is configured but missing (${display}).`,
          "- If this is an external/NAS volume, reconnect it; otherwise migrate back to a local disk.",
          `- Repair or recreate: ${formatCliCommand("openbot setup")}`,
        ].join("\n"),
      );
    } else {
      warnings.push(
        `- Data Space root missing (${display}). It holds your migratable OpenBot data.`,
      );
    }
    const create = await prompter.confirmSkipInNonInteractive({
      message: `Create Data Space at ${display}?`,
      initialValue: true,
    });
    if (create) {
      try {
        ensureDataSpace({ root, mode: "local" });
        changes.push(`- Created Data Space: ${display}`);
      } catch (err) {
        warnings.push(`- Failed to create ${display}: ${String(err)}`);
      }
    }
  } else {
    if (!canWriteDir(root)) {
      warnings.push(
        `- Data Space root not writable (${display}). Run: chmod u+rwx "${root}" (or fix ownership).`,
      );
    }
    if (process.platform !== "win32") {
      try {
        const mode = fs.statSync(root).mode;
        if ((mode & 0o077) !== 0) {
          warnings.push(
            `- Data Space root permissions are too open (${display}). Recommend chmod 700.`,
          );
        }
      } catch {
        // best-effort permission read
      }
    }
    const manifestPath = resolveDataSpaceManifestPath(root);
    if (!existsFile(manifestPath)) {
      warnings.push(
        `- Data Space manifest missing (${shortenHomePath(manifestPath)}). Run ${formatCliCommand("openbot setup")} to repair.`,
      );
    } else {
      const schemaVersion = readManifestSchemaVersion(manifestPath);
      if (schemaVersion != null && schemaVersion > DATA_SCHEMA_VERSION) {
        warnings.push(
          `- Data Space schemaVersion ${schemaVersion} is newer than this build supports (${DATA_SCHEMA_VERSION}). Update OpenBot.`,
        );
      }
    }
  }

  const previousRoot = cfg.data?.previousRoot?.trim();
  if (previousRoot && existsDir(previousRoot)) {
    const expiresAt = cfg.data?.previousRootExpiresAt?.trim();
    const expired = expiresAt ? Date.parse(expiresAt) < Date.now() : false;
    warnings.push(
      [
        `- Previous Data Space still on disk (${shortenHomePath(previousRoot)})${expired ? " and past its retention window" : ""}.`,
        "- Once you have verified the migrated data, you can remove the old directory.",
      ].join("\n"),
    );
  }

  if (warnings.length > 0) {
    note(warnings.join("\n"), "Data Space");
  }
  if (changes.length > 0) {
    note(changes.join("\n"), "Doctor changes");
  }
}
