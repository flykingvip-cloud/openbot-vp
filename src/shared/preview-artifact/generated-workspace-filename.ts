/**
 * Prose-scrape fallback for a workspace file the producer only announced
 * (no <<DELIVERABLE>> envelope), e.g. "已生成 articles/report.html" or
 * "已生成 `从 Know How 到 Be What（V7 · 出版版）.pdf`".
 *
 * Browser and server resolvers must share this helper so "打开成果" looks
 * up the same relative path both sides inferred.
 */

const DELIVERABLE_EXT =
  "docx?|pptx?|xlsx?|pdf|html?|md|markdown|csv|txt|pages|numbers|key|canvas|png|jpe?g|webp|gif|svg|bmp";

const WORKSPACE_GENERATED_FILE_CUE_RE =
  /(生成|已生成|生成好|制作完成|已完成|写入|已写入|保存|已保存|存到|放在|导出|输出|已在工作区|在工作区|草稿箱|附件|路径|文件路径|保存路径|输出路径|Path\s*:|文件\s*[:：])/;

const WORKSPACE_QUOTED_FILENAME_RE = new RegExp(
  "`([^`\\n]{1,240}\\.(?:" + DELIVERABLE_EXT + "))`",
  "i",
);

const WORKSPACE_LABELED_FILENAME_RE = new RegExp(
  "(?:文件路径|保存路径|输出路径|路径|Path|文件|附件|保存为|输出为|导出为|文件名|保存到|存为)\\s*[:：]?\\s*`?([^\\n\"'`<>|]{1,240}\\.(?:" +
    DELIVERABLE_EXT +
    "))`?",
  "i",
);

const WORKSPACE_BARE_FILENAME_RE = new RegExp(
  "([^\\s\"'`：:*?<>|]+\\.(?:" + DELIVERABLE_EXT + "))\\b",
  "i",
);

/** Title-like names that contain spaces or fullwidth punctuation. */
const WORKSPACE_SPACED_FILENAME_RE = new RegExp(
  "((?:[A-Za-z0-9._\\u3400-\\u9fff-]+/)*[A-Za-z0-9\\u3400-\\u9fff][A-Za-z0-9\\u3400-\\u9fff .·—–（）()\\-]*\\.(?:" +
    DELIVERABLE_EXT +
    "))\\b",
  "i",
);

export function normalizeGeneratedWorkspacePath(value: string): string | null {
  const normalized = value.trim().replace(/\\/g, "/");
  if (
    !normalized ||
    normalized.length > 500 ||
    normalized.startsWith("/") ||
    normalized.endsWith("/") ||
    normalized.includes("\0") ||
    /^[a-z]:\//i.test(normalized)
  ) {
    return null;
  }
  const segments = normalized.split("/");
  if (
    segments.some(
      (segment) => !segment || segment === "." || segment === ".." || segment.includes(":"),
    )
  ) {
    return null;
  }
  return segments.join("/");
}

export function extractGeneratedWorkspaceFilename(text: string): string | null {
  const cue = WORKSPACE_GENERATED_FILE_CUE_RE.exec(text);
  if (!cue) {
    return null;
  }
  const quoted = WORKSPACE_QUOTED_FILENAME_RE.exec(text)?.[1];
  if (quoted) {
    return normalizeGeneratedWorkspacePath(quoted.trim());
  }
  const labeled = WORKSPACE_LABELED_FILENAME_RE.exec(text)?.[1];
  if (labeled) {
    return normalizeGeneratedWorkspacePath(labeled.trim());
  }
  // Search after the cue so "已生成 从 Know How….pdf" does not swallow the verb.
  const search = text.slice(cue.index + cue[0].length);
  const spaced = WORKSPACE_SPACED_FILENAME_RE.exec(search)?.[1]?.trim() ?? "";
  const bare = WORKSPACE_BARE_FILENAME_RE.exec(search)?.[1]?.trim() ?? "";
  if (spaced && (!bare || spaced.length >= bare.length)) {
    return normalizeGeneratedWorkspacePath(spaced);
  }
  return bare ? normalizeGeneratedWorkspacePath(bare) : null;
}
