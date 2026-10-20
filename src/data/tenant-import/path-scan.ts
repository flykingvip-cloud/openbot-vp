/**
 * tenant-import source-machine absolute-path detection (SaaS tenant data architecture §10.3 / §16 #8).
 *
 * An imported tenant must carry ZERO source-machine absolute paths (`/Users/…`, `/home/<u>/…`,
 * `C:\Users\…`). Managed mode derives every path from `data.root` (§1.7 / §8.1), so a leaked
 * absolute path is a pre-packaging 归集 (collection) miss — NOT something the importer should
 * repoint. Repointing `/Users/…/workspace` → `/data/tenants/…` would just re-introduce the exact
 * absolute-path dependency §1.7 bans, and would require guessing the source home dir. So the
 * pipeline DETECTS + REJECTS instead of rewriting.
 *
 * The same detector runs at both ends of the pipeline: early in read-only `preflight` (fail fast,
 * before any staging I/O) and again as a commit-time backstop in `verify` (post content-rewrite).
 */

/** Source-machine absolute-path markers that must never survive into an imported tenant. */
export const SOURCE_ABSOLUTE_PATH_PATTERNS: readonly RegExp[] = [
  /\/Users\//,
  /\/home\/[^/"]+\//,
  /[A-Za-z]:\\Users\\/,
];

/** Text extensions whose content is scanned for leaked absolute paths (config/content files). */
export const VERIFIED_TEXT_EXTENSIONS: readonly string[] = [
  ".json",
  ".jsonl",
  ".json5",
  ".yaml",
  ".yml",
];

/** True when `filePath` is a config/content text file whose content should be abs-path scanned. */
export function isVerifiedTextPath(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return VERIFIED_TEXT_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** True when `text` contains a source-machine absolute path (§10.3). */
export function textHasSourceAbsolutePath(text: string): boolean {
  return SOURCE_ABSOLUTE_PATH_PATTERNS.some((re) => re.test(text));
}
