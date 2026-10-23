/**
 * OGUI ↔ Canvas surface routing (thin adapter).
 *
 * - Chat-inline OGUI (`ogui-form` / `ogui-choice`) stays the primary Generative UI path.
 * - Canvas / A2UI remains the HTML visual workspace (charts, materials, A2UI v0.8).
 * - Simple choices must NOT be forced into Canvas / A2UI.
 * - When Canvas HTML already uses `sendUserAction`, it may emit an OGUI-compatible
 *   structured action payload (name: `ogui.answer`) — no new ui.* RPC, no A2UI v0.9.
 */
import type { Static } from "@sinclair/typebox";
import { OguiAnswerSchema, OguiChoiceSchema, OguiFormSchema } from "./schema/ogui.js";

export type OguiForm = Static<typeof OguiFormSchema>;
export type OguiChoice = Static<typeof OguiChoiceSchema>;
export type OguiAnswer = Static<typeof OguiAnswerSchema>;

export type OguiSurfaceRoute = "chat-inline" | "canvas-visual-only";

export type CanvasUserActionPayload = {
  name: string;
  surfaceId: string;
  sourceComponentId: string;
  context: Record<string, unknown>;
};

/**
 * Route an OGUI component definition to a surface.
 * Forms and choices always stay chat-inline; Canvas is never selected here.
 */
export function routeOguiComponent(component: {
  type?: string;
  schema_version?: string;
}): OguiSurfaceRoute {
  void component;
  return "chat-inline";
}

/** Explicit policy: thin choices are never upgraded into canvas.present / A2UI. */
export function mustNotForceChoiceIntoCanvas(_choice?: OguiChoice): true {
  void _choice;
  return true;
}

/**
 * Build a Canvas `sendUserAction`-compatible payload from a submitted ogui-answer.
 * Intended for Canvas HTML that already bridges via OpenBot.sendUserAction —
 * not a substitute for chat.send ogui-answer fences.
 */
export function oguiAnswerToCanvasUserAction(
  answer: OguiAnswer,
  opts?: { surfaceId?: string },
): CanvasUserActionPayload {
  return {
    name: "ogui.answer",
    surfaceId: opts?.surfaceId?.trim() || "main",
    sourceComponentId: answer.component_id,
    context: {
      schema_version: answer.schema_version,
      component_id: answer.component_id,
      submission_id: answer.submission_id,
      answers: answer.answers,
      ...(answer.submitted_at ? { submitted_at: answer.submitted_at } : {}),
      ...(answer.decision_id && answer.decision_version
        ? { decision_id: answer.decision_id, decision_version: answer.decision_version }
        : {}),
      continue_agent: true,
      // High-risk actions must still go through Steward / Exec Approvals —
      // this payload is structured context only, not an approval bypass.
      does_not_bypass_steward_or_exec_approvals: true,
    },
  };
}

/**
 * Detect whether a Canvas userAction name is an OGUI-compatible structured submit.
 * Used by hosts that already listen for sendUserAction — no A2UI invent.
 */
export function isOguiCanvasUserActionName(name: string): boolean {
  return name.trim() === "ogui.answer";
}

/**
 * A2UI version policy for OGUI stage-2: stay on v0.8; createSurface (v0.9) unsupported.
 */
export const OGUI_CANVAS_A2UI_POLICY = {
  supportedA2uiVersion: "0.8",
  createSurfaceSupported: false,
  simpleChoicesGoTo: "chat-inline" as const,
} as const;
