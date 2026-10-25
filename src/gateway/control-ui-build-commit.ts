import { createRequire } from "node:module";
import { resolveCommitHash } from "../infra/git-commit.js";

/**
 * Tip / build SHA for Control UI ops smoke.
 * Prefers OPENBOT_BUILD_SHA / diagnosis / GIT_* env, then build-info.json,
 * then resolveCommitHash (short). Returns null when unknown.
 */
export function resolveControlUiBuildCommit(
  env: NodeJS.ProcessEnv = process.env,
  options?: { moduleUrl?: string },
): string | null {
  const candidates = [
    env.OPENBOT_BUILD_SHA,
    env.OPENBOT_DIAGNOSIS_BUILD_SHA,
    env.GIT_COMMIT,
    env.GIT_SHA,
  ];
  for (const raw of candidates) {
    const trimmed = raw?.trim() ?? "";
    const match = trimmed.match(/[0-9a-fA-F]{7,40}/);
    if (match) {
      return match[0].toLowerCase();
    }
  }
  const moduleUrl = options?.moduleUrl ?? import.meta.url;
  try {
    const require = createRequire(moduleUrl);
    for (const candidate of [
      "../build-info.json",
      "../../dist/build-info.json",
      "./build-info.json",
    ]) {
      try {
        const info = require(candidate) as { commit?: string | null };
        const commit = info.commit?.trim() ?? "";
        const match = commit.match(/[0-9a-fA-F]{7,40}/);
        if (match) {
          return match[0].toLowerCase();
        }
      } catch {
        // try next candidate
      }
    }
  } catch {
    // fall through to resolveCommitHash
  }
  return resolveCommitHash({ moduleUrl, env });
}
