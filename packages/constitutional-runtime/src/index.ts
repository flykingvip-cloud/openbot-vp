/**
 * Runtime scaffold. Re-exports the default-off runtime façade shadow from
 * `@openbot/constitutional-contracts`. Not a fifth execution story and not
 * an independent deployable. Enforce stays off.
 */

export {
  CONSTITUTIONAL_RUNTIME_PRODUCT,
  PHASE_D_PRODUCT_SPLIT_SCOPE,
  RUNTIME_SCAFFOLD_BOUNDARY,
} from "./boundary.js";
export {
  CONSTITUTIONAL_CONTRACTS_ENFORCE,
  CONSTITUTIONAL_CONTRACTS_FABRIC_DEFAULT_ON,
  CONSTITUTIONAL_CONTRACTS_LIVE_INVOKE,
  PHASE_D_RUNTIME_FACADE_SCOPE,
  runRuntimeFacadeShadow,
  type RuntimeFacadeShadowInput,
  type RuntimeFacadeShadowOptions,
  type RuntimeFacadeShadowResult,
} from "@openbot/constitutional-contracts";
