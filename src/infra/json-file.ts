/**
 * @deprecated Mode B F4 (`openbot.data.json-persistence-helpers`).
 * Canonical persistence is `src/infra/json-files.ts`:
 * `readJsonFile` / `writeJsonAtomic` (+ `createAsyncLock`).
 *
 * This module is a compatibility shim:
 * - `loadJsonFile` stays as the sync read helper for diagnosis fixtures and
 *   remaining sync loaders (returns `undefined` on missing/corrupt).
 * - `saveJsonFile` is a deprecated thin alias over `writeJsonAtomicSync`
 *   (tmp + rename, mode 0o600). New stores must call `writeJsonAtomic`.
 */
import fs from "node:fs";
import { writeJsonAtomicSync } from "./json-files.js";

/** Sync JSON read. Missing or corrupt files return `undefined`. */
export function loadJsonFile(pathname: string): unknown {
  try {
    if (!fs.existsSync(pathname)) {
      return undefined;
    }
    const raw = fs.readFileSync(pathname, "utf8");
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * @deprecated Use `writeJsonAtomic` from `./json-files.js` for new stores.
 * Writes are atomic (tmp + rename, 0o600) via `writeJsonAtomicSync`.
 */
export function saveJsonFile(pathname: string, data: unknown) {
  writeJsonAtomicSync(pathname, data, { trailingNewline: true, ensureDirMode: 0o700 });
}
