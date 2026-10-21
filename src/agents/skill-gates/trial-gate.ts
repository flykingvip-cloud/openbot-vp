/**
 * Batch 8 trial/smoke gate.
 *
 * A gate that says preview is OK and formal delivery is blocked must not stop
 * a trial. Promote the preview to a user-visible file, or write an openable
 * HTML/Markdown degradation. The declaration uses Batch 1 settle fields plus
 * grade and trial. This is not accept/finalize and does not open a prod flag.
 */
import fs from "node:fs";
import path from "node:path";
import { patchDeliverableDeclarationAttrs } from "../../gateway/workspace-resolver/settle-declared-deliverable.js";
import type { DeliverableSettleState } from "../../shared/preview-artifact/deliverable-envelope.js";

export const TRIAL_DEGRADED_HTML = "deliverables/trial-degraded.html";
export const TRIAL_DEGRADED_MD = "deliverables/trial-degraded.md";

export const TRIAL_GRADES = ["preview_promoted", "degraded_html", "degraded_md", "formal"] as const;
export type TrialGrade = (typeof TRIAL_GRADES)[number];

export type TrialGateDecision = {
  action: "unchanged" | "promote_preview" | "degrade" | "permanent_block";
  grade: TrialGrade;
  openablePath?: string;
  settle: DeliverableSettleState;
  reason: string;
  declaration: string;
};

const PREVIEW_OK_RE = /预览(?:已经|已)?(?:可以|可通过|通过|成功)|preview\s*(?:ok|ready|passed)/iu;
const FORMAL_BLOCKED_RE =
  /正式交付(?:不可|被阻|未通过|失败)|不能作为正式交付|正式稿不可|formal\s+deliver(?:y)?\s+blocked/iu;

export function isPreviewOkFormalBlocked(text: string): boolean {
  return PREVIEW_OK_RE.test(text) && FORMAL_BLOCKED_RE.test(text);
}

function safeRelative(relativePath: string): string | null {
  const relative = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!relative || relative.includes("..") || path.isAbsolute(relative)) {
    return null;
  }
  return relative;
}

function writeUnderWorkspace(
  workspaceDir: string,
  relativePath: string,
  body: string,
): string | null {
  const root = path.resolve(workspaceDir);
  const relative = safeRelative(relativePath);
  if (!relative) {
    return null;
  }
  const absolute = path.resolve(root, relative);
  if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) {
    return null;
  }
  try {
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, body.endsWith("\n") ? body : `${body}\n`, "utf8");
    const stat = fs.statSync(absolute);
    if (!stat.isFile() || stat.size <= 0) {
      return null;
    }
    return relative;
  } catch {
    return null;
  }
}

function fileExists(workspaceDir: string, relativePath: string): boolean {
  const root = path.resolve(workspaceDir);
  const relative = safeRelative(relativePath);
  if (!relative) {
    return false;
  }
  const absolute = path.resolve(root, relative);
  if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) {
    return false;
  }
  try {
    const stat = fs.statSync(absolute);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

export function formatTrialDeclaration(params: {
  relativePath: string;
  grade: TrialGrade;
  settle: DeliverableSettleState;
}): string {
  return [
    `<<DELIVERABLE file="${params.relativePath}" settle="${params.settle}" grade="${params.grade}" trial="1">>`,
    "试跑可见稿。正式交付闸门未放开，这份可以直接打开。",
    "<</DELIVERABLE>>",
  ].join("\n");
}

export function annotateTrialDeclaration(
  text: string,
  params: { relativePath: string; grade: TrialGrade; settle: DeliverableSettleState },
): string {
  if (/<<\s*DELIVERABLE\b/i.test(text)) {
    const declared = /file\s*=\s*["']([^"']+)["']/i.exec(text)?.[1] ?? params.relativePath;
    return patchDeliverableDeclarationAttrs(text, declared, {
      nextRelativePath: params.relativePath,
      settle: params.settle,
      unwritten: params.settle !== "confirmed",
      grade: params.grade,
      trial: "1",
    });
  }
  return `${formatTrialDeclaration(params)}\n${text}`.trim();
}

function degradeBody(params: { grade: TrialGrade; reason: string }): string {
  const title =
    params.grade === "degraded_md" ? "# 试跑降级稿" : "<!doctype html><title>试跑降级稿</title>";
  return [
    title,
    "",
    "试跑闸门：预览可以，正式交付被挡住。下面这份可以直接打开。",
    `grade: ${params.grade}`,
    "trial: 1",
    `reason: ${params.reason}`,
    "settle: confirmed",
  ].join("\n");
}

/**
 * Trial/smoke only. Formal mode returns unchanged so a blocked formal deliver
 * stays blocked. Does not widen accept or finalize.
 */
export function applyTrialGate(params: {
  trial: boolean;
  narrative: string;
  workspaceDir?: string | null;
  previewPath?: string | null;
}): TrialGateDecision | null {
  if (!params.trial || !isPreviewOkFormalBlocked(params.narrative)) {
    return null;
  }
  const preview = params.previewPath?.trim() ?? "";
  const workspaceDir = params.workspaceDir?.trim() ?? "";
  if (preview && workspaceDir && fileExists(workspaceDir, preview)) {
    const declaration = formatTrialDeclaration({
      relativePath: safeRelative(preview) ?? preview,
      grade: "preview_promoted",
      settle: "confirmed",
    });
    return {
      action: "promote_preview",
      grade: "preview_promoted",
      openablePath: safeRelative(preview) ?? preview,
      settle: "confirmed",
      reason: "preview_promoted",
      declaration,
    };
  }
  if (!workspaceDir) {
    return {
      action: "permanent_block",
      grade: "formal",
      settle: "declared",
      reason: "trial_gate_no_workspace",
      declaration: "",
    };
  }
  const html = writeUnderWorkspace(
    workspaceDir,
    TRIAL_DEGRADED_HTML,
    degradeBody({ grade: "degraded_html", reason: "formal_blocked" }),
  );
  if (html) {
    return {
      action: "degrade",
      grade: "degraded_html",
      openablePath: html,
      settle: "confirmed",
      reason: "formal_blocked_openable_html",
      declaration: formatTrialDeclaration({
        relativePath: html,
        grade: "degraded_html",
        settle: "confirmed",
      }),
    };
  }
  const md = writeUnderWorkspace(
    workspaceDir,
    TRIAL_DEGRADED_MD,
    degradeBody({ grade: "degraded_md", reason: "formal_blocked" }),
  );
  if (md) {
    return {
      action: "degrade",
      grade: "degraded_md",
      openablePath: md,
      settle: "confirmed",
      reason: "formal_blocked_openable_md",
      declaration: formatTrialDeclaration({
        relativePath: md,
        grade: "degraded_md",
        settle: "confirmed",
      }),
    };
  }
  return {
    action: "permanent_block",
    grade: "formal",
    settle: "declared",
    reason: "trial_degrade_unwritten",
    declaration: "",
  };
}
