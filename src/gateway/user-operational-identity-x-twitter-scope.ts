/**
 * X (x-twitter) OAuth scope → operational action gating.
 * Identity/read: users.read + tweet.read (+ offline.access)
 * Publish: also requires tweet.write for publish_post / reply_comment
 */

export const X_TWITTER_PUBLISH_ACTIONS = ["publish_post", "reply_comment"] as const;
export const X_TWITTER_READ_ACTIONS = ["sync_profile_metrics"] as const;

const PUBLISH_ACTION_SET = new Set<string>(X_TWITTER_PUBLISH_ACTIONS);

export function parseUserOperationalIdentityOAuthScopeList(
  scope: string | null | undefined,
): Set<string> {
  if (!scope?.trim()) {
    return new Set();
  }
  return new Set(
    scope
      .split(/[\s,]+/)
      .map((part) => part.trim())
      .filter(Boolean),
  );
}

export function xTwitterScopeGrantsPublish(scope: string | null | undefined): boolean {
  return parseUserOperationalIdentityOAuthScopeList(scope).has("tweet.write");
}

/**
 * Filter catalog/grant actions for x-twitter by granted OAuth scope.
 * - Missing scope + allowAllIfScopeMissing: keep all (simulated / legacy).
 * - Otherwise: publish actions require tweet.write; read/sync stay.
 */
export function filterXTwitterOperationalActionsByGrantedScope(params: {
  actions: string[];
  scope?: string | null;
  allowAllIfScopeMissing?: boolean;
}): string[] {
  const normalized = params.actions.map((action) => action.trim()).filter(Boolean);
  const scopeMissing = !params.scope?.trim();
  if (scopeMissing && params.allowAllIfScopeMissing) {
    return [...normalized];
  }
  const canPublish = xTwitterScopeGrantsPublish(params.scope);
  return normalized.filter((action) => {
    if (PUBLISH_ACTION_SET.has(action)) {
      return canPublish;
    }
    return true;
  });
}

export function isXTwitterOperationalActionAllowedByScope(params: {
  action: string;
  scope?: string | null;
  allowAllIfScopeMissing?: boolean;
}): boolean {
  const action = params.action.trim();
  if (!action) {
    return false;
  }
  return filterXTwitterOperationalActionsByGrantedScope({
    actions: [action],
    scope: params.scope,
    allowAllIfScopeMissing: params.allowAllIfScopeMissing,
  }).includes(action);
}
