import {
  closeQuickSave,
  createInitialQuickCapabilitySaveState,
  openQuickSave,
  submitQuickSave,
  updateQuickSaveForm,
  type QuickCapabilitySaveState,
} from "../../controllers/quick-capability-save.ts";

export const quickCapabilitySaveCapability = {
  createInitialState: createInitialQuickCapabilitySaveState,
  open: openQuickSave,
  close: closeQuickSave,
  updateForm: updateQuickSaveForm,
  submit: submitQuickSave,
} as const;

export type { QuickCapabilitySaveState };
