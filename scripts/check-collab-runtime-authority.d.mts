export const DISPATCH_ROOT: string;
export const HARD_RULE_WHITELIST: Set<string>;
export function listRuntimeGlobMatches(basenames: string[]): string[];
export function isHardRuleTarget(relPath: string): boolean;
export function findCollabRuntimeAuthorityViolations(
  content: string,
  fileName?: string,
): Array<{ line: number; rule: string; detail: string }>;
export function countLegacyReadsAccesses(content: string, fileName?: string): number;
export function collectCollabRuntimeAuthorityViolations(repoRoot: string): Promise<{
  files: number;
  hardTargets: string[];
  legacyReadsTotal: number;
  violations: Array<{ path: string; line: number; rule: string; detail: string }>;
}>;
export function main(): Promise<void>;
