/**
 * OGUI ↔ WizardStep mapping (thin adapter, NOT a merge).
 *
 * - OGUI = chat-inline Generative UI (fences → chat.send)
 * - Wizard = setup session stepper (wizard.start / wizard.next)
 *
 * This module only translates shapes for documentation / tooling / future
 * bridges. It does not share session state, RPC, or UI renderers.
 */
import type { Static } from "@sinclair/typebox";
import {
  OguiChoiceSchema,
  OguiFormFieldSchema,
  OguiFormSchema,
  OguiSingleSelectFieldSchema,
} from "./schema/ogui.js";
import { WizardStepSchema } from "./schema/wizard.js";

export type OguiForm = Static<typeof OguiFormSchema>;
export type OguiChoice = Static<typeof OguiChoiceSchema>;
export type OguiFormField = Static<typeof OguiFormFieldSchema>;
export type OguiSingleSelectField = Static<typeof OguiSingleSelectFieldSchema>;
export type WizardStep = Static<typeof WizardStepSchema>;

/**
 * Field-type mapping table (authoritative for adapters).
 * Only types that have a clear Wizard counterpart are listed.
 */
export const OGUI_TO_WIZARD_FIELD_TYPE = {
  single_select: "select",
} as const satisfies Record<"single_select", "select">;

export const WIZARD_TO_OGUI_FIELD_TYPE = {
  select: "single_select",
  // Wizard multiselect exists; OGUI multi_select UX is deferred (P0/P1′ out of scope).
  multiselect: null,
  text: null,
  confirm: null,
  note: null,
  progress: null,
  action: null,
} as const;

function optionValueToString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return null;
}

/** Map one OGUI single_select field → Wizard `select` step (lossy: string values only). */
export function oguiFieldToWizardStep(field: OguiFormField): WizardStep | null {
  if (field.type !== "single_select") {
    return null;
  }
  return {
    id: field.id,
    type: OGUI_TO_WIZARD_FIELD_TYPE.single_select,
    title: field.label,
    options: field.options.map((opt) => ({
      value: opt.value,
      label: opt.label,
    })),
  };
}

/** Expand an OGUI form into Wizard-shaped steps (no session / no wizard.* calls). */
export function oguiFormToWizardSteps(form: OguiForm): WizardStep[] {
  const steps: WizardStep[] = [];
  for (const field of form.fields) {
    const step = oguiFieldToWizardStep(field);
    if (step) {
      steps.push(step);
    }
  }
  return steps;
}

/** Map one OGUI choice → a single Wizard `select` step. */
export function oguiChoiceToWizardStep(choice: OguiChoice): WizardStep {
  return {
    id: choice.component_id,
    type: "select",
    title: choice.label,
    options: choice.options.map((opt) => ({
      value: opt.value,
      label: opt.label,
    })),
  };
}

/**
 * Map a Wizard `select` step → OGUI single_select field when option values are
 * string-coercible. Returns null for other Wizard step types (no silent invent).
 */
export function wizardStepToOguiField(step: WizardStep): OguiSingleSelectField | null {
  if (step.type !== "select") {
    return null;
  }
  if (!step.options || step.options.length === 0) {
    return null;
  }
  const options: { value: string; label: string }[] = [];
  for (const opt of step.options) {
    const value = optionValueToString(opt.value);
    if (!value || !opt.label?.trim()) {
      return null;
    }
    options.push({ value, label: opt.label.trim() });
  }
  const label = (step.title ?? step.message ?? step.id).trim();
  if (!label) {
    return null;
  }
  return {
    id: step.id,
    label,
    type: "single_select",
    options,
  };
}
