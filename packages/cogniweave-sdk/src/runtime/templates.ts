import { NODE_TYPES, RELATION_TYPES } from "../graph/schema.js";
import type { NodeType, RelationType, TaskType } from "../models.js";

export type TemplateRelation = RelationType | "mitigates_inverse";

export interface TemplateStep {
  relation: TemplateRelation;
  nextNodeTypes: NodeType[];
  nextAtomTypes?: string[];
  optional?: boolean;
}

export interface PathTemplate {
  id: string;
  startNodeTypes: NodeType[];
  startAtomTypes?: string[];
  steps: TemplateStep[];
}

export interface ResolvedTemplateRelation {
  relationType: RelationType;
  reverse: boolean;
}

const KNOWN_TASK_TYPES: TaskType[] = [
  "debugging",
  "planning",
  "research",
  "negotiation",
  "writing",
  "support",
  "operations",
];

export interface TemplateRegistryConfig {
  templates: PathTemplate[];
  taskBindings: Record<string, string[]>;
  defaultTemplateId: string;
}

function assertNodeType(nodeType: string): asserts nodeType is NodeType {
  if (!NODE_TYPES.includes(nodeType as NodeType)) {
    throw new Error(`Template validation failed: unsupported node type "${nodeType}"`);
  }
}

function assertRelation(relation: string): void {
  if (relation === "mitigates_inverse") {
    return;
  }
  if (!RELATION_TYPES.includes(relation as RelationType)) {
    throw new Error(`Template validation failed: unsupported relation "${relation}"`);
  }
}

export function resolveTemplateRelation(relation: TemplateRelation): ResolvedTemplateRelation {
  if (relation === "mitigates_inverse") {
    return {
      relationType: "MITIGATES",
      reverse: true,
    };
  }
  return {
    relationType: relation,
    reverse: false,
  };
}

export function validatePathTemplate(template: PathTemplate): void {
  if (!template.id || !/^[a-z0-9_]+_v[0-9]+$/.test(template.id)) {
    throw new Error(
      `Template validation failed: template id "${template.id}" must match <name>_v<number>`,
    );
  }
  if (!Array.isArray(template.startNodeTypes) || template.startNodeTypes.length === 0) {
    throw new Error(
      `Template validation failed: startNodeTypes must not be empty (${template.id})`,
    );
  }
  for (const nodeType of template.startNodeTypes) {
    assertNodeType(nodeType);
  }
  if (template.startAtomTypes && !template.startNodeTypes.includes("MemoryAtom")) {
    throw new Error(
      `Template validation failed: startAtomTypes requires MemoryAtom in startNodeTypes (${template.id})`,
    );
  }
  if (template.startAtomTypes && template.startAtomTypes.length === 0) {
    throw new Error(
      `Template validation failed: startAtomTypes must not be empty when present (${template.id})`,
    );
  }
  for (const step of template.steps) {
    assertRelation(step.relation);
    if (!Array.isArray(step.nextNodeTypes) || step.nextNodeTypes.length === 0) {
      throw new Error(
        `Template validation failed: nextNodeTypes must not be empty (${template.id})`,
      );
    }
    for (const nodeType of step.nextNodeTypes) {
      assertNodeType(nodeType);
    }
    if (step.nextAtomTypes && !step.nextNodeTypes.includes("MemoryAtom")) {
      throw new Error(
        `Template validation failed: nextAtomTypes requires MemoryAtom in nextNodeTypes (${template.id})`,
      );
    }
    if (step.nextAtomTypes && step.nextAtomTypes.length === 0) {
      throw new Error(
        `Template validation failed: nextAtomTypes must not be empty when present (${template.id})`,
      );
    }
  }
}

export const DEBUG_TEMPLATE: PathTemplate = {
  id: "debug_v1",
  startNodeTypes: ["MemoryAtom"],
  startAtomTypes: ["failure_pattern", "anti_pattern"],
  steps: [
    {
      relation: "mitigates_inverse",
      nextNodeTypes: ["MemoryAtom"],
      nextAtomTypes: ["strategy", "heuristic"],
    },
    {
      relation: "CONSTRAINED_BY",
      nextNodeTypes: ["MemoryAtom"],
      nextAtomTypes: ["constraint"],
      optional: true,
    },
  ],
};

