# Knowledge Vault Sync — Mobile Binding (P3.1)

Cross-platform contract for iOS / Android clients. Aligns with
`docs/design/openbot-knowledge-vault-sync-p0-2026-07-22.md` and `src/vault-sync/**`.

## Secrets

| Material                                         | Storage                                                      | Forbidden                                            |
| ------------------------------------------------ | ------------------------------------------------------------ | ---------------------------------------------------- |
| Sync password (optional remember)                | iOS Keychain / Android EncryptedSharedPreferences (Keystore) | UserDefaults, plain SharedPreferences, localStorage  |
| Vault binding (`vaultId`, `deviceId`, `saltB64`) | Same secure store                                            | Logging plaintext password                           |
| Derived BaseKey / content keys                   | **Memory only** while unlocked                               | Disk / Keychain (P3.1 does not persist derived keys) |

## Local vault files

- Root: Application Support / app `filesDir` → `VaultSync/<vaultId>/files/`
- Device-local journal / selective sync: `VaultSync/<vaultId>/device/<deviceId>/`
- Never sync Runtime derivatives (`.openbot/`, embeddings, sqlite indexes) — mirror `src/vault-sync/journal/excludes.ts`

## Sync object

Local vault **files only**. SQLite / embeddings / Runtime indexes are rebuilt after decrypt on device (same as desktop).

## Thresholds (mirror core)

- `protocolVersion` / `encryptionVersion`: start at `1`
- Direct put max: `1 MiB`; larger blobs use upload-session RPCs
- Default chunk size: `256 KiB`

## RPCs used by mobile (Gateway)

Existing `knowledge.vault-sync.*` surface (create, sync, selective-sync, devices, upload-session, quota). Mobile does **not** invent a parallel protocol.

## Foreground / background sync (P3.2)

| Mode       | Behavior                                                                                                                         | Promise                    |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| Foreground | Immediate (or 300ms debounce on local edits) when unlocked + online                                                              | Best-effort timely         |
| Background | Opportunistic only: iOS `BGAppRefresh` (`ai.openbot.ios.vault-sync.refresh`); Android WorkManager with network + battery-not-low | **No** permanent real-time |

Policy (`VaultSyncSchedulePolicy`):

- Locked or offline → skip remote sync
- Background local edits → schedule opportunistic work (do not start long sync on brief background)
- Background opportunistic wake → skip if last sync &lt; 15 minutes
- Soft background time budget ≈ 25s

Wire-up: iOS registers BG task at launch + ScenePhase; Android `VaultSyncLifecycle.install` on `Application.onCreate`.
