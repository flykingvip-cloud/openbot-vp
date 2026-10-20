/**
 * Registry of gateway method packs — append new packs here only.
 */

import { DIAGNOSIS_REPORT_API_DEPLOYED } from "../../../diagnosis/report-query-deploy.js";
import { artifactGrantPack } from "../artifact-grant.pack.js";
import { chatCheckpointsPack } from "../chat-checkpoints.pack.js";
import { daibaiPack } from "../daibai.pack.js";
import { dataGovernancePack } from "../data-governance.pack.js";
import { deliveryLanePack } from "../delivery-lane.pack.js";
import { diagnosisApprovalPack } from "../diagnosis-approval.pack.js";
import { diagnosisIssueQueuePack } from "../diagnosis-issue-queue.pack.js";
import { diagnosisReportsPack } from "../diagnosis-reports.pack.js";
import { digitalEmployeePack } from "../digital-employee.pack.js";
import { employeePushPack } from "../employee-push.pack.js";
import { enterpriseDiagnosisApprovalPack } from "../enterprise-diagnosis-approval.pack.js";
import { enterpriseSecurityControlsPack } from "../enterprise-security-controls.pack.js";
import { evolutionControlPack } from "../evolution-control.pack.js";
import { evolutionDelegationPack } from "../evolution-delegation.pack.js";
import { evolutionPerceptionPack } from "../evolution-perception.pack.js";
import { fabricPack } from "../fabric.pack.js";
import { groupSharedDocPack } from "../group-shared-doc.pack.js";
import { groupWorkspaceFilePack } from "../group-workspace-file.pack.js";
import type { GatewayMethodPack } from "../pack-types.js";
import { stewardWorkspaceFilePack } from "../steward-workspace-file.pack.js";
import { supervisorPack } from "../supervisor.pack.js";
import { supportCasesPack } from "../support-cases.pack.js";
import { taskContextPack } from "../task-context.pack.js";
import { GATEWAY_METHOD_PACK_MANIFEST, PACK_OWNED_METHOD_NAMES } from "./manifest.js";

export { GATEWAY_METHOD_PACK_MANIFEST, PACK_OWNED_METHOD_NAMES };

/** Full packs (handlers included) for execution wiring. */
export const GATEWAY_METHOD_PACKS: readonly GatewayMethodPack[] = [
  artifactGrantPack,
  chatCheckpointsPack,
  stewardWorkspaceFilePack,
  groupWorkspaceFilePack,
  groupSharedDocPack,
  supervisorPack,
  deliveryLanePack,
  fabricPack,
  digitalEmployeePack,
  employeePushPack,
  daibaiPack,
  supportCasesPack,
  taskContextPack,
  dataGovernancePack,
  evolutionControlPack,
  evolutionDelegationPack,
  evolutionPerceptionPack,
  ...(DIAGNOSIS_REPORT_API_DEPLOYED ? [diagnosisReportsPack, diagnosisIssueQueuePack] : []),
  enterpriseDiagnosisApprovalPack,
  enterpriseSecurityControlsPack,
  diagnosisApprovalPack,
];
