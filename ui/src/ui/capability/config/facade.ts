import {
  applyConfig,
  applyConfigSchema,
  applyConfigSnapshot,
  ensureAgentConfigEntry,
  findAgentConfigEntryIndex,
  loadConfig,
  loadConfigSchema,
  removeConfigFormValue,
  runUpdate,
  saveConfig,
  type ConfigApplyState,
  type ConfigFormState,
  type ConfigLoadState,
  type ConfigSchemaLoadState,
  type ConfigSaveState,
  type ConfigUpdateState,
  updateConfigFormValue,
} from "../../controllers/config.ts";

export type ConfigCapabilityLoadState = ConfigLoadState;
export type ConfigCapabilitySchemaState = ConfigSchemaLoadState;
export type ConfigCapabilityFormState = ConfigFormState;
export type ConfigCapabilitySaveState = ConfigSaveState;
export type ConfigCapabilityApplyState = ConfigApplyState;
export type ConfigCapabilityUpdateState = ConfigUpdateState;

/**
 * Transitional capability seam for config operations.
 *
 * This currently delegates to the existing config controller so new code can
 * depend on a stable capability import path before the controller internals are
 * moved behind a dedicated capability implementation.
 */
export const configCapability = {
  apply: applyConfig,
  applySchema: applyConfigSchema,
  applySnapshot: applyConfigSnapshot,
  ensureAgentEntry: ensureAgentConfigEntry,
  findAgentEntryIndex: findAgentConfigEntryIndex,
  load: loadConfig,
  loadSchema: loadConfigSchema,
  removeFormValue: removeConfigFormValue,
  runUpdate,
  save: saveConfig,
  updateFormValue: updateConfigFormValue,
} as const;
