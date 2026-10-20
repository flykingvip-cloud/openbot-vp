/**
 * Registry product-boundary marker.
 * Written scope: `phase_d_product_split_scaffold`.
 * Constants only. This module does not read env, merge ledgers, or execute.
 */

export const PHASE_D_PRODUCT_SPLIT_SCOPE = "phase_d_product_split_scaffold" as const;

export const CONSTITUTIONAL_REGISTRY_PRODUCT = "registry" as const;

export const REGISTRY_SCAFFOLD_BOUNDARY = {
  scope: PHASE_D_PRODUCT_SPLIT_SCOPE,
  product: CONSTITUTIONAL_REGISTRY_PRODUCT,
  scaffoldOnly: true,
  independentlyDeployable: false,
  deployBoundaryProven: false,
  ownershipProven: false,
  lifecycleProven: false,
  physicalLedgerMerge: false,
  profileMerge: false,
  pluginInstalledEqualsAuthorized: false,
  receiptEqualsProof: false,
  phaseCClaimedGo: false,
  enforce: false,
  liveInvoke: false,
  fabricDefaultOn: false,
  selectsPath: false,
} as const;
