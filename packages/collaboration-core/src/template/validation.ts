import type { GroupTemplate } from "../types/template.js";

export function validateGroupTemplate(template: GroupTemplate): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!template.templateId) {
    errors.push("templateId is required");
  }
  if (!template.name) {
    errors.push("name is required");
  }
  if (!template.sourceGroupId) {
    errors.push("sourceGroupId is required");
  }
  if (!template.groupType) {
    errors.push("groupType is required");
  }

  if (!Array.isArray(template.memberRoles)) {
    errors.push("memberRoles must be an array");
  } else {
    for (const [index, role] of template.memberRoles.entries()) {
      if (!role) {
        errors.push(`memberRoles[${index}] is null or undefined`);
        continue;
      }
      if (!role.memberType) {
        errors.push(`memberRoles[${index}].memberType is required`);
      }
      if (role.memberType && !["human", "bot", "system_delegate"].includes(role.memberType)) {
        errors.push(`memberRoles[${index}].memberType must be one of: human, bot, system_delegate`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function compareGroupTemplates(params: {
  template1: GroupTemplate;
  template2: GroupTemplate;
}): { same: boolean; differences: string[] } {
  const { template1, template2 } = params;
  const differences: string[] = [];

  if (template1.groupType !== template2.groupType) {
    differences.push(`groupType: ${template1.groupType} vs ${template2.groupType}`);
  }
  if (template1.collaborationMode !== template2.collaborationMode) {
    differences.push(
      `collaborationMode: ${template1.collaborationMode} vs ${template2.collaborationMode}`,
    );
  }
  if (
    JSON.stringify(template1.finalDecisionPolicy) !== JSON.stringify(template2.finalDecisionPolicy)
  ) {
    differences.push("finalDecisionPolicy: different");
  }
  if (template1.memberRoles.length !== template2.memberRoles.length) {
    differences.push(
      `memberRoles count: ${template1.memberRoles.length} vs ${template2.memberRoles.length}`,
    );
  }

  return {
    same: differences.length === 0,
    differences,
  };
}
