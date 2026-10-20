/**
 * Purge credential files left on disk by removed features.
 *
 * Deleting a feature's code does not delete the secrets it stored. The cloud-drive passive
 * connectors (baidu / aliyun / quark) persisted AES-256-GCM encrypted OAuth access and refresh
 * tokens under the state dir, next to the 32-byte key needed to decrypt them. With the feature
 * gone nothing reads, refreshes or revokes those tokens, so they are pure liability: still
 * valid at the provider, and still decryptable by anything that can read both files.
 *
 * These are hard-deleted rather than renamed to `.deleted.<timestamp>` the way orphan
 * transcripts are archived - archiving a credential store relocates the secret instead of
 * retiring it.
 */
import fs from "node:fs";
import path from "node:path";
import { formatCliCommand } from "../cli/command-format.js";
import { resolveStateDir } from "../config/paths.js";
import { note } from "../terminal/note.js";
import { shortenHomePath } from "../utils.js";

type DoctorPrompterLike = {
  confirmSkipInNonInteractive: (params: {
    message: string;
    initialValue?: boolean;
  }) => Promise<boolean>;
};

/**
 * State-dir-relative files owned by features that no longer exist. Add an entry here when a
 * removal leaves credentials behind; `feature` only feeds the operator-facing message.
 */
const REMOVED_FEATURE_CREDENTIAL_FILES: ReadonlyArray<{
  feature: string;
  relPaths: readonly string[];
}> = [
  {
    feature: "cloud drive knowledge import (baidu / aliyun / quark)",
    relPaths: [
      path.join("knowledge", "cloud-drive-credentials.json"),
      path.join("knowledge", "cloud-drive-credentials.json.key"),
    ],
  },
];

function existsFile(filePath: string): boolean {
  try {
    return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

export async function maybePurgeRemovedFeatureCredentials(prompter: DoctorPrompterLike) {
  const stateDir = resolveStateDir(process.env);
  const warnings: string[] = [];
  const changes: string[] = [];

  for (const entry of REMOVED_FEATURE_CREDENTIAL_FILES) {
    const found = entry.relPaths
      .map((rel) => path.join(stateDir, rel))
      .filter((filePath) => existsFile(filePath));
    if (found.length === 0) {
      continue;
    }
    warnings.push(
      [
        `- Found ${found.length} leftover credential file(s) from a removed feature: ${entry.feature}.`,
        ...found.map((filePath) => `  ${shortenHomePath(filePath)}`),
        "- Nothing reads or refreshes these tokens anymore, but they may still be valid at the provider.",
      ].join("\n"),
    );
    const purge = await prompter.confirmSkipInNonInteractive({
      message: `Delete ${found.length} leftover credential file(s) for ${entry.feature}?`,
      initialValue: true,
    });
    if (!purge) {
      warnings.push(
        `- Skipped. Remove later with ${formatCliCommand("openbot doctor --fix")}, and revoke the tokens at the provider.`,
      );
      continue;
    }
    for (const filePath of found) {
      try {
        fs.rmSync(filePath, { force: true });
        changes.push(`- Deleted leftover credential file ${shortenHomePath(filePath)}`);
      } catch (err) {
        warnings.push(`- Failed to delete ${shortenHomePath(filePath)}: ${String(err)}`);
      }
    }
    // The parent dir existed only for this store, so drop it when the purge empties it.
    for (const dir of new Set(found.map((filePath) => path.dirname(filePath)))) {
      try {
        if (fs.readdirSync(dir).length === 0) {
          fs.rmdirSync(dir);
        }
      } catch {
        // Best effort: an empty directory left behind is harmless.
      }
    }
  }

  if (warnings.length > 0) {
    note(warnings.join("\n"), "Removed feature credentials");
  }
  if (changes.length > 0) {
    note(changes.join("\n"), "Doctor changes");
  }
}
