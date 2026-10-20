/**
 * Agent Growth OS — 内置模板注册表（spec: agent-growth-lifecycle, P0A 任务 1.3）。
 *
 * 运行时源为下方 TS 常量（bundler-safe）；`generic_worker.json` 为同源 catalog seed，
 * 由 `templates.test.ts` 断言二者一致，防止漂移。P1 行业模板可追加常量或对接租户 catalog。
 */

import type { AgentTemplate } from "../types.js";

export const DEFAULT_TEMPLATE_ID = "generic_worker" as const;

/** 默认降级模板：无行业 required 能力，未指定模板时绑定。 */
export const GENERIC_WORKER_TEMPLATE: AgentTemplate = {
  templateId: "generic_worker",
  version: "1.0.0",
  displayName: "通用助手",
  roleBlueprint: "通用数字员工，可承接基础任务；无行业 required 能力，作为未指定模板时的降级蓝图。",
  dimensionWeights: {
    identity: 25,
    capability: 25,
    knowledge: 25,
    habits: 25,
  },
  requiredCapabilities: [],
  missionReadyThreshold: 78,
  minIdentity: 60,
};

/** 行业模板：合同审查（P1/P2 扩展，验证 R3.5 无需改 GrowthStatus schema）。 */
export const CONTRACT_REVIEWER_TEMPLATE: AgentTemplate = {
  templateId: "contract_reviewer",
  version: "1.0.0",
  displayName: "合同审查机器人",
  roleBlueprint: "面向法务团队的合同审查助手，需具备合同知识库、审批系统接入与合同库授权。",
  dimensionWeights: { identity: 25, capability: 25, knowledge: 25, habits: 25 },
  requiredCapabilities: [
    { key: "contract_review", kind: "skill", label: "合同审查技能", required: true },
    { key: "contract_kb", kind: "knowledge_binding", label: "合同知识库", required: true },
    { key: "approval_system", kind: "oauth", label: "审批系统授权", required: true },
  ],
  knowledgeExpectations: { minBindings: 1, preferredTags: ["contract", "legal", "compliance"] },
  missionReadyThreshold: 78,
  minIdentity: 60,
};

/** 行业模板：销售助理。 */
export const SALES_ASSISTANT_TEMPLATE: AgentTemplate = {
  templateId: "sales_assistant",
  version: "1.0.0",
  displayName: "销售助理机器人",
  roleBlueprint: "面向销售团队的助理，需具备 CRM 技能与 CRM 系统授权以跟进客户。",
  dimensionWeights: { identity: 25, capability: 25, knowledge: 25, habits: 25 },
  requiredCapabilities: [
    { key: "crm", kind: "skill", label: "CRM 技能", required: true },
    { key: "crm_oauth", kind: "oauth", label: "CRM 系统授权", required: true },
  ],
  knowledgeExpectations: { minBindings: 1, preferredTags: ["sales", "crm", "customer"] },
  missionReadyThreshold: 78,
  minIdentity: 60,
};

/** 行业模板：个人邮件助手。 */
export const PERSONAL_MAIL_ASSISTANT_TEMPLATE: AgentTemplate = {
  templateId: "personal_mail_assistant",
  version: "1.0.0",
  displayName: "邮件助手",
  roleBlueprint: "专责个人邮箱收发与检索的助手；绑定邮箱后默认授权，可代用户发信、查信、回信。",
  dimensionWeights: { identity: 20, capability: 35, knowledge: 15, habits: 30 },
  requiredCapabilities: [
    { key: "personal_email", kind: "oauth", label: "个人邮箱授权", required: true },
  ],
  missionReadyThreshold: 70,
  minIdentity: 50,
};

const BUILTIN_TEMPLATES: Record<string, AgentTemplate> = {
  [GENERIC_WORKER_TEMPLATE.templateId]: GENERIC_WORKER_TEMPLATE,
  [CONTRACT_REVIEWER_TEMPLATE.templateId]: CONTRACT_REVIEWER_TEMPLATE,
  [SALES_ASSISTANT_TEMPLATE.templateId]: SALES_ASSISTANT_TEMPLATE,
  [PERSONAL_MAIL_ASSISTANT_TEMPLATE.templateId]: PERSONAL_MAIL_ASSISTANT_TEMPLATE,
};

/** 返回内置模板列表（P0A 至少含 generic_worker）。 */
export function listBuiltinTemplates(): AgentTemplate[] {
  return Object.values(BUILTIN_TEMPLATES);
}

/** 按 id 取模板；未知 id 返回 undefined（调用方决定是否降级 generic_worker）。 */
export function getTemplate(templateId: string | null | undefined): AgentTemplate | undefined {
  if (!templateId) {
    return undefined;
  }
  return BUILTIN_TEMPLATES[templateId];
}

/** 取模板，未命中则降级到 generic_worker（Capability Readiness 永远可计算）。 */
export function resolveTemplateOrDefault(templateId: string | null | undefined): AgentTemplate {
  return getTemplate(templateId) ?? GENERIC_WORKER_TEMPLATE;
}
