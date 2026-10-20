import "../../styles/platform-agents-runtime.css";
import "../../styles/platform-productization.css";
import "../../styles/platform-key-accounts.css";
import "../../styles/platform-pricing-comparison.css";
import "../../styles/cost-budget.css";
import "../../styles/cost-budget-v2.css";

export { adaptPlatformPortActionState } from "../ports/platform/action-state.ts";
export { adaptPlatformPortState } from "../ports/platform/port-state.ts";
export { createPlatformPortActions } from "../ports/platform/render-actions.ts";
export { buildPlatformPortRenderModel } from "../ports/platform/render-model.ts";
export { renderPlatformPortShell } from "../ports/platform/views/platform-shell.ts";
