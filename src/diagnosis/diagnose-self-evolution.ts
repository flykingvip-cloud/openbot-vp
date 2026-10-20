/**
 * Diagnose self-evolution prescriptions.
 * diagnose() stays READ_ONLY. Cron is written only by diagnosis.self-evolution.confirm
 * after a stored prescription is loaded. Tick sets confirmable=false.
 */
export {
  DIAGNOSIS_EVOLUTION_NAME_PREFIX,
  DIAGNOSE_EVOLUTION_PURPOSES,
  SCHEDULE_DIAGNOSIS_PRESCRIPTION_ACTION,
  buildDiagnoseEvolutionPrescriptions,
  confirmDiagnoseEvolutionPrescription,
  diagnosisEvolutionJobName,
  evolutionJobCreate,
  readEvolutionPrescription,
  recoverEvolutionPrescriptionAfterCron,
  registerDiagnoseEvolutionCron,
  prescriptionGrantViewFromAuthorization,
  registerDiagnosePrescriptionGrantInspector,
  saveEvolutionPrescription,
} from "./diagnose-evolution-prescription.js";
export type {
  ConfirmResult,
  DiagnoseEvolutionPrescription,
  DiagnoseEvolutionPurpose,
  EvolutionCronPort,
  EvolutionPrescription,
  PrescriptionGrantInspector,
  PrescriptionGrantView,
} from "./diagnose-evolution-prescription.js";
export { evolutionPrescriptionId as diagnoseEvolutionPrescriptionId } from "./diagnose-professional-protocol.js";
