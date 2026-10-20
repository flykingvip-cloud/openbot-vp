# Knowledge Vault Sync — Mobile Real-Device Acceptance Checklist (P3)

> **Purpose:** Human sign-off for iOS / Android Vault Sync on **physical devices**.
> Unit/integration scaffolds: `VaultSyncGatewayClientObjectUploadTest.kt` (Android),
> `VaultSyncGatewayClientObjectUploadTests.swift` (iOS) — **≠** this checklist.
>
> Automated Chromium scaffolds do **not** substitute for mobile sign-off.

## Prerequisites

- Two physical devices (or one device + desktop peer) on the same Gateway reachability (Tailscale / LAN).
- Gateway build with `knowledge.vault-sync.*` RPCs; HTTP upload route enabled for mobile `httpOrigin`.
- For S3 objectUpload path: `OPENBOT_VAULT_SYNC_BLOB_BACKEND=s3` + MinIO/S3 reachable from **device network** (not only localhost).
- iOS: real device preferred over Simulator (File System + background refresh differ).
- Android: real device preferred; USB debugging or internal build channel documented.

Record build identifiers in the sign-off table below.

## Device matrix (minimum)

| Platform | Device model | OS version | Gateway URL | Result |
| -------- | ------------ | ---------- | ----------- | ------ |
| iOS      |              |            |             |        |
| Android  |              |            |             |        |

## Checklist

| #   | Step                                                                              | Expected                                                                              | iOS | Android | Operator / Date |
| --- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | --- | ------- | --------------- |
| 1   | **Bind vault** — secure store saves `vaultId` / `deviceId` / `saltB64`            | Binding survives app restart; password in Keychain/EncryptedSharedPreferences only    |     |         |                 |
| 2   | **Unlock + foreground sync** — add local file under vault root                    | Push revision accepted; ciphertext on gateway; no plaintext path in RPC metadata      |     |         |                 |
| 3   | **Pull peer** — second device pulls                                               | File decrypts locally; content matches                                                |     |         |                 |
| 4   | **>1 MiB file** — single blob over direct-put limit                               | Upload-session used; **HTTP chunk** or **S3 objectUpload** (not full-file WS Base64)  |     |         |                 |
| 5   | **Background opportunistic** — lock app, wait for scheduled sync (≥15 min policy) | No crash; sync may defer; foreground recovers                                         |     |         |                 |
| 6   | **Offline edit → online**                                                         | Journal replays; no duplicate revision ids on retry                                   |     |         |                 |
| 7   | **Revoke device** (owner on desktop or mobile admin)                              | Revoked device stops syncing; active device continues after epoch rotate (team vault) |     |         |                 |
| 8   | **Network spot-check** — proxy / log capture                                      | No `contentBase64` for multi-MiB payloads; no filename in revision wire JSON          |     |         |                 |

## Upload path evidence (row 4)

Check one box per platform after capturing logs:

- [ ] **HTTP chunks** — `PUT /__openbot/vault-sync/v1/.../chunks/{i}` seen from device
- [ ] **S3 objectUpload** — presigned `PUT` to object store host from device (gateway chunk dir empty)

## Sign-off

| Field                    | Value       |
| ------------------------ | ----------- |
| Gateway tag / commit     |             |
| iOS app build            |             |
| Android app build        |             |
| Blob backend             | file / s3   |
| PG metadata primary      | yes / no    |
| Overall mobile P3 manual | PASS / FAIL |
| Notes                    |             |

**FAIL criteria:** Any required row FAIL without waiver → P3 remains **not accepted**.
