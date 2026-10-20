/**
 * supervisor/templates.ts — built-in acceptance presets for supervised tasks (M4.2).
 *
 * Priority at create time (per requirements): explicit acceptance param → templateId
 * → repo detection.
 */

import type { AcceptanceCriteria } from "./types.js";

export type SupervisorTaskTemplate = {
  id: string;
  label: string;
  description: string;
  acceptance: AcceptanceCriteria;
};

/** Sentinel: use repo adapter detection instead of a fixed step list. */
export const SUPERVISOR_REPO_AUTO_TEMPLATE_ID = "repo-auto";

const BUILTIN_TEMPLATES: SupervisorTaskTemplate[] = [
  {
    id: "node-test-only",
    label: "Node · 仅测试",
    description: "运行 npm test（必填）。",
    acceptance: {
      source: "template",
      steps: [{ id: "test", argv: ["npm", "test"], required: true }],
    },
  },
  {
    id: "node-test-lint",
    label: "Node · 测试 + Lint",
    description: "npm test 与 npm run lint（均必填）。",
    acceptance: {
      source: "template",
      steps: [
        { id: "test", argv: ["npm", "test"], required: true },
        { id: "lint", argv: ["npm", "run", "lint"], required: true },
      ],
    },
  },
  {
    id: "node-full-ci",
    label: "Node · 完整 CI",
    description: "test + lint + build（均必填）。",
    acceptance: {
      source: "template",
      steps: [
        { id: "test", argv: ["npm", "test"], required: true },
        { id: "lint", argv: ["npm", "run", "lint"], required: true },
        { id: "build", argv: ["npm", "run", "build"], required: true },
      ],
    },
  },
];

export function listSupervisorTaskTemplates(): SupervisorTaskTemplate[] {
  return BUILTIN_TEMPLATES.map((template) => ({
    ...template,
    acceptance: {
      ...template.acceptance,
      steps: template.acceptance.steps.map((step) => ({ ...step })),
    },
  }));
}

export function getSupervisorTaskTemplate(templateId: string): SupervisorTaskTemplate | null {
  const id = templateId.trim();
  if (!id || id === SUPERVISOR_REPO_AUTO_TEMPLATE_ID) {
    return null;
  }
  const found = BUILTIN_TEMPLATES.find((t) => t.id === id);
  if (!found) {
    return null;
  }
  return {
    ...found,
    acceptance: {
      ...found.acceptance,
      steps: found.acceptance.steps.map((step) => ({ ...step })),
    },
  };
}

export function parseAcceptanceCriteriaInput(raw: unknown): AcceptanceCriteria | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const value = raw as Record<string, unknown>;
  const stepsRaw = value.steps;
  if (!Array.isArray(stepsRaw) || stepsRaw.length === 0) {
    return null;
  }
  const steps: AcceptanceCriteria["steps"] = [];
  for (const entry of stepsRaw) {
    if (!entry || typeof entry !== "object") {
      return null;
    }
    const step = entry as Record<string, unknown>;
    const id = typeof step.id === "string" ? step.id.trim() : "";
    const argv = Array.isArray(step.argv)
      ? step.argv.map((part) => String(part).trim()).filter(Boolean)
      : [];
    if (!id || argv.length === 0) {
      return null;
    }
    steps.push({
      id,
      argv,
      required: step.required !== false,
      ...(step.expect && typeof step.expect === "object"
        ? {
            expect: {
              exitCode:
                typeof (step.expect as { exitCode?: unknown }).exitCode === "number"
                  ? (step.expect as { exitCode: number }).exitCode
                  : undefined,
            },
          }
        : {}),
    });
  }
  const sourceRaw = value.source;
  const source =
    sourceRaw === "user" || sourceRaw === "template" || sourceRaw === "repo-detected"
      ? sourceRaw
      : "user";
  return { steps, source };
}