export const GENERIC_TEMPLATE: PathTemplate = {
  id: "generic_v1",
  startNodeTypes: ["MemoryAtom"],
  steps: [],
};

const DEFAULT_TASK_TEMPLATE_BINDINGS: Record<string, string[]> = {
  debugging: [DEBUG_TEMPLATE.id],
  planning: [GENERIC_TEMPLATE.id],
  research: [GENERIC_TEMPLATE.id],
  negotiation: [GENERIC_TEMPLATE.id],
  writing: [GENERIC_TEMPLATE.id],
  support: [GENERIC_TEMPLATE.id],
  operations: [GENERIC_TEMPLATE.id],
};

export class TemplateRegistry {
  private readonly templateById = new Map<string, PathTemplate>();
  private readonly bindingsByTask = new Map<string, string[]>();
  private readonly defaultTemplateId: string;

  constructor(config: TemplateRegistryConfig) {
    for (const template of config.templates) {
      if (this.templateById.has(template.id)) {
        throw new Error(
          `Template registry validation failed: duplicated template id "${template.id}"`,
        );
      }
      validatePathTemplate(template);
      this.templateById.set(template.id, template);
    }

    if (!this.templateById.has(config.defaultTemplateId)) {
      throw new Error(
        `Template registry validation failed: default template "${config.defaultTemplateId}" is not registered`,
      );
    }
    this.defaultTemplateId = config.defaultTemplateId;

    for (const [taskType, templateIds] of Object.entries(config.taskBindings)) {
      this.bindTaskTemplates(taskType as TaskType, templateIds);
    }
    for (const taskType of KNOWN_TASK_TYPES) {
      if (!this.bindingsByTask.has(taskType)) {
        this.bindingsByTask.set(taskType, [this.defaultTemplateId]);
      }
    }
  }

  bindTaskTemplates(taskType: TaskType, templateIds: string[]): void {
    if (!Array.isArray(templateIds) || templateIds.length === 0) {
      throw new Error(
        `Template registry validation failed: task "${taskType}" has no template binding`,
      );
    }
    const deduped = [...new Set(templateIds)];
    for (const templateId of deduped) {
      if (!this.templateById.has(templateId)) {
        throw new Error(
          `Template registry validation failed: task "${taskType}" references unknown template "${templateId}"`,
        );
      }
    }
    this.bindingsByTask.set(taskType, deduped);
  }

  getTemplate(templateId: string): PathTemplate {
    const template = this.templateById.get(templateId);
    if (!template) {
      throw new Error(`Template registry lookup failed: unknown template "${templateId}"`);
    }
    return template;
  }

  select(taskType: TaskType): PathTemplate {
    const binding = this.bindingsByTask.get(taskType) ?? [this.defaultTemplateId];
    return this.getTemplate(binding[0]!);
  }

  listTaskBindings(taskType: TaskType): string[] {
    return [...(this.bindingsByTask.get(taskType) ?? [this.defaultTemplateId])];
  }

  listTemplates(): PathTemplate[] {
    return [...this.templateById.values()];
  }
}

export function createDefaultTemplateRegistry(): TemplateRegistry {
  return new TemplateRegistry({
    templates: [DEBUG_TEMPLATE, GENERIC_TEMPLATE],
    taskBindings: DEFAULT_TASK_TEMPLATE_BINDINGS,
    defaultTemplateId: GENERIC_TEMPLATE.id,
  });
}

export const DEFAULT_TEMPLATE_REGISTRY = createDefaultTemplateRegistry();

export function selectPathTemplate(
  taskType: TaskType,
  registry: TemplateRegistry = DEFAULT_TEMPLATE_REGISTRY,
): PathTemplate {
  return registry.select(taskType);
}
