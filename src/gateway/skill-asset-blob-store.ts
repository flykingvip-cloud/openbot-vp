import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { canonicalizePreviewText } from "../shared/preview-artifact/canonicalize.js";
import { CONFIG_DIR } from "../utils.js";

const BLOBS_DIR = path.join(CONFIG_DIR, "skill-assets", "blobs");
const CONTENT_REF_PREFIX = "blob:";

export function isContentRef(value: string): boolean {
  return value.trim().startsWith(CONTENT_REF_PREFIX);
}

export function writeSkillContentBlob(content: string): string {
  const canonical = canonicalizePreviewText(content);
  if (!canonical) {
    return "";
  }
  const hash = createHash("sha256").update(canonical, "utf8").digest("hex");
  fs.mkdirSync(BLOBS_DIR, { recursive: true });
  const filePath = path.join(BLOBS_DIR, `${hash}.md`);
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, canonical, "utf8");
  }
  return `${CONTENT_REF_PREFIX}${hash}`;
}

export function readSkillContentBlob(contentRef: string): string | null {
  const ref = contentRef.trim();
  if (!ref.startsWith(CONTENT_REF_PREFIX)) {
    return null;
  }
  const hash = ref.slice(CONTENT_REF_PREFIX.length);
  if (!/^[a-f0-9]{64}$/i.test(hash)) {
    return null;
  }
  const filePath = path.join(BLOBS_DIR, `${hash}.md`);
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

export function hydrateProfileOutputContent(profile: {
  outputDescription?: string;
  contentRef?: string;
}): string {
  const ref = profile.contentRef?.trim() ?? "";
  if (ref) {
    const blob = readSkillContentBlob(ref);
    if (blob) {
      return blob;
    }
  }
  return profile.outputDescription?.trim() ?? "";
}

export function persistProfileOutputContent(content: string): {
  outputDescription: string;
  contentRef: string;
} {
  const trimmed = content.trim();
  if (!trimmed) {
    return { outputDescription: "", contentRef: "" };
  }
  const contentRef = writeSkillContentBlob(trimmed);
  return { outputDescription: "", contentRef };
}

export function migrateInlineOutputToBlob(profile: {
  outputDescription?: string;
  contentRef?: string;
}): { outputDescription: string; contentRef: string; migrated: boolean } {
  const inline = profile.outputDescription?.trim() ?? "";
  const existingRef = profile.contentRef?.trim() ?? "";
  if (!inline || existingRef) {
    return {
      outputDescription: inline,
      contentRef: existingRef,
      migrated: false,
    };
  }
  const persisted = persistProfileOutputContent(inline);
  return { ...persisted, migrated: true };
}
