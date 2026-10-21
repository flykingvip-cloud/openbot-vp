---
summary: "Evidence matrix for the device-platform joint acceptance scenario"
read_when:
  - Deciding whether a device-platform step is code, mock, staging, hardware, or production evidence
  - Handing Agent A the OpenBot mock-ready ports and the frozen field pin
title: "Device platform joint acceptance"
---

# Device platform joint acceptance

This page is the evidence matrix for one scenario. A cell is only as strong as its column. 代码检查 does not fill 模拟. 模拟 does not fill staging, 真机, or 生产. A page that renders, or an API that returns 200, is not 设备实际已生效.

Management records: [Device platform management](/integrations/device-platform/management). Loopback commands and env names: [Joint staging](/integrations/device-platform/staging). Integrations stub: [Device digital-human API](/integrations/device-digital-human).

## Result types

| Result | What counts |
| --- | --- |
| 管理页面可操作 | A person can finish the step in the admin or member page |
| 服务接口可调用 | The HTTP route returns the contract body for that step |
| 设备实际已生效 | The device changed state. Under 模拟 this is only the in-process device-control stand-in or the grant stub. It is not a camera, a microphone, or a flashed board |

`grayRelease` is false. `realDeviceDelivery` is false. There is no public staging URL and no production device-control URL. Do not invent one.

## Contract pin

Field names stay frozen: `authorizationRef`, `bindingVersion`, `digitalHumanId`, `deviceId`, `assistant.*`. Pairing fields stay off `/api/integrations/v1` (`pairFieldsAccepted` is false). Header names and error codes stay frozen. This page does not rename them.

