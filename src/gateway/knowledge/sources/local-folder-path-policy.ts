/**
 * Host-path authorization for localFolder local_index binds.
 * Paths must be absolute and inside Data Space (data.root, default ~/OpenBot)
 * unless the caller explicitly opts into outside-root with allowOutsideDataRoot.
 */
import path from "node:path";
import { loadConfig } from "../../../config/config.js";
import { expandDataPath, resolveDataRoot } from "../../../config/data-space.js";
import type { OpenBotConfig } from "../../../config/types.js";

export type LocalFolderPathPolicyResult =
  | { ok: true; resolvedPath: string; withinDataRoot: boolean; dataRoot: string }
  | { ok: false; code: string; message: string };

export function assertLocalFolderRootPathAllowed(params: {
  rootPath: string;
  /** Explicit opt-in to index a path outside Data Space. Default false. */
  allowOutsideDataRoot?: boolean;
  cfg?: OpenBotConfig;
  env?: NodeJS.ProcessEnv;
}): LocalFolderPathPolicyResult {
  const raw = params.rootPath.trim();
  if (!raw) {
    return {
      ok: false,
      code: "path_required",
      message: "rootPath required",
    };
  }

  // Reject relative paths before resolve (path.resolve would silently make them absolute under cwd).
  if (!path.isAbsolute(raw) && !raw.startsWith("~")) {
    return {
      ok: false,
      code: "path_not_absolute",
      message:
        "rootPath must be an absolute path (or ~/...) under the Data Space; relative paths like '.' or '../' are not allowed",
    };
  }

  const env = params.env ?? process.env;
  const cfg = params.cfg ?? loadConfig();
  const dataRoot = path.resolve(resolveDataRoot(cfg, env));
  const resolvedPath = expandDataPath(raw, env);

  if (!path.isAbsolute(resolvedPath)) {
    return {
      ok: false,
      code: "path_not_absolute",
      message: "rootPath must resolve to an absolute path",
    };
  }

  // Normalize for prefix checks (trailing sep).
  const dataRootPrefix = dataRoot.endsWith(path.sep) ? dataRoot : `${dataRoot}${path.sep}`;
  const withinDataRoot = resolvedPath === dataRoot || resolvedPath.startsWith(dataRootPrefix);

  if (!withinDataRoot && params.allowOutsideDataRoot !== true) {
    return {
      ok: false,
      code: "path_outside_data_space",
      message: `rootPath must be inside Data Space (${dataRoot}). To bind outside, pass allowOutsideDataRoot: true (explicit approval).`,
    };
  }

  return {
    ok: true,
    resolvedPath,
    withinDataRoot,
    dataRoot,
  };
}
