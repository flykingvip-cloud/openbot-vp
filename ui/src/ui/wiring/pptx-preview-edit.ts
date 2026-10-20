/**
 * Persist PPTX preview edits into the birth-workspace .pptx package.
 */

import {
  isPptxWorkspaceFilename,
  parseOfficeSlideDraft,
} from "../../../../src/gateway/office-slide-draft.ts";
import { patchGroupWorkspacePptx } from "../controllers/group-workspace-file.ts";
import { patchStewardWorkspacePptx } from "../controllers/steward-workspace-file.ts";
import type { GatewayBrowserClient } from "../gateway.ts";
import type { WorkspaceFilePreviewPayload } from "./workspace-file-preview.ts";

export async function persistWorkspacePptxSlideDraft(params: {
  client: GatewayBrowserClient | null;
  filename: string;
  draft: string;
  groupId?: string | null;
  sessionKey?: string | null;
}): Promise<WorkspaceFilePreviewPayload | null> {
  const filename = params.filename.trim();
  if (!params.client || !isPptxWorkspaceFilename(filename)) {
    return null;
  }
  const slides = parseOfficeSlideDraft(params.draft);
  if (slides.length === 0) {
    return null;
  }
  const groupId = params.groupId?.trim() || "";
  if (groupId) {
    return patchGroupWorkspacePptx(params.client, groupId, filename, slides);
  }
  return patchStewardWorkspacePptx(
    params.client,
    filename,
    slides,
    params.sessionKey?.trim() ? { sessionKey: params.sessionKey.trim() } : {},
  );
}
