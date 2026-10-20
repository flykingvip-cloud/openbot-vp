import { applyAgentBindings } from "../../commands/agents.bindings.js";
import { loadConfig, writeConfigFile } from "../../config/config.js";
import { DEFAULT_ACCOUNT_ID } from "../../routing/session-key.js";
import {
  registerUserOperationalIdentity,
  upsertUserOperationalIdentityGrant,
} from "../user-operational-identity-store.js";
import type {
  UserOperationalIdentity,
  UserOperationalIdentityGrant,
  UserOperationalIdentityStore,
} from "../user-operational-identity-types.js";

export async function bindWechatPersonalIdentityFromWxid(params: {
  store: UserOperationalIdentityStore;
  ownerId: string;
  displayName: string;
  wxid: string;
  agentId?: string;
  accountId?: string;
  tenantId?: string | null;
  nowIso: string;
  skipRouteBinding?: boolean;
}): Promise<
  | {
      ok: true;
      identity: UserOperationalIdentity;
      grant?: UserOperationalIdentityGrant;
    }
  | { ok: false; code: string; error: string }
> {
  const wxid = params.wxid.trim();
  if (!wxid) {
    return { ok: false, code: "USER_IDENTITY_WXID_REQUIRED", error: "wxid is required." };
  }
  const displayName = params.displayName.trim() || wxid;
  const credentialHandleId = `wechat-personal:${wxid}`;
  const registered = registerUserOperationalIdentity({
    store: params.store,
    ownerId: params.ownerId,
    displayName,
    provider: "wechat-personal",
    credentialHandleId,
    externalAccountId: wxid,
    tenantId: params.tenantId,
    nowIso: params.nowIso,
    skipPlaceholderSecret: true,
    credentialVerified: true,
  });
  if (!registered.ok) {
    return registered;
  }

  let grant: UserOperationalIdentityGrant | undefined;
  const agentId = params.agentId?.trim();
  if (agentId) {
    const granted = upsertUserOperationalIdentityGrant({
      store: params.store,
      ownerId: params.ownerId,
      identityId: registered.identity.identityId,
      agentId,
      agentScope: "owned",
      grantMode: "auto",
      allowedActions: ["probe_status"],
      tenantId: params.tenantId ?? undefined,
      nowIso: params.nowIso,
    });
    if (!granted.ok) {
      return granted;
    }
    grant = granted.grant;
    if (!params.skipRouteBinding) {
      try {
        const accountId = params.accountId?.trim() || DEFAULT_ACCOUNT_ID;
        const cfg = loadConfig();
        const bindingResult = applyAgentBindings(cfg, [
          {
            agentId,
            match: { channel: "wechat", accountId },
          },
        ]);
        if (bindingResult.added.length > 0 || bindingResult.updated.length > 0) {
          await writeConfigFile(bindingResult.config);
        }
      } catch {
        // Route binding is best-effort; identity + grant already persisted.
      }
    }
  }

  return { ok: true, identity: registered.identity, grant };
}
