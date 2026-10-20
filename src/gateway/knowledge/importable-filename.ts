/**
 * Folder-import and reserved-folder listing share this gate: only real documents,
 * never extensionless directory shells (图书室 / UPBEYOND).
 */
import path from "node:path";

const IMPORTABLE_EXTENSIONS = new Set([
  ".csv",
  ".doc",
  ".docx",
  ".gif",
  ".jpeg",
  ".jpg",
  ".markdown",
  ".md",
  ".pdf",
  ".png",
  ".ppt",
  ".pptx",
  ".txt",
  ".webp",
  ".xls",
  ".xlsx",
]);

export function knowledgeFileExtension(fileName: string): string {
  return path.posix.extname(fileName.replace(/\\/g, "/")).toLowerCase();
}

export function isImportableKnowledgeFilename(fileName: string): boolean {
  return IMPORTABLE_EXTENSIONS.has(knowledgeFileExtension(fileName));
}

export function flattenKnowledgeImportBasename(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\.\//, "").trim();
  const base = path.posix.basename(normalized);
  return base || normalized;
}

export function uniquifyKnowledgeImportBasename(fileName: string, used: Set<string>): string {
  if (!used.has(fileName)) {
    return fileName;
  }
  const ext = knowledgeFileExtension(fileName);
  const stem =
    ext && fileName.toLowerCase().endsWith(ext) ? fileName.slice(0, -ext.length) : fileName;
  let n = 2;
  let next = `${stem}-${n}${ext}`;
  while (used.has(next)) {
    n += 1;
    next = `${stem}-${n}${ext}`;
  }
  return next;
}
