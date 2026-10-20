---
summary: "Loopback joint runbook for OpenBot and device-control"
read_when:
  - Handing a device-platform integrator the OpenBot management sequence
  - Rehearsing pair redeem, grant exchange, bind, rebind, revoke, and restart
title: "Device platform joint staging"
---

# Device platform joint staging

OpenBot management routes and the device-control process share the prefix `/api/device-platform/v1`. They are different hosts. This page is the joint sequence. It does not prove physical hardware, gray release, or a public staging URL.

Contract for the integrations stub: [Device digital-human API](/integrations/device-digital-human). Management records: [Device platform management](/integrations/device-platform/management).

## Status

| Evidence                                                                    | State                                                                 |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Production gateway mounts `/api/device-platform/v1/admin` and `/me`         | CI, through `createGatewayHttpServer`                                 |
| `/api/integrations/v1` stays off the gateway                                | CI                                                                    |
| Restart keeps connections, associations, bindings, and operations queryable | CI                                                                    |
| In-flight runs become `interrupted` and are not replayed                    | CI                                                                    |
| me list, add, rebind, revoke through `HttpDevicePlatformControl`            | CI against an injectable fake                                         |
| Device-control on `http://127.0.0.1:8791`                                   | Known limitation. No public staging URL. Not a pass                   |
| Add, rebind, and revoke register the grant on the integrations stub         | CI. `GET /grants/{authorizationRef}` on that origin returns GrantView |
| Live pair redeem against device-control on `http://127.0.0.1:8791`          | `JOINT_PENDING`. No public staging URL. Not a pass                    |
| Cross-host staging, gray release, flash, mass flash, physical hardware      | `JOINT_PENDING`. `grayRelease` is false. Not a pass                   |

## Known limitations

These are not passes:

- `JOINT_PENDING` for cross-host staging and physical hardware. CI never calls a live device-control process.
- There is no public device-control URL. The only joint target is loopback `http://127.0.0.1:8791`.
- `grayRelease` is false. `flash` and `massFlash` fail.

## Hosts

| Process           | Default origin           | Prefix                                         |
| ----------------- | ------------------------ | ---------------------------------------------- |
| OpenBot gateway   | `http://127.0.0.1:18789` | `/api/device-platform/v1/admin` and `/me`      |
| Device-control    | `http://127.0.0.1:8791`  | `/api/device-platform/v1` (health, pair, bind) |
| Integrations stub | `http://127.0.0.1:8787`  | `/api/integrations/v1`                         |

The connector `serviceBaseUrl` is the device-control origin, for example `http://127.0.0.1:8791`. Do not point it at the OpenBot gateway. The prefix is the same, so a request would hit OpenBot admin routes instead of pair and bind.

Do not reverse-proxy the integrations stub onto a public host. The stub is an unhardened loopback process.

Loopback is allowed on the connector only when the connection `environment` is `development`. `staging` and `production` require `https` and a public host. There is no shared public device-control URL yet, so the joint target stays loopback plus `development`.

## Contract pin

Agent A pins this OpenBot tree at the B4 main tip this joint branched from. Do not rename `authorizationRef`, `bindingVersion`, `digitalHumanId`, `deviceId`, or `assistant.*`. Pairing fields stay off `/api/integrations/v1` (`pairFieldsAccepted` is false).

- `OPENBOT_CONTRACT_SHA`: `490a69669c0cf9e68173ceb25cfa89c99438dfb9`
- OpenAPI raw URL: `https://raw.githubusercontent.com/flykingvip-cloud/openbot-vp/490a69669c0cf9e68173ceb25cfa89c99438dfb9/docs/integrations/device-digital-human/openapi.yaml`

That SHA is the pin. After this change merges, the coordinator publishes the new MERGE_SHA. This page does not invent that SHA.

Historical only, not the pin:

- B1 store commit `92826116a9b00a596ae2360d8a643d6148050e3c`
- Device-control draft freeze `4ac6f2823c69a4c471fe89592a411a15535c0b81`, OpenAPI raw URL `https://raw.githubusercontent.com/flykingvip-cloud/openbot-device-sdk/4ac6f2823c69a4c471fe89592a411a15535c0b81/contracts/device-platform/device-control.openapi.yaml`

## Start device-control

In the `openbot-device-sdk` checkout:

```bash
npm run device-control -- --listen 127.0.0.1:8791
```

The process listens on loopback only. It exits unless both env names below are set. Inject them in the operator environment. Do not commit them and do not paste them into chat.

