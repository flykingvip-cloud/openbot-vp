/**
 * Shared Account sandbox mounts (skills + canvas).
 *
 * Used by both `applyAccountSandboxConfig` (gateway docker driver) and
 * `RuntimeController.buildSpec` (Account Worker / aw-exec leases). The two
 * paths must stay consistent: skills mount at `/account/skills:ro`.
 *
 * Shared skills are a read-only host tree (managed ∪ bundled, managed wins).
 * They are never copied into a user/tenant tree.
 */
import fs from "node:fs";
import path from "node:path";
import { STATE_DIR } from "../../config/paths.js";
import type { OpenBotConfig } from "../../config/types.js";
import { CONFIG_DIR, resolveUserPath } from "../../utils.js";
import { resolveBundledSkillsDir } from "../skills/bundled-dir.js";

export const ACCOUNT_SKILLS_CONTAINER_DIR = "/account/skills";

function looksLikeSkillRoot(dir: string): boolean {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) {
        continue;
      }
      if (entry.isDirectory() && fs.existsSync(path.join(dir, entry.name, "SKILL.md"))) {
        return true;
      }
      if (entry.isFile() && entry.name.endsWith(".md")) {
        return true;
      }
    }
  } catch {
    return false;
  }
  return false;
}

function listSkillChildDirs(root: string): string[] {
  try {
    return fs
      .readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .filter((entry) => fs.existsSync(path.join(root, entry.name, "SKILL.md")))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

/**
 * Materialize managed ∪ bundled into `$STATE_DIR/shared-account-skills`.
 * Managed overwrites bundled by skill directory name. Returns a single host
 * path suitable for `/account/skills:ro`. When only one source exists, returns
 * that source directly (no copy).
 */
export function materializeSharedAccountSkillsMount(params?: {
  bundledSkillsDir?: string;
  managedSkillsDir?: string;
  destDir?: string;
}): string | undefined {
  const bundledRaw = params?.bundledSkillsDir?.trim() || resolveBundledSkillsDir();
  const bundledOk = bundledRaw?.trim() ? path.resolve(bundledRaw.trim()) : undefined;
  const managedCandidate = params?.managedSkillsDir?.trim() || path.join(CONFIG_DIR, "skills");
  const managed =
    managedCandidate && looksLikeSkillRoot(managedCandidate)
      ? path.resolve(managedCandidate)
      : undefined;

  if (!managed && !bundledOk) {
    return undefined;
  }
  if (managed && !bundledOk) {
    return managed;
  }
  if (bundledOk && !managed) {
    return bundledOk;
  }
  if (managed && bundledOk && managed === bundledOk) {
    return managed;
  }

  const dest = path.resolve(
    params?.destDir?.trim() || path.join(STATE_DIR, "shared-account-skills"),
  );
  fs.mkdirSync(dest, { recursive: true });

  const bundledNames = listSkillChildDirs(bundledOk!);
  const managedNames = listSkillChildDirs(managed!);
  const stampPath = path.join(dest, ".mount-stamp.json");
  const stamp = {
    bundled: path.resolve(bundledOk!),
    managed: path.resolve(managed!),
    bundledNames,
    managedNames,
  };
  try {
    const prev = JSON.parse(fs.readFileSync(stampPath, "utf8")) as typeof stamp;
    if (
      prev.bundled === stamp.bundled &&
      prev.managed === stamp.managed &&
      JSON.stringify(prev.bundledNames) === JSON.stringify(stamp.bundledNames) &&
      JSON.stringify(prev.managedNames) === JSON.stringify(stamp.managedNames) &&
      looksLikeSkillRoot(dest)
    ) {
      return dest;
    }
  } catch {
    // refresh
  }

  const writeSkill = (sourceRoot: string, name: string) => {
    const source = path.join(sourceRoot, name);
    const target = path.join(dest, name);
    fs.rmSync(target, { recursive: true, force: true });
    fs.cpSync(source, target, { recursive: true, dereference: true });
  };

  for (const name of bundledNames) {
    writeSkill(bundledOk!, name);
  }
  for (const name of managedNames) {
    writeSkill(managed!, name);
  }
  fs.writeFileSync(stampPath, JSON.stringify(stamp), "utf8");
  return dest;
}

export function resolveSharedAccountMountDirs(config?: OpenBotConfig): {
  sharedSkillsDir?: string;
  sharedCanvasDir: string;
} {
  const configuredCanvas = config?.canvasHost?.root?.trim();
  return {
    sharedSkillsDir: materializeSharedAccountSkillsMount(),
    sharedCanvasDir: configuredCanvas
      ? resolveUserPath(configuredCanvas)
      : path.join(STATE_DIR, "canvas"),
  };
}

/**
 * Map a host skill path onto the Account sandbox mount tree.
 * Managed and bundled skills are visible at `/account/skills/<name>/SKILL.md`.
 */
export function mapSkillLocationForAccountSandbox(params: {
  skillName: string;
  filePath: string;
}): string {
  const name = params.skillName.trim() || path.basename(path.dirname(params.filePath));
  const base = path.basename(params.filePath);
  const fileName = base.toLowerCase() === "skill.md" ? "SKILL.md" : base || "SKILL.md";
  return `${ACCOUNT_SKILLS_CONTAINER_DIR}/${name}/${fileName}`;
}

/**
 * Rewrite `<location>…</location>` tags in a skills prompt so Account sandbox
 * agents read from `/account/skills/<name>/…` instead of host paths
 * (`~/.openbot/…`, `/app/skills/…`, absolute home paths).
 */
export function remapSkillsPromptLocationsForAccountSandbox(prompt: string): string {
  const trimmed = prompt.trim();
  if (!trimmed) {
    return prompt;
  }
  return prompt.replace(/<location>([^<]*)<\/location>/g, (_match, rawLocation: string) => {
    const location = rawLocation.trim();
    if (!location) {
      return "<location></location>";
    }
    if (location.startsWith(`${ACCOUNT_SKILLS_CONTAINER_DIR}/`)) {
      return `<location>${location}</location>`;
    }
    const normalized = location.replace(/\\/g, "/");
    const parts = normalized.split("/").filter(Boolean);
    const skillsIdx = parts.lastIndexOf("skills");
    let skillName = "";
    if (skillsIdx >= 0 && parts[skillsIdx + 1]) {
      skillName = parts[skillsIdx + 1]!;
    } else if (parts.length >= 2) {
      skillName = parts[parts.length - 2]!;
    }
    const fileName = parts[parts.length - 1] || "SKILL.md";
    const mapped = mapSkillLocationForAccountSandbox({
      skillName,
      filePath: fileName,
    });
    return `<location>${mapped}</location>`;
  });
}
