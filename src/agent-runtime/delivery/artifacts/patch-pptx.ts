import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { patchPptxSlideTexts, type OfficeSlideText } from "../../../gateway/office-pptx-text.js";
import { SESSION_TASK_BOARD_LOCK_OPTIONS, withFileLockSync } from "../../../infra/file-lock.js";

export const artifactContentHash = (bytes: Buffer): string =>
  createHash("sha256").update(bytes).digest("hex");

/** Caller authorizes the original path. Compare the same bytes under the write lock. */
export async function patchAuthorizedPptx(
  file: string,
  expectedHash: string,
  slides: OfficeSlideText[],
): Promise<
  { kind: "saved"; bytes: Buffer; contentHash: string } | { kind: "conflict" | "invalid" }
> {
  if (!/^[a-f0-9]{64}$/u.test(expectedHash)) {
    return { kind: "invalid" };
  }
  const original = fs.readFileSync(file);
  if (artifactContentHash(original) !== expectedHash) {
    return { kind: "conflict" };
  }
  const patched = await patchPptxSlideTexts(original, slides);
  if (!patched) {
    return { kind: "invalid" };
  }
  return withFileLockSync(`${file}.pptx-edit`, SESSION_TASK_BOARD_LOCK_OPTIONS, () => {
    if (artifactContentHash(fs.readFileSync(file)) !== expectedHash) {
      return { kind: "conflict" as const };
    }
    const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${randomUUID()}.tmp`);
    try {
      fs.writeFileSync(temporary, patched, { flag: "wx", mode: fs.statSync(file).mode & 0o777 });
      fs.renameSync(temporary, file);
    } finally {
      if (fs.existsSync(temporary)) {
        fs.unlinkSync(temporary);
      }
    }
    return { kind: "saved" as const, bytes: patched, contentHash: artifactContentHash(patched) };
  });
}
