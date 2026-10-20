# Handoff: extracting a shared prepared-effect digest

> **To:** owner of `daibai-super-steward` (`src/gateway/server-methods/steward-confirmation-store.ts`)
> and owner of `local-disk-read-grant` (`src/gateway/approval-lifecycle.ts`)
>
> **From:** `kiro-convergence-registry` (task `computer-network-capability-architecture`, now closed)
>
> **Date:** 2026-09-30
>
> **Ask:** agree a host for one shared effect-digest helper. No new module, no new protocol.
>
> **Note (2026-10-01):** `src/local-files/` and `src/gateway/approval-lifecycle.ts` reached
> `main` in #261.

---

## 1. Why this is worth doing now

`prepared-effect` is one of two responsibilities still marked `missing` in
`docs/design/convergence-registry.yaml`. The architecture calls for it at §4.4: an approved
action must commit with its target, amount, recipient, content and resource unchanged.

The need is not theoretical. The steward confirmation digest got two different edge cases wrong
in a row:

- Before #244, `computePayloadHash` used
  `JSON.stringify(payload, Object.keys(payload).toSorted())`. The array form of that replacer is
  a **recursive key filter, not a sort**, so nested objects were emptied. That defect was latent
  on `main`. Every steward action that requires confirmation builds flat params, and the
  dispatch payload is rebuilt from the stored record.
- #244 switched to `stableStringify`, which writes `undefined` as `null`. JSON writes a
  non-finite number as `null` too, and the gateway's `JSON.parse` turns a client-sent `1e999`
  into `Infinity`. So a `budget.set` ticket confirmed without `alertThreshold` would also
  execute with `alertThreshold: 1e999`. That one was live, with low impact, until #262 fixed it.

Corrected 2026-10-01: an earlier version of this paragraph called the nested-value defect a live
bypass, and a later one said neither path was exploitable. The first was wrong about the nested
values; the second missed the regression #244 itself introduced.

One implementation had the bug. Five implementations of the same idea exist, so the question is
which one becomes the shared one.

## 2. What exists today

Verified across `src/`, `packages/` and `.kiro/specs/`. No identifier named `PreparedEffect`,
`effectDigest` or `preparedEffectDigest` exists anywhere, and no `idempotencyKey` in the
repository is derived from an approved payload; every one is randomly generated.

| Implementation                                             | Binds                                         | Mechanism                                                                       | Gap                                               |
| ---------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------- |
| `src/local-files/{capability,redemption}.ts`               | canonical path, `fileId` dev/ino, operation   | Ed25519 over canonical JSON, `capabilityDigest`, nonce ledger, four-step redeem | Claims are file-shaped; no generic effect payload |
| `src/node-host/invoke-system-run-plan.ts`                  | executable realpath, cwd inode, script sha256 | snapshot then revalidate at commit                                              | No minted authority; plan is caller-supplied      |
| `src/gateway/server-methods/steward-confirmation-store.ts` | the exact execute parameters                  | sha256 payload digest, single-use token                                         | No prepare phase, no signature, in-memory         |
| `src/gateway/enterprise-data/approval-workflow.ts`         | scope policy, grant, classifications          | three digests, drift invalidation                                               | Binds policy context, **not** the effect          |
| `src/gateway/approval-lifecycle.ts`                        | nothing                                       | generic lifecycle, atomic `consumeAllowOnce`                                    | Deliberately payload-blind                        |

The two closest hosts are the last two, for opposite reasons. `steward-confirmation-store` is
already the de facto shared primitive by adoption — three live consumers (daibai execute,
`meeting-confirmation`, `collab-dispatch-confirmation`) — and its digest already covers the exact
parameters that will execute. `approval-lifecycle` is the only genuinely generic, typed
lifecycle with atomic one-shot consumption, and is the natural place for a digest field it
currently lacks.

## 3. Proposal

Two steps, both small, in this order.

**Step 1: keep the JSON round trip, then settle on one key-sorting serializer and give it a
neutral home.** Two exist:

- `stableStringify` in `src/agents/stable-stringify.ts`, on `main`.
- `canonicalJsonStringify` in `src/local-files/canonical-json.ts`, on `main` since #261.

The round trip is the design choice that matters, not which serializer runs after it. Neither
serializer calls `toJSON`, so on its own each collapses every `Date` to `{}`. After a JSON round
trip, both produce byte-identical output for any payload the steward builders can make, and
neither ever sees a non-finite number. Without the round trip, `canonicalJsonStringify` would
throw on a client-sent `1e999` when the ticket is issued.

So either serializer is fine behind the round trip. One small note for its owner:
`canonicalJsonStringify`'s docstring says `-0` is rejected, but the code writes it as `0`.

A feature module owning a general-purpose primitive is the wrong dependency direction, so the
survivor belongs in `src/shared/` or `src/infra/`. The local-disk-read-grant owner holds one of
the two and should make the call.

**Step 2: put the digest where the single-use semantics already are.** Add an optional
`preparedEffectDigest` to `ApprovalLifecycle`, computed with the canonicalizer, and compare it
on consumption. That gives every consumer of the generic lifecycle the §4.4 guarantee without a
new protocol, and lets `steward-confirmation-store` reduce to a thin caller rather than a
parallel implementation.

Deliberately **not** proposed: a new `src/prepared-effect/` module. The repository rule is
extract helpers rather than add a V2 copy, and a sixth implementation is the failure mode this
handoff exists to avoid.

## 4. One adjacent finding, lower severity

`sha256Digest` in `src/gateway/enterprise-data/digest-utils.ts` uses plain `JSON.stringify`, so
it is key-order sensitive: the same logical value serialized in a different key order produces a
different digest (verified). In `buildApprovalContextSnapshot`, `grantDigest` and
`classificationDigest` are built from inline literals and are therefore deterministic in
practice, but `scopePolicyDigest` digests a `scopePolicy` loaded from the store, whose key order
follows whatever was serialized.

Severity is genuinely lower than the steward bug: this fails **closed**. A key-order change
produces `APPROVAL_INVALIDATED` and forces re-approval, rather than letting a tampered payload
through. It is a false-positive and robustness issue, not a security hole, and it would be fixed
for free by step 1 above.

## 5. Ownership

I hold neither file. My only changes in this area are the confirmation hash fixes #244 and #262.
Both are narrow and leave the payload builders untouched. Neither has a recorded review from the
steward owner, so that owner should look at both. The extraction needs the two owners to agree a
host, which is why this is a handoff and not a pull request.

Happy to implement either step once a host is chosen.
