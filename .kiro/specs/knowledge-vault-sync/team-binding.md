# Knowledge Vault Sync — Team Binding (P4.1)

Member key wrapping for shared E2EE vaults. Aligns with
`docs/design/openbot-knowledge-vault-sync-p0-2026-07-22.md`.

## Threat / visibility

| Material                      | Where                                         | Server sees?    |
| ----------------------------- | --------------------------------------------- | --------------- |
| Vault `BaseKey`               | Member device memory / private unwrap only    | **No**          |
| Member X25519 private key     | Device secure store / browser local key store | **No**          |
| Member public key             | Control plane `members.json`                  | Yes (routing)   |
| Wrapped BaseKey package       | Control plane                                 | Ciphertext only |
| Invite secret (out-of-band)   | Shown once to inviter / invitee               | **No**          |
| Password-sealed BaseKey cache | Browser localStorage (AES-GCM)                | **No**          |

## Flows

1. **Enable team** — owner derives `BaseKey`, generates X25519 keypair (persist private key locally), wraps BaseKey to self, calls `team.enable`.
2. **Invite** — owner wraps **current** BaseKey with invite secret + salt (`inviteId` client-chosen for AAD), uploads package; invite secret never stored.
3. **Accept** — invitee unwraps with secret, generates keypair (persist privately), re-wraps to their public key, calls `invites.accept`.
4. **Revoke** — owner/admin marks member revoked and clears their wrap package. Does **not** re-encrypt history blobs.
5. **Rotate wraps (forward secrecy for new writes)** — after revoke (and on explicit epoch bump):
   - Generate a **new random BaseKey** (unrelated to password KDF).
   - Bump `encryptionVersion` / key epoch.
   - Re-wrap the **new** BaseKey for all **active** members.
   - Seal the new BaseKey locally (password-AES) so the actor’s browser sync continues.
   - Revoked members who retained the **old** BaseKey can still decrypt **pre-rotation** ciphertext, but **cannot** derive keys for post-rotation epochs (`HKDF(oldBaseKey, newEpoch)` is insufficient once BaseKey itself rotated).

## RPCs

- `knowledge.vault-sync.team.enable`
- `knowledge.vault-sync.members.list` / `.revoke` / `.rotate-wraps`
- `knowledge.vault-sync.invites.create` / `.list` / `.revoke` / `.accept`
- `knowledge.vault-sync.encryption-version.bump`

## Crypto

- Member wrap: ephemeral X25519 ECDH → HKDF → AES-256-GCM (`src/vault-sync/crypto/member-wrap.ts` / UI `client-team.ts`)
- Invite wrap: HMAC-SHA256(inviteSalt, inviteSecret) → AES-GCM
- AAD binds `vaultId` + member/invite id + `keyEpoch`
- Content keys: HKDF from BaseKey with epoch label (`…/epoch/{encryptionVersion}`)

## Explicit non-goals (P4.1)

- No CRDT / real-time co-editing (see task 4.2)
- No automatic historical blob re-encryption on revoke (forward secrecy = **new writes only**)
