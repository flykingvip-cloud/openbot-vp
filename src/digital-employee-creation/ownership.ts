import type { DesignerDeniedCatalog, DesignerReadCatalog } from "./types.js";

export const DESIGNER_READ_ALLOWLIST: readonly DesignerReadCatalog[] = [
  "role_registry",
  "blueprint_registry",
  "recipe_registry",
  "skill_registry",
  "policy_schema",
  "product_capability_catalog",
  "creation_request_text",
];

export const DESIGNER_READ_DENYLIST: readonly DesignerDeniedCatalog[] = [
  "crm_customer_data",
  "enterprise_memory",
  "private_documents",
  "conversation_history",
  "account_tokens",
  "sensitive_datasets",
];

export const DESIGNER_FORBIDDEN_WRITES = [
  "agents.create",
  "workspaces.create",
  "robots.bind-workspace",
  "installSkillKeysOntoRobot",
  "oauth.connect",
  "grantPermission",
  "bindExternalAccount",
  "conversationTask.create",
  "cron.create",
  "ledger.append",
] as const;

export const FACTORY_ONLY_WRITES = [
  "workspaces.create",
  "agents.create",
  "robots.bind-workspace",
  "installSkillKeysOntoRobot",
] as const;

export function isDesignerReadAllowed(catalog: string): boolean {
  return (DESIGNER_READ_ALLOWLIST as readonly string[]).includes(catalog);
}

export function isDesignerWriteForbidden(write: string): boolean {
  return (DESIGNER_FORBIDDEN_WRITES as readonly string[]).includes(write);
}

export type SideEffectProbe = {
  agentCreated: boolean;
  workspaceCreated: boolean;
  accountBound: boolean;
  permissionGranted: boolean;
  skillInstalled: boolean;
  cronCreated: boolean;
  taskCreated: boolean;
  missionCreated: boolean;
  ledgerWritten: boolean;
  externalApiCalled: boolean;
};

export function emptySideEffects(): SideEffectProbe {
  return {
    agentCreated: false,
    workspaceCreated: false,
    accountBound: false,
    permissionGranted: false,
    skillInstalled: false,
    cronCreated: false,
    taskCreated: false,
    missionCreated: false,
    ledgerWritten: false,
    externalApiCalled: false,
  };
}

export function hasAnySideEffect(probe: SideEffectProbe): boolean {
  return Object.values(probe).some(Boolean);
}
