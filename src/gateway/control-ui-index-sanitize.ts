import path from "node:path";

/**
 * Overlay generations that must never be served. Cached HTML or leftover
 * satellite imports pointing at these names recreate a second ESM graph
 * (duplicate customElements / duplicate top-level bindings).
 *
 * CSS hashes may still contain `-nm6`; only JavaScript is retired.
 */
const RETIRED_ENTRY_BASENAMES = new Set([
  "index-CR5cronNm6.js",
  "index-CR5cronNm7.js",
  "index-CR5cronNm8.js",
  "workbench-r5cronNm6.js",
  "workbench-r5cronNm7.js",
  "workbench-r5cronNm8.js",
  "workbench-stage-assistant-r5Nm6Wg.js",
  "workbench-stage-assistant-r5Nm8Wg.js",
  "workbench-stage-assistant-r5Nm8Wg-nm9.js",
]);

/** Pinned module entry for the current surgical overlay. Update on the next named cut. */
export const CONTROL_UI_PINNED_MODULE_ENTRY = "./assets/index-CR5cronNm9.js";

export function isRetiredControlUiAsset(fileRel: string): boolean {
  const base = path.basename(String(fileRel).split("?")[0] ?? "");
  if (!base || base.endsWith(".css")) {
    return false;
  }
  if (RETIRED_ENTRY_BASENAMES.has(base)) {
    return true;
  }
  if (/-nm[678]\.js$/i.test(base)) {
    return true;
  }
  if (/Nm[68]Wg/i.test(base) && !/Nm9/i.test(base)) {
    return true;
  }
  return false;
}

function stripJsScriptCacheBustQueries(html: string): string {
  return html.replace(/(<script\b[^>]*\bsrc=["'])([^"']+\.js)(\?[^"']*)(["'])/gi, "$1$2$4");
}

function rewriteRetiredModuleEntries(html: string, pinnedEntry: string): string {
  return html.replace(
    /(<script\b[^>]*\bsrc=["'])([^"']*index-CR5cronNm[6-8]\.js)(["'])/gi,
    `$1${pinnedEntry}$3`,
  );
}

/**
 * HTML is Cache-Control: no-cache, but overlay agents still append `?v=` to the
 * module entry. ESM treats `file.js` and `file.js?v=` as two module identities.
 */
export function sanitizeControlUiIndexHtml(
  html: string,
  pinnedEntry: string = CONTROL_UI_PINNED_MODULE_ENTRY,
): string {
  return rewriteRetiredModuleEntries(stripJsScriptCacheBustQueries(html), pinnedEntry);
}
