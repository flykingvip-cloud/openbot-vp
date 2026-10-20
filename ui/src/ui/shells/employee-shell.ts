import "../../styles/workbench.css";

export { buildEmployeeWorkbenchProps } from "../ports/employee/render-model.ts";
export {
  openEmployeeCronTaskDetail,
  switchEmployeeWorkbenchSession,
} from "../ports/employee/render-actions.ts";
export { renderWorkbenchGrowthThreadPrelude } from "../ports/employee/growth-prelude-wire.ts";
export {
  renderDaibaiThreadPrelude,
  renderMeetingConfirmationCard,
} from "../ports/employee/views/workbench-stage-assistant.ts";
export { renderWorkbench as renderEmployeeWorkbench } from "../ports/employee/views/workbench.ts";
