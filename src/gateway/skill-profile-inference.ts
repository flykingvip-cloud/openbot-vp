import { extractTemplateVariables, type TemplateVariable } from "../shared/template-variables.js";

export type { TemplateVariable };
export { extractTemplateVariables };

export function syncTemplateVariablesForProfile(params: {
  assetType: string;
  body: string;
  existing?: TemplateVariable[];
}): TemplateVariable[] {
  if (params.assetType !== "template" && !/\{\{/.test(params.body)) {
    return params.existing ?? [];
  }
  const extracted = extractTemplateVariables(params.body);
  return extracted.length > 0 ? extracted : (params.existing ?? []);
}