| Pin | Value |
| --- | --- |
| `OPENBOT_CONTRACT_SHA` | `d7f0e1d834dc9ccece6723f6d71dea8fa0cfcb1f` |
| OpenBot OpenAPI | `docs/integrations/device-digital-human/openapi.yaml` at that SHA |
| device-sdk main tip (historical, not the pin) | `9af0e59f6bce632fb2a38efc84a5dd3902551da5` |
| device-sdk OpenAPI path | `contracts/device-platform/device-control.openapi.yaml` |
| Docs merge prefix | `69cfb924` |
| Versus that docs merge | No field-name, path, header-name, or error-code changes |
| `info.version` | `v1` |
| Health `maturity` | `v1-frozen` |
| API prefix | `/api/device-platform/v1` |
| Device-control loopback | `http://127.0.0.1:8791` |
| v1-frozen PR id | `bc-860051cc` (landed as flykingvip-cloud/openbot-device-sdk PR #18) |
| `CONTROL_FREEZE_SHA` | `CONTROL_FREEZE_SHA=55ead3ef7fe7f20137123447c39e3f26f9bffbbe` |
| 契约冻结 | DONE |

`CONTROL_FREEZE_SHA=55ead3ef7fe7f20137123447c39e3f26f9bffbbe` is the device-sdk `main` commit after PR #18 squash-merged. It is the freeze pin. It is not the historical device-sdk main tip `9af0e59f6bce632fb2a38efc84a5dd3902551da5`, and it is not the historical draft freeze `4ac6f2823c69a4c471fe89592a411a15535c0b81`.

The frozen OpenAPI file is `contracts/device-platform/device-control.openapi.yaml` with `info.version=v1` and Health `maturity=v1-frozen`. The prefix is `/api/device-platform/v1`. The loopback default is `http://127.0.0.1:8791`. Relative to docs merge `69cfb924`, field names, paths, header names, and error codes are unchanged. `OPENBOT_CONTRACT_SHA` is still `d7f0e1d834dc9ccece6723f6d71dea8fa0cfcb1f`.

`grayRelease`, `realDeviceDelivery`, `flash`, and `massFlash` stay false. `firmwareUrl` stays null. 契约冻结 is the only gate marked DONE. 管理页浏览器联调, staging, 真机, 生产, and 设备实际已生效 stay PENDING / JOINT_PENDING.

OpenBot connection `contractVersion` is handled. New records use `v1`. A stored `v1-draft` is pending upgrade: it stays on read, and the next health check that returns `maturity=v1-frozen` rewrites it to `v1`. Upgrade device-control to `55ead3ef7fe7f20137123447c39e3f26f9bffbbe` or later before relying on that rewrite. See [Device platform management](/integrations/device-platform/management). It is not an open limitation.

Agent A sim script is `npm run sim-joint`. When credentials are unset, that script skips. A skip is not a pass. Agent A docs are `docs/integration/joint-acceptance.md` and `docs/integration/sim-joint-loopback.md`. Agent A rerun on the freeze commit: typecheck exit 0; test 75 pass / 0 fail / 4 skip. The 4 skips are live stubs.

After this OpenBot change merges, the coordinator publishes MERGE_SHA. This page does not invent it.

## Mock-ready paths

Three processes. Same path prefix on two of them is a collision, so the connector origin is never the OpenBot host.

| Role | Documented origin | What it serves |
| --- | --- | --- |
| OpenBot gateway | `http://127.0.0.1:18789` | `/api/device-platform/v1/admin` and `/api/device-platform/v1/me` |
| Device-control | `http://127.0.0.1:8791` | `/api/device-platform/v1` health, capabilities, pair, bind, revoke |
| Integrations stub | `http://127.0.0.1:8787` | `/api/integrations/v1` consent, exchange, grant GET, rebind, revoke |

1. Admin register and health. The connector `serviceBaseUrl` is `http://127.0.0.1:8791`. The admin call itself is `POST /api/device-platform/v1/admin/connections/{id}/test` on the gateway. That probe calls `GET /health` and `GET /capabilities` on 8791, not on the OpenBot admin host.
2. Personal add binds digital human A. 设备与硬件 and the digital-human「已连接设备」list read the same B1 store record (`bindingId`, `authorizationRef`). After exchange, the grant is on the stub at `http://127.0.0.1:8787`.
3. Rebind to B, then revoke. Both lists follow the store. `GET /api/integrations/v1/grants/{authorizationRef}` returns `status: revoked`. A later capability call with the old credential fails, so the old authorization cannot execute.
4. Voice and photo are stub-only under 模拟. 真机 stays PENDING until `grayRelease` and `realDeviceDelivery` are explicitly true and an engineering device is attached.

Mock order inside the harness: admin health (connector to the device-control stand-in) → pair → redeem → consent/exchange (grant on the stub stand-in) → bind A → both lists share `bindingId` → rebind B → revoke → old grant fails.

CI does not bind 8791 or 8787. It uses ephemeral loopback ports that speak those routes. `bash src/integrations/device-platform/examples/joint.sh` prints `harness ok` for that 模拟 run and still prints `JOINT_PENDING`. Exit 0 is not a live joint and not a hardware pass. `OPENBOT_DEVICE_PLATFORM_JOINT=live` exits 2 until a signed-in session against the real loopback processes is recorded. Secrets stay in `OPENBOT_STUB_SERVICE_USER`, `OPENBOT_STUB_SERVICE_PASSWORD`, `OPENBOT_STUB_CONSENT_USER`, and `OPENBOT_STUB_CONSENT_PASSWORD`. This tree does not store the values.

## Matrix

Pointers are repo-root paths. PENDING means this tree has no evidence in that column.

### 1. Admin registers the device platform and health passes

| Result | 代码检查 | 模拟 | staging | 真机 | 生产 |
| --- | --- | --- | --- | --- | --- |
| 管理页面可操作 | PASS. `ui/src/ui/ports/platform/device-platform/page.browser.test.ts` drives 设备平台连接 save and test against a fake fetch | PENDING. The harness calls the admin HTTP handler. It does not open the page | PENDING. No public staging URL | PENDING | PENDING |
| 服务接口可调用 | PASS. `src/integrations/device-platform/admin-connection.test.ts`, `src/gateway/device-platform-http.test.ts` | PASS. Harness `POST /api/device-platform/v1/admin/connections/plat-local/test`. Connector origin is the device-control stand-in, not `http://127.0.0.1:18789` | PENDING | PENDING | PENDING |
| 设备实际已生效 | N/A. Health is a connector probe. `executable`, `flash`, and `massFlash` stay false | N/A. The stand-in returns the v1-frozen health body. That is not a device actuation | PENDING | PENDING | PENDING |

### 2. User adds a device from 设备与硬件

| Result | 代码检查 | 模拟 | staging | 真机 | 生产 |
| --- | --- | --- | --- | --- | --- |
| 管理页面可操作 | PASS. `ui/src/ui/ports/employee/views/personal-devices-page.node.test.ts` submits `kind: "add"` from 设备与硬件 | PENDING. No browser joint | PENDING | PENDING | PENDING |
| 服务接口可调用 | PASS. `src/integrations/device-platform/service.test.ts`, `src/gateway/device-platform-personal-http.test.ts` | PASS. Harness `POST /api/device-platform/v1/me/operations` with `kind: "add"`, `digitalHumanId: "dh-a"`, and the pair proof | PENDING | PENDING | PENDING |
| 设备实际已生效 | PASS for the control-client call shape only. `src/integrations/device-platform/http-control-client.test.ts`. Not a device | PASS for the stand-in bind record only (`bindStatus: bound` on the fake). Not hardware | PENDING | PENDING | PENDING |

### 3. Bind digital human A

| Result | 代码检查 | 模拟 | staging | 真机 | 生产 |
| --- | --- | --- | --- | --- | --- |
| 管理页面可操作 | PASS. The same personal-devices test submits `digitalHumanId` with the add | PENDING. No browser joint | PENDING | PENDING | PENDING |
| 服务接口可调用 | PASS. `src/integrations/device-platform/grant-registry.test.ts` exchanges on the stub | PASS. Harness order includes pair, redeem, `POST /consent/authorization-codes`, `POST /grants/exchange` on the stub stand-in, then `POST /devices/cam-1/bind` with `X-OpenBot-Grant-Credential` | PENDING | PENDING | PENDING |
| 设备实际已生效 | N/A at code-inspection tier beyond the client contract | PASS for the stand-in only. The fake stores `authorizationRef` and `digitalHumanId`. Not a physical bind | PENDING | PENDING | PENDING |

### 4. A's 已连接设备 shows the same record

| Result | 代码检查 | 模拟 | staging | 真机 | 生产 |
| --- | --- | --- | --- | --- | --- |
| 管理页面可操作 | PASS. `personal-devices-page.node.test.ts` renders 已连接设备 from the same client store as 设备与硬件 | PENDING. No browser joint | PENDING | PENDING | PENDING |
| 服务接口可调用 | PASS. `service.test.ts` asserts one `bindingId` for `listPersonalSettingsDevices` and `listDigitalHumanDevices` | PASS. Harness `GET /me/devices` and `GET /me/digital-humans/dh-a/devices` return the same `bindingId` and `authorizationRef` | PENDING | PENDING | PENDING |
| 设备实际已生效 | N/A. This step is a shared store read | N/A. No extra device write | PENDING | PENDING | PENDING |

### 5. Real voice and photo

| Result | 代码检查 | 模拟 | staging | 真机 | 生产 |
| --- | --- | --- | --- | --- | --- |
| 管理页面可操作 | N/A. No management control claims a live microphone or camera | N/A | PENDING | PENDING | PENDING |
| 服务接口可调用 | PASS that the health contract keeps `grayRelease: false` and `realDeviceDelivery: false` (`http-control-client.ts` `parseHealth`) | PASS as a stub only. `simulateVoiceAndPhoto` returns `voice: stub`, `photo: stub`, `deviceEffect: false`. It does not call `/media` | PENDING | PENDING. Stays PENDING until `grayRelease` and `realDeviceDelivery` are explicitly true and an engineering device is attached | PENDING |
| 设备实际已生效 | N/A. Code refuses to mark the stub as hardware | N/A. `deviceEffect` is false. A stub sentence is not a capture | PENDING | PENDING | PENDING |

### 6. Rebind to B from the digital-human detail

| Result | 代码检查 | 模拟 | staging | 真机 | 生产 |
| --- | --- | --- | --- | --- | --- |
| 管理页面可操作 | PASS for the handler. `personal-devices-page.ts` `rebind()` posts `kind: "rebind"` from the detail surface. The node test covers the shared list and revoke, not a dedicated rebind click | PENDING. No browser joint | PENDING | PENDING | PENDING |
| 服务接口可调用 | PASS. `service.test.ts` and `grant-registry.test.ts` rebind and keep `authorizationRef` | PASS. Harness `kind: "rebind"` to `dh-b`, then stub `POST /grants/{authorizationRef}/rebind` | PENDING | PENDING | PENDING |
| 设备实际已生效 | N/A beyond the control client | PASS for the stand-in bind record only. The fake `digitalHumanId` becomes B. Not hardware | PENDING | PENDING | PENDING |

### 7. Both entries update in sync

| Result | 代码检查 | 模拟 | staging | 真机 | 生产 |
| --- | --- | --- | --- | --- | --- |
| 管理页面可操作 | PASS. The node test shows the detail list and the settings list follow one client store after revoke | PENDING. No browser joint | PENDING | PENDING | PENDING |
| 服务接口可调用 | PASS. `service.test.ts` clears the old human list and keeps one foreground binding | PASS. After rebind, `GET /me/devices` and `GET /me/digital-humans/dh-b/devices` share `bindingId`. `GET .../dh-a/devices` no longer lists it | PENDING | PENDING | PENDING |
| 设备实际已生效 | N/A. Sync is a store read | N/A. No extra device write beyond the rebind cell | PENDING | PENDING | PENDING |

### 8. After revoke, the old authorization cannot execute

| Result | 代码检查 | 模拟 | staging | 真机 | 生产 |
| --- | --- | --- | --- | --- | --- |
| 管理页面可操作 | PASS. The node test confirms revoke and shows 未绑定 on the settings list | PENDING. No browser joint | PENDING | PENDING | PENDING |
| 服务接口可调用 | PASS. `grant-registry.test.ts` GET after revoke is `status: revoked`. `permissions.ts` rejects a grant that is not `active` | PASS. Harness revoke, then stub GET `status: revoked`, stub `POST /conversations` returns `AUTH_REVOKED`, and `POST /api/device-platform/v1/capability/authorize` is not 200. Both lists drop the active binding | PENDING | PENDING | PENDING |
| 设备实际已生效 | N/A. Revoke on device-control is a local token clear in the client contract | PASS for the stand-in only. Fake `bindStatus` becomes `revoked` and `clearedTokens` is set. The old credential cannot open a conversation. Not a powered-off device | PENDING | PENDING | PENDING |

## How to reproduce the 模拟 column

```bash
bash src/integrations/device-platform/examples/joint.sh --print
bash src/integrations/device-platform/examples/joint.sh
```

Stdout must include `harness ok`, `CONTROL_FREEZE_SHA 55ead3ef7fe7f20137123447c39e3f26f9bffbbe`, `voice-photo stub deviceEffect false`, and `JOINT_PENDING cross-host hardware`.

Focused tests:

```bash
pnpm exec vitest run \
  src/integrations/device-platform/examples/examples.test.ts \
  src/integrations/device-platform/grant-registry.test.ts \
  src/gateway/device-platform-http.test.ts \
  src/gateway/device-platform-personal-http.test.ts
```

## What is still open

- staging: PENDING. No public staging host. Loopback `development` is the only allowed connector target.
- 真机: PENDING. `grayRelease` is false and `realDeviceDelivery` is false. Voice and photo are not device evidence.
- 生产: PENDING. No production cutover and no production device-control URL.
- 契约冻结: DONE. `CONTROL_FREEZE_SHA=55ead3ef7fe7f20137123447c39e3f26f9bffbbe`.
- 管理页浏览器联调: PENDING. The harness does not open the admin or member page.
- 设备实际已生效: PENDING / JOINT_PENDING. A v1-frozen health body is not a device actuation.
- Operator rehearsal against real `http://127.0.0.1:8791` and `http://127.0.0.1:8787` is not this harness. `OPENBOT_DEVICE_PLATFORM_JOINT=live` still exits 2. Agent A `npm run sim-joint` skips when credentials are unset. A skip is not a pass.