| Name                            | Role                                                                                                            |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `OPENBOT_STUB_SERVICE_USER`     | Service Basic username. Device-control will not start without it. Gateway grant registration uses the same name |
| `OPENBOT_STUB_SERVICE_PASSWORD` | Service Basic password. Same rule                                                                               |
| `OPENBOT_STUB_CONSENT_USER`     | Consent Basic username. Required on the gateway process so add and rebind can exchange and rebind               |
| `OPENBOT_STUB_CONSENT_PASSWORD` | Consent Basic password. Same rule                                                                               |
| `OPENBOT_STUB_REDIRECT_URI`     | Redirect registered on the service client. Default `https://device.example/callback`                            |
| `OPENBOT_DEVICE_DH_STUB_URL`    | Integrations stub origin for device-control GET and gateway registration. Default `http://127.0.0.1:8787`       |
| `DEVICE_CONTROL_BASE_URL`       | Joint script override. Default `http://127.0.0.1:8791`                                                          |
| `OPENBOT_BASE_URL`              | OpenBot gateway origin. Default `http://127.0.0.1:18789`                                                        |
| `OPENBOT_DEVICE_PLATFORM_JOINT` | `harness` (default) or `live`                                                                                   |
| `OPENBOT_TENANTS_ROOT`          | Optional directory for management shards                                                                        |

Password source of truth for the shared fixture values is [Device digital-human staging](/integrations/device-digital-human/staging). Read that file locally. This page does not copy the values.

OpenBot stores the same password on the platform-admin page 设备平台连接. The credential route is write-once, does not echo the password, and omits it from every response. Rotation is an explicit replace.

## ACL

- `/api/device-platform/v1/admin/*` requires a platform-admin session. Enterprise admins and ordinary members are rejected.
- `/api/device-platform/v1/me/*` requires a signed-in member with a tenant membership. A platform-admin session without that membership is rejected.
- Identity fields in a request body (`userId`, `tenantId`, `agentId`, `gatewayAgentId`, `sessionKey`, and the rest of the override list) are rejected. The session supplies them.
- Capability calls need both the service Basic credential and the user-scoped grant credential.
- User device and operation payloads never include the connector URL, the service secret, grant plaintext, or raw diagnostics. `authorizationRef` is an id, not the credential. Presence is `unknown` when device-control did not report it.

## Sequence

1. Pair challenge. On device-control, `POST /api/device-platform/v1/pair-challenges` with `{ "deviceId" }`. The response includes `pairChallenge`, a six-digit `pairingCode`, and `expiresAtMs`. TTL is 10 minutes. Redeem is one-shot. The same client, code, and challenge may replay. A different code after redeem is rejected.
2. Redeem. The member calls OpenBot `POST /api/device-platform/v1/me/operations` with `kind: "add"` and `pairing.challenge` / `pairing.proof`. OpenBot calls device-control `POST /pair-challenges/{id}/redeem`. Those pairing fields are not sent to `/api/integrations/v1`.
3. Grant. Device-control must not mint `authorizationRef`. Bind requires the OpenBot grant and the header `X-OpenBot-Grant-Credential`. When the gateway process has both Basic pairs set, add exchanges that grant on `OPENBOT_DEVICE_DH_STUB_URL` (`POST /api/integrations/v1/consent/authorization-codes`, then `POST /api/integrations/v1/grants/exchange`) and keeps the one-time `authorizationCredential`. The stub `deviceId` is the external device id. `serviceClientIds[0]` must equal `OPENBOT_STUB_SERVICE_USER`, and `OPENBOT_STUB_REDIRECT_URI` must be registered for that service client. Device-control then `GET /api/integrations/v1/grants/{authorizationRef}` on that same origin with service Basic and `X-OpenBot-Grant-Credential`. The response is the GrantView (`authorizationRef`, `bindingVersion`, `digitalHumanId`, `deviceId`, `assistant`, and `status`). There is no bind bypass. If the stub rejects the exchange, add fails and does not keep a management-only grant. Without the consent and service env names, the gateway cannot register and device-control GET cannot succeed.
4. Bind. Device-control `POST /api/device-platform/v1/devices/{deviceId}/bind` with that header and body `authorizationRef`. Optional echoes are `bindingVersion` and `digitalHumanId`. Pairing fields on this body are rejected. Device-control trusts the stub GET above.
5. Status. `GET /api/device-platform/v1/devices/{deviceId}/bind` on device-control, and `GET /api/device-platform/v1/me/devices` on OpenBot.
6. Rebind and revoke. OpenBot `me/operations` with `kind: "rebind"` or `kind: "revoke"`. Rebind calls `POST /api/integrations/v1/grants/{authorizationRef}/rebind` on the stub, keeps the same `authorizationRef` and credential, and the next GET shows the new `bindingVersion` and `digitalHumanId`. Revoke calls `POST /api/integrations/v1/grants/{authorizationRef}/revoke`. The next GET with the same credential shows `status: "revoked"`. Device-control `POST .../stop` and `POST .../revoke` remain local token clears.
7. Restart. Start the gateway again. Platform connections, device associations, bindings, and management operations remain queryable. Runs that are not terminal become `interrupted` with `UNKNOWN_AFTER_RESTART`. In-flight management operations become `interrupted` and run again only on an explicit retry. Bindings left in pair, auth, apply, or revoke become `error`. In-flight tool-result reservations are dropped. Completed idempotency responses stay. Side-effecting tools are not replayed.

