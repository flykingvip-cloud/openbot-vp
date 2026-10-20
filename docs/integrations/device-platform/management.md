---
summary: "Shared device management records, permissions, and user versus admin DTOs"
read_when:
  - Building personal settings for devices and hardware
  - Building the connected-device list on a digital human
  - Configuring a device platform connector as a platform admin
title: "Device platform management"
---

# Device platform management

This page describes the OpenBot management layer in `src/integrations/device-platform/`. It is the shared store and service for the platform-admin connector page and for later user device pages. It is not the frozen integrations v1 loopback stub.

The loopback stub remains a test tool. See [Device digital-human API](/integrations/device-digital-human) and [Staging](/integrations/device-digital-human/staging). Do not reverse-proxy that stub to the public internet.

## Host boundary

`/api/device-platform/v1` is used on two hosts:

- On the OpenBot gateway, `/api/device-platform/v1/admin/*` is mounted for a platform-admin session. Ordinary users and enterprise admins are rejected there. `/api/device-platform/v1/me/*` is mounted for a signed-in member and is the personal-settings device API. It does not return the connector URL or secrets.
- On the device platform, the same prefix is the frozen control API (`health`, `capabilities`, `pair-challenges`, `devices/.../bind`). OpenBot calls it on the admin-configured origin, not on the OpenBot host. A loopback joint uses `http://127.0.0.1:8791`. Pointing the connector at this gateway collides on the prefix. See [Joint staging](/integrations/device-platform/staging).

The control client never calls `/api/integrations/v1` and never sends `pairChallenge` or `pairingCode` to OpenBot. OpenBot revoke stays on the integrations API. Device-platform `stop` and `revoke` are local only.

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

User device and operation payloads are an allow-list: display name, model, platform id, external device id, binding status, scopes, `authorizationRef`, both binding versions, the two establishment flags, and the coarse status projection. Presence is `unknown` when the device platform did not report it. The page does not show a device as online in that case.

User payloads never include:

- service base URL
- credential reference or client secret
- device private key or vendor key
- raw diagnostics
- grant credential or credential hash

Admin connection payloads include the platform name, environment, service base URL, contract version, credential reference, client identity, registration notes, callback allowlist, enable flag, disposition, and coarse health. They still do not include the service Basic password. The connection upsert rejects secret fields. A separate credential route stores that password outside the connection record and never returns it. Hiding a field in the UI is not sufficient; the user handler never receives it.

## Operations and restart

`operationId` is the idempotency key for add, rebind, and revoke. The same id and body returns the stored result. The same id and a different body is a conflict. A duplicate while the first call is in flight returns an in-flight duplicate and does not run a second side effect.

Tool-result idempotency in this store follows the integrations path: reserve before the caller leaves pending, duplicate while in flight, conflict on a different body, and drop the in-flight reservation on revoke, rebind, timeout, or process restart. Completed responses stay so a duplicate can replay the stored result. Restart does not auto-replay side-effecting tools.

On startup, runs that are not terminal become `interrupted` with `UNKNOWN_AFTER_RESTART`. In-flight management operations become `interrupted` and can be retried only by an explicit retry. Bindings left in pair, auth, apply, or revoke become `error`. Pending tool requests expire.

## Control contract

`HttpDevicePlatformControl` speaks the frozen device-control contract (`agent-b-freeze-draft`). Test connection calls `GET /health` and `GET /capabilities` with the stored service Basic credential. Redirects are not followed. A failed check does not mark the connector healthy. `FakeDevicePlatformControl` remains the in-process double for management unit tests. Do not put production secrets in a frontend build.

Disabling a connector blocks new grants and executions immediately. Existing device relationships stay until the user revokes them (`disabledDisposition: block_new_keep_existing`). Phase 1 only configures and verifies the connector. It does not push secrets to other hosts.

The service Basic password is write-once, stored outside the connection record, and omitted from every API response. Rotation is an explicit replace. Admin responses may include the credential reference, the base URL, and a redacted error.

## Personal settings

个人设置「设备与硬件」lists the signed-in member's devices, adds one from a scanned or typed pairing code, rebinds the digital human, and revokes the authorization. Add calls the connector origin with `HttpDevicePlatformControl`: health and capabilities, then pair redeem, then OpenBot grant exchange, then `POST /bind` with `X-OpenBot-Grant-Credential`. Pairing fields are not accepted on the OpenBot user body as `pairChallenge` or `pairingCode`.

A wrong, expired, replayed, or mismatched code does not become an active binding. Transfer is not a second claim write: only the current owner can unbind, and the next person adds the device with a new pairing code.

## Digital-human detail

数字人详情「已连接设备」lists the devices bound to the open digital human. It uses the same binding store, the same add / rebind / revoke operations, and the same user DTO as personal settings. The add form preselects that digital human. The server still checks the use grant on the operation. A shared digital human does not include another member's hardware.

The page reads `GET /api/device-platform/v1/me/digital-humans/{digitalHumanId}/devices`. It does not write a device binding into agent config, and it does not send pairing fields to `/api/integrations/v1`.

## Joint staging

Loopback steps, env names, and what CI does not prove: [Joint staging](/integrations/device-platform/staging). Cross-host and hardware evidence are still pending. `grayRelease` stays false.
