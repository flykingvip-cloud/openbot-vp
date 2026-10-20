import { describe, expect, it } from "vitest";
import type { PathTemplate } from "../index.js";
import {
  createDefaultTemplateRegistry,
  DEFAULT_TEMPLATE_REGISTRY,
  DEBUG_TEMPLATE,
  GENERIC_TEMPLATE,
  resolveTemplateRelation,
  selectPathTemplate,
  TemplateRegistry,
  validatePathTemplate,
} from "./templates.js";

describe("runtime templates", () => {
  it("resolves mitigates_inverse as reverse MITIGATES", () => {
    const relation = resolveTemplateRelation("mitigates_inverse");
    expect(relation.relationType).toBe("MITIGATES");
    expect(relation.reverse).toBe(true);
  });

  it("selects debug template for debugging task type", () => {
    const template = selectPathTemplate("debugging");
    expect(template.id).toBe("debug_v1");
  });

  it("falls back to default template for unknown task type", () => {
    const template = selectPathTemplate("my_custom_task_type");
    expect(template.id).toBe("generic_v1");
  });

  it("validates debug template dsl", () => {
    expect(() => validatePathTemplate(DEBUG_TEMPLATE)).not.toThrow();
  });

  it("rejects invalid template id format", () => {
    expect(() =>
      validatePathTemplate({
        id: "DebugTemplate",
        startNodeTypes: ["MemoryAtom"],
        steps: [],
      }),
    ).toThrow(/template id/i);
  });

  it("rejects nextAtomTypes without MemoryAtom next node", () => {
    expect(() =>
      validatePathTemplate({
        id: "invalid_atom_filter_v1",
        startNodeTypes: ["MemoryAtom"],
        steps: [
          {
            relation: "APPLIES_TO",
            nextNodeTypes: ["Scenario"],
            nextAtomTypes: ["strategy"],
          },
        ],
      }),
    ).toThrow(/nextAtomTypes requires MemoryAtom/i);
  });

  it("validates default registry", () => {
    const registry = createDefaultTemplateRegistry();
    expect(registry.select("debugging").id).toBe("debug_v1");
    expect(registry.select("planning").id).toBe("generic_v1");
  });

  it("rejects unknown template binding in registry", () => {
    expect(
      () =>
        new TemplateRegistry({
          templates: [DEBUG_TEMPLATE, GENERIC_TEMPLATE],
          taskBindings: {
            debugging: ["debug_v1"],
            planning: ["missing_template_v1"],
          },
          defaultTemplateId: "generic_v1",
        }),
    ).toThrow(/unknown template/i);
  });

  it("supports custom registry selection order", () => {
    const customTemplate: PathTemplate = {
      ...GENERIC_TEMPLATE,
      id: "support_v2",
      steps: [
        {
          relation: "SUPPORTED_BY" as const,
          nextNodeTypes: ["MemoryAtom"],
          nextAtomTypes: ["preference"],
        },
      ],
    };
    const registry = new TemplateRegistry({
      templates: [DEBUG_TEMPLATE, GENERIC_TEMPLATE, customTemplate],
      taskBindings: {
        debugging: ["debug_v1"],
        planning: ["generic_v1"],
        research: ["generic_v1"],
        negotiation: ["generic_v1"],
        writing: ["generic_v1"],
        support: ["support_v2", "generic_v1"],
        operations: ["generic_v1"],
      },
      defaultTemplateId: "generic_v1",
    });
    expect(registry.listTaskBindings("support")).toEqual(["support_v2", "generic_v1"]);
    expect(selectPathTemplate("support", registry).id).toBe("support_v2");
    expect(DEFAULT_TEMPLATE_REGISTRY.select("support").id).toBe("generic_v1");
  });
});
