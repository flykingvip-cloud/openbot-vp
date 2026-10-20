/**
 * Conformance scaffold. Re-exports the shadow evaluator and the P8a
 * path-gap report from `@openbot/constitutional-contracts`.
 * Not an independent deployable. Does not select a Path or enforce.
 */

export {
  CONFORMANCE_SCAFFOLD_BOUNDARY,
  CONSTITUTIONAL_CONFORMANCE_PRODUCT,
  PHASE_D_PRODUCT_SPLIT_SCOPE,
} from "./boundary.js";
export {
  LEGAL_CONSTITUTIONAL_PATHS,
  NO_VALID_PATH,
  PATH_GAP_CODES,
  PATH_GAP_REPORT_ENV,
  PHASE_D_P8A_SCOPE,
  evaluateShadowConformance,
  isPathGapReportEnabled,
  isValidConstitutionalPath,
  reportPathGap,
  samplePathGapInput,
  type PathGapCode,
  type PathGapReport,
  type PathGapReportOptions,
  type PathSelectionInput,
  type ShadowConformanceReport,
  type ShadowEvaluateOptions,
  type ShadowFinding,
} from "@openbot/constitutional-contracts";
