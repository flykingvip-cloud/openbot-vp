import { ValidationError } from "./errors.js";
import { computeDedupKey, normalizeClaim } from "./keys.js";
import type { MemoryAtom, TaskFrame } from "./models.js";
import { validateScope } from "./scope.js";

function validateStringList(label: string, values: string[]): void {
  if (!Array.isArray(values)) {
    throw new ValidationError(`${label} must be an array`);
  }
  if (values.some((value) => typeof value !== "string")) {
    throw new ValidationError(`${label} must contain only strings`);
  }
}

export function validateTaskFrame(taskFrame: TaskFrame): void {
  if (!taskFrame.id) {
    throw new ValidationError("taskFrame.id is required");
  }
  if (!taskFrame.taskType) {
    throw new ValidationError("taskFrame.taskType is required");
  }
  validateScope(taskFrame.scope);
  validateStringList("taskFrame.goals", taskFrame.goals);
  validateStringList("taskFrame.problems", taskFrame.problems);
  validateStringList("taskFrame.scenarioTags", taskFrame.scenarioTags);
  validateStringList("taskFrame.constraints", taskFrame.constraints);
  validateStringList("taskFrame.entities", taskFrame.entities);
  validateStringList("taskFrame.requiredAtomTypes", taskFrame.requiredAtomTypes);
}

export function normalizeTaskFrame(taskFrame: TaskFrame): TaskFrame {
  validateTaskFrame(taskFrame);
  return {
    ...taskFrame,
    goals: [...new Set(taskFrame.goals.map((goal) => goal.trim()).filter(Boolean))],
    problems: [
      ...new Set(taskFrame.problems.map((problem) => normalizeClaim(problem)).filter(Boolean)),
    ],
    scenarioTags: [
      ...new Set(taskFrame.scenarioTags.map((tag) => normalizeClaim(tag)).filter(Boolean)),
    ],
    constraints: [
      ...new Set(taskFrame.constraints.map((constraint) => constraint.trim()).filter(Boolean)),
    ],
    entities: [
      ...new Set(taskFrame.entities.map((entity) => normalizeClaim(entity)).filter(Boolean)),
    ],
    requiredAtomTypes: [
      ...new Set(taskFrame.requiredAtomTypes.map((atomType) => atomType.trim()).filter(Boolean)),
    ],
  };
}

export function validateMemoryAtom(atom: MemoryAtom): void {
  if (!atom.id) {
    throw new ValidationError("memoryAtom.id is required");
  }
  if (!atom.atomType) {
    throw new ValidationError("memoryAtom.atomType is required");
  }
  validateScope(atom.scope);
  if (!atom.claim.statement.trim()) {
    throw new ValidationError("memoryAtom.claim.statement is required");
  }
  if (atom.trigger.conditions.length === 0 && atom.trigger.contextTags.length === 0) {
    throw new ValidationError("memoryAtom.trigger must include conditions or contextTags");
  }
}

export function attachDedupKey(atom: MemoryAtom): MemoryAtom {
  validateMemoryAtom(atom);
  return {
    ...atom,
    dedupKey: atom.dedupKey ?? computeDedupKey(atom),
  };
}