`gatewayAgentId`, session keys `device-dh:<digitalHumanId>:<conversationId>`, cancel abort of the in-flight completions request, accept-first `202`, and in-flight idempotency stay on the integrations stub. This joint does not change those behaviors.

## Curl

Defaults are loopback. Replace the cookie with a real gateway session. Leave the Basic password in the environment.

```bash
export DEVICE_CONTROL_BASE_URL="${DEVICE_CONTROL_BASE_URL:-http://127.0.0.1:8791}"
export OPENBOT_BASE_URL="${OPENBOT_BASE_URL:-http://127.0.0.1:18789}"

curl -sS --max-time 3 \
  -u "${OPENBOT_STUB_SERVICE_USER}:${OPENBOT_STUB_SERVICE_PASSWORD}" \
  "$DEVICE_CONTROL_BASE_URL/api/device-platform/v1/health"

curl -sS --max-time 3 \
  -u "${OPENBOT_STUB_SERVICE_USER}:${OPENBOT_STUB_SERVICE_PASSWORD}" \
  "$DEVICE_CONTROL_BASE_URL/api/device-platform/v1/capabilities"

curl -sS --max-time 3 \
  -u "${OPENBOT_STUB_SERVICE_USER}:${OPENBOT_STUB_SERVICE_PASSWORD}" \
  -H 'content-type: application/json' \
  -d '{"deviceId":"cam-1"}' \
  "$DEVICE_CONTROL_BASE_URL/api/device-platform/v1/pair-challenges"

curl -sS --max-time 5 \
  -H "cookie: ${OPENBOT_SESSION_COOKIE}" \
  "$OPENBOT_BASE_URL/api/device-platform/v1/me/devices"

curl -sS --max-time 10 \
  -H "cookie: ${OPENBOT_SESSION_COOKIE}" \
  -H 'content-type: application/json' \
  -d '{"operationId":"op-add-1","kind":"add","platformId":"plat-local","externalDeviceId":"cam-1","digitalHumanId":"dh-a","scopes":["chat"],"pairing":{"challenge":"pch_from_platform","proof":"000000"}}' \
  "$OPENBOT_BASE_URL/api/device-platform/v1/me/operations"
```

Use the `pairingCode` from the challenge response as `pairing.proof`. `000000` above is a placeholder shape, not a credential. Rebind and revoke use the same `me/operations` route with `kind` `rebind` or `revoke` and the returned `deviceId`.

Print the same sequence without calling the network:

```bash
bash src/integrations/device-platform/examples/joint.sh --print
```

## Harness

CI does not start `openbot-device-sdk` and does not call `127.0.0.1:8791`. The harness listens on an ephemeral loopback port, speaks the frozen control routes, and drives OpenBot `me` list, add, rebind, and revoke through `ConnectorHttpControl` / `HttpDevicePlatformControl`.

```bash
bash src/integrations/device-platform/examples/joint.sh
```

Stdout includes `harness ok` and `JOINT_PENDING`. That pending line means cross-host and hardware are not proven. A harness exit code of 0 is not a live joint pass.

Live probe, still not a hardware pass:

```bash
OPENBOT_DEVICE_PLATFORM_JOINT=live bash src/integrations/device-platform/examples/joint.sh
```

If device-control is down, the Basic env names are unset, or the connector origin equals the OpenBot origin, the script prints `JOINT_PENDING` and exits 2. A health check that succeeds still exits 2 until a signed-in me add, rebind, and revoke have been recorded with Agent A. Do not treat exit 2 as success.
