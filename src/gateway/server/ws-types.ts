import type { WebSocket } from "ws";
import type { ConnectParams } from "../protocol/index.js";

export type GatewayWsClient = {
  socket: WebSocket;
  connect: ConnectParams;
  connId: string;
  presenceKey?: string;
  clientIp?: string;
  user?: string;
  /**
   * Platform-auth user id (UUID) when resolved at connect. Used to isolate
   * live steward (`agent:main:employee:<id>`) chat events per employee.
   */
  platformUserId?: string;
  /** Paired device id from WS connect; used to recover owner when cookie/user are missing. */
  pairedDeviceId?: string;
  /**
   * Raw Ed25519 public key (base64url) that was verified for THIS connection
   * during the handshake.
   *
   * Distinct from the pairing record's key: a token-authenticated connection never
   * proved key possession and so leaves this undefined. Consumers that must bind an
   * operation to the live connection (capability redemption) require it and fail
   * closed when it is absent.
   */
  devicePublicKey?: string;
  /** Session domain for RPC domain isolation; undefined → guard treats as "any". */
  sessionDomain?: "platform" | "enterprise" | "employee";
  /** Membership validated by the server-side platform session. */
  sessionMembershipId?: string;
  /** Enterprise validated against `sessionMembershipId`; authoritative when both are present. */
  sessionEnterpriseId?: string;
  /** Trusted-proxy tenant hint from WS handshake (URL/header); not an authority source alone. */
  sessionTenantId?: string;
  /** Raw Cookie header from the WS upgrade request for later platform-identity hydration. */
  upgradeRequestCookie?: string;
  /** Whether the upgrade peer was treated as local-direct for platform session reads. */
  upgradeRequestLocalDirect?: boolean;
  /** Browser Origin from the WS upgrade request; pins surface identity. */
  upgradeRequestOrigin?: string;
  /** Host / X-Forwarded-Host from the WS upgrade request. */
  upgradeRequestHost?: string;
  sessionKind?: "platform-super-admin" | "platform-admin" | "enterprise-admin" | "member";
  canvasHostUrl?: string;
  canvasCapability?: string;
  canvasCapabilityExpiresAtMs?: number;
};
