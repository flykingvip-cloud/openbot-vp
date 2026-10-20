/**
 * Vitest-only session binding for an isolated Gateway RPC rehearsal.
 * Production never sets this. Connect scopes still come from the handshake.
 */
import type { GatewayClient } from "../server-methods/types.js";

export type EvolutionRpcTestIdentity = {
  user: string;
  platformUserId: string;
  sessionKind: NonNullable<GatewayClient["sessionKind"]>;
  sessionMembershipId: string;
  sessionEnterpriseId: string;
};

let identity: EvolutionRpcTestIdentity | undefined;

function vitestProcess(): boolean {
  const flag = process.env.VITEST;
  return flag === "1" || flag === "true";
}

export function setEvolutionRpcTestIdentityForTests(next?: EvolutionRpcTestIdentity): void {
  if (!vitestProcess()) {
    identity = undefined;
    return;
  }
  identity = next;
}

export function applyEvolutionRpcTestIdentity(client: GatewayClient | null): void {
  if (!vitestProcess() || !identity || !client) {
    return;
  }
  client.user ||= identity.user;
  client.platformUserId ||= identity.platformUserId;
  client.sessionKind ||= identity.sessionKind;
  client.sessionMembershipId ||= identity.sessionMembershipId;
  client.sessionEnterpriseId ||= identity.sessionEnterpriseId;
}
