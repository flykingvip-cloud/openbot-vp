---
summary: "Shared device management records, permissions, and user versus admin DTOs"
read_when:
  - Building personal settings for devices and hardware
  - Building the connected-device list on a digital human
  - Configuring a device platform connector as a platform admin
title: "Device platform management"
---

# Device platform management

This page describes the OpenBot management layer in `src/integrations/device-platform/`. It is the shared store and service for later UI entries. It is not the frozen integrations v1 loopback stub, and it is not mounted on the production gateway.

The loopback stub remains a test tool. See [Device digital-human API](/integrations/device-digital-human) and [Staging](/integrations/device-digital-human/staging). Do not reverse-proxy that stub to the public internet.

## Shared entries

Two user-facing entries read and write the same records:

1. Personal settings, devices and hardware.
2. Digital-human detail, connected devices.

They use one binding store, one permission rule set, and one add / rebind / revoke operation machine. There is not a second binding table for the digital-human page.

Platform admin, device platform connection, is a different role. Admins configure the connector. Users manage their own device relationships.

## Records

| Record               | What it stores                                                                                                         |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Platform connection  | Connector id, service base URL, contract version, credential reference, service client ids, enable flag, coarse health |
| Device association   | Internal device id, platform id, external device id, claiming user and tenant, display name                            |
| Device binding       | Device, digital human, scopes, `authorizationRef`, expected binding version, applied binding version, status           |
| Management operation | add, rebind, or revoke, with `operationId`, progress, failure, and retry                                               |
| Status projection    | online, last seen, capability names, firmware, coarse anomaly summary                                                  |

External device identity is unique on platform id plus external device id. Phase 1 allows one current foreground binding per device. Revoked rows stay as history.

A binding stores `authorizationRef` only. It does not copy the grant blob. Grants, runs, events, device-tool requests, and tool-result idempotency used for recovery live in the same tenant shard.

Tenant shards are `tenants/<tenantId>/control-plane/device-platform.json`. Connector config and the cross-tenant claim index live under `tenants/_platform/control-plane/`. Set `OPENBOT_TENANTS_ROOT` to move that tree. The tenant shard does not contain the service URL or raw secrets.

## Binding lifecycle

States: `pending_pair`, `pending_auth`, `applying`, `active`, `error`, `revoking`, `revoked`.

- `authorizationEstablished` means OpenBot has a user-scoped grant for the current expected version.
- `platformApplied` means the device platform has applied that same version (`appliedBindingVersion === expectedBindingVersion` and the binding is active).

Those two flags are independent. An authorization can exist while the platform apply is still in progress.

## Identity

Formal management does not use the stub consent file as the user authorization source.

- The actor comes from the trusted login session, tenant membership, and an explicit digital-human use grant.
- Matching `ownerId` is not a use grant.
- A request body cannot set `userId`, `tenantId`, `agentId`, `gatewayAgentId`, `sessionKey`, `userSubject`, `ownerId`, or `membershipId`.
- `OPENBOT_DEVICE_DH_AGENT_DEBUG` and `OPENBOT_DEVICE_DH_AGENT_SESSION_FORCE` are rejected in formal mode. The stub may still honor them when it is run as a test tool.
- Capability calls need both a verified service client and the user-scoped grant credential. Either one alone is denied.
- `gatewayAgentId` stays on the digital-human record. Conversation session keys stay `device-dh:<digitalHumanId>:<conversationId>` on the integrations path.

Wire use grants from the existing employee access snapshot (`agentIds` / `ownedAgentIds`). Do not invent a second permission table.

## User and admin DTOs

User device and operation payloads are an allow-list: display name, platform id, external device id, binding status, scopes, `authorizationRef`, both binding versions, the two establishment flags, and the coarse status projection.

User payloads never include:

- service base URL
- credential reference or client secret
- device private key or vendor key
- raw diagnostics
- grant credential or credential hash

Admin connection payloads include the service base URL, contract version, credential reference, service client ids, enable flag, and coarse health. They still do not include raw secrets. The API rejects secret fields instead of storing them. Hiding a field in the UI is not sufficient; the user handler never receives it.

## Operations and restart

`operationId` is the idempotency key for add, rebind, and revoke. The same id and body returns the stored result. The same id and a different body is a conflict. A duplicate while the first call is in flight returns an in-flight duplicate and does not run a second side effect.

Tool-result idempotency in this store follows the integrations path: reserve before the caller leaves pending, duplicate while in flight, conflict on a different body, and drop the in-flight reservation on revoke, rebind, timeout, or process restart. Completed responses stay so a duplicate can replay the stored result. Restart does not auto-replay side-effecting tools.

On startup, runs that are not terminal become `interrupted` with `UNKNOWN_AFTER_RESTART`. In-flight management operations become `interrupted` and can be retried only by an explicit retry. Bindings left in pair, auth, apply, or revoke become `error`. Pending tool requests expire.

## Control contract

`DevicePlatformControlClient` is contract `openbot.device-platform.control.v1`. Methods: capability discovery, pairing challenge verify, ACL-filtered device query, apply binding, binding application status, stop or revoke, status sync, and health. B1 tests use `FakeDevicePlatformControl`. A production HTTP client waits for the device-platform draft. Do not put production secrets in a frontend build.

The local management routes live under `/api/device-platform/v1` and are not registered on the gateway in this change. They do not change `/api/integrations/v1`.

## Follow-ups

- B2: personal settings UI for devices and hardware.
- B3: digital-human detail UI for connected devices.
- B4: platform admin UI for the device platform connection.
- B5: live staging against the device-platform HTTP draft.
