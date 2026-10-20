export type TemplateVariable = {
  name: string;
  type: "string";
  required: boolean;
};

const TEMPLATE_VARIABLE_RE = /\{\{\s*([^}]+?)\s*\}\}/g;

function normalizeVariableName(raw: string): string {
  return raw
    .replace(/\s+/g, " ")
    .replace(/^[/|]+|[/|]+$/g, "")
    .trim()
    .slice(0, 80);
}

/** Extract `{{variable}}` slots from template bodies (phase-1 regex only). */
export function extractTemplateVariables(text: string): TemplateVariable[] {
  const variables: TemplateVariable[] = [];
  const seen = new Set<string>();
  TEMPLATE_VARIABLE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TEMPLATE_VARIABLE_RE.exec(text))) {
    const name = normalizeVariableName(match[1] ?? "");
    if (!name || seen.has(name)) {
      continue;
    }
    seen.add(name);
    variables.push({
      name,
      type: "string",
      required: true,
    });
  }
  return variables;
}

/** Replace `{{variable}}` slots with preview values; unfilled slots stay as placeholders. */
export function applyTemplateVariableValues(
  template: string,
  values: Record<string, string>,
): string {
  TEMPLATE_VARIABLE_RE.lastIndex = 0;
  return template.replace(TEMPLATE_VARIABLE_RE, (match, raw: string) => {
    const name = normalizeVariableName(raw);
    const value = values[name]?.trim();
    return value ? value : match;
  });
}

/** Required variables with no preview value yet. */
export function listMissingTemplateVariables(
  variables: TemplateVariable[],
  values: Record<string, string>,
): string[] {
  return variables
    .filter((variable) => variable.required && !values[variable.name]?.trim())
    .map((variable) => variable.name);
}
