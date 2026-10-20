export type PolicyLane = "participation" | "dispatch" | "governance" | "context" | "presentation";
export type PolicyConsumptionFinding = {
  line: number;
  rule: string;
  detail: string;
  lane: PolicyLane | null;
  bp: string;
};
export type PolicyConsumptionAllowEntry = {
  file: string;
  rule: string;
  detail: string;
  bp?: string;
  count: number;
};
export type PolicyConsumptionAllowlist = Record<string, readonly PolicyConsumptionAllowEntry[]>;
export const LANES: readonly PolicyLane[];
export const DISPATCH_ROOT: string;
export const EXTRA_CONSUMER_FILES: readonly string[];
export const COMPOSITION_ROOT_FILES: Set<string>;
export const COMPOSITION_ROOT_FUNCTIONS: Set<string>;
export const LEGACY_READS_FIELD_LANE: Readonly<Record<string, PolicyLane>>;
export const RAW_POLICY_FIELD_LANE: Readonly<Record<string, PolicyLane>>;
export const POLICY_CONSUMPTION_ALLOWLIST: Readonly<
  Record<PolicyLane, readonly PolicyConsumptionAllowEntry[]>
>;
export function isConsumerFile(relPath: string): boolean;
export function findPolicyConsumptionFindings(
  content: string,
  fileName?: string,
): PolicyConsumptionFinding[];
export function evaluatePolicyConsumption(
  findings: Array<PolicyConsumptionFinding & { file: string }>,
  allowlist?: PolicyConsumptionAllowlist,
): { errors: string[]; laneCounts: Record<PolicyLane, number> };
export function collectPolicyConsumptionFindings(repoRoot: string): Promise<{
  scanned: number;
  findings: Array<PolicyConsumptionFinding & { file: string }>;
}>;
export function main(argv?: string[]): Promise<void>;
