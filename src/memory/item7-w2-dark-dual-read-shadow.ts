import {
  compareItem7W1DualRead,
  isItem7W1DarkDualReadEnabled,
  type Item7W1DualReadResult,
} from "./item7-w1-dark-tombstone.js";

export const ITEM7_W2_SITES = Object.freeze([
  "S02-get-reply",
  "S03-agent",
  "S04-status-all-agents",
  "S05-checkpoint-store-host",
  "S06-checkpoint-store-steward",
  "S07-checkpoint-store-client",
  "S08-auto-capture-deliverable",
  "S09-knowledge-doc-preview",
  "S14-agents-list-trusted",
  "S15-agents-list-legacy",
  "S10-agents-files-trusted",
  "S11-agents-files-legacy",
  "S12-agents-create-avatar",
  "S13-agents-delete",
  "S16-chat-mention-workspace",
  "S18-skills-status-workspace",
  "S19-skills-install-workspace",
  "S20-tools-catalog-workspace",
  "S29-trusted-agent-locator",
] as const);

export type Item7W2SiteId = (typeof ITEM7_W2_SITES)[number];

/** @deprecated use ITEM7_W2_SITES */
export const ITEM7_W2_BATCH1_SITES = Object.freeze(["S02-get-reply"] as const);

export type Item7W2DarkDualReadShadowInput = {
  siteId: Item7W2SiteId;
  legacyLocator: string | null;
  /** Shadow locator from authorized resolver path; not a production write switch. */
  replacementLocator: string | null;
  env?: NodeJS.ProcessEnv;
};

export type Item7W2DarkDualReadShadowResult = Item7W1DualReadResult & {
  siteId: Item7W2SiteId;
  enabled: true;
};

export function runItem7W2DarkDualReadShadow(
  input: Item7W2DarkDualReadShadowInput,
): Item7W2DarkDualReadShadowResult | null {
  const env = input.env ?? process.env;
  if (!isItem7W1DarkDualReadEnabled(env)) {
    return null;
  }
  const dualRead = compareItem7W1DualRead({
    legacyLocator: input.legacyLocator,
    replacementResourceId: input.replacementLocator,
  });
  return {
    siteId: input.siteId,
    enabled: true,
    ...dualRead,
  };
}

export function scheduleItem7W2DarkDualReadShadow(input: Item7W2DarkDualReadShadowInput): void {
  runItem7W2DarkDualReadShadow(input);
}

export async function runItem7W2DarkDualReadShadowIfEnabled(
  input: Item7W2DarkDualReadShadowInput,
): Promise<Item7W2DarkDualReadShadowResult | null> {
  return runItem7W2DarkDualReadShadow(input);
}
