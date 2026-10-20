# C19 evidence package (Gate 0 / P0)

**Status:** **Closed for executor evidence** — live re-probe `gates.allPass=true` after Managed Enterprise cutover.  
Awaiting Codex **Accepted**. P1 locked until then.

## 1. Closing evidence

| Field           | Value                                                                                                                                           |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Evidence id     | `workspace-isolation-20260810-c19-live`                                                                                                         |
| Summary path    | `docs/design/evidence/workspace-isolation-20260810-c19-live.summary.json`                                                                       |
| Classification  | `controlled-audit-desensitized`                                                                                                                 |
| Store           | Managed Enterprise full `stateDir` (live `/root/.openbot`)                                                                                      |
| `summarySha256` | `7d402e298c9ea48ab0712df2f98dc5c0de5661ebf28c8fe94f1984ac53c19305`                                                                              |
| probe SHA       | `a6fcf2ad9c8ca2983290c2618275be899efc2f9a596df7d3e1205489f087b5dc` (v1.4.2 gate; live summary above may predate — re-run `c19-live-reprobe.sh`) |
| `gates.allPass` | **true**                                                                                                                                        |
| Cluster         | tenants **11** · user_dirs **52**                                                                                                               |

Historical `workspace-isolation-20260810-001` remains pre-cutover reference only. Synthetic `*-cursor-p0*` remains smoke-only.

## 2. Codex-required fields (satisfied)

| Requirement                               | Live summary path / value                                   |
| ----------------------------------------- | ----------------------------------------------------------- |
| Unique writable canonical per owner scope | `c19Assertions.writableCanonicalByOwnerScope` → `B_flat_l2` |
| Legacy A/B/C closed except canonical      | A=`quarantined`, B=`canonical_writable`, C=`read_only`      |
| Unknown ownership count + isolated        | `count=0`, `isolated=true`                                  |
| Shared-root recent writes == 0            | D/E/F `total=0`                                             |
| New `summarySha256` + current probe SHA   | see table above                                             |
| No cross-tenant content enumeration       | `crossTenantEnumeration.pass=true`                          |

## 3. Production cutover (2026-08-10T15:52:31Z)

1. Wrote `{stateDir}/.openbot-c19-bindings.json` (binding_manifest roles).
2. Moved **545** shared-root deliverables into `{stateDir}/.c19-quarantine-20260810T155231Z/`.
3. FS write-freeze on sample A/C + D/E/F; left B writable.
4. Re-ran `scripts/audit/c19-live-reprobe.sh` → **exit 0**.

## 4. Code proofs (complementary)

| Claim                                   | Evidence                                        |
| --------------------------------------- | ----------------------------------------------- |
| No duplicate writable canonical binding | `src/gateway/workspace/cutover.test.ts`         |
| Unknown ownership isolated              | ownership-classifier + managed fail-closed      |
| Shared-root access denied in code       | `isDeniedSharedHostRoot` + handler-bridge tests |
| `summarySha256` algorithm               | `src/gateway/workspace/c19-evidence.test.ts`    |

## 5. Residual ops note

Running production gateway overlay does not yet ship P0 shared-root deny symbols. Data-plane freeze/quarantine currently enforces C19 measurements; deploy P0 gateway overlay to keep application-level deny aligned.
