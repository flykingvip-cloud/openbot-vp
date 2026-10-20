import { digitalHumanUseAllowed, type DigitalHumanRecord, type TrustedActor } from "./identity.js";
import {
  DevicePlatformError,
  type DeviceAssociation,
  type DeviceBinding,
  type GrantReference,
} from "./types.js";

/** One rule set for personal settings and the digital-human device list. */
export function sameDeviceOwner(
  actor: TrustedActor,
  owner: { tenantId: string; userId: string },
): boolean {
  return actor.tenantId === owner.tenantId && actor.userId === owner.userId;
}

export function canSeeAssociation(actor: TrustedActor, association: DeviceAssociation): boolean {
  return sameDeviceOwner(actor, {
    tenantId: association.tenantId,
    userId: association.claimingUserId,
  });
}

export function canOperateBinding(actor: TrustedActor, binding: DeviceBinding): boolean {
  return sameDeviceOwner(actor, binding);
}

export function assertCanSeeAssociation(actor: TrustedActor, association: DeviceAssociation): void {
  if (!canSeeAssociation(actor, association)) {
    throw new DevicePlatformError("NOT_FOUND", "Device not found");
  }
}

export function assertCanOperateBinding(actor: TrustedActor, binding: DeviceBinding): void {
  if (!canOperateBinding(actor, binding)) {
    throw new DevicePlatformError("NOT_FOUND", "Device not found");
  }
}

export function assertPlatformAdmin(actor: TrustedActor): void {
  if (!actor.platformAdmin) {
    throw new DevicePlatformError("FORBIDDEN", "Platform admin session is required");
  }
}

export function assertDigitalHumanUse(
  actor: TrustedActor,
  human: DigitalHumanRecord | null,
  permittedAgentIds: readonly string[],
): DigitalHumanRecord {
  if (!human) {
    throw new DevicePlatformError("NOT_FOUND", "Digital human not found");
  }
  if (!digitalHumanUseAllowed({ actor, human, permittedAgentIds })) {
    throw new DevicePlatformError("USE_DENIED", "Digital human use permission is required");
  }
  return human;
}

/**
 * Capability calls need a verified service client and the user-scoped grant.
 * Either one alone is denied.
 */
export function assertCapabilityAccess(input: {
  actor: TrustedActor;
  serviceClientId: string;
  serviceAuthenticated: boolean;
  grant: GrantReference | undefined;
  allowedServiceClientIds: readonly string[];
}): GrantReference {
  if (!input.serviceAuthenticated || !input.serviceClientId) {
    throw new DevicePlatformError("AUTH_INVALID", "Service client authentication is required");
  }
  if (!input.allowedServiceClientIds.includes(input.serviceClientId)) {
    throw new DevicePlatformError(
      "AUTH_INVALID",
      "Service client is not allowed for this platform",
    );
  }
  const grant = input.grant;
  if (!grant || grant.status !== "active") {
    throw new DevicePlatformError("AUTH_INVALID", "User grant is required");
  }
  if (grant.serviceClientId !== input.serviceClientId) {
    throw new DevicePlatformError("AUTH_INVALID", "Service client does not match the grant");
  }
  if (grant.userId !== input.actor.userId || grant.tenantId !== input.actor.tenantId) {
    throw new DevicePlatformError("NOT_FOUND", "Grant not found");
  }
  return grant;
}
