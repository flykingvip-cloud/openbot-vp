# Release record

## Delivery pipeline (SoT)

- Standard: `docs/design/openbot-dev-delivery-pipeline-standard-2026-07-20.md`
- **Production (L3 live)** is only what appears under **Latest cutover** below.
- **Production SoT branch:** `main` on GitHub (`origin/main`) — **ONLY** production cutover source since 2026-07-27 ruleset + I2 anchoring. Annotated `provenance/sha-*` tags identify immutable release objects.
- **Frozen archive (not trunk):** `release/baseline-recovery-20260725` remains for historical ledger rows only; do **not** cut over from it. See `deploy/production/BASELINE_RECOVERY_20260725.md`.
- **DO NOT cut over from `deploy/user-modeling-v92` / `e860bba1b0`.** That branch is the v109–v115 recovery-overlay stack and is **behind the capability floor**: it lacks tenant-context isolation, enterprise-data semantic catalog / event bus / data planner, agent-growth working-style, collaboration-learning capsules, tenant-import + migration-readiness, chat error sanitize and doctor-supervisor (~1997 files / ~229k lines vs the recovery candidate; **76 distinct Kiro-attributed changes, 39 with runtime code**). Cutting over from it regresses production. It stays a valid **archive/PR source** only.
- **Cutover rules:** default **full-dist** (gateway+UI same tip SHA); UI-layer only for tip-matched CSS/copy hotfixes; git-first then deploy; no dual version numbers across SoTs.

### Single trunk (decision D1, superseded 2026-08-23 governance)

- **`main` is the sole production cutover source.** Feature work merges to `main` via PR; candidates must equal a freshly fetched `origin/main` tip at build time.
- **`release/baseline-recovery-*` is frozen archive**, not an alternate trunk. Historical rows remain valid; new cutovers must not target those branches.

#### Force-push incident, 2026-07-27

`origin/main` was **non-fast-forwarded twice** (12:39:13 and 12:49:07 CST) onto the
trunk lineage. Nothing in git recorded it; it surfaced only from a per-ref audit.
| Item | Value |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Pre-push tip (dropped from `main`) | `0536504b9eec15cdb44ee6803208e67da2809c2b` |
| Stranded commits | 40, including merged PRs **#90** and **#91** |
| Carried by, at discovery | `origin/deploy/user-modeling-v92` **only** (an archive-only branch) |
| Backup created | `origin/backup/main-pre-forcepush-20260727` → `0536504b9e` |
| Triage | 16 REPLAY / 18 SUPERSEDED / 2 PRESENT / 4 MERGE — see `docs/design/convergence-evidence/2026-07-27/guardrails-and-orphan-triage.md` |
**Guardrails installed the same day** (both verified with real rejections, not just config reads):
| Layer | Mechanism | Scope |
| ------ | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Server | Ruleset `protect-trunk-no-force-push` (id 19803181) | `main`, `release/**`, `backup/**` — `non_fast_forward` + `deletion`, `bypass_actors` empty (**applies to the repo owner too**) |
| Server | Ruleset `protect-deploy-no-deletion` (id 19803182) | `deploy/**` — `deletion` |
| Client | `git-hooks/pre-push` | Same refs; fails earlier with a local message. Escape hatch `OPENBOT_ALLOW_FORCE_PUSH=1` |
**Any future force-push to a protected ref must:** (1) back the discarded commits up
to `backup/<topic>-<YYYYMMDD>` first, (2) use `--force-with-lease`, (3) be recorded
here with before/after SHAs and the reason. Bypassing a ruleset requires temporarily
setting `enforcement=disabled` via the API, which is itself auditable.

- **Port 18789 is owned by the container, exclusively.** Never run a host-level gateway (`openbot gateway run`, `systemctl start openbot-gateway`, `pm2 start ... gateway run`) on the production host. A host gateway started with `--force` seizes the port, crash-loops the container, and silently serves a different build **with a different session-storage layout** — see the 2026-07-26 incident below. The host unit is masked and the host npm-global CLI is uninstalled to make this fail loudly.
<!-- BEGIN GENERATED: current-identity -->
### Current LIVE identity (generated from `releases.jsonl`)

> **Scope:** This block asserts **ledger ↔ human-doc consistency** only.
> It does **not** prove the running container identity was reconciled
> (that is a separate LIVE verify / SSH / `delivery:check-sot` path).

<!-- identity: seq=154 gatewaySha=a17b60872cb62122449a170a24b2f4e150cf9557 uiSha=a17b60872cb62122449a170a24b2f4e150cf9557 digest=sha256:32b20f638067923bb21fdfede7130a34c6199042fc77dee07271436429f6a54e imageTag=rc-amd64-provenance-a17b60872cb6 tag=provenance/sha-a17b60872cb6 liveFrom=2026-11-02T05:24:45.706Z liveTo= liveVerified=true -->

| Field | Value |
| --- | --- |
| seq | 154 |
| gatewaySha | `a17b60872cb62122449a170a24b2f4e150cf9557` |
| uiSha | `a17b60872cb62122449a170a24b2f4e150cf9557` |
| artifactDigest | `sha256:32b20f638067923bb21fdfede7130a34c6199042fc77dee07271436429f6a54e` |
| imageTag / artifactId | `rc-amd64-provenance-a17b60872cb6` |
| tag | `provenance/sha-a17b60872cb6` |
| liveFrom | `2026-11-02T05:24:45.706Z` |
| liveTo | _(open)_ |
| liveVerified | `true` |
<!-- END GENERATED: current-identity -->

- **Historical L3 identity (seq 107; superseded by generated block above):** Was recorded as `bb72d03402847f7a51d2a425e55e74e5b53fc837` / image `rc-amd64-provenance-bb72d03402` / digest `sha256:173c2e029601788145fd5df598205750c993b6369035ea7491902ad073376ace` / tag `provenance/sha-bb72d0340284`, live from `2026-09-30T07:30:37.254Z` (seq 104 same image from `2026-09-29T14:21:24.723Z`; seq 105 adds the governance shadow env; seq 106 turns Fabric off; seq 107 mounts the data root). `verify-live` passed, R9 passed. Production remains `OPENBOT_EVOLUTION_GOVERNANCE_MODE=assist`; no `OPENBOT_GOVERNANCE_*_MODE` is set; Fabric is off (env and config). The data root `/root/OpenBot` is the bind mount `/var/lib/openbot/data-root`. Rollback `openbot-gateway-rc-prev-bb72d03402-nofabric-safety` (no data-root mount), then `openbot-gateway-rc-prev-bb72d03402-shadow-safety` plus config backup `openbot.json.bak-pre-fabric-off-20260930T023405Z` (Fabric on), then `openbot-gateway-rc-prev-bb72d03402-safety` (no shadow env), then `openbot-gateway-rc-prev-ca0c3765ba-safety` (pre-release LIVE).
- **Historical L3 identity (seq 98):** Was LIVE `41aac4a4f2ca37d15f2423aeca70f1c6aa2be001` / image `rc-amd64-provenance-41aac4a4f2` / digest `sha256:dabee5b9575ad5302316e504cb9d5381d62a2ef22b31f240ddf915c17338b5d9` / tag `provenance/sha-41aac4a4f2ca`, live from `2026-09-24T02:49:48.208Z`. `verify-live` passed: build-info matched, healthz 200, readyz `ready:true,failing:[]`. Production remains `OPENBOT_EVOLUTION_GOVERNANCE_MODE=assist`; E5.2 and autoApply remain closed. The assist observation window recorded 10 runtime intents with zero corruption, zero live mutation, and zero executed consumers; all remain denied as `missing_application`. Safety rollback is `openbot-gateway-rc-prev-f1c7efece9-safety`.
- **Historical L3 identity (seq 97):** Was LIVE `f1c7efece96d68375bf4b7fb57e77908fedfdd6c` / image `rc-amd64-provenance-f1c7efece9` / digest `sha256:6d9204dead13eb61b24838f3245c192d9983b46f103aae40d160e0d75940e012` / tag `provenance/sha-f1c7efece96d`, live from `2026-09-22T23:37:05.235Z`. `verify-live` passed: build-info matched, healthz 200, readyz `ready:true,failing:[]`. Production remains `OPENBOT_EVOLUTION_GOVERNANCE_MODE=assist`; E5.2, autoApply, runtime tick single-track, and skill-auto single-track remain closed. Safety rollback is `openbot-gateway-rc-prev-1617926868-safety`.
- **Prior L3 identity:** Seq **96** was LIVE / `1617926868e64b3d65e1b2f37e488ba6e8fb08f0` / image `rc-amd64-provenance-1617926868` / digest `sha256:583f153678bef4bc88c4ca4765acc73520a8f10f7d428f5f2e7b7978f4f9ec1b` / ledger tag `provenance/sha-1617926868e6` on `openbot-gateway-rc` (`8.217.93.71`, host network, state `/var/lib/openbot/state` → `/root/.openbot`) as of `2026-09-22T07:12:37.955Z`. Independently healthz 200, readyz `{ready:true,failing:[]}`, CT `activation/detection/qualification=on`, allowlist `enabled_count=0` (all authenticated tenants), `projection/authorization=off`, HMAC epoch `ct-2026-09-11-host`, `liveVerified=true`, `OPENBOT_EVOLUTION_GOVERNANCE_MODE=assist`. Host image `localhost/openbot:rc-amd64-provenance-1617926868` (GHCR `main-amd64`; revision+build-info match). Safety `openbot-gateway-rc-prev-5cd01d20d3-safety`. Seq 95 (`5cd01d20d3f4f2141f853860e825b003ac433329` / `rc-amd64-provenance-5cd01d20d3` / digest `sha256:51f51e8d803a9ef10f6400f63a89ec86bf2521be9eef399036a874dd3551cbfb`) is now **historical**. Seq 94 (`b9cccdefe8e7e8a26f524aee295358c39a382a15` / `rc-amd64-provenance-b9cccdefe8e7` / digest `sha256:4ada0d234fd0200b8fad4919976acef707097022850dcf593f0c67f1dbb54d6f`) is now **historical**. Seq 93 (`85fb7a468f7a2f1c92d0910ff4448e54b3bc3a6b` / `rc-amd64-provenance-85fb7a468f` / digest `sha256:32258ee89c06f7ad5511f915be837334e9d2442243fede67caf7f2efcbe3b075`) is now **historical**. Seq 92 (`b536bc250268cb5cbc8a443cf1a4e7073a89a967` / `rc-amd64-provenance-b536bc2502` / digest `sha256:6dd494e8d6b89d43deda23440edb020fe74a6a175f2dab06d54957a56ee94fb3`) is now **historical**. Seq 91 (`de6b8c9b91c4dfc03bb7e80b0de90b5a81c5d0f4` / `rc-amd64-provenance-de6b8c9b91` / digest `sha256:362c094cdd776c0b6c3840f46285429cec63130a4d453d62888005c53fd57a39`) is now **historical**. Seq 90 (`b56b248823dc8b52bb279c1a9146df87355d4ff6` / `rc-amd64-provenance-b56b248823` / digest `sha256:8b06ebcf1790bbbf3e60567456aba1ee527cfd38a608e40070c198551cf6053e`) is now **historical**. Seq 89 (`de972b91d623921139230f0d4b9cff70f8e037cc` / `rc-amd64-provenance-de972b91d6` / digest `sha256:cf8a09f32d7f2cb32593e7855207e920014b68b3038deb1f0ff23ea2e2530e8e`) is now **historical**. Seq 88 (`5fa5ae9341dda9695a2b20f63c72cdef12b60c25` / host-config ConversationTask full-tenant enablement on the seq 87 image) is now **historical**. Seq 87 (`5fa5ae9341dda9695a2b20f63c72cdef12b60c25` / `rc-amd64-provenance-5fa5ae9341` / digest `sha256:4f36a4e0e682aaac43165ea30aff84002c8cba369cc031468c6be63866f63ce0`) is now **historical** as the prior image cutover. Seq 86 (`16cea426e711516629e52c0522c39a7a77628655` / `rc-amd64-provenance-16cea426e711` / digest `sha256:182b42709b6fd37d521d9f19a28fef9464790f461bf3cd6868bea1a0d6f91c43`) is now **historical**. Seq 85 (`6bc9ff13f681be200b5ad3d139e424e9ebe668db` / `rc-amd64-provenance-6bc9ff13f6` / digest `sha256:486dc7727cf2c58b03e35746ff9eb73afad193798755f21e4c0348e90cc227c1`) is now **historical**. Seq 84 (`786eec763122b2cc618048ca0583a596459f5626` / `rc-amd64-provenance-786eec7631` / digest `sha256:758e2814b35e783d8a32109c5ada81f4cb7a084d26d24fba9e9f732ddd93a267`) is now **historical**. Seq 83 (`6bd4569606fd286b7d8b46fb7d9198fb7a134493` / digest `sha256:cae8337e9b596d50062863899a4c3239c5a90471dccb3db00e680c21dbbe355f`) is now **historical**. Seq 81 (`acb87127d2b3c1a0ecc65a60c5d43d5e55e4c828` / `rc-amd64-provenance-acb87127d2` / digest `sha256:06e791d0259335f6125b9d510695cbacd79df507faabbbbbfcd51c66884be333`) is now **historical**. Seq 80 (`d5b2ef9c644c0931f24026033ce367082ee9da96` / `rc-amd64-provenance-d5b2ef9c64` / digest `sha256:8b35316de0fc215c91a83e37d19a3b59a39783018f8b9921f9f6b028b5c11f43`) is now **historical**. Seq 78 (`79f2d5f57b9170877e24e40b76bb8982f63e4bb1` / `rc-amd64-provenance-79f2d5f57b` / digest `sha256:56ae6ad69fda7c2cb215267a811b6935e0680dfeb90af879388150104381366c`) is now **historical**. Seq 77 (`d537f2fdce97dbc441fe5d02c487668cb7caf8e1` / `rc-amd64-provenance-d537f2fdce` / digest `sha256:21e1784e1a8a25e6ae1e9bb96455619dcd76c3aab113cc22dda7246d5eb1ce85`) is now **historical**. Seq 76 (`c4df1f47bb46a263e2161606ae3e263e465def72` / `rc-amd64-provenance-c4df1f47bb` / digest `sha256:f607e4ce3b7fb96309768e57d99a9bc02efd7023848a8f16d1944069c2b218af`) is now **historical**. Seq 75 (`e4a2679da2729e39f95c8994912cfb35b8d1cf07` / `rc-amd64-provenance-e4a2679da2` / digest `sha256:3ff93d10fad9517f2de4bc48aee9d6ed8092d7cd7eaeffdb18ef67f3b0cb084e`) is now **historical**. Seq 74 (`cfe9d22ee1481de6e6ed3c0f2fef48c48191568a` / `rc-amd64-provenance-cfe9d22ee1` / digest `sha256:5f00bd997a527283bb5918b5b108625b978408d2232ec8d450418f07821cb308`) is now **historical**. Seq 73 (`7a6416cdfe3588848868d9c69d55518f65d2c6ef` / `rc-amd64-provenance-7a6416cdfe` / digest `sha256:b00a4277b943243a82a98c5cce031b5f252543f24492f59142cf570f43944416`) is now **historical**. Seq 72 (`470336cd0c0a48d2e341985296698f838f2ec0f6` / `rc-amd64-provenance-470336cd0c` / digest `sha256:b2e7f559a74323370d34d9d67f3828a52d1c241dd36d0b5b34bae875caecfd32`) is now **historical**. Seq 71 (`74fe2064ba11a03a9383c8d3522e0393f142fd95` / `rc-amd64-provenance-74fe2064ba` / digest `sha256:6f550f7dc61e53ea6aa006391a25f7b89aecb739d27a1a93e203effa9daa79ab`) is now **historical**. Seq 70 (`3cbd21a9e10f0b5ab3f6850fc4d7b2e9b588fceb` / `rc-amd64-provenance-3cbd21a9e1` / digest `sha256:47313b2b659d1470d9bebc06d45cd6445a5f42ac5b0daa1c8fc1ebec61e7f788`) is now **historical**. Seq 69 (`05fe958325f379ceef16e146d57cedc953d328d9` / `rc-amd64-provenance-05fe958325` / digest `sha256:34b70749cdee171afd551bfb4d4d350410cf332667b84833dde978ba3d0823f2`) is now **historical**. Seq 68 (`882d2d22f8c5b0689276cc81f55e2b4b1112c8ef` / `rc-amd64-provenance-882d2d22f8` / digest `sha256:a8890fafdecff7b4da200342305eedd2cab26cef780b7149ecf8fb9c7e675387`) is now **historical**. Seq 67 (`7e41fecc4241e46a1336f65185a5cf257e5f2ae4` / `rc-amd64-provenance-7e41fecc42` / digest `sha256:e8884526be7982918c084584db4454145f1a8efa37ba98eeb1ad5afc9e1b1804`) is now **historical**. Seq 66 (`8b5db08ee149db694a47210d4e65bd0958ffdcd3` / `rc-amd64-provenance-8b5db08ee1` / digest `sha256:1390775cbf05081c95236ee75e84e30f6cf8855aa82ce97c2063a0024a66f570`) is now **historical**. Seq 65 (`98a9a6c743ff9f5f3c564ac6c4a534735a2467e4` / `rc-amd64-provenance-98a9a6c743` / digest `sha256:7fb253f506a34de95eb05f446f8c08779e3c558be5022c93a6c84dc70eb17bfd`) is now **historical**. Seq 64 (`7d3fdf5bfef57077f7956ccab07c3c960984331b` / `rc-amd64-provenance-7d3fdf5bfe` / digest `sha256:db7b64563e591e0887915f2d9bbef2cb8130e77f5940ac7dcbb5dd817ffd044c`) is now **historical**. Seq 63 (`04690f8d2ed51f24a06825c153b7c1885d17182a` / `rc-amd64-provenance-04690f8d2e` / digest `sha256:f9775147138b1f8d733c95c2e708ddc00b26d88a74af534b49274526b22da4f1`) is now **historical**. Seq 62 (`81aafe1e218e91656c3a399edb5a9080ad00d448` / `rc-amd64-provenance-81aafe1e21` / digest `sha256:2f203c4b4c803a83b666df22b7b2f3fb789b49ad176974c9bc364682e8f54f8e`) is **historical**. Seq 61 (`e59aede2506dbe8c571f0019f7e1bac0687778b6` / `rc-amd64-provenance-e59aede250` / digest `sha256:314be4cd76f7d06c4028f0c430afada99d1c5bcbb010353b4c764465597a7423`) is historical. Seq 60 (`457057ba2adbdb6958fe092d211f75108d866f42` / `rc-amd64-provenance-457057ba2a` / digest `sha256:cba44d6f7644525dbd2ec35b79a34f308b97ac39590e7fdb9723172d49f5a4b0`) is historical. Seq 59 (`3d03d3b4df91ab0bfaa33900eba95287c1ab30d2` / `rc-amd64-provenance-3d03d3b4df` / digest `sha256:1881c4a8d5739c84d40a668dc4fb2c8cfeb3084de0c221881fd2a58c03e00e6e`) is historical. Seq 58 (`6d9ea1f2d5da2ae46ddfd18ecae12b07692a2a96` / `rc-amd64-provenance-6d9ea1f2d5` / digest `sha256:4a579a321d303314835eb19b3c256b7974b9dd0124efc0ea3bb33d86a58ca39b`) is historical. Seq 57 (`07ff8699ea01cf5779b1ef61269c1b7f3c285fd2` / `rc-amd64-provenance-07ff8699ea` / digest `sha256:55fc7f5ee00e5e0eb941451ad87e8ff499918cd0fbbd93d6d08b548980898c99`) is historical. Seq 56 (`dbfc8c0ac1ddd25ff2f93398435a3a01df4b98cf` / `rc-amd64-provenance-dbfc8c0ac1` / digest `sha256:0c207c52544eba94087acc073f775adfe9dce32fd2d82b2b721c3b9f8d657cac`) is historical. Seq 55 (`41becb5c885335747cb9e0ae1a8971a1c68e2b36` / `rc-amd64-provenance-41becb5c88` / digest `sha256:5481d56b2087bab163914bf6c1a2481d97440ce205f526b85d6c71a7821ad718`) is historical. Seq 54 (`37cc40e51f468404baf3077307e347f32f636cb1` / `rc-amd64-provenance-37cc40e51f` / digest `sha256:7ad093be0b62f83d735cc548a3814a5c521cf31d5d0473fc866b22f1740fe5ab`) is historical. Seq 53 (`45087ca676a0e5aafa9d60c1abea03466cc19d08` / `rc-amd64-provenance-45087ca676` / digest `sha256:37059fa5ef80d714cd81d7e781034809a764e37c5e9ad7e65c399a55c0a3613c`) is historical (unrecorded #893 forward reconstructed immediately before the seq 54 swap). Seq 52 (`756a577ec77e9420ad5e927f7ddc963555ca1a97` / `rc-amd64-provenance-756a577ec77e` / digest `sha256:474f9c166b2530b5fdb4c13b12f567ca054f83cecb5ace021c7665cd891cd546`) is historical. Seq 51 (`59be50660d8ebacf867211a206c92b4300bec418` / `rc-amd64-provenance-59be50660d` / digest `sha256:a64adc1f04f116d7dd0e7e434f1d1a00a99601ed8de8ae8523becd2b1a470595`) is historical. Seq 50 (`rc-amd64-provenance-1a6de1be5c` / digest `sha256:b3318467d1651222dd9381c18f6616e64ac92b17e61e5da273abccc2affa373a`) is historical. Seq 49 (`rc-amd64-provenance-33fc87c582` / digest `sha256:a4f41fe77f86319877d7af83a04ea0527f09b7de4951ed4df36f0af7d4a5ef43`) is historical. Seq 48 (`rc-amd64-provenance-6d27021431` / digest `sha256:767a5d3a85118ae37ad430d896035462ab62dc35e87650dde6284b6cec4bea58`) is historical. Seq 45 (`rc-amd64-provenance-21e1e8392f` / digest `sha256:ee132a30aea0461b71e8d98395e17ebae13f8224f20c3a14b6b818406b75ecb2`) and the ~11-minute seq 46 forward (`471b3a2c30990c2cc555c01bfa496870e147c229` / digest `sha256:1aaa7406c0965d9ffd33b9237030e43d5af833119cc2663e9821c930e545765b`) are historical. See **Latest cutover** below. Historical snapshots (`76fea1fb0669` on 2026-08-27, `a12e4c59e575` on 2026-08-24, overlay `7cd74d4c5c69`, `rc-amd64-v6`) are not LIVE.

## Latest cutover (machine ledger) — seq 151 / d37bed5117d6 Path B

Source of truth: open row in `deploy/production/releases.jsonl` (do not invent a parallel L3).

- tip `d37bed5117d6969e5ad0ee47b32e4efa8b6d715a`
- digest `sha256:09c9b4c0db843c8b977f21cc0e5fb78c43ab408dbd633cda9e41573756442c48`
- image `rc-amd64-provenance-d37bed5117d6` / tag `provenance/sha-d37bed5117d6`
- liveFrom `2026-10-31T03:21:00.871Z` (open; sole omitted liveTo after 2026-10-31 seq127 close)
- evidence (ledger): Path B SUCCESS tip d37bed5117d6 (Sandra PRODUCTION_GO DIGEST tip≥d37bed5117d6969e5ad0ee47b32e4efa8b6d715a; product #165 preferBoundSandboxExecHost — sticky agent host=gateway remapped to sandbox when bound): build-info commit=d37bed5117d6969e5ad0ee47b32e4efa8b6d715a version=2026.7.12-rc.2 builtAt=2026-10-31T03:08:50.527Z probeModuleSha=b9b9d3350ef20546; ImageDigest sha256:09c9b4c0db843c8b977f21cc0e5fb78c43ab408dbd633cda9e41573756442c48; imageId sha256:83ae38bfd33a1cc7379073d2fea60d2a6127cadb34ed

Human narrative sections below are historical; prefer the JSONL for LIVE identity.

## Previous cutover block (human archive) — seq 104–107 / bb72d0340284 manual amd64 GHCR


User-authorized forward-only full-dist recreate from freshly fetched `upbeyond/openbot` main `bb72d03402847f7a51d2a425e55e74e5b53fc837` (#220; contains the governance closure through #217 `0ffd38804893`). Release owner kiro-governance-closure. GitHub Actions is at `startup_failure` for every workflow, so the image was built manually (linux/amd64, pinned node:22-bookworm amd64 manifest `sha256:6d735b4d33660225271fda0a412802746658c3a1b975507b2803ed299609760a`, `GIT_COMMIT` build-arg, OCI revision label) and pushed to `ghcr.io/upbeyond/openbot:provenance-sha-bb72d0340284-amd64`. `cutover-from-ghcr.sh --stage --digest` passed forward-only (LIVE read from the container: `ca0c3765bae2`), the revision-label gate and the build-info gate on the host.

- **seq 104** `2026-09-29T14:21:24.723Z`: recreated `openbot-gateway-rc` with the live spec (host network, root, unless-stopped, ct-shadow entrypoint, same four mounts). Env file `/root/.openbot-cutover/env.bb72d03402` equals the previous one except `GIT_COMMIT`. Safety `openbot-gateway-rc-prev-ca0c3765ba-safety`.
- **seq 105** `2026-09-29T14:25:30.609Z`: same image, env `/root/.openbot-cutover/env.bb72d03402-shadow` adds `OPENBOT_GOVERNANCE_SHADOW_LOG=1` and the five path flags (`AGENT_INVOCATION`, `NODE_INVOKE`, `TOOLS_INVOKE`, `CAPABILITY_INVOKE`, `ACCESS_CONTROL` `_SHADOW=1`) for the P3 §8.4 observation window. No `OPENBOT_GOVERNANCE_*_MODE` is set; `OPENBOT_SUBAGENT_CREDIT_USAGE` is unset. Safety `openbot-gateway-rc-prev-bb72d03402-safety`.
- **seq 106** `2026-09-30T02:34:08.329Z`: same image and governance shadow env. Fabric turned off at the owner's request: env `OPENBOT_FABRIC_ENABLED=0` (`/root/.openbot-cutover/env.bb72d03402-shadow-nofabric`) and config `gateway.fabric.enabled=false` (edited while the gateway was stopped; backup `/var/lib/openbot/state/openbot.json.bak-pre-fabric-off-20260930T023405Z`). Fabric had been on in env and config since at least 2026-08-28 without a record entry. nginx logs from 2026-09-20 show no `/v1/tool|policy|adapter` requests. Effect: log `[fabric] control plane installed (disabled)`, authed `POST /v1/policy/check` returns 503, `fabric.*` RPCs report disabled, and the supervisor runtime is inactive because it needs the Fabric service (the supervisor task board shows unavailable; no supervisor task store exists on the host). Safety `openbot-gateway-rc-prev-bb72d03402-shadow-safety`.
- **seq 107** `2026-09-30T07:30:37.254Z`: same image and env as seq 106, plus the bind mount `/var/lib/openbot/data-root:/root/OpenBot`. `/root/OpenBot` is the default data root (`data.root` and `OPENBOT_DATA_ROOT` unset) and used to live in the container's writable layer. 9 files were restored into the mount, merged from every retained copy: the `*-safety` containers, the seq 99–102 archive, and the stopped seq 106 container read after the stop. Each file takes its newest version. One tenant-001 profile had seven versions: the newest was kept, one preference that a recreate had reset to its default was restored from the version that learned it (no later change record touched it), and observation counts were summed across container lifetimes. Safety `openbot-gateway-rc-prev-bb72d03402-nofabric-safety` (no data-root mount; after a rollback, data written since stays in `/var/lib/openbot/data-root`).
- All four: `verify-live` PASS (build-info matched, healthz 200, readyz `ready:true,failing:[]`), R9 PASS, public smoke 200 (`https://www.openbot.love/`, `https://gw.openbot.love/healthz`, `/__openbot/control-ui-config.json`, `/help/workbench`), health `healthy`, 0 error lines. `governance-shadow-decisions.jsonl` started writing.
- **Backfill seq 99–103:** five cutovers between 2026-09-26 and 2026-09-28 (`28ef650e0f97`, `6628f4bf364b`, `d22acc6e0ab9`, `fdb47dfe4ef0`, `ca0c3765bae2`) were never recorded. They are reconstructed from the retained `openbot-gateway-rc-prev-*` containers (build-info, OCI revision, ImageDigest, StartedAt/FinishedAt). All five are on main and forward-only. seq 99–102 are `unverified-backfill`; seq 103 was observed live before the swap. Executor for seq 99–103 is `cursor`, as attested by the owner on 2026-09-30. The four 09-28 images are buildah host builds whose `GIT_COMMIT` env stayed `28ef650e0f97`. The audit keeps two holes visible (2.2h and 30m on 2026-09-28) where no container covers the window.
- Carried unchanged from the previous env: `OPENBOT_MULTITENANT=1`. `OPENBOT_FABRIC_ENABLED=1` was carried in seq 104/105 and turned off in seq 106.
- **Housekeeping 2026-09-30:** annotated tags `provenance/sha-28ef650e0f97`, `provenance/sha-6628f4bf364b`, `provenance/sha-d22acc6e0ab9`, `provenance/sha-fdb47dfe4ef0` and `provenance/sha-ca0c3765bae2` now exist (the backfilled seq 99–103 rows named them before they existed). The four stopped seq 99–102 containers (`openbot-gateway-rc-prev-28ef650e0f-20260928-121534`, `-6628f4bf36-20260928-142931`, `-d22acc6e0a-20260928-153245`, `-fdb47dfe4e-20260928-200805`) were removed after archiving their inspect (env values redacted), build-info, container log, file logs and non-mounted data to `/root/.openbot-cutover/archive/20260930-seq99-102/` on the host (root-only, `SHA256SUMS`). Their image tags were removed later the same day; every layer of those four images is also part of the retained `rc-amd64-provenance-ca0c3765ba` rollback image, so this freed almost no disk space. The rollback chain above is unchanged.
- **Housekeeping 2026-09-30, legacy user-modeling:** removed `/var/lib/openbot/tenants/<tid>/user-modeling/` for `001`, `workspace-4-8bdcc581`, `workspace-5-5dc506f8`, `workspace-8-7d722e88` and `workspace-10-58629c80` (10 files, last written 2026-07-27 to 2026-08-04). That layout is `resolveTenantLiveRoot(tid)/user-modeling` from the frozen `release/baseline-recovery-20260725` code. Main moved the store to `<data root>/tenants/<tid>/live/user-modeling` in `a038f5c11` (2026-07-24) without a migration, and nothing in the LIVE build or current main reads the old path (the only path literals are in `src/gateway/user-modeling/user-profile-store.ts`). Not migrated into the current store. Archived first to `/root/.openbot-cutover/archive/20260930-legacy-user-modeling/` (root-only, verified against disk, `SHA256SUMS`).
- **Housekeeping 2026-09-30, stale secret copies:** deleted 21 files that held production secrets in plaintext and belonged to releases whose containers no longer exist: 11 `/root/openbot-cutover-<sha>.env`, 6 `/root/openbot-cutover-<sha>-before-inspect.json`, `/root/openbot-cutover-7d3fdf5bfe-20260905T1208Z/before-inspect.json` (and its now-empty directory), and the env files of the removed seq 100–102 containers (`/root/.openbot-cutover/env.6628f4bf36`, `env.d22acc6e0a`, `env.fdb47dfe4e`). Seven were mode 644 inside root-only `/root`. None was referenced by an existing container, systemd unit, cron job or host script. Kept: the env files of the live container and the rollback chain (`env.bb72d03402-shadow-nofabric`, `env.bb72d03402-shadow`, `env.bb72d03402`, `env.ca0c3765ba`) and `/root/openbot-cutover-history.log` (no secrets). Older sections of this record that name the deleted paths now describe files that no longer exist.
- **Resolved in seq 107 (was: open risk, data not persisted):** user-modeling profiles (`tenants/<tid>/live/user-modeling/`) and conversation recall-deny records (`.meta/conversations/recall-deny/`) are written under `/root/OpenBot` inside the container. That is the default data root (`data.root` and `OPENBOT_DATA_ROOT` unset, so `~/OpenBot`; `src/config/data-space.ts`, used by `src/gateway/user-modeling/user-profile-store.ts:30`), and it is not a bind mount, so every recreate starts these stores empty. Earlier copies exist only in `openbot-gateway-rc-prev-ca0c3765ba-safety`, `openbot-gateway-rc-prev-bb72d03402-shadow-safety` and the snapshots under `.../archive/20260930-seq99-102/safety-snapshots/`. Fixed in seq 107 by the bind mount and the restore. The recall-deny record of 2026-09-29 (deny watermark; its outbox entry was already `SUCCEEDED`) was absent from `2026-09-29T14:21:24.723Z` to `2026-09-30T07:30:37.254Z`, so recall filtering for that revoked range was not applied in that window; the logs of those containers have no `memory_search` / `memory.search` lines, which may not cover every search. Records that lived only in containers removed before 2026-09-26 cannot be recovered. Keep the safety containers until the P3 observation window ends.
- **Resolved in seq 107 (was: open risk, reboot):** `podman-restart.service` only starts `--restart always` containers and the gateway uses `unless-stopped`. The earlier advice to switch to `always` does not work on podman 4.9: `podman rename` keeps the policy and `podman update` cannot change it, so every safety container would keep `always`, start at boot next to the new gateway and race for `:18789`. Instead `/etc/systemd/system/openbot-gateway-rc-boot.service` (enabled; `Type=oneshot`, `RemainAfterExit=yes`, `After=network-online.target podman-restart.service`, `ExecStart=/usr/bin/podman start openbot-gateway-rc`) starts the container named `openbot-gateway-rc` at boot and nothing else. Crash restarts stay with `unless-stopped`. Checked with `systemd-analyze verify` and a start against the running gateway (a no-op); not exercised by a real reboot.
- **Single boot starter, 2026-09-30:** `podman-restart.service` is disabled and masked (`/etc/systemd/system/podman-restart.service -> /dev/null`). No container used `--restart always`, so it started nothing, but it would have started any safety container that had been created with `always`, as several older procedures in this record do. `openbot-gateway-rc-boot.service` is now the only unit that starts a container at boot. The other gateway boot paths stay off: host `openbot-gateway.service` is masked, root's user-level `openbot-gateway.service` is masked (`-> /dev/null` since 2026-07-22), the quadlet dirs are empty, there are no `@reboot` jobs, and `rc.local` is not executable. Unmask podman-restart only if a non-gateway container needs `always`.
- **Next recreate:** carry all five mounts (including `/var/lib/openbot/data-root:/root/OpenBot`), keep the name `openbot-gateway-rc` and `--restart unless-stopped`. The boot unit and the data depend on all three.

| Field           | Value                                                                                                                                                                                                                             |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date            | liveFrom `2026-09-29T14:21:24.723Z` (seq 104), `2026-09-29T14:25:30.609Z` (seq 105), `2026-09-30T02:34:08.329Z` (seq 106), `2026-09-30T07:30:37.254Z` (seq 107)                                                                   |
| Source revision | `bb72d03402847f7a51d2a425e55e74e5b53fc837`                                                                                                                                                                                        |
| Source          | GHCR `ghcr.io/upbeyond/openbot@sha256:173c2e029601788145fd5df598205750c993b6369035ea7491902ad073376ace` / host alias `localhost/openbot:rc-amd64-provenance-bb72d03402`                                                           |
| Image digest    | `sha256:173c2e029601788145fd5df598205750c993b6369035ea7491902ad073376ace`                                                                                                                                                         |
| Provenance      | annotated tag `provenance/sha-bb72d0340284`                                                                                                                                                                                       |
| Governance      | `OPENBOT_EVOLUTION_GOVERNANCE_MODE=assist`; governance shadow log + 5 path flags on; no governance MODE set; Fabric off (seq 106)                                                                                                 |
| Ledger          | `https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl` seq 99–107; seq 98 closed at `2026-09-26T15:39:59.221Z`                                                                 |
| Rollback        | `openbot-gateway-rc-prev-bb72d03402-nofabric-safety`, then `openbot-gateway-rc-prev-bb72d03402-shadow-safety` + config backup, then `openbot-gateway-rc-prev-bb72d03402-safety`, then `openbot-gateway-rc-prev-ca0c3765ba-safety` |
| Executor        | `kiro-governance-closure`                                                                                                                                                                                                         |

## Previous cutover (2026-09-24) — seq 98 / 41aac4a4f2ca trunk GHCR

User-authorized **forward-only assist observation deployment** from `upbeyond/openbot` main `41aac4a4f2ca37d15f2423aeca70f1c6aa2be001`, containing E5.1.6. Production remains in **assist** mode. The runtime observed 10 `runtime-auto-tick` intents with `corrupt=0`, `liveExecuted=true` count 0, and `executedConsumer=true` count 0. Every row is denied as `missing_application`, so E5.2, direct-mutator retirement, and autoApply remain **No-Go**. Host `8.217.93.71` / `openbot-gateway-rc` runs `localhost/openbot:rc-amd64-provenance-41aac4a4f2`, digest `sha256:dabee5b9575ad5302316e504cb9d5381d62a2ef22b31f240ddf915c17338b5d9`. OCI revision and artifact `build-info.commit` matched the candidate. `verify-live` passed with healthz 200 and readyz `ready:true,failing:[]`.

| Field           | Value                                                                                                                                                                |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date            | liveFrom `2026-09-24T02:49:48.208Z`                                                                                                                                  |
| Source revision | `41aac4a4f2ca37d15f2423aeca70f1c6aa2be001`                                                                                                                           |
| Source          | host alias `localhost/openbot:rc-amd64-provenance-41aac4a4f2` / digest `sha256:dabee5b9575ad5302316e504cb9d5381d62a2ef22b31f240ddf915c17338b5d9` / GHCR `main-amd64` |
| Build mode      | full-dist image (pulled from `ghcr.io/upbeyond/openbot`; no host build)                                                                                              |
| Rollback        | rename/start `openbot-gateway-rc-prev-f1c7efece9-safety`                                                                                                             |

## Previous cutover (2026-09-22) — seq 97 / f1c7efece96d trunk GHCR (#1246)

User-authorized **forward-only dark deployment** from freshly fetched `origin/main` `f1c7efece96d68375bf4b7fb57e77908fedfdd6c` (#1246 server-ledger completion replay; also carries the diagnosis/evolution A12+C8 closure). Production remains in **assist** mode and does **not** enable E5.2, autoApply, runtime tick single-track, or skill-auto single-track. Host `8.217.93.71` / `openbot-gateway-rc` runs `localhost/openbot:rc-amd64-provenance-f1c7efece9`, digest `sha256:6d9204dead13eb61b24838f3245c192d9983b46f103aae40d160e0d75940e012`. GHCR `main-amd64` OCI revision and artifact `build-info.commit` matched the candidate. Container recreated at `2026-09-22T23:37:05.235Z` through the existing ct-shadow entrypoint; safety `openbot-gateway-rc-prev-1617926868-safety`. `verify-live` passed with healthz 200 and readyz `ready:true,failing:[]`. Executor `gmood2008`; `liveVerified=true`.

| Field           | Value                                                                                                                                                                |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date            | liveFrom `2026-09-22T23:37:05.235Z`                                                                                                                                  |
| Source revision | `f1c7efece96d68375bf4b7fb57e77908fedfdd6c`                                                                                                                           |
| Source          | host alias `localhost/openbot:rc-amd64-provenance-f1c7efece9` / digest `sha256:6d9204dead13eb61b24838f3245c192d9983b46f103aae40d160e0d75940e012` / GHCR `main-amd64` |
| Build mode      | full-dist image (pulled from GHCR; no host build)                                                                                                                    |
| Rollback        | rename/start `openbot-gateway-rc-prev-1617926868-safety`                                                                                                             |

## Previous cutover (2026-09-22) — seq 96 / 1617926868e6 trunk GHCR (#1229)

User-authorized **forward-only** cutover from freshly fetched `origin/main` `1617926868e64b3d65e1b2f37e488ba6e8fb08f0` (#1229 diagnosis apply requires operator approval and SoT readback; also carries #1215–#1228). Stays **assist**; does **not** enable global auto. Host 8.217.93.71 / `openbot-gateway-rc` image `localhost/openbot:rc-amd64-provenance-1617926868` digest `sha256:583f153678bef4bc88c4ca4765acc73520a8f10f7d428f5f2e7b7978f4f9ec1b`. Pulled `ghcr.io/gmood2008/openbot:main-amd64` (Docker Release 35687499871 amd64; OCI revision and `build-info.commit` match candidate). Container recreated `2026-09-22T07:12:37.955Z` with ct-shadow entrypoint; safety `openbot-gateway-rc-prev-5cd01d20d3-safety`. verify-live PASS. Control UI `index-BO6NJaM8.js`. Public `https://www.openbot.love/` and `https://gw.openbot.love/healthz` 200. `/help/workbench` 200. `/assess` 200. CT `activation=1`; HMAC epoch `ct-2026-09-11-host` unchanged; `projection/authorization` stay off. liveFrom `2026-09-22T07:12:37.955Z` closes seq 95. Executor cursor-grok. liveVerified=true. Tag `provenance/sha-1617926868e6`. Live executor / Doctor `--fix` stay closed.

| Field           | Value                                                                                                                                                                |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date            | liveFrom `2026-09-22T07:12:37.955Z`                                                                                                                                  |
| Source revision | `1617926868e64b3d65e1b2f37e488ba6e8fb08f0`                                                                                                                           |
| Source          | host alias `localhost/openbot:rc-amd64-provenance-1617926868` / digest `sha256:583f153678bef4bc88c4ca4765acc73520a8f10f7d428f5f2e7b7978f4f9ec1b` / GHCR `main-amd64` |
| Build mode      | full-dist image (pulled from GHCR; no host build)                                                                                                                    |
| Rollback        | rename/start `openbot-gateway-rc-prev-5cd01d20d3-safety`                                                                                                             |

## Previous cutover (2026-09-19) — seq 95 / 5cd01d20d3f4 trunk GHCR (#1200)

User-authorized **return-to-trunk** cutover from freshly fetched `origin/main` `5cd01d20d3f4f2141f853860e825b003ac433329` (#1200 Official Account AppID contract + grant fallback + credential skill; also carries #1194–#1199). LIVE seq94 was a pre-squash #1195 UI-hotfix SHA, so git ancestry is diverged; content of #1195 is on trunk as `46e6f1a44a`. Stays **assist**; does **not** enable global auto. Host 8.217.93.71 / `openbot-gateway-rc` image `localhost/openbot:rc-amd64-provenance-5cd01d20d3` digest `sha256:51f51e8d803a9ef10f6400f63a89ec86bf2521be9eef399036a874dd3551cbfb`. Pulled `ghcr.io/gmood2008/openbot:main-amd64` (Docker Release 35442894992 amd64; OCI revision and `build-info.commit` match candidate). Container recreated `2026-09-19T12:41:27Z` with ct-shadow entrypoint; safety `openbot-gateway-rc-prev-b9cccdefe8-safety`. verify-live PASS. Control UI `index-DQGeREmM.js`. Public `https://www.openbot.love/` and `https://gw.openbot.love/healthz` 200. `/help/workbench` 200. `/assess` 200. CT `activation=1`; HMAC epoch `ct-2026-09-11-host` unchanged; `projection/authorization` stay off. liveFrom `2026-09-19T12:41:27Z` closes seq 94. Executor cursor-grok. liveVerified=true. Tag `provenance/sha-5cd01d20d3f4`. Live executor / Doctor `--fix` stay closed.

| Field           | Value                                                                                                                                                                |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date            | liveFrom `2026-09-19T12:41:27Z`                                                                                                                                      |
| Source revision | `5cd01d20d3f4f2141f853860e825b003ac433329`                                                                                                                           |
| Source          | host alias `localhost/openbot:rc-amd64-provenance-5cd01d20d3` / digest `sha256:51f51e8d803a9ef10f6400f63a89ec86bf2521be9eef399036a874dd3551cbfb` / GHCR `main-amd64` |
| Build mode      | full-dist image (pulled from GHCR; no host build)                                                                                                                    |
| Rollback        | rename/start `openbot-gateway-rc-prev-b9cccdefe8-safety`                                                                                                             |

## Previous cutover (2026-09-18) — seq 94 / b9cccdefe8e7 archive CSS pack (#1195)

User-authorized **Control UI hotfix** on seq93 base `85fb7a468f` to ship `enterprise-org-archive.css` into the live control-ui bundle (#1195). Root cause: live render uses `enterprise-surfaces-core` (static), so the lazy CSS loader never emitted archive footer `nowrap` / scroll rules. Stays **assist**; does **not** enable global auto. Host 8.217.93.71 / `openbot-gateway-rc` image `localhost/openbot:rc-amd64-provenance-b9cccdefe8e7` digest `sha256:4ada0d234fd0200b8fad4919976acef707097022850dcf593f0c67f1dbb54d6f`. Layered control-ui + `build-info` onto seq93 image; container recreated `2026-09-18T15:49:14Z` with ct-shadow entrypoint; safety `openbot-gateway-rc-prev-85fb7a468f-safety`. verify-live PASS. Control UI `index-CqzXvfdy.js` / `index-DiXJ5M11.css` (contains `enterprise-org-archive__footer-toolbar{…flex-wrap:nowrap…}`). Public `https://www.openbot.love/` and `https://gw.openbot.love/healthz` 200. CT `activation=1`; HMAC epoch `ct-2026-09-11-host` unchanged; `projection/authorization` stay off. liveFrom `2026-09-18T15:49:14Z` closes seq 93. Executor cursor-grok. liveVerified=true. Tag `provenance/sha-b9cccdefe8e7`. Live executor / Doctor `--fix` stay closed.

| Field           | Value                                                                                                                                                                        |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date            | liveFrom `2026-09-18T15:49:14Z`                                                                                                                                              |
| Source revision | `b9cccdefe8e7e8a26f524aee295358c39a382a15`                                                                                                                                   |
| Source          | host alias `localhost/openbot:rc-amd64-provenance-b9cccdefe8e7` / digest `sha256:4ada0d234fd0200b8fad4919976acef707097022850dcf593f0c67f1dbb54d6f` / base seq93 `85fb7a468f` |
| Build mode      | Control UI hotfix layer (replace `/app/dist/control-ui` + `build-info.json` on seq93 image; gateway runtime base unchanged)                                                  |
| Rollback        | rename/start `openbot-gateway-rc-prev-85fb7a468f-safety`                                                                                                                     |

## Previous cutover (2026-09-18) — seq 93 / 85fb7a468f7a trunk GHCR (#1192 #1190)

User-authorized **forward-only** cutover from freshly fetched `origin/main` `85fb7a468f7a2f1c92d0910ff4448e54b3bc3a6b` (#1192 workbench help pages; #1190 nav transcript cache + occupancy restore; also carries seq92 ledger #1189). Stays **assist**; does **not** enable global auto. Host 8.217.93.71 / `openbot-gateway-rc` image `localhost/openbot:rc-amd64-provenance-85fb7a468f` digest `sha256:32258ee89c06f7ad5511f915be837334e9d2442243fede67caf7f2efcbe3b075`. Pulled `ghcr.io/gmood2008/openbot:main-amd64` (Docker Release 35349580103 amd64; OCI revision and `build-info.commit` match candidate). Container recreated `2026-09-18T13:53:32Z` with ct-shadow entrypoint; safety `openbot-gateway-rc-prev-b536bc2502-safety`. verify-live PASS. Control UI `index-D_Vg7ccH.js`. Public `https://www.openbot.love/` and `https://gw.openbot.love/healthz` 200. `/help/workbench` 200. `/assess` 200. CT `activation=1`; HMAC epoch `ct-2026-09-11-host` unchanged; `projection/authorization` stay off. liveFrom `2026-09-18T13:53:32Z` closes seq 92. Executor cursor-grok. liveVerified=true. Tag `provenance/sha-85fb7a468f7a`. Live executor / Doctor `--fix` stay closed.

| Field           | Value                                                                                                                                                                |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date            | liveFrom `2026-09-18T13:53:32Z`                                                                                                                                      |
| Source revision | `85fb7a468f7a2f1c92d0910ff4448e54b3bc3a6b`                                                                                                                           |
| Source          | host alias `localhost/openbot:rc-amd64-provenance-85fb7a468f` / digest `sha256:32258ee89c06f7ad5511f915be837334e9d2442243fede67caf7f2efcbe3b075` / GHCR `main-amd64` |
| Build mode      | full-dist image (pulled from GHCR; no host build)                                                                                                                    |
| Rollback        | rename/start `openbot-gateway-rc-prev-b536bc2502-safety`                                                                                                             |

## Previous cutover (2026-09-18) — seq 92 / b536bc250268 trunk dist-pack (#1188)

User-authorized **forward-only** cutover from freshly fetched `origin/main` `b536bc250268cb5cbc8a443cf1a4e7073a89a967` (#1188 hide conversation progress strip; also carries seq91 ledger #1187). Stays **assist**; does **not** enable global auto. Host 8.217.93.71 / `openbot-gateway-rc` image `localhost/openbot:rc-amd64-provenance-b536bc2502` digest `sha256:6dd494e8d6b89d43deda23440edb020fe74a6a175f2dab06d54957a56ee94fb3`. Docker Release for this tip was still pending; Mac dist-pack overlaid gateway+UI dist and skills onto the seq 91 runtime image (no lockfile/Dockerfile delta), then recreated the container. OCI revision and `build-info.commit` match candidate. Container recreated `2026-09-18T11:07:28Z` with ct-shadow entrypoint; safety `openbot-gateway-rc-prev-de6b8c9b91-safety`. verify-live PASS. Control UI `index-KzIvDBNr.js`. Public `https://www.openbot.love/` and `https://gw.openbot.love/healthz` 200. `/assess` 200. CT `activation=1`; HMAC epoch `ct-2026-09-11-host` unchanged; `projection/authorization` stay off. liveFrom `2026-09-18T11:07:28Z` closes seq 91. Executor cursor-grok. liveVerified=true. Tag `provenance/sha-b536bc250268`. Live executor / Doctor `--fix` stay closed.

| Field           | Value                                                                                                                                                                      |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date            | liveFrom `2026-09-18T11:07:28Z`                                                                                                                                            |
| Source revision | `b536bc250268cb5cbc8a443cf1a4e7073a89a967`                                                                                                                                 |
| Source          | host alias `localhost/openbot:rc-amd64-provenance-b536bc2502` / digest `sha256:6dd494e8d6b89d43deda23440edb020fe74a6a175f2dab06d54957a56ee94fb3` / base seq91 `de6b8c9b91` |
| Build mode      | full-dist dist-pack (gateway+UI dist @ candidate SHA; runtime base seq91 image; no dependency delta)                                                                       |
| Rollback        | rename/start `openbot-gateway-rc-prev-de6b8c9b91-safety`                                                                                                                   |

## Previous cutover (2026-09-18) — seq 91 / de6b8c9b91c4 trunk dist-pack (#1186)

User-authorized **forward-only** cutover from freshly fetched `origin/main` `de6b8c9b91c4dfc03bb7e80b0de90b5a81c5d0f4` (#1186 workbench owned-asset install + review-queue click fix; also carries #1177–#1185). Stays **assist**; does **not** enable global auto. Host 8.217.93.71 / `openbot-gateway-rc` image `localhost/openbot:rc-amd64-provenance-de6b8c9b91` digest `sha256:362c094cdd776c0b6c3840f46285429cec63130a4d453d62888005c53fd57a39`. Docker Release for this tip was still queued; Mac dist-pack overlaid gateway+UI dist and skills onto the seq 90 runtime image (no lockfile/Dockerfile delta), then recreated the container. OCI revision and `build-info.commit` match candidate. Container recreated `2026-09-18T10:20:02Z` with ct-shadow entrypoint; safety `openbot-gateway-rc-prev-b56b248823-safety`. verify-live PASS. Control UI `index-C7OCZdtY.js`. Public `https://www.openbot.love/` and `https://gw.openbot.love/healthz` 200. `/assess` 200. CT `activation=1`; HMAC epoch `ct-2026-09-11-host` unchanged; `projection/authorization` stay off. liveFrom `2026-09-18T10:20:02Z` closes seq 90. Executor cursor-grok. liveVerified=true. Tag `provenance/sha-de6b8c9b91c4`. Live executor / Doctor `--fix` stay closed.

| Field           | Value                                                                                                                                                                      |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date            | liveFrom `2026-09-18T10:20:02Z`                                                                                                                                            |
| Source revision | `de6b8c9b91c4dfc03bb7e80b0de90b5a81c5d0f4`                                                                                                                                 |
| Source          | host alias `localhost/openbot:rc-amd64-provenance-de6b8c9b91` / digest `sha256:362c094cdd776c0b6c3840f46285429cec63130a4d453d62888005c53fd57a39` / base seq90 `b56b248823` |
| Build mode      | full-dist dist-pack (gateway+UI dist @ candidate SHA; runtime base seq90 image; no dependency delta)                                                                       |
| Rollback        | rename/start `openbot-gateway-rc-prev-b56b248823-safety`                                                                                                                   |

## Previous cutover (2026-09-17) — seq 90 / b56b248823dc trunk dist-pack (#1176)

User-authorized **forward-only** cutover from freshly fetched `origin/main` `b56b248823dc8b52bb279c1a9146df87355d4ff6` (#1176 folder-import ready progress + unread report; also carries #1169–#1175). Stays **assist**; does **not** enable global auto. Host 8.217.93.71 / `openbot-gateway-rc` image `localhost/openbot:rc-amd64-provenance-b56b248823` digest `sha256:8b06ebcf1790bbbf3e60567456aba1ee527cfd38a608e40070c198551cf6053e`. Docker Release `ubuntu-24.04` had no runner; Mac dist-pack overlaid gateway+UI dist and skills onto the seq 89 runtime image (no lockfile/Dockerfile delta), then recreated the container. OCI revision and `build-info.commit` match candidate. Container recreated `2026-09-17T14:01:31Z` with ct-shadow entrypoint; safety `openbot-gateway-rc-prev-de972b91d6-safety`. verify-live PASS. Control UI `index-BqDec0Mx.js`. Public `https://www.openbot.love/` and `https://gw.openbot.love/healthz` 200. `/assess` 200. CT `activation=1`; HMAC epoch `ct-2026-09-11-host` unchanged; `projection/authorization` stay off. liveFrom `2026-09-17T14:01:31Z` closes seq 89. Executor cursor-grok. liveVerified=true. Tag `provenance/sha-b56b248823dc`. Live executor / Doctor `--fix` stay closed.

| Field           | Value                                                                                                                                                                      |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date            | liveFrom `2026-09-17T14:01:31Z`                                                                                                                                            |
| Source revision | `b56b248823dc8b52bb279c1a9146df87355d4ff6`                                                                                                                                 |
| Source          | host alias `localhost/openbot:rc-amd64-provenance-b56b248823` / digest `sha256:8b06ebcf1790bbbf3e60567456aba1ee527cfd38a608e40070c198551cf6053e` / base seq89 `de972b91d6` |
| Build mode      | full-dist dist-pack (gateway+UI dist @ candidate SHA; runtime base seq89 image; no dependency delta)                                                                       |
| Rollback        | rename/start `openbot-gateway-rc-prev-de972b91d6-safety`                                                                                                                   |

## Previous cutover (2026-09-16) — seq 89 / de972b91d623 trunk GHCR (#1155)

User-authorized **forward-only** cutover from freshly fetched `origin/main` `de972b91d623921139230f0d4b9cff70f8e037cc` (#1155 knowledge remote embeddings + import progress; also carries #1148 collaboration chat UX, #1152 mention-scan harden, #1143 ConversationTask full-tenant code, and #1142–#1154). Stays **assist**; does **not** enable global auto. Host 8.217.93.71 / `openbot-gateway-rc` image `localhost/openbot:rc-amd64-provenance-de972b91d6` digest `sha256:cf8a09f32d7f2cb32593e7855207e920014b68b3038deb1f0ff23ea2e2530e8e`. Pulled `ghcr.io/gmood2008/openbot:main-amd64` (Docker Release 35064051870 amd64; OCI revision and `build-info.commit` match candidate). Container recreated `2026-09-16T07:33:48Z` with ct-shadow entrypoint; safety `openbot-gateway-rc-prev-5fa5ae9341-safety`. verify-live PASS. Control UI `index-DORy0TJy.js`. Public `https://www.openbot.love/` and `https://gw.openbot.love/healthz` 200. CT `activation=1`; HMAC epoch `ct-2026-09-11-host` unchanged; `projection/authorization` stay off. liveFrom `2026-09-16T07:33:48Z` closes seq 88. Executor cursor-grok. liveVerified=true. Tag `provenance/sha-de972b91d623`. Live executor / Doctor `--fix` stay closed.

| Field           | Value                                                                                                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Date            | liveFrom `2026-09-16T07:33:48Z`                                                                                                                                          |
| Source revision | `de972b91d623921139230f0d4b9cff70f8e037cc`                                                                                                                               |
| Source          | GHCR tag `main-amd64` / host alias `localhost/openbot:rc-amd64-provenance-de972b91d6` / digest `sha256:cf8a09f32d7f2cb32593e7855207e920014b68b3038deb1f0ff23ea2e2530e8e` |
| Build mode      | full-dist GHCR image (no host build, no dist-pack overlay)                                                                                                               |
| Rollback        | rename/start `openbot-gateway-rc-prev-5fa5ae9341-safety`                                                                                                                 |

## Previous cutover (2026-09-15) — seq 88 / ConversationTask full-tenant enablement

User-authorized **host-config** expansion of ConversationTask from the closed single-tenant canary to every authenticated tenant. **No image cutover and no container recreate.** LIVE stays the seq 87 image `5fa5ae9341dda9695a2b20f63c72cdef12b60c25`. The canary allowlist row was disabled (`enabled_count` 1→0) so the existing activation predicate `allowlisted || !hasAnyEnabledTenant()` admits all trusted tenants. `activation/detection/qualification` remain on; `projection/authorization` remain off. HMAC epoch `ct-2026-09-11-host` unchanged. Stays **assist**. healthz 200 / readyz ready. Backup `config-store.db.bak-pre-full-enable-20260915T125127Z`. liveFrom `2026-09-15T12:51:27Z` closes seq 87 as the prior image cutover. Executor cursor-grok. liveVerified=true. Evidence `docs/design/evidence/ct-full-tenant-enable-20260915.json`.

| Field           | Value                                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------------------- |
| Date            | liveFrom `2026-09-15T12:51:27Z`                                                                         |
| Source revision | `5fa5ae9341dda9695a2b20f63c72cdef12b60c25` (unchanged)                                                  |
| Change          | host `config-store` allowlist `enabled_count` 1→0                                                       |
| CT flags        | activation/detection/qualification on; projection/authorization off                                     |
| Tenant scope    | all authenticated tenants (empty enabled allowlist)                                                     |
| HMAC            | epoch `ct-2026-09-11-host` unchanged (value withheld)                                                   |
| Governance      | `OPENBOT_EVOLUTION_GOVERNANCE_MODE=assist` (no global auto)                                             |
| Rollback        | restore `/var/lib/openbot/state/conversation-task/config-store.db.bak-pre-full-enable-20260915T125127Z` |
| Executor        | `cursor-grok`                                                                                           |

## Previous cutover (2026-09-14) — seq 87 / 5fa5ae9341 reply language + trunk GHCR

User-authorized **forward-only** cutover from freshly fetched `origin/main` `5fa5ae9341dda9695a2b20f63c72cdef12b60c25` (#1130 reply language follow-user; also carries #1129 LaunchAgent RUNNING window, #1128 Control UI blob/data audio CSP, #1127 knowledge one-rule save/preview, #1117 ConversationTask progress, #1118 diagnosis fail-closed, #1119 evolution pack). Stays **assist**; does **not** enable global auto. Host 8.217.93.71 / `openbot-gateway-rc` image `localhost/openbot:rc-amd64-provenance-5fa5ae9341` digest `sha256:4f36a4e0e682aaac43165ea30aff84002c8cba369cc031468c6be63866f63ce0`. Pulled `ghcr.io/gmood2008/openbot:main-amd64` (Docker Release 34851660953 amd64; OCI revision and `build-info.commit` match candidate). Container recreated `2026-09-14T14:14:20Z` with ct-shadow entrypoint; safety `openbot-gateway-rc-prev-16cea426e7-safety`. verify-live PASS. Control UI `index-DPg0x6XF.js`. Public `https://www.openbot.love/` and `https://gw.openbot.love/healthz` 200. liveFrom `2026-09-14T14:14:20Z` closes seq 86. Executor cursor-grok. liveVerified=true. Tag `provenance/sha-5fa5ae9341dd`. Live executor / Doctor `--fix` stay closed.

| Field           | Value                                                                                                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Date            | liveFrom `2026-09-14T14:14:20Z`                                                                                                                                          |
| Source revision | `5fa5ae9341dda9695a2b20f63c72cdef12b60c25`                                                                                                                               |
| Source          | GHCR tag `main-amd64` / host alias `localhost/openbot:rc-amd64-provenance-5fa5ae9341` / digest `sha256:4f36a4e0e682aaac43165ea30aff84002c8cba369cc031468c6be63866f63ce0` |
| Build mode      | full-dist GHCR image (no host build, no dist-pack overlay)                                                                                                               |
| Rollback        | rename/start `openbot-gateway-rc-prev-16cea426e7-safety`                                                                                                                 |

## Previous cutover (2026-09-13) — seq 86 / 16cea426e711 archive UI opts + objective shadow OFF

User-authorized **forward-only** cutover from freshly fetched `origin/main` `16cea426e711516629e52c0522c39a7a77628655` (#1108 archive UI tabs/activation chrome + #1107 Phase 2 objective shadow default OFF). Stays **assist**; CT boundaries unchanged; `OPENBOT_TASK_FOCUS_OBJECTIVE_SHADOW` unset. Host 8.217.93.71 / `openbot-gateway-rc` image `localhost/openbot:rc-amd64-provenance-16cea426e711` digest `sha256:182b42709b6fd37d521d9f19a28fef9464790f461bf3cd6868bea1a0d6f91c43` (Mac dist-pack overlay on seq85 base; build-info commit matches candidate; no lockfile delta). Container recreated `2026-09-13T14:19:40Z` with ct-shadow entrypoint; safety `openbot-gateway-rc-prev-6bc9ff13f6-safety`. verify-live PASS. Archive UI markers present (`未命名岗位` / `edit-position` / `保存并发送激活`). Public `https://www.openbot.love/` and `https://gw.openbot.love/healthz` 200. liveFrom `2026-09-13T14:19:40Z` closes seq 85. Executor cursor-composer. liveVerified=true. Tag `provenance/sha-16cea426e711`.

| Field           | Value                                                                                                                                              |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date            | liveFrom `2026-09-13T14:19:40Z`                                                                                                                    |
| Source revision | `16cea426e711516629e52c0522c39a7a77628655`                                                                                                         |
| Source          | host alias `localhost/openbot:rc-amd64-provenance-16cea426e711` / digest `sha256:182b42709b6fd37d521d9f19a28fef9464790f461bf3cd6868bea1a0d6f91c43` |
| Build mode      | full-dist dist-pack (gateway+UI dist @ candidate SHA; runtime base seq85 image; no dependency delta)                                               |
| Rollback        | rename/start `openbot-gateway-rc-prev-6bc9ff13f6-safety`                                                                                           |

## Previous cutover (2026-09-13) — seq 85 / 6bc9ff13f681 checkpoint continuity cron gate

User-authorized **forward-only** cutover from freshly fetched `origin/main` `6bc9ff13f681be200b5ad3d139e424e9ebe668db` (#1103 checkpoint UI, continuity capture, cron inject, model error replies + #1105 evolution-grant platform trusted context). Stays **assist**; CT boundaries unchanged. Host 8.217.93.71 / `openbot-gateway-rc` image `localhost/openbot:rc-amd64-provenance-6bc9ff13f6` digest `sha256:486dc7727cf2c58b03e35746ff9eb73afad193798755f21e4c0348e90cc227c1` (Mac dist-pack overlay on seq84 base; build-info commit matches candidate; no lockfile delta). Container recreated `2026-09-13T02:03:42Z` with ct-shadow entrypoint; safety `openbot-gateway-rc-prev-786eec7631-safety`. verify-live PASS. Public `https://www.openbot.love/` and `https://gw.openbot.love/healthz` 200. liveFrom `2026-09-13T02:03:42Z` closes seq 84. Executor cursor-composer. liveVerified=true. Tag `provenance/sha-6bc9ff13f681`.

| Field           | Value                                                                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Date            | liveFrom `2026-09-13T02:03:42Z`                                                                                                                  |
| Source revision | `6bc9ff13f681be200b5ad3d139e424e9ebe668db`                                                                                                       |
| Source          | host alias `localhost/openbot:rc-amd64-provenance-6bc9ff13f6` / digest `sha256:486dc7727cf2c58b03e35746ff9eb73afad193798755f21e4c0348e90cc227c1` |
| Build mode      | full-dist dist-pack (gateway+UI dist @ candidate SHA; runtime base seq84 image; no dependency delta)                                             |
| Rollback        | rename/start `openbot-gateway-rc-prev-786eec7631-safety`                                                                                         |

## Previous cutover (2026-09-12) — seq 84 / 786eec763122 enterprise billing closure gate

User-authorized **forward-only** cutover from freshly fetched `origin/main` `786eec763122b2cc618048ca0583a596459f5626` (#1098 `billing.attribution-by-position` managed tenant store path + #1102 workspace identity repair). Stays **assist**; CT boundaries unchanged. Host 8.217.93.71 / `openbot-gateway-rc` image `localhost/openbot:rc-amd64-provenance-786eec7631` digest `sha256:758e2814b35e783d8a32109c5ada81f4cb7a084d26d24fba9e9f732ddd93a267` (dist-pack overlay on GHCR `main-amd64`; build-info commit matches candidate). Container recreated `2026-09-12T09:58:42Z` with ct-shadow entrypoint; safety `openbot-gateway-rc-prev-6bd4569606-safety`. verify-live PASS. Post-cutover billing probes: tenant `001` enterprise-admin `daniel.hhd@gmail.com` — `billing.attribution-by-position` OK (112 rows); isolated acceptance tenant `workspace-4-8bdcc581` admin `hedon25@126.com` — controlled ai_token overage → final Bill **10000 cents**, seat/position/Statement four-way aligned (`/root/billing-settle-final-workspace4.log`). liveFrom `2026-09-12T09:58:42Z` closes seq 83. Executor cursor-composer. liveVerified=true. Tag `provenance/sha-786eec763122`.

| Field           | Value                                                                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Date            | liveFrom `2026-09-12T09:58:42Z`                                                                                                                  |
| Source revision | `786eec763122b2cc618048ca0583a596459f5626`                                                                                                       |
| Source          | host alias `localhost/openbot:rc-amd64-provenance-786eec7631` / digest `sha256:758e2814b35e783d8a32109c5ada81f4cb7a084d26d24fba9e9f732ddd93a267` |
| Build mode      | full-dist dist-pack (gateway+UI dist @ candidate SHA; runtime base GHCR `main-amd64`; no dependency delta)                                       |
| Rollback        | rename/start `openbot-gateway-rc-prev-6bd4569606-safety`                                                                                         |

## Previous cutover (2026-09-12) — seq 83 / 6bd4569606fd forward ledger reconciliation

User-authorized **forward ledger** reconciliation for an unrecorded production deploy already running `origin/main` `6bd4569606fd286b7d8b46fb7d9198fb7a134493` (#1093 billing position attribution atop seq82 ConversationTask canary). **No rollback.** Stays **assist**; CT boundaries unchanged for **one** internal test tenant (`activation/detection/qualification=on`, `projection/authorization=off`). Host 8.217.93.71 / `openbot-gateway-rc` image `localhost/openbot:rc-amd64-provenance-6bd4569606` digest `sha256:cae8337e9b596d50062863899a4c3239c5a90471dccb3db00e680c21dbbe355f`. Container started `2026-09-12T03:59:30Z` with `/run/ct-shadow/entrypoint.sh`; safety `openbot-gateway-rc-prev-f0dec72227-safety`. verify-live PASS. Control UI `index-iwByD4J0.js`. Read-only retention: existing active tasks readable (2 on allowlist store, 0 elsewhere); no new canary task. Browser E2E from seq82 remains authoritative. liveFrom `2026-09-12T03:59:30Z` closes seq 82. Executor cursor-composer. liveVerified=true. Annotated SoT identity tag `provenance/sha-6bd4569606fd`. Evidence `docs/design/evidence/ct-production-retention-6bd4569606-20260912.json`.

| Field           | Value                                                                                                                                               |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date            | liveFrom `2026-09-12T03:59:30Z`                                                                                                                     |
| Source revision | `6bd4569606fd286b7d8b46fb7d9198fb7a134493`                                                                                                          |
| Source          | host alias `localhost/openbot:rc-amd64-provenance-6bd4569606` / digest `sha256:cae8337e9b596d50062863899a4c3239c5a90471dccb3db00e680c21dbbe355f`    |
| Image digest    | `sha256:cae8337e9b596d50062863899a4c3239c5a90471dccb3db00e680c21dbbe355f`                                                                           |
| Provenance      | annotated tag `provenance/sha-6bd4569606fd`                                                                                                         |
| Control UI      | `index-iwByD4J0.js`                                                                                                                                 |
| CT flags        | activation/detection/qualification on (allowlist=1); projection/authorization off                                                                   |
| HMAC            | epoch `ct-2026-09-11-host` unchanged via entrypoint (value withheld)                                                                                |
| Governance      | `OPENBOT_EVOLUTION_GOVERNANCE_MODE=assist` (no global auto)                                                                                         |
| Ledger          | `https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl` seq 83; `--live-verified`. Seq 82 closed. |
| Rollback        | container `openbot-gateway-rc-prev-f0dec72227-safety`; image `localhost/openbot:rc-amd64-provenance-f0dec72227`                                     |
| Executor        | `cursor-composer`                                                                                                                                   |

## Previous cutover (2026-09-12) — seq 82 / f0dec7222777 ConversationTask sync

User-authorized full-dist recreate from freshly fetched `origin/main` `f0dec722277770791a939c0a456242ce62d77763` (#1090 deps atop #1089 explicit multi-step L2 + activation hook / Workbench progress strip). Stays **assist**; CT enabled for **one** internal test tenant only (`activation/detection/qualification=on`, `projection/authorization=off`). Host 8.217.93.71 / `openbot-gateway-rc` image `localhost/openbot:rc-amd64-provenance-f0dec72227` digest `sha256:1767b3578d65e0df7ad7d035fd12f44c76f11a7db27c7cfd012185e0c5068fcd`. Recreated container with `/run/ct-shadow/entrypoint.sh`; safety `openbot-gateway-rc-prev-acb87127d2-safety`. verify-live PASS. Control UI `index-iwByD4J0.js`. Browser E2E: multi-step message activates progress strip; refresh + offline/online reconnect restore; replay `already_active`; QA/short/reminder/scheduled negatives pass. liveFrom `2026-09-11T22:12:23Z` closes seq 81. Executor cursor-composer. liveVerified=true. Annotated SoT identity tag `provenance/sha-f0dec7222777`. Evidence `docs/design/evidence/ct-production-sync-f0dec722-20260912.json`.

| Field           | Value                                                                                                                                                 |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date            | liveFrom `2026-09-11T22:12:23Z`                                                                                                                       |
| Source revision | `f0dec722277770791a939c0a456242ce62d77763`                                                                                                            |
| Source          | GHCR digest `sha256:1767b3578d65e0df7ad7d035fd12f44c76f11a7db27c7cfd012185e0c5068fcd` / host alias `localhost/openbot:rc-amd64-provenance-f0dec72227` |
| Image digest    | `sha256:1767b3578d65e0df7ad7d035fd12f44c76f11a7db27c7cfd012185e0c5068fcd`                                                                             |
| Provenance      | annotated tag `provenance/sha-f0dec7222777`                                                                                                           |
| Control UI      | `index-iwByD4J0.js`                                                                                                                                   |
| CT flags        | activation/detection/qualification on (allowlist=1); projection/authorization off                                                                     |
| HMAC            | epoch `ct-2026-09-11-host` via entrypoint (value withheld)                                                                                            |
| Governance      | `OPENBOT_EVOLUTION_GOVERNANCE_MODE=assist` (no global auto)                                                                                           |
| Ledger          | `https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl` seq 82; `--live-verified`. Seq 81 closed.   |
| Rollback        | container `openbot-gateway-rc-prev-acb87127d2-safety`; image `localhost/openbot:rc-amd64-provenance-acb87127d2`                                       |
| Executor        | `cursor-composer`                                                                                                                                     |

## Latest cutover (2026-09-12) — seq 81 / acb87127d2 GHCR

User-authorized full-dist recreate from freshly fetched `origin/main` `acb87127d2b3c1a0ecc65a60c5d43d5e55e4c828` (#1089 ConversationTask explicit multi-step L2; also carries #1085 collaboration tenant bot isolation and #1088 workbench chat presentation). Stays **assist**; does **not** enable global auto. Host 8.217.93.71 / `openbot-gateway-rc` image `localhost/openbot:rc-amd64-provenance-acb87127d2` digest `sha256:06e791d0259335f6125b9d510695cbacd79df507faabbbbbfcd51c66884be333`. Pulled `ghcr.io/gmood2008/openbot@sha256:06e791d0259335f6125b9d510695cbacd79df507faabbbbbfcd51c66884be333` (Docker Release 34626100453 amd64). Recreated container with ct-shadow entrypoint preserved; safety `openbot-gateway-rc-prev-d5b2ef9c64-safety`. verify-live PASS. R9 live-image PASS. liveFrom `2026-09-11T17:29:04Z` closes seq 80. Executor cursor-grok. liveVerified=true. Annotated SoT identity tag `provenance/sha-acb87127d2b3`. Live executor / Doctor `--fix` stay closed.

| Field           | Value                                                                                                                                                 |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date            | liveFrom `2026-09-11T17:29:04Z`                                                                                                                       |
| Source revision | `acb87127d2b3c1a0ecc65a60c5d43d5e55e4c828`                                                                                                            |
| Source          | GHCR digest `sha256:06e791d0259335f6125b9d510695cbacd79df507faabbbbbfcd51c66884be333` / host alias `localhost/openbot:rc-amd64-provenance-acb87127d2` |
| Image digest    | `sha256:06e791d0259335f6125b9d510695cbacd79df507faabbbbbfcd51c66884be333`                                                                             |
| Provenance      | annotated tag `provenance/sha-acb87127d2b3`                                                                                                           |
| Control UI      | `index-iwByD4J0.js`                                                                                                                                   |
| Governance      | `OPENBOT_EVOLUTION_GOVERNANCE_MODE=assist` (no global auto)                                                                                           |
| Ledger          | `https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl` seq 81; `--live-verified`. Seq 80 closed.   |
| Rollback        | container `openbot-gateway-rc-prev-d5b2ef9c64-safety`; image `localhost/openbot:rc-amd64-provenance-d5b2ef9c64`                                       |
| Executor        | `cursor-grok`                                                                                                                                         |

## Latest cutover (2026-09-11) — seq 80 / HMAC host rotate on d5b2ef9c

User-authorized host-managed HMAC epoch rotation on the already-running LIVE image `d5b2ef9c644c0931f24026033ce367082ee9da96`. No code cutover and no 1Password. New epoch `ct-2026-09-11-host` is injected by entrypoint from a host `0600` file into PID 1 environ; the value is not in podman `Config.Env`. Old epoch `ct-2026-08` file shredded; 26 maint `env.list` files stripped of HMAC lines. healthz 200 / readyz ready. activation / detection / qualification remain unset. Safety container `openbot-gateway-rc-prev-d5b2ef9c64-prehmac`. Executor cursor-grok. liveFrom `2026-09-11T14:11:51Z` closes seq 79 as the prior code cutover.

| Field           | Value                                                                                                                                               |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date            | liveFrom `2026-09-11T14:11:51Z`                                                                                                                     |
| Source revision | `d5b2ef9c644c0931f24026033ce367082ee9da96` (unchanged)                                                                                              |
| Source          | same image `localhost/openbot:rc-amd64-provenance-d5b2ef9c64` digest `sha256:8b35316de0fc215c91a83e37d19a3b59a39783018f8b9921f9f6b028b5c11f43`      |
| Image digest    | `sha256:8b35316de0fc215c91a83e37d19a3b59a39783018f8b9921f9f6b028b5c11f43`                                                                           |
| Provenance      | existing tag `provenance/sha-d5b2ef9c644c`                                                                                                          |
| HMAC            | `OPENBOT_CT_SHADOW_HMAC_KEY` set (value withheld, 256-bit); `OPENBOT_CT_SHADOW_HMAC_KEY_ID=ct-2026-09-11-host`; not in podman Config.Env            |
| Flags           | activation/detection/qualification unset; projection/authorization off                                                                              |
| Ledger          | `https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl` seq 80; `--live-verified`. Seq 79 closed. |
| Rollback        | container `openbot-gateway-rc-prev-d5b2ef9c64-prehmac`; image unchanged                                                                             |
| Executor        | `cursor-grok`                                                                                                                                       |

## Latest cutover (2026-09-11) — seq 79 / d5b2ef9c644c GHCR

User-authorized full-dist recreate from freshly fetched `origin/main` `d5b2ef9c644c0931f24026033ce367082ee9da96` (#1084 enterprise payable attribution and settlement loop; also carries #1083 seq 78 ledger). Stays **assist**; does **not** enable global auto. Host 8.217.93.71 / `openbot-gateway-rc` image `localhost/openbot:rc-amd64-provenance-d5b2ef9c64` digest `sha256:8b35316de0fc215c91a83e37d19a3b59a39783018f8b9921f9f6b028b5c11f43`. Pulled `ghcr.io/gmood2008/openbot@sha256:8b35316de0fc215c91a83e37d19a3b59a39783018f8b9921f9f6b028b5c11f43` (Docker Release 34595726931 amd64). Recreated container; safety `openbot-gateway-rc-prev-79f2d5f57b-safety`. verify-live PASS. R9 live-image PASS. liveFrom `2026-09-11T12:32:07Z` closes seq 78. Executor cursor-composer. liveVerified=true. Annotated SoT identity tag `provenance/sha-d5b2ef9c644c`. Live executor / Doctor `--fix` stay closed.

| Field           | Value                                                                                                                                                 |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date            | liveFrom `2026-09-11T12:32:07Z`                                                                                                                       |
| Source revision | `d5b2ef9c644c0931f24026033ce367082ee9da96`                                                                                                            |
| Source          | GHCR digest `sha256:8b35316de0fc215c91a83e37d19a3b59a39783018f8b9921f9f6b028b5c11f43` / host alias `localhost/openbot:rc-amd64-provenance-d5b2ef9c64` |
| Image digest    | `sha256:8b35316de0fc215c91a83e37d19a3b59a39783018f8b9921f9f6b028b5c11f43`                                                                             |
| Provenance      | annotated tag `provenance/sha-d5b2ef9c644c`                                                                                                           |
| Control UI      | `index-tvycM9fL.js`                                                                                                                                   |
| Governance      | `OPENBOT_EVOLUTION_GOVERNANCE_MODE=assist` (no global auto)                                                                                           |
| Ledger          | `https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl` seq 79; `--live-verified`. Seq 78 closed.   |
| Rollback        | container `openbot-gateway-rc-prev-79f2d5f57b-safety`; image `localhost/openbot:rc-amd64-provenance-79f2d5f57b`                                       |
| Executor        | `cursor-composer`                                                                                                                                     |

## Latest cutover (2026-09-11) — seq 78 / 79f2d5f57b GHCR

User-authorized full-dist recreate from freshly fetched `origin/main` `79f2d5f57b9170877e24e40b76bb8982f63e4bb1` (#1082 ingest ownership bypass close and authenticated outcome/RAW/promote RPCs). Stays **assist**; does **not** enable global auto. Host 8.217.93.71 / `openbot-gateway-rc` image `localhost/openbot:rc-amd64-provenance-79f2d5f57b` digest `sha256:56ae6ad69fda7c2cb215267a811b6935e0680dfeb90af879388150104381366c`. Pulled `ghcr.io/gmood2008/openbot@sha256:56ae6ad69fda7c2cb215267a811b6935e0680dfeb90af879388150104381366c` (Docker Release 34586592883 amd64). Recreated container; safety `openbot-gateway-rc-prev-d537f2fdce-safety`. verify-live PASS. R9 live-image PASS. liveFrom `2026-09-11T10:24:34Z` closes seq 77. Executor cursor-grok. liveVerified=true. Annotated SoT identity tag `provenance/sha-79f2d5f57b91`. Live executor / Doctor `--fix` stay closed.

| Field           | Value                                                                                                                                                 |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date            | liveFrom `2026-09-11T10:24:34Z`                                                                                                                       |
| Source revision | `79f2d5f57b9170877e24e40b76bb8982f63e4bb1`                                                                                                            |
| Source          | GHCR digest `sha256:56ae6ad69fda7c2cb215267a811b6935e0680dfeb90af879388150104381366c` / host alias `localhost/openbot:rc-amd64-provenance-79f2d5f57b` |
| Image digest    | `sha256:56ae6ad69fda7c2cb215267a811b6935e0680dfeb90af879388150104381366c`                                                                             |
| Provenance      | annotated tag `provenance/sha-79f2d5f57b91`                                                                                                           |
| Control UI      | `index-tvycM9fL.js`                                                                                                                                   |
| Governance      | `OPENBOT_EVOLUTION_GOVERNANCE_MODE=assist` (no global auto)                                                                                           |
| Ledger          | `https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl` seq 78; `--live-verified`. Seq 77 closed.   |
| Rollback        | container `openbot-gateway-rc-prev-d537f2fdce-safety`; image `localhost/openbot:rc-amd64-provenance-d537f2fdce`                                       |
| Executor        | `cursor-grok`                                                                                                                                         |

## Latest cutover (2026-09-11) — seq 77 / d537f2fdce GHCR

User-authorized full-dist recreate from freshly fetched `origin/main` `d537f2fdce97dbc441fe5d02c487668cb7caf8e1` (#1080 Chinese MFA login errors and recovery codes; also carries #1079 email reuse after deleted seats). Stays **assist**; does **not** enable global auto. Host 8.217.93.71 / `openbot-gateway-rc` image `localhost/openbot:rc-amd64-provenance-d537f2fdce` digest `sha256:21e1784e1a8a25e6ae1e9bb96455619dcd76c3aab113cc22dda7246d5eb1ce85`. Pulled `ghcr.io/gmood2008/openbot@sha256:21e1784e1a8a25e6ae1e9bb96455619dcd76c3aab113cc22dda7246d5eb1ce85` (Docker Release 34565632945 amd64). Recreated container; safety `openbot-gateway-rc-prev-c4df1f47bb-safety`. verify-live PASS. R9 live-image PASS. liveFrom `2026-09-11T05:40:39Z` closes seq 76. Executor cursor-grok. liveVerified=true. Annotated SoT identity tag `provenance/sha-d537f2fdce97`. Live executor / Doctor `--fix` stay closed.

| Field           | Value                                                                                                                                                 |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date            | liveFrom `2026-09-11T05:40:39Z`                                                                                                                       |
| Source revision | `d537f2fdce97dbc441fe5d02c487668cb7caf8e1`                                                                                                            |
| Source          | GHCR digest `sha256:21e1784e1a8a25e6ae1e9bb96455619dcd76c3aab113cc22dda7246d5eb1ce85` / host alias `localhost/openbot:rc-amd64-provenance-d537f2fdce` |
| Image digest    | `sha256:21e1784e1a8a25e6ae1e9bb96455619dcd76c3aab113cc22dda7246d5eb1ce85`                                                                             |
| Provenance      | annotated tag `provenance/sha-d537f2fdce97`                                                                                                           |
| Control UI      | `index-D_VTujI8.js`                                                                                                                                   |
| Governance      | `OPENBOT_EVOLUTION_GOVERNANCE_MODE=assist` (no global auto)                                                                                           |
| Ledger          | `https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl` seq 77; `--live-verified`. Seq 76 closed.   |
| Rollback        | container `openbot-gateway-rc-prev-c4df1f47bb-safety`; image `localhost/openbot:rc-amd64-provenance-c4df1f47bb`                                       |
| Executor        | `cursor-grok`                                                                                                                                         |

## Latest cutover (2026-09-11) — seq 76 / c4df1f47bb GHCR

User-authorized full-dist recreate from freshly fetched `origin/main` `c4df1f47bb46a263e2161606ae3e263e465def72` (#1076 employee invite links on www/me and no duplicate activation mail; also carries #1073–#1075 / #1077). Stays **assist**; does **not** enable global auto. Host 8.217.93.71 / `openbot-gateway-rc` image `localhost/openbot:rc-amd64-provenance-c4df1f47bb` digest `sha256:f607e4ce3b7fb96309768e57d99a9bc02efd7023848a8f16d1944069c2b218af`. Pulled `ghcr.io/gmood2008/openbot@sha256:f607e4ce3b7fb96309768e57d99a9bc02efd7023848a8f16d1944069c2b218af` (Docker Release 34555762470 amd64). Recreated container; safety `openbot-gateway-rc-prev-e4a2679da2-safety`. verify-live PASS. R9 PASS. liveFrom `2026-09-11T03:22:25Z` closes seq 75. Executor cursor-grok. liveVerified=true. Annotated SoT identity tag `provenance/sha-c4df1f47bb46`. Live executor / Doctor `--fix` stay closed.

| Field           | Value                                                                                                                                                 |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date            | liveFrom `2026-09-11T03:22:25Z`                                                                                                                       |
| Source revision | `c4df1f47bb46a263e2161606ae3e263e465def72`                                                                                                            |
| Source          | GHCR digest `sha256:f607e4ce3b7fb96309768e57d99a9bc02efd7023848a8f16d1944069c2b218af` / host alias `localhost/openbot:rc-amd64-provenance-c4df1f47bb` |
| Image digest    | `sha256:f607e4ce3b7fb96309768e57d99a9bc02efd7023848a8f16d1944069c2b218af`                                                                             |
| Provenance      | annotated tag `provenance/sha-c4df1f47bb46`                                                                                                           |
| Control UI      | `index-CtfXQDSz.js`                                                                                                                                   |
| Governance      | `OPENBOT_EVOLUTION_GOVERNANCE_MODE=assist` (no global auto)                                                                                           |
| Ledger          | `https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl` seq 76; `--live-verified`. Seq 75 closed.   |
| Rollback        | container `openbot-gateway-rc-prev-e4a2679da2-safety`; image `localhost/openbot:rc-amd64-provenance-e4a2679da2`                                       |
| Executor        | `cursor-grok`                                                                                                                                         |

## Latest cutover (2026-09-10) — seq 75 / e4a2679da2 GHCR

User-authorized full-dist recreate from freshly fetched `origin/main` `e4a2679da2729e39f95c8994912cfb35b8d1cf07` (#1072 My Assets installable-only; also carries #1062–#1067 / #1070–#1071). Stays **assist**; does **not** enable global auto. Host 8.217.93.71 / `openbot-gateway-rc` image `localhost/openbot:rc-amd64-provenance-e4a2679da2` digest `sha256:3ff93d10fad9517f2de4bc48aee9d6ed8092d7cd7eaeffdb18ef67f3b0cb084e`. Pulled `ghcr.io/gmood2008/openbot@sha256:3ff93d10fad9517f2de4bc48aee9d6ed8092d7cd7eaeffdb18ef67f3b0cb084e` (Docker Release 34537983263 amd64). Recreated container; safety `openbot-gateway-rc-prev-4a3853899c-safety`. Pre-cutover running SHA was `4a3853899c5749ff46ced8f7a3216ec0e0c544c3` (unledgered hop after seq 74). verify-live PASS. R9 PASS. liveFrom `2026-09-10T22:43:40Z` closes seq 74. Executor cursor-grok. liveVerified=true. Annotated SoT identity tag `provenance/sha-e4a2679da272`. Live executor / Doctor `--fix` stay closed.

| Field           | Value                                                                                                                                                 |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date            | liveFrom `2026-09-10T22:43:40Z`                                                                                                                       |
| Source revision | `e4a2679da2729e39f95c8994912cfb35b8d1cf07`                                                                                                            |
| Source          | GHCR digest `sha256:3ff93d10fad9517f2de4bc48aee9d6ed8092d7cd7eaeffdb18ef67f3b0cb084e` / host alias `localhost/openbot:rc-amd64-provenance-e4a2679da2` |
| Image digest    | `sha256:3ff93d10fad9517f2de4bc48aee9d6ed8092d7cd7eaeffdb18ef67f3b0cb084e`                                                                             |
| Provenance      | annotated tag `provenance/sha-e4a2679da272`                                                                                                           |
| Control UI      | `index-CUiQ_-0f.js`                                                                                                                                   |
| Governance      | `OPENBOT_EVOLUTION_GOVERNANCE_MODE=assist` (no global auto)                                                                                           |
| Ledger          | `https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl` seq 75; `--live-verified`. Seq 74 closed.   |
| Rollback        | container `openbot-gateway-rc-prev-4a3853899c-safety`; image `localhost/openbot:rc-amd64-provenance-4a3853899c`                                       |
| Executor        | `cursor-grok`                                                                                                                                         |

## Latest cutover (2026-09-10) — seq 74 / cfe9d22ee1 GHCR

User-authorized full-dist recreate from freshly fetched `origin/main` `cfe9d22ee1481de6e6ed3c0f2fef48c48191568a` (#1058 seq 73 ledger after #1057). Stays **assist**; does **not** enable global auto. Host 8.217.93.71 / `openbot-gateway-rc` image `localhost/openbot:rc-amd64-provenance-cfe9d22ee1` digest `sha256:5f00bd997a527283bb5918b5b108625b978408d2232ec8d450418f07821cb308`. Pulled `ghcr.io/gmood2008/openbot@sha256:5f00bd997a527283bb5918b5b108625b978408d2232ec8d450418f07821cb308` (Docker Release 34435654227 amd64). Recreated container; safety `openbot-gateway-rc-prev-7a6416cdfe-safety`. verify-live PASS. R9 PASS. liveFrom `2026-09-10T05:42:25Z` closes seq 73. Executor cursor-grok. liveVerified=true. Annotated SoT identity tag `provenance/sha-cfe9d22ee148`. Live executor / Doctor `--fix` stay closed.

| Field           | Value                                                                                                                                                 |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date            | liveFrom `2026-09-10T05:42:25Z`                                                                                                                       |
| Source revision | `cfe9d22ee1481de6e6ed3c0f2fef48c48191568a`                                                                                                            |
| Source          | GHCR digest `sha256:5f00bd997a527283bb5918b5b108625b978408d2232ec8d450418f07821cb308` / host alias `localhost/openbot:rc-amd64-provenance-cfe9d22ee1` |
| Image digest    | `sha256:5f00bd997a527283bb5918b5b108625b978408d2232ec8d450418f07821cb308`                                                                             |
| Provenance      | annotated tag `provenance/sha-cfe9d22ee148`                                                                                                           |
| Control UI      | `index-wcFq7WbB.js`                                                                                                                                   |
| Governance      | `OPENBOT_EVOLUTION_GOVERNANCE_MODE=assist` (no global auto)                                                                                           |
| Ledger          | `https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl` seq 74; `--live-verified`. Seq 73 closed.   |
| Rollback        | container `openbot-gateway-rc-prev-7a6416cdfe-safety`; image `localhost/openbot:rc-amd64-provenance-7a6416cdfe`                                       |
| Executor        | `cursor-grok`                                                                                                                                         |

## Latest cutover (2026-09-10) — seq 73 / 7a6416cdfe GHCR

User-authorized full-dist recreate from freshly fetched `origin/main` `7a6416cdfe3588848868d9c69d55518f65d2c6ef` (#1057 hide collaboration speaker/mention 释义; also carries #1056 knowledge_search tools). Stays **assist**; does **not** enable global auto. Host 8.217.93.71 / `openbot-gateway-rc` image `localhost/openbot:rc-amd64-provenance-7a6416cdfe` digest `sha256:b00a4277b943243a82a98c5cce031b5f252543f24492f59142cf570f43944416`. Pulled `ghcr.io/gmood2008/openbot@sha256:b00a4277b943243a82a98c5cce031b5f252543f24492f59142cf570f43944416` (Docker Release 34431483805 amd64). Recreated container; safety `openbot-gateway-rc-prev-aac4d9884d-safety`. Pre-cutover running SHA was `aac4d9884db2230c8543ad29bd60fc0dc519f75a` (unledgered hop after seq 72). verify-live PASS. R9 PASS. liveFrom `2026-09-10T03:10:13Z` closes seq 72. Executor cursor-grok. liveVerified=true. Annotated SoT identity tag `provenance/sha-7a6416cdfe35`. Live executor / Doctor `--fix` stay closed.

| Field           | Value                                                                                                                                                 |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date            | liveFrom `2026-09-10T03:10:13Z`                                                                                                                       |
| Source revision | `7a6416cdfe3588848868d9c69d55518f65d2c6ef`                                                                                                            |
| Source          | GHCR digest `sha256:b00a4277b943243a82a98c5cce031b5f252543f24492f59142cf570f43944416` / host alias `localhost/openbot:rc-amd64-provenance-7a6416cdfe` |
| Image digest    | `sha256:b00a4277b943243a82a98c5cce031b5f252543f24492f59142cf570f43944416`                                                                             |
| Provenance      | annotated tag `provenance/sha-7a6416cdfe35`                                                                                                           |
| Control UI      | `index-wcFq7WbB.js`                                                                                                                                   |
| Governance      | `OPENBOT_EVOLUTION_GOVERNANCE_MODE=assist` (no global auto)                                                                                           |
| Ledger          | `https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl` seq 73; `--live-verified`. Seq 72 closed.   |
| Rollback        | container `openbot-gateway-rc-prev-aac4d9884d-safety`; image `localhost/openbot:rc-amd64-provenance-aac4d9884d`                                       |
| Executor        | `cursor-grok`                                                                                                                                         |

## Latest cutover (2026-09-09) — seq 72 / 470336cd0c GHCR

User-authorized full-dist recreate from freshly fetched `origin/main` `470336cd0c0a48d2e341985296698f838f2ec0f6` (#1044 seq 71 ledger + #1045 group language follow-up / hide infra chat noise + #1046 selected KB consume). Stays **assist**; does **not** enable global auto. Does **not** include open #1047. Host 8.217.93.71 / `openbot-gateway-rc` image `localhost/openbot:rc-amd64-provenance-470336cd0c` digest `sha256:b2e7f559a74323370d34d9d67f3828a52d1c241dd36d0b5b34bae875caecfd32`. Pulled `ghcr.io/gmood2008/openbot@sha256:b2e7f559a74323370d34d9d67f3828a52d1c241dd36d0b5b34bae875caecfd32` (Docker Release 34344368823 amd64). Recreated container; safety `openbot-gateway-rc-prev-74fe2064ba-safety`. verify-live PASS. R9 PASS. liveFrom `2026-09-09T13:05:01Z` closes seq 71. Executor cursor-grok. liveVerified=true. Annotated SoT identity tag `provenance/sha-470336cd0c0a`. Live executor / Doctor `--fix` stay closed.

| Field           | Value                                                                                                                                                 |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date            | liveFrom `2026-09-09T13:05:01Z`                                                                                                                       |
| Source revision | `470336cd0c0a48d2e341985296698f838f2ec0f6`                                                                                                            |
| Source          | GHCR digest `sha256:b2e7f559a74323370d34d9d67f3828a52d1c241dd36d0b5b34bae875caecfd32` / host alias `localhost/openbot:rc-amd64-provenance-470336cd0c` |
| Image digest    | `sha256:b2e7f559a74323370d34d9d67f3828a52d1c241dd36d0b5b34bae875caecfd32`                                                                             |
| Provenance      | annotated tag `provenance/sha-470336cd0c0a`                                                                                                           |
| Control UI      | `index-DxnkqSrE.js`                                                                                                                                   |
| Governance      | `OPENBOT_EVOLUTION_GOVERNANCE_MODE=assist` (no global auto)                                                                                           |
| Ledger          | `https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl` seq 72; `--live-verified`. Seq 71 closed.   |
| Rollback        | container `openbot-gateway-rc-prev-74fe2064ba-safety`; image `localhost/openbot:rc-amd64-provenance-74fe2064ba`                                       |
| Executor        | `cursor-grok`                                                                                                                                         |

## Latest cutover (2026-09-09) — seq 71 / 74fe2064ba GHCR

User-authorized full-dist recreate from freshly fetched `origin/main` `74fe2064ba11a03a9383c8d3522e0393f142fd95` (#1040 drop preview composer + #1041 owner-chosen coordinator/shared KB + #1042 native WeChat bind without QR + #1043 drop duplicate group finals and preview markdown deliverables). Stays **assist**; does **not** enable global auto. Host 8.217.93.71 / `openbot-gateway-rc` image `localhost/openbot:rc-amd64-provenance-74fe2064ba` digest `sha256:6f550f7dc61e53ea6aa006391a25f7b89aecb739d27a1a93e203effa9daa79ab`. Pulled `ghcr.io/gmood2008/openbot@sha256:6f550f7dc61e53ea6aa006391a25f7b89aecb739d27a1a93e203effa9daa79ab` (Docker Release 34306806424 amd64). Recreated container; safety `openbot-gateway-rc-prev-3cbd21a9e1-safety`. verify-live PASS. R9 PASS. liveFrom `2026-09-09T03:34:54Z` closes seq 70. Executor cursor-grok. liveVerified=true. Annotated SoT identity tag `provenance/sha-74fe2064ba11`. Live executor / Doctor `--fix` stay closed.

| Field           | Value                                                                                                                                                 |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date            | liveFrom `2026-09-09T03:34:54Z`                                                                                                                       |
| Source revision | `74fe2064ba11a03a9383c8d3522e0393f142fd95`                                                                                                            |
| Source          | GHCR digest `sha256:6f550f7dc61e53ea6aa006391a25f7b89aecb739d27a1a93e203effa9daa79ab` / host alias `localhost/openbot:rc-amd64-provenance-74fe2064ba` |
| Image digest    | `sha256:6f550f7dc61e53ea6aa006391a25f7b89aecb739d27a1a93e203effa9daa79ab`                                                                             |
| Provenance      | annotated tag `provenance/sha-74fe2064ba11`                                                                                                           |
| Control UI      | `index-DxnkqSrE.js`                                                                                                                                   |
| Governance      | `OPENBOT_EVOLUTION_GOVERNANCE_MODE=assist` (no global auto)                                                                                           |
| Ledger          | `https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl` seq 71; `--live-verified`. Seq 70 closed.   |
| Rollback        | container `openbot-gateway-rc-prev-3cbd21a9e1-safety`; image `localhost/openbot:rc-amd64-provenance-3cbd21a9e1`                                       |
| Executor        | `cursor-grok`                                                                                                                                         |

## Latest cutover (2026-09-08) — seq 70 / 3cbd21a9e1 GHCR

User-authorized full-dist recreate from freshly fetched `origin/main` `3cbd21a9e10f0b5ab3f6850fc4d7b2e9b588fceb` (#1037 host-adapt + settings list cleanup + artifact preview sidebar polish + #1038 groupId from bot space session keys). Stays **assist**; does **not** enable global auto. Host 8.217.93.71 / `openbot-gateway-rc` image `localhost/openbot:rc-amd64-provenance-3cbd21a9e1` digest `sha256:47313b2b659d1470d9bebc06d45cd6445a5f42ac5b0daa1c8fc1ebec61e7f788`. Pulled `ghcr.io/gmood2008/openbot@sha256:47313b2b659d1470d9bebc06d45cd6445a5f42ac5b0daa1c8fc1ebec61e7f788` (Docker Release 34238681008 amd64). Recreated container; safety `openbot-gateway-rc-prev-68271086f7-safety`. verify-live PASS. R9 PASS. liveFrom `2026-09-08T15:24:22Z` closes seq 69. Executor cursor-grok. liveVerified=true. Annotated SoT identity tag `provenance/sha-3cbd21a9e10f`. Pre-cutover running SHA was `68271086f74b` (unledgered hop after seq 69). Live executor / Doctor `--fix` stay closed.

| Field           | Value                                                                                                                                                 |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date            | liveFrom `2026-09-08T15:24:22Z`                                                                                                                       |
| Source revision | `3cbd21a9e10f0b5ab3f6850fc4d7b2e9b588fceb`                                                                                                            |
| Source          | GHCR digest `sha256:47313b2b659d1470d9bebc06d45cd6445a5f42ac5b0daa1c8fc1ebec61e7f788` / host alias `localhost/openbot:rc-amd64-provenance-3cbd21a9e1` |
| Image digest    | `sha256:47313b2b659d1470d9bebc06d45cd6445a5f42ac5b0daa1c8fc1ebec61e7f788`                                                                             |
| Provenance      | annotated tag `provenance/sha-3cbd21a9e10f`                                                                                                           |
| Control UI      | `index-E66c70ZW.js`                                                                                                                                   |
| Governance      | `OPENBOT_EVOLUTION_GOVERNANCE_MODE=assist` (no global auto)                                                                                           |
| Ledger          | `https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl` seq 70; `--live-verified`. Seq 69 closed.   |
| Rollback        | container `openbot-gateway-rc-prev-68271086f7-safety`; image `localhost/openbot:rc-amd64-provenance-68271086f7`                                       |
| Executor        | `cursor-grok`                                                                                                                                         |

## Latest cutover (2026-09-08) — seq 69 / 05fe958325 GHCR

User-authorized full-dist recreate from freshly fetched `origin/main` `05fe958325f379ceef16e146d57cedc953d328d9` (#1033 seq 68 ledger + #1034 ChatTurn isolation and first-reference knowledge index). Stays **assist**; does **not** enable global auto. Host 8.217.93.71 / `openbot-gateway-rc` image `localhost/openbot:rc-amd64-provenance-05fe958325` digest `sha256:34b70749cdee171afd551bfb4d4d350410cf332667b84833dde978ba3d0823f2`. Pulled `ghcr.io/gmood2008/openbot@sha256:34b70749cdee171afd551bfb4d4d350410cf332667b84833dde978ba3d0823f2` (Docker Release 34182829589 amd64). Recreated container; safety `openbot-gateway-rc-prev-882d2d22f8-safety`. verify-live PASS. R9 PASS. liveFrom `2026-09-08T03:29:15Z` closes seq 68. Executor cursor-grok. liveVerified=true. Annotated SoT identity tag `provenance/sha-05fe958325f3`. Live executor / Doctor `--fix` stay closed.

| Field           | Value                                                                                                                                                 |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date            | liveFrom `2026-09-08T03:29:15Z`                                                                                                                       |
| Source revision | `05fe958325f379ceef16e146d57cedc953d328d9`                                                                                                            |
| Source          | GHCR digest `sha256:34b70749cdee171afd551bfb4d4d350410cf332667b84833dde978ba3d0823f2` / host alias `localhost/openbot:rc-amd64-provenance-05fe958325` |
| Image digest    | `sha256:34b70749cdee171afd551bfb4d4d350410cf332667b84833dde978ba3d0823f2`                                                                             |
| Provenance      | annotated tag `provenance/sha-05fe958325f3`                                                                                                           |
| Control UI      | `index-DVERNwfZ.js`                                                                                                                                   |
| Governance      | `OPENBOT_EVOLUTION_GOVERNANCE_MODE=assist` (no global auto)                                                                                           |
| Ledger          | `https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl` seq 69; `--live-verified`. Seq 68 closed.   |
| Rollback        | container `openbot-gateway-rc-prev-882d2d22f8-safety`; image `localhost/openbot:rc-amd64-provenance-882d2d22f8`                                       |
| Executor        | `cursor-grok`                                                                                                                                         |

## Latest cutover (2026-09-08) — seq 68 / 882d2d22f8 GHCR

User-authorized full-dist recreate from freshly fetched `origin/main` `882d2d22f8c5b0689276cc81f55e2b4b1112c8ef` (#1029 P26.5 readonly + #1030 live sensors + #1031 unification archive + #1032 Control UI docker-build unblock). Stays **assist**; does **not** enable global auto. P26.5 `approvedForProductionCutover` stays false. Host 8.217.93.71 / `openbot-gateway-rc` image `localhost/openbot:rc-amd64-provenance-882d2d22f8` digest `sha256:a8890fafdecff7b4da200342305eedd2cab26cef780b7149ecf8fb9c7e675387`. Pulled `ghcr.io/gmood2008/openbot@sha256:a8890fafdecff7b4da200342305eedd2cab26cef780b7149ecf8fb9c7e675387` (manual `openbot-manual` linux/amd64; GitHub-hosted Docker Release billed out). Recreated container; safety `openbot-gateway-rc-prev-7e41fecc42-safety`. verify-live PASS. R9 PASS. liveFrom `2026-09-07T23:12:12Z` closes seq 67. Executor cursor-grok. liveVerified=true. Annotated SoT identity tag `provenance/sha-882d2d22f8c5`. Live executor / Doctor `--fix` stay closed.

| Field           | Value                                                                                                                                                 |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date            | liveFrom `2026-09-07T23:12:12Z`                                                                                                                       |
| Source revision | `882d2d22f8c5b0689276cc81f55e2b4b1112c8ef`                                                                                                            |
| Source          | GHCR digest `sha256:a8890fafdecff7b4da200342305eedd2cab26cef780b7149ecf8fb9c7e675387` / host alias `localhost/openbot:rc-amd64-provenance-882d2d22f8` |
| Image digest    | `sha256:a8890fafdecff7b4da200342305eedd2cab26cef780b7149ecf8fb9c7e675387`                                                                             |
| Provenance      | annotated tag `provenance/sha-882d2d22f8c5`                                                                                                           |
| Control UI      | `index-DLuLgm-z.js`                                                                                                                                   |
| Governance      | `OPENBOT_EVOLUTION_GOVERNANCE_MODE=assist` (no global auto)                                                                                           |
| Ledger          | `https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl` seq 68; `--live-verified`. Seq 67 closed.   |
| Rollback        | container `openbot-gateway-rc-prev-7e41fecc42-safety`; image `localhost/openbot:rc-amd64-provenance-7e41fecc42`                                       |
| Executor        | `cursor-grok`                                                                                                                                         |

## Latest cutover (2026-09-07) — seq 67 / 7e41fecc42 GHCR

Historical backfill of the already-running LIVE after #1026 and #1027. Does not mint a new cutover or image. Observed `openbot-gateway-rc` `build-info.commit=7e41fecc4241e46a1336f65185a5cf257e5f2ae4` / `2026.7.12-rc.2`. Host 8.217.93.71 image `localhost/openbot:rc-amd64-provenance-7e41fecc42` digest `sha256:e8884526be7982918c084584db4454145f1a8efa37ba98eeb1ad5afc9e1b1804`. Pulled `ghcr.io/gmood2008/openbot@sha256:e8884526be7982918c084584db4454145f1a8efa37ba98eeb1ad5afc9e1b1804` (Docker Release 34140241890 amd64). Recreated container; safety `openbot-gateway-rc-prev-8b5db08ee1-safety`. verify-live PASS. R9 PASS. liveFrom `2026-09-07T16:04:59Z` closes seq 66. Executor cursor-grok. liveVerified=true. Annotated SoT identity tag `provenance/sha-7e41fecc4241`. Stays **assist**; does **not** enable global auto. Includes P26.4 official diagnosis admission; live executor / Doctor `--fix` stay closed.

| Field           | Value                                                                                                                                                 |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date            | liveFrom `2026-09-07T16:04:59Z`                                                                                                                       |
| Source revision | `7e41fecc4241e46a1336f65185a5cf257e5f2ae4`                                                                                                            |
| Source          | GHCR digest `sha256:e8884526be7982918c084584db4454145f1a8efa37ba98eeb1ad5afc9e1b1804` / host alias `localhost/openbot:rc-amd64-provenance-7e41fecc42` |
| Image digest    | `sha256:e8884526be7982918c084584db4454145f1a8efa37ba98eeb1ad5afc9e1b1804`                                                                             |
| Provenance      | annotated tag `provenance/sha-7e41fecc4241`                                                                                                           |
| Control UI      | `index-B-aaozb7.js`                                                                                                                                   |
| Governance      | `OPENBOT_EVOLUTION_GOVERNANCE_MODE=assist` (no global auto)                                                                                           |
| Ledger          | `https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl` seq 67; `--live-verified`. Seq 66 closed.   |
| Rollback        | container `openbot-gateway-rc-prev-8b5db08ee1-safety`; image `localhost/openbot:rc-amd64-provenance-8b5db08ee1`                                       |
| Executor        | `cursor-grok`                                                                                                                                         |

## Latest cutover (2026-09-07) — seq 66 / 8b5db08ee1 GHCR

Historical reconstruction of the already-cut I2 hop. Does not mint a new cutover or image. Host leftover `openbot-gateway-rc-prev-8b5db08ee1-safety` Created/StartedAt `2026-09-07T14:29:34Z` FinishedAt `2026-09-07T16:04:59Z`. Image `localhost/openbot:rc-amd64-provenance-8b5db08ee1` digest `sha256:1390775cbf05081c95236ee75e84e30f6cf8855aa82ce97c2063a0024a66f570`. Pulled `ghcr.io/gmood2008/openbot@sha256:1390775cbf05081c95236ee75e84e30f6cf8855aa82ce97c2063a0024a66f570` (Docker Release 34132195155 amd64). Recreated container; safety `openbot-gateway-rc-prev-98a9a6c743-safety`. Contemporaneous verify-live PASS and R9 PASS at cutover. liveFrom `2026-09-07T14:29:34Z` closes seq 65. Executor cursor-grok. liveVerified=false (`--unverified-backfill`: no longer the running LIVE). Annotated SoT identity tag `provenance/sha-8b5db08ee149`. Shadow I2 record wiring; stays **assist**.

| Field           | Value                                                                                                                                                     |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date            | liveFrom `2026-09-07T14:29:34Z`                                                                                                                           |
| Source revision | `8b5db08ee149db694a47210d4e65bd0958ffdcd3`                                                                                                                |
| Source          | GHCR digest `sha256:1390775cbf05081c95236ee75e84e30f6cf8855aa82ce97c2063a0024a66f570` / host alias `localhost/openbot:rc-amd64-provenance-8b5db08ee1`     |
| Image digest    | `sha256:1390775cbf05081c95236ee75e84e30f6cf8855aa82ce97c2063a0024a66f570`                                                                                 |
| Provenance      | annotated tag `provenance/sha-8b5db08ee149`                                                                                                               |
| Control UI      | `index-B-aaozb7.js`                                                                                                                                       |
| Governance      | `OPENBOT_EVOLUTION_GOVERNANCE_MODE=assist` (no global auto)                                                                                               |
| Ledger          | `https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl` seq 66; `--unverified-backfill`. Seq 65 closed. |
| Rollback        | container `openbot-gateway-rc-prev-98a9a6c743-safety`; image `localhost/openbot:rc-amd64-provenance-98a9a6c743`                                           |
| Executor        | `cursor-grok`                                                                                                                                             |

## Latest cutover (2026-09-07) — seq 65 / 98a9a6c743 GHCR

User-authorized full-dist recreate from freshly fetched `origin/main` `98a9a6c743ff9f5f3c564ac6c4a534735a2467e4` (#1023 Docker compile fix + #1024 RC11 evidence). First eligible-data evolution control-plane deploy. Stays **assist**; does **not** enable global auto. Host 8.217.93.71 / `openbot-gateway-rc` image `localhost/openbot:rc-amd64-provenance-98a9a6c743` digest `sha256:7fb253f506a34de95eb05f446f8c08779e3c558be5022c93a6c84dc70eb17bfd`. Pulled `ghcr.io/gmood2008/openbot@sha256:7fb253f506a34de95eb05f446f8c08779e3c558be5022c93a6c84dc70eb17bfd` (Docker Release 34126114137 amd64). Recreated container; safety `openbot-gateway-rc-prev-7d3fdf5bfe-safety`. verify-live PASS. R9 PASS. liveFrom `2026-09-07T13:55:51Z` closes seq 64. Executor cursor-grok. liveVerified=true. Annotated SoT identity tag `provenance/sha-98a9a6c743ff`. Capsule remains `accepted_permanent_exclusion`. Unsupported surfaces stay fail-closed.

| Field           | Value                                                                                                                                                 |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date            | liveFrom `2026-09-07T13:55:51Z`                                                                                                                       |
| Source revision | `98a9a6c743ff9f5f3c564ac6c4a534735a2467e4`                                                                                                            |
| Source          | GHCR digest `sha256:7fb253f506a34de95eb05f446f8c08779e3c558be5022c93a6c84dc70eb17bfd` / host alias `localhost/openbot:rc-amd64-provenance-98a9a6c743` |
| Image digest    | `sha256:7fb253f506a34de95eb05f446f8c08779e3c558be5022c93a6c84dc70eb17bfd`                                                                             |
| Provenance      | annotated tag `provenance/sha-98a9a6c743ff`                                                                                                           |
| Control UI      | `index-B-aaozb7.js`                                                                                                                                   |
| Governance      | `OPENBOT_EVOLUTION_GOVERNANCE_MODE=assist` (no global auto)                                                                                           |
| Ledger          | `https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl` seq 65; `--live-verified`. Seq 64 closed.   |
| Rollback        | container `openbot-gateway-rc-prev-7d3fdf5bfe-safety`; image `localhost/openbot:rc-amd64-provenance-7d3fdf5bfe`                                       |
| Executor        | `cursor-grok`                                                                                                                                         |

## Latest cutover (2026-09-05) — seq 64 / 7d3fdf5bfe GHCR

User-authorized unified-window full-dist recreate from freshly fetched `origin/main` `7d3fdf5bfef57077f7956ccab07c3c960984331b` (#976 and earlier trunk, including conversation peek rail). Diagnosis rode dark: four functional gates stayed false. Host 8.217.93.71 / `openbot-gateway-rc` image `localhost/openbot:rc-amd64-provenance-7d3fdf5bfe` digest `sha256:db7b64563e591e0887915f2d9bbef2cb8130e77f5940ac7dcbb5dd817ffd044c`. Pulled `ghcr.io/gmood2008/openbot@sha256:db7b64563e591e0887915f2d9bbef2cb8130e77f5940ac7dcbb5dd817ffd044c` (Docker Release 33964634140 amd64). Recreated container; safety `openbot-gateway-rc-prev-04690f8d2e-safety`. verify-live PASS. liveFrom `2026-09-05T12:08:51Z` closes seq 63. Executor delivery. liveVerified=true. Annotated SoT identity tag `provenance/sha-7d3fdf5bfef5`. Does **not** open diagnosis gates, bind live chat, enable Da Bai, or start P25.

| Field           | Value                                                                                                                                                 |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date            | liveFrom `2026-09-05T12:08:51Z`                                                                                                                       |
| Source revision | `7d3fdf5bfef57077f7956ccab07c3c960984331b`                                                                                                            |
| Source          | GHCR digest `sha256:db7b64563e591e0887915f2d9bbef2cb8130e77f5940ac7dcbb5dd817ffd044c` / host alias `localhost/openbot:rc-amd64-provenance-7d3fdf5bfe` |
| Image digest    | `sha256:db7b64563e591e0887915f2d9bbef2cb8130e77f5940ac7dcbb5dd817ffd044c`                                                                             |
| Provenance      | annotated tag `provenance/sha-7d3fdf5bfef5`                                                                                                           |
| Control UI      | `index-Ch6EMLgY.js`                                                                                                                                   |
| Ledger          | `https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl` seq 64; `--live-verified`. Seq 63 closed.   |
| Rollback        | container `openbot-gateway-rc-prev-04690f8d2e-safety`; image `localhost/openbot:rc-amd64-provenance-04690f8d2e`                                       |
| Executor        | `delivery`                                                                                                                                            |

## Latest cutover (2026-09-04) — seq 63 / 04690f8d2e GHCR

Human Latest cutover backfill of the existing open `https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl` seq 63 row. Does not mint a new cutover or image. Observed `openbot-gateway-rc` `build-info.commit=04690f8d2ed51f24a06825c153b7c1885d17182a` / `2026.7.12-rc.2`. Host 8.217.93.71 image localhost/openbot:rc-amd64-provenance-04690f8d2e digest sha256:f9775147138b1f8d733c95c2e708ddc00b26d88a74af534b49274526b22da4f1. Pulled ghcr.io/gmood2008/openbot@sha256:f9775147138b1f8d733c95c2e708ddc00b26d88a74af534b49274526b22da4f1 (Docker Release 33873637887). Recreated container; safety openbot-gateway-rc-prev-81aafe1e21-safety. verify-live PASS. liveFrom 2026-09-04T13:39:37Z closes seq 62. Executor cursor-grok. liveVerified=true. Ledger row keeps `tag=main`. Annotated SoT identity tag `provenance/sha-04690f8d2ed5` names the already-running LIVE commit.

| Field           | Value                                                                                                                                                 |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date            | liveFrom `2026-09-04T13:39:37Z`                                                                                                                       |
| Source revision | `04690f8d2ed51f24a06825c153b7c1885d17182a`                                                                                                            |
| Source          | GHCR digest `sha256:f9775147138b1f8d733c95c2e708ddc00b26d88a74af534b49274526b22da4f1` / host alias `localhost/openbot:rc-amd64-provenance-04690f8d2e` |
| Image digest    | `sha256:f9775147138b1f8d733c95c2e708ddc00b26d88a74af534b49274526b22da4f1`                                                                             |
| Provenance      | annotated tag `provenance/sha-04690f8d2ed5` (SoT identity for already-running LIVE; ledger `tag=main`)                                                |
| Control UI      | `index-D68V9vJz.js`                                                                                                                                   |
| Ledger          | `https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl` seq 63; `--live-verified`. Seq 62 closed.   |
| Executor        | `cursor-grok`                                                                                                                                         |

## Latest cutover (2026-09-04) — seq 61 / e59aede250 GHCR

Record of the already-running LIVE container. Does not mint a new image or cut over again. Observed `openbot-gateway-rc` `build-info.commit=e59aede2506dbe8c571f0019f7e1bac0687778b6` / `2026.7.12-rc.2`. Host 8.217.93.71 image localhost/openbot:rc-amd64-provenance-e59aede250 digest sha256:314be4cd76f7d06c4028f0c430afada99d1c5bcbb010353b4c764465597a7423. Pulled ghcr.io/gmood2008/openbot@sha256:314be4cd76f7d06c4028f0c430afada99d1c5bcbb010353b4c764465597a7423 (Docker Release 33843104164). Recreated container; safety openbot-gateway-rc-prev-457057ba2a-safety. verify-live PASS. liveFrom 2026-09-04T06:53:46Z closes seq 60. Executor cursor-grok. liveVerified=true. Annotated tag `provenance/sha-e59aede2506d`.

| Field           | Value                                                                                                                                                 |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date            | liveFrom `2026-09-04T06:53:46Z`                                                                                                                       |
| Source revision | `e59aede2506dbe8c571f0019f7e1bac0687778b6`                                                                                                            |
| Source          | GHCR digest `sha256:314be4cd76f7d06c4028f0c430afada99d1c5bcbb010353b4c764465597a7423` / host alias `localhost/openbot:rc-amd64-provenance-e59aede250` |
| Image digest    | `sha256:314be4cd76f7d06c4028f0c430afada99d1c5bcbb010353b4c764465597a7423`                                                                             |
| Provenance      | annotated tag `provenance/sha-e59aede2506d`                                                                                                           |
| Control UI      | `index-Pt6WG8nT.js`                                                                                                                                   |
| Ledger          | `https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl` seq 61; `--live-verified`. Seq 60 closed.   |
| Executor        | `cursor-grok`                                                                                                                                         |

## Latest cutover (2026-09-04) — seq 59 / 3d03d3b4 GHCR

Human Latest cutover backfill of the existing open `https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl` seq 59 row. Does not mint a new cutover, tag, or image. User-authorized origin/main full-dist after #927. Host 8.217.93.71 / openbot-gateway-rc image localhost/openbot:rc-amd64-provenance-3d03d3b4df digest sha256:1881c4a8d5739c84d40a668dc4fb2c8cfeb3084de0c221881fd2a58c03e00e6e OCI revision 3d03d3b4df91ab0bfaa33900eba95287c1ab30d2. Pulled ghcr.io/gmood2008/openbot@sha256:1881c4a8d5739c84d40a668dc4fb2c8cfeb3084de0c221881fd2a58c03e00e6e (amd64 sha256:eb7eb4537d2a18d85f755f33dd842633cd3393b79f2661323e159fce2fac3912; Docker Release 33821098518). Recreated container; safety openbot-gateway-rc-prev-6d9ea1f2d5-safety. verify-live PASS. liveFrom 2026-09-04T02:11:42Z closes seq 58. Executor cursor-grok. liveVerified=true. Observed `build-info.version=2026.7.12-rc.2`. Ledger `tag=main` (no `provenance/sha-*`).

| Field           | Value                                                                                                                                                 |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date            | liveFrom `2026-09-04T02:11:42Z`                                                                                                                       |
| Source revision | `3d03d3b4df91ab0bfaa33900eba95287c1ab30d2`                                                                                                            |
| Source          | GHCR digest `sha256:1881c4a8d5739c84d40a668dc4fb2c8cfeb3084de0c221881fd2a58c03e00e6e` / host alias `localhost/openbot:rc-amd64-provenance-3d03d3b4df` |
| Image digest    | `sha256:1881c4a8d5739c84d40a668dc4fb2c8cfeb3084de0c221881fd2a58c03e00e6e`                                                                             |
| Provenance      | none (ledger `tag=main`; no `provenance/sha-3d03d3b4df91`)                                                                                            |
| Control UI      | `index-mGJyINL7.js`                                                                                                                                   |
| Ledger          | `https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl` seq 59; `--live-verified`. Seq 58 closed.   |
| Executor        | `cursor-grok`                                                                                                                                         |

## Latest cutover (2026-09-02) — seq 54 / 37cc40e51f GHCR

User-authorized origin/main full-dist after #895/#898. Host 8.217.93.71 / openbot-gateway-rc image localhost/openbot:rc-amd64-provenance-37cc40e51f digest sha256:7ad093be0b62f83d735cc548a3814a5c521cf31d5d0473fc866b22f1740fe5ab OCI revision 37cc40e51f468404baf3077307e347f32f636cb1. Pulled ghcr.io/gmood2008/openbot:provenance-sha-37cc40e51f46-amd64 (Docker Release 33611768109). Recreated container; safety openbot-gateway-rc-prev-45087ca676-safety. verify-live PASS. liveFrom 2026-09-02T09:50:59Z closes seq 53. Executor cursor-grok. liveVerified=true.

| Field           | Value                                                                                                                                               |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date            | liveFrom `2026-09-02T09:50:59Z`                                                                                                                     |
| Source revision | `37cc40e51f468404baf3077307e347f32f636cb1`                                                                                                          |
| Source          | GHCR `provenance-sha-37cc40e51f46-amd64` / host alias `localhost/openbot:rc-amd64-provenance-37cc40e51f`                                            |
| Image digest    | `sha256:7ad093be0b62f83d735cc548a3814a5c521cf31d5d0473fc866b22f1740fe5ab`                                                                           |
| Provenance      | annotated tag `provenance/sha-37cc40e51f46`                                                                                                         |
| Control UI      | `index-p7Oe0D9v.js` (www + gw)                                                                                                                      |
| Ledger          | `https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl` seq 54; `--live-verified`. Seq 53 closed. |
| Executor        | `cursor-grok`                                                                                                                                       |

### Historical pending candidate — 2026-08-23 `d3f59d55d8` (SUPERSEDED, not LIVE)

Published **2026-08-23** after **PR #639 merge** (`d3f59d55d82d89af8d0b9575afe5259e2366fbca` = frozen merge tip). Clean worktree `/tmp/openbot-post639-d3f59d55d8`. **Not LIVE.** seq **39** preview only (`deploy/production/evidence/SEQ39_LEDGER_PREVIEW_20260823.json`). Supersedes pre-merge packages anchored at `551fa3e570` / `2a2f14f686`.

| Field                         | Value                                                                                                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Merge commit / frozen tip     | `d3f59d55d82d89af8d0b9575afe5259e2366fbca` (#639)                                                                                                            |
| Provenance                    | annotated tag `provenance/sha-d3f59d55d82d` → `d3f59d55d82d89af8d0b9575afe5259e2366fbca`                                                                     |
| Candidate image               | `localhost/openbot:rc-amd64-provenance-d3f59d55d82d` ImageID `sha256:825e14cc217a51d28b132037307c0844dcdd9af2ce8616f580bac73b0988ede5` (staged on prod host) |
| Candidate `build-info.commit` | `d3f59d55d82d89af8d0b9575afe5259e2366fbca`                                                                                                                   |
| Full-dist tarball             | `full-dist-d3f59d55d82d.tgz` sha256 `433afdf3f2566a9aa2ae7509862d217627434886163a56fc06f749c3b6959e13` (881 394 208 bytes)                                   |
| Shadow 3                      | 5/5 pass @ merge tip (`docs/design/evidence/chat-inbound-depth-shadow-3-tests-2026-08-23.json`)                                                              |
| Gates                         | forward-only **allow**; ledger audit **0 errors**; smoke `:18889`; rollback drill → `e6f26` tarball, LIVE restored `bad5f90a1d`                              |
| Running LIVE overlay          | `bad5f90a1d33082d9fa6b6c6e361044ac7017f13` on base `5c221b9ec38c` (ledger seq 37 row still names overlay `5a3952679849`)                                     |
| Closeout status               | **`productionCloseout: requested`** — receipt `docs/design/evidence/collaboration-csc-candidate-align-d3f59d55d8-2026-08-23.json`                            |
| Flags                         | inbound / CSC process env UNSET; unchanged                                                                                                                   |

Receipts: `deploy/production/evidence/COLLAB_CSC_CLOSEOUT_D3F59D55D8_20260823.md`, `docs/design/evidence/collaboration-csc-candidate-align-d3f59d55d8-2026-08-23.json`. Retired: `551fa3e570` / `2a2f14f686` candidate artifacts.

### Pending origin/main full-dist candidate — isolated verify `7ca242cf44` (SUPERSEDED, not LIVE)

Published **2026-08-23** from clean worktree `/tmp/openbot-candidate-7ca242cf44` after freshly fetched `origin/main` = `7ca242cf4419b438fe75c42ef159df5bb74d77db` (#653). **Superseded.** `origin/main` moved through `#656` (`b8cbf0b3ad`) then `#658` (`a12e4c59e575`). Official seq **41** is the `a12e4c59e575` full-swap below, not this preview (`deploy/production/evidence/SEQ41_LEDGER_PREVIEW_7CA242CF44_20260823.json`).

| Field                                | Value                                                                                                                                  |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| Frozen `origin/main` / candidate SHA | `7ca242cf4419b438fe75c42ef159df5bb74d77db`                                                                                             |
| Provenance                           | annotated tag `provenance/sha-7ca242cf4419` → `7ca242cf4419b438fe75c42ef159df5bb74d77db` (new tag; old tags not moved)                 |
| Candidate image                      | `localhost/openbot:rc-amd64-provenance-7ca242cf4419` ImageID `sha256:699a3788052282a702b7f909097ee73ce2ad769285fbbfe11a6d474639ca0f93` |
| Candidate `build-info.commit`        | `7ca242cf4419b438fe75c42ef159df5bb74d77db`                                                                                             |
| OCI revision                         | `7ca242cf4419b438fe75c42ef159df5bb74d77db`                                                                                             |
| Shadow-3                             | 5/5 @ frozen tip (`docs/design/evidence/chat-inbound-depth-shadow-3-tests-7ca242cf44-2026-08-23.json`)                                 |
| Closeout status                      | **`productionCloseout: not-accepted`**                                                                                                 |
| Flags                                | inbound / CSC / CONTEXT_SCOPE unchanged (unset)                                                                                        |

Receipts: `deploy/production/evidence/COLLAB_CSC_ISOLATED_ACCEPT_7CA242CF44_20260823.md`, `docs/design/evidence/collaboration-csc-isolated-accept-7ca242cf44-2026-08-23.json`.

## Latest cutover (2026-08-29) — seq 51 / 59be5066 GHCR

User-authorized GHCR cutover after Docker Release 33252742604. Host 8.217.93.71 / openbot-gateway-rc image localhost/openbot:rc-amd64-provenance-59be50660d digest sha256:a64adc1f04f116d7dd0e7e434f1d1a00a99601ed8de8ae8523becd2b1a470595 OCI revision 59be50660d8ebacf867211a206c92b4300bec418. Pulled ghcr.io/gmood2008/openbot@sha256:a64adc1f04f116d7dd0e7e434f1d1a00a99601ed8de8ae8523becd2b1a470595. Recreated container; safety openbot-gateway-rc-prev-1a6de1be5c-safety. verify-live PASS. liveFrom 2026-08-29T13:15:53Z closes seq 50. Executor gmood2008. liveVerified=true.

## Latest cutover (2026-08-29) — seq 50 / 1a6de1be GHCR

User-authorized GHCR cutover after Docker Release 33240895644. Host 8.217.93.71 / openbot-gateway-rc image localhost/openbot:rc-amd64-provenance-1a6de1be5c digest sha256:b3318467d1651222dd9381c18f6616e64ac92b17e61e5da273abccc2affa373a OCI revision 1a6de1be5c443a0ad73eba04dba5ec6eb6c742a1. Pulled ghcr.io/gmood2008/openbot@sha256:b3318467d1651222dd9381c18f6616e64ac92b17e61e5da273abccc2affa373a. Recreated container; safety openbot-gateway-rc-prev-33fc87c582-safety. verify-live PASS. liveFrom 2026-08-29T08:05:34Z closes seq 49. Executor gmood2008. liveVerified=true.

## Latest cutover (2026-08-29) — seq 49 / 33fc87c5 GHCR

User-authorized GHCR cutover after Docker Release 33236814765. Host 8.217.93.71 / openbot-gateway-rc image localhost/openbot:rc-amd64-provenance-33fc87c582 digest sha256:a4f41fe77f86319877d7af83a04ea0527f09b7de4951ed4df36f0af7d4a5ef43 OCI revision 33fc87c58229d023901acf6be2dbfb5d2a8f1240. Pulled ghcr.io/gmood2008/openbot@sha256:a4f41fe77f86319877d7af83a04ea0527f09b7de4951ed4df36f0af7d4a5ef43. Recreated container; safety openbot-gateway-rc-prev-6d27021431-safety. verify-live PASS. liveFrom 2026-08-29T06:49:12Z closes seq 48. Executor gmood2008. liveVerified=true.

## Latest cutover (2026-08-29) — seq 48 / 6d270214 GHCR OP-3

User-authorized OP-3/M2b. Host 8.217.93.71 / openbot-gateway-rc image localhost/openbot:rc-amd64-provenance-6d27021431 digest sha256:767a5d3a85118ae37ad430d896035462ab62dc35e87650dde6284b6cec4bea58 OCI revision 6d27021431bd9e04c93420afde2daa980b606c96. Pulled ghcr.io/gmood2008/openbot:main-amd64 from Docker Release 33230297445. Recreated container; safety openbot-gateway-rc-prev-21e1e8392f-safety. verify-live PASS. liveFrom 2026-08-29T04:04:22Z closes seq 47. Executor gmood2008. liveVerified=true.

## Latest cutover (2026-08-28) — seq 47 / 21e1e839 verify-live rollback

Intentional revert after the unledgered seq 46 forward. Host `8.217.93.71` / running container `openbot-gateway-rc` image `localhost/openbot:rc-amd64-provenance-21e1e8392f0f`, image id `6df3e092fcf9118914964a8bcd6089e4bcb48849c2e08a472a3ad502aebe77f2`, digest `sha256:715122a14a8805c40f071c078a99132addbbb00633be21eabb55da7b85f65a5b`, OCI revision `21e1e8392f0ff5808563727eaa8f66e6ad9ed148`, image Created `2026-08-28 03:58:45.25814315 +0000 UTC`. This running image is **distinct** from the seq 45 recorded digest `sha256:ee132a30aea0461b71e8d98395e17ebae13f8224f20c3a14b6b818406b75ecb2`. OP-1 `--verify-live` PASS (healthz 200 live; readyz `ready:true` `failing:[]`); seq 45 was **not** `--record`ed again. liveFrom `2026-08-28T05:51:33Z` closes seq 46. Executor `gmood2008`. `liveVerified=true`. OP-3 (next GHCR cutover `--verify-live --record`) remains open. Tracker: `docs/design/openbot-aliyun-prod-v2-implementable-2026-08-28.md` § Operator tracking.

| Field           | Value                                                                                                                                                                                  |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date            | liveFrom `2026-08-28T05:51:33Z` (FinishedAt of `openbot-gateway-rc-prev-471b3a2c3099-safety`)                                                                                          |
| Source revision | `21e1e8392f0ff5808563727eaa8f66e6ad9ed148`                                                                                                                                             |
| Source          | host image `localhost/openbot:rc-amd64-provenance-21e1e8392f0f`                                                                                                                        |
| Image digest    | `sha256:715122a14a8805c40f071c078a99132addbbb00633be21eabb55da7b85f65a5b`                                                                                                              |
| Image id        | `6df3e092fcf9118914964a8bcd6089e4bcb48849c2e08a472a3ad502aebe77f2`                                                                                                                     |
| Provenance      | annotated tag `provenance/sha-21e1e8392f0f`                                                                                                                                            |
| Ledger          | `https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl` seq 47; `--live-verified`; `--intentional-revert`. Seq 45 and seq 46 closed. |
| Executor        | `gmood2008`                                                                                                                                                                            |

## Historical cutover (2026-08-28) — seq 46 / 471b3a2c (~11 min)

Unledgered forward reconstructed from host leftover (not a new cutover). Image `localhost/openbot:rc-amd64-provenance-471b3a2c3099`, image id `3274060a31d4bf4187026687ac8369ae98da9545075dea4690750cba756bfe01`, digest `sha256:1aaa7406c0965d9ffd33b9237030e43d5af833119cc2663e9821c930e545765b`, OCI revision `471b3a2c30990c2cc555c01bfa496870e147c229`. Container `817c9dfe13db` name `openbot-gateway-rc-prev-471b3a2c3099-safety`. Started `2026-08-28 13:40:36.539960152 +0800 CST` = `2026-08-28T05:40:36Z`; Finished `2026-08-28 13:51:33.478518998 +0800 CST` = `2026-08-28T05:51:33Z`. Recorded with `--unverified-backfill` (not `--live-verified`). Closes seq 45 at the same `liveFrom`.

| Field           | Value                                                                                                                                                             |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date            | liveFrom `2026-08-28T05:40:36Z`; liveTo `2026-08-28T05:51:33Z`                                                                                                    |
| Source revision | `471b3a2c30990c2cc555c01bfa496870e147c229`                                                                                                                        |
| Source          | host leftover `localhost/openbot:rc-amd64-provenance-471b3a2c3099`                                                                                                |
| Image digest    | `sha256:1aaa7406c0965d9ffd33b9237030e43d5af833119cc2663e9821c930e545765b`                                                                                         |
| Image id        | `3274060a31d4bf4187026687ac8369ae98da9545075dea4690750cba756bfe01`                                                                                                |
| Container       | `817c9dfe13db` / `openbot-gateway-rc-prev-471b3a2c3099-safety`                                                                                                    |
| Provenance      | tag field `provenance/sha-471b3a2c3099` (writer-recorded; not a new annotated tag from this PR)                                                                   |
| Ledger          | `https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl` seq 46; `liveVerified=false`; historical reconstruction |
| Executor        | `gmood2008`                                                                                                                                                       |

## Historical cutover (2026-08-28) — seq 45 / 21e1e839 GHCR backfill

Ledger-recorded cutover from `76fea1fb0669` to `21e1e8392f0ff5808563727eaa8f66e6ad9ed148`. GHCR image `rc-amd64-provenance-21e1e8392f`, digest `sha256:ee132a30aea0461b71e8d98395e17ebae13f8224f20c3a14b6b818406b75ecb2`, tag `provenance/sha-21e1e8392f0f`, liveFrom `2026-08-28T03:59:00Z`, liveTo `2026-08-28T05:40:36Z`, executor `kiro-daibai`. Seq 45 was ledger-backfilled (`liveVerified` absent). Closed when seq 46 was reconstructed. The later independently verified running image is seq 47 (`21e1e8392f0f` / digest `sha256:715122a1…`), not this recorded digest.

| Field           | Value                                                                                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date            | liveFrom `2026-08-28T03:59:00Z`; liveTo `2026-08-28T05:40:36Z`                                                                                          |
| Source revision | `21e1e8392f0ff5808563727eaa8f66e6ad9ed148`                                                                                                              |
| Source          | GHCR image `rc-amd64-provenance-21e1e8392f`                                                                                                             |
| Image digest    | `sha256:ee132a30aea0461b71e8d98395e17ebae13f8224f20c3a14b6b818406b75ecb2`                                                                               |
| Provenance      | annotated tag `provenance/sha-21e1e8392f0f`                                                                                                             |
| Ledger          | `https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl` seq 45; historical backfill; closed by seq 46 |
| Executor        | `kiro-daibai`                                                                                                                                           |

## Latest cutover (2026-08-27) — origin/main full-swap `76fea1fb` (CTR P2.5 shadow, dormant)

User-authorized forward-only cutover from `cf7ceb40a7` to `origin/main` commit `76fea1fb0669357fa7ed8c4c882bc4588b614cab` (contains PR #728: conversation-task P2.5 shadow-only implementation, behind flags). The shadow HMAC key is injected so the shadow code ships **live but dormant** — detection/qualification flags OFF, allowlist empty, no shadow activity. This deploys code only; **no activation/projection/authorization** (that is handoff C, NOT APPROVED). Container recreated (not overlay) from a local host full-dist build with a temporary swapfile (removed after build); gateway healthy throughout.

Authorization: Handoff A conditional-GO (`kiro-release-authority`) + pre-deploy PASS (`kiro-gateway-reviewer`) + AC-A1 privacy sign-off — key injection gated on AC-cond-1..3 (AC-cond-4 alert/metric de-identification deferred to C observation window, per the deadlock-fix in `.kiro/specs/conversation-task-runtime/p2-5-ac-a1-privacy-signoff-request.md` §4).

| Field           | Value                                                                                                                                                                                                                                                                                              |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date            | Container StartedAt `2026-08-27T04:11:44Z` (`2026-08-27 12:11:44 +0800`); restarts 0                                                                                                                                                                                                               |
| Source revision | `76fea1fb0669357fa7ed8c4c882bc4588b614cab`                                                                                                                                                                                                                                                         |
| Source          | Fresh `origin/main` tip at freeze/build/swap. Host alias `localhost/openbot:rc-amd64-provenance-76fea1fb0669`. Local pack (not a GHCR pull; docker-release CI failing).                                                                                                                            |
| Build mode      | Local host `podman build --platform linux/amd64` root Dockerfile; `--build-arg GIT_COMMIT=76fea1fb0669357fa7ed8c4c882bc4588b614cab` + `revision` label; temporary swapfile removed after build (builtAt `2026-08-27T01:31:07Z`).                                                                   |
| Container       | `openbot-gateway-rc` ImageID `27742d7be6c3`; `--user 0 --restart always`; two `--env-file` (`/root/.openbot/.env.docker` + `/root/.openbot-ct-shadow/ct-shadow.env`). Earlier Missing-config was a missing `--user 0` (non-root could not read root:root 0600 config), fixed by adding `--user 0`. |
| Image           | `localhost/openbot:rc-amd64-provenance-76fea1fb0669` (`ImageID=27742d7be6c3`; OCI revision `76fea1fb0669357fa7ed8c4c882bc4588b614cab`; digest `sha256:251462eb6300b04a1bf7c2deffa124cf4af14835d1578e1e3605843ac082e742`)                                                                           |
| Provenance      | annotated tag `provenance/sha-76fea1fb0669` → `76fea1fb0669357fa7ed8c4c882bc4588b614cab`                                                                                                                                                                                                           |
| Shadow key      | `OPENBOT_CT_SHADOW_HMAC_KEY` set (value withheld; 256-bit), `OPENBOT_CT_SHADOW_HMAC_KEY_ID=ct-2026-08`. AC-cond-1 **partial/pending**: openssl-generated on host, NOT vault-managed → vault migration is a hard pre-activation (C) follow-up + privacy-reviewer acceptance. AC-cond-2/3 met.       |
| Dormancy        | detection/qualification flags OFF, allowlist empty, no shadow activity in logs; normal chat reply/timing unaffected                                                                                                                                                                                |
| Ledger          | `https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl` seq 44; seq 43 `liveTo=2026-08-27T04:11:44Z`                                                                                                                                             |
| Smoke           | healthz **200**; readyz **ready:true** `failing:[]`; `verify-forward-only`=allow (forwardOnly true, from LIVE `cf7ceb40a7`); `verify-delivery-alignment`=PASS8/WARN2/FAIL0                                                                                                                         |
| Rollback        | rename/start `openbot-gateway-rc-prev-cf7ceb40a7` (image `rc-amd64-provenance-cf7ceb40a7`) — instant; old image retained                                                                                                                                                                           |
| Executor        | `kiro-collab-csc` (release operator); implementation owner `kiro-conversation-task-runtime`. Boundary AC-A6: shadow dormant only; production rollout to activation = NOT APPROVED                                                                                                                  |

## Previous cutover (2026-08-26) — origin/main full-swap `cf7ceb40a7`

User-authorized forward-only cutover from `831dd9c749` to `origin/main` commit `cf7ceb40a7c43edf3698f8cba4b944f3c09c2dc4` (contains PR #748: platform-auth resolves same-enterprise duplicate memberships instead of `membership-ambiguous`, fixing loopback Control UI employee-actor resolution for a user who is both enterprise-admin and member of the same tenant). Blast radius 36 commits since `831dd9c749`. Container recreated (not overlay) from a local host full-dist build with the temporary swapfile; gateway healthy throughout. Flags unchanged (inbound / CSC / CONTEXT_SCOPE unset).

| Field           | Value                                                                                                                                                                                                                                                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Date            | Container StartedAt `2026-08-26T14:37:46Z` (`2026-08-26 22:37:46 +0800`); restarts 0                                                                                                                                                                                                                                     |
| Source revision | `cf7ceb40a7c43edf3698f8cba4b944f3c09c2dc4`                                                                                                                                                                                                                                                                               |
| Source          | Fresh `origin/main` tip at freeze/build/swap. Host alias `localhost/openbot:rc-amd64-provenance-cf7ceb40a7`. Local pack (not a GHCR pull).                                                                                                                                                                               |
| Build mode      | Local host `podman build` root Dockerfile; `GIT_COMMIT=cf7ceb40a7c43edf3698f8cba4b944f3c09c2dc4`; temporary 6 GB swapfile `/swapfile-cutover`.                                                                                                                                                                           |
| Container       | `openbot-gateway-rc` ImageID `389c082c274b545a40a305511c40d5bdf190c43d904142300efbd402c6d2694d`; `--network host --user 0 --restart always`; binds `/root/.openbot` + `/root/openbot-tenants`; cmd `node openbot.mjs gateway --bind loopback --port 18789`; `--env-file /root/openbot-maint-cutover-cf7ceb40a7/env.list` |
| Control UI      | Served `assets/index-Dpg8P1UR.js`.                                                                                                                                                                                                                                                                                       |
| Image           | `localhost/openbot:rc-amd64-provenance-cf7ceb40a7` (`ImageID=389c082c274b…`; OCI revision `cf7ceb40a7c43edf3698f8cba4b944f3c09c2dc4`)                                                                                                                                                                                    |
| Provenance      | annotated tag `provenance/sha-cf7ceb40a7c4` → `cf7ceb40a7c43edf3698f8cba4b944f3c09c2dc4` (new tag; old tags not moved)                                                                                                                                                                                                   |
| Ledger          | `https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl` seq 43; seq 42 `liveTo=2026-08-26T14:37:46Z`                                                                                                                                                                   |
| Smoke           | After swap: healthz **200**; readyz **ready:true** `failing:[]`; inbound / CSC / CONTEXT_SCOPE unset; `cutover-from-ghcr.sh --verify-live` **PASS**                                                                                                                                                                      |
| Rollback        | rename/start `openbot-gateway-rc-prev-831dd9c749-safety` (image `rc-amd64-provenance-831dd9c749`) — instant; old image retained                                                                                                                                                                                          |
| Executor        | `kiro-collab-csc`; user-authorized 2026-08-26 cutover to deploy #748                                                                                                                                                                                                                                                     |

## Previous cutover (2026-08-26) — origin/main full-swap `831dd9c749`

User-authorized **Route A** forward-only cutover from `a12e4c59e575` to `origin/main` commit `831dd9c749b506c82009ee5e30d10dfa98e97eee` (contains PR #734 + #736: chat-inbound depth agent-allowlist + primary-session gate). Container recreated (not overlay) from a **local host full-dist build** (`podman build` root Dockerfile, `GIT_COMMIT` + `revision` label) using a temporary 6 GB swapfile because a bare build OOM-killed `tsdown`; the gateway stayed healthy throughout. Flags unchanged (inbound / CSC / CONTEXT_SCOPE unset). `origin/main` advanced to `70e3320b` during the build; newer commits are deferred to a future cutover.

| Field           | Value                                                                                                                                                                                                                                                                                                                |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date            | Container StartedAt `2026-08-26T04:19:23Z` (`2026-08-26 12:19:23 +0800`)                                                                                                                                                                                                                                             |
| Decision        | User-authorized Route A cutover. Recreate `openbot-gateway-rc` on the new full-dist image. Do **not** enable inbound / CSC / CONTEXT_SCOPE. Env carried forward from the live container (`/root/openbot-maint-cutover-831dd9c749/env.list`).                                                                         |
| Source revision | `831dd9c749b506c82009ee5e30d10dfa98e97eee`                                                                                                                                                                                                                                                                           |
| Source          | Fresh `origin/main` commit at freeze/build/swap (`831dd9c749`; tip advanced to `70e3320b` during the build). Host alias `localhost/openbot:rc-amd64-provenance-831dd9c749`. Local pack (not a GHCR pull).                                                                                                            |
| Build mode      | Local host `podman build` root Dockerfile; `GIT_COMMIT=831dd9c749b506c82009ee5e30d10dfa98e97eee`; temporary 6 GB swapfile `/swapfile-cutover` (bare build OOM-killed `tsdown`, gateway healthy throughout).                                                                                                          |
| Container       | `openbot-gateway-rc` ImageID `127113e7c0fb5649b4989d6f6647a4a324c7aa99cb32210b4e30c588367a7529` (healthz 200, readyz `ready:true failing:[]`, restarts 0); `--network host --user 0 --restart always`; binds `/root/.openbot` + `/root/openbot-tenants`; cmd `node openbot.mjs gateway --bind loopback --port 18789` |
| Control UI      | Served `assets/index-Dpg8P1UR.js` (host + container). `OPENBOT_UI_OVERLAY_PINNED_ENTRY` is inert in this build (no code reads it; sanitizer only rewrites retired `index-CR5cronNm[6-8].js`).                                                                                                                        |
| Image           | `localhost/openbot:rc-amd64-provenance-831dd9c749` (`ImageID=127113e7c0fb…`; OCI revision `831dd9c749b506c82009ee5e30d10dfa98e97eee`)                                                                                                                                                                                |
| Provenance      | annotated tag `provenance/sha-831dd9c749b5` → `831dd9c749b506c82009ee5e30d10dfa98e97eee` (new tag; old tags not moved)                                                                                                                                                                                               |
| Ledger          | `https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl` seq 42; seq 41 `liveTo=2026-08-26T04:19:23Z`                                                                                                                                                               |
| Smoke           | After swap: healthz **200**; readyz **ready:true** `failing:[]`; inbound / CSC / CONTEXT_SCOPE unset; `getChatInboundDepthAgentAllowlist` present in `/app/dist`; `cutover-from-ghcr.sh --verify-live` **PASS**                                                                                                      |
| Rollback        | rename/start `openbot-gateway-rc-prev-a12e4c59e5-safety` (image `rc-amd64-provenance-a12e4c59e575`) — instant; old image retained                                                                                                                                                                                    |
| Executor        | `kiro-collab-csc`; user-authorized 2026-08-26 Route A full-swap                                                                                                                                                                                                                                                      |
| Merge-back      | Candidate `831dd9c749` is already on `main`; merge-back is a no-op. `origin/main` tip `70e3320b` carries newer commits for a future cutover.                                                                                                                                                                         |

## Previous cutover (2026-08-24) — origin/main full-swap `a12e4c59e575`

User authorized merge of #656 then a **full container recreate** onto freshly fetched `origin/main`. Frozen tip at build+swap was `a12e4c59e5754e0c280b423c68c989c6973ac9b0` (#658, containing #656). Clean worktree `/tmp/openbot-prod-a12e4c59e575`. `b8cbf0b3ad` was packed after #656 then **expired** when main moved; it was not cut over. Flags unchanged.

| Layer          | Value                                                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Image SHA      | `a12e4c59e5754e0c280b423c68c989c6973ac9b0`                                                                                     |
| imageTag       | `rc-amd64-provenance-a12e4c59e575` (`ImageID=f2fcc345923017…`)                                                                 |
| Gateway SHA    | `a12e4c59e5754e0c280b423c68c989c6973ac9b0` (`build-info.commit`)                                                               |
| UI SHA         | `a12e4c59e5754e0c280b423c68c989c6973ac9b0` (same full-dist; host+container `index-Dpg8P1UR.js`)                                |
| Provenance tag | `provenance/sha-a12e4c59e575` → `a12e4c59e5754e0c280b423c68c989c6973ac9b0`                                                     |
| Rollback       | rename/start `openbot-gateway-rc-prev-47d693-before-a12e4c` or restore base `rc-amd64-provenance-5c221b9ec3` + overlay tarball |

| Field           | Value                                                                                                                                                                                                                                                                                                 |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date            | Container StartedAt `2026-08-23T22:37:47Z` (`2026-08-24 06:37:47 +0800`); `builtAt=2026-08-23T22:22:15.099Z`                                                                                                                                                                                          |
| Decision        | User-authorized full-swap after #656. Recreate `openbot-gateway-rc` on a new full-dist image. Do **not** enable inbound / CSC / CONTEXT_SCOPE. Reuse existing env-file `/root/openbot-maintenance-ghcr-csc-5c221b9ec38c-20260822T132121Z/env.list`.                                                   |
| Source revision | `a12e4c59e5754e0c280b423c68c989c6973ac9b0`                                                                                                                                                                                                                                                            |
| Source          | Fresh `origin/main` tip at freeze/build/swap. Host alias `localhost/openbot:rc-amd64-provenance-a12e4c59e575`. Local pack (not a GHCR pull).                                                                                                                                                          |
| Build mode      | Clean worktree `pnpm build:docker` + slim full-dist Dockerfile; `GIT_COMMIT=a12e4c59e5754e0c280b423c68c989c6973ac9b0`; shadow-3 5/5                                                                                                                                                                   |
| Container       | `openbot-gateway-rc` ImageID `f2fcc345923017749ef03a46cc41bb4cd49bbc12758d7cb3ba74710966a25f74` (healthz 200, readyz `ready:true`); `--network host --restart always`; binds `/root/.openbot` + `/root/openbot-tenants`; cmd `node openbot.mjs gateway --bind loopback --port 18789`                  |
| Control UI      | Pin env `OPENBOT_UI_OVERLAY_PINNED_ENTRY=index-Dpg8P1UR.js`. Host and container served `assets/index-Dpg8P1UR.js`.                                                                                                                                                                                    |
| Gateway         | full-dist `build-info.commit=a12e4c59e5754e0c280b423c68c989c6973ac9b0`; previous observed LIVE overlay `47d6934c34dced654652f027f2c66fedea35a67f` on base `5c221b9ec38c` (unledgered; StartedAt `2026-08-23 21:55:05 +0800`); ledger previous row seq 40 `33993e52e554`                               |
| Image           | `localhost/openbot:rc-amd64-provenance-a12e4c59e575` (`ImageID=f2fcc345923017749ef03a46cc41bb4cd49bbc12758d7cb3ba74710966a25f74`; OCI revision `a12e4c59e5754e0c280b423c68c989c6973ac9b0`)                                                                                                            |
| Provenance      | annotated tag `provenance/sha-a12e4c59e575` → `a12e4c59e5754e0c280b423c68c989c6973ac9b0` (new tag; old tags not moved)                                                                                                                                                                                |
| Ledger          | `https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl` seq 41; seq 40 `liveTo=2026-08-23T22:37:47Z`                                                                                                                                                |
| Smoke           | Isolated `:18889` healthz 200 / readyz ready; rollback drill `:18890` on `5c221b9ec3`; `touchedLive=false` during drills. After swap: healthz **200** `{ok:true,status:live}`; readyz **ready:true** `failing:[]`; inbound / CSC / CONTEXT_SCOPE unset; `cutover-from-ghcr.sh --verify-live` **PASS** |
| Rollback        | `podman start`/`rename` `openbot-gateway-rc-prev-47d693-before-a12e4c`, or recreate `localhost/openbot:rc-amd64-provenance-5c221b9ec3` and restore `/root/openbot-maintenance-full-swap-a12e4c59e575-r1-20260823T223738Z/container-app-dist.before.tgz` (47d693 overlay).                             |
| Executor        | `cursor-collab-csc`; user authorized 2026-08-23 full-swap after #656                                                                                                                                                                                                                                  |
| Merge-back      | Candidate SHA was `origin/main` at freeze/build/swap. This row adds `Source revision` so `parseLatestCutoverSha` returns `a12e4c59e575…`.                                                                                                                                                             |
| Identity gap    | Between seq 40 (`33993e52e554`, StartedAt `2026-08-23 17:28:05 +0800`) and this swap, LIVE ran overlay `47d6934c34` on the same `5c221b9ec3` base from `2026-08-23 21:55:05 +0800` without a ledger row. Not reconstructed as its own seq.                                                            |

### Rollback

```bash
# preferred: start the renamed previous container (47d693 overlay on 5c221b9 base)
podman stop openbot-gateway-rc
podman rename openbot-gateway-rc openbot-gateway-rc-failed-a12e4c
podman rename openbot-gateway-rc-prev-47d693-before-a12e4c openbot-gateway-rc
podman start openbot-gateway-rc

# or restore overlay tarball onto the seq 33 GHCR base image
BK=/root/openbot-maintenance-full-swap-a12e4c59e575-r1-20260823T223738Z
# Image localhost/openbot:rc-amd64-provenance-5c221b9ec3 + $BK/container-app-dist.before.tgz
```

This row records a **full container recreate**. It does **not** enable inbound / CSC / CONTEXT_SCOPE.

---

## Previous cutover (2026-08-23) — gateway overlay `33993e52e554` on GHCR image `5c221b9ec38c`

User authorized the shortest safe path for latest `origin/main`. Built from clean `git archive` of `33993e52e5540f76e57d66ab75d8955420437d3a` (#643) in `/tmp/openbot-build-33993e52e554` from detached worktree `/tmp/openbot-ledger-release`. Gateway and Control UI came from the same archive/build. Container image was not recreated. Progress Ledger flag unchanged.

| Layer               | Value                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------ |
| Base image SHA      | `5c221b9ec38c6316b98797342a01fb39ffd80562`                                                                   |
| imageTag            | `rc-amd64-provenance-5c221b9ec3` (`ImageID=ca71ba79d800…`, digest `sha256:b0995382…`)                        |
| Gateway overlay SHA | `33993e52e5540f76e57d66ab75d8955420437d3a` (`build-info.commit`)                                             |
| UI overlay SHA      | `33993e52e5540f76e57d66ab75d8955420437d3a` (same archive/build; host served `index-Dpg8P1UR.js`)             |
| Provenance tag      | `provenance/sha-33993e52e554` → overlay; `provenance/sha-5c221b9ec38c` → base image                          |
| Rollback artifact   | `/root/openbot-maintenance-origin-main-33993e52e554-full-dist-r1-20260823T092707Z/` → overlay `b576641a96eb` |

seq 28 / seq 29 stay historical (`ws-c-v1-root-guard-r1-20260815` + `6ac338` / `aa348b`). Do not retarget them onto this GHCR image.

| Field           | Value                                                                                                                                                                                                                                                                                                       |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date            | Overlay stamp `20260823T092707Z` (`builtAt=2026-08-23T09:26:35.518Z`); container StartedAt `2026-08-23T09:28:05Z` (`2026-08-23 17:28:05 +0800`)                                                                                                                                                             |
| Decision        | User-authorized origin/main full-dist overlay of `33993e52e554` (#643) onto the unchanged seq 33 GHCR image. Do **not** recreate the container. Do **not** put overlay SHA in `imageTag`. Do **not** set inbound / CSC flags. Progress Ledger remains on (config + `.env.docker`); process env still UNSET. |
| Source revision | `33993e52e5540f76e57d66ab75d8955420437d3a`                                                                                                                                                                                                                                                                  |
| Source          | Overlay artifact `33993e52e5540f76e57d66ab75d8955420437d3a`. Base image remains `ghcr.io/gmood2008/openbot:provenance-sha-5c221b9ec38c` / host alias `localhost/openbot:rc-amd64-provenance-5c221b9ec3`.                                                                                                    |
| Build mode      | Gateway dist + Control UI overlay on full-dist GHCR image; `git archive` + `pnpm install --frozen-lockfile` + `pnpm build`; image not rebuilt; container not recreated                                                                                                                                      |
| Container       | `openbot-gateway-rc` same ImageID `ca71ba79d8009c219b9aa1fa79fe6349b0cfd32621b0f3212cbd5146dc8b1d8c` (healthz 200, readyz `ready:true`)                                                                                                                                                                     |
| Control UI      | Pin env `OPENBOT_UI_OVERLAY_PINNED_ENTRY=index-Dpg8P1UR.js`. Host and container served entry observed `assets/index-Dpg8P1UR.js`. Overlay UI came from the same candidate SHA as gateway. Ledger `uiSha` stays the **base image** UI `5c221b9ec38c` so `imageTag` identity matches.                         |
| Gateway         | overlay artifact `build-info.commit=33993e52e5540f76e57d66ab75d8955420437d3a`; previous overlay `b576641a96eb49285e8454f30e060de0eabc49a0` (seq 39)                                                                                                                                                         |
| Image           | `localhost/openbot:rc-amd64-provenance-5c221b9ec3` (`ImageID=ca71ba79d8009c219b9aa1fa79fe6349b0cfd32621b0f3212cbd5146dc8b1d8c`; digest `sha256:b09953827133890b162dcd47dda12509bdf4a7a86d6d57e32b221dbd41b8b257`; OCI revision `5c221b9ec38c6316b98797342a01fb39ffd80562`)                                  |
| Provenance      | overlay tag `provenance/sha-33993e52e554` → `33993e52e5540f76e57d66ab75d8955420437d3a`; base-image tag `provenance/sha-5c221b9ec38c` unchanged                                                                                                                                                              |
| Ledger          | `https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl` seq 40; seq 39 `liveTo=2026-08-23T09:28:05Z`; seq 38 `liveTo=2026-08-23T08:06:29Z`                                                                                                                |
| Smoke           | healthz **200** `{ok:true,status:live}`; readyz **ready:true** `failing:[]`; inbound / CSC flags unset; Progress Ledger **on** via `gateway.progressLedger.enabled=true` and `OPENBOT_PROGRESS_LEDGER_ENABLED=1` in `/root/.openbot/.env.docker` (process env still UNSET until recreate)                   |
| Rollback        | restore `/root/openbot-maintenance-origin-main-33993e52e554-full-dist-r1-20260823T092707Z/container-app-dist.before.tgz` into `/app/dist` (returns overlay `b576641a96eb`). Image stays `rc-amd64-provenance-5c221b9ec3`. Do **not** treat overlay SHA as a new image.                                      |
| Executor        | overlay `cursor-grok`; user authorized 2026-08-23 shortest safe path for latest `origin/main`                                                                                                                                                                                                               |
| Merge-back      | Overlay SHA already on `origin/main` at cutover time. This row adds the machine-readable `Source revision` so `parseLatestCutoverSha` returns `33993e52e554…`.                                                                                                                                              |

### Rollback

```bash
BK=/root/openbot-maintenance-origin-main-33993e52e554-full-dist-r1-20260823T092707Z
# restores previous overlay b576641a96eb into /app/dist; does not replace the GHCR image
# Image remains localhost/openbot:rc-amd64-provenance-5c221b9ec3
```

This row records the **running overlay artifact** on the seq 33 GHCR **base image**. It does **not** enable inbound / CSC flags. Progress Ledger stays on; process env remains UNSET until a recreate with `--env-file`.

---

## Previous cutover (2026-08-23) — gateway overlay `b576641a96eb` on GHCR image `5c221b9ec38c`

User authorized latest `origin/main` production alignment. Built from clean `git archive` of `b576641a96eb49285e8454f30e060de0eabc49a0` (#638) in `/tmp/openbot-build-b576641a96eb` from detached worktree `/tmp/openbot-main-alignment` (not the dirty `kiro-loom` tree). Gateway and Control UI came from the same archive/build. Container image was not recreated. Progress Ledger flag unchanged.

| Layer               | Value                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------ |
| Base image SHA      | `5c221b9ec38c6316b98797342a01fb39ffd80562`                                                                   |
| imageTag            | `rc-amd64-provenance-5c221b9ec3` (`ImageID=ca71ba79d800…`, digest `sha256:b0995382…`)                        |
| Gateway overlay SHA | `b576641a96eb49285e8454f30e060de0eabc49a0` (`build-info.commit`)                                             |
| UI overlay SHA      | `b576641a96eb49285e8454f30e060de0eabc49a0` (same archive/build; host served `index-Dpg8P1UR.js`)             |
| Provenance tag      | `provenance/sha-b576641a96eb` → overlay; `provenance/sha-5c221b9ec38c` → base image                          |
| Rollback artifact   | `/root/openbot-maintenance-origin-main-b576641a96eb-full-dist-r1-20260823T080458Z/` → overlay `bad5f90a1d33` |

seq 28 / seq 29 stay historical (`ws-c-v1-root-guard-r1-20260815` + `6ac338` / `aa348b`). Do not retarget them onto this GHCR image.

| Field           | Value                                                                                                                                                                                                                                                                                                       |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date            | Overlay stamp `20260823T080458Z` (`builtAt=2026-08-23T08:03:59.516Z`); container StartedAt `2026-08-23T08:06:29Z` (`2026-08-23 16:06:29 +0800`)                                                                                                                                                             |
| Decision        | User-authorized origin/main full-dist overlay of `b576641a96eb` (#638) onto the unchanged seq 33 GHCR image. Do **not** recreate the container. Do **not** put overlay SHA in `imageTag`. Do **not** set inbound / CSC flags. Progress Ledger remains on (config + `.env.docker`); process env still UNSET. |
| Source revision | `b576641a96eb49285e8454f30e060de0eabc49a0`                                                                                                                                                                                                                                                                  |
| Source          | Overlay artifact `b576641a96eb49285e8454f30e060de0eabc49a0`. Base image remains `ghcr.io/gmood2008/openbot:provenance-sha-5c221b9ec38c` / host alias `localhost/openbot:rc-amd64-provenance-5c221b9ec3`.                                                                                                    |
| Build mode      | Gateway dist + Control UI overlay on full-dist GHCR image; `git archive` + `pnpm install --frozen-lockfile` + `pnpm build`; image not rebuilt; container not recreated                                                                                                                                      |
| Container       | `openbot-gateway-rc` same ImageID `ca71ba79d8009c219b9aa1fa79fe6349b0cfd32621b0f3212cbd5146dc8b1d8c` (healthz 200, readyz `ready:true`)                                                                                                                                                                     |
| Control UI      | Pin env `OPENBOT_UI_OVERLAY_PINNED_ENTRY=index-Dpg8P1UR.js`. Host and container served entry observed `assets/index-Dpg8P1UR.js`. Overlay UI came from the same candidate SHA as gateway. Ledger `uiSha` stays the **base image** UI `5c221b9ec38c` so `imageTag` identity matches.                         |
| Gateway         | overlay artifact `build-info.commit=b576641a96eb49285e8454f30e060de0eabc49a0`; previous overlay `bad5f90a1d33082d9fa6b6c6e361044ac7017f13` (seq 38)                                                                                                                                                         |
| Image           | `localhost/openbot:rc-amd64-provenance-5c221b9ec3` (`ImageID=ca71ba79d8009c219b9aa1fa79fe6349b0cfd32621b0f3212cbd5146dc8b1d8c`; digest `sha256:b09953827133890b162dcd47dda12509bdf4a7a86d6d57e32b221dbd41b8b257`; OCI revision `5c221b9ec38c6316b98797342a01fb39ffd80562`)                                  |
| Provenance      | overlay tag `provenance/sha-b576641a96eb` → `b576641a96eb49285e8454f30e060de0eabc49a0`; base-image tag `provenance/sha-5c221b9ec38c` unchanged                                                                                                                                                              |
| Ledger          | `https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl` seq 39; seq 38 `liveTo=2026-08-23T08:06:29Z`; seq 37 `liveTo=2026-08-23T06:42:02Z`                                                                                                                |
| Smoke           | healthz **200** `{ok:true,status:live}`; readyz **ready:true** `failing:[]`; inbound / CSC flags unset; Progress Ledger **on** via `gateway.progressLedger.enabled=true` and `OPENBOT_PROGRESS_LEDGER_ENABLED=1` in `/root/.openbot/.env.docker` (process env still UNSET until recreate)                   |
| Admin           | production cron fold via `readAdminProgressLedger` returned `projectionKind=canonical`, 6 items, I1–I8 `0`; admin === cron.list projection; TOOL_SUCCEEDED only reaches `executed`                                                                                                                          |
| Rollback        | restore `/root/openbot-maintenance-origin-main-b576641a96eb-full-dist-r1-20260823T080458Z/container-app-dist.before.tgz` into `/app/dist` (returns overlay `bad5f90a1d33`). Image stays `rc-amd64-provenance-5c221b9ec3`. Do **not** treat overlay SHA as a new image.                                      |
| Executor        | overlay `cursor-grok`; user authorized 2026-08-23 latest `origin/main` alignment cutover                                                                                                                                                                                                                    |
| Merge-back      | Overlay SHA already on `origin/main` at cutover time. This row adds the machine-readable `Source revision` so `parseLatestCutoverSha` returns `b576641a96eb…`.                                                                                                                                              |

### Rollback

```bash
BK=/root/openbot-maintenance-origin-main-b576641a96eb-full-dist-r1-20260823T080458Z
# restores previous overlay bad5f90a1d33 into /app/dist; does not replace the GHCR image
# Image remains localhost/openbot:rc-amd64-provenance-5c221b9ec3
```

This row records the **running overlay artifact** on the seq 33 GHCR **base image**. It does **not** enable inbound / CSC flags. Progress Ledger stays on; process env remains UNSET until a recreate with `--env-file`.

---

## Previous cutover (2026-08-23) — gateway overlay `bad5f90a1d33` on GHCR image `5c221b9ec38c`

User authorized Production Main Alignment Cutover of freshly fetched `origin/main`. Built from clean `git archive` of `bad5f90a1d33082d9fa6b6c6e361044ac7017f13` (#628) in `/tmp/openbot-progress-release` (not the dirty `kiro-loom` tree). Gateway and Control UI came from the same archive/build. Container image was not recreated. Progress Ledger flag unchanged.

| Layer               | Value                                                                                              |
| ------------------- | -------------------------------------------------------------------------------------------------- |
| Base image SHA      | `5c221b9ec38c6316b98797342a01fb39ffd80562`                                                         |
| imageTag            | `rc-amd64-provenance-5c221b9ec3` (`ImageID=ca71ba79d800…`, digest `sha256:b0995382…`)              |
| Gateway overlay SHA | `bad5f90a1d33082d9fa6b6c6e361044ac7017f13` (`build-info.commit`)                                   |
| UI overlay SHA      | `bad5f90a1d33082d9fa6b6c6e361044ac7017f13` (same archive/build; host served `index-Dpg8P1UR.js`)   |
| Provenance tag      | `provenance/sha-bad5f90a1d33` → overlay; `provenance/sha-5c221b9ec38c` → base image                |
| Rollback artifact   | `/root/openbot-maintenance-origin-main-bad5f90a1d33-r1-20260823T063918Z/` → overlay `5a3952679849` |

seq 28 / seq 29 stay historical (`ws-c-v1-root-guard-r1-20260815` + `6ac338` / `aa348b`). Do not retarget them onto this GHCR image.

| Field           | Value                                                                                                                                                                                                                                                                                                       |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date            | Overlay stamp `20260823T063918Z` (`builtAt=2026-08-23T06:40:11.929Z`); container StartedAt `2026-08-23T06:42:02Z` (`2026-08-23 14:42:02 +0800`)                                                                                                                                                             |
| Decision        | User-authorized origin/main full-dist overlay of `bad5f90a1d33` (#628) onto the unchanged seq 33 GHCR image. Do **not** recreate the container. Do **not** put overlay SHA in `imageTag`. Do **not** set inbound / CSC flags. Progress Ledger remains on (config + `.env.docker`); process env still UNSET. |
| Source revision | `bad5f90a1d33082d9fa6b6c6e361044ac7017f13`                                                                                                                                                                                                                                                                  |
| Source          | Overlay artifact `bad5f90a1d33082d9fa6b6c6e361044ac7017f13`. Base image remains `ghcr.io/gmood2008/openbot:provenance-sha-5c221b9ec38c` / host alias `localhost/openbot:rc-amd64-provenance-5c221b9ec3`.                                                                                                    |
| Build mode      | Gateway dist + Control UI overlay on full-dist GHCR image; `git archive` + `pnpm install --frozen-lockfile` + `pnpm build`; image not rebuilt; container not recreated                                                                                                                                      |
| Container       | `openbot-gateway-rc` same ImageID `ca71ba79d8009c219b9aa1fa79fe6349b0cfd32621b0f3212cbd5146dc8b1d8c` (healthz 200, readyz `ready:true`)                                                                                                                                                                     |
| Control UI      | Pin env `OPENBOT_UI_OVERLAY_PINNED_ENTRY=index-Ol92eg1L.js`. Host and container served entry observed `assets/index-Dpg8P1UR.js`. Overlay UI came from the same candidate SHA as gateway. Ledger `uiSha` stays the **base image** UI `5c221b9ec38c` so `imageTag` identity matches.                         |
| Gateway         | overlay artifact `build-info.commit=bad5f90a1d33082d9fa6b6c6e361044ac7017f13`; previous overlay `5a39526798493464ff0a7f29ab65ab66ad7670ed` (seq 37)                                                                                                                                                         |
| Image           | `localhost/openbot:rc-amd64-provenance-5c221b9ec3` (`ImageID=ca71ba79d8009c219b9aa1fa79fe6349b0cfd32621b0f3212cbd5146dc8b1d8c`; digest `sha256:b09953827133890b162dcd47dda12509bdf4a7a86d6d57e32b221dbd41b8b257`; OCI revision `5c221b9ec38c6316b98797342a01fb39ffd80562`)                                  |
| Provenance      | overlay tag `provenance/sha-bad5f90a1d33` → `bad5f90a1d33082d9fa6b6c6e361044ac7017f13`; base-image tag `provenance/sha-5c221b9ec38c` unchanged                                                                                                                                                              |
| Ledger          | `https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl` seq 38; seq 37 `liveTo=2026-08-23T06:42:02Z`; seq 36 `liveTo=2026-08-23T03:40:11Z`                                                                                                                |
| Smoke           | healthz **200** `{ok:true,status:live}`; readyz **ready:true** `failing:[]`; inbound / CSC flags unset; Progress Ledger **on** via `gateway.progressLedger.enabled=true` and `OPENBOT_PROGRESS_LEDGER_ENABLED=1` in `/root/.openbot/.env.docker` (process env still UNSET until recreate)                   |
| Admin           | `progress-ledger.admin.list` registered in live dist; production cron fold via `readAdminProgressLedger` returned `projectionKind=canonical`, 6 items, I1–I8 `0`                                                                                                                                            |
| Rollback        | restore `/root/openbot-maintenance-origin-main-bad5f90a1d33-r1-20260823T063918Z/container-app-dist-pkg.before.tgz` into `/app/dist` (returns overlay `5a3952679849`). Image stays `rc-amd64-provenance-5c221b9ec3`. Do **not** treat overlay SHA as a new image.                                            |
| Executor        | overlay `cursor-grok`; user authorized 2026-08-23 Production Main Alignment Cutover of latest `origin/main`                                                                                                                                                                                                 |
| Merge-back      | Overlay SHA already on `origin/main` at cutover time. This row adds the machine-readable `Source revision` so `parseLatestCutoverSha` returns `bad5f90a1d33…`.                                                                                                                                              |

### Rollback

```bash
BK=/root/openbot-maintenance-origin-main-bad5f90a1d33-r1-20260823T063918Z
# restores previous overlay 5a3952679849 into /app/dist; does not replace the GHCR image
# Image remains localhost/openbot:rc-amd64-provenance-5c221b9ec3
```

This row records the **running overlay artifact** on the seq 33 GHCR **base image**. It does **not** enable inbound / CSC flags. Progress Ledger stays on; process env remains UNSET until a recreate with `--env-file`.

---

## Previous cutover (2026-08-23) — gateway overlay `5a3952679849` on GHCR image `5c221b9ec38c`

User authorized a new origin/main cutover because `e6f26e13795a` was a running overlay, not the trunk tip. Built from clean `git archive` of `5a39526798493464ff0a7f29ab65ab66ad7670ed` (#631) in `/tmp/openbot-progress-release` (not the dirty `kiro-loom` tree). Container image was not recreated. Progress Ledger flag unchanged.

| Layer               | Value                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------ |
| Base image SHA      | `5c221b9ec38c6316b98797342a01fb39ffd80562`                                                             |
| imageTag            | `rc-amd64-provenance-5c221b9ec3` (`ImageID=ca71ba79d800…`, digest `sha256:b0995382…`)                  |
| Gateway overlay SHA | `5a39526798493464ff0a7f29ab65ab66ad7670ed` (`build-info.commit`)                                       |
| UI SHA              | `5c221b9ec38c6316b98797342a01fb39ffd80562` (image UI identity; host overlay entry `index-Dpg8P1UR.js`) |
| Provenance tag      | `provenance/sha-5a3952679849` → overlay; `provenance/sha-5c221b9ec38c` → base image                    |
| Rollback artifact   | `/root/openbot-maintenance-origin-main-5a3952679849-r1-20260823T033629Z/` → overlay `e6f26e13795a`     |

seq 28 / seq 29 stay historical (`ws-c-v1-root-guard-r1-20260815` + `6ac338` / `aa348b`). Do not retarget them onto this GHCR image.

| Field           | Value                                                                                                                                                                                                                                                                                                       |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date            | Overlay stamp `20260823T033629Z` (`builtAt=2026-08-23T03:38:51.881Z`); container StartedAt `2026-08-23T03:40:11Z` (`2026-08-23 11:40:11 +0800`)                                                                                                                                                             |
| Decision        | User-authorized origin/main full-dist overlay of `5a3952679849` (#631) onto the unchanged seq 33 GHCR image. Do **not** recreate the container. Do **not** put overlay SHA in `imageTag`. Do **not** set inbound / CSC flags. Progress Ledger remains on (config + `.env.docker`); process env still UNSET. |
| Source revision | `5a39526798493464ff0a7f29ab65ab66ad7670ed`                                                                                                                                                                                                                                                                  |
| Source          | Overlay artifact `5a39526798493464ff0a7f29ab65ab66ad7670ed`. Base image remains `ghcr.io/gmood2008/openbot:provenance-sha-5c221b9ec38c` / host alias `localhost/openbot:rc-amd64-provenance-5c221b9ec3`.                                                                                                    |
| Build mode      | Gateway dist + Control UI overlay on full-dist GHCR image; `git archive` + `pnpm install --frozen-lockfile` + `pnpm build`; image not rebuilt; container not recreated                                                                                                                                      |
| Container       | `openbot-gateway-rc` same ImageID `ca71ba79d8009c219b9aa1fa79fe6349b0cfd32621b0f3212cbd5146dc8b1d8c` (healthz 200, readyz `ready:true`)                                                                                                                                                                     |
| Control UI      | Pin env `OPENBOT_UI_OVERLAY_PINNED_ENTRY=index-Ol92eg1L.js`. Host served entry observed `assets/index-Dpg8P1UR.js`. Ledger `uiSha` is the **base image** UI `5c221b9ec38c` so `imageTag` identity matches.                                                                                                  |
| Gateway         | overlay artifact `build-info.commit=5a39526798493464ff0a7f29ab65ab66ad7670ed`; previous overlay `e6f26e13795a86084e9f227453ee1d439d25d018` (seq 36)                                                                                                                                                         |
| Image           | `localhost/openbot:rc-amd64-provenance-5c221b9ec3` (`ImageID=ca71ba79d8009c219b9aa1fa79fe6349b0cfd32621b0f3212cbd5146dc8b1d8c`; digest `sha256:b09953827133890b162dcd47dda12509bdf4a7a86d6d57e32b221dbd41b8b257`; OCI revision `5c221b9ec38c6316b98797342a01fb39ffd80562`)                                  |
| Provenance      | overlay tag `provenance/sha-5a3952679849` → `5a39526798493464ff0a7f29ab65ab66ad7670ed`; base-image tag `provenance/sha-5c221b9ec38c` unchanged                                                                                                                                                              |
| Ledger          | `https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl` seq 37; seq 36 `liveTo=2026-08-23T03:40:11Z`; seq 35 `liveTo=2026-08-23T02:40:47Z`                                                                                                                |
| Smoke           | healthz **200** `{ok:true,status:live}`; readyz **ready:true** `failing:[]`; inbound / CSC flags unset; Progress Ledger **on** via `gateway.progressLedger.enabled=true` and `OPENBOT_PROGRESS_LEDGER_ENABLED=1` in `/root/.openbot/.env.docker` (process env still UNSET until recreate)                   |
| Rollback        | restore `/root/openbot-maintenance-origin-main-5a3952679849-r1-20260823T033629Z/container-app-dist-pkg.before.tgz` into `/app/dist` (returns overlay `e6f26e13795a`). Image stays `rc-amd64-provenance-5c221b9ec3`. Do **not** treat overlay SHA as a new image.                                            |
| Executor        | overlay `cursor-grok`; user authorized 2026-08-23 after closeout that `e6f26e13795a` was not the trunk tip                                                                                                                                                                                                  |
| Merge-back      | Overlay SHA already on `origin/main` at cutover time. This row adds the machine-readable `Source revision` so `parseLatestCutoverSha` returns `5a3952679849…`.                                                                                                                                              |

### Rollback

```bash
BK=/root/openbot-maintenance-origin-main-5a3952679849-r1-20260823T033629Z
# restores previous overlay e6f26e13795a into /app/dist; does not replace the GHCR image
# Image remains localhost/openbot:rc-amd64-provenance-5c221b9ec3
```

This row records the **running overlay artifact** on the seq 33 GHCR **base image**. It does **not** enable inbound / CSC flags. Progress Ledger stays on; process env remains UNSET until a recreate with `--env-file`.

---

## Previous cutover (2026-08-23) — gateway overlay `e6f26e13795a` on GHCR image `5c221b9ec38c`

User authorized cutover of then-current `origin/main` after #630 review. Built from clean `git archive` of `e6f26e13795a86084e9f227453ee1d439d25d018` (not the dirty `kiro-loom` tree). Container image was not recreated. Progress Ledger flag unchanged.

| Layer               | Value                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------ |
| Base image SHA      | `5c221b9ec38c6316b98797342a01fb39ffd80562`                                                             |
| imageTag            | `rc-amd64-provenance-5c221b9ec3` (`ImageID=ca71ba79d800…`, digest `sha256:b0995382…`)                  |
| Gateway overlay SHA | `e6f26e13795a86084e9f227453ee1d439d25d018` (`build-info.commit`)                                       |
| UI SHA              | `5c221b9ec38c6316b98797342a01fb39ffd80562` (image UI identity; host overlay entry `index-Dpg8P1UR.js`) |
| Provenance tag      | `provenance/sha-e6f26e13795a` → overlay; `provenance/sha-5c221b9ec38c` → base image                    |
| Rollback artifact   | `/root/openbot-maintenance-origin-main-e6f26e13795a-r1-20260823T023758Z/` → overlay `7cd74d4c`         |

seq 28 / seq 29 stay historical (`ws-c-v1-root-guard-r1-20260815` + `6ac338` / `aa348b`). Do not retarget them onto this GHCR image.

| Field           | Value                                                                                                                                                                                                                                                                                                       |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date            | Overlay stamp `20260823T023758Z` (`builtAt=2026-08-23T02:39:22.337Z`); container StartedAt `2026-08-23T02:40:47Z` (`2026-08-23 10:40:47 +0800`)                                                                                                                                                             |
| Decision        | User-authorized origin/main full-dist overlay of `e6f26e13795a` (#627) onto the unchanged seq 33 GHCR image. Do **not** recreate the container. Do **not** put overlay SHA in `imageTag`. Do **not** set inbound / CSC flags. Progress Ledger remains on (config + `.env.docker`); process env still UNSET. |
| Source revision | `e6f26e13795a86084e9f227453ee1d439d25d018`                                                                                                                                                                                                                                                                  |
| Source          | Overlay artifact `e6f26e13795a86084e9f227453ee1d439d25d018`. Base image remains `ghcr.io/gmood2008/openbot:provenance-sha-5c221b9ec38c` / host alias `localhost/openbot:rc-amd64-provenance-5c221b9ec3`.                                                                                                    |
| Build mode      | Gateway dist + Control UI overlay on full-dist GHCR image; `git archive` + `pnpm install --frozen-lockfile` + `pnpm build`; image not rebuilt; container not recreated                                                                                                                                      |
| Container       | `openbot-gateway-rc` same ImageID `ca71ba79d8009c219b9aa1fa79fe6349b0cfd32621b0f3212cbd5146dc8b1d8c` (healthz 200, readyz `ready:true`)                                                                                                                                                                     |
| Control UI      | Pin env `OPENBOT_UI_OVERLAY_PINNED_ENTRY=index-Ol92eg1L.js`. Host served entry observed `assets/index-Dpg8P1UR.js`. Ledger `uiSha` is the **base image** UI `5c221b9ec38c` so `imageTag` identity matches.                                                                                                  |
| Gateway         | overlay artifact `build-info.commit=e6f26e13795a86084e9f227453ee1d439d25d018`; previous overlay `7cd74d4c5c69e7492eb6d624531f27592d6c809a` (seq 35)                                                                                                                                                         |
| Image           | `localhost/openbot:rc-amd64-provenance-5c221b9ec3` (`ImageID=ca71ba79d8009c219b9aa1fa79fe6349b0cfd32621b0f3212cbd5146dc8b1d8c`; digest `sha256:b09953827133890b162dcd47dda12509bdf4a7a86d6d57e32b221dbd41b8b257`; OCI revision `5c221b9ec38c6316b98797342a01fb39ffd80562`)                                  |
| Provenance      | overlay tag `provenance/sha-e6f26e13795a` → `e6f26e13795a86084e9f227453ee1d439d25d018`; base-image tag `provenance/sha-5c221b9ec38c` unchanged                                                                                                                                                              |
| Ledger          | `https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl` seq 36; seq 35 `liveTo=2026-08-23T02:40:47Z`; seq 34 `liveTo=2026-08-22T15:09:15Z`                                                                                                                |
| Smoke           | healthz **200** `{ok:true,status:live}`; readyz **ready:true** `failing:[]`; inbound / CSC flags unset; Progress Ledger **on** via `gateway.progressLedger.enabled=true` and `OPENBOT_PROGRESS_LEDGER_ENABLED=1` in `/root/.openbot/.env.docker` (process env still UNSET until recreate)                   |
| Rollback        | restore `/root/openbot-maintenance-origin-main-e6f26e13795a-r1-20260823T023758Z/container-app-dist-pkg.before.tgz` into `/app/dist` (returns overlay `7cd74d4c5c69`). Image stays `rc-amd64-provenance-5c221b9ec3`. Do **not** treat overlay SHA as a new image.                                            |
| Executor        | overlay `cursor-grok`; user authorized 2026-08-23 after #630 approve + cutover current origin/main                                                                                                                                                                                                          |
| Merge-back      | Overlay SHA already on `origin/main` at cutover time. This row adds the machine-readable `Source revision` so `parseLatestCutoverSha` returns `e6f26e13795a…`.                                                                                                                                              |

### Rollback

```bash
BK=/root/openbot-maintenance-origin-main-e6f26e13795a-r1-20260823T023758Z
# restores previous overlay 7cd74d4c5c69 into /app/dist; does not replace the GHCR image
# Image remains localhost/openbot:rc-amd64-provenance-5c221b9ec3
```

This row records the **running overlay artifact** on the seq 33 GHCR **base image**. It does **not** enable inbound / CSC flags. Progress Ledger stays on; process env remains UNSET until a recreate with `--env-file`.

---

## Previous cutover (2026-08-22) — gateway overlay `7cd74d4c5c69` on GHCR image `5c221b9ec38c`

Re-observed 2026-08-23 08:19 CST. Identity is split; overlay SHA is **not** the image SHA.

| Layer               | Value                                                                                               |
| ------------------- | --------------------------------------------------------------------------------------------------- |
| Base image SHA      | `5c221b9ec38c6316b98797342a01fb39ffd80562`                                                          |
| imageTag            | `rc-amd64-provenance-5c221b9ec3` (`ImageID=ca71ba79d800…`, digest `sha256:b0995382…`)               |
| Gateway overlay SHA | `7cd74d4c5c69e7492eb6d624531f27592d6c809a` (`build-info.commit`)                                    |
| UI SHA              | `5c221b9ec38c6316b98797342a01fb39ffd80562` (image UI; not an overlay SHA)                           |
| Provenance tag      | `provenance/sha-7cd74d4c5c69` → overlay; `provenance/sha-5c221b9ec38c` → base image                 |
| Rollback artifact   | `/root/openbot-maintenance-origin-main-7cd74d4c-item7-s18-r1-20260822T150915Z/` → overlay `affda8b` |

seq 28 / seq 29 stay historical (`ws-c-v1-root-guard-r1-20260815` + `6ac338` / `aa348b`). Do not retarget them onto this GHCR image.

| Field           | Value                                                                                                                                                                                                                                                                                                                                                           |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date            | Overlay stamp `20260822T150915Z` (`2026-08-22T15:09:15Z`); container StartedAt `2026-08-22T15:10:36Z` (`2026-08-22 23:10:36 +0800`)                                                                                                                                                                                                                             |
| Decision        | **Ledger identity close-out only.** Record observed gateway-dist overlay of `origin/main` `7cd74d4c5c69` (#610 Item 7 S18) onto the unchanged seq 33 GHCR image. Do **not** recreate the container. Do **not** put overlay SHA in `imageTag`. Do **not** set inbound / CSC flags. Progress Ledger remains on (config + `.env.docker`); process env still UNSET. |
| Source revision | `7cd74d4c5c69e7492eb6d624531f27592d6c809a`                                                                                                                                                                                                                                                                                                                      |
| Source          | Overlay artifact `7cd74d4c5c69e7492eb6d624531f27592d6c809a`. Base image remains `ghcr.io/gmood2008/openbot:provenance-sha-5c221b9ec38c` / host alias `localhost/openbot:rc-amd64-provenance-5c221b9ec3`.                                                                                                                                                        |
| Build mode      | Gateway dist overlay on full-dist GHCR image; image not rebuilt; container not recreated                                                                                                                                                                                                                                                                        |
| Container       | `openbot-gateway-rc` same ImageID `ca71ba79d8009c219b9aa1fa79fe6349b0cfd32621b0f3212cbd5146dc8b1d8c` (healthz 200, readyz `ready:true`, Health=healthy)                                                                                                                                                                                                         |
| Control UI      | Pin env `OPENBOT_UI_OVERLAY_PINNED_ENTRY=index-Ol92eg1L.js`. Host served entry observed `assets/index-Dpg8P1UR.js`. Ledger `uiSha` is the **base image** UI `5c221b9ec38c` so `imageTag` identity matches.                                                                                                                                                      |
| Gateway         | overlay artifact `build-info.commit=7cd74d4c5c69e7492eb6d624531f27592d6c809a`; previous overlay `affda8bce88939e42c57000896c13fc8a457f536` (seq 34)                                                                                                                                                                                                             |
| Image           | `localhost/openbot:rc-amd64-provenance-5c221b9ec3` (`ImageID=ca71ba79d8009c219b9aa1fa79fe6349b0cfd32621b0f3212cbd5146dc8b1d8c`; digest `sha256:b09953827133890b162dcd47dda12509bdf4a7a86d6d57e32b221dbd41b8b257`; OCI revision `5c221b9ec38c6316b98797342a01fb39ffd80562`)                                                                                      |
| Provenance      | overlay tag `provenance/sha-7cd74d4c5c69` → `7cd74d4c5c69e7492eb6d624531f27592d6c809a`; base-image tag `provenance/sha-5c221b9ec38c` unchanged                                                                                                                                                                                                                  |
| Ledger          | `https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl` seq 35; seq 34 `liveTo=2026-08-22T15:09:15Z`; seq 33 `liveTo=2026-08-22T14:50:54Z`                                                                                                                                                                    |
| Smoke           | healthz **200** `{ok:true,status:live}`; readyz **ready:true** `failing:[]`; inbound / CSC flags unset; Progress Ledger **on** via `gateway.progressLedger.enabled=true` and `OPENBOT_PROGRESS_LEDGER_ENABLED=1` in `/root/.openbot/.env.docker` (process env still UNSET until recreate)                                                                       |
| Rollback        | restore `/root/openbot-maintenance-origin-main-7cd74d4c-item7-s18-r1-20260822T150915Z/container-app-dist-pkg.before.tgz` into `/app/dist` (returns overlay `affda8bce889`). Image stays `rc-amd64-provenance-5c221b9ec3`. Do **not** treat overlay SHA as a new image.                                                                                          |
| Executor        | overlay observed; ledger close-out `cursor-collab-csc`; `Source revision` row + flag correction `cursor-grok`                                                                                                                                                                                                                                                   |
| Merge-back      | Overlay SHA already on `origin/main` at observation time. This row adds the machine-readable `Source revision` so `parseLatestCutoverSha` returns `7cd74d4c5c69…`.                                                                                                                                                                                              |

### Rollback

```bash
BK=/root/openbot-maintenance-origin-main-7cd74d4c-item7-s18-r1-20260822T150915Z
# restores previous overlay affda8bce889 into /app/dist; does not replace the GHCR image
# Image remains localhost/openbot:rc-amd64-provenance-5c221b9ec3
```

This row records the **running overlay artifact** on the seq 33 GHCR **base image**. It does **not** enable inbound / CSC flags, and does **not** authorize another LIVE swap. Progress Ledger stays on; process env remains UNSET until a recreate with `--env-file`.

---

## Previous cutover (2026-08-22) — gateway overlay `affda8bce889` on GHCR image `5c221b9ec38c`

| Field      | Value                                                                                                                        |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Date       | Overlay stamp `20260822T145054Z`; overlay `builtAt=2026-08-22T14:51:44.115Z`; `liveTo=2026-08-22T15:09:15Z`                  |
| Decision   | Observed Item 7 S07 (#607) gateway overlay onto seq 33 GHCR image. Image not replaced. Overlay SHA is **not** the image SHA. |
| Source     | Overlay artifact `affda8bce88939e42c57000896c13fc8a457f536`. Base image `5c221b9ec38c6316b98797342a01fb39ffd80562`.          |
| Image      | `localhost/openbot:rc-amd64-provenance-5c221b9ec3` (unchanged ImageID `ca71ba79d800…`)                                       |
| Provenance | `provenance/sha-affda8bce889` → overlay; `provenance/sha-5c221b9ec38c` → base image                                          |
| Ledger     | seq 34; superseded by seq 35                                                                                                 |
| Backup     | `/root/openbot-maintenance-affda8bc-item7-s07-r1-20260822T145054Z/`                                                          |
| Executor   | overlay observed; ledger backfill `cursor-collab-csc`                                                                        |

This row is **historical**. Current LIVE is seq 44 (`76fea1fb0669`), not seq 35 (`7cd74d4c5c69`).

---

## Previous cutover (2026-08-22) — GHCR full-image recreate (`provenance/sha-5c221b9ec38c`)

| Field      | Value                                                                                                                                                                                                                                                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Date       | Recreate stamp `20260822T132121Z` (`2026-08-22T13:21:21Z`); container StartedAt `2026-08-22T13:21:27Z` (`2026-08-22 21:21:27 +0800`); ledger `liveFrom` `2026-08-22T13:22:01Z`                                                                                                                                                 |
| Decision   | **GHCR full-image recreate** of `openbot-gateway-rc` from current `origin/main` after #606. Not overlay. Not keep-ui. Carry previous env (45 vars) and mounts; do **not** set inbound / CSC / Progress Ledger flags. Keep Control UI pin `index-Ol92eg1L.js`. Manual `docker push` after `docker-release.yml` billing failure. |
| Source     | `origin/main` @ `5c221b9ec38c6316b98797342a01fb39ffd80562` (Merge PR #606). Image `ghcr.io/gmood2008/openbot:provenance-sha-5c221b9ec38c`. Host alias `localhost/openbot:rc-amd64-provenance-5c221b9ec3`.                                                                                                                      |
| Build mode | Full-dist GHCR image (gateway+UI same tip SHA); `cutover-from-ghcr.sh --stage --digest` then recreate. No host build.                                                                                                                                                                                                          |
| Container  | `openbot-gateway-rc` recreated (healthz 200, readyz `ready:true`; `--network host --user 0 --restart always`; cmd `node openbot.mjs gateway --bind loopback --port 18789`)                                                                                                                                                     |
| Control UI | Host root `/root/.openbot/control-ui` retained from #564; pin `OPENBOT_UI_OVERLAY_PINNED_ENTRY=index-Ol92eg1L.js` unchanged. In-container `/app/dist` is the full image dist (no overlay object in `build-info`).                                                                                                              |
| Gateway    | `build-info.commit=5c221b9ec38c6316b98797342a01fb39ffd80562` `builtAt=2026-08-22T13:00:50.669Z`; previousLive `c393dca8feedd8b9db1a1f7fafc4796ac60b5d06` (seq 32 overlay)                                                                                                                                                      |
| Image      | `localhost/openbot:rc-amd64-provenance-5c221b9ec3` (`ImageID=ca71ba79d8009c219b9aa1fa79fe6349b0cfd32621b0f3212cbd5146dc8b1d8c`; digest `sha256:b09953827133890b162dcd47dda12509bdf4a7a86d6d57e32b221dbd41b8b257`)                                                                                                              |
| Provenance | annotated tag `provenance/sha-5c221b9ec38c` → `5c221b9ec38c6316b98797342a01fb39ffd80562` (minted earlier as CSC candidate on the same SHA; reused, not force-moved)                                                                                                                                                            |
| Ledger     | `https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl` seq 33; `liveTo=2026-08-22T14:50:54Z`; seq 32 `liveTo=2026-08-22T13:21:21Z`                                                                                                                                          |
| Smoke      | healthz **200** `{ok:true,status:live}`; readyz **ready:true** `failing:[]`; edge 200 on `www.openbot.love/`, `www.openbot.love/__openbot/control-ui-config.json`, `gw.openbot.love/healthz`; container env has `OPENBOT_DATA_MODE=managed` + `OPENBOT_MULTITENANT=1` and **no** inbound / CSC / Progress Ledger flags         |
| Rollback   | rename safety container `openbot-gateway-rc-prev-c393dca8fe-safety` back to `openbot-gateway-rc` and start. Backup `/root/openbot-maintenance-ghcr-csc-5c221b9ec38c-20260822T132121Z/`. Do **not** overlay-restore seq 32 tarball into this image.                                                                             |
| Executor   | `cursor-collab-csc`                                                                                                                                                                                                                                                                                                            |
| Merge-back | Candidate already `origin/main` tip at cutover time                                                                                                                                                                                                                                                                            |

### Rollback

```bash
ssh root@8.217.93.71
podman rm -f openbot-gateway-rc
podman rename openbot-gateway-rc-prev-c393dca8fe-safety openbot-gateway-rc
podman start openbot-gateway-rc
# backup: /root/openbot-maintenance-ghcr-csc-5c221b9ec38c-20260822T132121Z/
# previous image: localhost/openbot:ws-c-v1-root-guard-r1-20260815
# previous commit: c393dca8feedd8b9db1a1f7fafc4796ac60b5d06 (seq 32 overlay)
```

This cutover ships Collaboration Runtime v1 + CSC v1.1 **code** on a full GHCR image matching `origin/main` `5c221b9ec38c`. It does **not** enable inbound / CSC / Progress Ledger production flags, and does **not** mark Item 6/7 met.

This row is **historical**. Current LIVE is seq 44 (`76fea1fb0669` / `rc-amd64-provenance-76fea1fb0669`). The GHCR image `5c221b9ec38c` and overlay `7cd74d4c5c69` are not the running `build-info.commit`.

---

## Previous cutover (2026-08-22) — origin/main gateway dist overlay (`origin-main-item6-path-gate-r1`)

| Field      | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Date       | Overlay stamp `20260822T085042Z` (`2026-08-22T08:50:42Z`); container StartedAt `2026-08-22T08:51:42Z` (`2026-08-22 16:51:42 +0800`)                                                                                                                                                                                                                                                                                                                          |
| Decision   | **Strategy 4:** gateway-dist-keep-ui overlay of current `origin/main` after #604 Item 6 path gate + #600 S05 retirement + #605 Progress Ledger docs/gates. Not GHCR (`docker-release.yml` failed empty steps). Not full-dist. Do not recreate `openbot-gateway-rc`. Keep Control UI pin `index-Ol92eg1L.js`. Do **not** set `OPENBOT_PROGRESS_LEDGER_ENABLED=1`. Do **not** mark Item 6/7 met. No sqlite production write, no schema v2, no resolver switch. |
| Source     | `origin/main` @ `c393dca8feedd8b9db1a1f7fafc4796ac60b5d06` (includes #604 / #600 / #605). Built off-host then tarball into `/app/dist`. Local image `ghcr.io/gmood2008/openbot:provenance-sha-c393dca8feed`.                                                                                                                                                                                                                                                 |
| Build mode | Gateway dist overlay only (`gateway-dist-keep-ui`); base image not replaced; Control UI excluded from tarball                                                                                                                                                                                                                                                                                                                                                |
| Container  | `openbot-gateway-rc` (healthz 200, readyz `ready:true`; restart via `podman restart`; StartedAt 2026-08-22 16:51:42 +0800)                                                                                                                                                                                                                                                                                                                                   |
| Control UI | Host root `/root/.openbot/control-ui` retained from #564; served entry `index-Ol92eg1L.js`. Container `/app/dist/control-ui` also retained. Pin `OPENBOT_UI_OVERLAY_PINNED_ENTRY=index-Ol92eg1L.js` unchanged.                                                                                                                                                                                                                                               |
| Gateway    | overlay `origin-main-item6-path-gate-r1` @ `c393dca8feedd8b9db1a1f7fafc4796ac60b5d06`; previousLive `5480cefe122f38fdf1064c1672b860e10060a32c`; 236 commits from previous LIVE                                                                                                                                                                                                                                                                               |
| Image      | `localhost/openbot:ws-c-v1-root-guard-r1-20260815` (`ImageID=5c4357c469f5f3614d49bd8b8ae84bdccc45f3b61c68c098ea3aee605a3453e9`)                                                                                                                                                                                                                                                                                                                              |
| Provenance | annotated tag `provenance/sha-c393dca8feed` → `c393dca8feedd8b9db1a1f7fafc4796ac60b5d06` (minted earlier as CSC candidate on the same SHA; reused, not force-moved)                                                                                                                                                                                                                                                                                          |
| Ledger     | `https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl` seq 32                                                                                                                                                                                                                                                                                                                                             |
| Smoke      | healthz **200**; readyz **ready:true**; edge 200 on `gw.openbot.love/healthz`, `www.openbot.love/`, `biz.openbot.love/`, `admin.openbot.love/`; UI pin file `/app/dist/control-ui/assets/index-Ol92eg1L.js` present; container env has `OPENBOT_DATA_MODE=managed` + `OPENBOT_MULTITENANT=1` and **no** Progress Ledger / sqlite / schema v2 flags                                                                                                           |
| Rollback   | restore `/root/openbot-maintenance-origin-main-item6-path-gate-r1-20260822T085042Z/container-app-dist-pkg.before.tgz` into `/app/dist` then `/usr/local/bin/openbot-gateway-restart`. Preserve host Control UI. Do **not** `podman restart -t 0`.                                                                                                                                                                                                            |
| Executor   | `cursor-grok`                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Merge-back | Candidate already `origin/main` tip at overlay time                                                                                                                                                                                                                                                                                                                                                                                                          |

### Rollback

```bash
BK=/root/openbot-maintenance-origin-main-item6-path-gate-r1-20260822T085042Z
# tarball: $BK/container-app-dist-pkg.before.tgz (sha256 21912f0f5adfa598b30d44c0d0ec9c13e8b3393a84c03f0e3748a9ff42833eaf)
# before commit: 5480cefe122f38fdf1064c1672b860e10060a32c
# overlay tarball sha256 71fc67d8425954536a207526dd98d10e126e918aeda8109faeda88590060f092
# Preserve /root/.openbot/control-ui (served entry index-Ol92eg1L.js) and /app/dist/control-ui.
WORKDIR=/tmp/restore-origin-main-item6-path-gate-r1
rm -rf "$WORKDIR" && mkdir -p "$WORKDIR"
tar xzf "$BK/container-app-dist-pkg.before.tgz" -C "$WORKDIR"
podman exec openbot-gateway-rc sh -c 'rm -rf /tmp/restore-in /tmp/control-ui-hold && mkdir -p /tmp/restore-in /tmp/control-ui-hold && cp -a /app/dist/control-ui /tmp/control-ui-hold/'
podman cp "$WORKDIR/dist/." openbot-gateway-rc:/tmp/restore-in/
podman exec openbot-gateway-rc sh -c 'find /app/dist -mindepth 1 -maxdepth 1 ! -name control-ui -exec rm -rf {} +; cp -a /tmp/restore-in/. /app/dist/; rm -rf /app/dist/control-ui; cp -a /tmp/control-ui-hold/control-ui /app/dist/control-ui'
/usr/local/bin/openbot-gateway-restart openbot-gateway-rc
```

This overlay ships Item 6 path-gate **code** and Item 7 S05 retirement **code** on the gateway dist. It does **not** flip Item 6/7 to met, does **not** enable `OPENBOT_PROGRESS_LEDGER_ENABLED`, and does **not** authorize sqlite / schema v2 / LIVE resolver cutover. Do not recreate the container.

This row is **historical**. Current LIVE is seq 44 (`76fea1fb0669`), not seq 35 on the seq 33 GHCR image. Overlay-restore of this tarball into the seq 33 image is the wrong rollback; use the seq 33 safety container `openbot-gateway-rc-prev-c393dca8fe-safety` only to leave the GHCR image lineage.

---

## Previous cutover (2026-08-20) — origin/main gateway dist overlay (`context-compiler-main-r1`)

| Field      | Value                                                                                                                                                                                                                                                  |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Date       | Overlay stamp `20260820T131501Z` (`2026-08-20T13:15:01Z`)                                                                                                                                                                                              |
| Decision   | **Strategy 4:** gateway-dist-keep-ui overlay of current `origin/main` after #565. Not GHCR. Not full-dist. Do not recreate `openbot-gateway-rc`. Keep Control UI pin `index-Ol92eg1L.js`. Keep inbound flags. Do not set `OPENBOT_CONTEXT_COMPILER=0`. |
| Source     | `origin/main` @ `5480cefe122f38fdf1064c1672b860e10060a32c` (includes #565 Context Compiler + #564 reconnect hydrate). Built off-host with `GIT_COMMIT=<candidate>` then tarball into `/app/dist`.                                                      |
| Build mode | Gateway dist overlay only (`gateway-dist-keep-ui`); base image not replaced                                                                                                                                                                            |
| Container  | `openbot-gateway-rc` (healthz 200, readyz `ready:true`; graceful restart via `/usr/local/bin/openbot-gateway-restart`)                                                                                                                                 |
| Control UI | Host root `/root/.openbot/control-ui` retained from #564; served entry `index-Ol92eg1L.js`. Container `/app/dist/control-ui` also retained. Pin `OPENBOT_UI_OVERLAY_PINNED_ENTRY=index-Ol92eg1L.js` unchanged.                                         |
| Gateway    | overlay `context-compiler-main-r1` @ `5480cefe122f38fdf1064c1672b860e10060a32c`; previousLive `2022bcb0d192b5f99e291d0b50930aa7a6177664`; 7 commits from previous LIVE                                                                                 |
| Image      | `localhost/openbot:ws-c-v1-root-guard-r1-20260815` (`ImageID=5c4357c469f5f3614d49bd8b8ae84bdccc45f3b61c68c098ea3aee605a3453e9`)                                                                                                                        |
| Provenance | annotated tag `provenance/sha-5480cefe122f` → `5480cefe122f38fdf1064c1672b860e10060a32c`                                                                                                                                                               |
| Ledger     | `https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl` seq 31                                                                                                                                       |
| Smoke      | healthz **200**; readyz **ready:true**; compiler marker `OPENBOT_CONTEXT_COMPILER` in `/app/dist/reply-Dqqp6vRL.js`; runtime env default-on; inbound flags still `=1` in `/root/.openbot/.env`                                                         |
| Rollback   | restore `/root/openbot-maintenance-context-compiler-main-r1-20260820T131501Z/container-app-dist.before.tgz` into `/app/dist` then `/usr/local/bin/openbot-gateway-restart`. Preserve host Control UI. Do **not** `podman restart -t 0`.                |
| Executor   | `cursor-chat-inbound-depth`                                                                                                                                                                                                                            |
| Merge-back | Candidate already `origin/main` tip at overlay time                                                                                                                                                                                                    |

### Rollback

```bash
BK=/root/openbot-maintenance-context-compiler-main-r1-20260820T131501Z
# tarball: $BK/container-app-dist.before.tgz (sha256 9c7b33ab4d46eebf79ea2d5993a7866b0f860a0fac2bea9f1e7f9857a6dc31ad)
# before commit: 2022bcb0d192b5f99e291d0b50930aa7a6177664
# Preserve /root/.openbot/control-ui (served entry index-Ol92eg1L.js) and /app/dist/control-ui.
WORKDIR=/tmp/restore-context-compiler-main-r1
rm -rf "$WORKDIR" && mkdir -p "$WORKDIR"
tar xzf "$BK/container-app-dist.before.tgz" -C "$WORKDIR"
podman exec openbot-gateway-rc sh -c 'rm -rf /tmp/restore-in /tmp/control-ui-hold && mkdir -p /tmp/restore-in /tmp/control-ui-hold && cp -a /app/dist/control-ui /tmp/control-ui-hold/'
podman cp "$WORKDIR/dist/." openbot-gateway-rc:/tmp/restore-in/
podman exec openbot-gateway-rc sh -c 'find /app/dist -mindepth 1 -maxdepth 1 ! -name control-ui -exec rm -rf {} +; cp -a /tmp/restore-in/. /app/dist/; rm -rf /app/dist/control-ui; cp -a /tmp/control-ui-hold/control-ui /app/dist/control-ui'
/usr/local/bin/openbot-gateway-restart openbot-gateway-rc
```

Context Compiler is **on this LIVE SHA** and remains **default-on** (`OPENBOT_CONTEXT_COMPILER` unset). Inbound A–E flags remain **on** in host `.env` from the #564 overlay. Do not recreate the container.

---

## Previous cutover (2026-08-20) — origin/main gateway+UI overlay (`ws-reconnect-hydrate-r1`)

| Field      | Value                                                                                                                                                                                                                                                      |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date       | Overlay stamp `20260820T100640Z` (`2026-08-20T10:06:40Z`); ledger recorded with seq 31 on 2026-08-20                                                                                                                                                       |
| Decision   | **Strategy 4 + Control UI overlay** of then-current `origin/main` after #564. Not GHCR. Not full-dist. Do not recreate `openbot-gateway-rc`. Keep inbound flags.                                                                                           |
| Source     | `origin/main` @ `2022bcb0d192b5f99e291d0b50930aa7a6177664` (`#564` chat.history reconnect hydrate). Gateway dist + Control UI built off-host.                                                                                                              |
| Build mode | Gateway dist overlay (`gateway-dist-keep-ui` in build-info) plus Control UI overlay `ws-reconnect-hydrate-r69`; base image not replaced                                                                                                                    |
| Container  | `openbot-gateway-rc` (healthz 200, readyz `ready:true`; restart via `podman stop -t 25` + pin update + start)                                                                                                                                              |
| Control UI | Host root `/root/.openbot/control-ui` replaced; served entry `index-Ol92eg1L.js`. Pin `OPENBOT_UI_OVERLAY_PINNED_ENTRY=index-Ol92eg1L.js`.                                                                                                                 |
| Gateway    | overlay `ws-reconnect-hydrate-r1` @ `2022bcb0d192b5f99e291d0b50930aa7a6177664`; previousLive `aa348b38a14a69683bdc5a715ca48d2564a2542d`; 51 commits from previous LIVE                                                                                     |
| Image      | `localhost/openbot:ws-c-v1-root-guard-r1-20260815` (`ImageID=5c4357c469f5f3614d49bd8b8ae84bdccc45f3b61c68c098ea3aee605a3453e9`)                                                                                                                            |
| Provenance | annotated tag `provenance/sha-2022bcb0d192` → `2022bcb0d192b5f99e291d0b50930aa7a6177664`                                                                                                                                                                   |
| Ledger     | `https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl` seq 30                                                                                                                                           |
| Smoke      | healthz **200**; readyz **ready:true**; public entry `index-Ol92eg1L.js`; inbound flags kept `=1` in `/root/.openbot/.env`                                                                                                                                 |
| Rollback   | restore `/root/openbot-maintenance-ws-reconnect-hydrate-r1-20260820T100640Z/container-app-dist.before.tgz` into `/app/dist` and restore host Control UI from that backup, then `/usr/local/bin/openbot-gateway-restart`. Do **not** `podman restart -t 0`. |
| Executor   | `cursor-chat-inbound-depth`                                                                                                                                                                                                                                |
| Merge-back | Candidate already `origin/main` tip at overlay time. Superseded the same day by seq 31.                                                                                                                                                                    |

### Rollback

```bash
BK=/root/openbot-maintenance-ws-reconnect-hydrate-r1-20260820T100640Z
# tarball: $BK/container-app-dist.before.tgz (sha256 b34d1587aa3a16a690bca253a0f8767124c7cb15880cd927c20030ef9ff43949)
# before commit: aa348b38a14a69683bdc5a715ca48d2564a2542d
# This restores inbound-depth-main-r1 gateway dist AND the pre-#564 Control UI.
/usr/local/bin/openbot-gateway-restart openbot-gateway-rc
```

This row is **historical**. Current LIVE is seq 44 (`76fea1fb0669`), not seq 31. Restoring it drops Context Compiler.

---

## Previous cutover (2026-08-20) — origin/main gateway dist overlay (`inbound-depth-main-r1`)

| Field      | Value                                                                                                                                                                                                                                     |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date       | Overlay stamp `20260820T040620Z` (`2026-08-20T04:06:20Z`)                                                                                                                                                                                 |
| Decision   | **Strategy 4:** gateway-dist-keep-ui overlay of then-current `origin/main`. Not GHCR. Not full-dist. Do not recreate `openbot-gateway-rc`. Do not enable inbound flags.                                                                   |
| Source     | `origin/main` @ `aa348b38a14a69683bdc5a715ca48d2564a2542d` (includes #545 A–E, #549 LIVE publication backfill, #551 docs). Built off-host with `GIT_COMMIT=<candidate>` then tarball into `/app/dist`.                                    |
| Build mode | Gateway dist overlay only (`gateway-dist-keep-ui`); base image not replaced                                                                                                                                                               |
| Container  | `openbot-gateway-rc` (healthz 200, readyz `ready:true`; graceful restart via `/usr/local/bin/openbot-gateway-restart`)                                                                                                                    |
| Control UI | Host root `/root/.openbot/control-ui` retained; served entry `index-CYnwD_N8.js`. Container `/app/dist/control-ui` also retained. Env `OPENBOT_UI_OVERLAY_PINNED_ENTRY=index-CopvvBkL.js` is stale (file absent) and was **not** changed. |
| Gateway    | overlay `inbound-depth-main-r1` @ `aa348b38a14a69683bdc5a715ca48d2564a2542d`; previousLive `6ac338479a1644d28a6bca1c48e1921c11f9d36f`; 143 commits from previous LIVE                                                                     |
| Image      | `localhost/openbot:ws-c-v1-root-guard-r1-20260815` (`ImageID=5c4357c469f5f3614d49bd8b8ae84bdccc45f3b61c68c098ea3aee605a3453e9`)                                                                                                           |
| Provenance | annotated tag `provenance/sha-aa348b38a14a` → `aa348b38a14a69683bdc5a715ca48d2564a2542d`                                                                                                                                                  |
| Ledger     | `https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl` seq 29                                                                                                                          |
| Smoke      | healthz **200**; readyz **ready:true**; no `OPENBOT_CHAT_INBOUND_*` env (`NO_INBOUND_FLAGS`); A–E strings present in `/app/dist` (default off)                                                                                            |
| Rollback   | restore `/root/openbot-maintenance-inbound-depth-main-r1-20260820T040620Z/container-app-dist.before.tgz` into `/app/dist` then `/usr/local/bin/openbot-gateway-restart`. Preserve host Control UI. Do **not** `podman restart -t 0`.      |
| Executor   | `cursor-chat-inbound-depth`                                                                                                                                                                                                               |
| Merge-back | Candidate already `origin/main` tip at overlay time                                                                                                                                                                                       |

### Rollback

```bash
BK=/root/openbot-maintenance-inbound-depth-main-r1-20260820T040620Z
# tarball: $BK/container-app-dist.before.tgz (sha256 584de339c95654fc05f93c09d3820201b23e9bc4e4ff93cdc5c100536a697913)
# before commit: 6ac338479a1644d28a6bca1c48e1921c11f9d36f
# Preserve /root/.openbot/control-ui (served entry index-CYnwD_N8.js) and /app/dist/control-ui.
WORKDIR=/tmp/restore-inbound-depth-main-r1
rm -rf "$WORKDIR" && mkdir -p "$WORKDIR"
tar xzf "$BK/container-app-dist.before.tgz" -C "$WORKDIR"
podman exec openbot-gateway-rc sh -c 'rm -rf /tmp/restore-in /tmp/control-ui-hold && mkdir -p /tmp/restore-in /tmp/control-ui-hold && cp -a /app/dist/control-ui /tmp/control-ui-hold/'
podman cp "$WORKDIR/dist/." openbot-gateway-rc:/tmp/restore-in/
podman exec openbot-gateway-rc sh -c 'find /app/dist -mindepth 1 -maxdepth 1 ! -name control-ui -exec rm -rf {} +; cp -a /tmp/restore-in/. /app/dist/; rm -rf /app/dist/control-ui; cp -a /tmp/control-ui-hold/control-ui /app/dist/control-ui'
/usr/local/bin/openbot-gateway-restart openbot-gateway-rc
```

A–E inbound-depth code is **on this LIVE SHA**. Flag canary was enabled on this overlay at **2026-08-20 13:50+08** (owner: 批准在现有 overlay LIVE 上开灰度). Not full-dist. Not GHCR. LIVE commit unchanged.

### Flag canary (2026-08-20 13:50+08) — overlay LIVE gray

| Field     | Value                                                                                                                                                                       |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Owner     | Explicit approve of gray on existing overlay LIVE `aa348b38a14a`                                                                                                            |
| Injection | `/root/.openbot/.env` via `loadDotEnv` (also mirrored in `/root/.openbot/.env.docker`); container **not** recreated                                                         |
| Restart   | `/usr/local/bin/openbot-gateway-restart` after each flag                                                                                                                    |
| Flags     | `PERSIST_EARLY=1` → `SHADOW=1` → `ROUTER=1` → `KNOWLEDGE_POLICY=1` → `TOOL_POLICY=1`                                                                                        |
| Smoke     | healthz **200**; readyz **ready:true**; LIVE commit still `aa348b38a14a69683bdc5a715ca48d2564a2542d` at 2026-08-20T05:54:44Z                                                |
| Backup    | `/root/openbot-maintenance-inbound-depth-main-r1-20260820T040620Z/dot-env.before-canary-20260820T055154Z`                                                                   |
| Rollback  | set the five keys to `0` in reverse order in `.env` then `/usr/local/bin/openbot-gateway-restart`. Do **not** restore the overlay dist backup unless rolling back A–E code. |
| Evidence  | `docs/design/evidence/chat-inbound-depth-canary-gate-2026-08-20.json`                                                                                                       |

---

## Previous cutover (observed 2026-08-19, recorded 2026-08-20) — Item 5 gateway dist overlay (`item5-runtime-align-r1`)

| Field      | Value                                                                                                                                                                                                                                                       |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date       | Overlay stamp `20260819T162800Z` (`2026-08-19T16:28:00Z`); recorded in ledger/RELEASE_RECORD on 2026-08-20                                                                                                                                                  |
| Decision   | **Publication backfill of already-running LIVE.** Do not swap LIVE. Do not full-dist deploy `origin/main`. Do not cut over to `394c9170c6513b0b5512143f3d04a32facd94b94`. Do not enable inbound flags.                                                      |
| Source     | Container `/app/dist/build-info.json` via SSH `root@8.217.93.71` `podman exec openbot-gateway-rc`; git commit `6ac338479a1644d28a6bca1c48e1921c11f9d36f` (`#530`)                                                                                           |
| Build mode | Existing gateway dist overlay only (`gateway-dist-keep-ui`); base image not replaced                                                                                                                                                                        |
| Container  | `openbot-gateway-rc` (healthz 200, readyz `ready:true`)                                                                                                                                                                                                     |
| Control UI | pin retained: `OPENBOT_UI_OVERLAY_PINNED_ENTRY=index-CopvvBkL.js` (UI commit not in `build-info`; pin filename was not in prior Latest cutover)                                                                                                             |
| Gateway    | overlay `item5-runtime-align-r1` @ `6ac338479a1644d28a6bca1c48e1921c11f9d36f`; previousLive `34595862f785c90a4e0e30587db33690c2e139d2`                                                                                                                      |
| Image      | `localhost/openbot:ws-c-v1-root-guard-r1-20260815` (`ImageID=5c4357c469f5f3614d49bd8b8ae84bdccc45f3b61c68c098ea3aee605a3453e9`)                                                                                                                             |
| Provenance | annotated tag `provenance/sha-6ac338479a16` → `6ac338479a1644d28a6bca1c48e1921c11f9d36f` (LIVE identity; **not** `provenance/sha-394c9170c651`)                                                                                                             |
| Ledger     | `https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl` seq 28                                                                                                                                            |
| Smoke      | healthz **200**; readyz **ready:true**; no `OPENBOT_CHAT_INBOUND_*` env (`NO_INBOUND_FLAGS`)                                                                                                                                                                |
| Rollback   | restore `/root/openbot-maintenance-item5-runtime-align-20260819T162800Z/container-app-dist.before.tgz` into `/app/dist` (preserve control-ui) + `podman restart`. Write-pre dir is catalog/registry only, not dist. This row does **not** authorize a swap. |
| Executor   | overlay: Item 5 runtime alignment (`cursor-data-governance`); ledger/RELEASE_RECORD backfill: `cursor-chat-inbound-depth`                                                                                                                                   |
| Merge-back | Not a new cutover. Unledgered LIVE history between seq 27 (`4f249e67` 2026-08-07) and this observation is not reconstructed here.                                                                                                                           |

### Rollback

Do not treat this section as approval to swap LIVE. Overlay dist backup (verified present 2026-08-20, **not restored**):

```bash
BK=/root/openbot-maintenance-item5-runtime-align-20260819T162800Z
# Restore only if production owner explicitly orders a rollback of item5-runtime-align-r1.
# tarball: $BK/container-app-dist.before.tgz (sha256 bf99cd107f8f16ab03e90210786ed4c8d3d533b3b3c0472f299f50770a1bccc0)
# before commit: 34595862f785c90a4e0e30587db33690c2e139d2
# Preserve /app/dist/control-ui (live pin index-CopvvBkL.js is newer than pin.env.before).
# Then: podman restart openbot-gateway-rc
# Do NOT use /root/openbot-item5-runtime-align-write-pre-20260819T163148Z — that is catalog/registry JSON, not gateway dist.
```

A–E inbound-depth code is **not** on this LIVE SHA. Flag canary is not possible until a later, separately approved candidate that contains A–E is on LIVE.

---

## Previous cutover (2026-08-11 ~23:59 CST) — Group shared public transcript (`group-shared-transcript-r1b`)

| Field      | Value                                                                                                                                                                                  |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date       | 2026-08-11 (live ~23:59 CST / stamp `20260811T155932Z`)                                                                                                                                |
| Decision   | 协作小组 `space:{groupId}` 公共转写改为 `groups/<id>/runtime/transcript.jsonl` 成员共享；惰性合并 per-user 历史；跳过 space: promote 分裂；保留现网 UI pin。                           |
| Source     | `cursor/workbench-isolation-r6` @ `e3117e0503f2ee6e4910b09bdb624e98b97eeec1` → gateway `openbot-gateway-dist-group-shared-transcript-r1b-20260811T155932Z.tar.gz`                      |
| Build mode | Clean archive + schema/usage/spaces parity inject；gateway dist overlay only（exclude control-ui，嵌入现网 UI）+ `podman restart`                                                      |
| Container  | `openbot-gateway-rc`（healthz/readyz 200）                                                                                                                                             |
| Control UI | unchanged（invite-activation-row-busy-r63 pin）                                                                                                                                        |
| Gateway    | overlay `group-shared-transcript-r1b` @ `e3117e0503…`                                                                                                                                  |
| Smoke      | healthz **200**；readyz **ready:true**；dist markers `bindGroupPublicTranscript` / `runtime/transcript.jsonl` OK                                                                       |
| Rollback   | restore `/root/openbot-maintenance-group-shared-transcript-r1b-20260811T155932Z/container-app-dist-pkg.before.tgz` into container `/app/dist`（preserve control-ui）+ `podman restart` |
| Executor   | `cursor-grok`                                                                                                                                                                          |
| Merge-back | Pending — land via PR #317 / focused PR onto `main`                                                                                                                                    |

### Rollback

```bash
STAMP=20260811T155932Z
OVERLAY=group-shared-transcript-r1b
BK=/root/openbot-maintenance-${OVERLAY}-${STAMP}
WORKDIR=/tmp/restore-${OVERLAY}-${STAMP}
rm -rf "$WORKDIR" && mkdir -p "$WORKDIR"
tar xzf "$BK/container-app-dist-pkg.before.tgz" -C "$WORKDIR"
podman exec openbot-gateway-rc sh -c 'rm -rf /tmp/restore-in /tmp/control-ui-hold && mkdir -p /tmp/restore-in /tmp/control-ui-hold && cp -a /app/dist/control-ui /tmp/control-ui-hold/'
podman cp "$WORKDIR/dist/." openbot-gateway-rc:/tmp/restore-in/
podman exec openbot-gateway-rc sh -c 'find /app/dist -mindepth 1 -maxdepth 1 ! -name control-ui -exec rm -rf {} +; cp -a /tmp/restore-in/. /app/dist/; rm -rf /app/dist/control-ui; cp -a /tmp/control-ui-hold/control-ui /app/dist/control-ui'
podman restart openbot-gateway-rc
```

---

## Previous cutover (2026-08-11 ~11:58 CST) — Invite activation per-row busy (`invite-activation-row-busy-r63`)

| Field      | Value                                                                                                                                                                                                  |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Date       | 2026-08-11 (live ~11:58 CST / stamp `20260811T035755Z`)                                                                                                                                                |
| Decision   | 组织「邀请激活」发送激活邮件时，仅当前邮箱行显示「处理中...」，不再因全局 `platformAuthBusy` 把整表置忙。                                                                                              |
| Source     | `cursor/workbench-isolation-r6` @ `e99de23381cf83fa9eb3abe2fa29c8e48201c119` → ui `openbot-control-ui-invite-activation-row-busy-r63-20260811T035755Z.tar.gz` (md5 `71c2207ac5c7bd1d08ecbd04888c42f9`) |
| Build mode | Local `pnpm ui:build` UI overlay only（gateway 未改）                                                                                                                                                  |
| Container  | `openbot-gateway-rc`（healthz/readyz 200）                                                                                                                                                             |
| Control UI | `index-CJ8NixY3.js`                                                                                                                                                                                    |
| Gateway    | unchanged (`personal-scope-main-r2` @ `211ffaf315…`)                                                                                                                                                   |
| Smoke      | healthz **200**；readyz **ready:true**；www/gw entry `index-CJ8NixY3.js`；markers `发送激活` / `待激活成员` / `月成本` OK                                                                              |
| Rollback   | restore `/root/.openbot/control-ui.bak-pre-invite-activation-row-busy-r63-20260811T035755Z` + baseline pin/control-ui bak, then refresh container UI + `podman restart`                                |
| Executor   | `cursor-grok`                                                                                                                                                                                          |
| Merge-back | Pending — land via PR #317                                                                                                                                                                             |

### Rollback

```bash
STAMP=20260811T035755Z
OVERLAY=invite-activation-row-busy-r63
cp -a /root/.openbot/control-ui.bak-pre-${OVERLAY}-${STAMP}/. /root/.openbot/control-ui/
cp -a /root/openbot-ui-baselines/v3.0/control-ui.bak-pre-${OVERLAY}-${STAMP}/. /root/openbot-ui-baselines/v3.0/control-ui/
cp -a /root/openbot-ui-baselines/v3.0/pin.env.bak-pre-${OVERLAY}-${STAMP} /root/openbot-ui-baselines/v3.0/pin.env
cp -a /root/openbot-ui-baselines/v3.0/pin.env /root/.openbot/pin.env
podman cp /root/.openbot/control-ui/. openbot-gateway-rc:/app/dist/control-ui/
podman restart openbot-gateway-rc
```

---

## Previous cutover (2026-08-11 ~11:31 CST) — Mesh monthly + lifetime cost (`mesh-monthly-lifetime-cost-r62`)

| Field      | Value                                                                                                                                                                                                  |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Date       | 2026-08-11 (live ~11:31 CST / stamp `20260811T033016Z`)                                                                                                                                                |
| Decision   | 机巢列表成本改为日历月「月成本」；详情增加「总成本（累积）」；lifetime usage 独立加载不覆盖月度 `usageResult`。                                                                                        |
| Source     | `cursor/workbench-isolation-r6` @ `f37c50521c9e4988f3f774308e988d5aa03410d2` → ui `openbot-control-ui-mesh-monthly-lifetime-cost-r62-20260811T033016Z.tar.gz` (md5 `7a4f0839e3b08eb6fb98353b400a179e`) |
| Build mode | Local `pnpm ui:build` UI overlay only（gateway 未改）                                                                                                                                                  |
| Container  | `openbot-gateway-rc`（healthz/readyz 200）                                                                                                                                                             |
| Control UI | `index-CUg5htrW.js`                                                                                                                                                                                    |
| Gateway    | unchanged (`personal-scope-main-r2` @ `211ffaf315…`)                                                                                                                                                   |
| Smoke      | healthz **200**；readyz **ready:true**；www/gw entry `index-CUg5htrW.js`；markers `月成本` / `总成本（累积）` / `meshLifetimeUsageResult` OK                                                           |
| Rollback   | restore `/root/.openbot/control-ui.bak-pre-mesh-monthly-lifetime-cost-r62-20260811T033016Z` + baseline pin/control-ui bak, then refresh container UI + `podman restart`                                |
| Executor   | `cursor-grok`                                                                                                                                                                                          |
| Merge-back | Pending — land via PR #317 / mesh-org-usage-wire                                                                                                                                                       |

### Rollback

```bash
STAMP=20260811T033016Z
OVERLAY=mesh-monthly-lifetime-cost-r62
cp -a /root/.openbot/control-ui.bak-pre-${OVERLAY}-${STAMP}/. /root/.openbot/control-ui/
cp -a /root/openbot-ui-baselines/v3.0/control-ui.bak-pre-${OVERLAY}-${STAMP}/. /root/openbot-ui-baselines/v3.0/control-ui/
cp -a /root/openbot-ui-baselines/v3.0/pin.env.bak-pre-${OVERLAY}-${STAMP} /root/openbot-ui-baselines/v3.0/pin.env
cp -a /root/openbot-ui-baselines/v3.0/pin.env /root/.openbot/pin.env
podman cp /root/.openbot/control-ui/. openbot-gateway-rc:/app/dist/control-ui/
podman restart openbot-gateway-rc
```

---

## Previous cutover (2026-08-11 ~11:29 CST) — Hide pre-compaction memory-flush prompts (`chat-hide-memory-flush-prompt-r29`)

| Field      | Value                                                                                                                                                                                                                                                                       |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date       | 2026-08-11 (live ~11:29 CST / stamp `20260811T032449Z`)                                                                                                                                                                                                                     |
| Decision   | 长会话 Pre-compaction memory flush 的内部 user prompt 不再经 `chat.history` / UI 渲染为 CEO 气泡；COMPACTION 分隔符可保留。                                                                                                                                                 |
| Source     | `cursor/workbench-isolation-r6` @ `9af8a6443f43254501e27fe041cbfafc05ab2b57` → gw `openbot-gw-dist-hide-flush-r29-9af8a6443f.tgz` (md5 `260be9bb45e4a6c4f3ecb61c56289926`) + ui `openbot-control-ui-hide-flush-r29-9af8a6443f.tgz` (md5 `99e47ec579cb3840bb51a55968ef9984`) |
| Build mode | Clean archive + tsdown/ui:build overlay；commits `ad97954374` + `9af8a6443f`                                                                                                                                                                                                |
| Container  | `openbot-gateway-rc`（healthz/readyz 200）                                                                                                                                                                                                                                  |
| Control UI | `index-BXpqJOie.js`                                                                                                                                                                                                                                                         |
| Gateway    | `chat-hide-memory-flush-prompt-r29`（gitSha `9af8a6443f…`）                                                                                                                                                                                                                 |
| Smoke      | healthz **200**；readyz **ready:true**；www/gw entry `index-BXpqJOie.js`；`isMemoryFlushHistoryMessage` in `/app/dist`；pin `OPENBOT_UI_OVERLAY_PINNED_ENTRY=index-BXpqJOie.js`                                                                                             |
| Rollback   | restore `/root/openbot-maintenance-hide-flush-r29-20260811T032449Z/container-app-dist.before.tgz` + UI/pin bak then `podman restart`                                                                                                                                        |
| Executor   | `cursor-grok`                                                                                                                                                                                                                                                               |
| Merge-back | Pending — land hide-flush commits to `main` via PR                                                                                                                                                                                                                          |

### Rollback

```bash
STAMP=20260811T032449Z
OVERLAY=hide-flush-r29
BK=/root/openbot-maintenance-${OVERLAY}-${STAMP}
mkdir -p /tmp/gw-dist-rollback
tar xzf "$BK/container-app-dist.before.tgz" -C /tmp/gw-dist-rollback
podman exec openbot-gateway-rc sh -c 'rm -rf /app/dist && mkdir -p /app/dist'
tar czf - -C /tmp/gw-dist-rollback/dist . | podman exec -i openbot-gateway-rc sh -c 'cd /app/dist && tar xzf -'
cp -a /root/.openbot/control-ui.bak-pre-hide-flush-r29-$STAMP /root/.openbot/control-ui
cp -a /root/openbot-ui-baselines/v3.0/control-ui.bak-pre-hide-flush-r29-$STAMP /root/openbot-ui-baselines/v3.0/control-ui
cp -a /root/openbot-ui-baselines/v3.0/pin.env.bak-pre-hide-flush-r29-$STAMP /root/openbot-ui-baselines/v3.0/pin.env
podman restart openbot-gateway-rc
```

---

## Previous cutover (2026-08-11 ~10:48 CST) — Personal scope for spaces.list + sessions.usage (`personal-scope-r1`)

| Field      | Value                                                                                                                                                                                                                                                                                                               |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date       | 2026-08-11 (live ~10:48 CST / stamp `20260811T024708Z`)                                                                                                                                                                                                                                                             |
| Decision   | CEO/enterprise-admin 个人工作台默认 `scope=self`：协作小组与模型消费量不再继承租户全量；机巢显式 `scope=tenant`。                                                                                                                                                                                                   |
| Source     | `origin/main` @ `6d5b386061821c43d12db5986716934d98073a75` + personal-scope patches → gw `openbot-gateway-dist-pkg-personal-scope-r1-20260811T024708Z.tar.gz` (md5 `c9a1c36e30a3ed70032ca89df61d3624`) + ui `openbot-control-ui-personal-scope-r1-20260811T024708Z.tar.gz` (md5 `d63678d3b36e5fcead45d683e7dafa70`) |
| Build mode | Clean `git archive` of `origin/main` + scoped file patches；Gate1 `verify-forward-only` allow（LIVE `bd9ade0e52` ⊂ candidate `6d5b386061`）                                                                                                                                                                         |
| Container  | `openbot-gateway-rc`（healthz/readyz 200）                                                                                                                                                                                                                                                                          |
| Control UI | `index-C6lIfVU6.js`                                                                                                                                                                                                                                                                                                 |
| Gateway    | `personal-scope-r1`（pin `OPENBOT_GATEWAY_OVERLAY_GIT_SHA` = `6d5b386061…`）                                                                                                                                                                                                                                        |
| Smoke      | healthz **200**；readyz **ready:true**；www/gw entry `index-C6lIfVU6.js`；WSS 101；pin watch OK                                                                                                                                                                                                                     |
| Rollback   | restore `/root/openbot-maintenance-personal-scope-r1-20260811T024708Z/container-app-dist-pkg.before.tgz` + UI/pin bak then `podman restart`                                                                                                                                                                         |
| Executor   | `cursor-grok`                                                                                                                                                                                                                                                                                                       |
| Merge-back | Pending — land personal-scope patches to `main` via PR                                                                                                                                                                                                                                                              |

### Rollback

```bash
STAMP=20260811T024708Z
OVERLAY=personal-scope-r1
BK=/root/openbot-maintenance-${OVERLAY}-${STAMP}
mkdir -p /tmp/gw-dist-rollback /tmp/ui-rollback
tar xzf "$BK/container-app-dist-pkg.before.tgz" -C /tmp/gw-dist-rollback
podman exec openbot-gateway-rc sh -c 'rm -rf /app/dist && mkdir -p /app/dist'
podman cp /tmp/gw-dist-rollback/dist/. openbot-gateway-rc:/app/dist/
cp -a "$BK/control-ui.before" /root/.openbot/control-ui
cp -a "$BK/pin.env.before" /root/.openbot/pin.env
cp -a "$BK/baseline-pin.env.before" /root/openbot-ui-baselines/v3.0/pin.env
cp -a "$BK/baseline-control-ui.before" /root/openbot-ui-baselines/v3.0/control-ui
podman restart openbot-gateway-rc
```

---

## Previous cutover (2026-08-11 ~08:12 CST) — External source ingest on `origin/main` base (`knowledge-ext-source-main-r31`)

| Field      | Value                                                                                                                                                                                                                                                                                                                                   |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date       | 2026-08-11 (live ~08:12 CST / stamp `20260811T001019Z`)                                                                                                                                                                                                                                                                                 |
| Decision   | 在 `origin/main` tip 上恢复 external source sync/ingest + KB-bound data_capability 白名单（#331 lib-pano 保留）。                                                                                                                                                                                                                       |
| Source     | `cursor/knowledge-ext-source-main` @ `90f1aff6e87f6230655361274bff18cbd66ce840` → gw `openbot-gateway-dist-pkg-knowledge-ext-source-main-r31-20260811T001019Z.tar.gz` (md5 `f96da4ad021ad978eea3536b86e4d601`) + ui `openbot-control-ui-knowledge-ext-source-main-r31-20260811T001019Z.tar.gz` (md5 `943a07de052c91b5a93d297217418719`) |
| Build mode | Cherry-pick onto `origin/main` + `pnpm build` full-dist；Gate1 `verify-forward-only` allow（LIVE `87fc7e0a25` ⊂ candidate）                                                                                                                                                                                                             |
| Container  | `openbot-gateway-rc`（healthz/readyz 200）                                                                                                                                                                                                                                                                                              |
| Control UI | `index-BRCRxrdi.js`                                                                                                                                                                                                                                                                                                                     |
| Gateway    | `knowledge-ext-source-main-r31`（pin `OPENBOT_GATEWAY_OVERLAY_GIT_SHA` = `90f1aff6e8…`）                                                                                                                                                                                                                                                |
| Smoke      | healthz **200**；readyz **ready:true**；public entry `index-BRCRxrdi.js`；`knowledge.source.ingest` marker in gateway-cli + workbench UI                                                                                                                                                                                                |
| Rollback   | restore `/root/openbot-maintenance-knowledge-ext-source-main-r31-20260811T001019Z/container-app-dist-pkg.before.tgz` + UI/pin bak then `podman restart`                                                                                                                                                                                 |
| Executor   | `cursor-grok`                                                                                                                                                                                                                                                                                                                           |
| Merge-back | PR pending — branch `cursor/knowledge-ext-source-main` → `main`                                                                                                                                                                                                                                                                         |

### Rollback

```bash
STAMP=20260811T001019Z
OVERLAY=knowledge-ext-source-main-r31
BK=/root/openbot-maintenance-${OVERLAY}-${STAMP}
mkdir -p /tmp/gw-dist-rollback /tmp/ui-rollback
tar xzf "$BK/container-app-dist-pkg.before.tgz" -C /tmp/gw-dist-rollback
podman exec openbot-gateway-rc sh -c 'rm -rf /app/dist && mkdir -p /app/dist'
podman cp /tmp/gw-dist-rollback/dist/. openbot-gateway-rc:/app/dist/
cp -a "$BK/control-ui.before" /root/.openbot/control-ui
cp -a "$BK/pin.env.before" /root/.openbot/pin.env
podman restart openbot-gateway-rc
```

---

## Previous cutover (2026-08-11 ~08:05 CST) — Formal gateway cutover from `origin/main` (`main-tip-gateway-r1`)

| Field      | Value                                                                                                                                                                                                                             |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date       | 2026-08-11 (live ~08:05 CST / stamp `20260811T000319Z`)                                                                                                                                                                           |
| Decision   | 将 LIVE gateway dist 对齐到 `origin/main` tip，结束侧支 overlay SHA；保留现网 Control UI pin。                                                                                                                                    |
| Source     | `origin/main` @ `87fc7e0a25d5655c31d553083bfa9b3e339e5100`（含 #319 starter-pack-abc + #331 knowledge-lib-pano）→ `openbot-gateway-dist-pkg-main-tip-gateway-r1-20260811T000319Z.tar.gz` (md5 `76b5d085113786698c068015c07f9f75`) |
| Build mode | Clean `git archive` + collab packages + tsdown；exclude `dist/control-ui`，再嵌入现网 container control-ui；Gate1 `verify-forward-only` allow（LIVE `f35e37d4be` ⊂ candidate）                                                    |
| Container  | `openbot-gateway-rc`（healthz/readyz 200）                                                                                                                                                                                        |
| Control UI | unchanged（`index-BS6Sniu3.js` / pin preserved）                                                                                                                                                                                  |
| Gateway    | `main-tip-gateway-r1`（`commit`/`gatewayOverlay.gitSha` = `87fc7e0a25…`）                                                                                                                                                         |
| Smoke      | healthz **200**；readyz **ready:true**；markers `autoInstallCapabilitiesOnAgentCreate` / `entitleTenantForPlan` / `focusDocumentId` present；UI pin asset OK                                                                      |
| Rollback   | restore `/root/openbot-maintenance-main-tip-gateway-r1-20260811T000319Z/container-app-dist-pkg.before.tgz` then `podman restart`                                                                                                  |
| Executor   | `cursor-grok`                                                                                                                                                                                                                     |
| Merge-back | N/A — candidate already `origin/main` tip                                                                                                                                                                                         |

### Rollback

```bash
STAMP=20260811T000319Z
OVERLAY=main-tip-gateway-r1
BK=/root/openbot-maintenance-${OVERLAY}-${STAMP}
mkdir -p /tmp/gw-dist-rollback && rm -rf /tmp/gw-dist-rollback/*
tar xzf "$BK/container-app-dist-pkg.before.tgz" -C /tmp/gw-dist-rollback
podman exec openbot-gateway-rc sh -c 'rm -rf /app/dist && mkdir -p /app/dist'
podman cp /tmp/gw-dist-rollback/dist/. openbot-gateway-rc:/app/dist/
podman restart openbot-gateway-rc
```

### Note

- Cutover 前 LIVE 为侧支 overlay `knowledge-library-panorama-r30` @ `f35e37d4be`；#331 合入 `main` 后 Gate1 才通过。
- `media-monitor` 插件加载告警（缺 media-monitor plugin-sdk 入口）未阻断 gateway 启动；与本次 cutover 并存观察。

---

## Previous cutover (2026-08-11 ~08:02 CST) — External source ingest + data_capability allowlist (`knowledge-external-source-consume-r28`)

| Field      | Value                                                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------------------------ |
| Date       | 2026-08-11 (live ~08:02 CST)                                                                                       |
| Decision   | 绑定的 api/external 源支持「同步/沉淀」进 kb-index；员工/管家 `data_capability` 按知识空间绑定 source 白名单过滤。 |
| Source     | `cursor/workbench-isolation-r6` @ `5e69282dd1` → gw+ui tarballs `ext-src-r28` / `index-DuLaHY1b.js`                |
| Build mode | Gateway dist overlay + Control UI pin                                                                              |
| Container  | `openbot-gateway-rc`（healthz/readyz 200）                                                                         |
| Control UI | `index-DuLaHY1b.js`                                                                                                |
| Gateway    | `knowledge-external-source-consume-r28`                                                                            |
| Smoke      | healthz/readyz **200**；public entry `index-DuLaHY1b.js`；`knowledge.source.ingest` marker                         |
| Rollback   | restore `/root/openbot-maintenance-ext-src-r28-*/container-app-dist.before.tgz` + UI/pin bak                       |
| Executor   | `cursor-grok`                                                                                                      |

## Previous cutover (2026-08-11 ~07:35 CST) — Knowledge space library panorama (`knowledge-library-panorama-r27`)

| Field      | Value                                                                                                      |
| ---------- | ---------------------------------------------------------------------------------------------------------- |
| Date       | 2026-08-11 (live ~07:35 CST)                                                                               |
| Decision   | 选中企业/知识空间文件夹时加载该空间文档级全景；外部知识源仍为 active 注册项，需 sync/ingest 后才进关系图。 |
| Source     | `cursor/workbench-isolation-r6` @ `858ed4b77d` → gw+ui tarballs `lib-pano-r27` / `index-C8IGWn1-.js`       |
| Build mode | Gateway dist overlay + Control UI pin                                                                      |
| Container  | `openbot-gateway-rc`（healthz/readyz 200）                                                                 |
| Control UI | `index-C8IGWn1-.js`                                                                                        |
| Gateway    | `knowledge-library-panorama-r27`                                                                           |
| Smoke      | healthz/readyz **200**；public entry `index-C8IGWn1-.js`；`library-panorama` marker                        |
| Rollback   | restore `/root/openbot-maintenance-lib-pano-r27-*/container-app-dist.before.tgz` + UI/pin bak              |
| Executor   | `cursor-grok`                                                                                              |

## Previous cutover (2026-08-11 ~06:35 CST) — Document ego focus for 关系洞察 (`knowledge-document-ego-focus-r26`)

| Field      | Value                                                                                                                               |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Date       | 2026-08-11 (live ~06:35 CST)                                                                                                        |
| Decision   | `knowledge.relationships` 透传 `focusDocumentId`/`knowledgeBaseId`；选中文档时返回文档 ego 拓扑，不再回落库级文件夹全景。           |
| Source     | `cursor/workbench-isolation-r6` @ `8838a93bd9` → `/tmp/openbot-gw-dist-doc-ego-r26-8838a93bd9.tgz` + control-ui `index-Csl9Zy-j.js` |
| Build mode | Gateway dist overlay + Control UI pin                                                                                               |
| Container  | `openbot-gateway-rc`（healthz/readyz 200）                                                                                          |
| Control UI | `index-Csl9Zy-j.js`（文案：暂无跨文档关系，当前仅展示本文档）                                                                       |
| Gateway    | `knowledge-document-ego-focus-r26`                                                                                                  |
| Smoke      | healthz/readyz **200**；public entry `index-Csl9Zy-j.js`；`focusDocumentId` marker in dist                                          |
| Rollback   | restore `/root/openbot-maintenance-doc-ego-r26-*/container-app-dist.before.tgz` + UI/pin bak then restart                           |
| Executor   | `cursor-grok`                                                                                                                       |
| Merge-back | Pending — commits on `cursor/workbench-isolation-r6` (`13320861ce`…`8838a93bd9`)                                                    |

### Rollback

```bash
# pick latest stamp under /root/openbot-maintenance-doc-ego-r26-*
BK=$(ls -d /root/openbot-maintenance-doc-ego-r26-* | tail -1)
podman exec openbot-gateway-rc sh -c 'rm -rf /app/dist && mkdir -p /app/dist'
cat "$BK/container-app-dist.before.tgz" | podman exec -i openbot-gateway-rc sh -c 'cd /app && tar xzf -'
podman restart openbot-gateway-rc
```

## Previous cutover (2026-08-11 ~00:16 CST) — Knowledge graph personal owner ACL (`knowledge-graph-owner-isolation-r25`)

| Field      | Value                                                                                                                                |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Date       | 2026-08-11 (live ~00:16 CST / stamp `20260810T161342Z`)                                                                              |
| Decision   | 关系洞察 personal skill 资产按 `ownerUserId` fail-closed 过滤；排除 legacy `ownerUserId=null`；source-bundle 增加隔离计数日志。      |
| Source     | `cursor/workbench-isolation-r6` @ `1b09d977a3` → `/tmp/openbot-gw-dist-isolation-r25-1b09d977a3.tgz`（clean `git archive` + tsdown） |
| Build mode | Gateway dist overlay（exclude control-ui，再嵌入现网 `/root/.openbot/control-ui`）+ `podman restart` + image commit                  |
| Container  | `openbot-gateway-rc`（healthz/readyz 200）                                                                                           |
| Control UI | unchanged（`index-4Bw94W3P.js`）                                                                                                     |
| Gateway    | `knowledge-graph-owner-isolation-r25`（marker `knowledge source bundle isolation`）                                                  |
| Smoke      | healthz/readyz **200**；build-info overlay id `knowledge-graph-owner-isolation-r25`；public entry still `index-4Bw94W3P.js`          |
| Rollback   | restore `/root/openbot-maintenance-isolation-r25-20260810T161342Z/container-app-dist.before.tgz` then `podman restart`               |
| Executor   | `cursor-grok`                                                                                                                        |
| Merge-back | Pending — commits on `cursor/workbench-isolation-r6` (`546a758aa3`…`1b09d977a3`)                                                     |

### Rollback

```bash
STAMP=20260810T161342Z
BK=/root/openbot-maintenance-isolation-r25-$STAMP
podman exec openbot-gateway-rc sh -c 'rm -rf /app/dist && mkdir -p /app/dist'
cat "$BK/container-app-dist.before.tgz" | podman exec -i openbot-gateway-rc sh -c 'cd /app && tar xzf -'
podman restart openbot-gateway-rc
```

### Image tags

- `localhost/openbot:rc-amd64-overlay-knowledge-graph-owner-isolation-r25`
- retagged: `localhost/openbot:ui-v3.0.11-embed-hydration`, `localhost/openbot:ui-v3.0`

## Previous cutover (2026-08-10 ~18:22 CST) — A/B/C capability-pack hooks gateway overlay (`starter-pack-abc-hooks-r2`)

| Field      | Value                                                                                                                                                                  |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date       | 2026-08-10 (live ~18:22 CST / stamp `20260810T101417Z`)                                                                                                                |
| Decision   | 将 `agents.create` 自动装 starter 与企业开通 `entitleTenantForPlan` 打进 LIVE gateway dist；承接 `starter-pack-abc-r1` 的技能资产/registry 热更。                      |
| Source     | `cursor/workbench-isolation-r6` @ `84ae741ae6` → `openbot-gateway-dist-pkg-starter-pack-abc-hooks-r2-20260810T101417Z.tar.gz` (md5 `c83a301c85ed6dbb6d176acf1249357e`) |
| Build mode | Gateway dist overlay（exclude control-ui，再嵌入现网 control-ui）+ restart                                                                                             |
| Container  | `openbot-gateway-rc`（healthz/readyz 200）                                                                                                                             |
| Control UI | unchanged（preserved from live container）                                                                                                                             |
| Gateway    | `starter-pack-abc-hooks-r2`（`capabilityInstall` / `autoInstallCapabilitiesOnAgentCreate` markers present）                                                            |
| Smoke      | healthz/readyz **200**；`/app/skills` starter sample OK；build-info overlay id `starter-pack-abc-hooks-r2`                                                             |
| Rollback   | restore `/root/openbot-maintenance-starter-pack-abc-hooks-r2-20260810T101417Z/container-app-dist-pkg.before.tgz` then `podman restart`                                 |
| Executor   | `cursor-grok`                                                                                                                                                          |
| Merge-back | Pending — commits already on `cursor/workbench-isolation-r6` (`506386719d`…`84ae741ae6`)                                                                               |

### Rollback

```bash
STAMP=20260810T101417Z
OVERLAY=starter-pack-abc-hooks-r2
BK=/root/openbot-maintenance-${OVERLAY}-${STAMP}
mkdir -p /tmp/gw-dist-rollback && rm -rf /tmp/gw-dist-rollback/*
tar xzf "$BK/container-app-dist-pkg.before.tgz" -C /tmp/gw-dist-rollback
podman exec openbot-gateway-rc sh -c 'rm -rf /app/dist && mkdir -p /app/dist'
podman cp /tmp/gw-dist-rollback/dist/. openbot-gateway-rc:/app/dist/
podman restart openbot-gateway-rc
```

---

## Previous cutover (2026-08-10 ~18:02 CST) — A/B/C starter pack skills overlay (`starter-pack-abc-r1`)

| Field      | Value                                                                                                                                                                                                                                                                                          |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date       | 2026-08-10 (live ~18:02 CST / stamp `20260810T100144Z`)                                                                                                                                                                                                                                        |
| Decision   | 落地员工开放策略 A/B/C：starter 15 技能全员 `direct_employee_visible`；cn-office 保持 `enterprise_review_required`；剔除假条目 `web-search`/`ppt-generator`；补齐缺失 bundled 技能目录。                                                                                                       |
| Source     | working-tree `skills/{15 starter}` + `capability-packs` snapshot → host overlay via `scripts/audit/apply-starter-pack-overlay.sh --apply`                                                                                                                                                      |
| Build mode | Host file overlay（governance/registry + tenant-pack-entitlements + managed skills + container `/app/skills`）；gateway dist **未换**（`agents.create` 自动装包 / 企业开通 entitle 代码待后续 dist overlay）                                                                                   |
| Container  | `openbot-gateway-rc`（restarted；healthz/readyz 200）                                                                                                                                                                                                                                          |
| Control UI | unchanged                                                                                                                                                                                                                                                                                      |
| Gateway    | unchanged LIVE overlay `webchat-identity-hydrate-r1` (`9f8edb6f5f`)                                                                                                                                                                                                                            |
| Registry   | starter **15** `direct_employee_visible`；`web-search`/`ppt-generator` demote → `enterprise_only`；cn-office 保持 review                                                                                                                                                                       |
| Smoke      | `/app/skills` 15/15 OK；healthz/readyz **200**；direct_keys=agent-reach,canvas,configure-external-api-source,cyber-ppt,defuddle,finance-research,json-canvas,meeting-notes-specialist,nano-pdf,openai-whisper-api,openbot-platform-ops,summarize,user-guidance-protocol,weather,wechat-article |
| Rollback   | restore `/root/openbot-maintenance-starter-pack-abc-20260810T100144Z/{registry.json,tenant-pack-entitlements.json,skills}.before` then `podman restart openbot-gateway-rc`                                                                                                                     |
| Executor   | `cursor-grok`                                                                                                                                                                                                                                                                                  |
| Merge-back | Pending — commit capability-packs + vendored skills + wiring to trunk, then optional gateway dist overlay for create/entitle hooks                                                                                                                                                             |

### Rollback

```bash
STAMP=20260810T100144Z
BK=/root/openbot-maintenance-starter-pack-abc-${STAMP}
cp -a "$BK/registry.json.before" /root/.openbot/governance/registry.json
cp -a "$BK/tenant-pack-entitlements.json.before" /root/.openbot/governance/tenant-pack-entitlements.json
rm -rf /root/.openbot/skills
cp -a "$BK/skills.before" /root/.openbot/skills
# optional: remove newly added /app/skills dirs then restart
podman restart openbot-gateway-rc
```

### Note

- 技能资产 + 治理可见性在本条 cutover 落地；create/entitle hooks 已在后续 `starter-pack-abc-hooks-r2` gateway dist overlay 上线。

---

## Previous cutover (2026-08-10 ~16:51 CST) — webchat chat.send 补全登录身份 (`webchat-identity-hydrate-r1`)

| Field      | Value                                                                                                                                                                                                                                             |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date       | 2026-08-10 (live ~16:51 CST / artifact `20260810T084910Z`)                                                                                                                                                                                        |
| Decision   | Device-token webchat 连接即使 upgrade 带了平台登录 cookie，也可能未写入 `client.user`，导致 `user_operational_identity` 报 `USER_IDENTITY_SESSION_REQUIRED`。WS connect 暂存 cookie、优先 cookie session，并在 `chat.send`/`agent` 前再 hydrate。 |
| Source     | `cursor/workbench-isolation-r6` @ `9f8edb6f5f` gateway-dist-overlay `webchat-identity-hydrate-r1`（UI pin 不变）                                                                                                                                  |
| Build mode | Gateway dist overlay only → container `/app/dist` replace + restart                                                                                                                                                                               |
| Container  | `openbot-gateway-rc`                                                                                                                                                                                                                              |
| Control UI | `index-DENGRpxr.js`（unchanged）                                                                                                                                                                                                                  |
| Gateway    | `webchat-identity-hydrate-r1` (`hydrateWebchatGatewayClientPlatformIdentity` / `upgradeRequestCookie` / prefer cookie session)                                                                                                                    |
| Pin        | `OPENBOT_UI_OVERLAY_PINNED_ENTRY=index-DENGRpxr.js` / `OPENBOT_UI_OVERLAY=seat-grant-roster-r21`                                                                                                                                                  |
| Smoke      | healthz **200**; readyz **ready:true**; verify-control-ui-v3 **OK**; watch pin **OK**; GW markers present                                                                                                                                         |
| Rollback   | Gateway: restore `/root/openbot-maintenance-webchat-identity-hydrate-r1-20260810T084910Z/container-app-dist-pkg.before.tgz`                                                                                                                       |
| Executor   | `cursor-grok`                                                                                                                                                                                                                                     |
| Merge-back | Pending                                                                                                                                                                                                                                           |

### Rollback

```bash
STAMP=20260810T084910Z
OVERLAY=webchat-identity-hydrate-r1
BK=/root/openbot-maintenance-${OVERLAY}-${STAMP}
mkdir -p /tmp/gw-dist-rollback && rm -rf /tmp/gw-dist-rollback/*
tar xzf "$BK/container-app-dist-pkg.before.tgz" -C /tmp/gw-dist-rollback
podman exec openbot-gateway-rc sh -c 'rm -rf /app/dist && mkdir -p /app/dist'
podman cp /tmp/gw-dist-rollback/dist/. openbot-gateway-rc:/app/dist/
podman restart openbot-gateway-rc
bash /root/openbot-ui-baselines/v3.0/watch-control-ui-v3-pin.sh
```

---

## Previous cutover (2026-08-10 ~15:07 CST) — 个人授权名单覆盖主人席位全部机器人 (`seat-grant-roster-r21`)

| Field      | Value                                                                                                                                                                                                       |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date       | 2026-08-10 (live ~15:07 CST / artifact `20260810T070544Z`)                                                                                                                                                  |
| Decision   | 可授权机器人应等于主人席位下全部岗位机器人：席位 `agentIds` = defaults ∪ active agent bindings；`seatAgentIds` 再并入 config `ownerId=seat`；`ownedAgentIds`/授权选择器把席位授予机器人视为主人可授权对象。 |
| Source     | `cursor/workbench-isolation-r6` @ `21d6204c5c` UI `index-DENGRpxr.js` md5 `373075c04767f67a43eb28b835cbccab` + gateway-dist-overlay `seat-grant-roster-r21`                                                 |
| Build mode | Gateway dist overlay + Control UI overlay → served root + baseline + container embed + restart                                                                                                              |
| Container  | `openbot-gateway-rc`                                                                                                                                                                                        |
| Control UI | `index-DENGRpxr.js`                                                                                                                                                                                         |
| Gateway    | `seat-grant-roster-r21` (`resolveSeatGrantedAgentAssetIds` / `seatOwnedFromConfig` / `seatGrantedOwnedAgentIds`)                                                                                            |
| Pin        | `OPENBOT_UI_OVERLAY_PINNED_ENTRY=index-DENGRpxr.js` / `OPENBOT_UI_OVERLAY=seat-grant-roster-r21`                                                                                                            |
| Smoke      | healthz **200**; readyz **ready:true**; www/gw → `index-DENGRpxr.js`; verify-control-ui-v3 **OK**; watch pin **OK**; GW markers present                                                                     |
| Rollback   | UI: restore served/baseline/pin bak-pre-seat-grant-roster-r21-20260810T070544Z; Gateway: restore `/root/openbot-maintenance-seat-grant-roster-r21-20260810T070544Z/container-app-dist-pkg.before.tgz`       |
| Executor   | `cursor-grok`                                                                                                                                                                                               |
| Merge-back | Pending                                                                                                                                                                                                     |

### Rollback

```bash
STAMP=20260810T070544Z
OVERLAY=seat-grant-roster-r21
BASE=/root/openbot-ui-baselines/v3.0
SERVED=/root/.openbot/control-ui
BK=/root/openbot-maintenance-${OVERLAY}-${STAMP}
chattr -i "$BASE/pin.env" 2>/dev/null || true
rm -rf "$SERVED" "$BASE/control-ui"
cp -a "${SERVED}.bak-pre-${OVERLAY}-${STAMP}" "$SERVED"
cp -a "$BASE/control-ui.bak-pre-${OVERLAY}-${STAMP}" "$BASE/control-ui"
cp -a "$BASE/pin.env.bak-pre-${OVERLAY}-${STAMP}" "$BASE/pin.env"
mkdir -p /tmp/gw-dist-rollback && rm -rf /tmp/gw-dist-rollback/*
tar xzf "$BK/container-app-dist-pkg.before.tgz" -C /tmp/gw-dist-rollback
podman exec openbot-gateway-rc sh -c 'rm -rf /app/dist && mkdir -p /app/dist'
podman cp /tmp/gw-dist-rollback/dist/. openbot-gateway-rc:/app/dist/
podman restart openbot-gateway-rc
bash "$BASE/watch-control-ui-v3-pin.sh"
```

---

## Previous cutover (2026-08-10 ~14:22 CST) — Control UI: personal identity grants to seat-owned shared bots (`personal-identity-seat-shared-grant-r20`)

| Field      | Value                                                                                                                                                                                                 |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date       | 2026-08-10 (UI live ~14:22 CST / artifact `20260810T062206Z`)                                                                                                                                         |
| Decision   | 个人邮箱授权给岗位 shared 机器人时 UI 误传 `agentScope=owned` 触发 `USER_IDENTITY_AGENT_SCOPE_MISMATCH`；改为按配置 scope 提交 `shared` + `explicit`/`confirmExplicit`，并标注「席位共享 · 需确认」。 |
| Source     | `cursor/workbench-isolation-r6` @ `9cf0ab5bec` `pnpm ui:build` → `index-BHbk_ZLJ.js`                                                                                                                  |
| Build mode | Control UI overlay only（gateway 当时未切；现已被 `seat-grant-roster-r21` 覆盖）                                                                                                                      |
| Control UI | `index-BHbk_ZLJ.js` (superseded)                                                                                                                                                                      |
| Executor   | `cursor-grok`                                                                                                                                                                                         |

---

## Previous cutover (2026-08-10 ~10:00 CST) — CEO 员工壳 agents.list 个人席位收口 (`agents-list-personal-scope-r59`)

| Field      | Value                                                                                                                                                                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date       | 2026-08-10 (live ~10:00 CST / UI `20260810T015526Z` + gateway hot-patch `20260810T015408Z`)                                                                                                                                                 |
| Decision   | `resolveScopedAgentsForClient` 对 **所有域（含 enterprise-admin）** 只返回 seat ∪ ownership ∪ steward；租户 mesh 仍走专用 mesh/growth RPC。UI hydrate 后仍按席位/归属再过滤，禁止信任未作用域 roster。                                      |
| Source     | working-tree gateway `employee-workbench-scope.ts` + UI `employee-workbench-agent-scope.ts`; Control UI `index-CGcn5OIN.js` md5 `4a9eb25f013ca32c1ffa7f2f36b5e8e0`                                                                          |
| Build mode | Gateway dist hot-patch (`scope-attribution-pab5HXfi.js` / `Chto8inw.js`) + Control UI overlay → served root + baseline + container embed + restart                                                                                          |
| Container  | `openbot-gateway-rc`                                                                                                                                                                                                                        |
| Control UI | `index-CGcn5OIN.js`                                                                                                                                                                                                                         |
| Gateway    | `agents-list-personal-scope-r59` hot-patch on mesh-org-usage-wire-r58 base                                                                                                                                                                  |
| Pin        | `OPENBOT_UI_OVERLAY=agents-list-personal-scope-r59` / `OPENBOT_UI_INDEX=index-CGcn5OIN.js`                                                                                                                                                  |
| Smoke      | healthz **200**; readyz **ready:true**; www → `index-CGcn5OIN.js`; in-process CEO `enterprise-admin` `resolveScopedAgentsForClient` → **5** (`main,panda,bot-2,bot--agent,bot-skill`); foreign bots **none**                                |
| Rollback   | UI: restore `/root/.openbot/control-ui.bak-pre-agents-list-personal-scope-r59-20260810T015526Z` + pin bak; Gateway: restore `/root/openbot-gateway-dist.bak-pre-agents-list-personal-scope-r59-20260810T015408Z/*.js` then `podman restart` |
| Executor   | `cursor-grok`                                                                                                                                                                                                                               |
| Merge-back | Pending — land personal-scope gateway/UI source to `main`                                                                                                                                                                                   |

### Rollback

```bash
# UI
STAMP=20260810T015526Z
OVERLAY=agents-list-personal-scope-r59
BASE=/root/openbot-ui-baselines/v3.0
SERVED=/root/.openbot/control-ui
chattr -i "$BASE/pin.env" 2>/dev/null || true
rm -rf "$SERVED" "$BASE/control-ui"
cp -a "${SERVED}.bak-pre-${OVERLAY}-${STAMP}" "$SERVED"
cp -a "$BASE/control-ui.bak-pre-${OVERLAY}-${STAMP}" "$BASE/control-ui" 2>/dev/null || true
cp -a "$BASE/pin.env.bak-pre-${OVERLAY}-${STAMP}" "$BASE/pin.env"
podman exec openbot-gateway-rc sh -c 'rm -rf /app/dist/control-ui && mkdir -p /app/dist/control-ui'
podman cp "$SERVED/." openbot-gateway-rc:/app/dist/control-ui/

# Gateway hot-patch rollback
GSTAMP=20260810T015408Z
BK=/root/openbot-gateway-dist.bak-pre-${OVERLAY}-${GSTAMP}
podman cp "$BK/scope-attribution-pab5HXfi.js" openbot-gateway-rc:/app/dist/scope-attribution-pab5HXfi.js
podman cp "$BK/scope-attribution-Chto8inw.js" openbot-gateway-rc:/app/dist/scope-attribution-Chto8inw.js
podman restart openbot-gateway-rc
```

---

## Previous cutover (2026-08-10 ~09:40 CST) — 机巢租户 roster + 组织本月消耗打通 (`mesh-org-usage-wire-r58`)

| Field      | Value                                                                                                                                                                                                                                |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Date       | 2026-08-10 (live ~09:40 CST / UI `20260810T013544Z` + gateway `20260810T013835Z`)                                                                                                                                                    |
| Decision   | 企业会话 agents/spaces/usage 改为租户级；ownership 按全座位回填；组织页「本月消耗」优先座位会话用量并补齐成员邮箱归因；机巢 usage 窗口 30 天。                                                                                       |
| Source     | `cursor/workbench-isolation-r6` @ `1d0a766f7e` (`4dac462d6a` + `1d0a766f7e`) UI `index-DWnNBCr1.js` md5 `dabccf838332a70095b792a353b06470`; gateway-dist-overlay `gateway-cli-CmCovmg5.js` / `dIvffdo7.js`                           |
| Build mode | Working-tree Control UI overlay + gateway-dist-overlay → container restart                                                                                                                                                           |
| Container  | `openbot-gateway-rc`                                                                                                                                                                                                                 |
| Control UI | `index-DWnNBCr1.js`                                                                                                                                                                                                                  |
| Gateway    | `mesh-org-usage-wire-r58` @ `1d0a766f7e`                                                                                                                                                                                             |
| Pin        | `OPENBOT_UI_OVERLAY=mesh-org-usage-wire-r58` / `OPENBOT_UI_INDEX=index-DWnNBCr1.js`                                                                                                                                                  |
| Smoke      | healthz **200**; readyz **ready:true**; www → `index-DWnNBCr1.js`; markers `monthly-seat-usage` / `collectSeatAgentIds` / `Unable to resolve enterprise tenant scope for usage`; verify-control-ui-v3 **OK**                         |
| Rollback   | UI: restore `/root/.openbot/control-ui.bak-pre-mesh-org-usage-wire-r58-20260810T013544Z` + pin bak; Gateway: restore `/root/openbot-gateway-dist.bak-pre-mesh-org-usage-wire-r58-20260810T013835Z/dist-before` then `podman restart` |
| Executor   | `cursor-grok`                                                                                                                                                                                                                        |
| Merge-back | Pending — mesh-org-usage-wire @ `1d0a766f7e`                                                                                                                                                                                         |

### Rollback

```bash
# UI
STAMP=20260810T013544Z
OVERLAY=mesh-org-usage-wire-r58
BASE=/root/openbot-ui-baselines/v3.0
SERVED=/root/.openbot/control-ui
chattr -i "$BASE/pin.env" 2>/dev/null || true
rm -rf "$SERVED" "$BASE/control-ui"
cp -a "${SERVED}.bak-pre-${OVERLAY}-${STAMP}" "$SERVED"
cp -a "$BASE/control-ui.bak-pre-${OVERLAY}-${STAMP}" "$BASE/control-ui" 2>/dev/null || true
cp -a "$BASE/pin.env.bak-pre-${OVERLAY}-${STAMP}" "$BASE/pin.env"
podman exec openbot-gateway-rc sh -c 'rm -rf /app/dist/control-ui && mkdir -p /app/dist/control-ui'
podman cp "$SERVED/." openbot-gateway-rc:/app/dist/control-ui/

# Gateway
GSTAMP=20260810T013835Z
BK=/root/openbot-gateway-dist.bak-pre-${OVERLAY}-${GSTAMP}
podman exec openbot-gateway-rc sh -c 'rm -rf /app/dist && mkdir -p /app/dist'
podman cp "$BK/dist-before/." openbot-gateway-rc:/app/dist/
podman restart openbot-gateway-rc
```

---

## Previous cutover (2026-08-10 ~06:16 CST) — Control UI: 机巢治理数据加载修复 (`mesh-shell-load-r57`)

| Field      | Value                                                                                                                                                                                                                         |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date       | 2026-08-10 (UI live ~06:16 CST / artifact `20260809T221519Z`)                                                                                                                                                                 |
| Decision   | 机巢 Tab 预载 agents/spaces/usage；协作空间并入小组 KPI；空本地资产回退 governance.assets.list；embed 含 shared/team；主页扁平化与「企业成员」文案；加载中显示「同步机器人与协作组…」。                                       |
| Source     | `cursor/workbench-isolation-r6` @ `2e4f2b11c4` (`78b759ebf1` + `2e4f2b11c4`) `pnpm ui:build` → `openbot-control-ui-mesh-shell-load-r57-20260809T221519Z.tar.gz` (`index-iQMVPoQZ.js`, md5 `c42f55fbb3622e904e8c367789175213`) |
| Build mode | Working-tree Control UI overlay → served root + baseline + container embed                                                                                                                                                    |
| Container  | `openbot-gateway-rc`                                                                                                                                                                                                          |
| Control UI | `index-iQMVPoQZ.js`                                                                                                                                                                                                           |
| Gateway    | unchanged (owner-roots multi-path hot-patch retained)                                                                                                                                                                         |
| Pin        | `OPENBOT_UI_OVERLAY_PINNED_ENTRY=index-iQMVPoQZ.js` / name `mesh-shell-load-r57`                                                                                                                                              |
| Smoke      | healthz **200**; readyz **ready:true**; www/gw → `index-iQMVPoQZ.js`; markers `企业成员` / `同步机器人与协作组` / `enterprise-surface--mesh-flat`; verify-control-ui-v3 **OK**                                                |
| Rollback   | restore `/root/.openbot/control-ui.bak-pre-mesh-shell-load-r57-20260809T221519Z` + pin bak then podman cp                                                                                                                     |
| Executor   | `cursor-grok`                                                                                                                                                                                                                 |
| Merge-back | Pending — mesh shell load @ `2e4f2b11c4` (PR #317).                                                                                                                                                                           |

### Rollback

```bash
STAMP=20260809T221519Z
OVERLAY=mesh-shell-load-r57
BASE=/root/openbot-ui-baselines/v3.0
SERVED=/root/.openbot/control-ui
chattr -i "$BASE/pin.env" 2>/dev/null || true
rm -rf "$SERVED" "$BASE/control-ui"
cp -a "${SERVED}.bak-pre-${OVERLAY}-${STAMP}" "$SERVED"
cp -a "$BASE/control-ui.bak-pre-${OVERLAY}-${STAMP}" "$BASE/control-ui" 2>/dev/null || true
cp -a "$BASE/pin.env.bak-pre-${OVERLAY}-${STAMP}" "$BASE/pin.env"
podman exec openbot-gateway-rc sh -c 'rm -rf /app/dist/control-ui && mkdir -p /app/dist/control-ui'
podman cp "$SERVED/." openbot-gateway-rc:/app/dist/control-ui/
```

---

## Previous cutover (2026-08-10 ~06:16 CST) — 大白/skill 成果多根回退 (`owner-roots-preview-r57`)

| Field      | Value                                                                                                                                                                                                                                 |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date       | 2026-08-10 (live ~06:16 CST)                                                                                                                                                                                                          |
| Decision   | 复检：PPTX/MD/Canvas「workspace file not found」因只搜当前 agent workspace。大白/skill 现额外搜索用户 `OpenBot/workspace`、`workspace-bot-skill`、`output/`、`skill-library/reports/` 与 canvas 根；非 steward 代理不越权读管家目录。 |
| Source     | Gateway hot-patch `expandOwnerRoots`；UI path candidates + `skill-library/reports`                                                                                                                                                    |
| Smoke      | healthz 200；样例解析 OK：讲座.pptx / 投资分析.md / pitch-deck.html / \*.canvas / MediaCrawler改造方案.md                                                                                                                             |
| Executor   | `cursor-grok`                                                                                                                                                                                                                         |
| Merge-back | Pending — `collectOwnerDeliverableWorkspaceDirs` in `steward-workspace-file.ts` (local WIP).                                                                                                                                          |

---

## Previous cutover (2026-08-10 ~00:06 CST) — PPTX/Canvas 侧栏内预览 (`pptx-canvas-preview-r56`)

| Field      | Value                                                                                                                                                                    |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Date       | 2026-08-10 (live ~00:06 CST)                                                                                                                                             |
| Decision   | PPTX 服务端提取幻灯片文字并渲染 HTML 预览；Canvas 支持 `.canvas` 文件名识别、canvas openUrl 保留子路径、`workspace-bot-skill`/`output/` 等多根回退；取消打开时自动下载。 |
| Source     | Gateway hot-patch `gateway-cli-CdjIpcSz.js` + `D6IVcoJF.js`（`renderPptxBufferToHtml`）；UI `index-CfjhBqik.js` (md5 `2df4947d644c56e3af99c2852edf3894`)                 |
| Smoke      | healthz 200；www → `index-CfjhBqik.js`；pin `pptx-canvas-preview-r56`；样例 pptx 22 页可提取文字；host 有 `pitch-deck.html` + `.canvas`                                  |
| Executor   | `cursor-grok`                                                                                                                                                            |
| Merge-back | Pending — `office-render.ts` pptx / steward multi-path / UI canvas regex (local WIP).                                                                                    |

---

## Previous cutover (2026-08-09 ~23:35 CST) — 打开成果：即时侧栏 + 去重预览内按钮 (`preview-open-ux-r55`)

| Field      | Value                                                                                                                                                            |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date       | 2026-08-09 (live ~23:35 CST)                                                                                                                                     |
| Decision   | 预览窗内多余「打开成果」按钮移除（内容已在阅览）；点击左侧「打开成果」立即打开右侧侧栏并显示加载态，加载完成前重复点击同一成果忽略，避免静默等待与连点打爆 RPC。 |
| Source     | UI: `index-CetjHdf5.js` (md5 `94323d1b73ce9f7a64814c70575c4ffd`)；`artifact-sidebar` / `group-deliverable-preview-flow` / i18n `stewardFileLoading`              |
| Smoke      | www → `index-CetjHdf5.js`；pin `preview-open-ux-r55`；bundle 含 `stewardFileLoading` / `artifact-preview-loading`                                                |
| Executor   | `cursor-grok`                                                                                                                                                    |
| Merge-back | Pending — preview loading shell + open-link removal (local WIP).                                                                                                 |

---

## Previous cutover (2026-08-09 ~23:20 CST) — PPT / Canvas 打开成果 (`ppt-canvas-preview-r54`)

| Field      | Value                                                                                                                                                                                     |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date       | 2026-08-09 (live ~23:20 CST)                                                                                                                                                              |
| Decision   | PPTX 无幻灯片预览图时不再卡在空 slide 面板，回落到下载/打开卡；Canvas 宿主目录（`~/.openbot/canvas`）与 `.canvas` 图经 steward-file 多根回退可读，避免 `/__openbot__/canvas/*` 401 空白。 |
| Source     | Gateway: hot-patch `gateway-cli-CdjIpcSz.js` + `D6IVcoJF.js`（candidateDirs + `.canvas` mime）；UI: `index-D5Fij7sx.js` (md5 `4626b2b2d99c3b478fb7aacc7f444eae`)                          |
| Smoke      | healthz 200；www → `index-D5Fij7sx.js`；pin `ppt-canvas-preview-r54`；gateway 含 `candidateDirs` / `x-openbot-canvas`；host 有 `pitch-deck.html` + L2 pptx                                |
| Executor   | `cursor-grok`                                                                                                                                                                             |
| Merge-back | Pending — `steward-workspace-file.ts` multi-root / UI `artifact-sidebar` slide fallthrough / `workspace-file-preview` canvas lane (local WIP).                                            |

---

## Previous cutover (2026-08-09 ~23:12 CST) — 成果保存默认知识库 (`kb-save-default-r53`)

| Field      | Value                                                                                                                                                                    |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Date       | 2026-08-09 (live ~23:12 CST)                                                                                                                                             |
| Decision   | 侧栏「保存」不再强制先去知识宇宙选库。未显式选库时 Gateway 自动解析：个人/大白 →「我的收录」；协作组 →「小组收录」（无写权限则回退个人）。UI 传 `knowledgeBaseId=auto`。 |
| Source     | Gateway: hot-patch `gateway-cli-CdjIpcSz.js` + `D6IVcoJF.js`; UI: `index-Ci7VkR0E.js` (md5 `a943bef34c0627914109061c8c0dba37`)                                           |
| Smoke      | healthz 200；www → `index-Ci7VkR0E.js`；gateway 含 `openbot:team-inbox`；assets js×30                                                                                    |
| Executor   | `cursor-grok`                                                                                                                                                            |
| Merge-back | Pending — `resolve-save-archive-kb.ts` / `team-inbox-knowledge-base.ts` / UI `SAVE_ARCHIVE_KB_AUTO` (local WIP).                                                         |

---

## Previous cutover (2026-08-09 ~23:00 CST) — KB 沉淀：embeddings 429 降级 + 错误可见 (`kb-embed-degrade-r52` / `kb-save-toast-r52`)

| Field      | Value                                                                                                                                                                                                 |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date       | 2026-08-09 (live ~23:00 CST)                                                                                                                                                                          |
| Decision   | 红色「已保存 · 知识库沉淀失败」根因是 Gemini embeddings **429**。Gateway ingest 对可重试 embedding 失败降级为 **FTS-only**（不再整单失败）；UI toast 展示真实错误；HTML 预览保存优先用 `htmlSrcdoc`。 |
| Source     | Gateway: hot-patch `local-folder-runtime-DXYTzDDy.js` + `DfJAN7Ca.js`; UI: working tree → `index-qCFgKmFL.js` (md5 `0184f3abfa8c435de637fc3843873a7c`)                                                |
| Smoke      | healthz 200；www → `index-qCFgKmFL.js`；assets js×30；gateway chunk 含 `resource_exhausted` degrade + `let model` FTS fallback                                                                        |
| Executor   | `cursor-grok`                                                                                                                                                                                         |
| Merge-back | Pending — `kb-ingest.ts` degrade + `kb-index.ts` vec prepare guard + `deliverable-save.ts` toast/htmlSrcdoc (local WIP).                                                                              |

---

## Previous cutover (2026-08-09 ~22:51 CST) — Control UI: PDF blob 预览 + PPT 下载卡 (`pdf-blob-ppt-download-r51`)

| Field    | Value                                                                                                                          |
| -------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Date     | 2026-08-09 (live ~22:51 CST)                                                                                                   |
| Decision | 大体积 PDF 用 `data:` iframe 常失败 → 改 `blob:`；PPTX 等二进制成果展示下载/打开卡片（`binaryDownloadUrl`），避免空白/不可用。 |
| Source   | working tree → `index-sm6vyFmA.js` (md5 `7bb60fc3f9c1861f488b37134801a699`)                                                    |
| Smoke    | www → `index-sm6vyFmA.js`；chunks 200；bundle 含 `pdfPreviewUrl` / `binaryDownloadUrl`                                         |
| Executor | `cursor-grok`                                                                                                                  |

---

## Previous cutover (2026-08-09 ~22:43 CST) — Gateway CSP + UI: HTML 预览解除屏蔽 (`html-blob-frame-csp-r50`)

| Field      | Value                                                                                                                                                                                 |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date       | 2026-08-09 (live ~22:43 CST)                                                                                                                                                          |
| Decision   | Chrome「该内容被屏蔽了」因 CSP `default-src 'self'` 未放行 iframe。Gateway CSP 增加 `frame-src 'self' blob: data:`；UI 对完整 HTML 改用 `blob:` URL iframe（不再依赖 about:srcdoc）。 |
| Source     | UI: working tree → `index-BxfjNgnh.js` (md5 `f5a6e25deabc098b801782b2956c34b6`); Gateway: hot-patch `gateway-cli-CdjIpcSz.js` + `gateway-cli-D6IVcoJF.js` + container restart         |
| Smoke      | www CSP 含 `frame-src 'self' blob: data:`; entry/chunks 200                                                                                                                           |
| Executor   | `cursor-grok`                                                                                                                                                                         |
| Merge-back | Pending — `control-ui-csp.ts` frame-src + HTML blob preview (local WIP).                                                                                                              |

---

## Previous cutover (2026-08-09 ~22:37 CST) — Control UI: HTML 成果用 iframe 渲染页面 (`html-iframe-preview-r49`)

| Field      | Value                                                                                                                                                                                             |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date       | 2026-08-09 (UI live ~22:37 CST / artifact `20260809T143616Z`)                                                                                                                                     |
| Decision   | `.html` 成果不再进文本/`<pre>` 源码预览；完整 HTML 文档走沙箱 iframe `srcdoc`，保留 CSS/版式。docx→HTML 片段仍走 inline sanitized 路径。                                                          |
| Source     | `cursor/workbench-isolation-r6` working tree `pnpm ui:build` → `openbot-control-ui-html-iframe-preview-r49-20260809T143616Z.tar.gz` (`index-BkpSF4id.js`, md5 `b9d49a3cb3def003c3dcb385dbddb47e`) |
| Build mode | Working-tree Control UI overlay（完整 assets×66 / js×30，tar 同步）                                                                                                                               |
| Container  | `openbot-gateway-rc`                                                                                                                                                                              |
| Control UI | `index-BkpSF4id.js`                                                                                                                                                                               |
| Gateway    | unchanged `collab-invite-nav-todos-r32`                                                                                                                                                           |
| Pin        | `OPENBOT_UI_OVERLAY_PINNED_ENTRY=index-BkpSF4id.js`；forbid includes prior `index-CKCWsbYz.js`                                                                                                    |
| Smoke      | healthz path OK；www → `index-BkpSF4id.js`；关键 chunks 200；bundle 含 `htmlSrcdoc`                                                                                                               |
| Rollback   | restore `/root/.openbot/control-ui.bak-pre-html-iframe-preview-r49-20260809T143616Z` + pin bak then podman cp                                                                                     |
| Executor   | `cursor-grok`                                                                                                                                                                                     |
| Merge-back | Pending — HTML iframe preview lane (local WIP).                                                                                                                                                   |

---

## Previous cutover (2026-08-09 ~21:58 CST) — Control UI: 文件型成果禁止摘要回退 + L2 文件同步 (`steward-workspace-path-fallback-r48`)

| Field      | Value                                                                                                                                                                                                                                                                                                                                                    |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date       | 2026-08-09 (UI live ~21:58 CST / artifact `20260809T135757Z`)                                                                                                                                                                                                                                                                                            |
| Decision   | 根因：大白成果写在 `agents/main/employees/<user>/workspace`，带 `sessionKey` 的 `steward-file.read` 只查租户 L2 `OpenBot/workspace`，读失败后 UI 把信封标题/正文当预览。本轮：1) UI 文件型成果禁止展示 `sourceMessage`；2) 失败态固定「文件暂不可用」；3) 热同步该用户 16 个 deliverable 到 L2；4) 本地已修 gateway 双根回退（待下次 gateway overlay）。 |
| Source     | `cursor/workbench-isolation-r6` working tree `pnpm ui:build` → `openbot-control-ui-steward-workspace-path-fallback-r48-20260809T135757Z.tar.gz` (`index-CKCWsbYz.js`, md5 `357d7f11165a1a04faedc38381718faf`)                                                                                                                                            |
| Build mode | Working-tree Control UI overlay + host file sync（未重启 gateway）                                                                                                                                                                                                                                                                                       |
| Container  | `openbot-gateway-rc`                                                                                                                                                                                                                                                                                                                                     |
| Control UI | `index-CKCWsbYz.js`                                                                                                                                                                                                                                                                                                                                      |
| Gateway    | unchanged `collab-invite-nav-todos-r32`（代码回退已合入工作树，未打 overlay）                                                                                                                                                                                                                                                                            |
| Host sync  | `90fed19a-1c8b-4420-87e0-bcc6165e32fa`：employee workspace → `tenants/001/.../OpenBot/workspace` + `.../agents/main/workspace`（含 `一切都刚刚开始_第128期综述_发布版.docx`，mammoth HTML≈4566）                                                                                                                                                         |
| Pin        | `OPENBOT_UI_OVERLAY_PINNED_ENTRY=index-CKCWsbYz.js`；forbid includes prior `index-BVkmWGQb.js`                                                                                                                                                                                                                                                           |
| Smoke      | healthz **200**; www/gw/biz → `index-CKCWsbYz.js`; L2 docx present + mammoth OK                                                                                                                                                                                                                                                                          |
| Rollback   | restore `/root/.openbot/control-ui.bak-pre-steward-workspace-path-fallback-r48-20260809T135757Z` + pin bak then podman cp                                                                                                                                                                                                                                |
| Executor   | `cursor-grok`                                                                                                                                                                                                                                                                                                                                            |
| Merge-back | Pending — steward-file employee-workspace fallback + UI file-backed preview hard block (local WIP).                                                                                                                                                                                                                                                      |

### Rollback

```bash
STAMP=20260809T135757Z
OVERLAY=steward-workspace-path-fallback-r48
BASE=/root/openbot-ui-baselines/v3.0
SERVED=/root/.openbot/control-ui
chattr -i "$BASE/pin.env" 2>/dev/null || true
rm -rf "$SERVED" "$BASE/control-ui"
cp -a "${SERVED}.bak-pre-${OVERLAY}-${STAMP}" "$SERVED"
cp -a "$BASE/control-ui.bak-pre-${OVERLAY}-${STAMP}" "$BASE/control-ui" 2>/dev/null || true
cp -a "$BASE/pin.env.bak-pre-${OVERLAY}-${STAMP}" "$BASE/pin.env"
podman exec openbot-gateway-rc sh -c 'rm -rf /app/dist/control-ui && mkdir -p /app/dist/control-ui'
podman cp "$SERVED/." openbot-gateway-rc:/app/dist/control-ui/
```

---

## Previous cutover (2026-08-09 ~21:52 CST) — Control UI: 打开成果不再回退对话正文 (`deliverable-preview-no-chat-fallback-r47`)

| Field      | Value                                                                                                                                                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Date       | 2026-08-09 (UI live ~21:52 CST / artifact `20260809T135102Z`)                                                                                                                                                      |
| Decision   | 修复「打开成果显示对话内容」：1) 浏览器中继/保存到桌面类说明不再误识别为成果；2) 文件型成果加载失败时保留「暂不可用」，禁止回退展示 chat `sourceMessage`。                                                         |
| Source     | `cursor/workbench-isolation-r6` working tree `pnpm ui:build` → `openbot-control-ui-deliverable-preview-no-chat-fallback-r47-20260809T135102Z.tar.gz` (`index-BVkmWGQb.js`, md5 `4301c0421df2a9c11fe67b0a3a3bac20`) |
| Build mode | Working-tree Control UI overlay → served root + baseline + container embed（未重启 gateway）                                                                                                                       |
| Container  | `openbot-gateway-rc`                                                                                                                                                                                               |
| Control UI | `index-BVkmWGQb.js`                                                                                                                                                                                                |
| Gateway    | unchanged `collab-invite-nav-todos-r32`                                                                                                                                                                            |
| Pin        | `OPENBOT_UI_OVERLAY_PINNED_ENTRY=index-BVkmWGQb.js`；forbid includes prior `index-ClAOeeEW.js`                                                                                                                     |
| Smoke      | healthz **200**; www → `index-BVkmWGQb.js`; verify-control-ui-v3 **OK**                                                                                                                                            |
| Rollback   | restore `/root/.openbot/control-ui.bak-pre-deliverable-preview-no-chat-fallback-r47-20260809T135102Z` + pin bak then podman cp                                                                                     |
| Executor   | `cursor-grok`                                                                                                                                                                                                      |
| Merge-back | Pending — operational guidance exclusion + no chat-fallback for file artifacts (local WIP).                                                                                                                        |

### Rollback

```bash
STAMP=20260809T135102Z
OVERLAY=deliverable-preview-no-chat-fallback-r47
BASE=/root/openbot-ui-baselines/v3.0
SERVED=/root/.openbot/control-ui
chattr -i "$BASE/pin.env" 2>/dev/null || true
rm -rf "$SERVED" "$BASE/control-ui"
cp -a "${SERVED}.bak-pre-${OVERLAY}-${STAMP}" "$SERVED"
cp -a "$BASE/control-ui.bak-pre-${OVERLAY}-${STAMP}" "$BASE/control-ui" 2>/dev/null || true
cp -a "$BASE/pin.env.bak-pre-${OVERLAY}-${STAMP}" "$BASE/pin.env"
podman exec openbot-gateway-rc sh -c 'rm -rf /app/dist/control-ui && mkdir -p /app/dist/control-ui'
podman cp "$SERVED/." openbot-gateway-rc:/app/dist/control-ui/
```

---

## Previous cutover (2026-08-09 ~20:27 CST) — Control UI: 大白管家成果预览路由修复 + 多格式内嵌 (`steward-deliverable-preview-r46`)

| Field      | Value                                                                                                                                                                                                     |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date       | 2026-08-09 (UI live ~20:27 CST / artifact `20260809T122640Z`)                                                                                                                                             |
| Decision   | 修复大白管家会话被残留 `workbenchTeamSelectedKey` 误导入组工作区导致「所有成果无法预览」；统一 steward/group 预览车道（HTML/PDF/文本内嵌，pptx 等二进制下载并保留卡片）；组失败可回退 steward。           |
| Source     | `cursor/workbench-isolation-r6` working tree `pnpm ui:build` → `openbot-control-ui-steward-deliverable-preview-r46-20260809T122640Z.tar.gz` (`index-ClAOeeEW.js`, md5 `3e998f528fa5aab960b549cbd3dda8d9`) |
| Build mode | Working-tree Control UI overlay → served root + baseline + container embed（未重启 gateway）                                                                                                              |
| Container  | `openbot-gateway-rc`                                                                                                                                                                                      |
| Control UI | `index-ClAOeeEW.js`                                                                                                                                                                                       |
| Gateway    | unchanged `collab-invite-nav-todos-r32`                                                                                                                                                                   |
| Pin        | `OPENBOT_UI_OVERLAY_PINNED_ENTRY=index-ClAOeeEW.js`；forbid includes prior `index-BkQmVYe2.js`                                                                                                            |
| Smoke      | healthz **200**; www → `index-ClAOeeEW.js`; verify-control-ui-v3 **OK**                                                                                                                                   |
| Rollback   | restore `/root/.openbot/control-ui.bak-pre-steward-deliverable-preview-r46-20260809T122640Z` + pin bak then podman cp                                                                                     |
| Executor   | `cursor-grok`                                                                                                                                                                                             |
| Merge-back | Pending — steward preview routing + shared workspace-file-preview lane (local WIP).                                                                                                                       |

### Rollback

```bash
STAMP=20260809T122640Z
OVERLAY=steward-deliverable-preview-r46
BASE=/root/openbot-ui-baselines/v3.0
SERVED=/root/.openbot/control-ui
chattr -i "$BASE/pin.env" 2>/dev/null || true
rm -rf "$SERVED" "$BASE/control-ui"
cp -a "${SERVED}.bak-pre-${OVERLAY}-${STAMP}" "$SERVED"
cp -a "$BASE/control-ui.bak-pre-${OVERLAY}-${STAMP}" "$BASE/control-ui" 2>/dev/null || true
cp -a "$BASE/pin.env.bak-pre-${OVERLAY}-${STAMP}" "$BASE/pin.env"
podman exec openbot-gateway-rc sh -c 'rm -rf /app/dist/control-ui && mkdir -p /app/dist/control-ui'
podman cp "$SERVED/." openbot-gateway-rc:/app/dist/control-ui/
```

---

## Previous cutover (2026-08-09 ~18:48 CST) — Control UI: 裸 file= 成果路径补全 + reports 回退 (`group-deliverable-preview-r45`)

| Field      | Value                                                                                                                                                                                                               |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date       | 2026-08-09 (UI live ~18:48 CST / artifact `20260809T104731Z`)                                                                                                                                                       |
| Decision   | 修复 `<<DELIVERABLE file="ai-org-report.pdf">>` 裸文件名误查 `deliverables/`：正文路径补全为 `reports/…`；候选读路径扩展 `reports/report/drafts`；并对「权变管理专家」组热复制 PDF → `deliverables/` 以便立即预览。 |
| Source     | `cursor/workbench-isolation-r6` working tree `pnpm ui:build` → `openbot-control-ui-group-deliverable-preview-r45-20260809T104731Z.tar.gz` (`index-BkQmVYe2.js`, md5 `4acf064bc56ffd465f74eaa316814699`)             |
| Build mode | Working-tree Control UI overlay → served root + baseline + container embed（未重启 gateway）+ 组工作区文件热补丁                                                                                                    |
| Container  | `openbot-gateway-rc`                                                                                                                                                                                                |
| Control UI | `index-BkQmVYe2.js`                                                                                                                                                                                                 |
| Gateway    | unchanged `collab-invite-nav-todos-r32`                                                                                                                                                                             |
| Pin        | `OPENBOT_UI_OVERLAY_PINNED_ENTRY=index-BkQmVYe2.js`；forbid includes prior `index-CoVB-kwn.js`                                                                                                                      |
| Smoke      | healthz **200**; www → `index-BkQmVYe2.js`; verify-control-ui-v3 **OK**; `deliverables/ai-org-report.pdf` present in encoded group dir                                                                              |
| Rollback   | restore `/root/.openbot/control-ui.bak-pre-group-deliverable-preview-r45-20260809T104731Z` + pin bak then podman cp                                                                                                 |
| Executor   | `cursor-grok`                                                                                                                                                                                                       |
| Merge-back | Pending — bare deliverable file path enrichment + group read candidates (local WIP).                                                                                                                                |

### Rollback

```bash
STAMP=20260809T104731Z
OVERLAY=group-deliverable-preview-r45
BASE=/root/openbot-ui-baselines/v3.0
SERVED=/root/.openbot/control-ui
chattr -i "$BASE/pin.env" 2>/dev/null || true
rm -rf "$SERVED" "$BASE/control-ui"
cp -a "${SERVED}.bak-pre-${OVERLAY}-${STAMP}" "$SERVED"
cp -a "$BASE/control-ui.bak-pre-${OVERLAY}-${STAMP}" "$BASE/control-ui" 2>/dev/null || true
cp -a "$BASE/pin.env.bak-pre-${OVERLAY}-${STAMP}" "$BASE/pin.env"
podman exec openbot-gateway-rc sh -c 'rm -rf /app/dist/control-ui && mkdir -p /app/dist/control-ui'
podman cp "$SERVED/." openbot-gateway-rc:/app/dist/control-ui/
```

---

## Previous cutover (2026-08-09 ~18:24 CST) — Control UI: 协作成果预览路径回退 + HTML/PDF 内嵌 (`group-deliverable-preview-r44`)

| Field      | Value                                                                                                                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date       | 2026-08-09 (UI live ~18:24 CST / artifact `20260809T102337Z`)                                                                                                                                           |
| Decision   | 修复「打开成果」右侧预览：保留 `report/` 等相对路径（不再强行塞进 `deliverables/`）；`reports↔report` / `.pdf↔.html` 读路径回退；HTML 内嵌渲染、PDF iframe、其它二进制改为下载。                        |
| Source     | `cursor/workbench-isolation-r6` working tree `pnpm ui:build` → `openbot-control-ui-group-deliverable-preview-r44-20260809T102337Z.tar.gz` (`index-CoVB-kwn.js`, md5 `b040e8c0e0b131fe0d6de9bd1a88a5ea`) |
| Build mode | Working-tree Control UI overlay → served root + baseline + container embed（未重启 gateway）                                                                                                            |
| Container  | `openbot-gateway-rc`                                                                                                                                                                                    |
| Control UI | `index-CoVB-kwn.js`                                                                                                                                                                                     |
| Gateway    | unchanged `collab-invite-nav-todos-r32`                                                                                                                                                                 |
| Pin        | `OPENBOT_UI_OVERLAY_PINNED_ENTRY=index-CoVB-kwn.js`；forbid includes prior `index-QpV5v__F.js`                                                                                                          |
| Smoke      | healthz **200**; www → `index-CoVB-kwn.js`; markers `groupFileDownloaded` + `artifact-preview-pdf` + path fallback；verify-control-ui-v3 **OK**                                                         |
| Rollback   | restore `/root/.openbot/control-ui.bak-pre-group-deliverable-preview-r44-20260809T102337Z` + pin bak then podman cp                                                                                     |
| Executor   | `cursor-grok`                                                                                                                                                                                           |
| Merge-back | Pending — group deliverable preview path/HTML/PDF fixes (local WIP on `cursor/workbench-isolation-r6`).                                                                                                 |

### Rollback

```bash
STAMP=20260809T102337Z
OVERLAY=group-deliverable-preview-r44
BASE=/root/openbot-ui-baselines/v3.0
SERVED=/root/.openbot/control-ui
chattr -i "$BASE/pin.env" 2>/dev/null || true
rm -rf "$SERVED" "$BASE/control-ui"
cp -a "${SERVED}.bak-pre-${OVERLAY}-${STAMP}" "$SERVED"
cp -a "$BASE/control-ui.bak-pre-${OVERLAY}-${STAMP}" "$BASE/control-ui" 2>/dev/null || true
cp -a "$BASE/pin.env.bak-pre-${OVERLAY}-${STAMP}" "$BASE/pin.env"
podman exec openbot-gateway-rc sh -c 'rm -rf /app/dist/control-ui && mkdir -p /app/dist/control-ui'
podman cp "$SERVED/." openbot-gateway-rc:/app/dist/control-ui/
```

---

## Previous cutover (2026-08-09 ~16:48 CST) — Platform skills: cursor-canvas + canvas-report-delivery 全平台直推 (`cursor-canvas-platform-share-r43`)

| Field      | Value                                                                                                                                                                                                       |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date       | 2026-08-09 (live ~16:48 CST / stamp `20260809T084741Z`)                                                                                                                                                     |
| Decision   | 将 CEO 侧已托管的报告交付技能与缺失的 `cursor-canvas` 登记为平台能力：`direct_employee_visible` + 空租户 scope + `defaultEnabled`；managed 同步并给全部 22 个 runtime agent 写 `platform-default` binding。 |
| Source     | repo `skills/cursor-canvas/**` → `/root/.openbot/skills/cursor-canvas`；既有 `/root/.openbot/skills/canvas-report-delivery`；registry + agent-runtime store 热补丁后 `podman restart`                       |
| Build mode | Host file overlay（governance/registry + agent-runtime bindings + managed skills + container `/app/skills` 嵌入）；gateway dist overlay 未换                                                                |
| Container  | `openbot-gateway-rc`（restarted for in-memory agent-runtime reload）                                                                                                                                        |
| Control UI | unchanged `index-QpV5v__F.js`                                                                                                                                                                               |
| Gateway    | unchanged `collab-invite-nav-todos-r32`                                                                                                                                                                     |
| Registry   | `urn:openbot:skill:cursor-canvas@1.0.0`、`urn:openbot:skill:canvas-report-delivery@1.0.0`；各 **22** bindings                                                                                               |
| Smoke      | healthz/readyz **200**；managed 含两技能；`/app/skills` 含两技能；`skills.allowBundled` 未配置（不挡）                                                                                                      |
| Rollback   | restore `/root/openbot-maintenance-cursor-canvas-platform-20260809T084741Z/{registry.json,agent-runtime-store.json,skills}.before` then `podman restart openbot-gateway-rc`                                 |
| Executor   | `cursor-grok`                                                                                                                                                                                               |
| Merge-back | Pending — consider vendoring `canvas-report-delivery` into repo `skills/` so future gateway overlays do not drop `/app/skills` copy.                                                                        |

### Rollback

```bash
STAMP=20260809T084741Z
BK=/root/openbot-maintenance-cursor-canvas-platform-${STAMP}
cp -a "$BK/registry.json.before" /root/.openbot/governance/registry.json
cp -a "$BK/agent-runtime-store.json.before" /root/.openbot/agent-runtime/store.json
rm -rf /root/.openbot/skills
cp -a "$BK/skills.before" /root/.openbot/skills
podman exec openbot-gateway-rc sh -c 'rm -rf /app/skills/cursor-canvas /app/skills/canvas-report-delivery'
podman restart openbot-gateway-rc
```

### Note

- 生产定位时 CEO 托管目录实际是 **`canvas-report-delivery`**（非 skill-assets 个人资产）；`cursor-canvas` 此前不在 managed / 容器 bundled 中。
- 本次两者一并全平台直推，避免只上 IDE canvas 技能而漏掉报告交付默认路径。

---

## Previous cutover (2026-08-09 ~15:50 CST) — Control UI: 成员胶囊去掉本轮参与外圈 (`collab-capsule-plain-avatars-r42`)

| Field      | Value                                                                                                                                                                                                      |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date       | 2026-08-09 (UI live ~15:50 CST / artifact `20260809T074956Z`)                                                                                                                                              |
| Decision   | 去掉协作成员胶囊上「本轮参与」实线/虚线外圈（`is-selected-this-round` / `is-wrap-this-round`），机器人与人类统一为简单圆形标识；本轮计划抽屉说明保留。                                                     |
| Source     | `cursor/workbench-isolation-r6` working tree `pnpm ui:build` → `openbot-control-ui-collab-capsule-plain-avatars-r42-20260809T074956Z.tar.gz` (`index-QpV5v__F.js`, md5 `f7854a99bbbbaad4d61f40289e10e65c`) |
| Build mode | Working-tree Control UI overlay → served root + baseline + container embed（未重启 gateway）                                                                                                               |
| Container  | `openbot-gateway-rc`                                                                                                                                                                                       |
| Control UI | `index-QpV5v__F.js`                                                                                                                                                                                        |
| Gateway    | unchanged `collab-invite-nav-todos-r32`                                                                                                                                                                    |
| Pin        | `OPENBOT_UI_OVERLAY_PINNED_ENTRY=index-QpV5v__F.js`；forbid includes prior `index-B13nVPBn.js`                                                                                                             |
| Smoke      | healthz **200**; www → `index-QpV5v__F.js`; served CSS 无 `is-selected-this-round` / `is-wrap-this-round`                                                                                                  |
| Rollback   | restore `/root/.openbot/control-ui.bak-pre-collab-capsule-plain-avatars-r42-20260809T074956Z` + pin bak then podman cp                                                                                     |
| Executor   | `cursor-grok`                                                                                                                                                                                              |
| Merge-back | Pending — capsule plain avatars (local WIP on `cursor/workbench-isolation-r6`).                                                                                                                            |

### Rollback

```bash
STAMP=20260809T074956Z
OVERLAY=collab-capsule-plain-avatars-r42
BASE=/root/openbot-ui-baselines/v3.0
SERVED=/root/.openbot/control-ui
chattr -i "$BASE/pin.env" 2>/dev/null || true
rm -rf "$SERVED" "$BASE/control-ui"
cp -a "${SERVED}.bak-pre-${OVERLAY}-${STAMP}" "$SERVED"
cp -a "$BASE/control-ui.bak-pre-${OVERLAY}-${STAMP}" "$BASE/control-ui" 2>/dev/null || true
cp -a "$BASE/pin.env.bak-pre-${OVERLAY}-${STAMP}" "$BASE/pin.env"
podman exec openbot-gateway-rc sh -c 'rm -rf /app/dist/control-ui && mkdir -p /app/dist/control-ui'
podman cp "$SERVED/." openbot-gateway-rc:/app/dist/control-ui/
```

---

## Previous cutover (2026-08-09 ~15:35 CST) — Control UI: 协作 @ 提及纳入人类成员 (`collab-mention-humans-r41`)

| Field      | Value                                                                                                                                                                                               |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date       | 2026-08-09 (UI live ~15:35 CST / artifact `20260809T073337Z`)                                                                                                                                       |
| Decision   | 协作输入框 `@` 候选接入 `buildMentionCandidatesFromRoster`（active humans + bots），修复只列机器人/「所有人」、缺「王军」等人类成员的问题。                                                         |
| Source     | `cursor/workbench-isolation-r6` working tree `pnpm ui:build` → `openbot-control-ui-collab-mention-humans-r41-20260809T073337Z.tar.gz` (`index-B13nVPBn.js`, md5 `dee1145b67f0c71e70149caa6c888596`) |
| Build mode | Working-tree Control UI overlay → served root + baseline + container embed（未重启 gateway）                                                                                                        |
| Container  | `openbot-gateway-rc`                                                                                                                                                                                |
| Control UI | `index-B13nVPBn.js`                                                                                                                                                                                 |
| Gateway    | unchanged `collab-invite-nav-todos-r32`                                                                                                                                                             |
| Pin        | `OPENBOT_UI_OVERLAY_PINNED_ENTRY=index-B13nVPBn.js`；forbid includes prior `index-s8IwpnKF.js`                                                                                                      |
| Smoke      | healthz **200**; www → `index-B13nVPBn.js`; verify-control-ui-v3 **OK**                                                                                                                             |
| Rollback   | restore `/root/.openbot/control-ui.bak-pre-collab-mention-humans-r41-20260809T073337Z` + pin bak then podman cp                                                                                     |
| Executor   | `cursor-grok`                                                                                                                                                                                       |
| Merge-back | Pending — collab mention humans (local WIP on `cursor/workbench-isolation-r6`).                                                                                                                     |

### Rollback

```bash
STAMP=20260809T073337Z
OVERLAY=collab-mention-humans-r41
BASE=/root/openbot-ui-baselines/v3.0
SERVED=/root/.openbot/control-ui
chattr -i "$BASE/pin.env" 2>/dev/null || true
rm -rf "$SERVED" "$BASE/control-ui"
cp -a "${SERVED}.bak-pre-${OVERLAY}-${STAMP}" "$SERVED"
cp -a "$BASE/control-ui.bak-pre-${OVERLAY}-${STAMP}" "$BASE/control-ui" 2>/dev/null || true
cp -a "$BASE/pin.env.bak-pre-${OVERLAY}-${STAMP}" "$BASE/pin.env"
podman exec openbot-gateway-rc sh -c 'rm -rf /app/dist/control-ui && mkdir -p /app/dist/control-ui'
podman cp "$SERVED/." openbot-gateway-rc:/app/dist/control-ui/
```

---

## Previous cutover (2026-08-09 ~15:23 CST) — Control UI: 接受邀请后清除待确认横幅 (`invite-accept-clear-banner-r40`)

| Field      | Value                                                                                                                                                                                                    |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date       | 2026-08-09 (UI live ~15:23 CST / artifact `20260809T072224Z`)                                                                                                                                            |
| Decision   | 接受/拒绝协作邀请后以本次保存的名单刷新成员治理态，清除「协作邀请待确认」横幅；`spaces.list` 并发加载改为链式重拉，避免沿用写前快照。                                                                    |
| Source     | `cursor/workbench-isolation-r6` working tree `pnpm ui:build` → `openbot-control-ui-invite-accept-clear-banner-r40-20260809T072224Z.tar.gz` (`index-s8IwpnKF.js`, md5 `4ae970422885f82c70d730b918abadd0`) |
| Build mode | Working-tree Control UI overlay → served root + baseline + container embed（跳过会换镜像的 watch fallback）                                                                                              |
| Container  | `openbot-gateway-rc`                                                                                                                                                                                     |
| Control UI | `index-s8IwpnKF.js`                                                                                                                                                                                      |
| Gateway    | unchanged `collab-invite-nav-todos-r32`                                                                                                                                                                  |
| Pin        | `OPENBOT_UI_OVERLAY_PINNED_ENTRY=index-s8IwpnKF.js`；forbid includes prior `index-CmyjuYSF.js` / `index-CKBR2hsW.js`                                                                                     |
| Smoke      | healthz **200**; www → `index-s8IwpnKF.js`; verify-control-ui-v3 **OK**                                                                                                                                  |
| Rollback   | restore `/root/.openbot/control-ui.bak-pre-invite-accept-clear-banner-r40-20260809T072224Z` + pin bak then podman cp                                                                                     |
| Executor   | `cursor-grok`                                                                                                                                                                                            |
| Merge-back | Pending — invite accept clear banner (local WIP on `cursor/workbench-isolation-r6`).                                                                                                                     |

### Rollback

```bash
STAMP=20260809T072224Z
OVERLAY=invite-accept-clear-banner-r40
BASE=/root/openbot-ui-baselines/v3.0
SERVED=/root/.openbot/control-ui
chattr -i "$BASE/pin.env" 2>/dev/null || true
rm -rf "$SERVED" "$BASE/control-ui"
cp -a "${SERVED}.bak-pre-${OVERLAY}-${STAMP}" "$SERVED"
cp -a "$BASE/control-ui.bak-pre-${OVERLAY}-${STAMP}" "$BASE/control-ui" 2>/dev/null || true
cp -a "$BASE/pin.env.bak-pre-${OVERLAY}-${STAMP}" "$BASE/pin.env"
podman exec openbot-gateway-rc sh -c 'rm -rf /app/dist/control-ui && mkdir -p /app/dist/control-ui'
podman cp "$SERVED/." openbot-gateway-rc:/app/dist/control-ui/
```

---

## Previous cutover (2026-08-09 ~15:16 CST) — Control UI: invite-only 待办深链保持协作模块 (`invite-shell-deeplink-r39`)

| Field      | Value                                                                                                                                                                                               |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date       | 2026-08-09 (UI live ~15:16 CST / artifact `20260809T071555Z`)                                                                                                                                       |
| Decision   | 人类受邀 `space:<groupId>` 深链即使不在侧栏 `spaceItems`，shell 仍保持 `collaboration` 并打开成员待确认页；不再回落到 assistant/概览或误开其他活跃组。                                              |
| Source     | `cursor/workbench-isolation-r6` working tree `pnpm ui:build` → `openbot-control-ui-invite-shell-deeplink-r39-20260809T071555Z.tar.gz` (`index-CmyjuYSF.js`, md5 `ba3d00e6fb43413d5f9f9f2ee1c2552f`) |
| Build mode | Working-tree Control UI overlay → served root + baseline + container embed（跳过会换镜像的 watch fallback）                                                                                         |
| Container  | `openbot-gateway-rc`                                                                                                                                                                                |
| Control UI | `index-CmyjuYSF.js`                                                                                                                                                                                 |
| Gateway    | unchanged `collab-invite-nav-todos-r32`                                                                                                                                                             |
| Pin        | `OPENBOT_UI_OVERLAY_PINNED_ENTRY=index-CmyjuYSF.js`；forbid includes prior `index-CKBR2hsW.js` / `index-D7G8Ws3F.js` / `index-BSBJ42dx.js`                                                          |
| Smoke      | healthz **200**; www → `index-CmyjuYSF.js`; marker `协作邀请待确认` + `startsWith("group:")`; verify-control-ui-v3 **OK**                                                                           |
| Rollback   | restore `/root/.openbot/control-ui.bak-pre-invite-shell-deeplink-r39-20260809T071555Z` + pin bak then podman cp                                                                                     |
| Executor   | `cursor-grok`                                                                                                                                                                                       |
| Merge-back | Pending — invite shell deeplink (local WIP on `cursor/workbench-isolation-r6`).                                                                                                                     |

### Rollback

```bash
STAMP=20260809T071555Z
OVERLAY=invite-shell-deeplink-r39
BASE=/root/openbot-ui-baselines/v3.0
SERVED=/root/.openbot/control-ui
chattr -i "$BASE/pin.env" 2>/dev/null || true
rm -rf "$SERVED" "$BASE/control-ui"
cp -a "${SERVED}.bak-pre-${OVERLAY}-${STAMP}" "$SERVED"
cp -a "$BASE/control-ui.bak-pre-${OVERLAY}-${STAMP}" "$BASE/control-ui" 2>/dev/null || true
cp -a "$BASE/pin.env.bak-pre-${OVERLAY}-${STAMP}" "$BASE/pin.env"
podman exec openbot-gateway-rc sh -c 'rm -rf /app/dist/control-ui && mkdir -p /app/dist/control-ui'
podman cp "$SERVED/." openbot-gateway-rc:/app/dist/control-ui/
```

---

## Previous cutover (2026-08-09 ~15:05 CST) — Control UI: 协作邀请待办深链到审批页 (`invite-deeplink-approval-r38`)

| Field      | Value                                                                                                                                                                                                  |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Date       | 2026-08-09 (UI live ~15:05 CST / artifact `20260809T070426Z`)                                                                                                                                          |
| Decision   | 待办 `invite:human/bot:…` 深链改为打开成员审批页（含受邀人接受/拒绝），不再 `switch` 聊天会话，避免「当前会话无权访问」。                                                                              |
| Source     | `cursor/workbench-isolation-r6` working tree `pnpm ui:build` → `openbot-control-ui-invite-deeplink-approval-r38-20260809T070426Z.tar.gz` (`index-CKBR2hsW.js`, md5 `f59bd6f93700001e70fa197334e2c708`) |
| Build mode | Working-tree Control UI overlay → served root + baseline + container embed（跳过会换镜像的 watch fallback）                                                                                            |
| Container  | `openbot-gateway-rc`                                                                                                                                                                                   |
| Control UI | `index-CKBR2hsW.js`                                                                                                                                                                                    |
| Gateway    | unchanged `collab-invite-nav-todos-r32`                                                                                                                                                                |
| Pin        | `OPENBOT_UI_OVERLAY_PINNED_ENTRY=index-CKBR2hsW.js`；forbid includes prior `index-D7G8Ws3F.js` / `index-BSBJ42dx.js`                                                                                   |
| Smoke      | healthz **200**; www → `index-CKBR2hsW.js`; marker `协作邀请待确认`; verify-control-ui-v3 **OK**                                                                                                       |
| Rollback   | restore `/root/.openbot/control-ui.bak-pre-invite-deeplink-approval-r38-20260809T070426Z` + pin bak then podman cp                                                                                     |
| Executor   | `cursor-grok`                                                                                                                                                                                          |
| Merge-back | Pending — invite deeplink approval (local WIP on `cursor/workbench-isolation-r6`).                                                                                                                     |

### Rollback

```bash
STAMP=20260809T070426Z
OVERLAY=invite-deeplink-approval-r38
BASE=/root/openbot-ui-baselines/v3.0
SERVED=/root/.openbot/control-ui
chattr -i "$BASE/pin.env" 2>/dev/null || true
rm -rf "$SERVED" "$BASE/control-ui"
cp -a "${SERVED}.bak-pre-${OVERLAY}-${STAMP}" "$SERVED"
cp -a "$BASE/control-ui.bak-pre-${OVERLAY}-${STAMP}" "$BASE/control-ui" 2>/dev/null || true
cp -a "$BASE/pin.env.bak-pre-${OVERLAY}-${STAMP}" "$BASE/pin.env"
podman exec openbot-gateway-rc sh -c 'rm -rf /app/dist/control-ui && mkdir -p /app/dist/control-ui'
podman cp "$SERVED/." openbot-gateway-rc:/app/dist/control-ui/
```

---

## Previous cutover (2026-08-09 ~14:35 CST) — Control UI: 每日并行卡片恢复紧凑高度 (`signals-card-height-r37`)

| Field      | Value                                                                                                                                                                                               |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date       | 2026-08-09 (UI live ~14:35 CST / artifact `20260809T063446Z`)                                                                                                                                       |
| Decision   | 并行每日卡片固定高度由 `180px` 收回 `120px`（贴近原先 flat 紧凑足迹）；超出内容仍在卡内滚动。                                                                                                       |
| Source     | `cursor/workbench-isolation-r6` @ `4014b90dcd` `pnpm ui:build` → `openbot-control-ui-signals-card-height-r37-20260809T063446Z.tar.gz` (`index-D7G8Ws3F.js`, md5 `dc7721c22270541ef460c0ce55ea5208`) |
| Build mode | Working-tree Control UI overlay → served root + baseline + container embed（跳过会换镜像的 watch fallback）                                                                                         |
| Container  | `openbot-gateway-rc`                                                                                                                                                                                |
| Control UI | `index-D7G8Ws3F.js`                                                                                                                                                                                 |
| Gateway    | unchanged `collab-invite-nav-todos-r32`                                                                                                                                                             |
| Pin        | `OPENBOT_UI_OVERLAY_PINNED_ENTRY=index-D7G8Ws3F.js`；forbid includes prior `index-BSBJ42dx.js`                                                                                                      |
| Smoke      | healthz **200**; www → `index-D7G8Ws3F.js`; marker `wb-signals-parallel-card-height: 120px`; verify-control-ui-v3 **OK**                                                                            |
| Rollback   | restore `/root/.openbot/control-ui.bak-pre-signals-card-height-r37-20260809T063446Z` + pin bak then podman cp                                                                                       |
| Executor   | `cursor-grok`                                                                                                                                                                                       |
| Merge-back | Pending — signals card height @ `4014b90dcd` (PR #317).                                                                                                                                             |

### Rollback

```bash
STAMP=20260809T063446Z
OVERLAY=signals-card-height-r37
BASE=/root/openbot-ui-baselines/v3.0
SERVED=/root/.openbot/control-ui
chattr -i "$BASE/pin.env" 2>/dev/null || true
rm -rf "$SERVED" "$BASE/control-ui"
cp -a "${SERVED}.bak-pre-${OVERLAY}-${STAMP}" "$SERVED"
cp -a "$BASE/control-ui.bak-pre-${OVERLAY}-${STAMP}" "$BASE/control-ui" 2>/dev/null || true
cp -a "$BASE/pin.env.bak-pre-${OVERLAY}-${STAMP}" "$BASE/pin.env"
podman exec openbot-gateway-rc sh -c 'rm -rf /app/dist/control-ui && mkdir -p /app/dist/control-ui'
podman cp "$SERVED/." openbot-gateway-rc:/app/dist/control-ui/
```

---

## Previous cutover (2026-08-09 ~14:26 CST) — Control UI: 建议条与每日卡片同栈防塌缩 (`signals-stack-steward-r36`)

| Field      | Value                                                                                                                                                                                                                               |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date       | 2026-08-09 (UI live ~14:26 CST / artifact `20260809T062544Z`)                                                                                                                                                                       |
| Decision   | 修复刷新后「大白建议」异步到达时把 main 的 3 行 grid 拆成 4 子节点、挤掉并行每日卡片的问题；建议条+两卡包进单一 `signals-stack`；并行卡高度仍固定 `180px` 内滚。                                                                    |
| Source     | `cursor/workbench-isolation-r6` @ `8984928f98` (`3219acc93b` + `8984928f98`) `pnpm ui:build` → `openbot-control-ui-signals-stack-steward-r36-20260809T062544Z.tar.gz` (`index-BSBJ42dx.js`, md5 `719a162d79b3ff54df341be02c553aee`) |
| Build mode | Working-tree Control UI overlay → served root + baseline + container embed（跳过会换镜像的 watch fallback）                                                                                                                         |
| Container  | `openbot-gateway-rc`                                                                                                                                                                                                                |
| Control UI | `index-BSBJ42dx.js`                                                                                                                                                                                                                 |
| Gateway    | unchanged `collab-invite-nav-todos-r32`                                                                                                                                                                                             |
| Pin        | `OPENBOT_UI_OVERLAY_PINNED_ENTRY=index-BSBJ42dx.js`；forbid includes prior `index-4bdvd7zW.js`                                                                                                                                      |
| Smoke      | healthz **200**; readyz **ready:true**; www/served/container → `index-BSBJ42dx.js`; markers `signals-stack` / `wb-signals-parallel-card-height: 180px`; verify-control-ui-v3 **OK**                                                 |
| Rollback   | restore `/root/.openbot/control-ui.bak-pre-signals-stack-steward-r36-20260809T062544Z` + pin bak then podman cp                                                                                                                     |
| Executor   | `cursor-grok`                                                                                                                                                                                                                       |
| Merge-back | Pending — signals stack steward @ `8984928f98` (PR #317).                                                                                                                                                                           |

### Rollback

```bash
STAMP=20260809T062544Z
OVERLAY=signals-stack-steward-r36
BASE=/root/openbot-ui-baselines/v3.0
SERVED=/root/.openbot/control-ui
chattr -i "$BASE/pin.env" 2>/dev/null || true
rm -rf "$SERVED" "$BASE/control-ui"
cp -a "${SERVED}.bak-pre-${OVERLAY}-${STAMP}" "$SERVED"
cp -a "$BASE/control-ui.bak-pre-${OVERLAY}-${STAMP}" "$BASE/control-ui" 2>/dev/null || true
cp -a "$BASE/pin.env.bak-pre-${OVERLAY}-${STAMP}" "$BASE/pin.env"
podman exec openbot-gateway-rc sh -c 'rm -rf /app/dist/control-ui && mkdir -p /app/dist/control-ui'
podman cp "$SERVED/." openbot-gateway-rc:/app/dist/control-ui/
```

---

## Previous cutover (2026-08-09 ~13:56 CST) — Control UI: 大白建议条按 kind 深链 (`steward-suggestion-deeplink-r35`)

| Field      | Value                                                                                                                                                                                                                                     |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date       | 2026-08-09 (UI live ~13:56 CST / artifact `20260809T054621Z`)                                                                                                                                                                             |
| Decision   | 每日概览「大白建议」条可点击：`attention`/`conflict` → 知识治理；其它 kind → 管家待办；`meeting:*` 待办不再误开协作会话。                                                                                                                 |
| Source     | `cursor/workbench-isolation-r6` @ `ae7ee32b63` (`930d42278e` + `ae7ee32b63`) `pnpm ui:build` → `openbot-control-ui-steward-suggestion-deeplink-r35-20260809T054621Z.tar.gz` (`index-4bdvd7zW.js`, md5 `ea5365e1a2637232cb94703786d85817`) |
| Build mode | Working-tree Control UI overlay → served root + baseline + container embed（跳过会换镜像的 watch fallback）                                                                                                                               |
| Container  | `openbot-gateway-rc`                                                                                                                                                                                                                      |
| Control UI | `index-4bdvd7zW.js`                                                                                                                                                                                                                       |
| Gateway    | unchanged `collab-invite-nav-todos-r32`                                                                                                                                                                                                   |
| Pin        | `OPENBOT_UI_OVERLAY_PINNED_ENTRY=index-4bdvd7zW.js`；forbid includes prior `index-CbAz68n3.js`                                                                                                                                            |
| Smoke      | healthz **200**; readyz **ready:true**; www/gw/served/container → `index-4bdvd7zW.js`; markers `onOpenStewardSuggestion` / `steward-bar--action`; verify-control-ui-v3 **OK**                                                             |
| Rollback   | restore `/root/.openbot/control-ui.bak-pre-steward-suggestion-deeplink-r35-20260809T054621Z` + pin bak then podman cp                                                                                                                     |
| Executor   | `cursor-grok`                                                                                                                                                                                                                             |
| Merge-back | Pending — steward suggestion deeplink @ `ae7ee32b63` (PR #317).                                                                                                                                                                           |

### Rollback

```bash
STAMP=20260809T054621Z
OVERLAY=steward-suggestion-deeplink-r35
BASE=/root/openbot-ui-baselines/v3.0
SERVED=/root/.openbot/control-ui
chattr -i "$BASE/pin.env" 2>/dev/null || true
rm -rf "$SERVED" "$BASE/control-ui"
cp -a "${SERVED}.bak-pre-${OVERLAY}-${STAMP}" "$SERVED"
cp -a "$BASE/control-ui.bak-pre-${OVERLAY}-${STAMP}" "$BASE/control-ui" 2>/dev/null || true
cp -a "$BASE/pin.env.bak-pre-${OVERLAY}-${STAMP}" "$BASE/pin.env"
podman exec openbot-gateway-rc sh -c 'rm -rf /app/dist/control-ui && mkdir -p /app/dist/control-ui'
podman cp "$SERVED/." openbot-gateway-rc:/app/dist/control-ui/
```

---

## Previous cutover (2026-08-09 ~13:34 CST) — Control UI: 数据能力中心列表精简 (`edc-lean-lists-r34`)

| Field      | Value                                                                                                                                                                                                                        |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date       | 2026-08-09 (UI live ~13:34 CST / artifact `20260809T052306Z`)                                                                                                                                                                |
| Decision   | 企业数据能力中心去掉各 Tab 冗余大标题/释义；数据资产表 lean 排版（资产/同步/状态/操作，行内编辑+菜单）；新增入口收到筛选工具条；数据产品/输出与物化同款扁平化。                                                              |
| Source     | `cursor/workbench-isolation-r6` @ `4d337bbb01` (`bb566328e2` + `4d337bbb01`) `pnpm ui:build` → `openbot-control-ui-edc-lean-lists-r34-20260809T052306Z.tar.gz` (`index-CbAz68n3.js`, md5 `99406388e6f25f93d507eac5d109be67`) |
| Build mode | Working-tree Control UI overlay → served root + baseline + container embed（跳过会换镜像的 watch fallback）                                                                                                                  |
| Container  | `openbot-gateway-rc`                                                                                                                                                                                                         |
| Control UI | `index-CbAz68n3.js`                                                                                                                                                                                                          |
| Gateway    | unchanged `collab-invite-nav-todos-r32`                                                                                                                                                                                      |
| Pin        | `OPENBOT_UI_OVERLAY_PINNED_ENTRY=index-CbAz68n3.js`；forbid includes prior `index-ChMYpKR4.js`                                                                                                                               |
| Smoke      | healthz **200**; readyz **ready:true**; www/gw/served → `index-CbAz68n3.js`; markers `edc-console-table--lean` / `edc-list-toolbar` / `新增数据资产`; verify-control-ui-v3 **OK**                                            |
| Rollback   | restore `/root/.openbot/control-ui.bak-pre-edc-lean-lists-r34-20260809T052306Z` + pin bak then podman cp                                                                                                                     |
| Executor   | `cursor-grok`                                                                                                                                                                                                                |
| Merge-back | Pending — edc lean lists @ `4d337bbb01` (PR #317).                                                                                                                                                                           |

### Rollback

```bash
STAMP=20260809T052306Z
OVERLAY=edc-lean-lists-r34
BASE=/root/openbot-ui-baselines/v3.0
SERVED=/root/.openbot/control-ui
chattr -i "$BASE/pin.env" 2>/dev/null || true
rm -rf "$SERVED" "$BASE/control-ui"
cp -a "${SERVED}.bak-pre-${OVERLAY}-${STAMP}" "$SERVED"
cp -a "$BASE/control-ui.bak-pre-${OVERLAY}-${STAMP}" "$BASE/control-ui" 2>/dev/null || true
cp -a "$BASE/pin.env.bak-pre-${OVERLAY}-${STAMP}" "$BASE/pin.env"
podman exec openbot-gateway-rc sh -c 'rm -rf /app/dist/control-ui && mkdir -p /app/dist/control-ui'
podman cp "$SERVED/." openbot-gateway-rc:/app/dist/control-ui/
```

---

## Previous cutover (2026-08-09 ~13:02 CST) — Control UI: 成员管理整页 + 每日概览固定高度 (`workbench-members-signals-r33`)

| Field      | Value                                                                                                                                                                                                                                        |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date       | 2026-08-09 (UI live ~13:02 CST / artifact `20260809T044542Z`)                                                                                                                                                                                |
| Decision   | 系统设置「管理成员」进入完整成员管理页（不再误进对话）；每日概览「今日日程/待办事项」两卡固定等高，列表超出在卡内滚动。                                                                                                                      |
| Source     | `cursor/workbench-isolation-r6` @ `75ac191fe3` (`b3fe60d249` + `75ac191fe3`) → UI `openbot-control-ui-workbench-members-signals-r33-20260809T044542Z.tar.gz` (md5 `29e9bd835b683ab4acf1a7339c38988d`)                                        |
| Build mode | Control UI pin only（保留 gateway `collab-invite-nav-todos-r32`）；`pin.env` 有 immutable `chattr +i`，更新时需先 `chattr -i`                                                                                                                |
| Container  | `openbot-gateway-rc`                                                                                                                                                                                                                         |
| Control UI | `index-ChMYpKR4.js`                                                                                                                                                                                                                          |
| Gateway    | unchanged `collab-invite-nav-todos-r32`                                                                                                                                                                                                      |
| Smoke      | healthz **200**; readyz **ready:true**; verify-control-ui-v3 OK; served CSS has `wb-signals-parallel-card-height`; JS has `collaboration-stage--members-page`                                                                                |
| Rollback   | restore `/root/openbot-maintenance-workbench-members-signals-r33-20260809T044542Z/control-ui.before.tgz` into `/root/.openbot/control-ui`, restore `pin.env.before` (chattr -i/+i), re-embed + restart — **do not** run `restore-ui-v3.0.sh` |
| Executor   | `cursor-grok`                                                                                                                                                                                                                                |
| Merge-back | Pending — members page + signals card height (`75ac191fe3`).                                                                                                                                                                                 |

### Rollback

```bash
STAMP=20260809T044542Z
OVERLAY=workbench-members-signals-r33
BK=/root/openbot-maintenance-${OVERLAY}-${STAMP}
SERVED=/root/.openbot/control-ui
BASE=/root/openbot-ui-baselines/v3.0
rm -rf "$SERVED" && mkdir -p "$SERVED"
tar xzf "$BK/control-ui.before.tgz" -C "$SERVED"
chattr -i "$BASE/pin.env"
cp -a "$BK/pin.env.before" "$BASE/pin.env"
chattr +i "$BASE/pin.env"
podman exec openbot-gateway-rc sh -c 'rm -rf /app/dist/control-ui && mkdir -p /app/dist/control-ui'
podman cp "$SERVED/." openbot-gateway-rc:/app/dist/control-ui/
podman restart openbot-gateway-rc
```

---

## Previous cutover (2026-08-09 ~11:10 CST) — Gateway+UI: 协作邀请待办/导航/座位机器人对齐 (`collab-invite-nav-todos-r32`)

| Field      | Value                                                                                                                                                                                                                                                                                                             |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date       | 2026-08-09 (LIVE re-apply ~11:10 CST / artifact `20260809T030219Z`; first cutover hit `restore-ui-v3.0.sh` and reverted GW to `agents-list-scope-r1`, then overlay re-applied without container recreate)                                                                                                         |
| Decision   | CEO 侧：仅邀请未接受的群不再进协作导航，邀请出现在「待办事项」且可同意/拒绝；创建方（座位占用者）可激活本座位机器人，不再误要求「产品体验-王老师」同意。                                                                                                                                                          |
| Source     | `cursor/workbench-isolation-r6` @ `141c1d36fe` → GW `openbot-gateway-dist-collab-invite-nav-todos-r32-20260809T030219Z.tar.gz` (md5 `971c8f5fc8c2ffc4af2f22dafb928654`); UI `openbot-control-ui-collab-invite-nav-todos-r32-20260809T030219Z.tar.gz` (md5 `9c657b7cf57fd9a18b1766326456162e`)                     |
| Build mode | Gateway dist overlay + Control UI pin；v3 tip gate OK (`index-DVYo5aMN.js`)                                                                                                                                                                                                                                       |
| Container  | `openbot-gateway-rc`                                                                                                                                                                                                                                                                                              |
| Control UI | `index-DVYo5aMN.js`                                                                                                                                                                                                                                                                                               |
| Gateway    | overlay `collab-invite-nav-todos-r32`                                                                                                                                                                                                                                                                             |
| Smoke      | healthz **200**; readyz **ready:true**; build-info features `invite-todos-passthrough` / `invite-only-nav-filter` / `human-invitee-mutate` / `position-seat-bot-owner-map`; `buildBotOwnerUserIdMap` in `space-store-*.js`; UI contains `workbenchPendingTasks`; verify-control-ui-v3 OK                          |
| Rollback   | restore `/root/openbot-maintenance-collab-invite-nav-todos-r32-20260809T030219Z-reapply/container-app-dist.before-reapply.tgz` (or prior r31 backup) then re-embed served UI + `podman restart` — **do not** run `restore-ui-v3.0.sh` (recreates container from `localhost/openbot:ui-v3.0` and drops GW overlay) |
| Executor   | `cursor-grok`                                                                                                                                                                                                                                                                                                     |
| Merge-back | Pending — invite todos/nav + seat bot owner map (`141c1d36fe`).                                                                                                                                                                                                                                                   |

### Rollback

```bash
STAMP=20260809T030219Z
OVERLAY=collab-invite-nav-todos-r32
BK=/root/openbot-maintenance-${OVERLAY}-${STAMP}-reapply
SERVED=/root/.openbot/control-ui
mkdir -p /tmp/gw-dist-rollback && rm -rf /tmp/gw-dist-rollback/*
tar xzf "$BK/container-app-dist.before-reapply.tgz" -C /tmp/gw-dist-rollback
podman exec openbot-gateway-rc sh -c 'rm -rf /app/dist && mkdir -p /app/dist'
podman cp /tmp/gw-dist-rollback/dist/. openbot-gateway-rc:/app/dist/
podman exec openbot-gateway-rc sh -c 'rm -rf /app/dist/control-ui && mkdir -p /app/dist/control-ui'
podman cp "$SERVED/." openbot-gateway-rc:/app/dist/control-ui/
podman restart openbot-gateway-rc
```

### Note — avoid v3 full restore during overlay cutovers

`/root/openbot-ui-baselines/v3.0/restore-ui-v3.0.sh` renames LIVE to `*-prev-before-v3-restore-*` and recreates from `localhost/openbot:ui-v3.0`, wiping gateway overlays. Prefer `podman cp` + `podman restart` only. Also `pin.env` may be `chattr +i` immutable.

---

## Previous cutover (2026-08-09 ~10:31 CST) — Gateway: 排除大白管家待确认邀请误进导航 (`collab-invite-steward-exclude-r31`)

| Field      | Value                                                                                                                                                                                                                   |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date       | 2026-08-09 (GW live ~10:31 CST / artifact `20260809T022956Z`)                                                                                                                                                           |
| Decision   | 「培训课程设计组」因 `main`（大白管家）pending invite 且 `ownerUserId` 盖成 CEO，被误列入 CEO 协作导航。builtin steward 不再作为个人待审批机器人进 spaces.list / pending-tasks / 导航红点。真正业务机器人邀请闭环不变。 |
| Source     | `cursor/workbench-isolation-r6` @ `5874cd3690` clean `git archive HEAD` tsdown → `openbot-gateway-dist-collab-invite-steward-exclude-r31-20260809T022956Z.tar.gz` (md5 `04ed63cb3e150d7b5435370ee646f797`)              |
| Build mode | Gateway dist overlay（exclude control-ui，再嵌入当前 served UI）；UI tip gate 缺 enterprise chunk，本轮未切 UI（导航可见性由 GW 决定）                                                                                  |
| Container  | `openbot-gateway-rc`                                                                                                                                                                                                    |
| Control UI | unchanged `index-CeGWfosC.js`                                                                                                                                                                                           |
| Gateway    | overlay `collab-invite-steward-exclude-r31`                                                                                                                                                                             |
| Smoke      | healthz **200**; readyz **ready:true**; build-info feature `exclude-builtin-steward-pending-invite-nav`; `actorOwnsPendingBotInviteInSpace` in reply bundle                                                             |
| Rollback   | restore `/root/openbot-maintenance-collab-invite-steward-exclude-r31-20260809T022956Z/container-app-dist.before.tgz` then re-embed served UI + restart                                                                  |
| Executor   | `cursor-grok`                                                                                                                                                                                                           |
| Merge-back | Pending — steward invite nav exclusion (`5874cd3690`).                                                                                                                                                                  |

### Rollback

```bash
STAMP=20260809T022956Z
OVERLAY=collab-invite-steward-exclude-r31
BK=/root/openbot-maintenance-${OVERLAY}-${STAMP}
SERVED=/root/.openbot/control-ui
mkdir -p /tmp/gw-dist-rollback && rm -rf /tmp/gw-dist-rollback/*
tar xzf "$BK/container-app-dist.before.tgz" -C /tmp/gw-dist-rollback
podman exec openbot-gateway-rc sh -c 'rm -rf /app/dist && mkdir -p /app/dist'
podman cp /tmp/gw-dist-rollback/dist/. openbot-gateway-rc:/app/dist/
podman exec openbot-gateway-rc sh -c 'rm -rf /app/dist/control-ui && mkdir -p /app/dist/control-ui'
podman cp "$SERVED/." openbot-gateway-rc:/app/dist/control-ui/
podman restart openbot-gateway-rc
```

---

## Previous cutover (2026-08-09 ~09:37 CST) — Gateway: 员工注册读租户 seat-assets (`employee-register-tenant-seat-r30`)

| Field      | Value                                                                                                                                                                                               |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date       | 2026-08-09 (GW live ~09:37 CST / artifact `20260809T013602Z`)                                                                                                                                       |
| Decision   | 发邀请写 `tenants/<id>/control-plane/seat-assets.json`，注册/offer 却读全局 `openbot-enterprise-seat-assets.json`，导致激活码有效但 `assignSeatToEmployee` 报 `Seat not found.`。改为租户路径 I/O。 |
| Source     | `cursor/workbench-isolation-r6` @ `bf50dc20ab` → `openbot-gateway-dist-employee-register-tenant-seat-r30-20260809T013602Z.tar.gz` (md5 `f20ec6407e4b59743843e04b1f7a3a06`)                          |
| Build mode | Gateway dist overlay（exclude control-ui，再嵌入当前 served UI）                                                                                                                                    |
| Container  | `openbot-gateway-rc`                                                                                                                                                                                |
| Control UI | unchanged `index-CeGWfosC.js`                                                                                                                                                                       |
| Gateway    | overlay `employee-register-tenant-seat-r30`                                                                                                                                                         |
| Smoke      | healthz **200**; readyz **ready:true**; marker `saveSeatAssetsStoreForTenantId(enterprise.id` in `auth-profiles-BCHVHdHE.js`; Aug9×9 pending seats present in `tenants/001/.../seat-assets.json`    |
| Rollback   | restore `/root/openbot-maintenance-employee-register-tenant-seat-r30-20260809T013602Z/container-app-dist.before.tgz` then re-embed served UI + restart                                              |
| Executor   | `cursor-composer`                                                                                                                                                                                   |
| Merge-back | Landed on branch @ `bf50dc20ab` (PR pending).                                                                                                                                                       |

### Rollback

```bash
STAMP=20260809T013602Z
OVERLAY=employee-register-tenant-seat-r30
BK=/root/openbot-maintenance-${OVERLAY}-${STAMP}
SERVED=/root/.openbot/control-ui
podman exec openbot-gateway-rc sh -c 'rm -rf /app/dist && mkdir -p /app/dist'
tar -xzf "$BK/container-app-dist.before.tgz" -C /tmp && podman cp /tmp/dist/. openbot-gateway-rc:/app/dist/
podman exec openbot-gateway-rc sh -c 'rm -rf /app/dist/control-ui && mkdir -p /app/dist/control-ui'
podman cp "$SERVED/." openbot-gateway-rc:/app/dist/control-ui/
podman restart openbot-gateway-rc
```

---

## Previous cutover (2026-08-09 ~08:59 CST) — Gateway: 协作邀请进待办闭环 (`collab-invite-todos-r29`)

| Field      | Value                                                                                                                                                                                                                                                         |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date       | 2026-08-09 (GW live ~08:59 CST / artifact `20260809T005752Z`)                                                                                                                                                                                                 |
| Decision   | 收到协作小组邀请（含邀请自己的机器人）投影到顶部「待办事项」文案「收到XX发来的协作邀请」；机器人主人可列组并审批；`members.update` 后 `workbench.signals.invalidate`（collaboration）刷新待办。UI 深链 `onOpenCollaborationInvite` 已在 `index-CeGWfosC.js`。 |
| Source     | `cursor/workbench-isolation-r6` @ `25de7bf19d` (`f1e38a2971` + `9975e14d9c`) clean `git archive HEAD` tsdown → `openbot-gateway-dist-collab-invite-todos-r29-20260809T005752Z.tar.gz` (md5 `d2a51166bcac3bd9f7f744b05eb36796`)                                |
| Build mode | Gateway dist overlay（exclude control-ui，再嵌入当前 served UI）                                                                                                                                                                                              |
| Container  | `openbot-gateway-rc`                                                                                                                                                                                                                                          |
| Control UI | `index-CeGWfosC.js`（unchanged pin；含 invite 深链）                                                                                                                                                                                                          |
| Gateway    | overlay `collab-invite-todos-r29`                                                                                                                                                                                                                             |
| Pin        | unchanged                                                                                                                                                                                                                                                     |
| Smoke      | healthz **200**; readyz **ready:true**; markers `发来的协作邀请` in `gateway-cli-*.js`; `actorOwnsPendingBotInviteInSpace`; UI `onOpenCollaborationInvite` present                                                                                            |
| Rollback   | restore `/root/openbot-maintenance-collab-invite-todos-r29-20260809T005752Z/container-app-dist.before.tgz` then re-embed served UI + restart                                                                                                                  |
| Executor   | `cursor-grok`                                                                                                                                                                                                                                                 |
| Merge-back | Pending — invite todos loop (`f1e38a2971` / `9975e14d9c`).                                                                                                                                                                                                    |

### Rollback

```bash
STAMP=20260809T005752Z
OVERLAY=collab-invite-todos-r29
BK=/root/openbot-maintenance-${OVERLAY}-${STAMP}
SERVED=/root/.openbot/control-ui
mkdir -p /tmp/gw-dist-rollback && rm -rf /tmp/gw-dist-rollback/*
tar xzf "$BK/container-app-dist.before.tgz" -C /tmp/gw-dist-rollback
podman exec openbot-gateway-rc sh -c 'rm -rf /app/dist && mkdir -p /app/dist'
podman cp /tmp/gw-dist-rollback/dist/. openbot-gateway-rc:/app/dist/
podman exec openbot-gateway-rc sh -c 'rm -rf /app/dist/control-ui && mkdir -p /app/dist/control-ui'
podman cp "$SERVED/." openbot-gateway-rc:/app/dist/control-ui/
podman restart openbot-gateway-rc
```

---

## Previous cutover (2026-08-09 ~08:50 CST) — Control UI: 组织模块回首页导航 (`enterprise-org-home-nav-r28`)

| Field      | Value                                                                                                                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date       | 2026-08-09 (UI live ~08:50 CST / artifact `20260809T004948Z`)                                                                                                                                           |
| Decision   | 组织与数字人 structure/二级/三级增加可点模块标题 + 路径条回模块首页；关闭仍留在组织目录；治理队列下钻 footer「返回模块首页」与统一 reset 共用。同批含机巢资产回退、数据治理面板精简、设置集成去通道区。 |
| Source     | `cursor/workbench-isolation-r6` @ `9975e14d9c` `pnpm ui:build` → `openbot-control-ui-enterprise-org-home-nav-r28-20260809T004948Z.tar.gz` (`index-CeGWfosC.js`, md5 `f6b0039fb0b6b24dc0133d1a22809171`) |
| Build mode | Working-tree Control UI overlay → served root + baseline + container embed（跳过会换镜像的 watch fallback）                                                                                             |
| Container  | `openbot-gateway-rc`                                                                                                                                                                                    |
| Control UI | `index-CeGWfosC.js`                                                                                                                                                                                     |
| Gateway    | unchanged `employee-devices-dedupe-r26`                                                                                                                                                                 |
| Pin        | `OPENBOT_UI_OVERLAY_PINNED_ENTRY=index-CeGWfosC.js`；forbid includes prior `index-C0uLRW4y.js` / `index-zYpMh5I5.js` / `index-BzBkWmqo.js`                                                              |
| Smoke      | healthz **200**; readyz **ready:true**; www/gw/served → `index-CeGWfosC.js`; markers `enterprise-org-trail` / `返回模块首页` / `enterprise-page__title--link`; verify-control-ui-v3 **OK**              |
| Rollback   | restore `/root/.openbot/control-ui.bak-pre-enterprise-org-home-nav-r28-20260809T004948Z` + pin bak then podman cp                                                                                       |
| Executor   | `cursor-grok`                                                                                                                                                                                           |
| Merge-back | Pending — org home nav + enterprise UI polish @ `9975e14d9c` (gateway workbench commits on branch, not cut over).                                                                                       |

### Rollback

```bash
STAMP=20260809T004948Z
OVERLAY=enterprise-org-home-nav-r28
BASE=/root/openbot-ui-baselines/v3.0
SERVED=/root/.openbot/control-ui
chattr -i "$BASE/pin.env" 2>/dev/null || true
rm -rf "$SERVED" "$BASE/control-ui"
cp -a "${SERVED}.bak-pre-${OVERLAY}-${STAMP}" "$SERVED"
cp -a "$BASE/control-ui.bak-pre-${OVERLAY}-${STAMP}" "$BASE/control-ui" 2>/dev/null || true
cp -a "$BASE/pin.env.bak-pre-${OVERLAY}-${STAMP}" "$BASE/pin.env"
podman exec openbot-gateway-rc sh -c 'rm -rf /app/dist/control-ui && mkdir -p /app/dist/control-ui'
podman cp "$SERVED/." openbot-gateway-rc:/app/dist/control-ui/
```

---

## Previous cutover (2026-08-09 ~08:48 CST) — Control UI: 我的设备保留移除 (`employee-devices-remove-r27`)

| Field      | Value                                                                                                                                                                                                                            |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date       | 2026-08-09 (UI live ~08:48 CST / artifact `20260809T004706Z`)                                                                                                                                                                    |
| Decision   | 「我的设备」当前会话行此前隐藏「移除」，去重后只剩当前设备时无法撤销登录。恢复每行「移除」（含当前），点击仍走确认后 `device.pair.remove`。                                                                                      |
| Source     | `cursor/workbench-isolation-r6` @ `40590ccb71` clean `git archive HEAD` `pnpm ui:build` → `openbot-control-ui-employee-devices-remove-r27-20260809T004706Z.tar.gz` (`index-C0uLRW4y.js`, md5 `980306b7a48a08fde375c1ccf1319ac9`) |
| Build mode | Clean `git archive HEAD` Control UI overlay → served root + baseline + container embed（跳过会换镜像的 watch fallback）                                                                                                          |
| Container  | `openbot-gateway-rc`                                                                                                                                                                                                             |
| Control UI | `index-C0uLRW4y.js`                                                                                                                                                                                                              |
| Gateway    | unchanged `employee-devices-dedupe-r26`                                                                                                                                                                                          |
| Pin        | `OPENBOT_UI_OVERLAY_PINNED_ENTRY=index-C0uLRW4y.js`；forbid includes prior `index-zYpMh5I5.js` / `index-BzBkWmqo.js`                                                                                                             |
| Smoke      | healthz **200**; readyz **ready:true**; www/gw/served → `index-C0uLRW4y.js`; marker `移除当前设备后需重新登录配对` in `workbench-B78AETSJ.js`; verify-control-ui-v3 **OK**                                                       |
| Rollback   | restore `/root/.openbot/control-ui.bak-pre-employee-devices-remove-r27-20260809T004706Z` + pin bak then podman cp                                                                                                                |
| Executor   | `cursor-composer`                                                                                                                                                                                                                |
| Merge-back | Landed on branch @ `40590ccb71` (PR pending).                                                                                                                                                                                    |

### Rollback

```bash
STAMP=20260809T004706Z
OVERLAY=employee-devices-remove-r27
BASE=/root/openbot-ui-baselines/v3.0
SERVED=/root/.openbot/control-ui
chattr -i "$BASE/pin.env" 2>/dev/null || true
rm -rf "$SERVED" "$BASE/control-ui"
cp -a "${SERVED}.bak-pre-${OVERLAY}-${STAMP}" "$SERVED"
cp -a "$BASE/control-ui.bak-pre-${OVERLAY}-${STAMP}" "$BASE/control-ui" 2>/dev/null || true
cp -a "$BASE/pin.env.bak-pre-${OVERLAY}-${STAMP}" "$BASE/pin.env"
podman exec openbot-gateway-rc sh -c 'rm -rf /app/dist/control-ui && mkdir -p /app/dist/control-ui'
podman cp "$SERVED/." openbot-gateway-rc:/app/dist/control-ui/
```

---

## Previous cutover (2026-08-09 ~08:25 CST) — Control UI: 大白协助整理闭环 (`daibai-group-config-loop-r26`)

| Field      | Value                                                                                                                                                                                                                               |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date       | 2026-08-09 (UI live ~08:25 CST / artifact `20260809T002352Z`)                                                                                                                                                                       |
| Decision   | 「请大白协助整理」改切大白管家会话并自动 `chat.send`；回复解析 `group-config-proposal` fence，舞台展示「应用到协作小组」并经现有 settings/members 写回。                                                                            |
| Source     | `cursor/workbench-isolation-r6` @ `369d3b277b` (`abea2b6bf7` + quota dep) `pnpm ui:build` → `openbot-control-ui-daibai-group-config-loop-r26-20260809T002352Z.tar.gz` (`index-zYpMh5I5.js`, md5 `841189cabead811dc2d9d89e749df79e`) |
| Build mode | Clean `git archive HEAD` Control UI overlay → served root + baseline + container embed（跳过会换镜像的 watch fallback）                                                                                                             |
| Container  | `openbot-gateway-rc`                                                                                                                                                                                                                |
| Control UI | `index-zYpMh5I5.js`                                                                                                                                                                                                                 |
| Gateway    | unchanged `employee-devices-dedupe-r26`                                                                                                                                                                                             |
| Pin        | `OPENBOT_UI_OVERLAY_PINNED_ENTRY=index-zYpMh5I5.js`；forbid includes prior `index-BzBkWmqo.js`                                                                                                                                      |
| Smoke      | healthz **200**; readyz **ready:true**; www/served/container → `index-zYpMh5I5.js`; markers `应用到协作小组` / `group-config-proposal` / `已发送给大白管家` / `采纳并写回小组`; verify-control-ui-v3 **OK**                         |
| Rollback   | restore `/root/.openbot/control-ui.bak-pre-daibai-group-config-loop-r26-20260809T002352Z` + pin bak then podman cp                                                                                                                  |
| Executor   | `cursor-grok`                                                                                                                                                                                                                       |
| Merge-back | Pending — daibai group-config loop (`abea2b6bf7` / `369d3b277b`).                                                                                                                                                                   |

### Rollback

```bash
STAMP=20260809T002352Z
OVERLAY=daibai-group-config-loop-r26
BASE=/root/openbot-ui-baselines/v3.0
SERVED=/root/.openbot/control-ui
chattr -i "$BASE/pin.env" 2>/dev/null || true
rm -rf "$SERVED" "$BASE/control-ui"
cp -a "${SERVED}.bak-pre-${OVERLAY}-${STAMP}" "$SERVED"
cp -a "$BASE/control-ui.bak-pre-${OVERLAY}-${STAMP}" "$BASE/control-ui" 2>/dev/null || true
cp -a "$BASE/pin.env.bak-pre-${OVERLAY}-${STAMP}" "$BASE/pin.env"
podman exec openbot-gateway-rc sh -c 'rm -rf /app/dist/control-ui && mkdir -p /app/dist/control-ui'
podman cp "$SERVED/." openbot-gateway-rc:/app/dist/control-ui/
```

---

## Previous cutover (2026-08-09 ~08:22 CST) — Gateway: dedupe duplicate browser devices (`employee-devices-dedupe-r26`)

| Field      | Value                                                                                                                                                                                                                                        |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date       | 2026-08-09 (GW live ~08:22 CST / artifact `20260809T002047Z`)                                                                                                                                                                                |
| Decision   | 「我的设备」同一 Mac/Chrome 出现两行：trusted-proxy 下 connect silent-approve 与 list upsert 用不同 deviceId 各登记一次。list 时按浏览器指纹去重并删除旧记录；UI 同步折叠展示。生产 `paired.json` 已删旧条目 `26d34bd9…`，保留 `9fff230e…`。 |
| Source     | `cursor/workbench-isolation-r6` @ `752be7b166` → `openbot-gateway-dist-employee-devices-dedupe-r26-20260809T002047Z.tar.gz` (md5 `6b83d96f97036be5186ec645c0aa9442`)                                                                         |
| Build mode | Gateway dist overlay（exclude control-ui，再嵌入当前 served UI）                                                                                                                                                                             |
| Container  | `openbot-gateway-rc`                                                                                                                                                                                                                         |
| Control UI | `index-BzBkWmqo.js`（unchanged pin）                                                                                                                                                                                                         |
| Gateway    | overlay `employee-devices-dedupe-r26`                                                                                                                                                                                                        |
| Pin        | unchanged                                                                                                                                                                                                                                    |
| Smoke      | healthz **200**; readyz **ready:true**; markers `pruneDuplicateSelfBrowserDevices` in `gateway-cli-*.js`; paired browser for owner `90fed19a…` count **1**                                                                                   |
| Rollback   | restore `/root/openbot-maintenance-employee-devices-dedupe-r26-20260809T002047Z/container-app-dist.before.tgz` (+ optional `paired.json.before`) then re-embed served UI + restart                                                           |
| Executor   | `cursor-composer`                                                                                                                                                                                                                            |
| Merge-back | Landed on branch @ `752be7b166` (PR pending).                                                                                                                                                                                                |

### Rollback

```bash
STAMP=20260809T002047Z
OVERLAY=employee-devices-dedupe-r26
BK=/root/openbot-maintenance-${OVERLAY}-${STAMP}
SERVED=/root/.openbot/control-ui
mkdir -p /tmp/gw-dist-rollback && rm -rf /tmp/gw-dist-rollback/*
tar xzf "$BK/container-app-dist.before.tgz" -C /tmp/gw-dist-rollback
podman exec openbot-gateway-rc sh -c 'rm -rf /app/dist && mkdir -p /app/dist'
podman cp /tmp/gw-dist-rollback/dist/. openbot-gateway-rc:/app/dist/
podman exec openbot-gateway-rc sh -c 'rm -rf /app/dist/control-ui && mkdir -p /app/dist/control-ui'
podman cp "$SERVED/." openbot-gateway-rc:/app/dist/control-ui/
# optional: cp "$BK/paired.json.before" /root/.openbot/devices/paired.json
podman restart openbot-gateway-rc
```

---

## Previous cutover (2026-08-09 ~08:14 CST) — Gateway: trusted-proxy Control UI device register (`employee-devices-trusted-proxy-r25`)

| Field      | Value                                                                                                                                                                                                                             |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date       | 2026-08-09 (GW live ~08:14 CST / artifact `20260809T001338Z`)                                                                                                                                                                     |
| Decision   | 生产 trusted-proxy 下 Control UI 曾跳过设备配对，导致「我的设备」为空。改为仍 silent-approve 登记浏览器并 stamp ownerId；`device.pair.list` 对当前未登记设备补登记；去掉设备页说明副标题。                                        |
| Source     | `cursor/workbench-isolation-r6` @ `9cf5d4a1c5` → `openbot-gateway-dist-employee-devices-trusted-proxy-r25-20260809T001338Z.tar.gz` (md5 `e4d08804fa836dbe3aeb384087daf445`)；UI 在现网 entry `index-BzBkWmqo.js` 热剥离副标题文案 |
| Build mode | Gateway dist overlay（再嵌入当前 served UI）+ Control UI string strip                                                                                                                                                             |
| Container  | `openbot-gateway-rc`                                                                                                                                                                                                              |
| Control UI | `index-BzBkWmqo.js`（subtitle stripped）                                                                                                                                                                                          |
| Gateway    | overlay `employee-devices-trusted-proxy-r25`                                                                                                                                                                                      |
| Pin        | unchanged pinned entry; subtitle string removed from served/baseline assets                                                                                                                                                       |
| Smoke      | healthz **200**; readyz **ready:true**; markers `requestDevicePairing` in `gateway-cli-*.js`; subtitle count **0**                                                                                                                |
| Rollback   | restore `/root/openbot-maintenance-employee-devices-trusted-proxy-r25-20260809T001338Z/container-app-dist.before.tgz` then re-embed served UI + restart                                                                           |
| Executor   | `cursor-composer`                                                                                                                                                                                                                 |
| Merge-back | Landed on branch @ `9cf5d4a1c5` (PR pending).                                                                                                                                                                                     |

### Rollback

```bash
STAMP=20260809T001338Z
OVERLAY=employee-devices-trusted-proxy-r25
BK=/root/openbot-maintenance-${OVERLAY}-${STAMP}
SERVED=/root/.openbot/control-ui
mkdir -p /tmp/gw-dist-rollback && rm -rf /tmp/gw-dist-rollback/*
tar xzf "$BK/container-app-dist.before.tgz" -C /tmp/gw-dist-rollback
podman exec openbot-gateway-rc sh -c 'rm -rf /app/dist && mkdir -p /app/dist'
podman cp /tmp/gw-dist-rollback/dist/. openbot-gateway-rc:/app/dist/
podman exec openbot-gateway-rc sh -c 'rm -rf /app/dist/control-ui && mkdir -p /app/dist/control-ui'
podman cp "$SERVED/." openbot-gateway-rc:/app/dist/control-ui/
podman restart openbot-gateway-rc
```

---

## Previous cutover (2026-08-09 ~07:36 CST) — Control UI: collaboration capsule human presence dots (`collab-capsule-human-presence-r24`)

| Field      | Value                                                                                                                                                                                                         |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date       | 2026-08-09 (UI live ~07:36 CST / artifact `20260808T233531Z`)                                                                                                                                                 |
| Decision   | 协作小组顶部胶囊：真人在线状态与成员管理侧栏一致，头像右下角绿点（`presenceStatus=online`）；离线不打红点。                                                                                                   |
| Source     | `cursor/workbench-isolation-r6` @ `0538845c86` `pnpm ui:build` → `openbot-control-ui-collab-capsule-human-presence-r24-20260808T233531Z.tar.gz` (`index-BzBkWmqo.js`, md5 `7cf2e10989ab6203702120d05f1c6683`) |
| Build mode | Control UI overlay → served root + baseline + container embed（跳过会换镜像的 watch fallback；tip 含同批 knowledge cockpit polish）                                                                           |
| Container  | `openbot-gateway-rc`                                                                                                                                                                                          |
| Control UI | `index-BzBkWmqo.js`                                                                                                                                                                                           |
| Gateway    | unchanged `knowledge-source-open-folder-r11`                                                                                                                                                                  |
| Pin        | `OPENBOT_UI_OVERLAY_PINNED_ENTRY=index-BzBkWmqo.js`；forbid includes prior `index-CE7Osj5o.js` / `index-CSw50LWe.js`                                                                                          |
| Smoke      | healthz **200**; readyz **ready:true**; www/served/container → `index-BzBkWmqo.js`; workbench `presenceStatus==="online"` marker; verify-control-ui-v3 **OK**                                                 |
| Rollback   | restore `/root/.openbot/control-ui.bak-pre-collab-capsule-human-presence-r24-20260808T233531Z` + pin bak then podman cp                                                                                       |
| Executor   | `cursor-composer`                                                                                                                                                                                             |
| Merge-back | Pending — capsule human presence (`0538845c86`).                                                                                                                                                              |

### Rollback

```bash
STAMP=20260808T233531Z
OVERLAY=collab-capsule-human-presence-r24
BASE=/root/openbot-ui-baselines/v3.0
SERVED=/root/.openbot/control-ui
chattr -i "$BASE/pin.env" 2>/dev/null || true
rm -rf "$SERVED" "$BASE/control-ui"
cp -a "${SERVED}.bak-pre-${OVERLAY}-${STAMP}" "$SERVED"
cp -a "$BASE/control-ui.bak-pre-${OVERLAY}-${STAMP}" "$BASE/control-ui" 2>/dev/null || true
cp -a "$BASE/pin.env.bak-pre-${OVERLAY}-${STAMP}" "$BASE/pin.env"
podman exec openbot-gateway-rc sh -c 'rm -rf /app/dist/control-ui && mkdir -p /app/dist/control-ui'
podman cp "$SERVED/." openbot-gateway-rc:/app/dist/control-ui/
```

---

## Previous cutover (2026-08-09 ~07:35 CST) — Control UI: knowledge cockpit polish (`knowledge-cockpit-polish-r24`)

| Field      | Value                                                                                                                                                                                                    |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date       | 2026-08-09 (UI live ~07:35 CST / artifact `20260808T233445Z`)                                                                                                                                            |
| Decision   | 知识首页驾驶舱：个人/团队/企业分区行加深底色；图谱缩放工具栏移到「关系洞察」标题行右侧；底部 ticker 展示具体知识标题（替代泛化「查看相关知识」；UI 对泛化文案做图谱标题兜底）。                          |
| Source     | `cursor/workbench-isolation-r6` @ `8f08993f07` `pnpm ui:build` → `openbot-control-ui-knowledge-cockpit-polish-r24-20260808T233445Z.tar.gz` (`index-BzBkWmqo.js`, md5 `f368c0b8bdf54ea94cbe2c552b662cd1`) |
| Build mode | Control UI overlay → served root + baseline + container embed（gateway dist 不变；action-engine 标题改动已入库，待后续 GW overlay）                                                                      |
| Container  | `openbot-gateway-rc`                                                                                                                                                                                     |
| Control UI | `index-BzBkWmqo.js`                                                                                                                                                                                      |
| Gateway    | unchanged `knowledge-source-open-folder-r11`                                                                                                                                                             |
| Pin        | `OPENBOT_UI_OVERLAY_PINNED_ENTRY=index-BzBkWmqo.js`；forbid includes prior `index-CE7Osj5o.js`                                                                                                           |
| Smoke      | healthz **200**; readyz **ready:true**; www/gw/served/container → `index-BzBkWmqo.js`; markers `ku-cockpit__tree-group--section` + `ku-home-cockpit__graph-tools--head`; verify-control-ui-v3 **OK**     |
| Rollback   | restore `/root/.openbot/control-ui.bak-pre-knowledge-cockpit-polish-r24-20260808T233445Z` + baseline/pin bak then watch + podman cp                                                                      |
| Executor   | `cursor-grok`                                                                                                                                                                                            |
| Merge-back | Pending — knowledge cockpit polish (`e5345eeea5` / `8f08993f07`).                                                                                                                                        |

### Rollback

```bash
STAMP=20260808T233445Z
OVERLAY=knowledge-cockpit-polish-r24
BASE=/root/openbot-ui-baselines/v3.0
SERVED=/root/.openbot/control-ui
chattr -i "$BASE/pin.env" 2>/dev/null || true
rm -rf "$SERVED" "$BASE/control-ui"
cp -a "${SERVED}.bak-pre-${OVERLAY}-${STAMP}" "$SERVED"
cp -a "$BASE/control-ui.bak-pre-${OVERLAY}-${STAMP}" "$BASE/control-ui"
cp -a "$BASE/pin.env.bak-pre-${OVERLAY}-${STAMP}" "$BASE/pin.env"
bash "$BASE/watch-control-ui-v3-pin.sh" || true
podman exec openbot-gateway-rc sh -c 'rm -rf /app/dist/control-ui && mkdir -p /app/dist/control-ui'
podman cp "$SERVED/." openbot-gateway-rc:/app/dist/control-ui/
```

---

## Previous cutover (2026-08-09 ~07:20 CST) — Control UI: knowledge sources row-open + scrollable titles (`knowledge-library-row-open-r23`)

| Field      | Value                                                                                                                                                                                                      |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date       | 2026-08-09 (UI live ~07:20 CST / artifact `20260808T232004Z`)                                                                                                                                              |
| Decision   | 知识库来源列表：点击整行进入已索引片段阅读；去掉单独「查看」；名称最多展示 10 字（完整名在 tooltip）；表格可横向滚动。本地「打开原文件」保留为显式次要操作。                                               |
| Source     | `cursor/workbench-isolation-r6` @ `8b84308738` `pnpm ui:build` → `openbot-control-ui-knowledge-library-row-open-r23-20260808T232004Z.tar.gz` (`index-CE7Osj5o.js`, md5 `bd9dded4509402b17480fdc653491440`) |
| Build mode | Control UI overlay → served root + baseline + container embed（gateway dist 不变）                                                                                                                         |
| Container  | `openbot-gateway-rc`                                                                                                                                                                                       |
| Control UI | `index-CE7Osj5o.js`                                                                                                                                                                                        |
| Gateway    | unchanged `knowledge-source-open-folder-r11`                                                                                                                                                               |
| Pin        | `OPENBOT_UI_OVERLAY_PINNED_ENTRY=index-CE7Osj5o.js`；forbid includes prior `index-CSw50LWe.js`                                                                                                             |
| Smoke      | healthz **200**; readyz **ready:true**; www/gw/served/container → `index-CE7Osj5o.js`; no `data-testid="ku-doc-view"`; has `ku-library-ws__row--openable`; verify-control-ui-v3 **OK**                     |
| Rollback   | restore `/root/.openbot/control-ui.bak-pre-knowledge-library-row-open-r23-20260808T232004Z` + baseline/pin bak then watch + podman cp                                                                      |
| Executor   | `cursor-grok`                                                                                                                                                                                              |
| Merge-back | Pending — knowledge library row-open UX (`09f8704004` / `8b84308738`).                                                                                                                                     |

### Rollback

```bash
STAMP=20260808T232004Z
OVERLAY=knowledge-library-row-open-r23
BASE=/root/openbot-ui-baselines/v3.0
SERVED=/root/.openbot/control-ui
chattr -i "$BASE/pin.env" 2>/dev/null || true
rm -rf "$SERVED" "$BASE/control-ui"
cp -a "${SERVED}.bak-pre-${OVERLAY}-${STAMP}" "$SERVED"
cp -a "$BASE/control-ui.bak-pre-${OVERLAY}-${STAMP}" "$BASE/control-ui"
cp -a "$BASE/pin.env.bak-pre-${OVERLAY}-${STAMP}" "$BASE/pin.env"
bash "$BASE/watch-control-ui-v3-pin.sh" || true
podman exec openbot-gateway-rc sh -c 'rm -rf /app/dist/control-ui && mkdir -p /app/dist/control-ui'
podman cp "$SERVED/." openbot-gateway-rc:/app/dist/control-ui/
```

---

## Previous cutover (2026-08-09 ~07:10 CST) — Control UI: member-tool pending badge + governance actions (`member-gov-pending-badge-r22`)

| Field      | Value                                                                                                                                                                                                    |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date       | 2026-08-09 (UI live ~07:10 CST / artifact `20260808T231005Z`)                                                                                                                                            |
| Decision   | 去掉独立「待审批」按钮，待审批数角标打在协作成员管理按钮右上角；群主可移交管理权、机器人主人可同意/拒绝入组邀请（不再被只读成员角色挡住）、退出协作小组接线 leave/transfer API。                         |
| Source     | `cursor/workbench-isolation-r6` @ `dd57fd442e` `pnpm ui:build` → `openbot-control-ui-member-gov-pending-badge-r22-20260808T231005Z.tar.gz` (`index-CSw50LWe.js`, md5 `061ebeb0ef0e5e30ddfd39acb49a3624`) |
| Build mode | Control UI overlay → served root + baseline + container embed（跳过会换镜像的 watch fallback）                                                                                                           |
| Container  | `openbot-gateway-rc`                                                                                                                                                                                     |
| Control UI | `index-CSw50LWe.js`                                                                                                                                                                                      |
| Gateway    | unchanged `knowledge-source-open-folder-r11`                                                                                                                                                             |
| Pin        | `OPENBOT_UI_OVERLAY_PINNED_ENTRY=index-CSw50LWe.js`；forbid includes prior `index-l6FX5kx2.js`                                                                                                           |
| Smoke      | healthz **200**; readyz **ready:true**; www/served/container → `index-CSw50LWe.js`; CSS `stage-collaboration-tool-badge`; verify-control-ui-v3 **OK**                                                    |
| Rollback   | restore `/root/.openbot/control-ui.bak-pre-member-gov-pending-badge-r22-20260808T231005Z` + pin bak then podman cp                                                                                       |
| Executor   | `cursor-composer`                                                                                                                                                                                        |
| Merge-back | Pending — member governance pending badge + actions (`4b780fa442` / `dd57fd442e`).                                                                                                                       |

### Rollback

```bash
STAMP=20260808T231005Z
OVERLAY=member-gov-pending-badge-r22
BASE=/root/openbot-ui-baselines/v3.0
SERVED=/root/.openbot/control-ui
chattr -i "$BASE/pin.env" 2>/dev/null || true
rm -rf "$SERVED" "$BASE/control-ui"
cp -a "${SERVED}.bak-pre-${OVERLAY}-${STAMP}" "$SERVED"
cp -a "$BASE/control-ui.bak-pre-${OVERLAY}-${STAMP}" "$BASE/control-ui" 2>/dev/null || true
cp -a "$BASE/pin.env.bak-pre-${OVERLAY}-${STAMP}" "$BASE/pin.env"
podman exec openbot-gateway-rc sh -c 'rm -rf /app/dist/control-ui && mkdir -p /app/dist/control-ui'
podman cp "$SERVED/." openbot-gateway-rc:/app/dist/control-ui/
```

---

## Previous cutover (2026-08-09 ~06:49 CST) — Control UI: group settings members table + governance columns (`group-settings-layout-r21`)

| Field      | Value                                                                                                                                                                                                 |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date       | 2026-08-09 (UI live ~06:49 CST / artifact `20260808T224857Z`)                                                                                                                                         |
| Decision   | 协作小组详情下半：成员列表补全表格样式（表头/列宽/行分隔）；群治理「决策 / 保密与可见 / 协作规则」改为横向三栏，危险操作通栏。                                                                        |
| Source     | `cursor/workbench-isolation-r6` @ `f63fc4c568` `pnpm ui:build` → `openbot-control-ui-group-settings-layout-r21-20260808T224857Z.tar.gz` (`index-l6FX5kx2.js`, md5 `00c142e1e30c6f081817b664db835d61`) |
| Build mode | Control UI overlay → served root + baseline + container embed（跳过会换镜像的 watch fallback）                                                                                                        |
| Container  | `openbot-gateway-rc`                                                                                                                                                                                  |
| Control UI | `index-l6FX5kx2.js`                                                                                                                                                                                   |
| Gateway    | unchanged `knowledge-source-open-folder-r11`                                                                                                                                                          |
| Pin        | `OPENBOT_UI_OVERLAY_PINNED_ENTRY=index-l6FX5kx2.js`；forbid includes prior `index-D7ipOMcG.js`                                                                                                        |
| Smoke      | healthz **200**; readyz **ready:true**; www → `index-l6FX5kx2.js`; CSS `group-members-table` + `governance-grid{…repeat(3,…)}`                                                                        |
| Rollback   | restore `/root/.openbot/control-ui.bak-pre-group-settings-layout-r21-20260808T224857Z` + pin bak then podman cp                                                                                       |
| Executor   | `cursor-composer`                                                                                                                                                                                     |
| Merge-back | Pending — group settings layout (`b39b259b30` / `f63fc4c568`).                                                                                                                                        |

### Rollback

```bash
STAMP=20260808T224857Z
OVERLAY=group-settings-layout-r21
BASE=/root/openbot-ui-baselines/v3.0
SERVED=/root/.openbot/control-ui
chattr -i "$BASE/pin.env" 2>/dev/null || true
rm -rf "$SERVED" "$BASE/control-ui"
cp -a "${SERVED}.bak-pre-${OVERLAY}-${STAMP}" "$SERVED"
cp -a "$BASE/control-ui.bak-pre-${OVERLAY}-${STAMP}" "$BASE/control-ui" 2>/dev/null || true
cp -a "$BASE/pin.env.bak-pre-${OVERLAY}-${STAMP}" "$BASE/pin.env"
podman exec openbot-gateway-rc sh -c 'rm -rf /app/dist/control-ui && mkdir -p /app/dist/control-ui'
podman cp "$SERVED/." openbot-gateway-rc:/app/dist/control-ui/
```

---

## Previous cutover (2026-08-08 ~22:21 CST) — Control UI: collaboration composer docks to viewport bottom (`collab-composer-dock-r20`)

| Field      | Value                                                                                                                                                                                                |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date       | 2026-08-08 (UI live ~22:21 CST / artifact `20260808T141753Z`)                                                                                                                                        |
| Decision   | 协作空间输入框相对内容贴底、下方大片空白；将 `collaboration-stage-main` grid 改为与首页 `assistant-stage` 一致的单行 `minmax(0,1fr)`，使 `.chat-compose` sticky 贴视口底。                           |
| Source     | `cursor/workbench-isolation-r6` @ `c4ef101b4b` `pnpm ui:build` → `openbot-control-ui-collab-composer-dock-r20-20260808T141753Z.tar.gz` (`index-D7ipOMcG.js`, md5 `d5cffce5aeb0f5a402af445f1e6a3c58`) |
| Build mode | Control UI overlay → served root + baseline + container embed（跳过会换镜像的 watch fallback）                                                                                                       |
| Container  | `openbot-gateway-rc`                                                                                                                                                                                 |
| Control UI | `index-D7ipOMcG.js`                                                                                                                                                                                  |
| Gateway    | unchanged concurrent overlay `knowledge-source-open-folder-r11`                                                                                                                                      |
| Pin        | `OPENBOT_UI_OVERLAY_PINNED_ENTRY=index-D7ipOMcG.js`；forbid includes prior `index-DZONkRtu.js` / `index-dT5IBYuo.js`                                                                                 |
| Smoke      | healthz **200**; readyz **ready:true**; www → `index-D7ipOMcG.js`; CSS `collaboration-stage-main{…grid-template-rows:minmax(0,1fr)…}`                                                                |
| Rollback   | restore `/root/.openbot/control-ui.bak-pre-collab-composer-dock-r20-20260808T141753Z-reapply` + pin bak then podman cp                                                                               |
| Executor   | `cursor-composer`                                                                                                                                                                                    |
| Merge-back | Pending — collaboration composer viewport dock (`c4ef101b4b`).                                                                                                                                       |
| Note       | 2026-08-09 06:36 重新钉回本 UI（此前误钉 `index-DZONkRtu.js`）；Gateway 仍为 `knowledge-source-open-folder-r11`（含 `knowledge.connector.unbind`）。                                                 |

### Rollback

```bash
STAMP=20260808T141753Z
OVERLAY=collab-composer-dock-r20
BASE=/root/openbot-ui-baselines/v3.0
SERVED=/root/.openbot/control-ui
chattr -i "$BASE/pin.env" 2>/dev/null || true
rm -rf "$SERVED" "$BASE/control-ui"
cp -a "${SERVED}.bak-pre-${OVERLAY}-${STAMP}-reapply" "$SERVED"
cp -a "$BASE/control-ui.bak-pre-${OVERLAY}-${STAMP}-reapply" "$BASE/control-ui"
cp -a "$BASE/pin.env.bak-pre-${OVERLAY}-${STAMP}-reapply" "$BASE/pin.env"
podman exec openbot-gateway-rc sh -c 'rm -rf /app/dist/control-ui && mkdir -p /app/dist/control-ui'
podman cp "$SERVED/." openbot-gateway-rc:/app/dist/control-ui/
```

---

## Previous cutover (2026-08-08 ~22:21 CST) — Control UI + Gateway: knowledge source open/unbind (`knowledge-source-open-folder-r11`)

| Field      | Value                                                                                                                                                                                                                                                                                                                         |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date       | 2026-08-08 (live ~22:21 CST / artifact `20260808T140244Z`)                                                                                                                                                                                                                                                                    |
| Decision   | 修复知识库来源表删除失败：注册 `knowledge.connector.unbind` 等 RPC；`knowledge.source.unbind` 按 KB write 授权；UI 先 `source.unbind` 再尽力 purge；本地文件夹可打开原文件。                                                                                                                                                  |
| Source     | `cursor/workbench-isolation-r6` @ `de436d4358` → UI `openbot-control-ui-knowledge-source-open-folder-r11-20260808T140244Z.tar.gz` (`index-DZONkRtu.js`, md5 `eff68747af45a1ad5a391c9d829dacac`) + GW `openbot-gateway-dist-knowledge-source-open-folder-r11-20260808T140244Z.tar.gz` (md5 `d3122a52d8b9eaee0cf3ab1d7aab80e0`) |
| Build mode | Gateway dist overlay（exclude control-ui，再嵌入当前 UI）+ Control UI overlay                                                                                                                                                                                                                                                 |
| Container  | `openbot-gateway-rc`                                                                                                                                                                                                                                                                                                          |
| Control UI | was `index-DZONkRtu.js`；superseded by `collab-composer-dock-r20` (`index-D7ipOMcG.js`)                                                                                                                                                                                                                                       |
| Gateway    | overlay `knowledge-source-open-folder-r11` (`knowledge.connector.unbind` / local-folder open)                                                                                                                                                                                                                                 |
| Pin        | was `OPENBOT_UI_OVERLAY_PINNED_ENTRY=index-DZONkRtu.js`；forbid prior `index-dT5IBYuo.js` + older pins                                                                                                                                                                                                                        |
| Smoke      | healthz **200**; readyz **ready:true**; www/gw/served/container → `index-DZONkRtu.js`（切流当时）；verify-control-ui-v3 **OK**; markers `knowledge.connector.unbind` in `gateway-cli-*.js` + UI entry                                                                                                                         |
| Rollback   | restore `/root/.openbot/control-ui.bak-pre-knowledge-source-open-folder-r11-20260808T140244Z` (+ baseline/pin bak if present) then watch + podman cp; GW: restore maintenance tgz if present                                                                                                                                  |
| Executor   | `cursor-composer`                                                                                                                                                                                                                                                                                                             |
| Merge-back | Pending — knowledge connector unbind + source.unbind-first + open original (`5a96287b74` / `de436d4358`).                                                                                                                                                                                                                     |
| Note       | SSH 经 Clash Verge TUN 时 KEX 易超时；部署期临时 `mode=direct`，完成后恢复 `rule`。UI 随后被 `collab-composer-dock-r20` 覆盖。                                                                                                                                                                                                |

### Rollback

```bash
STAMP=20260808T140244Z
OVERLAY=knowledge-source-open-folder-r11
BASE=/root/openbot-ui-baselines/v3.0
SERVED=/root/.openbot/control-ui
chattr -i "$BASE/pin.env" 2>/dev/null || true
# UI
if [ -d "${SERVED}.bak-pre-${OVERLAY}-${STAMP}" ]; then
  rm -rf "$SERVED" "$BASE/control-ui"
  cp -a "${SERVED}.bak-pre-${OVERLAY}-${STAMP}" "$SERVED"
  cp -a "$BASE/control-ui.bak-pre-${OVERLAY}-${STAMP}" "$BASE/control-ui" 2>/dev/null || true
  cp -a "$BASE/pin.env.bak-pre-${OVERLAY}-${STAMP}" "$BASE/pin.env" 2>/dev/null || true
  bash "$BASE/watch-control-ui-v3-pin.sh"
  podman exec openbot-gateway-rc sh -c 'rm -rf /app/dist/control-ui && mkdir -p /app/dist/control-ui'
  podman cp "$SERVED/." openbot-gateway-rc:/app/dist/control-ui/
fi
# GW (if maintenance bak exists)
BK=/root/openbot-maintenance-${OVERLAY}-${STAMP}
if [ -f "$BK/container-app-dist.before.tgz" ]; then
  mkdir -p /tmp/gw-dist-rollback && rm -rf /tmp/gw-dist-rollback/*
  tar xzf "$BK/container-app-dist.before.tgz" -C /tmp/gw-dist-rollback
  podman exec openbot-gateway-rc sh -c 'rm -rf /app/dist && mkdir -p /app/dist'
  podman cp /tmp/gw-dist-rollback/dist/. openbot-gateway-rc:/app/dist/
  podman exec openbot-gateway-rc sh -c 'rm -rf /app/dist/control-ui && mkdir -p /app/dist/control-ui'
  podman cp "$SERVED/." openbot-gateway-rc:/app/dist/control-ui/
  podman restart openbot-gateway-rc
fi
```

---

## Previous cutover (2026-08-08 ~22:20 CST) — Knowledge: open local originals + connector unbind + section folder create (`knowledge-source-open-folder-r11`)

| Field      | Value                                                                                                                                                                                                                                                                                                                         |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date       | 2026-08-08 (live ~22:20 CST / artifact `20260808T140244Z`)                                                                                                                                                                                                                                                                    |
| Decision   | (1) Gateway：`knowledge.connector.bind/unbind` + local-folder 打开原文。(2) UI：知识库来源解绑/打开行、cockpit 分区「+」区内联建文件夹并进入重命名。(3) i18n 文案。                                                                                                                                                           |
| Source     | `cursor/workbench-isolation-r6` @ `de436d4358` → UI `openbot-control-ui-knowledge-source-open-folder-r11-20260808T140244Z.tar.gz` (`index-DZONkRtu.js`, md5 `eff68747af45a1ad5a391c9d829dacac`) + GW `openbot-gateway-dist-knowledge-source-open-folder-r11-20260808T140244Z.tar.gz` (md5 `d3122a52d8b9eaee0cf3ab1d7aab80e0`) |
| Build mode | Gateway dist overlay（exclude control-ui，再嵌入当前 UI）+ Control UI overlay                                                                                                                                                                                                                                                 |
| Container  | `openbot-gateway-rc`                                                                                                                                                                                                                                                                                                          |
| Control UI | `index-DZONkRtu.js`                                                                                                                                                                                                                                                                                                           |
| Gateway    | overlay `knowledge-source-open-folder-r11`                                                                                                                                                                                                                                                                                    |
| Pin        | `OPENBOT_UI_OVERLAY_PINNED_ENTRY=index-DZONkRtu.js`                                                                                                                                                                                                                                                                           |
| Smoke      | healthz **200**; readyz **ready:true**; www/gw → `index-DZONkRtu.js`; verify-control-ui-v3 **OK**; markers `knowledge.connector.unbind` / `openLocalFolderDocument` / `ku-cockpit-tree-add-*`                                                                                                                                 |
| Rollback   | restore `/root/openbot-maintenance-knowledge-source-open-folder-r11-20260808T140244Z/container-app-dist.before.tgz` + UI bak `knowledge-source-open-folder-r11`                                                                                                                                                               |
| Executor   | `cursor-grok`                                                                                                                                                                                                                                                                                                                 |
| Merge-back | Pending — knowledge open/unbind + section folder create.                                                                                                                                                                                                                                                                      |

### Rollback

```bash
STAMP=20260808T140244Z
OVERLAY=knowledge-source-open-folder-r11
UI_OVERLAY=knowledge-source-open-folder-r11
BK=/root/openbot-maintenance-${OVERLAY}-${STAMP}
BASE=/root/openbot-ui-baselines/v3.0
SERVED=/root/.openbot/control-ui
mkdir -p /tmp/gw-dist-rollback && rm -rf /tmp/gw-dist-rollback/*
tar xzf "$BK/container-app-dist.before.tgz" -C /tmp/gw-dist-rollback
podman exec openbot-gateway-rc sh -c 'rm -rf /app/dist && mkdir -p /app/dist'
podman cp /tmp/gw-dist-rollback/dist/. openbot-gateway-rc:/app/dist/
chattr -i "$BASE/pin.env" 2>/dev/null || true
rm -rf "$SERVED" "$BASE/control-ui"
cp -a "${SERVED}.bak-pre-${UI_OVERLAY}-${STAMP}" "$SERVED"
cp -a "$BASE/control-ui.bak-pre-${UI_OVERLAY}-${STAMP}" "$BASE/control-ui"
cp -a "$BASE/pin.env.bak-pre-${UI_OVERLAY}-${STAMP}" "$BASE/pin.env"
bash "$BASE/watch-control-ui-v3-pin.sh"
podman restart openbot-gateway-rc
```

---

## Previous cutover (2026-08-08 ~21:53 CST) — Gateway: collaboration chat write ACL fail-closed (`collab-chat-acl-failclosed-r19`)

| Field      | Value                                                                                                                                                                                                                             |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date       | 2026-08-08 (GW live ~21:53 CST / artifact `20260808T135051Z`)                                                                                                                                                                     |
| Decision   | PR #316：协作群 `chat.send` 写 ACL fail-closed——catalog 找不到 space 一律拒绝（含 platform）；`listGatewayCollaborationSpaces()` 抛错拒绝并 `logGateway.warn`；继续复用 roster 可见性谓词。                                       |
| Source     | `origin/main` @ `70e6b199a01ce7d1f809376e135cf33aac584207`（含 `ac557ebd9e` / `80f8b232cb`）清洁 archive → `openbot-gateway-dist-collab-chat-acl-failclosed-r19-20260808T135051Z.tar.gz` (md5 `c68ce092ef9befe5a22fe6365ed67f42`) |
| Build mode | Gateway dist overlay（UI pin 保持 `index-dT5IBYuo.js`，切流后 re-embed）                                                                                                                                                          |
| Container  | `openbot-gateway-rc`                                                                                                                                                                                                              |
| Control UI | unchanged `index-dT5IBYuo.js`                                                                                                                                                                                                     |
| Gateway    | overlay `collab-chat-acl-failclosed-r19` (`resolveCollaborationGroupWriteDenial`)                                                                                                                                                 |
| Pin        | unchanged `OPENBOT_UI_OVERLAY_PINNED_ENTRY=index-dT5IBYuo.js`                                                                                                                                                                     |
| Smoke      | healthz **200**; readyz **ready:true**; www → `index-dT5IBYuo.js`; watch-control-ui-v3 **OK**; markers `unknown collaboration space` / `failed to resolve collaboration space permissions` in `gateway-cli-*.js`                  |
| Rollback   | restore `/root/openbot-maintenance-collab-chat-acl-failclosed-r19-20260808T135051Z/container-app-dist.before.tgz` then re-embed current served UI + restart                                                                       |
| Executor   | `cursor-composer`                                                                                                                                                                                                                 |
| Merge-back | Landed via PR #316 → `main` @ `70e6b199a0`                                                                                                                                                                                        |

### Rollback

```bash
STAMP=20260808T135051Z
OVERLAY=collab-chat-acl-failclosed-r19
BK=/root/openbot-maintenance-${OVERLAY}-${STAMP}
SERVED=/root/.openbot/control-ui
mkdir -p /tmp/gw-dist-rollback && rm -rf /tmp/gw-dist-rollback/*
tar xzf "$BK/container-app-dist.before.tgz" -C /tmp/gw-dist-rollback
podman exec openbot-gateway-rc sh -c 'rm -rf /app/dist && mkdir -p /app/dist'
podman cp /tmp/gw-dist-rollback/dist/. openbot-gateway-rc:/app/dist/
podman exec openbot-gateway-rc sh -c 'rm -rf /app/dist/control-ui && mkdir -p /app/dist/control-ui'
podman cp "$SERVED/." openbot-gateway-rc:/app/dist/control-ui/
podman restart openbot-gateway-rc
```

---

## Previous cutover (2026-08-08 ~21:51 CST) — Control UI: member-governance invite in-flight scoped to one row (`member-gov-invite-inflight-r19`)

| Field      | Value                                                                                                                                                                                                      |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date       | 2026-08-08 (UI live ~21:51 CST / artifact `20260808T135051Z`)                                                                                                                                              |
| Decision   | 邀请进行中时原先禁用整列按钮，被误认为「所有邀请都在发出」；改为仅当前行 `邀请中…`，成功条 sticky 可见，兄弟行点击提示等待。                                                                               |
| Source     | `cursor/workbench-isolation-r6` @ `69b07491c6` `pnpm ui:build` → `openbot-control-ui-member-gov-invite-inflight-r19-20260808T135051Z.tar.gz` (`index-dT5IBYuo.js`, md5 `a61f925f354b9b5a8699c79fc2d86022`) |
| Build mode | Control UI overlay → served root + baseline + container embed（gateway 随后被 `collab-chat-acl-failclosed-r19` 覆盖）                                                                                      |
| Container  | `openbot-gateway-rc`                                                                                                                                                                                       |
| Control UI | `index-dT5IBYuo.js`                                                                                                                                                                                        |
| Gateway    | was `collab-space-authority-r17` at UI cutover; superseded by `collab-chat-acl-failclosed-r19`                                                                                                             |
| Pin        | `OPENBOT_UI_OVERLAY_PINNED_ENTRY=index-dT5IBYuo.js`；forbid includes prior `index-DmRoB1xt.js`                                                                                                             |
| Smoke      | healthz **200**; gw → `index-dT5IBYuo.js`; verify-control-ui-v3 **OK**; bundle has `aria-busy` + wait-hint copy                                                                                            |
| Rollback   | restore `/root/.openbot/control-ui.bak-pre-member-gov-invite-inflight-r19-20260808T135051Z` + baseline/pin bak then watch + podman cp                                                                      |
| Executor   | `cursor-grok`                                                                                                                                                                                              |
| Merge-back | Pending — member governance invite in-flight UX.                                                                                                                                                           |

### Rollback

```bash
STAMP=20260808T135051Z
OVERLAY=member-gov-invite-inflight-r19
BASE=/root/openbot-ui-baselines/v3.0
SERVED=/root/.openbot/control-ui
chattr -i "$BASE/pin.env" 2>/dev/null || true
rm -rf "$SERVED" "$BASE/control-ui"
cp -a "${SERVED}.bak-pre-${OVERLAY}-${STAMP}" "$SERVED"
cp -a "$BASE/control-ui.bak-pre-${OVERLAY}-${STAMP}" "$BASE/control-ui"
cp -a "$BASE/pin.env.bak-pre-${OVERLAY}-${STAMP}" "$BASE/pin.env"
bash "$BASE/watch-control-ui-v3-pin.sh"
podman exec openbot-gateway-rc sh -c 'rm -rf /app/dist/control-ui && mkdir -p /app/dist/control-ui'
podman cp "$SERVED/." openbot-gateway-rc:/app/dist/control-ui/
```

---

## Previous cutover (2026-08-08 ~21:16 CST) — Control UI: member-governance bot name column fix (`member-gov-bot-name-r18`)

| Field      | Value                                                                                                                                                                                |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Date       | 2026-08-08 (UI live ~21:16 CST / artifact `20260808T131557Z`)                                                                                                                        |
| Decision   | 邀请机器人候选行去掉复选框后仍占三列网格，名称被挤成「大..」；改为 identity\|action 两列，并收紧成员管理侧栏标题/芯片/分区边框。                                                     |
| Source     | `cursor/workbench-isolation-r6` `pnpm ui:build` → `openbot-control-ui-member-gov-bot-name-r18-20260808T131557Z.tar.gz` (`index-DmRoB1xt.js`, md5 `ac0d2a6efec7af0eeb16a9402be13737`) |
| Build mode | Control UI overlay → served root + baseline + container embed（gateway dist 不变）                                                                                                   |
| Container  | `openbot-gateway-rc`                                                                                                                                                                 |
| Control UI | `index-DmRoB1xt.js`                                                                                                                                                                  |
| Gateway    | unchanged overlay `collab-space-authority-r17`                                                                                                                                       |
| Pin        | `OPENBOT_UI_OVERLAY_PINNED_ENTRY=index-DmRoB1xt.js`；forbid includes prior `index-DwFKrLSy.js` / `index-BXJtcwuP.js`                                                                 |
| Smoke      | healthz **200**; www/gw → `index-DmRoB1xt.js`; verify-control-ui-v3 **OK**; css has `candidate--bot{grid-template-columns:minmax(0,1fr) auto}`                                       |
| Rollback   | restore `/root/.openbot/control-ui.bak-pre-member-gov-bot-name-r18-20260808T131557Z` + baseline/pin bak then watch + podman cp                                                       |
| Executor   | `cursor-composer`                                                                                                                                                                    |
| Merge-back | Pending — member governance bot name polish.                                                                                                                                         |

### Rollback

```bash
STAMP=20260808T131557Z
OVERLAY=member-gov-bot-name-r18
BASE=/root/openbot-ui-baselines/v3.0
SERVED=/root/.openbot/control-ui
chattr -i "$BASE/pin.env" 2>/dev/null || true
rm -rf "$SERVED" "$BASE/control-ui"
cp -a "${SERVED}.bak-pre-${OVERLAY}-${STAMP}" "$SERVED"
cp -a "$BASE/control-ui.bak-pre-${OVERLAY}-${STAMP}" "$BASE/control-ui"
cp -a "$BASE/pin.env.bak-pre-${OVERLAY}-${STAMP}" "$BASE/pin.env"
bash "$BASE/watch-control-ui-v3-pin.sh"
podman exec openbot-gateway-rc sh -c 'rm -rf /app/dist/control-ui && mkdir -p /app/dist/control-ui'
podman cp "$SERVED/." openbot-gateway-rc:/app/dist/control-ui/
```

---

## Previous cutover (2026-08-08 ~20:53 CST) — Control UI + Gateway: collaboration space authority convergence (`collab-space-authority-r17`)

| Field      | Value                                                                                                                                                                                                                                                                                                             |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date       | 2026-08-08 (UI+GW live ~20:53 CST / artifact `20260808T125113Z`)                                                                                                                                                                                                                                                  |
| Decision   | 协作小组 roster 与 seat 权威分离：`visibleSpaceIds` 由 roster 成员谓词派生；个人工作台未知 group 写会话 fail-closed；runtime-first 成员读取；userId/email/handle 身份对齐；bootstrap「群主」行可重建。                                                                                                            |
| Source     | `cursor/workbench-isolation-r6` @ `64446f5243` → GW `openbot-gateway-dist-collab-space-authority-r17-20260808T125113Z.tar.gz` (md5 `895dd2c99ff3295c56da660f4e5178b6`) + UI `openbot-control-ui-collab-space-authority-r17-20260808T125113Z.tar.gz` (`index-DwFKrLSy.js`, md5 `ce3ffedc69c501aa7f7375946c05a562`) |
| Build mode | Gateway dist overlay + Control UI overlay（pin 同步 re-embed）                                                                                                                                                                                                                                                    |
| Container  | `openbot-gateway-rc`                                                                                                                                                                                                                                                                                              |
| Control UI | `index-DwFKrLSy.js`                                                                                                                                                                                                                                                                                               |
| Gateway    | overlay `collab-space-authority-r17` (`collectVisibleCollaborationSpaceIdsForActor`)                                                                                                                                                                                                                              |
| Pin        | `OPENBOT_UI_OVERLAY_PINNED_ENTRY=index-DwFKrLSy.js`；forbid includes prior `index-BXJtcwuP.js` / `index-DHfaRCLX.js`                                                                                                                                                                                              |
| Smoke      | healthz **200**; readyz **ready:true**; www/gw → `index-DwFKrLSy.js`; verify-control-ui-v3 **OK**; build-info overlay `collab-space-authority-r17`; markers `collectVisibleCollaborationSpaceIdsForActor` / `unknown collaboration space`                                                                         |
| Rollback   | restore `/root/openbot-maintenance-collab-space-authority-r17-20260808T125113Z/container-app-dist.before.tgz` + UI/pin bak then restart                                                                                                                                                                           |
| Executor   | `cursor-composer`                                                                                                                                                                                                                                                                                                 |
| Merge-back | Pending — collaboration space authority convergence.                                                                                                                                                                                                                                                              |

### Rollback

```bash
STAMP=20260808T125113Z
OVERLAY=collab-space-authority-r17
BK=/root/openbot-maintenance-${OVERLAY}-${STAMP}
BASE=/root/openbot-ui-baselines/v3.0
SERVED=/root/.openbot/control-ui
mkdir -p /tmp/gw-dist-rollback && rm -rf /tmp/gw-dist-rollback/*
tar xzf "$BK/container-app-dist.before.tgz" -C /tmp/gw-dist-rollback
podman exec openbot-gateway-rc sh -c 'rm -rf /app/dist && mkdir -p /app/dist'
podman cp /tmp/gw-dist-rollback/dist/. openbot-gateway-rc:/app/dist/
chattr -i "$BASE/pin.env" 2>/dev/null || true
rm -rf "$SERVED" "$BASE/control-ui"
cp -a "${SERVED}.bak-pre-${OVERLAY}-${STAMP}" "$SERVED"
cp -a "$BASE/control-ui.bak-pre-${OVERLAY}-${STAMP}" "$BASE/control-ui"
cp -a "$BASE/pin.env.bak-pre-${OVERLAY}-${STAMP}" "$BASE/pin.env"
bash "$BASE/watch-control-ui-v3-pin.sh"
podman restart openbot-gateway-rc
```

---

## Previous cutover (2026-08-08 ~20:47 CST) — Control UI: space creator polish + group settings chrome (`space-creator-polish-r16`)

| Field      | Value                                                                                                                                                                                 |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date       | 2026-08-08 (UI live ~20:47 CST / artifact `20260808T124331Z`)                                                                                                                         |
| Decision   | 新建协作空间去掉冗余「每日概览 / 返回协作空间 / 协作空间」标题；创建页字号与扁平面板对齐工作台；小组设置顶栏去掉「未保存修改 / 进入小组」，管理成员走成员治理面板。                   |
| Source     | `cursor/workbench-isolation-r6` `pnpm ui:build` → `openbot-control-ui-space-creator-polish-r16-20260808T124331Z.tar.gz` (`index-BXJtcwuP.js`, md5 `0e568db736fc5764fae66ee877003574`) |
| Build mode | Control UI overlay → served root + baseline + container embed（gateway dist 不变）                                                                                                    |
| Container  | `openbot-gateway-rc`                                                                                                                                                                  |
| Control UI | `index-BXJtcwuP.js`                                                                                                                                                                   |
| Gateway    | unchanged overlay `group-invite-seat-r14`                                                                                                                                             |
| Pin        | `OPENBOT_UI_OVERLAY_PINNED_ENTRY=index-BXJtcwuP.js`；forbid includes prior `index-DHfaRCLX.js` / `index-YqXu9z1b.js`                                                                  |
| Smoke      | healthz **200**; www/gw → `index-BXJtcwuP.js`; verify-control-ui-v3 **OK**; css marker `creator-panel--flat` in `workbench-CnzC_wUk.css`                                              |
| Rollback   | restore `/root/.openbot/control-ui.bak-pre-space-creator-polish-r16-20260808T124331Z` + baseline/pin bak then watch + podman cp                                                       |
| Executor   | `cursor-composer`                                                                                                                                                                     |
| Merge-back | Pending — space creator / settings chrome polish.                                                                                                                                     |

### Rollback

```bash
STAMP=20260808T124331Z
OVERLAY=space-creator-polish-r16
BASE=/root/openbot-ui-baselines/v3.0
SERVED=/root/.openbot/control-ui
chattr -i "$BASE/pin.env" 2>/dev/null || true
rm -rf "$SERVED" "$BASE/control-ui"
cp -a "${SERVED}.bak-pre-${OVERLAY}-${STAMP}" "$SERVED"
cp -a "$BASE/control-ui.bak-pre-${OVERLAY}-${STAMP}" "$BASE/control-ui"
cp -a "$BASE/pin.env.bak-pre-${OVERLAY}-${STAMP}" "$BASE/pin.env"
bash "$BASE/watch-control-ui-v3-pin.sh"
podman exec openbot-gateway-rc sh -c 'rm -rf /app/dist/control-ui && mkdir -p /app/dist/control-ui'
podman cp "$SERVED/." openbot-gateway-rc:/app/dist/control-ui/
```

---

## Previous cutover (2026-08-08 ~19:27 CST) — Control UI: stop stretching groups/bots left-list rows (`groups-anchor-no-stretch-r15`)

| Field      | Value                                                                                                                                                                                     |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date       | 2026-08-08 (UI live ~19:27 CST / artifact `20260808T112716Z`)                                                                                                                             |
| Decision   | 左栏锚点列表加 `align-content:start`，禁止 grid 行被右栏高度纵向拉伸；协作小组选中行高与机器人列表对齐。                                                                                  |
| Source     | `cursor/workbench-isolation-r6` `pnpm ui:build` → `openbot-control-ui-groups-anchor-no-stretch-r15-20260808T112716Z.tar.gz` (`index-DHfaRCLX.js`, md5 `e66f1b1cdc8d1ac62e4a8df0fd140fdd`) |
| Build mode | Control UI overlay → served root + baseline + container embed（gateway dist 不变）                                                                                                        |
| Container  | `openbot-gateway-rc`                                                                                                                                                                      |
| Control UI | `index-DHfaRCLX.js`                                                                                                                                                                       |
| Gateway    | unchanged overlay `group-invite-seat-r14`                                                                                                                                                 |
| Pin        | `OPENBOT_UI_OVERLAY_PINNED_ENTRY=index-DHfaRCLX.js`；forbid includes prior `index-YqXu9z1b.js` / `index-FHpdazL9.js`                                                                      |
| Smoke      | healthz **200**; www/gw → `index-DHfaRCLX.js`; verify-control-ui-v3 **OK**; workbench css has `align-content:start` on anchor lists                                                       |
| Rollback   | restore `/root/.openbot/control-ui.bak-pre-groups-anchor-no-stretch-r15-20260808T112716Z` + baseline/pin bak then watch + podman cp                                                       |
| Executor   | `cursor-composer`                                                                                                                                                                         |
| Merge-back | Pending — anchor list row stretch fix.                                                                                                                                                    |

### Rollback

```bash
STAMP=20260808T112716Z
OVERLAY=groups-anchor-no-stretch-r15
BASE=/root/openbot-ui-baselines/v3.0
SERVED=/root/.openbot/control-ui
chattr -i "$BASE/pin.env" 2>/dev/null || true
rm -rf "$SERVED" "$BASE/control-ui"
cp -a "${SERVED}.bak-pre-${OVERLAY}-${STAMP}" "$SERVED"
cp -a "$BASE/control-ui.bak-pre-${OVERLAY}-${STAMP}" "$BASE/control-ui"
cp -a "$BASE/pin.env.bak-pre-${OVERLAY}-${STAMP}" "$BASE/pin.env"
bash "$BASE/watch-control-ui-v3-pin.sh"
podman exec openbot-gateway-rc sh -c 'rm -rf /app/dist/control-ui && mkdir -p /app/dist/control-ui'
podman cp "$SERVED/." openbot-gateway-rc:/app/dist/control-ui/
```

---

## Previous cutover (2026-08-08 ~19:18 CST) — Control UI + Gateway: group invite seat payload + bot selector dedupe (`group-invite-seat-r14`)

| Field      | Value                                                                                                                                                                                                                                                                                  |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date       | 2026-08-08 (UI live ~17:35 CST / GW live ~19:18 CST / artifact `20260808T093629Z`)                                                                                                                                                                                                     |
| Decision   | 成员治理邀请补齐 `ownerPositionId`；网关对已绑定小组复用既有 seat；机器人选择器去掉底部批量「发送邀请」，仅保留行内邀请/确认加入。                                                                                                                                                     |
| Source     | `cursor/workbench-isolation-r6` UI `openbot-control-ui-group-invite-seat-r14-20260808T093305Z.tar.gz` (`index-YqXu9z1b.js`, md5 `6a22709ab8f9c3aa8cbef666dff522a5`) + GW `openbot-gateway-dist-group-invite-seat-r14-20260808T093629Z.tar.gz` (md5 `ffcb87864927d9f3de8811888661d314`) |
| Build mode | Control UI overlay + Gateway dist overlay（exclude/re-embed pinned control-ui）                                                                                                                                                                                                        |
| Container  | `openbot-gateway-rc`                                                                                                                                                                                                                                                                   |
| Control UI | `index-YqXu9z1b.js`                                                                                                                                                                                                                                                                    |
| Gateway    | overlay `group-invite-seat-r14` (`resolveExistingSpaceSeatId`)                                                                                                                                                                                                                         |
| Pin        | `OPENBOT_UI_OVERLAY_PINNED_ENTRY=index-YqXu9z1b.js`；forbid includes prior `index-FHpdazL9.js` / `index-Cch7fHgC.js`                                                                                                                                                                   |
| Smoke      | healthz **200**; readyz **ready:true**; www/gw/served/container → `index-YqXu9z1b.js`; verify-control-ui-v3 **OK**; build-info overlay `group-invite-seat-r14`; marker `resolveExistingSpaceSeatId`                                                                                    |
| Rollback   | restore `/root/openbot-maintenance-group-invite-seat-r14-20260808T093629Z/container-app-dist.before.tgz` + UI bak `group-invite-seat-r14` then restart                                                                                                                                 |
| Executor   | `cursor-composer`                                                                                                                                                                                                                                                                      |
| Merge-back | Pending — invite seat payload + bot selector dedupe + seat reuse.                                                                                                                                                                                                                      |

### Rollback

```bash
STAMP=20260808T093629Z
OVERLAY=group-invite-seat-r14
UI_OVERLAY=group-invite-seat-r14
BK=/root/openbot-maintenance-${OVERLAY}-${STAMP}
BASE=/root/openbot-ui-baselines/v3.0
SERVED=/root/.openbot/control-ui
mkdir -p /tmp/gw-dist-rollback && rm -rf /tmp/gw-dist-rollback/*
tar xzf "$BK/container-app-dist.before.tgz" -C /tmp/gw-dist-rollback
podman exec openbot-gateway-rc sh -c 'rm -rf /app/dist && mkdir -p /app/dist'
podman cp /tmp/gw-dist-rollback/dist/. openbot-gateway-rc:/app/dist/
chattr -i "$BASE/pin.env" 2>/dev/null || true
rm -rf "$SERVED" "$BASE/control-ui"
cp -a "${SERVED}.bak-pre-${UI_OVERLAY}-20260808T093305Z" "$SERVED"
cp -a "$BASE/control-ui.bak-pre-${UI_OVERLAY}-20260808T093305Z" "$BASE/control-ui"
cp -a "$BASE/pin.env.bak-pre-${UI_OVERLAY}-20260808T093305Z" "$BASE/pin.env"
bash "$BASE/watch-control-ui-v3-pin.sh"
podman restart openbot-gateway-rc
```

---

## Previous cutover (2026-08-08 ~16:37 CST) — Control UI: collaboration groups left-list density (`groups-anchor-density-r13`)

| Field      | Value                                                                                                                                                                                  |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date       | 2026-08-08 (UI live ~16:37 CST / artifact `20260808T083446Z`)                                                                                                                          |
| Decision   | 「我的协作小组」左栏行距对齐「我的机器人」：人数并入角色行、共用更紧的 padding/头像尺寸。                                                                                              |
| Source     | `cursor/workbench-isolation-r6` `pnpm ui:build` → `openbot-control-ui-groups-anchor-density-r13-20260808T083446Z.tar.gz` (`index-FHpdazL9.js`, md5 `e10c05adae2936abbd72d8f9d892c89f`) |
| Build mode | Control UI overlay → served root + baseline + container embed（gateway dist 不变）                                                                                                     |
| Container  | `openbot-gateway-rc`                                                                                                                                                                   |
| Control UI | `index-FHpdazL9.js`                                                                                                                                                                    |
| Gateway    | unchanged overlay `device-owner-claim-r9`                                                                                                                                              |
| Pin        | `OPENBOT_UI_OVERLAY_PINNED_ENTRY=index-FHpdazL9.js`；forbid includes prior `index-Cch7fHgC.js` / `index-SO8BR5Q1.js` / `index-CLI9SZku.js`                                             |
| Smoke      | healthz **200**; readyz **ready:true**; www/gw/served/container → `index-FHpdazL9.js`; verify-control-ui-v3 **OK**; css denser row padding + zh `人 ·` role trail                      |
| Rollback   | restore `/root/.openbot/control-ui.bak-pre-groups-anchor-density-r13-20260808T083446Z` + baseline/pin bak then watch + podman cp                                                       |
| Executor   | `cursor-composer`                                                                                                                                                                      |
| Merge-back | Pending — denser groups left-list rows.                                                                                                                                                |

### Rollback

```bash
STAMP=20260808T083446Z
OVERLAY=groups-anchor-density-r13
BASE=/root/openbot-ui-baselines/v3.0
SERVED=/root/.openbot/control-ui
chattr -i "$BASE/pin.env" 2>/dev/null || true
rm -rf "$SERVED" "$BASE/control-ui"
cp -a "${SERVED}.bak-pre-${OVERLAY}-${STAMP}" "$SERVED"
cp -a "$BASE/control-ui.bak-pre-${OVERLAY}-${STAMP}" "$BASE/control-ui"
cp -a "$BASE/pin.env.bak-pre-${OVERLAY}-${STAMP}" "$BASE/pin.env"
bash "$BASE/watch-control-ui-v3-pin.sh"
podman exec openbot-gateway-rc sh -c 'rm -rf /app/dist/control-ui && mkdir -p /app/dist/control-ui'
podman cp "$SERVED/." openbot-gateway-rc:/app/dist/control-ui/
```

---

## Previous cutover (2026-08-08 ~16:01 CST) — Control UI: drop space-creator auto-member hint (`group-invite-no-hint-r12`)

| Field      | Value                                                                                                                                                                                 |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date       | 2026-08-08 (UI live ~16:01 CST / artifact `20260808T080010Z`)                                                                                                                         |
| Decision   | 去掉创建向导「你将自动成为小组主人与成员…」提示；创建者仍静默自动入组，邀请他人机器人回执逻辑不变。                                                                                   |
| Source     | `cursor/workbench-isolation-r6` `pnpm ui:build` → `openbot-control-ui-group-invite-no-hint-r12-20260808T080010Z.tar.gz` (`index-Cch7fHgC.js`, md5 `3d49460947bca3576b2175a928690b3a`) |
| Build mode | Control UI overlay → served root + baseline + container embed（gateway dist 不变）                                                                                                    |
| Container  | `openbot-gateway-rc`                                                                                                                                                                  |
| Control UI | `index-Cch7fHgC.js`                                                                                                                                                                   |
| Gateway    | unchanged overlay `device-owner-claim-r9`                                                                                                                                             |
| Pin        | `OPENBOT_UI_OVERLAY_PINNED_ENTRY=index-Cch7fHgC.js`；forbid includes prior `index-SO8BR5Q1.js` / `index-CLI9SZku.js`                                                                  |
| Smoke      | healthz **200**; readyz **ready:true**; www/gw/served/container → `index-Cch7fHgC.js`; verify-control-ui-v3 **OK**; zh has `已邀请，待对方加入` and no creator auto-member hint       |
| Rollback   | restore `/root/.openbot/control-ui.bak-pre-group-invite-no-hint-r12-20260808T080010Z` + baseline/pin bak then watch + podman cp                                                       |
| Executor   | `cursor-composer`                                                                                                                                                                     |
| Merge-back | Pending — drop redundant creator hint copy.                                                                                                                                           |

### Rollback

```bash
STAMP=20260808T080010Z
OVERLAY=group-invite-no-hint-r12
BASE=/root/openbot-ui-baselines/v3.0
SERVED=/root/.openbot/control-ui
chattr -i "$BASE/pin.env" 2>/dev/null || true
rm -rf "$SERVED" "$BASE/control-ui"
cp -a "${SERVED}.bak-pre-${OVERLAY}-${STAMP}" "$SERVED"
cp -a "$BASE/control-ui.bak-pre-${OVERLAY}-${STAMP}" "$BASE/control-ui"
cp -a "$BASE/pin.env.bak-pre-${OVERLAY}-${STAMP}" "$BASE/pin.env"
bash "$BASE/watch-control-ui-v3-pin.sh"
podman exec openbot-gateway-rc sh -c 'rm -rf /app/dist/control-ui && mkdir -p /app/dist/control-ui'
podman cp "$SERVED/." openbot-gateway-rc:/app/dist/control-ui/
```

---

## Previous cutover (2026-08-08 ~15:48 CST) — Control UI: collaboration group invite receipt (`group-invite-receipt-r11`)

| Field      | Value                                                                                                                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date       | 2026-08-08 (UI live ~15:48 CST / artifact `20260808T073214Z`)                                                                                                                                           |
| Decision   | 协作小组：创建者自动成为主人/成员（无需邀请自己）；邀请他人机器人后即时回执「已邀请，待对方加入」。                                                                                                     |
| Source     | `cursor/workbench-isolation-r6` `pnpm ui:build` → `openbot-control-ui-group-invite-receipt-r11-20260808T073214Z.tar.gz` (`index-SO8BR5Q1.js`, md5 `86864ea2dab488e26ce6e7e2b0d95cf5`)                   |
| Build mode | Control UI overlay → served root + baseline + container embed（gateway dist 不变）                                                                                                                      |
| Container  | `openbot-gateway-rc`                                                                                                                                                                                    |
| Control UI | `index-SO8BR5Q1.js`                                                                                                                                                                                     |
| Gateway    | unchanged overlay `device-owner-claim-r9`                                                                                                                                                               |
| Pin        | `OPENBOT_UI_OVERLAY_PINNED_ENTRY=index-SO8BR5Q1.js`；forbid includes prior `index-CLI9SZku.js` / `index-kE5Q2kHY.js`                                                                                    |
| Smoke      | healthz **200**; readyz **ready:true**; www/gw/served/container → `index-SO8BR5Q1.js`; verify-control-ui-v3 **OK**; markers `已邀请，待对方加入` / `你将自动成为小组主人与成员` / `creator-member-hint` |
| Rollback   | restore `/root/.openbot/control-ui.bak-pre-group-invite-receipt-r11-20260808T073214Z` + baseline/pin bak then watch + podman cp                                                                         |
| Executor   | `cursor-composer`                                                                                                                                                                                       |
| Merge-back | Pending — group owner auto-member + bot invite receipt UX.                                                                                                                                              |

### Rollback

```bash
STAMP=20260808T073214Z
OVERLAY=group-invite-receipt-r11
BASE=/root/openbot-ui-baselines/v3.0
SERVED=/root/.openbot/control-ui
chattr -i "$BASE/pin.env" 2>/dev/null || true
rm -rf "$SERVED" "$BASE/control-ui"
cp -a "${SERVED}.bak-pre-${OVERLAY}-${STAMP}" "$SERVED"
cp -a "$BASE/control-ui.bak-pre-${OVERLAY}-${STAMP}" "$BASE/control-ui"
cp -a "$BASE/pin.env.bak-pre-${OVERLAY}-${STAMP}" "$BASE/pin.env"
bash "$BASE/watch-control-ui-v3-pin.sh"
podman exec openbot-gateway-rc sh -c 'rm -rf /app/dist/control-ui && mkdir -p /app/dist/control-ui'
podman cp "$SERVED/." openbot-gateway-rc:/app/dist/control-ui/
```

---

## Previous cutover (2026-08-08 ~12:15 CST) — Control UI: knowledge library source UX (`knowledge-library-source-ux-r10`)

| Field      | Value                                                                                                                                                                                        |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date       | 2026-08-08 (UI live ~12:15 CST / artifact `20260808T041418Z`)                                                                                                                                |
| Decision   | 我的知识库：来源表可解绑无 documentId 的云盘/本地文件夹等绑定；树选中去红边；中栏仅文档行可点开详情，连接器/文件夹行仅解绑/删除；来源类型中文化与表头对齐精修。                              |
| Source     | `cursor/workbench-isolation-r6` `pnpm ui:build` → `openbot-control-ui-knowledge-library-source-ux-r10-20260808T041418Z.tar.gz` (`index-CLI9SZku.js`, md5 `1d7c18a0ad427095e8db6b68a3a75ba9`) |
| Build mode | Control UI overlay → served root + baseline + container embed（gateway dist 不变）                                                                                                           |
| Container  | `openbot-gateway-rc`                                                                                                                                                                         |
| Control UI | `index-CLI9SZku.js`                                                                                                                                                                          |
| Gateway    | unchanged overlay `device-owner-claim-r9`                                                                                                                                                    |
| Pin        | `OPENBOT_UI_OVERLAY_PINNED_ENTRY=index-CLI9SZku.js`；forbid `index-kE5Q2kHY.js,index-BsFLg08D.js,index-B3SDKPe8.js,index-rSaj920l.js,index-GZEtPA7p.js,index-CbC3mkSB.js,index-DUmwHjvR.js`  |
| Smoke      | healthz **200**; readyz **ready:true**; www/gw/served/container → `index-CLI9SZku.js`; verify-control-ui-v3 **OK**; markers `ku-source-unbind` / `云盘` / `确定移除来源`                     |
| Rollback   | restore `/root/.openbot/control-ui.bak-pre-knowledge-library-source-ux-r10-20260808T041418Z` + baseline/pin bak then watch + podman cp                                                       |
| Executor   | `cursor-composer`                                                                                                                                                                            |
| Merge-back | Pending — knowledge library source unbind + list open semantics.                                                                                                                             |

### Rollback

```bash
STAMP=20260808T041418Z
OVERLAY=knowledge-library-source-ux-r10
BASE=/root/openbot-ui-baselines/v3.0
SERVED=/root/.openbot/control-ui
chattr -i "$BASE/pin.env" 2>/dev/null || true
rm -rf "$SERVED" "$BASE/control-ui"
cp -a "${SERVED}.bak-pre-${OVERLAY}-${STAMP}" "$SERVED"
cp -a "$BASE/control-ui.bak-pre-${OVERLAY}-${STAMP}" "$BASE/control-ui"
cp -a "$BASE/pin.env.bak-pre-${OVERLAY}-${STAMP}" "$BASE/pin.env"
bash "$BASE/watch-control-ui-v3-pin.sh"
podman exec openbot-gateway-rc sh -c 'rm -rf /app/dist/control-ui && mkdir -p /app/dist/control-ui'
podman cp "$SERVED/." openbot-gateway-rc:/app/dist/control-ui/
```

---

## Previous cutover (2026-08-08 ~11:24 CST) — Settings tabs polish + device owner claim + nav quota (`settings-devices-quota-r9` / `device-owner-claim-r9`)

| Field      | Value                                                                                                                                                                                                                                               |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date       | 2026-08-08 (live ~11:24 CST / artifact `20260808T032352Z`)                                                                                                                                                                                          |
| Decision   | (1) 侧栏「+」：普通成员非管家机器人满 5 隐藏；平台 admin/super-admin 豁免。(2) 我的设备/机器人/协作小组打磨。(3) Gateway：静默配对写 ownerId + list/reconnect lazy-claim，打通员工端设备列表。                                                      |
| Source     | `cursor/workbench-isolation-r6` → UI `openbot-control-ui-settings-devices-quota-r9-20260808T032352Z.tar.gz` (`index-kE5Q2kHY.js`, md5 `c41207e5189367c30d4cde1b6f17e5e0`) + GW `openbot-gateway-dist-device-owner-claim-r9-20260808T032352Z.tar.gz` |
| Build mode | Gateway dist overlay（exclude control-ui，再嵌入当前 UI）+ Control UI overlay                                                                                                                                                                       |
| Container  | `openbot-gateway-rc`                                                                                                                                                                                                                                |
| Control UI | `index-kE5Q2kHY.js`                                                                                                                                                                                                                                 |
| Gateway    | overlay `device-owner-claim-r9`                                                                                                                                                                                                                     |
| Pin        | `OPENBOT_UI_OVERLAY_PINNED_ENTRY=index-kE5Q2kHY.js`                                                                                                                                                                                                 |
| Smoke      | healthz **200**; readyz **ready:true**; www/gw → `index-kE5Q2kHY.js`; gateway marker `resolveConnectDeviceOwnerId` / `currentDeviceId`                                                                                                              |
| Rollback   | restore `/root/openbot-maintenance-device-owner-claim-r9-20260808T032352Z/container-app-dist.before.tgz` + UI bak `settings-devices-quota-r9`                                                                                                       |
| Executor   | `cursor-composer`                                                                                                                                                                                                                                   |
| Merge-back | Pending — nav quota bypass + device owner claim + settings tab polish.                                                                                                                                                                              |

### Rollback

```bash
STAMP=20260808T032352Z
OVERLAY=device-owner-claim-r9
UI_OVERLAY=settings-devices-quota-r9
BK=/root/openbot-maintenance-${OVERLAY}-${STAMP}
BASE=/root/openbot-ui-baselines/v3.0
SERVED=/root/.openbot/control-ui
mkdir -p /tmp/gw-dist-rollback && rm -rf /tmp/gw-dist-rollback/*
tar xzf "$BK/container-app-dist.before.tgz" -C /tmp/gw-dist-rollback
podman exec openbot-gateway-rc sh -c 'rm -rf /app/dist && mkdir -p /app/dist'
podman cp /tmp/gw-dist-rollback/dist/. openbot-gateway-rc:/app/dist/
chattr -i "$BASE/pin.env" 2>/dev/null || true
rm -rf "$SERVED" "$BASE/control-ui"
cp -a "${SERVED}.bak-pre-${UI_OVERLAY}-${STAMP}" "$SERVED"
cp -a "$BASE/control-ui.bak-pre-${UI_OVERLAY}-${STAMP}" "$BASE/control-ui"
cp -a "$BASE/pin.env.bak-pre-${UI_OVERLAY}-${STAMP}" "$BASE/pin.env"
bash "$BASE/watch-control-ui-v3-pin.sh"
podman restart openbot-gateway-rc
```

---

## Previous cutover (2026-08-08 ~11:06 CST) — Control UI: header usermenu hit-test fix (`header-usermenu-hitfix-r8`)

| Field      | Value                                                                                                                                                                                  |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date       | 2026-08-08 (UI live ~11:06 CST / artifact `20260808T030605Z`)                                                                                                                          |
| Decision   | 右上角头像菜单关闭时仅用 `opacity:0`，子 panel 仍 `pointer-events:auto`，透明层叠在「知识治理」上误触个人设置。关闭态加 `visibility:hidden` + 子层禁 hit-test，仅 hover/open 时恢复。  |
| Source     | `cursor/workbench-isolation-r6` `pnpm ui:build` → `openbot-control-ui-header-usermenu-hitfix-r8-20260808T030605Z.tar.gz` (`index-BsFLg08D.js`, md5 `aa72fc36893d5a45b0d6b406913c1bc0`) |
| Build mode | Control UI overlay → served root + baseline + container embed（gateway dist 不变）                                                                                                     |
| Container  | `openbot-gateway-rc`                                                                                                                                                                   |
| Control UI | `index-BsFLg08D.js`                                                                                                                                                                    |
| Gateway    | unchanged overlay `employee-chat-session-acl-r1`                                                                                                                                       |
| Pin        | `OPENBOT_UI_OVERLAY_PINNED_ENTRY=index-BsFLg08D.js`；forbid `index-B3SDKPe8.js,index-rSaj920l.js,index-GZEtPA7p.js,index-CbC3mkSB.js,index-DUmwHjvR.js`                                |
| Smoke      | healthz **200**; readyz **ready:true**; www/gw → `index-BsFLg08D.js`; verify-control-ui-v3 **OK**                                                                                      |
| Rollback   | restore `/root/.openbot/control-ui.bak-pre-header-usermenu-hitfix-r8-20260808T030605Z` + baseline/pin bak then watch + podman cp                                                       |
| Executor   | `cursor-composer`                                                                                                                                                                      |
| Merge-back | Pending — workbench header usermenu CSS hit-test fix.                                                                                                                                  |

### Rollback

```bash
STAMP=20260808T030605Z
OVERLAY=header-usermenu-hitfix-r8
BASE=/root/openbot-ui-baselines/v3.0
SERVED=/root/.openbot/control-ui
chattr -i "$BASE/pin.env" 2>/dev/null || true
rm -rf "$SERVED" "$BASE/control-ui"
cp -a "${SERVED}.bak-pre-${OVERLAY}-${STAMP}" "$SERVED"
cp -a "$BASE/control-ui.bak-pre-${OVERLAY}-${STAMP}" "$BASE/control-ui"
cp -a "$BASE/pin.env.bak-pre-${OVERLAY}-${STAMP}" "$BASE/pin.env"
bash "$BASE/watch-control-ui-v3-pin.sh"
podman exec openbot-gateway-rc sh -c 'rm -rf /app/dist/control-ui && mkdir -p /app/dist/control-ui'
podman cp "$SERVED/." openbot-gateway-rc:/app/dist/control-ui/
```

---

## Previous cutover (2026-08-08 ~10:48 CST) — Control UI: restore AI nav + knowledge reload (`workbench-nav-restore-r7`)

| Field      | Value                                                                                                                                                                                             |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date       | 2026-08-08 (UI live ~10:48 CST / artifact `20260808T024800Z`)                                                                                                                                     |
| Decision   | AI 助手侧栏在 `agents.list` 欠范围时用 grant/owned 并集恢复；知识宇宙登录后强制 reload；列表失败不清空已有 bases。Gateway seat store 走 tenant 路径的改动仍在 PR #316，本 cutover 仅 UI overlay。 |
| Source     | `cursor/workbench-isolation-r6` `pnpm ui:build` → `openbot-control-ui-workbench-nav-restore-r7-20260808T024800Z.tar.gz` (`index-B3SDKPe8.js`, md5 `037d67dbaac221669c41b754b3f35119`)             |
| Build mode | Control UI overlay → served root + baseline + container embed（gateway dist 不变）                                                                                                                |
| Container  | `openbot-gateway-rc`                                                                                                                                                                              |
| Control UI | `index-B3SDKPe8.js`                                                                                                                                                                               |
| Gateway    | unchanged overlay `employee-chat-session-acl-r1`                                                                                                                                                  |
| Pin        | `OPENBOT_UI_OVERLAY_PINNED_ENTRY=index-B3SDKPe8.js`；forbid `index-rSaj920l.js,index-GZEtPA7p.js,index-CbC3mkSB.js,index-DUmwHjvR.js`                                                             |
| Smoke      | healthz **200**; readyz **ready:true**; www/gw → `index-B3SDKPe8.js`; verify-control-ui-v3 **OK**; served/container md5 match                                                                     |
| Rollback   | restore `/root/.openbot/control-ui.bak-pre-workbench-nav-restore-r7-20260808T024800Z` + baseline/pin bak then watch + podman cp                                                                   |
| Executor   | `cursor-composer`                                                                                                                                                                                 |
| Merge-back | Pending — PR #316 (UI grant-union + gateway tenant seat store).                                                                                                                                   |

### Rollback

```bash
STAMP=20260808T024800Z
OVERLAY=workbench-nav-restore-r7
BASE=/root/openbot-ui-baselines/v3.0
SERVED=/root/.openbot/control-ui
chattr -i "$BASE/pin.env" 2>/dev/null || true
rm -rf "$SERVED" "$BASE/control-ui"
cp -a "${SERVED}.bak-pre-${OVERLAY}-${STAMP}" "$SERVED"
cp -a "$BASE/control-ui.bak-pre-${OVERLAY}-${STAMP}" "$BASE/control-ui"
cp -a "$BASE/pin.env.bak-pre-${OVERLAY}-${STAMP}" "$BASE/pin.env"
bash "$BASE/watch-control-ui-v3-pin.sh"
podman exec openbot-gateway-rc sh -c 'rm -rf /app/dist/control-ui && mkdir -p /app/dist/control-ui'
podman cp "$SERVED/." openbot-gateway-rc:/app/dist/control-ui/
```

---

## Previous cutover (2026-08-08 ~10:18 CST) — Control UI: identity revokeConfirmId null-safe (`enterprise-identity-r8`)

| Field      | Value                                                                                                                                                         |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date       | 2026-08-08 (UI live ~10:18 CST / artifact `20260808T021748Z`)                                                                                                 |
| Decision   | Hotfix: `renderIdentityRevokeConfirmModal` crashed when `revokeConfirmIdentityId` was undefined (`.trim()`). Guard with `?? ""` in modal + render-model.      |
| Source     | Local WIP `pnpm ui:build` → `openbot-control-ui-enterprise-identity-r8-20260808T021748Z.tar.gz` (`index-rSaj920l.js`, md5 `a23ec28eac79b1f61e5cb7b7c3e4135c`) |
| Build mode | Control UI overlay → served root + baseline + container embed（gateway dist 不变）                                                                            |
| Container  | `openbot-gateway-rc`                                                                                                                                          |
| Control UI | `index-rSaj920l.js`                                                                                                                                           |
| Gateway    | unchanged overlay `employee-chat-session-acl-r1`                                                                                                              |
| Pin        | `OPENBOT_UI_OVERLAY_PINNED_ENTRY=index-rSaj920l.js`                                                                                                           |
| Smoke      | healthz **200**; www/gw → `index-rSaj920l.js`; verify-control-ui-v3 **OK**                                                                                    |
| Rollback   | restore `/root/.openbot/control-ui.bak-pre-enterprise-identity-r8-20260808T021748Z` + baseline/pin bak then watch + podman cp                                 |
| Executor   | `cursor-composer`                                                                                                                                             |
| Merge-back | Pending — null-safe revokeConfirmIdentityId.                                                                                                                  |

### Rollback

```bash
STAMP=20260808T021748Z
OVERLAY=enterprise-identity-r8
BASE=/root/openbot-ui-baselines/v3.0
SERVED=/root/.openbot/control-ui
chattr -i "$BASE/pin.env" 2>/dev/null || true
rm -rf "$SERVED" "$BASE/control-ui"
cp -a "${SERVED}.bak-pre-${OVERLAY}-${STAMP}" "$SERVED"
cp -a "$BASE/control-ui.bak-pre-${OVERLAY}-${STAMP}" "$BASE/control-ui"
cp -a "$BASE/pin.env.bak-pre-${OVERLAY}-${STAMP}" "$BASE/pin.env"
bash "$BASE/watch-control-ui-v3-pin.sh"
podman exec openbot-gateway-rc sh -c 'rm -rf /app/dist/control-ui && mkdir -p /app/dist/control-ui'
podman cp "$SERVED/." openbot-gateway-rc:/app/dist/control-ui/
```

---

## Previous cutover (2026-08-08 ~10:10 CST) — Control UI: rewire optimized enterprise identity assets section (`enterprise-identity-r7`)

| Field      | Value                                                                                                                                                         |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date       | 2026-08-08 (UI live ~10:10 CST / artifact `20260808T021002Z`)                                                                                                 |
| Decision   | 根因：优化版 `renderEnterpriseIdentityAssetsSection` 仍在仓库但未接线，设置页继续渲染旧「身份与通道」布局。重新接入主从布局（已连接身份 + 右侧治理详情）。    |
| Source     | Local WIP `pnpm ui:build` → `openbot-control-ui-enterprise-identity-r7-20260808T021002Z.tar.gz` (`index-GZEtPA7p.js`, md5 `c3661bff6b4a077df8a96d0b3151fb93`) |
| Build mode | Control UI overlay → served root + baseline + container embed（gateway dist 不变）                                                                            |
| Container  | `openbot-gateway-rc`                                                                                                                                          |
| Control UI | `index-GZEtPA7p.js`                                                                                                                                           |
| Gateway    | unchanged overlay `employee-chat-session-acl-r1`                                                                                                              |
| Pin        | `OPENBOT_UI_OVERLAY_PINNED_ENTRY=index-GZEtPA7p.js`                                                                                                           |
| Smoke      | healthz **200**; readyz **ready:true**; www/gw → `index-GZEtPA7p.js`; verify-control-ui-v3 **OK**; bundle has `已连接身份` / no `身份与通道`                  |
| Rollback   | restore `/root/.openbot/control-ui.bak-pre-enterprise-identity-r7-20260808T021002Z` + baseline/pin bak then watch + podman cp                                 |
| Executor   | `cursor-composer`                                                                                                                                             |
| Merge-back | Pending — local WIP (rewire `enterprise-access-control-surface.ts` → assets section).                                                                         |

### Rollback

```bash
STAMP=20260808T021002Z
OVERLAY=enterprise-identity-r7
BASE=/root/openbot-ui-baselines/v3.0
SERVED=/root/.openbot/control-ui
chattr -i "$BASE/pin.env" 2>/dev/null || true
rm -rf "$SERVED" "$BASE/control-ui"
cp -a "${SERVED}.bak-pre-${OVERLAY}-${STAMP}" "$SERVED"
cp -a "$BASE/control-ui.bak-pre-${OVERLAY}-${STAMP}" "$BASE/control-ui"
cp -a "$BASE/pin.env.bak-pre-${OVERLAY}-${STAMP}" "$BASE/pin.env"
bash "$BASE/watch-control-ui-v3-pin.sh"
podman exec openbot-gateway-rc sh -c 'rm -rf /app/dist/control-ui && mkdir -p /app/dist/control-ui'
podman cp "$SERVED/." openbot-gateway-rc:/app/dist/control-ui/
```

---

## Previous cutover (2026-08-08 ~10:03 CST) — Control UI: PR #313 merge + enterprise CSS recovery (`workbench-isolation-r6`)

| Field      | Value                                                                                                                                                                              |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date       | 2026-08-08 (UI live ~10:03 CST / artifact `20260808T020257Z`)                                                                                                                      |
| Decision   | PR #313 landed on `main` (`6fc560a048`): workbench isolation + enterprise IM help links/callback dedupe + restore enterprise identity/cost-budget/pricing CSS.                     |
| Source     | `origin/main` @ `6fc560a048` → `pnpm ui:build` → `openbot-control-ui-workbench-isolation-r6-20260808T020257Z.tar.gz` (`index-CeLSKYX7.js`, md5 `b8472fbcca92e8eb7dc8b2c133c0db67`) |
| Build mode | Control UI overlay → served root + baseline + container embed（gateway dist 不变）                                                                                                 |
| Container  | `openbot-gateway-rc`                                                                                                                                                               |
| Control UI | `index-CeLSKYX7.js`                                                                                                                                                                |
| Gateway    | unchanged overlay `employee-chat-session-acl-r1`                                                                                                                                   |
| Pin        | `OPENBOT_UI_OVERLAY_PINNED_ENTRY=index-CeLSKYX7.js`                                                                                                                                |
| Smoke      | healthz **200**; readyz **ready:true**; www/gw → `index-CeLSKYX7.js`; verify-control-ui-v3 **OK**; bundle markers `enterprise-identity-asset-list` + `pricing-v3__card`            |
| Rollback   | restore `/root/.openbot/control-ui.bak-pre-workbench-isolation-r6-20260808T020257Z` + baseline/pin bak then watch + podman cp                                                      |
| Executor   | `cursor-composer`                                                                                                                                                                  |
| Merge-back | Landed — https://github.com/gmood2008/openbot/pull/313 → `6fc560a0487098e7a72bb960a85e7e5f6b1d7a45`                                                                                |

### Rollback

```bash
STAMP=20260808T020257Z
OVERLAY=workbench-isolation-r6
BASE=/root/openbot-ui-baselines/v3.0
SERVED=/root/.openbot/control-ui
chattr -i "$BASE/pin.env" 2>/dev/null || true
rm -rf "$SERVED" "$BASE/control-ui"
cp -a "${SERVED}.bak-pre-${OVERLAY}-${STAMP}" "$SERVED"
cp -a "$BASE/control-ui.bak-pre-${OVERLAY}-${STAMP}" "$BASE/control-ui"
cp -a "$BASE/pin.env.bak-pre-${OVERLAY}-${STAMP}" "$BASE/pin.env"
bash "$BASE/watch-control-ui-v3-pin.sh"
podman exec openbot-gateway-rc sh -c 'rm -rf /app/dist/control-ui && mkdir -p /app/dist/control-ui'
podman cp "$SERVED/." openbot-gateway-rc:/app/dist/control-ui/
```

---

## Previous cutover (2026-08-08 ~09:27 CST) — Control UI: AI nav trust + compose dock + add-quota (`workbench-isolation-r5`)

| Field      | Value                                                                                                                                                         |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date       | 2026-08-08 (UI live ~09:27 CST / artifact `20260808T012642Z`)                                                                                                 |
| Decision   | hydrate 后信任 Gateway scoped agents/spaces（修复 AI 助手只剩大白管家）；输入框贴底；bot/协作组达 5 上限时隐藏「+」。                                         |
| Source     | Local WIP `pnpm ui:build` → `openbot-control-ui-workbench-isolation-r5-20260808T012642Z.tar.gz` (`index-CbC3mkSB.js`, md5 `de409af720fd3a3565651de5963b5e9a`) |
| Build mode | Control UI overlay → served root + baseline + container embed（gateway dist 不变）                                                                            |
| Container  | `openbot-gateway-rc`                                                                                                                                          |
| Control UI | `index-CbC3mkSB.js`                                                                                                                                           |
| Gateway    | unchanged overlay `employee-chat-session-acl-r1`                                                                                                              |
| Pin        | `OPENBOT_UI_OVERLAY_PINNED_ENTRY=index-CbC3mkSB.js`                                                                                                           |
| Smoke      | healthz **200**; readyz **ready:true**; www/gw → `index-CbC3mkSB.js`; verify-control-ui-v3 **OK**                                                             |
| Rollback   | restore `/root/.openbot/control-ui.bak-pre-workbench-isolation-r5-20260808T012642Z` + baseline/pin bak then watch + podman cp                                 |
| Executor   | `cursor-composer`                                                                                                                                             |
| Merge-back | Superseded by r6 — PR #313 landed `6fc560a048`.                                                                                                               |

### Rollback

```bash
STAMP=20260808T012642Z
OVERLAY=workbench-isolation-r5
BASE=/root/openbot-ui-baselines/v3.0
SERVED=/root/.openbot/control-ui
chattr -i "$BASE/pin.env" 2>/dev/null || true
rm -rf "$SERVED" "$BASE/control-ui"
cp -a "${SERVED}.bak-pre-${OVERLAY}-${STAMP}" "$SERVED"
cp -a "$BASE/control-ui.bak-pre-${OVERLAY}-${STAMP}" "$BASE/control-ui"
cp -a "$BASE/pin.env.bak-pre-${OVERLAY}-${STAMP}" "$BASE/pin.env"
bash "$BASE/watch-control-ui-v3-pin.sh"
podman exec openbot-gateway-rc sh -c 'rm -rf /app/dist/control-ui && mkdir -p /app/dist/control-ui'
podman cp "$SERVED/." openbot-gateway-rc:/app/dist/control-ui/
```

---

## Previous cutover (2026-08-08 ~08:11 CST) — Control UI: employee workbench isolation fixes (`workbench-isolation-r4`)

| Field      | Value                                                                                                                                                            |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date       | 2026-08-08 (UI live ~08:11 CST / artifact `20260808T001032Z`)                                                                                                    |
| Decision   | 员工工作台隔离修复：AI 助手 seat 授权 bot 恢复、协作空间客户端 scope 过滤、每日概览空态保留、协作组头部成员去重、「我的任务→定时任务」强制 personal cron scope。 |
| Source     | Local WIP `pnpm ui:build` → `openbot-control-ui-workbench-isolation-r4-20260808T001032Z.tar.gz` (`index-DUmwHjvR.js`, md5 `28e31250a9e0ca19ff46c5a56fc6b6da`)    |
| Build mode | Control UI overlay → served root + baseline + container embed（gateway dist 不变）                                                                               |
| Container  | `openbot-gateway-rc`                                                                                                                                             |
| Control UI | `index-DUmwHjvR.js`                                                                                                                                              |
| Gateway    | unchanged overlay `employee-chat-session-acl-r1`                                                                                                                 |
| Pin        | `OPENBOT_UI_OVERLAY_PINNED_ENTRY=index-DUmwHjvR.js`                                                                                                              |
| Smoke      | healthz **200**; readyz **ready:true**; www/gw → `index-DUmwHjvR.js`; verify-control-ui-v3 **OK**                                                                |
| Rollback   | restore `/root/.openbot/control-ui.bak-pre-workbench-isolation-r4-20260808T001032Z` + baseline/pin bak then watch + podman cp                                    |
| Executor   | `cursor-composer`                                                                                                                                                |
| Merge-back | Pending — local WIP (not yet on `main`).                                                                                                                         |

### Rollback

```bash
STAMP=20260808T001032Z
OVERLAY=workbench-isolation-r4
BASE=/root/openbot-ui-baselines/v3.0
SERVED=/root/.openbot/control-ui
chattr -i "$BASE/pin.env" 2>/dev/null || true
rm -rf "$SERVED" "$BASE/control-ui"
cp -a "${SERVED}.bak-pre-${OVERLAY}-${STAMP}" "$SERVED"
cp -a "$BASE/control-ui.bak-pre-${OVERLAY}-${STAMP}" "$BASE/control-ui"
cp -a "$BASE/pin.env.bak-pre-${OVERLAY}-${STAMP}" "$BASE/pin.env"
bash "$BASE/watch-control-ui-v3-pin.sh"
podman exec openbot-gateway-rc sh -c 'rm -rf /app/dist/control-ui && mkdir -p /app/dist/control-ui'
podman cp "$SERVED/." openbot-gateway-rc:/app/dist/control-ui/
```

---

## Previous cutover (2026-08-08 ~05:56 CST) — Control UI: member nav isolation + governance fixes (`member-nav-isolation-r3`)

| Field      | Value                                                                                                                                                          |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date       | 2026-08-08 (UI live ~05:56 CST / artifact `20260807T215624Z`)                                                                                                  |
| Decision   | 成员管理 render-loop 修复（#311）+ AI 助手导航栏过滤他人机器人（bootstrap 阶段 ownership 校验）。                                                              |
| Source     | Local WIP `pnpm ui:build` → `openbot-control-ui-member-nav-isolation-r3-20260807T215624Z.tar.gz` (`index-GIvwwlFj.js`, md5 `8dfdf28088cde0b1578f1a4aa825b1ac`) |
| Build mode | Control UI overlay → served root + baseline + container embed（gateway dist 不变）                                                                             |
| Container  | `openbot-gateway-rc`                                                                                                                                           |
| Control UI | `index-GIvwwlFj.js`                                                                                                                                            |
| Gateway    | unchanged overlay `employee-chat-session-acl-r1`                                                                                                               |
| Pin        | `OPENBOT_UI_OVERLAY_PINNED_ENTRY=index-GIvwwlFj.js`                                                                                                            |
| Smoke      | healthz **200**; watch exit **0**; www/gw → `index-GIvwwlFj.js`; verify-control-ui-v3 **OK**                                                                   |
| Rollback   | restore `/root/.openbot/control-ui.bak-pre-member-nav-isolation-r3-20260807T215624Z` + baseline/pin bak then watch                                             |
| Executor   | `cursor-composer`                                                                                                                                              |
| Merge-back | Pending — includes #311 + nav isolation follow-up.                                                                                                             |

### Rollback

```bash
STAMP=20260807T215624Z
OVERLAY=member-nav-isolation-r3
BASE=/root/openbot-ui-baselines/v3.0
SERVED=/root/.openbot/control-ui
chattr -i "$BASE/pin.env" 2>/dev/null || true
rm -rf "$SERVED" "$BASE/control-ui"
cp -a "${SERVED}.bak-pre-${OVERLAY}-${STAMP}" "$SERVED"
cp -a "$BASE/control-ui.bak-pre-${OVERLAY}-${STAMP}" "$BASE/control-ui"
cp -a "$BASE/pin.env.bak-pre-${OVERLAY}-${STAMP}" "$BASE/pin.env"
bash "$BASE/watch-control-ui-v3-pin.sh"
podman exec openbot-gateway-rc sh -c 'rm -rf /app/dist/control-ui && mkdir -p /app/dist/control-ui'
podman cp "$SERVED/." openbot-gateway-rc:/app/dist/control-ui/
```

---

## Previous cutover (2026-08-08 ~05:46 CST) — Control UI: member governance render-loop fix (`member-governance-freeze-r2`)

| Field      | Value                                                                                                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Date       | 2026-08-08 (UI live ~05:46 CST / artifact `20260807T214549Z`)                                                                                                      |
| Decision   | 修复协作小组「添加成员」点击后整页卡死：render 路径不再每帧调用 `initializeMemberGovernance()`，仅在 groupKey 变化时初始化。                                       |
| Source     | Local WIP `pnpm ui:build` → `openbot-control-ui-member-governance-freeze-r2-20260807T214549Z.tar.gz` (`index-QlJzYLFG.js`, md5 `a5d5c6bbf63553267d0cb13fa4965c41`) |
| Build mode | Control UI overlay → served root + baseline + container embed（gateway dist 不变）                                                                                 |
| Container  | `openbot-gateway-rc`                                                                                                                                               |
| Control UI | `index-QlJzYLFG.js`                                                                                                                                                |
| Gateway    | unchanged overlay `employee-chat-session-acl-r1`                                                                                                                   |
| Pin        | `OPENBOT_UI_OVERLAY_PINNED_ENTRY=index-QlJzYLFG.js`                                                                                                                |
| Smoke      | healthz **200**; readyz **ready:true**; watch exit **0**; www/gw → `index-QlJzYLFG.js`; verify-control-ui-v3 **OK**                                                |
| Rollback   | restore `/root/.openbot/control-ui.bak-pre-member-governance-freeze-r2-20260807T214549Z` + baseline/pin bak then watch                                             |
| Executor   | `cursor-composer`                                                                                                                                                  |
| Merge-back | Pending — source local WIP (not yet on `main`).                                                                                                                    |

### Rollback

```bash
STAMP=20260807T214549Z
OVERLAY=member-governance-freeze-r2
BASE=/root/openbot-ui-baselines/v3.0
SERVED=/root/.openbot/control-ui
chattr -i "$BASE/pin.env" 2>/dev/null || true
rm -rf "$SERVED" "$BASE/control-ui"
cp -a "${SERVED}.bak-pre-${OVERLAY}-${STAMP}" "$SERVED"
cp -a "$BASE/control-ui.bak-pre-${OVERLAY}-${STAMP}" "$BASE/control-ui"
cp -a "$BASE/pin.env.bak-pre-${OVERLAY}-${STAMP}" "$BASE/pin.env"
bash "$BASE/watch-control-ui-v3-pin.sh"
podman exec openbot-gateway-rc sh -c 'rm -rf /app/dist/control-ui && mkdir -p /app/dist/control-ui'
podman cp "$SERVED/." openbot-gateway-rc:/app/dist/control-ui/
```

---

## Previous cutover (2026-08-08 ~05:35 CST) — Control UI: daily overview polish + member governance r1 (`signals-overview-member-r1`)

| Field      | Value                                                                                                                                                             |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date       | 2026-08-08 (UI live ~05:35 CST / artifact `20260807T213454Z`)                                                                                                     |
| Decision   | 每日概览去掉摘要行、日程条目左对齐；协作小组成员管理修复「添加成员」toggle 误关闭、补齐 owner 角色与邀请撤销接线。                                                |
| Source     | Local WIP `pnpm ui:build` → `openbot-control-ui-signals-overview-member-r1-20260807T213454Z.tar.gz` (`index-CRGG0acg.js`, md5 `5819d48ed6250bfb57099f684b3b4b24`) |
| Build mode | Control UI overlay → served root + baseline + container embed（gateway dist 不变）                                                                                |
| Container  | `openbot-gateway-rc`                                                                                                                                              |
| Control UI | `index-CRGG0acg.js`                                                                                                                                               |
| Gateway    | unchanged overlay `employee-chat-session-acl-r1`                                                                                                                  |
| Pin        | `OPENBOT_UI_OVERLAY_PINNED_ENTRY=index-CRGG0acg.js`                                                                                                               |
| Smoke      | healthz **200**; readyz **ready:true**; watch exit **0**; www/gw → `index-CRGG0acg.js`; verify-control-ui-v3 **OK**                                               |
| Rollback   | restore `/root/.openbot/control-ui.bak-pre-signals-overview-member-r1-20260807T213454Z` + baseline/pin bak then watch                                             |
| Executor   | `cursor-composer`                                                                                                                                                 |
| Merge-back | Pending — source local WIP (not yet on `main`).                                                                                                                   |

### Rollback

```bash
STAMP=20260807T213454Z
OVERLAY=signals-overview-member-r1
BASE=/root/openbot-ui-baselines/v3.0
SERVED=/root/.openbot/control-ui
chattr -i "$BASE/pin.env" 2>/dev/null || true
rm -rf "$SERVED" "$BASE/control-ui"
cp -a "${SERVED}.bak-pre-${OVERLAY}-${STAMP}" "$SERVED"
cp -a "$BASE/control-ui.bak-pre-${OVERLAY}-${STAMP}" "$BASE/control-ui"
cp -a "$BASE/pin.env.bak-pre-${OVERLAY}-${STAMP}" "$BASE/pin.env"
bash "$BASE/watch-control-ui-v3-pin.sh"
podman exec openbot-gateway-rc sh -c 'rm -rf /app/dist/control-ui && mkdir -p /app/dist/control-ui'
podman cp "$SERVED/." openbot-gateway-rc:/app/dist/control-ui/
```

---

## Prior cutover (2026-08-08 ~05:05 CST) — Control UI: daily overview parallel cards r1 (`signals-daily-overview-r1`)

| Field      | Value                                                                                                                                                            |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date       | 2026-08-08 (UI live ~05:05 CST / artifact `20260807T210446Z`)                                                                                                    |
| Decision   | 员工端「每日概览」变形：待办为空时不应把日程卡拉满宽、待办压成 40px 竖条；始终 50/50 并排展示「今日日程」与「待办事项」，空侧显示空态文案。                      |
| Source     | Local WIP `pnpm ui:build` → `openbot-control-ui-signals-daily-overview-r1-20260807T210446Z.tar.gz` (`index-KHP1NU70.js`, md5 `ac0f6cee3f4d8c692c9e01ac1e40acf4`) |
| Build mode | Control UI overlay → served root + baseline + container embed（gateway dist 不变）                                                                               |
| Container  | `openbot-gateway-rc`                                                                                                                                             |
| Control UI | `index-KHP1NU70.js`                                                                                                                                              |
| Gateway    | unchanged overlay `employee-chat-session-acl-r1` @ `c615972a9b`                                                                                                  |
| Pin        | `OPENBOT_UI_OVERLAY_PINNED_ENTRY=index-KHP1NU70.js`                                                                                                              |
| Smoke      | healthz **200**; readyz **ready:true**; watch exit **0**; www/gw → `index-KHP1NU70.js`; live bundle has no `todos-collapsed` / `schedule-collapsed` grid classes |
| Rollback   | restore `/root/.openbot/control-ui.bak-pre-signals-daily-overview-r1-20260807T210446Z` + baseline/pin bak then watch                                             |
| Executor   | `cursor-composer`                                                                                                                                                |
| Merge-back | Runtime source on `main` via https://github.com/gmood2008/openbot/pull/307                                                                                       |

### Rollback

```bash
STAMP=20260807T210446Z
OVERLAY=signals-daily-overview-r1
BASE=/root/openbot-ui-baselines/v3.0
SERVED=/root/.openbot/control-ui
chattr -i "$BASE/pin.env" 2>/dev/null || true
rm -rf "$SERVED" "$BASE/control-ui"
cp -a "${SERVED}.bak-pre-${OVERLAY}-${STAMP}" "$SERVED"
cp -a "$BASE/control-ui.bak-pre-${OVERLAY}-${STAMP}" "$BASE/control-ui"
cp -a "$BASE/pin.env.bak-pre-${OVERLAY}-${STAMP}" "$BASE/pin.env"
bash "$BASE/watch-control-ui-v3-pin.sh"
podman exec openbot-gateway-rc sh -c 'rm -rf /app/dist/control-ui && mkdir -p /app/dist/control-ui'
podman cp "$SERVED/." openbot-gateway-rc:/app/dist/control-ui/
```

---

## Prior cutover (2026-08-07 ~21:18 CST) — collaboration space create + member invite fix r1

| Field           | Value                                                                                                                                                                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Date            | 2026-08-07 (live ~21:18 CST / artifact `20260807T131659Z`)                                                                                                                                                                                       |
| Decision        | 协作小组组建：创建者自动入群为 owner；自有 bot 直加（position owner 通过 seat 映射授权）；邀请 UX 单行 loading；网关 `ensureCreatorHumanMember` + `promoteSelfOwnedBotInvites`。                                                                 |
| Source          | Local WIP `pnpm build` → `openbot-gateway-dist-collaboration-space-create-r1-20260807T131659Z.tar.gz` + `openbot-control-ui-collaboration-space-create-r1-20260807T131659Z.tar.gz` (`index-D4OgyRnd.js`, md5 `fd0ed411dabe32ec68c89b33995c03e0`) |
| Build mode      | Gateway dist overlay (exclude control-ui from tar) + Control UI overlay → served root + baseline + container embed                                                                                                                               |
| Container       | `openbot-gateway-rc`                                                                                                                                                                                                                             |
| Control UI      | `index-D4OgyRnd.js`                                                                                                                                                                                                                              |
| Gateway overlay | `collaboration-space-create-r1` @ `d8c84259f2`                                                                                                                                                                                                   |
| Smoke           | healthz **200**; readyz **ready:true**; verify/watch exit **0**; www/gw → `index-D4OgyRnd.js`; gateway markers `ensureCreatorHumanMember` present                                                                                                |
| Rollback        | restore `/root/openbot-maintenance-collaboration-space-create-r1-20260807T131659Z/container-app-dist.before.tgz` + UI/pin bak under same stamp                                                                                                   |
| Executor        | `cursor-composer`                                                                                                                                                                                                                                |
| Merge-back      | Runtime source on `main` via #294 (invite UX) + #295 (actorEmployeeUserId / creator+bot ownership).                                                                                                                                              |

### Rollback

```bash
STAMP=20260807T131659Z
OVERLAY=collaboration-space-create-r1
BK=/root/openbot-maintenance-${OVERLAY}-${STAMP}
BASE=/root/openbot-ui-baselines/v3.0
SERVED=/root/.openbot/control-ui
mkdir -p /tmp/gw-dist-rollback && rm -rf /tmp/gw-dist-rollback/*
tar xzf "$BK/container-app-dist.before.tgz" -C /tmp/gw-dist-rollback
podman exec openbot-gateway-rc sh -c 'rm -rf /app/dist && mkdir -p /app/dist'
podman cp /tmp/gw-dist-rollback/dist/. openbot-gateway-rc:/app/dist/
chattr -i "$BASE/pin.env" 2>/dev/null || true
rm -rf "$SERVED" "$BASE/control-ui"
cp -a "${SERVED}.bak-pre-${OVERLAY}-${STAMP}" "$SERVED"
cp -a "$BASE/control-ui.bak-pre-${OVERLAY}-${STAMP}" "$BASE/control-ui"
cp -a "$BASE/pin.env.bak-pre-${OVERLAY}-${STAMP}" "$BASE/pin.env"
bash "$BASE/watch-control-ui-v3-pin.sh"
podman restart openbot-gateway-rc
```

---

## Prior cutover (2026-08-07 ~11:26 CST) — Control UI: admin fallback + stale growth-task-gate chunk r1

| Field      | Value                                                                                                                                                                                                                                  |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date       | 2026-08-07 (UI live ~11:26 CST / artifact `20260807T032538Z`)                                                                                                                                                                          |
| Decision   | (1) `admin.openbot.love` 无平台权限时被打回员工端 `"me"` → 改为回退 `platformLogin`（biz → `enterpriseLogin`）。(2) 对话反复报 `growth-task-gate-*.js` 404——旧 tab 缓存旧 index；恢复旧 chunk + 新 bundle 对动态导入失败做一次硬刷新。 |
| Source     | Local WIP `pnpm ui:build` → `openbot-control-ui-admin-fallback-stale-chunk-r1-20260807T032538Z.tar.gz` (`index-6OGl438j.js`)                                                                                                           |
| Build mode | Control UI overlay → served root + baseline + container embed（gateway dist 不变）                                                                                                                                                     |
| Container  | `openbot-gateway-rc`                                                                                                                                                                                                                   |
| Control UI | `index-6OGl438j.js` + stale-chunk reload helper                                                                                                                                                                                        |
| Pin        | `OPENBOT_UI_OVERLAY_PINNED_ENTRY=index-6OGl438j.js`                                                                                                                                                                                    |
| Smoke      | healthz **200**; www/admin/gw → `index-6OGl438j.js`; markers `openbot:stale-chunk-reload` + `platformLogin`                                                                                                                            |
| Rollback   | restore `/root/.openbot/control-ui.bak-pre-admin-fallback-stale-chunk-r1-20260807T032538Z` + baseline/pin bak then watch                                                                                                               |
| Executor   | `cursor-fable`                                                                                                                                                                                                                         |
| Merge-back | Source landed on `main` via merge-back PR (runtime was LIVE as overlay before trunk contained the commits).                                                                                                                            |

### Rollback

```bash
STAMP=20260807T032538Z
OVERLAY=admin-fallback-stale-chunk-r1
BASE=/root/openbot-ui-baselines/v3.0
SERVED=/root/.openbot/control-ui
chattr -i "$BASE/pin.env" 2>/dev/null || true
rm -rf "$SERVED" "$BASE/control-ui"
cp -a "${SERVED}.bak-pre-${OVERLAY}-${STAMP}" "$SERVED"
cp -a "$BASE/control-ui.bak-pre-${OVERLAY}-${STAMP}" "$BASE/control-ui"
cp -a "$BASE/pin.env.bak-pre-${OVERLAY}-${STAMP}" "$BASE/pin.env"
. "$BASE/pin.env"
bash "$BASE/watch-control-ui-v3-pin.sh"
```

---

## Prior cutover (2026-08-07 ~11:05 CST) — Control UI r2 + gateway snapshot: configured providers in model list (`platform-model-list-merge-r2`)

| Field      | Value                                                                                                                                                                                               |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date       | 2026-08-07 (live ~11:05 CST / `20260807T030402Z`)                                                                                                                                                   |
| Decision   | 「阶跃星辰/step-3.5-flash 仍不可见」——(1) 非 dirty 时 stale `configForm` 遮蔽 `configSnapshot`；(2) snapshot filter 过严；(3) 后端 snapshot 未投影 `models.providers`；(4) 添加弹窗支持多模型勾选。 |
| Source     | Local UI+gateway overlays `platform-model-list-merge-r2` (`index-uxKIN8fj.js`)                                                                                                                      |
| Build mode | Control UI overlay + gateway dist overlay                                                                                                                                                           |
| Container  | `openbot-gateway-rc`                                                                                                                                                                                |
| Control UI | config 读取优先级 + directory merge + multi-row bootstrap                                                                                                                                           |
| Gateway    | `platform-models-snapshot.ts` — `buildAssets` 补充 `models.providers`                                                                                                                               |
| Smoke      | healthz **200**; readyz **ready:true**; admin pin later superseded by admin-fallback                                                                                                                |
| Executor   | `cursor-composer` / merge-back `cursor-fable`                                                                                                                                                       |
| Merge-back | Source landed on `main` via merge-back PR.                                                                                                                                                          |

---

## Prior cutover (2026-08-07 ~10:22 CST) — surgical Control UI: platform model list merge r1 (`platform-model-list-merge-r1`)

| Field      | Value                                                                                 |
| ---------- | ------------------------------------------------------------------------------------- |
| Date       | 2026-08-07 (UI live ~10:22 CST / `20260807T022239Z`)                                  |
| Decision   | 平台模型管理「添加模型保存后列表不可见」——snapshot 模式未合并 `modelDirectory` 新行。 |
| Source     | Local UI overlay `platform-model-list-merge-r1` (`index-DnCRtAMP.js`)                 |
| Build mode | Control UI overlay                                                                    |
| Executor   | `cursor-composer` / merge-back `cursor-fable`                                         |
| Merge-back | Folded into same source PR as r2.                                                     |

---

## Prior cutover (2026-08-07 ~09:34 CST) — Port WIP main align (`port-wip-main-align`)

| Field           | Value                                                                                                                                                                                                                                                            |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date            | 2026-08-07 (gateway+UI live ~09:34 CST / artifact `20260807T013226Z`)                                                                                                                                                                                            |
| Decision        | Port WIP PRs **#282–#287** merged to `main` (`4f249e67da`) — full-dist align production to tip (employee workbench, platform models, pending-tasks, chat checkpoint, exec-approvals governance, Moonshot wrappers, gateway WS rate-limit + cookie bridge).       |
| Source          | `origin/main` @ `4f249e67da`; local `pnpm build` → `/tmp/openbot-gateway-dist-port-wip-main-align-20260807T013226Z.tar.gz` + `/tmp/openbot-control-ui-port-wip-main-align-20260807T013226Z.tar.gz` (`index-B64iMwWA.js`, md5 `054aa60fb743f4fa5769d92b0b130a4e`) |
| Build mode      | Full-dist (gateway dist overlay excl. control-ui + Control UI served/baseline/container embed); container image `localhost/openbot:prod-immutable-20260806T143410Z`                                                                                              |
| Container       | `openbot-gateway-rc`                                                                                                                                                                                                                                             |
| Gateway overlay | `port-wip-main-align` — `build-info.commit=4f249e67da`; `buildMode=full-dist`                                                                                                                                                                                    |
| Control UI      | `index-B64iMwWA.js`                                                                                                                                                                                                                                              |
| Pin             | `OPENBOT_UI_OVERLAY_PINNED_ENTRY=index-B64iMwWA.js`; forbidden includes prior `DgJEtFAN` / `Z-a1phft` / `CH4iiZw_`                                                                                                                                               |
| Smoke           | healthz **200**; readyz **ready:true**; watch exit **0**; openbot.love/www → `index-B64iMwWA.js`; gw.openbot.love healthz/readyz **200**; freeze_caps=13 / settings_nav=button / isolation_ui=1                                                                  |
| Forward-only    | LIVE was `0d595b26fb` (`save-archive-preview-id-r1`); `verify --live-sha 0d595b26fb --candidate origin/main` → **allow**                                                                                                                                         |
| Rollback        | restore `/root/openbot-maintenance-port-wip-main-align-20260807T013226Z/container-app-dist-pkg.before.tgz` + served/baseline/pin backups in same dir                                                                                                             |
| Executor        | `cursor-composer`                                                                                                                                                                                                                                                |

### Rollback

```bash
STAMP=20260807T013226Z
OVERLAY=port-wip-main-align
BK=/root/openbot-maintenance-${OVERLAY}-${STAMP}
BASE=/root/openbot-ui-baselines/v3.0
SERVED=/root/.openbot/control-ui
mkdir -p /tmp/gw-rollback && rm -rf /tmp/gw-rollback/*
tar xzf "$BK/container-app-dist-pkg.before.tgz" -C /tmp/gw-rollback
podman exec openbot-gateway-rc sh -c 'rm -rf /app/dist && mkdir -p /app/dist'
podman cp /tmp/gw-rollback/dist/. openbot-gateway-rc:/app/dist/
chattr -i "$BASE/pin.env" 2>/dev/null || true
cp -a "$BK/pin.env.before" "$BASE/pin.env"
rm -rf "$SERVED" "$BASE/control-ui"
cp -a "$BK/control-ui-served.before" "$SERVED"
cp -a "$BK/control-ui-baseline.before" "$BASE/control-ui"
. "$BASE/pin.env"
podman restart openbot-gateway-rc
sleep 15 && bash "$BASE/watch-control-ui-v3-pin.sh"
```

---

## Prior cutover (2026-08-07 ~09:12 CST) — Gateway: saveAndArchive prefer capture skill id (`save-archive-preview-id-r1`)

| Field           | Value                                                                                                                                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date            | 2026-08-07 (gateway live ~09:12 CST / artifact `20260807T010952Z`)                                                                                                                                      |
| Decision        | 侧栏保存报「已保存，知识库沉淀失败」——根因：UI 预览 `assistant-doc:*` 被当作 `deliverableId`，覆盖 capture 产出的 `skill:*`，ingest 报 `personal document not found`。网关改为优先用 capture skill id。 |
| Source          | Local WIP `save-and-archive.ts` + tests; gateway-only dist overlay `save-archive-preview-id-r1`                                                                                                         |
| Build mode      | Gateway dist overlay merge（preserve `/app/dist/control-ui` + UI pin）                                                                                                                                  |
| Container       | `openbot-gateway-rc`                                                                                                                                                                                    |
| Gateway overlay | `save-archive-preview-id-r1` — `resolveSaveArchiveDeliverableId` / `isPreviewArtifactDeliverableId`; build-info.commit=`0d595b26fb`                                                                     |
| Control UI      | unchanged pin at cutover (`index-DgJEtFAN.js`); later superseded by `port-wip-main-align`                                                                                                               |
| Smoke           | healthz **200**; readyz **ready:true**; FIX marker ≥1                                                                                                                                                   |
| Rollback        | restore `/root/openbot-maintenance-save-archive-preview-id-r1-20260807T010952Z/container-app-dist-pkg.before.tgz` into `/app/dist` then `podman restart openbot-gateway-rc`                             |
| Executor        | `cursor-fable`                                                                                                                                                                                          |
| Merge-back      | Source landed on `main` via merge-back PR (runtime was LIVE as overlay before trunk contained the commits).                                                                                             |

### Rollback

```bash
STAMP=20260807T010952Z
OVERLAY=save-archive-preview-id-r1
BK=/root/openbot-maintenance-${OVERLAY}-${STAMP}
CONTAINER=openbot-gateway-rc
podman exec "$CONTAINER" sh -c 'rm -rf /app/dist && mkdir -p /app/dist'
podman cp "$BK/container-app-dist-pkg.before.tgz" "$CONTAINER:/tmp/dist-rollback.tgz"
podman exec "$CONTAINER" sh -c 'cd /app && tar xzf /tmp/dist-rollback.tgz'
podman restart "$CONTAINER"
```

---

## Prior cutover (2026-08-07 ~04:31 CST) — Control UI restore: employee settings tabs r4

| Field      | Value                                                                                                                                                                                          |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date       | 2026-08-07 (UI live ~04:31 CST / artifact `20260806T203057Z`)                                                                                                                                  |
| Decision   | 用户反馈 openbot.love 刷新后仍为旧版——根因：`prod-immutable-20260806T143410Z` 切流后 pin 被 watch 拉回错误 bundle `index-CH4iiZw_.js`（含 `settings-group-item` 双排版、缺任务中心/紧凑 wb）。 |
| Source     | Local WIP `pnpm ui:build` → `openbot-control-ui-employee-settings-tabs-r4-20260806T203057Z.tar.gz` (`index-Z-a1phft.js`, md5 `3bcfcded97b77758f1af45384cc07df7`)                               |
| Build mode | Control UI overlay → served root + baseline + container embed（gateway dist 不变；`build-info.commit=a8bc031c34` from `pr280-main-align`）                                                     |
| Container  | `openbot-gateway-rc`                                                                                                                                                                           |
| Control UI | `index-Z-a1phft.js`（紧凑 wb 列表 + 任务中心 + 系统设置精修 + 用量 UI）                                                                                                                        |
| Gateway    | unchanged overlay `pr280-main-align` @ `a8bc031c34`                                                                                                                                            |
| Pin        | `OPENBOT_UI_OVERLAY_PINNED_ENTRY=index-Z-a1phft.js`; forbidden includes `CH4iiZw`, `BLQhC1UU`, `Bp07JiLU`, `DRphYb8_` css, …                                                                   |
| Smoke      | healthz **200**; watch exit **0**; openbot.love/www → `index-Z-a1phft.js`; markers settings-group-item=**0**, tasks≥2, wb-row-mark≥2, aggregateAll=**1**; gateway employee-visible **present** |
| Rollback   | restore `/root/.openbot/control-ui.bak-pre-employee-settings-tabs-r4-20260806T203057Z` + baseline/pin bak then watch                                                                           |
| Executor   | `cursor-composer`                                                                                                                                                                              |

### Rollback

```bash
STAMP=20260806T203057Z
OVERLAY=employee-settings-tabs-r4
BASE=/root/openbot-ui-baselines/v3.0
SERVED=/root/.openbot/control-ui
chattr -i "$BASE/pin.env" 2>/dev/null || true
rm -rf "$SERVED" "$BASE/control-ui"
cp -a "${SERVED}.bak-pre-${OVERLAY}-${STAMP}" "$SERVED"
cp -a "$BASE/control-ui.bak-pre-${OVERLAY}-${STAMP}" "$BASE/control-ui"
cp -a "$BASE/pin.env.bak-pre-${OVERLAY}-${STAMP}" "$BASE/pin.env"
. "$BASE/pin.env"
bash "$BASE/watch-control-ui-v3-pin.sh"
```

---

## Prior cutover (2026-08-07 ~04:29 CST) — PR #280 main merge production align (`pr280-main-align`)

| Field           | Value                                                                                                                                                                                                                                                          |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date            | 2026-08-07 (gateway+UI live ~04:29 CST / artifacts `20260806T202829Z`; UI superseded ~04:31 by employee-settings-tabs-r4)                                                                                                                                      |
| Decision        | Owner: PR #280 merged to `main` (`a8bc031c34`) — align production gateway dist to merged tip; interim full-dist UI pin `index-CH4iiZw_.js` later replaced by r4 `index-Z-a1phft.js` (gateway overlay retained).                                                |
| Source          | `origin/main` @ `a8bc031c34` (https://github.com/gmood2008/openbot/pull/280); local `pnpm build` + `pnpm ui:build` → `/tmp/openbot-gateway-dist-pr280-main-align-20260806T202829Z.tar.gz` + `/tmp/openbot-control-ui-pr280-main-align-20260806T202829Z.tar.gz` |
| Build mode      | Gateway dist overlay merge (control-ui excluded from gateway tar) + Control UI served/baseline/container embed; container image `localhost/openbot:prod-immutable-20260806T143410Z`                                                                            |
| Container       | `openbot-gateway-rc`                                                                                                                                                                                                                                           |
| Gateway overlay | `pr280-main-align` — `build-info.commit=a8bc031c34`; `resolveScopedAgentsForClient` ×6; `aggregateAll` ×4; `employee-visible` ×4; `pickValidPlatformAuthCookie` ×3                                                                                             |
| Control UI      | `index-CH4iiZw_.js` at cutover time (**superseded** by r4)                                                                                                                                                                                                     |
| Rollback        | restore `/root/openbot-maintenance-pr280-main-align-20260806T202829Z/container-app-dist-pkg.before.tgz` + served/baseline/pin backups in same dir                                                                                                              |
| Executor        | `cursor-fable`                                                                                                                                                                                                                                                 |

### Rollback

```bash
STAMP=20260806T202829Z
OVERLAY=pr280-main-align
BK=/root/openbot-maintenance-${OVERLAY}-${STAMP}
BASE=/root/openbot-ui-baselines/v3.0
SERVED=/root/.openbot/control-ui
mkdir -p /tmp/gw-rollback && rm -rf /tmp/gw-rollback/*
tar xzf "$BK/container-app-dist-pkg.before.tgz" -C /tmp/gw-rollback
podman cp /tmp/gw-rollback/dist/. openbot-gateway-rc:/app/dist/
chattr -i "$BASE/pin.env" 2>/dev/null || true
cp -a "$BK/pin.env.before" "$BASE/pin.env"
rm -rf "$SERVED" "$BASE/control-ui"
cp -a "$BK/control-ui-served.before" "$SERVED"
cp -a "$BK/control-ui-baseline.before" "$BASE/control-ui"
. "$BASE/pin.env"
podman restart openbot-gateway-rc
sleep 15 && bash "$BASE/watch-control-ui-v3-pin.sh"
```

---

## Prior cutover (2026-08-06 ~22:29 CST) — employee settings tabs r3 + gateway usage restore

| Field           | Value                                                                                                                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Date            | 2026-08-06 (UI + gateway live ~22:29 CST / artifact `20260806T142600Z`)                                                                                                                    |
| Decision        | 用户反馈导航 AI 不全、协作小组空、系统设置仍为旧版——根因：(1) 容器重启后 gateway 用量 overlay（`aggregateAll`）丢失；(2) 浏览器可能缓存旧 bundle（`CH4iiZw`/`BLQhC1UU`）或 CSS/JS 不一致。 |
| Source          | Local WIP `pnpm build` + `pnpm ui:build` → UI `index-Z-a1phft.js` + gateway dist overlay（exclude control-ui）                                                                             |
| Build mode      | Gateway dist UpperDir merge + Control UI served/baseline/container embed                                                                                                                   |
| Container       | `openbot-gateway-rc`                                                                                                                                                                       |
| Control UI      | `index-Z-a1phft.js`（build stamp `20260806T142600Z`；紧凑 wb 列表 + 任务中心）                                                                                                             |
| Gateway overlay | `aggregateAll` + `employee-visible` restored in `gateway-cli-BLvjug6B.js` / `gateway-cli-DnaAI9ph.js`                                                                                      |
| Pin             | `OPENBOT_UI_OVERLAY_PINNED_ENTRY=index-Z-a1phft.js`; forbidden includes `BLQhC1UU`, `CH4iiZw`, `Bp07JiLU`, …                                                                               |
| Smoke           | healthz **200**; watch exit **0**; www → `index-Z-a1phft.js`; markers tasks=2 wb=5 build=1; gateway aggregateAll **present**                                                               |
| Rollback        | restore `/root/openbot-maintenance-employee-settings-tabs-r3-20260806T142600Z/container-app-dist-pkg.before.tgz` + UI/pin bak                                                              |
| Executor        | `cursor-composer`                                                                                                                                                                          |

---

## Prior cutover (2026-08-06 ~22:14 CST) — surgical Control UI: employee settings tabs r2 + subdomain www-employee r1

| Field      | Value                                                                                                                                                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Date       | 2026-08-06 (UI live ~22:13–22:14 CST / artifacts `20260806T141243Z` + `20260806T141359Z`)                                                                                                                          |
| Decision   | Owner: (1) 员工端系统设置 +「我的任务」回滚修复（错误 pin `index-CH4iiZw_.js`）；(2) 子域错配——员工端规范域名 `www.openbot.love`（`gw` 旧别名跳转）、admin 上员工 tab 跨子域跳转、admin 无平台权限保留平台登录门。 |
| Source     | Local WIP `pnpm ui:build` → `openbot-control-ui-subdomain-www-employee-r1-20260806T141359Z.tar.gz` (`index-BLQhC1UU.js`, md5 `d7d698c51ee462c83699766ba4a18ac7`)                                                   |
| Build mode | Control UI overlay → served root + baseline + container embed（gateway dist 不变）                                                                                                                                 |
| Container  | `openbot-gateway-rc`                                                                                                                                                                                               |
| Host       | production Plan-A (`8.217.93.71`)                                                                                                                                                                                  |
| Control UI | `index-BLQhC1UU.js`（紧凑 wb 列表 + 任务中心 + www=员工端 + admin 错配跳转）                                                                                                                                       |
| Pin        | `OPENBOT_UI_OVERLAY_PINNED_ENTRY=index-BLQhC1UU.js`; forbidden includes `index-CH4iiZw_.js`, `index-Bp07JiLU.js`, `index-shC303vx.js`                                                                              |
| Smoke      | healthz **200**; readyz **ready:true**; verify/watch exit **0**; admin/www/gw/openbot.love → `index-BLQhC1UU.js`; marker `www:"employee",gw:"employee"` **ok**                                                     |
| Rollback   | restore `/root/.openbot/control-ui.bak-pre-subdomain-www-employee-r1-20260806T141359Z` (or `…141243Z` settings-only) + baseline/pin bak then watch                                                                 |
| Executor   | `cursor-composer`                                                                                                                                                                                                  |

### Rollback

```bash
STAMP=20260806T141359Z
BASE=/root/openbot-ui-baselines/v3.0
SERVED=/root/.openbot/control-ui
chattr -i "$BASE/pin.env" 2>/dev/null || true
rm -rf "$SERVED" "$BASE/control-ui"
cp -a "${SERVED}.bak-pre-subdomain-www-employee-r1-$STAMP" "$SERVED"
cp -a "$BASE/control-ui.bak-pre-subdomain-www-employee-r1-$STAMP" "$BASE/control-ui"
cp -a "$BASE/pin.env.bak-pre-subdomain-www-employee-r1-$STAMP" "$BASE/pin.env"
. "$BASE/pin.env"
bash "$BASE/watch-control-ui-v3-pin.sh"
```

---

## Prior cutover (2026-08-06 ~21:41 CST) — surgical gateway: employee-sessions-usage r1

| Field           | Value                                                                                                                                                                                                                             |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date            | 2026-08-06 (dist overlay live ~21:41 CST / artifact `20260806T133310Z` **r2-clean**)                                                                                                                                              |
| Decision        | Owner: 员工端「AI 模型」用量——Gateway `sessions.usage` 补齐 `aggregateAll` + 员工可见信封 `scope: employee-visible`；修复生产仍回旧协议导致「用量暂不可用」。构建需保留 prod 配置识别的 `cookieDomain` schema。                   |
| Source          | Local surgical gateway build（用量三文件 + 生产所需 `zod-schema`/`types.gateway` cookieDomain；排除其它 WIP）→ `/tmp/openbot-gateway-dist-employee-sessions-usage-r1-20260806T133310Z-r2-clean.tar.gz`（**control-ui excluded**） |
| Build mode      | Gateway **dist overlay merge**（UpperDir 写入；保留 `/app/dist/control-ui`；r1 曾因缺 `cookieDomain` 崩溃，r2-clean 恢复）                                                                                                        |
| Image tag       | unchanged (`localhost/openbot:ui-v3.0.11-embed-hydration`)                                                                                                                                                                        |
| Container       | `openbot-gateway-rc`                                                                                                                                                                                                              |
| Host            | production Plan-A (`8.217.93.71`)                                                                                                                                                                                                 |
| Gateway overlay | `employee-sessions-usage-r1`（runtime chunks `gateway-cli-CK10q9ZJ.js` / `gateway-cli-DO2iQPgl.js`）                                                                                                                              |
| Control UI      | **unchanged** pin `index-Bp07JiLU.js`（平台模型池 r3）                                                                                                                                                                            |
| Smoke           | healthz **200**; readyz **ready:true**; `aggregateAll`+`employee-visible` in gateway-cli; `cookieDomain` in config-\*; watch-control-ui-v3-pin exit **0**; public → `index-Bp07JiLU.js`                                           |
| Rollback        | restore `/root/openbot-maintenance-employee-sessions-usage-r1-20260806T133310Z/container-app-dist-pkg.before.tgz` into `/app/dist` then restart                                                                                   |
| Executor        | `cursor-composer`                                                                                                                                                                                                                 |

### Rollback

```bash
STAMP=20260806T133310Z
OVERLAY=employee-sessions-usage-r1
BK=/root/openbot-maintenance-${OVERLAY}-${STAMP}
mkdir -p /tmp/gw-dist-rollback && rm -rf /tmp/gw-dist-rollback/*
tar xzf "$BK/container-app-dist-pkg.before.tgz" -C /tmp/gw-dist-rollback
podman stop openbot-gateway-rc || true
UPPER=$(podman inspect openbot-gateway-rc --format '{{.GraphDriver.Data.UpperDir}}')
rm -rf "$UPPER/app/dist"
cp -a /tmp/gw-dist-rollback/dist "$UPPER/app/dist"
podman start openbot-gateway-rc
sleep 12 && curl -fsS http://127.0.0.1:18789/healthz && curl -fsS http://127.0.0.1:18789/readyz
```

---

## Prior cutover (2026-08-06 ~21:34 CST) — surgical Control UI: platform model pool r3

| Field      | Value                                                                                                                                                     |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date       | 2026-08-06 (UI live ~21:34 CST / `20260806T133349Z`)                                                                                                      |
| Decision   | Owner: 平台模型池 R3——修复入池/上架不可点（生命周期 source 误判、await 保存）；详情抽屉扁平化 KV 布局；移除误导性「加入推荐池」；主操作入池/上架单按钮。  |
| Source     | Surgical **Control UI-only** overlay on LIVE served root + re-embed `/app/dist/control-ui` only (gateway runtime untouched).                              |
| Build mode | Local `pnpm ui:build` → `openbot-control-ui-platform-model-pool-r3-20260806T133349Z.tar.gz` (`index-Bp07JiLU.js`, md5 `6b64a2e54a32df09aefaebbb4029643d`) |
| Image tag  | unchanged (filesystem overlay only)                                                                                                                       |
| Container  | `openbot-gateway-rc`                                                                                                                                      |
| Host       | production Plan-A (`8.217.93.71`)                                                                                                                         |
| Control UI | `index-Bp07JiLU.js`（入池/上架可点 + 详情 KV 抽屉 + 已配置→上架状态修正）                                                                                 |
| Pin        | `OPENBOT_UI_OVERLAY_PINNED_ENTRY=index-Bp07JiLU.js`; forbidden includes prior `index-0XtKyOw6.js`                                                         |
| Smoke      | healthz **200**; readyz **200**; verify/watch exit **0**; public admin/gw → `index-Bp07JiLU.js`; served markers `platform-model-detail-kv` + `保存中`     |
| Rollback   | restore `/root/.openbot/control-ui.bak-pre-platform-model-pool-r3-20260806T133349Z` + baseline/pin bak then watch                                         |
| Executor   | `cursor-composer`                                                                                                                                         |

### Rollback

```bash
STAMP=20260806T133349Z
BASE=/root/openbot-ui-baselines/v3.0
SERVED=/root/.openbot/control-ui
chattr -i "$BASE/pin.env" 2>/dev/null || true
rm -rf "$SERVED" "$BASE/control-ui"
cp -a "${SERVED}.bak-pre-platform-model-pool-r3-$STAMP" "$SERVED"
cp -a "$BASE/control-ui.bak-pre-platform-model-pool-r3-$STAMP" "$BASE/control-ui"
cp -a "$BASE/pin.env.bak-pre-platform-model-pool-r3-$STAMP" "$BASE/pin.env"
. "$BASE/pin.env"
bash "$BASE/watch-control-ui-v3-pin.sh"
```

---

## Prior cutover (2026-08-06 ~20:19 CST) — surgical Control UI: platform model pool r2

| Field      | Value                                                                                                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Date       | 2026-08-06 (UI live ~20:19 CST / `20260806T121818Z`)                                                                                                                           |
| Decision   | Owner: 平台模型池 R2——模型名称规范化（BYOK/租户专属 badge）；生命周期状态（待入池/已引用/已配置/已上架）；行操作入池/上架；详情抽屉管理台化；租户可选诚实推导。                |
| Source     | Surgical **Control UI-only** overlay on LIVE served root + re-embed `/app/dist/control-ui` only (gateway runtime untouched).                                                   |
| Build mode | Local `pnpm ui:build` → `openbot-control-ui-platform-model-pool-r2-20260806T121818Z.tar.gz` (`index-0XtKyOw6.js`, md5 `b0ec511d8a1b6f5f22047e32b8603ed8`)                      |
| Image tag  | unchanged (filesystem overlay only)                                                                                                                                            |
| Container  | `openbot-gateway-rc`                                                                                                                                                           |
| Host       | production Plan-A (`8.217.93.71`)                                                                                                                                              |
| Control UI | `index-0XtKyOw6.js`（模型名规范 + 状态列 + 入池/上架 + scope badge + 详情管理操作）                                                                                            |
| Pin        | `OPENBOT_UI_OVERLAY_PINNED_ENTRY=index-0XtKyOw6.js`; forbidden includes prior `index-0fJCXJ-q.js`                                                                              |
| Smoke      | healthz **200**; readyz **200**; verify/watch exit **0**; public admin/gw → `index-0XtKyOw6.js`; served markers `待入池` + `上架` + `platform-model-assets-table__scope-badge` |
| Rollback   | restore `/root/.openbot/control-ui.bak-pre-platform-model-pool-r2-20260806T121818Z` + baseline/pin bak then watch                                                              |
| Executor   | `cursor-composer`                                                                                                                                                              |

### Rollback

```bash
STAMP=20260806T121818Z
BASE=/root/openbot-ui-baselines/v3.0
SERVED=/root/.openbot/control-ui
chattr -i "$BASE/pin.env" 2>/dev/null || true
rm -rf "$SERVED" "$BASE/control-ui"
cp -a "${SERVED}.bak-pre-platform-model-pool-r2-$STAMP" "$SERVED"
cp -a "$BASE/control-ui.bak-pre-platform-model-pool-r2-$STAMP" "$BASE/control-ui"
cp -a "$BASE/pin.env.bak-pre-platform-model-pool-r2-$STAMP" "$BASE/pin.env"
. "$BASE/pin.env"
bash "$BASE/watch-control-ui-v3-pin.sh"
```

---

## Prior cutover (2026-08-06 ~19:47 CST) — surgical Control UI: tri-port host redirect r1

| Field      | Value                                                                                                                                                                                                                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date       | 2026-08-06 (UI live ~19:47 CST / `20260806T114624Z`)                                                                                                                                                                                                                                        |
| Decision   | Owner: 三端子域登录入口收口——公共首页企业/平台登录出站到 biz/admin；端口子域错配硬跳转（如 admin `/enterprise/login` → biz）。                                                                                                                                                              |
| Source     | Surgical **Control UI-only** overlay on LIVE served root + re-embed `/app/dist/control-ui` only (gateway runtime untouched).                                                                                                                                                                |
| Build mode | Local `pnpm ui:build` → `openbot-control-ui-tri-port-redirect-r1-20260806T114624Z.tar.gz` (`index-0fJCXJ-q.js`, md5 `81d43ac51fe087eb49c608f13b64415f`)                                                                                                                                     |
| Image tag  | unchanged (filesystem overlay only)                                                                                                                                                                                                                                                         |
| Container  | `openbot-gateway-rc`                                                                                                                                                                                                                                                                        |
| Host       | production Plan-A (`8.217.93.71`)                                                                                                                                                                                                                                                           |
| Control UI | `index-0fJCXJ-q.js`（`resolveOpenBotSubdomainRedirectUrl` 端口错配跳转；auth-home 生产域绝对登录链；setTab/syncTab 接线）                                                                                                                                                                   |
| Pin        | `OPENBOT_UI_OVERLAY_PINNED_ENTRY=index-0fJCXJ-q.js`; forbidden includes prior `index-Dp29lK31.js`                                                                                                                                                                                           |
| Smoke      | healthz **200**; readyz **200**; verify/watch exit **0**; public admin/biz/gw/www → `index-0fJCXJ-q.js`; browser: `admin…/enterprise/login` → `biz…/enterprise/login`；`biz…/platform/login` → `admin…/platform/login`；部署时磁盘曾满导致 nginx 大资源代理失败，清理后 http2 资产 md5 对齐 |
| Rollback   | restore `/root/.openbot/control-ui.bak-pre-tri-port-redirect-r1-20260806T114624Z` + baseline/pin bak then watch                                                                                                                                                                             |
| Executor   | `cursor-composer`                                                                                                                                                                                                                                                                           |

### Rollback

```bash
STAMP=20260806T114624Z
BASE=/root/openbot-ui-baselines/v3.0
SERVED=/root/.openbot/control-ui
chattr -i "$BASE/pin.env" 2>/dev/null || true
rm -rf "$SERVED" "$BASE/control-ui"
cp -a "${SERVED}.bak-pre-tri-port-redirect-r1-$STAMP" "$SERVED"
cp -a "$BASE/control-ui.bak-pre-tri-port-redirect-r1-$STAMP" "$BASE/control-ui"
cp -a "$BASE/pin.env.bak-pre-tri-port-redirect-r1-$STAMP" "$BASE/pin.env"
. "$BASE/pin.env"
bash "$BASE/watch-control-ui-v3-pin.sh"
```

---

## Prior cutover (2026-08-06 ~19:19 CST) — surgical Control UI: platform model pool fix r1

| Field      | Value                                                                                                                                                                 |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date       | 2026-08-06 (UI live ~19:19 CST / `20260806T111817Z`)                                                                                                                  |
| Decision   | Owner: 纠偏误放企业端的「模型池」——撤企业导航与独立页；改造平台「模型管理 → 模型池」主表（去「使用分析未接入」红条，提升租户可选/推荐池，降级输入输出/能力/上下文）。 |
| Source     | Surgical **Control UI-only** overlay on LIVE served root + re-embed `/app/dist/control-ui` only (gateway runtime untouched).                                          |
| Build mode | Local `pnpm ui:build` → `openbot-control-ui-platform-model-pool-fix-r1-20260806T111817Z.tar.gz` (`index-Dp29lK31.js`, md5 `b2ca4f34dd54dbafe7950f8e45c40b9d`)         |
| Image tag  | unchanged (filesystem overlay only)                                                                                                                                   |
| Container  | `openbot-gateway-rc`                                                                                                                                                  |
| Host       | production Plan-A (`8.217.93.71`)                                                                                                                                     |
| Control UI | `index-Dp29lK31.js`（平台 tab「模型池」；无「使用分析数据尚未接入」；主表含租户可选/推荐池）                                                                          |
| Pin        | `OPENBOT_UI_OVERLAY_PINNED_ENTRY=index-Dp29lK31.js`; forbidden includes prior `index-CDJ-EzGc.js`                                                                     |
| Smoke      | healthz **200**; readyz **200**; verify/watch exit **0**; public admin/gw → `index-Dp29lK31.js`; asset markers `租户可选`×5 + `正在加载模型池`×1；旧红条不存在        |
| Rollback   | restore `/root/.openbot/control-ui.bak-pre-platform-model-pool-fix-r1-20260806T111817Z` + baseline/pin bak then watch                                                 |
| Executor   | `cursor-composer`                                                                                                                                                     |

### Rollback

```bash
STAMP=20260806T111817Z
BASE=/root/openbot-ui-baselines/v3.0
SERVED=/root/.openbot/control-ui
chattr -i "$BASE/pin.env" 2>/dev/null || true
rm -rf "$SERVED" "$BASE/control-ui"
cp -a "${SERVED}.bak-pre-platform-model-pool-fix-r1-$STAMP" "$SERVED"
cp -a "$BASE/control-ui.bak-pre-platform-model-pool-fix-r1-$STAMP" "$BASE/control-ui"
cp -a "$BASE/pin.env.bak-pre-platform-model-pool-fix-r1-$STAMP" "$BASE/pin.env"
. "$BASE/pin.env"
bash "$BASE/watch-control-ui-v3-pin.sh"
```

---

## Prior cutover (2026-08-06 ~18:43 CST) — surgical Control UI: enterprise model pool r1

| Field      | Value                                                                                                                                                             |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date       | 2026-08-06 (UI live ~18:43 CST / `20260806T103940Z`)                                                                                                              |
| Decision   | Owner: 企业端一级导航「模型池」——配额/用量总览 + 模型清单 + 分配下钻；设置→集成改为跳转模型池，不再内嵌授权主路径。**已由 platform-model-pool-fix-r1 纠偏撤回。** |
| Source     | Surgical **Control UI-only** overlay on LIVE served root + re-embed `/app/dist/control-ui` only (gateway runtime untouched; remains `seat-tenant-wave2-r1`).      |
| Build mode | Local `pnpm ui:build` → `openbot-control-ui-enterprise-model-pool-r1-20260806T103940Z.tar.gz` (`index-CDJ-EzGc.js`, md5 `ccd163d9173e8aaf34739b8b36ff7fff`)       |
| Image tag  | unchanged (filesystem overlay only)                                                                                                                               |
| Container  | `openbot-gateway-rc`                                                                                                                                              |
| Host       | production Plan-A (`8.217.93.71`)                                                                                                                                 |
| Control UI | `index-CDJ-EzGc.js`（`enterpriseModelPool` / `模型池` / `/enterprise/model-pool`）                                                                                |
| Pin        | `OPENBOT_UI_OVERLAY_PINNED_ENTRY=index-CDJ-EzGc.js`; forbidden includes prior `index-COeWu_Ax.js`                                                                 |
| Smoke      | healthz **200**; readyz **200**; verify/watch exit **0**; public admin/gw → `index-CDJ-EzGc.js`; asset markers `enterpriseModelPool`×19 + `模型池`×26             |
| Rollback   | restore `/root/.openbot/control-ui.bak-pre-enterprise-model-pool-r1-20260806T103940Z` + baseline/pin bak then watch                                               |
| Executor   | `cursor-composer`                                                                                                                                                 |

### Rollback

```bash
STAMP=20260806T103940Z
BASE=/root/openbot-ui-baselines/v3.0
SERVED=/root/.openbot/control-ui
chattr -i "$BASE/pin.env" 2>/dev/null || true
rm -rf "$SERVED" "$BASE/control-ui"
cp -a "${SERVED}.bak-pre-enterprise-model-pool-r1-$STAMP" "$SERVED"
cp -a "$BASE/control-ui.bak-pre-enterprise-model-pool-r1-$STAMP" "$BASE/control-ui"
cp -a "$BASE/pin.env.bak-pre-enterprise-model-pool-r1-$STAMP" "$BASE/pin.env"
. "$BASE/pin.env"
bash "$BASE/watch-control-ui-v3-pin.sh"
```

---

## Prior cutover (2026-08-06 ~18:41 CST) — surgical gateway: seat-tenant-wave2 r1

| Field           | Value                                                                                                                                                                                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Date            | 2026-08-06 (dist overlay live ~18:41 CST / artifact `20260806T103936Z`)                                                                                                                                                              |
| Decision        | Owner: Wave-2 tenant seat I/O — collab org-bot-directory / space-store, employee+enterprise capability, enterprise-data seat context, session-context, agent-run-scope prefer `loadSeatAssetsStoreForTenantId`; CI allowlist shrunk. |
| Source          | Branch `cursor-fable/tenant-conflict-resolve` @ `3c032e1a24` (`9b4ee97d7a` gateway + docs); local `pnpm build` → `/tmp/openbot-gateway-dist-seat-tenant-wave2-r1-20260806T103936Z.tar.gz` (**control-ui excluded** from tarball)     |
| Build mode      | Gateway **dist overlay merge** (preserve `/app/dist/control-ui`); UI pin at cutover was `index-COeWu_Ax.js` (later superseded by model-pool UI pin)                                                                                  |
| Container       | `openbot-gateway-rc`                                                                                                                                                                                                                 |
| Host            | production Plan-A (`8.217.93.71`)                                                                                                                                                                                                    |
| Gateway overlay | `seat-tenant-wave2-r1`                                                                                                                                                                                                               |
| Smoke           | healthz **200**; readyz **ready:true**; verify/watch exit **0**; `loadSeatAssetsStoreForTenantId(membership.enterpriseId)` in gateway-cli; UI pin then `index-COeWu_Ax.js`                                                           |
| Rollback        | restore `/root/openbot-maintenance-seat-tenant-wave2-r1-20260806T103936Z/container-app-dist-pkg.before.tgz` into `/app/dist` then restart                                                                                            |
| Executor        | `cursor-fable`                                                                                                                                                                                                                       |

### Rollback

```bash
STAMP=20260806T103936Z
OVERLAY=seat-tenant-wave2-r1
BK=/root/openbot-maintenance-${OVERLAY}-${STAMP}
mkdir -p /tmp/gw-dist-rollback && rm -rf /tmp/gw-dist-rollback/*
tar xzf "$BK/container-app-dist-pkg.before.tgz" -C /tmp/gw-dist-rollback
podman exec openbot-gateway-rc sh -c 'rm -rf /app/dist && mkdir -p /app/dist'
podman cp /tmp/gw-dist-rollback/dist/. openbot-gateway-rc:/app/dist/
podman restart openbot-gateway-rc
sleep 12 && curl -fsS http://127.0.0.1:18789/healthz && curl -fsS http://127.0.0.1:18789/readyz
```

---

## Branch alignment (2026-08-06 ~18:20 CST) — Phase-3 proxy wrap-up landed on git; **no prod cutover**

| Field      | Value                                                                                                                                                                                          |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date       | 2026-08-06 (git only; later superseded on prod by `seat-tenant-wave2-r1`)                                                                                                                      |
| Decision   | Owner: Phase-3 CONFLICT proxy wrap-up — chat surface isolation, platform tenant IA, checkpoint restore test, Loom `sharedPaths`. Local merge gate green; UI bundle md5 unchanged vs live prod. |
| Source     | Branch `cursor-fable/tenant-conflict-resolve` @ `2439360ab2` (`52319c031d`…`2439360ab2` proxy batch); PR https://github.com/gmood2008/openbot/pull/280                                         |
| Build mode | **None** — at write time prod was `isolation-fail-closed-r1` @ `a173354060`; UI pin `index-COeWu_Ax.js` md5 `39bb43d31be29560d19313a402ef4f35`                                                 |
| Merge gate | scoped tests 15/15; isolation guard ok; **merged to `main` @ `a8bc031c34` 2026-08-06**; gateway prod aligned via `pr280-main-align` 2026-08-07                                                 |
| Executor   | `cursor-fable`                                                                                                                                                                                 |

---

## Prior cutover (2026-08-06 ~17:42 CST) — surgical gateway: isolation fail-closed r1

| Field           | Value                                                                                                                                                                                                                                                                                                                                  |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date            | 2026-08-06 (dist overlay live ~17:42 CST / artifact `20260806T094125Z`)                                                                                                                                                                                                                                                                |
| Decision        | Owner: Phase-3 tenant isolation — personal-workbench rosters/sessions fail-closed (`resolveScopedAgentsForClient`, chat session ACL, `agents.files.*` gates, `collaboration.space.get` visibility, tenant-scoped mesh governance). Align build-info to branch tip @ `a173354060` (includes cookie-domain-dup-fix + isolation commits). |
| Source          | Branch `cursor-fable/tenant-conflict-resolve` @ `a173354060` (`188e9f61eb` isolation + `bcb85b1108` cookie migration); local `pnpm build` → `/tmp/openbot-gateway-dist-isolation-fail-closed-r1-20260806T094125Z.tar.gz`                                                                                                               |
| Build mode      | Gateway **dist overlay** (`cd /app/dist && tar xzf -`); gateway-cli hash unchanged vs `cookie-domain-dup-fix-r1` (audit stamp only); UI pin unchanged `index-COeWu_Ax.js`                                                                                                                                                              |
| Container       | `openbot-gateway-rc`                                                                                                                                                                                                                                                                                                                   |
| Host            | production Plan-A (`8.217.93.71`)                                                                                                                                                                                                                                                                                                      |
| Gateway overlay | `isolation-fail-closed-r1`                                                                                                                                                                                                                                                                                                             |
| Smoke           | healthz **200**; readyz **ready:true**; verify/watch exit **0**; `resolveScopedAgentsForClient` ×5 + `resolvePersonalWorkbenchSessionAccessDenial` ×3 in gateway-cli; `pickValidPlatformAuthCookie` ×2 in auth-profiles                                                                                                                |
| Rollback        | restore `/root/openbot-maintenance-isolation-fail-closed-r1-20260806T094125Z/container-app-dist-pkg.before.tgz` into `/app/dist` then restart                                                                                                                                                                                          |
| Executor        | `cursor-fable`                                                                                                                                                                                                                                                                                                                         |

### Rollback

```bash
STAMP=20260806T094125Z
OVERLAY=isolation-fail-closed-r1
BK=/root/openbot-maintenance-${OVERLAY}-${STAMP}
mkdir -p /tmp/gw-dist-rollback && rm -rf /tmp/gw-dist-rollback/*
tar xzf "$BK/container-app-dist-pkg.before.tgz" -C /tmp/gw-dist-rollback
podman exec openbot-gateway-rc sh -c 'rm -rf /app/dist && mkdir -p /app/dist'
podman cp /tmp/gw-dist-rollback/dist/. openbot-gateway-rc:/app/dist/
podman restart openbot-gateway-rc
sleep 12 && curl -fsS http://127.0.0.1:18789/healthz && curl -fsS http://127.0.0.1:18789/readyz
```

---

## Prior cutover (2026-08-06 ~17:35 CST) — surgical gateway: cookie Domain= duplicate fix r1

| Field           | Value                                                                                                                                                                                                                                                                              |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date            | 2026-08-06 (dist overlay live ~17:35 CST / artifact `20260806T093300Z`)                                                                                                                                                                                                            |
| Decision        | Owner: 平台登录 200 后仍提示「浏览器未保存平台会话 Cookie」——根因是 8/4 启用 `cookieDomain=openbot.love` 后，浏览器同时发送 legacy host-only + Domain Cookie；服务端 `parseCookieHeader` 只取第一个（空/失效）导致会话读失败。修复：多值 HMAC 择优 + 登录/登出同时清理 host-only。 |
| Source          | Branch `cursor-fable/tenant-conflict-resolve` local WIP (`session-context` / `auth-helpers` / `routes-auth`); `pnpm build` → `/tmp/openbot-gateway-dist-cookie-domain-dup-fix-r1-20260806T093300Z.tar.gz`                                                                          |
| Build mode      | Gateway **dist overlay**; UI pin unchanged `index-COeWu_Ax.js`                                                                                                                                                                                                                     |
| Container       | `openbot-gateway-rc`                                                                                                                                                                                                                                                               |
| Host            | production Plan-A (`8.217.93.71`)                                                                                                                                                                                                                                                  |
| Gateway overlay | `cookie-domain-dup-fix-r1`                                                                                                                                                                                                                                                         |
| Smoke           | healthz **200**; readyz **ready:true**; stale/empty-first duplicate Cookie → `sessionKind=platform-super-admin`; logout emits host-only + Domain clear Set-Cookie                                                                                                                  |
| Rollback        | restore `/root/openbot-maintenance-cookie-domain-dup-fix-r1-20260806T093300Z/container-app-dist-pkg.before.tgz` into `/app/dist` then restart                                                                                                                                      |
| Executor        | `cursor-fable`                                                                                                                                                                                                                                                                     |

### Rollback

```bash
STAMP=20260806T093300Z
OVERLAY=cookie-domain-dup-fix-r1
BK=/root/openbot-maintenance-${OVERLAY}-${STAMP}
mkdir -p /tmp/gw-dist-rollback && rm -rf /tmp/gw-dist-rollback/*
tar xzf "$BK/container-app-dist-pkg.before.tgz" -C /tmp/gw-dist-rollback
podman exec openbot-gateway-rc sh -c 'rm -rf /app/dist && mkdir -p /app/dist'
podman cp /tmp/gw-dist-rollback/dist/. openbot-gateway-rc:/app/dist/
podman restart openbot-gateway-rc
sleep 12 && curl -fsS http://127.0.0.1:18789/healthz && curl -fsS http://127.0.0.1:18789/readyz
```

---

## Prior cutover (2026-08-06 ~17:30 CST) — surgical gateway: mesh growth tenant scope r1

| Field           | Value                                                                                                                                                                                                                                                                         |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date            | 2026-08-06 (dist overlay live ~17:30 CST / artifact `20260806T092938Z`)                                                                                                                                                                                                       |
| Decision        | Owner: tenant-context Phase-2 follow-up — `listTenantMeshGrowthAgents` must read seat assets via `loadSeatAssetsStoreForTenantId(tenantId)` (not legacy enterprise-wide loader). Also lands UI admin-shell + session-cookie commits @ `6e164a24f3` in build-info audit trail. |
| Source          | Branch `cursor-fable/tenant-conflict-resolve` @ `6e164a24f3` (`d4c4488152` mesh-growth + `ad191810e2`/`6e164a24f3` UI); local `pnpm build` → `/tmp/openbot-gateway-dist-mesh-growth-tenant-scope-r1-20260806T092938Z.tar.gz`                                                  |
| Build mode      | Gateway **dist overlay** (`cd /app/dist && tar xzf -`); runtime bundle hash unchanged vs `enterprise-admin-activation-r1` (build-info commit/overlay stamp updated); UI pin unchanged `index-COeWu_Ax.js` (local bundle md5 matched served root — **no separate UI cutover**) |
| Container       | `openbot-gateway-rc`                                                                                                                                                                                                                                                          |
| Host            | production Plan-A (`8.217.93.71`)                                                                                                                                                                                                                                             |
| Gateway overlay | `mesh-growth-tenant-scope-r1`                                                                                                                                                                                                                                                 |
| Smoke           | healthz **200**; readyz **ready:true**; verify/watch exit **0**; `listTenantMeshGrowthAgents` uses `loadSeatAssetsStoreForTenantId(tenantId)` @ gateway-cli L23211; build-info commit `6e164a24f3`                                                                            |
| Rollback        | restore `/root/openbot-maintenance-mesh-growth-tenant-scope-r1-20260806T092938Z/container-app-dist-pkg.before.tgz` into `/app/dist` then restart                                                                                                                              |
| Executor        | `cursor-fable`                                                                                                                                                                                                                                                                |

### Rollback

```bash
STAMP=20260806T092938Z
OVERLAY=mesh-growth-tenant-scope-r1
BK=/root/openbot-maintenance-${OVERLAY}-${STAMP}
mkdir -p /tmp/gw-dist-rollback && rm -rf /tmp/gw-dist-rollback/*
tar xzf "$BK/container-app-dist-pkg.before.tgz" -C /tmp/gw-dist-rollback
podman exec openbot-gateway-rc sh -c 'rm -rf /app/dist && mkdir -p /app/dist'
podman cp /tmp/gw-dist-rollback/dist/. openbot-gateway-rc:/app/dist/
podman restart openbot-gateway-rc
sleep 12 && curl -fsS http://127.0.0.1:18789/healthz && curl -fsS http://127.0.0.1:18789/readyz
```

---

## Prior cutover (2026-08-06 ~17:15 CST) — surgical gateway: enterprise admin activation r1

| Field           | Value                                                                                                                                                                                                                                   |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date            | 2026-08-06 (dist overlay live ~17:15 CST / artifact `20260806T091434Z`)                                                                                                                                                                 |
| Decision        | Owner: Phase-2c tenant-context — enterprise admin activation emails must deep-link to `biz.* /enterprise/login?authMode=enterprise-activate` (not admin/gw origin); space bot members auto-stamp ownership + self-promote invited bots. |
| Source          | Branch `cursor-fable/tenant-conflict-resolve` @ `3c64776250` (`0ba8e1b348` Phase-2c + `3c64776250` password-login delegate); local `pnpm build` → `/tmp/openbot-gateway-dist-enterprise-admin-activation-r1-20260806T091434Z.tar.gz`    |
| Build mode      | Gateway **dist overlay** (`cd /app/dist && tar xzf -`); embedded control-ui matches current pin `index-COeWu_Ax.js` (unchanged vs pre-overlay backup)                                                                                   |
| Container       | `openbot-gateway-rc`                                                                                                                                                                                                                    |
| Host            | production Plan-A (`8.217.93.71`)                                                                                                                                                                                                       |
| Gateway overlay | `enterprise-admin-activation-r1`                                                                                                                                                                                                        |
| Smoke           | healthz **200**; readyz **ready:true**; verify/watch exit **0**; dist contains `enterprise-activate` in `auth-profiles` + `main-session`; `loadSeatAssetsStoreForTenantId` ×6 in gateway-cli bundles                                    |
| Rollback        | restore `/root/openbot-maintenance-enterprise-admin-activation-r1-20260806T091434Z/container-app-dist-pkg.before.tgz` into `/app/dist` then restart                                                                                     |
| Executor        | `cursor-composer`                                                                                                                                                                                                                       |

---

## Prior cutover (2026-08-06 17:13 CST) — surgical Control UI: session cookie land-check r1

| Field      | Value                                                                                                                                                                                             |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date       | 2026-08-06 (UI live ~17:13 CST / `20260806T091327Z`)                                                                                                                                              |
| Decision   | Owner: 平台「模型管理」连不上 Gateway — 登录 JSON 可画出平台壳，但浏览器未落地 `openbot_platform_session`，WS 报 `platform session missing`。登录成功后先 `GET /session` 校验 Cookie 再 connect。 |
| Source     | Surgical **Control UI-only** overlay on LIVE served root + re-embed `/app/dist/control-ui` only (gateway runtime untouched).                                                                      |
| Build mode | Local `pnpm ui:build` → `openbot-control-ui-session-cookie-check-20260806T091327Z.tar.gz` (`index-COeWu_Ax.js`)                                                                                   |
| Image tag  | unchanged (filesystem overlay only)                                                                                                                                                               |
| Container  | `openbot-gateway-rc`                                                                                                                                                                              |
| Host       | production Plan-A (`8.217.93.71`)                                                                                                                                                                 |
| Control UI | `index-COeWu_Ax.js`（`connectAfterSessionCookie`；Cookie 未落地时明确报错；保留模型页断开提示）                                                                                                   |
| Pin        | `OPENBOT_UI_OVERLAY_PINNED_ENTRY=index-COeWu_Ax.js`; forbidden includes prior `index-shC303vx.js`                                                                                                 |
| Smoke      | healthz **200**; readyz **200**; verify freeze_caps=13; public admin/gw → `index-COeWu_Ax.js`; asset marker `浏览器未保存平台会话 Cookie`                                                         |
| Rollback   | restore `/root/.openbot/control-ui.bak-pre-session-cookie-check-20260806T091327Z` + baseline/pin bak then watch                                                                                   |
| Executor   | `cursor-composer`                                                                                                                                                                                 |

### Rollback

```bash
STAMP=20260806T091327Z
BASE=/root/openbot-ui-baselines/v3.0
SERVED=/root/.openbot/control-ui
chattr -i "$BASE/pin.env" 2>/dev/null || true
rm -rf "$SERVED" "$BASE/control-ui"
cp -a "${SERVED}.bak-pre-session-cookie-check-$STAMP" "$SERVED"
cp -a "$BASE/control-ui.bak-pre-session-cookie-check-$STAMP" "$BASE/control-ui"
cp -a "$BASE/pin.env.bak-pre-session-cookie-check-$STAMP" "$BASE/pin.env"
. "$BASE/pin.env"
bash "$BASE/watch-control-ui-v3-pin.sh"
```

---

## Prior cutover (2026-08-06 16:58 CST) — surgical gateway: agents.list fail-closed r1

| Field           | Value                                                                                                                                                                      |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date            | 2026-08-06 (container live ~16:58 CST)                                                                                                                                     |
| Decision        | Owner: 员工端 AI 助手栏串出全部用户机器人；根因 `agents.list` 在 actor 解析失败时退回 install-wide roster，叠加会话 `unresolved_tenant`（无 employee/enterprise 域）。     |
| Source          | Surgical in-container patch of `/app/dist/gateway-cli-*.js`; tree fix in `src/gateway/server-methods/agents.ts` + `employee-workbench-scope.ts` (tenant seat-assets load). |
| Build mode      | Hotfix patch; image `localhost/openbot:rc-amd64-overlay-agents-list-scope-r1`                                                                                              |
| Container       | `openbot-gateway-rc`                                                                                                                                                       |
| Host            | production Plan-A (`8.217.93.71`)                                                                                                                                          |
| Gateway overlay | `agents-list-scope-r1` (fail-closed when personal-workbench / authenticated non-platform)                                                                                  |
| Smoke           | healthz **200**; readyz **ready:true**; fail-closed marker on gateway-cli bundles                                                                                          |
| Rollback        | restore `/root/openbot-maintenance-agents-list-scope-20260806T085641Z/gateway-cli-*.js` then restart                                                                       |
| Executor        | `cursor-composer`                                                                                                                                                          |

---

## Prior cutover (2026-08-06 ~16:30 CST) — surgical gateway: tenant seat-store r1

| Field           | Value                                                                                                                                                                                                                             |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date            | 2026-08-06 (dist overlay live ~16:30 CST / artifact `20260806T041705Z`)                                                                                                                                                           |
| Decision        | Owner: Phase-2 tenant-context-propagation — seat-assets I/O must resolve per-tenant (`tenants/<id>/control-plane/seat-assets.json`); `agents.create` / entitlement scope must not read install-wide store when MULTITENANT is on. |
| Source          | Branch `cursor-fable/tenant-conflict-resolve` @ `ef02bd40ae` (+ `dc05d7a729` platform-auth wiring); local `pnpm build` → `/tmp/openbot-gateway-dist-tenant-seat-store-r1-20260806T041705Z.tar.gz`                                 |
| Build mode      | Gateway **dist overlay only** (`cd /app/dist && tar xzf -`); **UI pin unchanged**                                                                                                                                                 |
| Container       | `openbot-gateway-rc`                                                                                                                                                                                                              |
| Host            | production Plan-A (`8.217.93.71`)                                                                                                                                                                                                 |
| Gateway overlay | `tenant-seat-store-r1` (`build-info.json` overlay tag at deploy; later superseded on marker by `agents-list-scope-r1` hotfix — seat-store dist chunks retained)                                                                   |
| UI pin          | `OPENBOT_UI_OVERLAY_PINNED_ENTRY=index-shC303vx.js` (unchanged; public gw/admin served same entry)                                                                                                                                |
| Smoke           | healthz **200**; readyz **ready:true**; verify/watch exit **0**; tenant store `/root/.openbot/tenants/001/control-plane/seat-assets.json` live; dist contains `bindAgentAssetToSeatForTenant` / `loadSeatAssetsStoreForTenantId`  |
| Rollback        | restore `/root/openbot-maintenance-tenant-seat-store-r1-20260806T041705Z/container-app-dist-pkg.before.tgz` into `/app/dist` then restart                                                                                         |
| Executor        | `cursor-composer`                                                                                                                                                                                                                 |

### Rollback

```bash
STAMP=20260806T041705Z
BK=/root/openbot-maintenance-tenant-seat-store-r1-${STAMP}
mkdir -p /tmp/gw-dist-rollback && rm -rf /tmp/gw-dist-rollback/*
tar xzf "$BK/container-app-dist-pkg.before.tgz" -C /tmp/gw-dist-rollback
podman exec openbot-gateway-rc sh -c 'rm -rf /app/dist && mkdir -p /app/dist'
podman cp /tmp/gw-dist-rollback/dist/. openbot-gateway-rc:/app/dist/
podman restart openbot-gateway-rc
sleep 12 && curl -fsS http://127.0.0.1:18789/healthz && curl -fsS http://127.0.0.1:18789/readyz
```

---

## Prior cutover (2026-08-06 13:24 CST) — ops: stop gateway 502 restart flap

| Field     | Value                                                                                                                                                                                                                                                |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date      | 2026-08-06 (~13:24 CST / `20260806T052406Z`)                                                                                                                                                                                                         |
| Decision  | Owner: 生产间歇 502 — `watch-checkpoint-patch.sh` 在 dist overlay 后反复 `docker restart`；另有十余个 `cron.d/*.disabled-*` 仍被 cron 执行造成 pin watch 并发。禁用 checkpoint 重启，隔离重复 cron，并同步容器内 Control UI 到 `index-CYv3GCjh.js`。 |
| Host      | production Plan-A (`8.217.93.71`)                                                                                                                                                                                                                    |
| Container | `openbot-gateway-rc` (healthz/readyz ok; public admin/gw/favicon 200)                                                                                                                                                                                |
| Archive   | `/root/openbot-maintenance-cron-quarantine-20260806T052406Z/`                                                                                                                                                                                        |
| Executor  | `cursor-composer`                                                                                                                                                                                                                                    |

---

## Prior cutover (2026-08-06 12:43 CST) — surgical Control UI: trial application detail open r1

| Field      | Value                                                                                                                                                                                                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Date       | 2026-08-06 (UI live ~12:43 CST / `20260806T044028Z`)                                                                                                                                                                                                               |
| Decision   | Owner: 修复「试用申请 / 待审批 → 查看详情」无反应：`renderApplicationDetailPage` 调用已删除的 `renderPendingBlock`，渲染抛 `ReferenceError` 被静默。恢复 flat 待办条并补浏览器回归。                                                                               |
| Source     | Surgical **Control UI-only** overlay on LIVE served root + re-embed into gateway `/app/dist/control-ui`; gateway runtime restored from `openbot-gateway-dist-admin-resend-20260806T040705Z.tar.gz` after a failed watch/`podman cp` briefly wiped `dist/entry.js`. |
| Build mode | Local `pnpm ui:build` → `openbot-control-ui-trial-detail-20260806T044028Z.tar.gz` (`index-CYv3GCjh.js`)                                                                                                                                                            |
| Image tag  | unchanged (filesystem overlay only)                                                                                                                                                                                                                                |
| Container  | `openbot-gateway-rc`                                                                                                                                                                                                                                               |
| Host       | production Plan-A (`8.217.93.71`)                                                                                                                                                                                                                                  |
| Control UI | `index-CYv3GCjh.js`（`renderPendingBlock` restore；pending trial app row → detail + 批准/拒绝）                                                                                                                                                                    |
| Pin        | `OPENBOT_UI_OVERLAY_PINNED_ENTRY=index-CYv3GCjh.js`; forbidden includes prior `index-Bl8yLLww.js`                                                                                                                                                                  |
| Smoke      | healthz **200**; readyz **ready:true**; verify freeze_caps=13; public admin/gw → `index-CYv3GCjh.js`                                                                                                                                                               |
| Rollback   | restore `/root/.openbot/control-ui.bak-pre-trial-detail-20260806T044028Z` + baseline/pin bak then watch; gateway dist from admin-resend tarball if needed                                                                                                          |
| Executor   | `cursor-composer`                                                                                                                                                                                                                                                  |

### Rollback

```bash
STAMP=20260806T044028Z
BASE=/root/openbot-ui-baselines/v3.0
SERVED=/root/.openbot/control-ui
chattr -i "$BASE/pin.env" 2>/dev/null || true
rm -rf "$SERVED" "$BASE/control-ui"
cp -a "${SERVED}.bak-pre-trial-detail-$STAMP" "$SERVED"
cp -a "$BASE/control-ui.bak-pre-trial-detail-$STAMP" "$BASE/control-ui"
cp -a "$BASE/pin.env.bak-pre-trial-detail-$STAMP" "$BASE/pin.env"
. "$BASE/pin.env"
bash "$BASE/watch-control-ui-v3-pin.sh"
```

---

## Prior cutover (2026-08-06 12:08 CST) — surgical gateway+UI: admin resend activation r1

| Field           | Value                                                                                                                                                                                                                               |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date            | 2026-08-06 (container+UI live ~12:08 CST / `20260806T040705Z`)                                                                                                                                                                      |
| Decision        | Owner: 修复「编辑管理员 → 仅重发激活」无反应（`app.ts` 未挂载 `resendPlatformEnterpriseAdminActivation`）；Gateway overlay 补 create/resend 邮件 `activationUrl`（biz 注册深链）。                                                  |
| Source          | Surgical **full `/app/dist` replace** + Control UI pin `index-Bl8yLLww.js` from local WIP (`tsdown` + `pnpm ui:build`); tip on `cursor-fable/tenant-conflict-resolve`. Keep host `package.json` / runtime `VERSION=2026.7.12-rc.2`. |
| Build mode      | Local gateway dist tarball `openbot-gateway-dist-admin-resend-20260806T040705Z.tar.gz` (embeds Control UI `index-Bl8yLLww.js`); host SoT `/root/.openbot/control-ui` already pinned                                                 |
| Image tag       | container filesystem overlay only (image tag unchanged; commit optional)                                                                                                                                                            |
| Container       | `openbot-gateway-rc`                                                                                                                                                                                                                |
| Host            | production Plan-A (`8.217.93.71`)                                                                                                                                                                                                   |
| Gateway overlay | `admin-resend-activation-url-r1` (`build-info.json` overlay; `enterprise-activate` / `activationUrl` in `auth-profiles-BllyRU9S.js` / `main-session-BKknnylO.js`)                                                                   |
| Control UI      | `index-Bl8yLLww.js`（app 接线 `updatePlatformEnterpriseAdmin` / `resendPlatformEnterpriseAdminActivation`；试用成功页主 CTA「给管理员发邮件」）                                                                                     |
| Pin             | `OPENBOT_UI_OVERLAY_PINNED_ENTRY=index-Bl8yLLww.js`; `OPENBOT_UI_BASELINE_AUTHORITATIVE=1`                                                                                                                                          |
| Smoke           | healthz **200**; readyz **ready:true**; public admin/gw → `index-Bl8yLLww.js`; container `build-info.overlay=admin-resend-activation-url-r1`                                                                                        |
| Rollback        | restore `/root/openbot-maintenance-admin-resend-20260806T040705Z/dist-prev` into container `/app/dist` + restart; UI pin bak if needed                                                                                              |
| Executor        | `cursor-composer`                                                                                                                                                                                                                   |

### Rollback

```bash
STAMP=20260806T040705Z
BK=/root/openbot-maintenance-admin-resend-$STAMP
podman exec openbot-gateway-rc sh -c 'rm -rf /app/dist && mkdir -p /app/dist'
podman cp "$BK/dist-prev/." openbot-gateway-rc:/app/dist/
podman restart openbot-gateway-rc
```

---

## Prior cutover (2026-08-06 11:37 CST) — surgical gateway+UI: collab member invite fix r1

| Field           | Value                                                                                                                                                                                                                                                  |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Date            | 2026-08-06 (container+UI live ~11:37 CST / `20260806T033528Z`)                                                                                                                                                                                         |
| Decision        | Owner: 协作小组成员邀请三问题 — 去掉重复「添加成员」；自有 bot 直加（actionMode + gateway auto-promote）；同事 bot 邀请投递到主人待办。                                                                                                                |
| Source          | Surgical **full `/app/dist` replace** + Control UI served/baseline pin from local WIP (`tsdown` + `pnpm ui:build`); tip `dc05d7a729` (`cursor-fable/tenant-conflict-resolve` dirty tree). Keep host `package.json` / runtime `VERSION=2026.7.12-rc.2`. |
| Build mode      | Local gateway dist tarball `openbot-gateway-dist-member-invite-20260806T033528Z.tgz` + UI `openbot-control-ui-member-invite-20260806T033528Z.tgz` (`index-D4RxcWgE.js`)                                                                                |
| Image tag       | `localhost/openbot:rc-amd64-overlay-member-invite-r1` (retagged `ui-v3.0` / `ui-v3.0.11-embed-hydration`)                                                                                                                                              |
| Container       | `openbot-gateway-rc`                                                                                                                                                                                                                                   |
| Host            | production Plan-A (`8.217.93.71`)                                                                                                                                                                                                                      |
| Gateway overlay | `member-invite-fix-r1` (`space-store` auto-promote self-owned invites; `pending-tasks-read-model` bot-owner invite scope; `invite:bot:` markers)                                                                                                       |
| Control UI      | `index-D4RxcWgE.js` (dedupe add-member empty-state; actionMode create/commit routing; authoritativeOwnedAgentIds)                                                                                                                                      |
| Pin             | `OPENBOT_UI_OVERLAY_PINNED_ENTRY=index-D4RxcWgE.js`; forbidden includes prior `index-BjaNlv2u.js`; `OPENBOT_UI_BASELINE_AUTHORITATIVE=1`                                                                                                               |
| Smoke           | healthz **200**; readyz **ready:true**; verify rc=0 (`freeze_caps=13`); public `https://gw.openbot.love/` → `index-D4RxcWgE.js`; space-store auto-promote + `invite:bot:` markers present                                                              |
| Rollback        | restore `/root/openbot-maintenance-member-invite-20260806T033528Z/container-app-dist-pkg.before.tgz` + UI/pin bak `*.bak-pre-member-invite-20260806T033528Z` then watch                                                                                |
| Executor        | `cursor-composer`                                                                                                                                                                                                                                      |

### Rollback

```bash
STAMP=20260806T033528Z
BK=/root/openbot-maintenance-member-invite-$STAMP
podman exec openbot-gateway-rc sh -c 'rm -rf /app/dist'
podman exec -i openbot-gateway-rc sh -c 'cd /app && tar xzf -' < "$BK/container-app-dist-pkg.before.tgz"
podman restart openbot-gateway-rc
BASE=/root/openbot-ui-baselines/v3.0
SERVED=/root/.openbot/control-ui
chattr -i "$BASE/pin.env" 2>/dev/null || true
rm -rf "$SERVED" "$BASE/control-ui"
cp -a "${SERVED}.bak-pre-member-invite-$STAMP" "$SERVED"
cp -a "$BASE/control-ui.bak-pre-member-invite-$STAMP" "$BASE/control-ui"
cp -a "$BASE/pin.env.bak-pre-member-invite-$STAMP" "$BASE/pin.env"
. "$BASE/pin.env"
bash "$BASE/watch-control-ui-v3-pin.sh"
```

---

## Prior cutover (2026-08-06 10:41 CST) — surgical Control UI: basePath PDF \_\_openbot 404 r1

| Field      | Value                                                                                                                                                                                               |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date       | 2026-08-06 (served live ~10:41 CST)                                                                                                                                                                 |
| Decision   | Owner: fix console 404s `….pdf/__openbot/control-ui-config.json` and `….pdf/__openbot/platform-auth/login` when SPA pathname ends with an attached PDF filename.                                    |
| Source     | Surgical **Control UI-only** overlay on LIVE served root; local tip `a2166cf307` (`cursor-fable/tenant-conflict-resolve`) with `inferBasePathFromPathname` / `normalizeBasePath` file-segment strip |
| Build mode | Local `pnpm ui:build`; gateway container image unchanged                                                                                                                                            |
| Image tag  | unchanged (`localhost/openbot:ui-v3.0.11-embed-hydration`)                                                                                                                                          |
| Container  | `openbot-gateway-rc`                                                                                                                                                                                |
| Host       | production Plan-A (`8.217.93.71`)                                                                                                                                                                   |
| Control UI | `index-BjaNlv2u.js`                                                                                                                                                                                 |
| Pin        | `OPENBOT_UI_OVERLAY_PINNED_ENTRY=index-BjaNlv2u.js`; forbidden includes prior `index-Be6BLB7x.js`; `OPENBOT_UI_BASELINE_AUTHORITATIVE=1`                                                            |
| Smoke      | healthz **200**; public `https://www.openbot.love/` / `https://gw.openbot.love/` → `index-BjaNlv2u.js`; pin watch **ok**                                                                            |
| Rollback   | restore `/root/.openbot/control-ui.bak-pre-basepath-pdf-20260806T024132Z` + baseline bak + `pin.env.bak-pre-basepath-pdf-*` then watch                                                              |
| Executor   | `cursor-grok`                                                                                                                                                                                       |

### Rollback

```bash
STAMP=20260806T024132Z
BASE=/root/openbot-ui-baselines/v3.0
SERVED=/root/.openbot/control-ui
chattr -i "$BASE/pin.env" 2>/dev/null || true
rm -rf "$SERVED" "$BASE/control-ui"
cp -a "${SERVED}.bak-pre-basepath-pdf-$STAMP" "$SERVED"
cp -a "$BASE/control-ui.bak-pre-basepath-pdf-$STAMP" "$BASE/control-ui"
cp -a "$BASE/pin.env.bak-pre-basepath-pdf-$STAMP" "$BASE/pin.env"
. "$BASE/pin.env"
bash "$BASE/watch-control-ui-v3-pin.sh"
```

---

## Prior cutover (2026-08-06 10:18 CST) — surgical gateway+UI: tenant admin contact r1

| Field           | Value                                                                                                                                                                                                                                                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Date            | 2026-08-06 (container+UI live ~10:18 CST / `20260806T021400Z`)                                                                                                                                                                                                                                                           |
| Decision        | Owner: 平台租户详情可查看/编辑管理员联系人；目录 `contact` + `POST .../platform/enterprise/admin/update` + `.../admin/activation/send`。                                                                                                                                                                                 |
| Source          | Surgical **full `/app/dist` replace** + Control UI served/baseline pin from local WIP (`pnpm build` / `pnpm ui:build`); **not** a dirty-tree product cutover. Keep host `package.json` at `2026.7.12-rc.2`; patch `dist/build-info.json` version to match (name `@upbeyond/openbot` skips package.json VERSION resolve). |
| Build mode      | Local gateway dist tarball `openbot-gateway-dist-admin-contact-20260806T021113Z.tar.gz` + UI `openbot-control-ui-admin-contact-20260806T021125Z.tar.gz` (`index-Be6BLB7x.js`)                                                                                                                                            |
| Image tag       | `localhost/openbot:rc-amd64-overlay-admin-contact-r1` (retagged `ui-v3.0` / `ui-v3.0.11-embed-hydration`)                                                                                                                                                                                                                |
| Container       | `openbot-gateway-rc`                                                                                                                                                                                                                                                                                                     |
| Host            | production Plan-A (`8.217.93.71`)                                                                                                                                                                                                                                                                                        |
| Gateway overlay | `admin-contact-r1` (`platform/enterprise/admin/update` + `activation/send` in `auth-profiles-ryV-ixpB.js` / `main-session-DhvM8ehf.js`; `resolveEnterpriseDirectoryContact`)                                                                                                                                             |
| Control UI      | `index-Be6BLB7x.js` + `index-CaLBVXVL.css` (`tenant-edit-admin`; freeze floor retained)                                                                                                                                                                                                                                  |
| Pin             | `OPENBOT_UI_OVERLAY_PINNED_ENTRY=index-Be6BLB7x.js`; forbidden includes prior `index-BlRSQkzV.js`,…; `pin.env` `chattr +i`                                                                                                                                                                                               |
| Verify gate     | `verify-control-ui-v3.sh` rc=0 (`freeze_caps=13`); `watch-control-ui-v3-pin.sh` ok; public gw/www/admin → `index-Be6BLB7x.js`                                                                                                                                                                                            |
| Smoke           | healthz **200**; readyz **ready:true**; runtime `VERSION=2026.7.12-rc.2`; admin route markers=2; UI marker `tenant-edit-admin`                                                                                                                                                                                           |
| Rollback        | restore `/root/openbot-maintenance-admin-contact-20260806T021400Z/container-app-dist-pkg.before.tgz` into container + UI bak `*.bak-pre-admin-contact-20260806T021400Z` / `pin.env.bak-pre-admin-contact-*` then watch; or retag `rc-amd64-overlay-steward-ask-off-r1` and recreate container                            |
| Executor        | `cursor-grok`                                                                                                                                                                                                                                                                                                            |

### Rollback

```bash
STAMP=20260806T021400Z
BK=/root/openbot-maintenance-admin-contact-$STAMP
# gateway dist (+ package.json / openbot.mjs as backed up)
podman exec openbot-gateway-rc sh -c 'rm -rf /app/dist'
podman exec -i openbot-gateway-rc sh -c 'cd /app && tar xzf -' < "$BK/container-app-dist-pkg.before.tgz"
podman restart openbot-gateway-rc
# Control UI
BASE=/root/openbot-ui-baselines/v3.0
SERVED=/root/.openbot/control-ui
chattr -i "$BASE/pin.env" 2>/dev/null || true
rm -rf "$SERVED" "$BASE/control-ui"
cp -a "${SERVED}.bak-pre-admin-contact-$STAMP" "$SERVED"
cp -a "$BASE/control-ui.bak-pre-admin-contact-$STAMP" "$BASE/control-ui"
cp -a "$BASE/pin.env.bak-pre-admin-contact-$STAMP" "$BASE/pin.env"
. "$BASE/pin.env"
bash "$BASE/watch-control-ui-v3-pin.sh"
```

### Note

First attempt merged hashed chunks into existing `/app/dist` and broke imports (connection refused); rolled back, then shipped as **full dist replace**. New dist had no embedded `control-ui/`; watch's `podman cp` failed until UI was embedded into `/app/dist/control-ui` and image recommitted.

---

## Previous cutover (2026-08-06 09:51 CST) — surgical gateway: disable steward-ask short-circuit

| Field           | Value                                                                                                                                                                                                                         |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date            | 2026-08-06 (container live ~09:51 CST)                                                                                                                                                                                        |
| Decision        | Owner: 大白短消息被 `steward-ask` 模板短路（~250ms 返回），不走真实模型；其他机器人正常。                                                                                                                                     |
| Source          | Surgical in-container patch of `/app/dist/gateway-cli-*.js` on LIVE `openbot-gateway-rc`; `resolveChatRuntimeRoute` always returns `chat-runtime`. Source commits on `deploy/user-modeling-v92`: `d2c551c00b` / `41ad3ea3a1`. |
| Build mode      | Hotfix patch (not full-dist / not dirty-tree cutover); image committed as overlay                                                                                                                                             |
| Image tag       | `localhost/openbot:rc-amd64-overlay-steward-ask-off-r1` (retagged `ui-v3.0` / `ui-v3.0.11-embed-hydration`)                                                                                                                   |
| Container       | `openbot-gateway-rc`                                                                                                                                                                                                          |
| Host            | production Plan-A (`8.217.93.71`)                                                                                                                                                                                             |
| Gateway overlay | `steward-ask-off-r1` (`steward-ask-disabled-20260806` marker in all three `gateway-cli-*.js`; `kind: "steward-ask"` count → 0)                                                                                                |
| Control UI      | unchanged pin `index-BlRSQkzV.js` (four-gaps freeze)                                                                                                                                                                          |
| Smoke           | healthz **200**; readyz **ready:true**; patch markers disabled=1 on BNOfpF0h/CdOjWdNz/GvxFr1tB; operator `chat.send` no longer returns template inventory path (hits runtime / tenant gate)                                   |
| Rollback        | restore `/root/openbot-maintenance-steward-ask-20260806T015025Z/gateway-cli-*.js` into container `/app/dist/` then `podman restart openbot-gateway-rc`, or retag previous image and recreate container                        |
| Executor        | `cursor-composer`                                                                                                                                                                                                             |

### Rollback

```bash
BK=/root/openbot-maintenance-steward-ask-20260806T015025Z
podman cp $BK/gateway-cli-BNOfpF0h.js openbot-gateway-rc:/app/dist/gateway-cli-BNOfpF0h.js
podman cp $BK/gateway-cli-CdOjWdNz.js openbot-gateway-rc:/app/dist/gateway-cli-CdOjWdNz.js
podman cp $BK/gateway-cli-GvxFr1tB.js openbot-gateway-rc:/app/dist/gateway-cli-GvxFr1tB.js
podman restart openbot-gateway-rc
```

---

## Previous cutover (2026-08-06 00:12 CST) — Control UI: four-gaps freeze LIVE

| Field       | Value                                                                                                                                                                                                |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date        | 2026-08-06 (served ~00:12 CST / pin locked after verify)                                                                                                                                             |
| Decision    | Owner: **四缺口合并定格** — 外部知识源进文档树、数据与备份、系统设置 robots 自动加载、企业机巢 embed；合并 freeze-combined + ku-headless 能力底线。                                                  |
| Source      | `deploy/user-modeling-v92` @ `b79adc74ca` (UI) + `d0c0bf0ac4` (deploy record); `pnpm ui:build` → `openbot-control-ui-four-gaps-freeze-*.tar.gz`; **Control UI overlay only**.                        |
| Build mode  | served + baseline sync; gateway container image **unchanged** (`localhost/openbot:ui-v3.0.11-embed-hydration`)                                                                                       |
| Container   | `openbot-gateway-rc` (baseline authoritative; container embed UI `index-DNP1Mte4.js` superseded by overlay)                                                                                          |
| Host        | production Plan-A (`8.217.93.71`)                                                                                                                                                                    |
| Control UI  | `index-BlRSQkzV.js` + `index-BaUB9Rha.css`                                                                                                                                                           |
| Pin         | `OPENBOT_UI_OVERLAY_PINNED_ENTRY=index-BlRSQkzV.js`; forbidden includes `index-alhUGQ_H.js`, `index-W817V7BS.js`, `index-DNP1Mte4.js`, …; `pin.env` + `build-info.json` `chattr +i`                  |
| Verify gate | `verify-control-ui-v3.sh` rc=0 (`freeze_caps=13`, settings nav button, grid fix); four-gap markers: `ku-cockpit-tree-source`, `导出备份`, `wb-bots__tabs`, `ops-perf-tabs`, `governance-assets-page` |
| Smoke       | verify rc=0; watch rc=0; public `https://gw.openbot.love/` + `https://www.openbot.love/` → `index-BlRSQkzV.js`                                                                                       |
| Rollback    | restore served/baseline/pin from `bak-pre-four-gaps-*` then `watch-control-ui-v3-pin.sh`                                                                                                             |
| Executor    | operator + cursor agent session                                                                                                                                                                      |

### Local git commit scope

- `b79adc74ca` — UI: four-gaps freeze (cockpit-tree sources, data backup, robots autoload)
- `d0c0bf0ac4` — Deploy: record four-gaps UI freeze LIVE

### Overlay rule (unchanged)

Next surgical overlay must **merge into this freeze source** (or re-verify the full checklist) before retargeting `pin.env`. Do not forbid a good entry solely to protect an unrelated feature pin.

---

## Previous cutover (2026-08-05 16:47 CST) — Control UI: knowledge headless chrome r1

| Field      | Value                                                                                                                                                                 |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date       | 2026-08-05 (served ~16:47 CST / `20260805T084637Z`)                                                                                                                   |
| Decision   | Owner: remove redundant module stage titles (知识宇宙 / 我的任务 / 系统设置) and rail 「+ 新建知识/导入」 CTA; retain freeze-combined employee/enterprise polish.     |
| Source     | Local `deploy/user-modeling-v92` commits `a024244cd0`…`63c74ea060` (`pnpm ui:build`); **Control UI overlay only** on freeze-combined served root.                     |
| Build mode | `pnpm ui:build` → `openbot-control-ui-ku-headless-20260805T084637Z.tar.gz`                                                                                            |
| Image tag  | unchanged (`localhost/openbot:ui-v3.0.11-embed-hydration`)                                                                                                            |
| Container  | `openbot-gateway-rc` (served-root pin; gateway image not swapped)                                                                                                     |
| Host       | production Plan-A (`8.217.93.71`)                                                                                                                                     |
| Control UI | `index-alhUGQ_H.js` + `index-BaUB9Rha.css`                                                                                                                            |
| Pin        | `OPENBOT_UI_OVERLAY_PINNED_ENTRY=index-alhUGQ_H.js`; forbidden includes prior `index-W817V7BS.js`,…; `pin.env` + watch **ok**                                         |
| Smoke      | healthz **200**; readyz **ready:true**; public `https://gw.openbot.love/` → `index-alhUGQ_H.js`; freeze gate **ok** (`freeze_caps=13`, settings nav button, grid fix) |
| Rollback   | restore `/root/.openbot/control-ui.bak-pre-ku-headless-20260805T084637Z` + baseline/pin bak then `watch-control-ui-v3-pin.sh`                                         |
| Executor   | `cursor-composer`                                                                                                                                                     |

---

## Previous cutover (2026-08-05 16:46 CST) — Control UI freeze-combined-r1

| Field       | Value                                                                                                                                                                                                            |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date        | 2026-08-05 (served ~16:46 CST / `20260805T084627Z`)                                                                                                                                                              |
| Decision    | Owner: **定格** production Control UI combining employee polish + enterprise settings nav + org invite/archive email (replace DO1 org-only pin that forbade C38 and lacked personal-settings tabs).              |
| Source      | Local `deploy/user-modeling-v92` WIP `pnpm ui:build` after restoring create-position invite + `enterprise-org-position-detail` archive email from `origin/main`; **Control UI overlay only**.                    |
| Build mode  | `pnpm ui:build` → `openbot-control-ui-freeze-combined-r1.tgz`                                                                                                                                                    |
| Image tag   | unchanged (`localhost/openbot:ui-v3.0.11-embed-hydration` fallback)                                                                                                                                              |
| Container   | `openbot-gateway-rc` (UI served-root pin; gateway image not swapped)                                                                                                                                             |
| Host        | production Plan-A (`8.217.93.71`)                                                                                                                                                                                |
| Control UI  | `index-W817V7BS.js` + `index-BaUB9Rha.css`                                                                                                                                                                       |
| Pin         | `OPENBOT_UI_OVERLAY_PINNED_ENTRY=index-W817V7BS.js`; forbidden includes `index-DO1Emlii.js`,`index-C38uN3w0.js`,`index-BuJ5hlpk.js`,`index-DG1cxLK_.js`,…; `pin.env` + `build-info.json` + cron `chattr +i`      |
| Verify gate | Expanded `verify-control-ui-v3.sh` capability checklist: personal-settings tabs / 数据与备份 / create+invite / archive email edit / enterprise settings **button** nav (no href stub) / bots tabs / grid row fix |
| Smoke       | healthz **200**; public `https://gw.openbot.love/` + `https://www.openbot.love/` → `index-W817V7BS.js`; live markers include `创建并邀请` + `数据与备份` + `personal-settings-tabs`                              |
| Rollback    | restore `/root/.openbot/control-ui.bak-pre-freeze-*` + baseline `control-ui.bak-pre-freeze-*` + `pin.env.bak-pre-freeze-*` then `watch-control-ui-v3-pin.sh`                                                     |
| Executor    | `cursor-grok`                                                                                                                                                                                                    |

### Freeze floor (do not drop on next overlay)

1. Employee: `personal-settings-tabs` + `module-page--personal-settings` + `数据与备份`; `wb-bots__tabs`; groups/robots `grid-template-rows:auto minmax(0,1fr)`.
2. Enterprise settings: segmented nav **callback / button** (reject `href:` stub inside `enterprise-settings-shell` snippet).
3. Org invite: `data-create-position-email` + `创建并邀请`; archive: `data-archive-email-edit` + `更改邮箱` + `enterprise-org-archive__`.
4. Embed: `employee-embed-hydrating` + `data-openbot-embed-auth`.

### Note

Next surgical overlay must **merge into this freeze source** (or re-verify the full checklist) before retargeting `pin.env`. Do not forbid a good entry solely to protect an unrelated feature pin.

---

## Previous cutover (2026-08-04 23:18 CST) — surgical gateway+UI: human presence green dots r2

| Field           | Value                                                                                                                                                                                                       |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date            | 2026-08-04 (container live ~23:18 CST)                                                                                                                                                                      |
| Decision        | Owner: redeploy gateway + Control UI so collaboration member-governance shows live online green dots (`presenceStatus` from WS registry).                                                                   |
| Source          | Surgical **full `/app/dist` overlay** + Control UI served-root pin from local `deploy/user-modeling-v92` WIP (presence + cookieDomain parity with `1c17a3346e`); **not** a whole dirty-tree product cutover |
| Build mode      | Local `tsdown` + `pnpm ui:build` (unrelated dirty-tree missing-export stubs for UI build only)                                                                                                              |
| Image tag       | `localhost/openbot:rc-amd64-overlay-presence-green-dot-r2` (retagged `ui-v3.0` / `ui-v3.0.11-embed-hydration`)                                                                                              |
| Container       | `openbot-gateway-rc`                                                                                                                                                                                        |
| Host            | production Plan-A (`8.217.93.71`)                                                                                                                                                                           |
| Gateway overlay | `presence-green-dot-r2` (`touchUserPresenceOnline` / `releaseUserPresence` + human snapshot `presenceStatus`; config accepts `cookieDomain`)                                                                |
| Control UI      | `index-DNP1Mte4.js`                                                                                                                                                                                         |
| Pin             | `OPENBOT_UI_OVERLAY_PINNED_ENTRY=index-DNP1Mte4.js`; forbidden includes prior `index-restore-line-20260804j.js`; `OPENBOT_UI_BASELINE_AUTHORITATIVE=1`                                                      |
| Smoke           | healthz **200**; readyz **ready:true**; public `https://gw.openbot.love/` / `https://www.openbot.love/` → `index-DNP1Mte4.js`; pin watch **ok**; markers presence_ok / ui_dot_ok                            |
| Rollback        | `openbot-gateway-rc-prev-presence-20260804T151833Z` + restore `/root/.openbot/control-ui.bak-pre-presence-20260804T151833Z` / baseline bak / `pin.env.bak-pre-presence-*` then watch                        |
| Executor        | `cursor-grok`                                                                                                                                                                                               |

### Rollback

```bash
STAMP=20260804T151833Z
podman stop openbot-gateway-rc && podman rm openbot-gateway-rc
podman rename openbot-gateway-rc-prev-presence-$STAMP openbot-gateway-rc
podman start openbot-gateway-rc
BASE=/root/openbot-ui-baselines/v3.0
SERVED=/root/.openbot/control-ui
chattr -i "$BASE/pin.env" 2>/dev/null || true
rm -rf "$SERVED" "$BASE/control-ui"
cp -a "${SERVED}.bak-pre-presence-$STAMP" "$SERVED"
cp -a "$BASE/control-ui.bak-pre-presence-$STAMP" "$BASE/control-ui"
cp -a "$BASE/pin.env.bak-pre-presence-$STAMP" "$BASE/pin.env"
. "$BASE/pin.env"
bash "$BASE/watch-control-ui-v3-pin.sh"
```

### Follow-up (2026-08-04 23:24 CST)

Cron `*/2 * * * * /root/openbot-gateway-patches/watch-ui-checkpoint-place.sh` was **overwriting** pinned `index-DNP1Mte4.js` with legacy `index-BDtepCr1.checkpoint-place-fixed.js` (green-dot marker wiped to 0). Restored real bundle from presence-r2 tarball; rewritten watcher to **only inject checkpoint divider CSS** into `index.html` (never replace JS). Verified post-cron `member-governance-presence-dot` count remains 1.

### Note

r1 overlay failed config validation (missing `cookieDomain` in local schema vs live `main-1c17-cookie-domain`); rolled back, then r2 shipped with cookieDomain parity.

---

## Prior cutover (2026-08-04 12:39 CST)

— surgical gateway+UI: PDF attach + agents.create owner UFIX r1
| Field | Value |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date | 2026-08-04 (container live ~12:39 CST) |
| Decision | Owner: fix two production user blockers — (1) large PDF chat attach `RangeError: Maximum call stack size exceeded`; (2) employee create bot `ownerUserId must be the authenticated caller` when UI sent login email. |
| Source | Surgical **full `/app/dist` overlay** + Control UI served-root pin from commits `977eccf79a` / `16f46071ae` / `e7e10b6cdb` on `deploy/user-modeling-v92`; **not** a v92 whole-tree / dirty-growth cutover |
| Build mode | Local `tsdown` + `pnpm ui:build` (render-model growth WIP held out of UI build); overlay image from live `rc-amd64-full-dist-93916fcd` |
| Image tag | `localhost/openbot:rc-amd64-overlay-ufix-pdf-owner-r1` (retagged `ui-v3.0` / `ui-v3.0.11-embed-hydration`) |
| Container | `openbot-gateway-rc` |
| Host | production Plan-A (`8.217.93.71`) |
| Gateway overlay | `ufix-pdf-owner-r1` (`ensurePersonalEmployeeSeat` + `normalizeRequestedOwnerUserId`; create omits client `ownerUserId`) |
| Control UI | `index-CHI5mDm8.js` |
| Pin | `OPENBOT_UI_OVERLAY_PINNED_ENTRY=index-CHI5mDm8.js`; forbidden includes prior `index-Ox8DEf4s.js`; `OPENBOT_UI_BASELINE_AUTHORITATIVE=1` |
| Smoke | healthz **200**; readyz **ready:true**; public `https://gw.openbot.love/` → `index-CHI5mDm8.js`; pin watch **ok**; markers ENSURE/NORM present in gateway-cli |
| Rollback | `openbot-gateway-rc-prev-ufix-20260804T043849Z` + restore `/root/.openbot/control-ui.bak-pre-ufix-20260804T043849Z` / baseline bak / `pin.env.bak-pre-ufix-*` then watch |
| Executor | `cursor-grok` |

### Rollback

```bash
STAMP=20260804T043849Z
podman stop openbot-gateway-rc && podman rm openbot-gateway-rc
podman rename openbot-gateway-rc-prev-ufix-$STAMP openbot-gateway-rc
podman start openbot-gateway-rc
BASE=/root/openbot-ui-baselines/v3.0
SERVED=/root/.openbot/control-ui
chattr -i "$BASE/pin.env" 2>/dev/null || true
rm -rf "$SERVED" "$BASE/control-ui"
cp -a "${SERVED}.bak-pre-ufix-$STAMP" "$SERVED"
cp -a "$BASE/control-ui.bak-pre-ufix-$STAMP" "$BASE/control-ui"
cp -a "$BASE/pin.env.bak-pre-ufix-$STAMP" "$BASE/pin.env"
. "$BASE/pin.env"
bash "$BASE/watch-control-ui-v3-pin.sh"
```

### Local git commit scope (do not expand)

- `src/media/pdf-extract.ts`, `src/media/base64.ts` (+ tests)
- `src/gateway/chat-attachments.ts` (+ test), `src/gateway/attachment-assets.ts`, `src/gateway/server-methods/attachment-assets.ts`
- `src/gateway/agent-registry/agent-create-ownership.ts` (+ test)
- `ui/src/ui/controllers/chat.ts` (+ test), `ui/src/ui/views/chat.ts` (+ test)
- `ui/src/ui/ports/employee/render-model-workbench-actions.ts` (+ `render-model.node.test.ts`)
- `.loom/registry.yaml` (UFIX landing stream)
- `deploy/production/RELEASE_RECORD.md`
  **Exclude:** knowledge/iOS/macOS/platform-auth/growth-pending WIP, lockfile/node_modules, reports/, v92 whole-tree full-dist.

---

## Prior cutover (2026-08-04 11:23 CST) — surgical Control UI: My Robots master-detail r1

| Date | 2026-08-04 (served live ~11:23 CST) |
| Decision | Owner: polish「我的机器人」为左列表 + 右栏子 Tab（身份/能力/运营授权/协作/数据/删除），退役六块抽屉；需生产可见。 |
| Source | Surgical **Control UI-only** overlay on LIVE served root (`gateway.controlUi.root=/root/.openbot/control-ui`); clean `pnpm ui:build` from robots polish commits on `deploy/user-modeling-v92` tip `55af555f47`; **not** full-dist / dirty-tree cutover |
| Build mode | Host served-root + baseline replace only; gateway container image unchanged (`rc-amd64-full-dist-93916fcd`); pin/verify updated for new entry |
| Image tag | unchanged container; UI overlay artifact `openbot-control-ui-overlay-my-robots-md-r1.tar.gz` |
| Control UI | `index-CjCwHgly.js` |
| Pin | `OPENBOT_UI_OVERLAY_PINNED_ENTRY=index-CjCwHgly.js`; forbidden includes prior `index-DDr7vWBj.js` / `index-DDR68bCQ.js`; `OPENBOT_UI_BASELINE_AUTHORITATIVE=1` |
| Smoke | healthz **200**; readyz **ready:true**; public `https://gw.openbot.love/` → `index-CjCwHgly.js`; markers `wb-bots__tabs` + `employee-embed-hydrating`; pin watch **ok** (container gate warn skipped via baseline) |
| Rollback | restore `/root/.openbot/control-ui.bak-pre-my-robots-md-20260804T032307Z` + baseline bak + `pin.env.bak-pre-my-robots-md-*` then run watch |
STAMP=20260804T032307Z
cp -a "${SERVED}.bak-pre-my-robots-md-$STAMP" "$SERVED"
cp -a "$BASE/control-ui.bak-pre-my-robots-md-$STAMP" "$BASE/control-ui"
cp -a "$BASE/pin.env.bak-pre-my-robots-md-$STAMP" "$BASE/pin.env"
cp -a "$BASE/verify-control-ui-v3.sh.bak-pre-my-robots-md-$STAMP" "$BASE/verify-control-ui-v3.sh" 2>/dev/null || true

- `ui/src/ui/ports/employee/views/my-bot-workspace-panel.ts` (+ tests; drawer retired)
- `ui/src/ui/ports/employee/views/workbench-stage-module.ts`
- `ui/src/styles/workbench.css` (`.wb-bots__*`)
- `ui/src/ui/app.ts` / `app-view-state-shell-slices.ts` / `render-model.ts` / workbench contracts+types (detail tab state)
- `ui/src/i18n/locales/{zh-CN,en}.ts` (robots subtitle)
  **Exclude:** knowledge/iOS/macOS/platform-auth dual-membership WIP, lockfile/node_modules, reports/, v92 whole-tree full-dist.

## Prior cutover (2026-08-04 08:41 CST) — surgical Control UI: create→TO/sidebar sync r1

| Date | 2026-08-04 (container live ~08:41 CST) |
| Decision | Owner: after seat-ensure create succeeded, stage showed new bot content but `TO:` / sidebar still fell back to 大白管家. Root cause: seat-owned `shared` bots filtered until employeeAccess refresh. |
| Source | Surgical **Control UI-only** overlay on LIVE seat-ensure-r3 image; tip `d5a16e916c` + create→TO sync patches; **not** a v92 / main / dirty-tree cutover |
| Build mode | Clean `rm -rf` + copy Control UI (`rememberOwnedEmployeeWorkbenchAgent` + `synthesizeSelectedAssistantItem`); gateway unchanged (`agent-create-seat-ensure-r3`) |
| Image tag | `localhost/openbot:rc-amd64-overlay-create-to-sync-r1` (retagged `ui-v3.0` / `ui-v3.0.11` / `ui-v3.0.11-embed-hydration` / `ui-v3.0.11-create-to-sync-r1`) |
| Control UI | `index-UWp4TGTy.js` |
| Pin | `OPENBOT_UI_OVERLAY_PINNED_ENTRY=index-UWp4TGTy.js`; forbidden includes prior `index-C9J-jYha.js` |
| Smoke | healthz **200**; readyz **ready:true**; `uiOverlay=ui-v3.0.11-create-to-sync-r1`; `gatewayOverlay=agent-create-seat-ensure-r3`; pin verify **rc=0**; served root synced |
| Rollback image | `localhost/openbot:ui-v3.0.11-pre-create-to-sync-*` (or prior seat-ensure-r3 / `ui-v3.0.11-pre-seat-heal-20260803T234757Z`) |

# prefer pre-create-to-sync snapshot if present, else seat-heal pre-image

podman tag localhost/openbot:ui-v3.0.11-pre-create-to-sync-<STAMP> localhost/openbot:ui-v3.0

# or: podman tag localhost/openbot:rc-amd64-overlay-agent-create-seat-ensure-r3 localhost/openbot:ui-v3.0

chattr -i /root/openbot-ui-baselines/v3.0/pin.env

# restore pin.env from bak-pre-create-to-sync-\* then:

OPENBOT_UI_V3_IMAGE=localhost/openbot:ui-v3.0 bash /root/openbot-ui-baselines/v3.0/restore-ui-v3.0.sh
. /root/openbot-ui-baselines/v3.0/pin.env
bash /root/openbot-ui-baselines/v3.0/watch-control-ui-v3-pin.sh
chattr +i /root/openbot-ui-baselines/v3.0/pin.env

- `src/gateway/agent-registry/agent-create-ownership.ts` (+ `ensurePersonalEmployeeSeat`)
- `src/gateway/agent-registry/agent-create-ownership.test.ts`
- `ui/src/ui/ports/employee/employee-workbench-agent-scope.ts` (+ tests)
- `ui/src/ui/ports/employee/render-model-workbench-actions.ts`
- `ui/src/ui/ports/employee/render-model.node.test.ts`
- `ui/src/ui/ports/employee/views/workbench-shell-model.ts` (+ steward test)
  **Exclude:** knowledge/iOS/macOS/platform-auth dual-membership WIP, lockfile/node_modules, reports/, v92 whole-tree.

## Prior cutover (2026-08-04 08:02 CST) — surgical gateway: agents.create seat-ensure r3 + seat-store restore

| Date | 2026-08-04 (container live ~08:02 CST) |
| Decision | Owner: still failing `POSITION_NOT_IN_TENANT` after r2 — root cause was **wiped seat store** (1 vacant seat / 0 bindings). Restore bindings + ensure personal seat per employee on create. |
| Source | Surgical overlay on LIVE product UI 3.0.11; **not** a v92 / main full-dist cutover |
| Build mode | **Gateway JS patch** (`ensureSeatForProvision` + `assignSeatToEmployee` when caller has no active binding) + pin-aligned Control UI (`index-C9J-jYha.js`) |
| Image tag | `localhost/openbot:rc-amd64-overlay-agent-create-seat-ensure-r3` (retagged `ui-v3.0` / `ui-v3.0.11` / `ui-v3.0.11-embed-hydration`) |
| Data repair | Restored `/root/.openbot/openbot-enterprise-seat-assets.json` from `bak-hrqb-seat-sync-20260803T040004Z` (50 seats / 21 active bindings); pre-restore backup `bak-pre-restore-seat-heal-20260804T000028Z` |
| Identity model | platform user → enterprise membership → **personal employee seat**; create binds ownership to that seat; peers filtered via ownership/`seatAgentIds`; enterprise admin retains tenant governance |
| Control UI | `index-C9J-jYha.js` |
| Smoke | healthz **200**; readyz **ready:true**; `gatewayOverlay=agent-create-seat-ensure-r3`; pin verify **rc=0** |
| Rollback image | `localhost/openbot:ui-v3.0.11-pre-seat-heal-20260803T234757Z` |

# image

podman tag localhost/openbot:ui-v3.0.11-pre-seat-heal-20260803T234757Z localhost/openbot:ui-v3.0

# seat store (only if needed)

cp -a /root/.openbot/openbot-enterprise-seat-assets.json.bak-pre-restore-seat-heal-20260804T000028Z \
/root/.openbot/openbot-enterprise-seat-assets.json

## Prior cutover (2026-07-27 13:07 CST) — full-dist: steward user-guidance-protocol on recovery tip

| Field           | Value                                                                                                                                                                              |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date            | 2026-07-27 (container live ~13:07 CST)                                                                                                                                             |
| Decision        | Owner-approved option 3: local smoke then surgical production deploy; **not** a `deploy/user-modeling-v92` whole-tree cutover                                                      |
| Branch          | `deploy/user-guidance-on-recovery` @ `87d46f34ac` (from `8319b46891` + guidance surgical replay)                                                                                   |
| Source revision | `87d46f34ac17be2077f93bf730305c0d38c37c77`                                                                                                                                         |
| Build mode      | **Full `dist` layer** + `skills/user-guidance-protocol` on `rc-amd64-provenance-8319b46891ba`                                                                                      |
| Image tag       | `openbot:rc-amd64-provenance-87d46f34ac-user-guidance`                                                                                                                             |
| Image id        | `68078ce6b1022e724c18ef522f03d66f8cc159bf3c32c9493bcf6b0af75fa9a9`                                                                                                                 |
| Container       | `openbot-gateway-rc`                                                                                                                                                               |
| Host            | production Plan-A (`8.217.93.71`)                                                                                                                                                  |
| Gateway runtime | `OpenBot 2026.7.12-rc.2 (87d46f3)`                                                                                                                                                 |
| Control UI      | `index-ZxmJG-F8.js`                                                                                                                                                                |
| Includes        | Bundled `user-guidance-protocol` v2 skill; steward workspace sync; channel∩agent filter retain; agent tool `guidance_event`; gateway `asset-incubation.guidance.record`            |
| Smoke           | healthz **200**; readyz **ready:true**; skill path present under `/app/skills/user-guidance-protocol/`; method string present in gateway dist; `https://biz.openbot.love/` **200** |
| Rollback        | `openbot-gateway-rc-prev-user-guidance-20260727T125634` / `localhost/openbot:rc-amd64-provenance-8319b46891ba-navfix-on-live`                                                      |
| Executor        | `cursor-user-guidance`                                                                                                                                                             |

### Rollback to pre–user-guidance full-dist

podman rename openbot-gateway-rc-prev-user-guidance-20260727T125634 openbot-gateway-rc

## Prior cutover (2026-07-27 12:23 CST) — scoped UI: IM soft-bridge on recovery 企业通道

| Field           | Value                                                                                                                                              |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date            | 2026-07-27 (container live ~12:23 CST)                                                                                                             |
| Decision        | Owner-approved: re-ship IM soft-bridge surgically on recovery IA (`message-channels`), not v92 `渠道凭证` overlay                                  |
| Branch          | `cursor/im-soft-bridge-on-recovery` @ `9a84706d4a` (from `1e1143012db2`)                                                                           |
| Source revision | `9a84706d4a`                                                                                                                                       |
| Build mode      | **Scoped UI layer only** on `rc-amd64-provenance-1e11430-restore-data-capability-ui`                                                               |
| Image tag       | `openbot:rc-amd64-provenance-9a84706d4a-im-on-recovery`                                                                                            |
| Image id        | `c198b977fd08719f6f69b74e0da01a4eff1589c13fa6cb791484a508ef6e9894`                                                                                 |
| Container       | `openbot-gateway-rc`                                                                                                                               |
| Host            | production Plan-A (`8.217.93.71`)                                                                                                                  |
| Gateway runtime | `OpenBot 2026.7.12-rc.2 (1e11430)`                                                                                                                 |
| Control UI      | `index-BG26ha9i.js`                                                                                                                                |
| Includes        | 系统设置→企业通道：IM 接入指引 / Callback 复制 / 测试连通 / 同步为运营身份；身份页反链到企业通道；保留 settings shell + enterprise-data-capability |
| Smoke           | healthz **200**; readyz **ready:true**; biz serving `index-BG26ha9i.js`; markers IM+sync+data+shell present                                        |
| Rollback        | `openbot-gateway-rc-prev-im-on-recovery-20260727T122316` / `…1e11430-restore-data-capability-ui`                                                   |
| Executor        | `cursor-daniel`                                                                                                                                    |

### Rollback to pre–IM-on-recovery UI

podman rename openbot-gateway-rc-prev-im-on-recovery-20260727T122316 openbot-gateway-rc

## Prior cutover (2026-07-27 11:33 CST) — scoped UI: restore enterprise data capability from recovery `1e11430`

| Field           | Value                                                                                                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date            | 2026-07-27 (container live ~11:33 CST)                                                                                                                                          |
| Decision        | Owner-reported regression: enterprise data capability module thinner than yesterday; root cause = `deploy/user-modeling-v92` Control UI overlays replaced recovery UI           |
| Branch          | UI extracted from image `rc-amd64-provenance-1e1143012db2` (gateway tip `1e11430`)                                                                                              |
| Source revision | Control UI from `1e1143012db2`; gateway unchanged `1e11430`                                                                                                                     |
| Build mode      | **Scoped UI layer only** (`rm -rf` + copy recovery `dist/control-ui` onto prior live image)                                                                                     |
| Image tag       | `openbot:rc-amd64-provenance-1e11430-restore-data-capability-ui`                                                                                                                |
| Image id        | `ec05fac015c24f70e499aa3f5f9a09d620c6c8ee8ff6144aacb631a6f374c8a4`                                                                                                              |
| Container       | `openbot-gateway-rc`                                                                                                                                                            |
| Host            | production Plan-A (`8.217.93.71`)                                                                                                                                               |
| Gateway runtime | `OpenBot 2026.7.12-rc.2 (1e11430)`                                                                                                                                              |
| Control UI      | `index-CjO2wdQs.js` (recovery bundle)                                                                                                                                           |
| Evidence        | Before overlay: `enterprise-data-capability`≈610 / `semantic-objects`≈10 / `enterpriseDataGovernanceCenter`≈108; after v92 overlay: ≈139 / 0 / 6; after restore: 610 / 10 / 108 |
| Includes        | Full enterprise data capability center + settings top tabs (`enterprise-settings-shell`); **IM soft-bridge UI not included** (re-layer on recovery UI tip next)                 |
| Smoke           | healthz **200**; readyz **ready:true**; `https://biz.openbot.love/` serving `index-CjO2wdQs.js`                                                                                 |
| Rollback        | `openbot-gateway-rc-prev-restore-data-ui-20260727T113321` / prior settings-tabs image                                                                                           |
| Executor        | `cursor-daniel`                                                                                                                                                                 |

### Rollback to pre–data-capability restore

podman rename openbot-gateway-rc-prev-restore-data-ui-20260727T113321 openbot-gateway-rc

## Prior cutover (2026-07-27 11:19 CST) — scoped UI: restore enterprise settings top tabs (recovery base `1e11430`)

| Field           | Value                                                                                                                                                                                          |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date            | 2026-07-27 (container live ~11:19 CST)                                                                                                                                                         |
| Decision        | Owner-reported regression: settings showed card hub instead of top tabs; restore `renderSettingsSectionShell` + keep IM soft-bridge                                                            |
| Branch          | `deploy/user-modeling-v92` @ `15250ae4ff`                                                                                                                                                      |
| Source revision | `15250ae4ff` (UI tip; tabs `ec23a85e1e` + `15250ae4ff`)                                                                                                                                        |
| Build mode      | **Scoped UI layer only** (`rm -rf` + `dist/control-ui` replace on live base at cutover; gateway dist unchanged)                                                                                |
| Image tag       | `openbot:rc-amd64-provenance-15250ae4ff29-settings-tabs`                                                                                                                                       |
| Image id        | `c64b51a023ed6b9129313f48137bbcdd68dec2f361b7a102b4b8f4ed007ac02f`                                                                                                                             |
| Container       | `openbot-gateway-rc` (`restart=unless-stopped`, host network, loopback :18789)                                                                                                                 |
| Host            | production Plan-A (`8.217.93.71`)                                                                                                                                                              |
| Gateway runtime | `OpenBot 2026.7.12-rc.2 (1e11430)` (unchanged from base)                                                                                                                                       |
| Control UI      | `index-DQrxn-Gt.js` + `enterprise-shell-DONSQK_I.js`                                                                                                                                           |
| Includes        | Top segmented settings tabs (`enterprise-settings-shell`); no card hub; IM soft-bridge markers retained                                                                                        |
| Smoke           | healthz **200**; readyz **ready:true**; `https://biz.openbot.love/` serving `index-DQrxn-Gt.js`; shell has `enterprise-settings-shell`, no `enterprise-settings-hub`; `同步为运营身份` present |
| Rollback        | `openbot-gateway-rc-prev-settings-tabs-safety-20260727T111841` / prior live image at cutover                                                                                                   |
| Executor        | `cursor-daniel`                                                                                                                                                                                |

### Rollback to pre–settings-tabs UI

podman rename openbot-gateway-rc-prev-settings-tabs-safety-20260727T111841 openbot-gateway-rc

## Prior cutover (2026-07-27 11:03 CST) — scoped UI: enterprise IM soft-bridge (recovery base `1e11430`)

| Field           | Value                                                                                                                                                       |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date            | 2026-07-27 (container live ~11:03 CST)                                                                                                                      |
| Decision        | Owner-approved: ship enterprise IM channel credentials ↔ operational identity soft-bridge UI without rebasing gateway                                       |
| Branch          | `deploy/user-modeling-v92` @ `75c412105e`                                                                                                                   |
| Source revision | `75c412105e` (UI tip; commits `d33da3392c`…`75c412105e`)                                                                                                    |
| Build mode      | **Scoped UI layer only** (`rm -rf` + `dist/control-ui` replace on `rc-amd64-provenance-439b31bd9f-user-modeling-panel`; gateway dist unchanged)             |
| Image tag       | `openbot:rc-amd64-provenance-75c412105e-im-bridge`                                                                                                          |
| Image id        | `415c20fca5abf1ec3f4b7d41c69a8b784579ecd6425699f3019eaf3d613d2c17`                                                                                          |
| Container       | `openbot-gateway-rc` (`restart=unless-stopped`, host network, loopback :18789)                                                                              |
| Host            | production Plan-A (`8.217.93.71`)                                                                                                                           |
| Gateway runtime | `OpenBot 2026.7.12-rc.2 (1e11430)` (unchanged from base)                                                                                                    |
| Control UI      | `index-B-dnlu_B.js` + `enterprise-shell-c4YSGJnw.js`                                                                                                        |
| Includes        | Callback URL panel; 测试连通 (`channels.status` probe); 同步为运营身份; identities reverse link 去配置渠道凭证 / 绑定并注册                                 |
| Smoke           | healthz **200**; readyz **ready:true**; `https://biz.openbot.love/` serving `index-B-dnlu_B.js`; enterprise-shell contains `IM 接入指引` + `同步为运营身份` |
| Rollback        | `openbot-gateway-rc-prev-im-bridge-safety-20260727T110240` / `localhost/openbot:rc-amd64-provenance-439b31bd9f-user-modeling-panel`                         |
| Executor        | `cursor-daniel`                                                                                                                                             |

### Rollback to pre–IM-bridge UI (recovery gateway only)

podman rename openbot-gateway-rc-prev-im-bridge-safety-20260727T110240 openbot-gateway-rc

## Prior cutover (2026-07-27 10:56 CST) — scoped UI: user-modeling panel + i18n (recovery base `1e11430`)

| Field           | Value                                                                                                                                                           |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date            | 2026-07-27 (container live ~10:56 CST)                                                                                                                          |
| Decision        | Owner-approved: restore `userModeling` i18n + ship wired learned-preferences panel on recovery lineage without rebasing gateway                                 |
| Branch          | `deploy/user-modeling-v92` @ `439b31bd9f`                                                                                                                       |
| Source revision | `439b31bd9f5f1428d38c56ea507e6fd49b76f3dc`                                                                                                                      |
| Build mode      | **Scoped UI layer only** (`dist/control-ui` replace on `rc-amd64-provenance-1e1143012db2`; gateway dist unchanged)                                              |
| Image tag       | `openbot:rc-amd64-provenance-439b31bd9f-user-modeling-panel`                                                                                                    |
| Image id        | `8e72cf8b0e410a0c8296fe2c0bd024aecb4f71e938410391d696a164f7dc66f1`                                                                                              |
| Container       | `openbot-gateway-rc` (`restart=unless-stopped`, host network, loopback :18789)                                                                                  |
| Host            | production Plan-A (`8.217.93.71`)                                                                                                                               |
| Gateway runtime | `OpenBot 2026.7.12-rc.2 (1e11430)` (unchanged from base)                                                                                                        |
| Control UI      | `index-D52yosFa.js` + `employee-shell-BiXhwBv1.js` (panel in employee shell chunk)                                                                              |
| Includes        | `user-learned-preferences-panel` in settings → preferences; `userModeling.*` i18n (zh-CN + en); workbench user-modeling CSS                                     |
| Smoke           | healthz **200**; readyz **ready:true**; `https://openbot.love/` **200** serving `index-D52yosFa.js`; `employee-shell` contains `user-learned-preferences-panel` |
| Rollback        | `openbot-gateway-rc-prev-user-modeling-ui` / `localhost/openbot:rc-amd64-provenance-1e1143012db2`                                                               |
| Executor        | `cursor-composer`                                                                                                                                               |

### Rollback to pre-panel UI (recovery gateway only)

podman rename openbot-gateway-rc-prev-user-modeling-ui openbot-gateway-rc

## Phase-2 backlog (marker-verified against `provenance-3624c454fefd`, which was live on 2026-07-26)

Marker checks were re-run inside the running container (`3624c454`), not inferred from v116: `agents.runtime-health` → **0** hits in `/app/dist` (item still open); knowledge import IA → see row below (one of three markers now present); `dist/plugin-sdk/wecom.js` + `wecom.d.ts` → **both present** (carried forward from v113). The remaining rows were not re-verified individually and still describe the v116 state.
| Item | Source | Notes |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agents.runtime-health` (honest per-agent runtime health) | `3a426ae363` → `2895d5c5b2` → `96bcb0877e` → `309090ad1d` (on `deploy/user-modeling-v92`; the first three also on `origin/main`) | **Not in the running build.** Verified in-container: `grep -rl "agents.runtime-health" /app/dist` → 0. Now an end-to-end feature (gateway RPC + workbench robot health pill), so the whole stack has to move together. Replay feasibility proven — see **Replay recipe** below. Needs a product decision first: it overlaps a _different_ runtime-status axis that is already live. |
| Knowledge import IA — replacement surface | `origin/kiro-web-ui/knowledge-workbench-import-ia` (6 commits: `6c15798995`, `4e658062f4`, `a9e8fcfda0`, `650682e1b7`, `efa3d6e6d4`, `cbca9f1132`) | **Still half-shipped and user-visible.** Only `cbca9f1132` was replayed (as `a69f4e58ca`), and it _removes_ the old space-import drawer. Re-verified in the live `3624c454` container: `ku-space-import-local-folder` **0**, `localFolderUpload` **0**, `knowledge-universe-local-folder` **1** (was 0 on v116 — one marker arrived with the 43 commits, but still no import entry point). Either replay the remaining 5 or restore an import entry point. |
| Knowledge import MERGE A full wiring | archive `27a7163e60` + handlers | Live has partial views; do not ship local WIP that strips import kinds |
| Subscription contract reminder UI wiring | local deferred helpers | Wire into platform tenant list (gateway enrichment already live since v109) |
| IM OAuth inbound identity | `1183cc2bc7` / `feat/im-userid-session-identity` | Explicitly deferred; gateway + WeCom/Feishu/DingTalk |
| DeepSeek legacy→v4-flash remap | local deferred WIP | Verify catalog/allowlist + reasoner semantics first |
| v111 credentials surface copy (`渠道凭证`) | v111 `enterprise-channel-credentials-surface` | Superseded on the recovery lineage by `企业通道`; only replay if product requires the exact v111 copy |
| Retire the v115 SoT pointer | `refs/v115-pending-admin` @ `e860bba1b0` | Superseded by v116. Do not "land v115 onto the shared SoT branch" — that direction is the regression. Keep the ref as archive only. |
**Landed in v110 from codex:** robots/groups UX, seat-bound AI archive, member invite pending/sending, archive action IA, seat-bind activation/create-seat email.

### Replay recipe: `agents.runtime-health`

Dry-run performed 2026-07-25 in a throwaway clone off `rc-baseline-recovery-20260725` (no push, no build, no cutover). Result: **viable — one conflict and one adaptation across the four commits.**

# isolated clone; never replay on the shared working tree

git clone --no-checkout <repo> /tmp/openbot-rth && cd /tmp/openbot-rth
git checkout -b replay/agent-runtime-health rc-baseline-recovery-20260725
git cherry-pick -x 3a426ae363 # policy + tests -> CLEAN (new files)
git cherry-pick -x 2895d5c5b2 # fact collection + tests -> CLEAN (new files)
git cherry-pick -x 96bcb0877e # RPC + method-scope -> CONFLICT (see below)

# resolve, then the one adaptation below, then:

git cherry-pick -x 309090ad1d # workbench robot health pill -> CLEAN
Final shape: **11 files, +669 lines** on top of `rc-baseline-recovery-20260725`.
Conflict is confined to `src/gateway/server-methods/agents.ts`, both hunks mechanical:

1. **Import block** — keep both sides; the new `collectAgentRuntimeHealth` import sorts before the recovery lineage's `listAgentsForEmployeeGateway`.
2. **Handler insertion point** — take the incoming `"agents.runtime-health"` handler, then keep **HEAD's** `"agents.create": async ({ params, respond, context, client })` signature (the recovery lineage added the `client` param after the source commit was written).
   Then one adaptation the cherry-pick cannot infer: the replayed handler calls `filterAgentsForEmployeeActor`, which the recovery lineage **no longer imports** in `agents.ts` (that file moved to `listAgentsForEmployeeGateway` from `employee-agent-roster.ts`). The symbol is still exported at `src/gateway/employee-workbench-scope.ts:442`, so re-add it to the `../employee-workbench-scope.js` import list. After that every identifier resolves; `method-scopes.ts` and the `agentsHandlers` registration are both complete, and `server-methods-list.ts` needs no edit (the source stack never touched it).
   **Open product decision — two runtime-status axes.** The recovery lineage already ships a per-agent status that this stack does not know about:
   | | live on the recovery lineage | Kiro's `agents.runtime-health` |
   | ----------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
   | Type | `AgentRuntimeStatus = "ready" \| "provisioning" \| "unavailable"` (`src/shared/session-types.ts:10`) | `AgentRuntimeHealth = "online" \| "degraded" \| "offline" \| "unconfigured"` |
   | Derived from | runtime **bind registry** — tenant→agent→runtimeId binding, `bind.health`, `disabled` (`resolveRuntimeStatusFromBindRegistry`) | **effective model resolvability** + **channel reachability** (`listBindings` + `ChannelRuntimeSnapshot.running && connected`) |
   | Question answered | is this agent provisioned onto a healthy runtime? (control plane / placement) | can this agent actually run, and is it reachable on its bound channels? (data plane / reachability) |
   | UI consumption | already read by 8+ UI files incl. enterprise organization surface and mention candidates | `309090ad1d` renders a workbench robot health pill (运行正常/部分降级/离线/未配置), deliberately separate from the 近期活跃 activity indicator |
   They are complementary, not duplicates, so a straight replay adds a second axis rather than contradicting the first — and `309090ad1d` already makes that choice visible in the UI by showing the health pill next to, not instead of, the activity indicator. Confirm that is the intended product shape (versus folding channel reachability into the existing `runtimeStatus`), then land via the normal recovery-branch gate set (`tsgo` Δ≤0, scoped tests, `build:docker`, `release:check`) rather than a hotpatch.
   **Landing order matters:** the UI commit calls `agents.runtime-health`, and the live gateway does not register that method. Never ship the UI half ahead of the gateway half, and never build the UI from `deploy/user-modeling-v92` against a recovery-lineage gateway.

## Prior cutover (2026-07-26 18:31 CST) — `provenance-aad4f39891c0`

L3-verified 2026-07-27 09:10 CST, superseded the same morning. **Six further cutovers happened between `provenance-3624c454fefd` and this one, on the same day**, and by 11:19 the next day two more had landed on top. Do not trust a hand-edited L3 pointer — regenerate it (see "Keeping this pointer honest"); the generated block above is authoritative, this section is history.
| Field | Value |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Date | 2026-07-26 (image built 18:29:24 CST, image created 18:30:55 CST, container created 18:31:05 CST); still live and unrestarted at 2026-07-27 09:10 (`RestartCount=0`, uptime ~14.6 h) |
| Branch | `release/baseline-recovery-20260725` (commit present on `origin/release/baseline-recovery-20260725`) |
| Source revision | `aad4f39891c04a10e276581a4527f38ddb7c1aab` — `UI: adapt preview incubation hint through artifact sidebar` (authored 2026-07-26 18:27) |
| Relation to v116 | **90 commits ahead of `127fc543f0`, 0 behind.** Ancestry verified monotonic at every hop (see chain table below). |
| Tag | none |
| Image tag | `openbot:rc-amd64-provenance-aad4f39891c0` |
| Image id | `fa5faeec9e5a9846483a4a67316500961ce2edfcc8d6ba82779551ab15598f84` |
| Container | `openbot-gateway-rc` (`restart=always`, host network, loopback :18789, `--user 0`, cmd `node openbot.mjs gateway --bind loopback --port 18789`, mount `/root/.openbot:/root/.openbot`) |
| Host | production Plan-A (`8.217.93.71`) |
| Runtime version | `OpenBot 2026.7.12-rc.2 (aad4f398)` — `dist/build-info.json` `builtAt 2026-07-26T10:29:24.742Z` |
| Control UI | `index-DGAEGlu2.js` — read from `dist/control-ui/index.html`, **not** from a directory listing: this image carries **four** `index-*.js` bundles (see image hygiene below) |
| Smoke | healthz **200**; readyz **ready:true** `failing:[]`; www/biz/admin/gw all HTTP **200** serving `index-DGAEGlu2.js`; :18789 held by the container PID; host hardening still in force (`openbot-gateway.service` **masked**, npm globals only `corepack`/`npm`/`pm2`, no `openbot`/`openclaw` on `PATH`) |
| Rollback | `openbot-gateway-rc-prev-provenance-safety` / `localhost/openbot:rc-amd64-provenance-5cf014a637b6` (`0c2167255b5d`) — the immediately preceding live build, 3 commits back |
| Executor | cutover: unrecorded · L3 verification + this record: `kiro-deploy-audit` |

### Rollback to the previous live build

podman rename openbot-gateway-rc-prev-provenance-safety openbot-gateway-rc

### Image hygiene defect in this build

`/app/dist/control-ui/assets/` contains four bundles instead of one, plus a macOS resource-fork artifact:
08:38 UTC index-jXq4o45G.js 4808758 B
08:38 UTC ._index-jXq4o45G.js 163 B <- AppleDouble artifact
08:59 UTC index-DZntCZHC.js 4808922 B
09:09 UTC index-C4UIflJH.js 4824447 B
10:29 UTC index-DGAEGlu2.js 4831547 B <- the one index.html references
Two problems: the UI layer was copied **without** the `rm -rf` the cutover rules require, so superseded bundles accumulate and any client holding a stale `index.html` can still fetch an old build; and `._\*`AppleDouble files leaked in, meaning the`dist` was transferred from macOS without filtering. Clean both on the next full-image cutover.

### Keeping this pointer honest

Deploy cadence on 2026-07-26 was **eight cutovers in one day** (08:44 → 18:31), so a hand-maintained L3 pointer is stale within hours. Regenerate the block below from live state instead of editing it by hand:
bun scripts/ops/l3-live-snapshot.ts --write # rewrites the generated block in this file
bun scripts/ops/l3-live-snapshot.ts --json # machine-readable snapshot

<!-- L3-LIVE:BEGIN (generated by scripts/ops/l3-live-snapshot.ts — do not edit by hand) -->

**Live L3 as of 2026-07-27T11:29:36+08:00** — generated from root@8.217.93.71, do not hand-edit.
| Field | Value |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Image tag | `localhost/openbot:rc-amd64-provenance-15250ae4ff29-settings-tabs` |
| Image id | `c64b51a023ed6b9129313f48137bbcdd` |
| Runtime | `2026.7.12-rc.2 (1e114301)` · built `2026-07-27T02:23:44.898Z` |
| Control UI (from index.html) | `index-DQrxn-Gt.js` |
| Container | `openbot-gateway-rc` created `2026-07-27 11:18:42.284707484 +0800 CST`, started `2026-07-27 11:18:42.658520151 +0800 CST`, running=true, restarts=0 |
| Health | healthz `200` · readyz `{"ready":true,"failing":[],"uptimeMs":641709}` |
| :18789 owner | pid `2538944`, owned by container: true |
| Host hardening | `openbot-gateway.service` masked · npm globals `corepack@0.34.6,npm@10.9.7,pm2@7.0.1` · gateway bins on PATH: 0 |
| Rollback target | `openbot-gateway-rc-prev-settings-tabs-safety-20260727T111841` / `localhost/openbot:rc-amd64-provenance-e9ce579715-user-modeling-panel` |
| Public hosts | www.openbot.love → 200 / index-DQrxn-Gt.js; biz.openbot.love → 200 / index-DQrxn-Gt.js; admin.openbot.love → 200 / index-DQrxn-Gt.js; gw.openbot.love → 200 / index-DQrxn-Gt.js |
**Problems detected:**

- control-ui 残留 2 个 bundle（UI 层未 rm -rf 清理）
<!-- L3-LIVE:END -->

## Prior cutover (2026-07-26 08:44 CST) — `provenance-3624c454fefd` (BYOK canary audit trail)

Recorded retroactively on 2026-07-26 after L3 verification. The `vNNN` counter stopped at v119; cutovers after it are tagged `provenance-<sha>`, so this entry is named by image tag rather than by an invented version number.
| Field | Value |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date | 2026-07-26 (image built 08:42:58 CST, image created 08:44:11 CST, container created 08:44:29 CST) |
| Branch | `release/baseline-recovery-20260725` (same SoT branch as v116; commit is on `origin/release/baseline-recovery-20260725`) |
| Source revision | `3624c454fefdc3e075e4dc2c095ea5cb74b0c217` — `Deploy: assert BYOK canary audit trail without secret leakage` (authored 2026-07-26 08:42:12 +0800) |
| Relation to v116 | **43 commits ahead of `127fc543f0`, 0 behind.** Strictly monotonic chain, each verified an ancestor of the next: `127fc543f0` →(7)→ `e7e8e6d50c` →(30)→ `5b5fcfb1af40` →(6)→ `3624c454fefd`. No divergence. |
| Tag | none (no annotated tag was cut for this revision) |
| Image tag | `openbot:rc-amd64-provenance-3624c454fefd` |
| Image id | `8176d4448c2aee3f9a2a695c39eee7518c7efc3b2e199b957e88fd537dfe3601` |
| Build mode | **Full image from source revision** (gateway + UI same SHA) |
| Container | `openbot-gateway-rc` (`restart=always`, host network, loopback :18789, `--user 0`, cmd `node openbot.mjs gateway --bind loopback --port 18789`, mount `/root/.openbot:/root/.openbot`) |
| Host | production Plan-A (`8.217.93.71`) |
| Runtime version | `OpenBot 2026.7.12-rc.2 (3624c454)` — `dist/build-info.json` `builtAt 2026-07-26T00:42:58.821Z` |
| Control UI | `index-CoXh2sgr.js` — **not a unique fingerprint**: `v119-asset-suggestion-dismiss` and `provenance-5b5fcfb1af40` ship the same bundle. Identify the live build by `dist/build-info.json` **and** image tag, never by bundle hash alone. |
| Session layout | Tenant-scoped: `/root/.openbot/tenants/<tenantId>/users/<userId>/state/agents/<agentId>/sessions/`. Driven by container env `OPENBOT_MULTITENANT=1` + `OPENBOT_TENANTS_ROOT=/root/.openbot/tenants`. **Any runtime missing these two vars reads/writes the legacy global root `/root/.openbot/agents/<agentId>/sessions/` and therefore cannot see tenant-scoped history.** |
| Smoke | healthz **200**; readyz **ready:true** `failing:[]`; www/biz/admin/gw all serve `index-CoXh2sgr.js` with HTTP **200**; port 18789 held by the container PID (cgroup `libpod-*`, cwd `/app`); zero nginx upstream failures; zero port conflicts after restore; tenant-root writes resumed and global-root writes stopped |
| Rollback | `openbot-gateway-rc-prev-provenance-safety` / `localhost/openbot:rc-amd64-provenance-5b5fcfb1af40` (`2339ef06bc3a`) — the immediately preceding live build, 6 commits back. Rolling back to **v116** instead drops all 43 commits; prefer forward-fixing. |
| Record drift | This cutover, and the **four before it**, were never recorded; the file still declared v116 / `127fc54` / `index-CA6HLrrO.js` as L3 live. During the 2026-07-26 incident triage that stale record almost caused a restore onto the **older** v116 baseline. See the reconstructed chain below. |
| Executor | cutover: unrecorded (container recreated 08:44:29) · retroactive L3 verification + this record: `kiro-deploy-audit` |

### Undocumented cutover chain v116 → live (reconstructed 2026-07-26, extended 2026-07-27)

Eleven cutovers after v116 were never written down. Reconstructed from image `build-info.json`, image creation times, and safety-container creation times — a safety container keeps its original `CreatedAt` through the rename, so **its `CreatedAt` is when that image went live**.
| Went live (CST) | Image tag | build-info commit | Control UI | Notes |
| --------------- | ---------------------------------------- | ----------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 07-25 22:25:37 | `rc-amd64-v116-baseline-recovery` | `127fc543f0` | `index-CA6HLrrO.js` | last **recorded** cutover before this reconstruction |
| 07-26 01:58:54 | `rc-amd64-v117-archive-ui-delete` | `127fc543f0` | `index-p8v6MsF5.js` | **UI-layer cutover**: build-info identical to v116, only the bundle moved |
| 07-26 03:20:49 | `rc-amd64-v118-byok-runtime` | `e7e8e6d50c` | `index-p8v6MsF5.js` | full build; `Deploy: add BYOK live canary script for operator acceptance` |
| unconfirmed | `rc-amd64-v119-asset-suggestion-dismiss` | `e7e8e6d50c` | `index-CoXh2sgr.js` | **UI-layer cutover** on v118 (same build-info). No safety container survives, so its live window could not be established from host evidence. |
| 07-26 08:15:29 | `rc-amd64-provenance-5b5fcfb1af40` | `5b5fcfb1af40` | `index-CoXh2sgr.js` | `Agents: resolve ent/* BYOK on agent RPC before embedded run` |
| 07-26 08:44:29 | `rc-amd64-provenance-3624c454fefd` | `3624c454fefd` | `index-CoXh2sgr.js` | `Deploy: assert BYOK canary audit trail without secret leakage`; a staging container on the same image also exists (created 08:44:26) |
| unconfirmed | `rc-amd64-provenance-8ffcac1efe96` | `8ffcac1efe96` | — | `UI: enable delete for pending-activation organization seats`. No safety container survives; live window not establishable (+15 commits) |
| 07-26 14:24:22 | `rc-amd64-provenance-27d6ea21e5da` | `27d6ea21e5da` | — | `UI: copy employee invite links to www.openbot.love` (+5) |
| 07-26 16:40:06 | `rc-amd64-provenance-7c767c073ab5` | `7c767c073ab5` | `index-jXq4o45G.js` | `Skills: document cloud canvas paths and add cursor-canvas package` (+8). Recreated the container ~70 s before an unrelated session-index edit |
| 07-26 17:00:47 | `rc-amd64-provenance-40cf6b36b3a7` | `40cf6b36b3a7` | — | `Spec: add main recovery routing and owner dispatch` (+5) |
| 07-26 17:11:23 | `rc-amd64-provenance-5cf014a637b6` | `5cf014a637b6` | — | `Gateway: fix probePlatformAuthSmtpConnection alias placement` (+11) |
| 07-26 18:31:05 | `rc-amd64-provenance-aad4f39891c0` | `aad4f39891c0` | `index-DGAEGlu2.js` | **current L3 live**; `UI: adapt preview incubation hint through artifact sidebar` (+3) |
Ancestry verified at every hop, all forward, no divergence: `127fc543f0` →(7)→ `e7e8e6d50c` →(30)→ `5b5fcfb1af40` →(6)→ `3624c454fefd` →(15)→ `8ffcac1efe96` →(5)→ `27d6ea21e5da` →(8)→ `7c767c073ab5` →(5)→ `40cf6b36b3a7` →(11)→ `5cf014a637b6` →(3)→ `aad4f39891c0` = **90 commits** past v116.
Accuracy traps found while reconstructing this — worth avoiding next time:

- **`build-info.json` does not identify a UI-layer cutover.** v117 and v119 each reuse the previous build's commit; only the bundle hash moved. Record the image tag for every cutover.
- **The bundle hash is not unique either.** `index-CoXh2sgr.js` covers three different image tags. Neither field alone is sufficient — record both.
- **A directory listing does not identify the served bundle.** The current image carries four `index-*.js` files; only `dist/control-ui/index.html` says which one is live.
- **Safety-container naming changed mid-stream.** Older archives are `prev-vNNN-safety` and carry the image of **v(NNN-1)**; newer ones are `prev-<successor-sha>` and carry the image that ran **before** that successor. Both forms mean "the previous live build", but reading the older form as "vNNN's image" yields a rollback one version too far back.
- **Deploy order does not follow commit authoring order.** `7c767c073ab5` (authored 15:53) went live before `40cf6b36b3a7` (authored 14:49). Only git ancestry is monotonic; authoring timestamps are not a sequence.

## Incident (2026-07-26, 09:06–10:12 CST) — host gateway seized :18789, production served a 16-day-old build

**Symptom reported:** employee-side chat history with robots lost its most recent conversations; only older ones remained. No 502, so it did not look like an outage.
**What was actually live:** all four domains were serving `index-zPUWTrrf.js` from the host npm-global package `@upbeyond/openbot@1.0.1` (commit `1604655a78`, built **2026-07-10**) — a ~16-day rollback of both gateway and UI.
**Mechanism:**

1. Host systemd unit `/etc/systemd/system/openbot-gateway.service` ran `ExecStart=/usr/bin/openbot gateway run --bind loopback --port 18789 --force` with `Restart=always` / `RestartSec=5`, `WorkingDirectory=/usr/lib/node_modules/@upbeyond/openbot`. The unit was `disabled` (no boot autostart) but **active**.
2. `--force` took :18789 from the container. From 09:06 the container logged `another gateway instance is already listening on ws://127.0.0.1:18789` **129 times**, exiting with code **0** each time (not a crash, not OOM); `RestartCount` climbed to 121 and it was finally `SIGTERM`ed at 09:21:25.
3. The unit's environment has only `NODE_ENV` + `OPENBOT_DATA_MODE`; it lacks `OPENBOT_MULTITENANT` and `OPENBOT_TENANTS_ROOT`, so it read and wrote the **legacy global session root** while the container had been writing the **tenant-scoped root**. Tenant root last written **08:52**; global root started taking writes **09:07**. That gap is exactly the "missing latest history" the user saw.
4. Killing the process was not enough — systemd restarted it within 5s (the replacement process's cgroup `/system.slice/openbot-gateway.service` is what identified the supervisor).
   **Remediation (all applied 2026-07-26):**
   | Step | Action | Undo |
   | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
   | 1 | Removed the `openbot-gateway` entry from `/root/.pm2/dump.pm2` (args `gateway run --allow-unconfigured --port 18789 --bind loopback`), keeping `openbot-web` | restore `/root/.pm2/dump.pm2.bak-20260726T095748Z` |
   | 2 | `systemctl stop openbot-gateway.service` | — |
   | 3 | Moved the unit to `/root/openbot-gateway.service.disabled-by-incident-20260726T103500Z`, `daemon-reload`, `systemctl mask openbot-gateway.service` (a `systemctl start` now fails with `Unit is masked`) | `systemctl unmask` + move the unit file back + `daemon-reload` |
   | 4 | `podman start openbot-gateway-rc` — baseline reclaimed :18789 at 10:12:13 | — |
   | 5 | `npm uninstall -g @upbeyond/openbot` (636 packages; `/usr/bin/openbot` and `/usr/bin/openclaw` symlinks removed, no dangling links) | `tar -xzf /root/backups/upbeyond-openbot-1.0.1-20260726T110602Z.tar.gz -C /usr/lib/node_modules` (634 MB / 54823 files) |
   | 6 | `npm uninstall -g openclaw` (297 packages) — the last global package able to start a gateway; empty `@upbeyond/` dir cleaned up. `/usr/lib/node_modules` now holds only `corepack`, `npm`, `pm2` | `tar -xzf /root/backups/openclaw-2026.6.11-20260726T120749Z.tar.gz -C /usr/lib/node_modules` (60 MB / 32825 files) |
   **No session data was orphaned — earlier claim corrected.** An initial pass of this record asserted that the 7 transcripts written during the takeover window were "not visible to the restored baseline". That was an inference from the write timeline and it is **wrong**. Verified 2026-07-26 by asking the runtime itself (`podman exec openbot-gateway-rc node openbot.mjs sessions --agent <id> --json`), which is the only check that uses the runtime's own path resolution:
   | Session key | File (global root) | Runtime sees it |
   | ---------------------------------------------------------------------------- | -------------------------- | --------------- |
   | `agent:main:cron:57f802e3-…` (`Cron: 每日运营日报`) | `add3a575-….jsonl` (09:14) | yes |
   | `agent:main:cron:57f802e3-…:run:192b8f83-…` | `192b8f83-….jsonl` (09:07) | yes |
   | `agent:main:cron:2d5adba7-…` (`Cron: 竞品价格巡检`) | `21508e6c-….jsonl` (09:20) | yes |
   | `agent:main:cron:2d5adba7-…:run:1b4ed276-…` | `1b4ed276-….jsonl` (09:13) | yes |
   | `agent:agt-hedon25-126-com-np0bnb9:cron:741e163a-…` (`Cron: AI行业今日头条`) | `7152bb63-….jsonl` (09:16) | yes |
   | `agent:agt-hedon25-126-com-np0bnb9:cron:741e163a-…:run:16962c0d-…` | `16962c0d-….jsonl` (09:12) | yes |
   | `agent:bot--agent:main` (webchat direct, `Chrome · Mac`) | `d8112e58-….jsonl` (09:34) | yes |
   Why the inference was wrong: **the two roots are not old-vs-new, they are different scopes and both are live.**

- `/root/.openbot/agents/<agentId>/sessions/` — agent-scoped sessions for configured agents (`main`, `bot--agent`, `agt-*`): cron jobs, cron runs, webchat direct chats. Enumerated by the live runtime; confirmed still written after the restore (`agents/bot-skill/agent/growth-status.json` at 10:36).
- `/root/.openbot/tenants/<tenantId>/users/<userId>/state/agents/<agentId>/sessions/` — per-user isolated state for tenant/employee-scoped runs. Also written after the restore (10:36).
  The two are separate files (different inodes, not links) and diverge; the older runtime simply had no per-user isolation, so **its employee-scoped** work landed in the agent-scoped root. Six of the seven files are cron transcripts and one is a webchat chat — **none are employee-steward sessions** (those use `agent:main:employee:<uuid>` keys; 12 such keys are visible to the live runtime).
  **Migration was therefore not performed, by design.** Copying these into `tenants/001/users/<uuid>/…` would duplicate live sessions into a user scope and, for the `agt-hedon25-126-com-np0bnb9` cron transcripts, would attribute one person's data (`hedon25@126.com`) to another user's directory. There are 25 user directories across 7 tenants; there is no correct single target.
  **Residual risk closed:** `openclaw@2026.6.11` was archived and uninstalled on 2026-07-26 (`npm uninstall -g openclaw`, 297 packages). `/usr/lib/node_modules` now holds only `corepack`, `npm`, `pm2`; the empty `@upbeyond/` directory was removed. No `openbot`/`openclaw` executable remains on `PATH`, so there is no host-side path left to start a competing gateway. Archives for both removals:
  /root/backups/upbeyond-openbot-1.0.1-20260726T110602Z.tar.gz 634M / 54823 files
  /root/backups/openclaw-2026.6.11-20260726T120749Z.tar.gz 60M / 32825 files

# restore: tar -xzf <archive> -C /usr/lib/node_modules

**Rule added:** see "Port 18789 is owned by the container, exclusively" under Delivery pipeline (SoT).

## Prior cutover (2026-07-25) — v116 / production baseline recovery

| Field                    | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date                     | 2026-07-25 (container created 22:25:37 CST)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Decision                 | Stop overlaying recovery layers on the v109–v115 stack. Rebuild production from the **historical capability floor** (`2664b3633f`, successor of the 2026-07-21 full-converge anchor `4efda0adb5`) and forward-replay the v109–v115 features onto it, instead of continuing to cut over from `e860bba1b0` which is missing large parts of that floor.                                                                                                                                                                                                                                                                                                                                                                                      |
| Branch                   | `release/baseline-recovery-20260725` @ `127fc543f0` (annotated tag `rc-baseline-recovery-20260725`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Source revision          | `127fc543f036eb9353ce99afa22c81d7b16f73eb`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Ledger                   | `deploy/production/BASELINE_RECOVERY_20260725.md` (on the recovery branch) — ancestry proof, feature ledger v109–v115, replay queue, gate policy                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Image tag                | `openbot:rc-amd64-v116-baseline-recovery`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Image id                 | `c9b6a716af87eb1549a2ab71f2ccc2b12d527a0ce249ad37da1a712694f90989`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Build mode               | **Full image from tag** (gateway + UI same SHA), not a `dist` layer on a prior image                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Container                | `openbot-gateway-rc` (`restart=unless-stopped`, host network, loopback :18789, `--user 0`, cmd `node openbot.mjs gateway --bind loopback --port 18789`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Host                     | production Plan-A (`8.217.93.71`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Runtime version          | `OpenBot 2026.7.12-rc.2 (127fc54)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Control UI               | `index-CA6HLrrO.js`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Includes                 | Full capability floor restored: enterprise-model / data-capability / identity surfaces, tenant-context isolation, enterprise-data semantic catalog + event bus + data planner, agent-growth working-style, collaboration-learning capsules, tenant-import + migration-readiness, chat error sanitize, doctor-supervisor — **plus** replayed v109–v115: subscription contract enrichment (`aed34819fb`), sender avatars (`784d394592`), seat create + invite email (`3c0484a0d1`, `61ab6407ac`), archive action IA (`2a93c87ed4`), contract summary types (`cecaac56ef`), WeCom d.ts entry (`6194cdfca0`), space-import drawer unmount (`a69f4e58ca`). `pendingHumanInvites` / `pendingAdminActivations` content already on the candidate. |
| Excluded (still backlog) | `agents.runtime-health` (`3a426ae363`…`309090ad1d`, gateway + workbench pill); knowledge import IA replacement surface; IM OAuth `1183cc2bc7`; subscription reminder UI; DeepSeek remap; v111 `渠道凭证` copy                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Fixes vs v115            | v115 shipped `group-member-governance-panel.ts` calling `t("frontstage.workbench.memberGovernance.invitePending")` / `inviteSending` with **no locale definitions** (Kiro's `c64b671550` never landed on `deploy/user-modeling-v92`); `ui/src/i18n/lib/translate.ts` returns the raw key on miss, so the workbench rendered bare i18n keys. v116 serves both keys from `zh-CN-5zlaRzkV.js`.                                                                                                                                                                                                                                                                                                                                               |
| Smoke                    | healthz **200**; readyz **ready:true**; openbot.love / biz / admin all serve `index-CA6HLrrO.js` (matches `/app/dist/control-ui/assets` in the image); in-image markers `pendingAdminActivations` **6**, `pendingHumanInvites` **20**, `创建租户` **13**, `企业通道` **2**, `已纳管模型资产` **1**, `working-style-effects` **5**; `wecom.js` + `wecom.d.ts` present in `/app/dist/plugin-sdk`                                                                                                                                                                                                                                                                                                                                            |
| Gate policy              | Δ-based, per the recovery ledger: `tsgo` Δ=0 vs candidate (189 pre-existing), format Δ≤0, replay scoped tests 13/13, `build:docker` + `release:check` PASS, `install --frozen-lockfile` PASS. Absolute-green `tsgo` / `check` / full `pnpm test` **not** required for this cut because the failures pre-exist on `2664b3633f` (full run: 173 failed / 11858 passed).                                                                                                                                                                                                                                                                                                                                                                      |
| Rollback                 | `openbot-gateway-rc-prev-v116-safety` / `localhost/openbot:rc-amd64-v115-pending-admin-activations` (`317e6521e7de`) — **note:** rolling back re-introduces the v115 capability regression; prefer forward-fixing on the recovery branch                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Hold                     | `/root/.openbot/CUTOVER_HOLD.txt` — `v116-baseline-recovery BASELINE LOCKED`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Executor                 | `cursor-agent` (build/cutover) · `kiro-deploy-audit` (post-cutover L3 verification + this record)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

### Rollback to v115

podman rename openbot-gateway-rc-prev-v116-safety openbot-gateway-rc

### Record-drift note (why this entry exists)

The v116 cutover happened at 22:25 CST but neither this file nor the on-host hold marker was updated: both still declared v115 / `e860bba1b0` / `index-B4ez0wvV.js` and `SoT: deploy/user-modeling-v92 ONLY` (hold file mtime 20:47, i.e. ~1h38m before the v116 container was created). Anyone following those records would have cut over from the regressed branch. Both were corrected on 2026-07-25 after an L3 audit. **Keep this file and `CUTOVER_HOLD.txt` in the same commit-and-deploy step as the cutover itself.**

## Prior cutover (2026-07-25) — v115 / platform pendingAdminActivations

| Field           | Value                                                                                                                                                                                                                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Date            | 2026-07-25 (container live ~20:50 CST)                                                                                                                                                                                                                                                           |
| Decision        | Restore archive platform admin-activation queue on SoT tip; keep live `subscription-contract-enrichment`; skip conflicting port-shells browser test rewrites                                                                                                                                     |
| Branch          | isolated SoT tip from `69e570f3b2` + cherry-picks → `e860bba1b0` (`refs/v115-pending-admin`)                                                                                                                                                                                                     |
| Source revision | `e860bba1b08dec00cc9ac9a98549c4d244eab673`                                                                                                                                                                                                                                                       |
| Includes        | `buildPlatformPendingAdminActivationsView` + contract/bootstrap/tenants adapter/page wiring; omit `latestDisplayCode`; unit tests for view builder                                                                                                                                               |
| Excluded        | `f51e831598` / `08c48e4ee9` port-shells browser tests (conflict with current tenant IA); IM OAuth                                                                                                                                                                                                |
| Image tag       | `openbot:rc-amd64-v115-pending-admin-activations`                                                                                                                                                                                                                                                |
| Image id        | `317e6521e7de`                                                                                                                                                                                                                                                                                   |
| Build mode      | **Full `dist` layer** on `rc-amd64-v114-sot-tip-converge` after isolated gates                                                                                                                                                                                                                   |
| Runtime version | `OpenBot 1.0.1 (e860bba)`                                                                                                                                                                                                                                                                        |
| Control UI      | `index-B4ez0wvV.js`                                                                                                                                                                                                                                                                              |
| Smoke           | healthz **200**; readyz **ready:true**; biz/admin/openbot.love all `index-B4ez0wvV.js`; markers `pendingAdminActivations` **6**, `创建租户` **13**, `pendingHumanInvites` **20**; `wecom.js` present; `/wecom` → **400 missing echostr**; enrichment tests **2/2** + pending-admin tests **3/3** |
| Rollback        | `openbot-gateway-rc-prev-v115-safety` / `localhost/openbot:rc-amd64-v114-sot-tip-converge`                                                                                                                                                                                                       |
| Hold            | `/root/.openbot/CUTOVER_HOLD.txt` — `v115-pending-admin-activations BASELINE LOCKED`                                                                                                                                                                                                             |
| Executor        | `cursor-agent`                                                                                                                                                                                                                                                                                   |

### Rollback to v114

podman rename openbot-gateway-rc-prev-v115-safety openbot-gateway-rc

## Prior cutover (2026-07-25) — v114 / SoT tip converge (unpublished employee invite fix)

| Field                    | Value                                                                                                                                                                                                                                                                                          |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date                     | 2026-07-25 (container live ~20:36 CST)                                                                                                                                                                                                                                                         |
| Decision                 | Audit found SoT tip code ahead of live v113; full-dist converge so employee collaboration pending-human-invite behavior matches SoT without replaying archive dual-SoT history                                                                                                                 |
| Branch                   | `deploy/user-modeling-v92` @ `05f57a5eb7` (includes origin tip `69e570f3b2` + local docs commit)                                                                                                                                                                                               |
| Source revision          | `05f57a5eb761133ccd89c1856b5ddb514d504c84`                                                                                                                                                                                                                                                     |
| Code delta vs live v113  | `dcbc79804c` + `69e570f3b2` — track pending human invitations / single-action invite (employee workbench)                                                                                                                                                                                      |
| Image tag                | `openbot:rc-amd64-v114-sot-tip-converge`                                                                                                                                                                                                                                                       |
| Image id                 | `8c9be90cee774fc989a9d0ee1f91fe282df5cfb868c2bcf07eeb1b67357256bd`                                                                                                                                                                                                                             |
| Build mode               | **Full `dist` layer** on `rc-amd64-v113-wecom-integrity` after isolated file gates (`wecom.js`/`wecom.d.ts`/`release-check`)                                                                                                                                                                   |
| Container                | `openbot-gateway-rc` (`restart=unless-stopped`, host network, loopback :18789, `--user 0`)                                                                                                                                                                                                     |
| Host                     | production Plan-A (`8.217.93.71`)                                                                                                                                                                                                                                                              |
| Includes                 | v113 WeCom integrity + employee `pendingHumanInvites` tip commits                                                                                                                                                                                                                              |
| Excluded (still backlog) | `pendingAdminActivations` archive stack; IM OAuth `1183cc2bc7`; subscription reminder UI; knowledge MERGE A full wiring                                                                                                                                                                        |
| Runtime version          | `OpenBot 1.0.1 (05f57a5)`                                                                                                                                                                                                                                                                      |
| Control UI               | `index-XW4PC5Wp.js`                                                                                                                                                                                                                                                                            |
| Smoke                    | healthz **200**; readyz **ready:true**; biz/admin/openbot.love all `index-XW4PC5Wp.js`; bundle markers `pendingHumanInvites` **20**, `渠道凭证` **8**, `创建租户` **13**, `已纳管模型资产` **1**; no `root-alias.cjs/wecom` load errors; `/wecom` → **400 missing echostr** (route registered) |
| Rollback                 | `openbot-gateway-rc-prev-v114-safety` / `localhost/openbot:rc-amd64-v113-wecom-integrity`                                                                                                                                                                                                      |
| Hold                     | `/root/.openbot/CUTOVER_HOLD.txt` — `v114-sot-tip-converge BASELINE LOCKED`                                                                                                                                                                                                                    |
| Executor                 | `cursor-agent`                                                                                                                                                                                                                                                                                 |

### Rollback to v113

podman rename openbot-gateway-rc-prev-v114-safety openbot-gateway-rc

## Prior cutover (2026-07-25) — v113 / WeCom integrity recovery

| Field               | Value                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date                | 2026-07-25 (container live ~15:00 CST)                                                                                                                                                                                                                                                                                                                                                                                                    |
| Decision            | Restore the complete reviewed `6c1f5077da` WeCom bundled-loading contract on the current v112 capability floor without importing OAuth identity semantics                                                                                                                                                                                                                                                                                 |
| Branch              | `deploy/user-modeling-v92` @ `0c7bc1ea20`                                                                                                                                                                                                                                                                                                                                                                                                 |
| Source revision     | `0c7bc1ea2020308156c3fc7b14feee2fbb5b6687`                                                                                                                                                                                                                                                                                                                                                                                                |
| Image tag           | `openbot:rc-amd64-v113-wecom-integrity`                                                                                                                                                                                                                                                                                                                                                                                                   |
| Image id            | `0fd0fd57f4be139d59665ed43555d3707ce25e948f4cd346e3ebea3ad23ea264`                                                                                                                                                                                                                                                                                                                                                                        |
| Build mode          | Full `dist` replacement from current SoT tip on `rc-amd64-v112-platform-recovery`; isolated image gates passed before cutover                                                                                                                                                                                                                                                                                                             |
| Includes            | v112 + dedicated `openclaw/plugin-sdk/wecom` runtime/declaration entries + bundled auto-enable + lazy reply dispatch + signed callback verification + release artifact checks                                                                                                                                                                                                                                                             |
| Excluded            | `1183cc2bc7` and all WeCom/Feishu/DingTalk OAuth inbound identity semantics; deferred to v114+                                                                                                                                                                                                                                                                                                                                            |
| Behavior divergence | Preserved current `1.0.1` versions and collaboration/AOR/knowledge build scripts; added the current stable declaration-entry generator adaptation omitted by the archive commit                                                                                                                                                                                                                                                           |
| Runtime version     | `OpenBot 1.0.1 (0c7bc1e)`                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Control UI          | `index-kPhsHlRm.js`                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Smoke               | scoped tests **73/73** plus final SDK subpath **12/12**; `pnpm build:docker` and isolated-cache release-check pass; `wecom.js` + `wecom.d.ts` present; isolated and live plugin `enabled:true,status:loaded`; `/wecom` returns `400 missing echostr`; no WeCom/root-alias load errors; healthz **200**; readyz **ready:true**; biz/admin/openbot.love all serve `index-kPhsHlRm.js`; enterprise/employee/platform bundle markers verified |
| Rollback            | `openbot-gateway-rc-prev-v113-safety` / `localhost/openbot:rc-amd64-v112-platform-recovery`                                                                                                                                                                                                                                                                                                                                               |
| Hold                | `/root/.openbot/CUTOVER_HOLD.txt` — `v113-wecom-integrity BASELINE LOCKED`                                                                                                                                                                                                                                                                                                                                                                |
| Executor            | `codex-v113-wecom-integrity`                                                                                                                                                                                                                                                                                                                                                                                                              |

### Rollback to v112

podman rename openbot-gateway-rc-prev-v113-safety openbot-gateway-rc

## Prior cutover (2026-07-25) — v112 / platform management recovery

| Field           | Value                                                                                                                                                                                                                                                                                                                                                                            |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date            | 2026-07-25 (container live ~13:02 CST)                                                                                                                                                                                                                                                                                                                                           |
| Decision        | Restore the latest verified July platform dashboard, tenant lifecycle, structured pricing, managed-model, and system-settings surfaces on top of v111                                                                                                                                                                                                                            |
| Branch          | `deploy/user-modeling-v92` @ `51bf93ec4c`                                                                                                                                                                                                                                                                                                                                        |
| Source revision | `51bf93ec4c9b17b6a3b5b5ed1a6eb55f69eaaa89`                                                                                                                                                                                                                                                                                                                                       |
| Image tag       | `openbot:rc-amd64-v112-platform-recovery`                                                                                                                                                                                                                                                                                                                                        |
| Image id        | `caf3abd4c8d3551ac07a61aadcd53515e3cde3014639351be3bc2df4deaabf1a`                                                                                                                                                                                                                                                                                                               |
| Build mode      | **Full `dist` layer** on `rc-amd64-v111-settings-budget-recovery-fixed`; original `docker-entrypoint.sh` and gateway CMD preserved                                                                                                                                                                                                                                               |
| Container       | `openbot-gateway-rc` (`restart=unless-stopped`, host network, loopback :18789, `--user 0`)                                                                                                                                                                                                                                                                                       |
| Host            | production Plan-A (`8.217.93.71`)                                                                                                                                                                                                                                                                                                                                                |
| Includes        | v111 + compact platform KPI/cost overview + tenant lifecycle/detail/trial flows + structured quotas/meters + managed model assets/credential auto-catalog + platform system-settings/create-tenant recovery                                                                                                                                                                      |
| Runtime version | `OpenBot 1.0.1 (51bf93e)`                                                                                                                                                                                                                                                                                                                                                        |
| Control UI      | `index-kPhsHlRm.js`                                                                                                                                                                                                                                                                                                                                                              |
| Smoke           | platform tests **197/197**; `pnpm ui:build` and `pnpm build:docker` pass; healthz **200**; readyz **ready:true**; admin/biz both serve `index-kPhsHlRm.js`; public bundle markers: `暂无已纳管模型资产` **1**, `创建租户` **13**, `试用申请` **17**, `计量` **5**; platform login redirect rendered after restart, authenticated click-through not bypassed after session expiry |
| Rollback        | `openbot-gateway-rc-prev-v112-safety` / `localhost/openbot:rc-amd64-v111-settings-budget-recovery-fixed`                                                                                                                                                                                                                                                                         |
| Hold            | `/root/.openbot/CUTOVER_HOLD.txt` — `codex-v112-platform-recovery BASELINE LOCKED`                                                                                                                                                                                                                                                                                               |
| Executor        | `codex-v112-platform-recovery`                                                                                                                                                                                                                                                                                                                                                   |

### Rollback to v111

podman rename openbot-gateway-rc-prev-v112-safety openbot-gateway-rc

## Prior cutover (2026-07-25) — v111 / enterprise settings and cost-budget recovery

| Date | 2026-07-25 (container live ~11:49 CST) |
| Decision | Restore the latest verified enterprise system-settings channel surface and the July 19 cost-budget loading/isolation fixes without replacing the v110 enterprise stack |
| Branch | `deploy/user-modeling-v92` @ `5d73d64c60` |
| Source revision | `5d73d64c6008f7fd6c82c506ae122487dc8ce813` |
| Image tag | `openbot:rc-amd64-v111-settings-budget-recovery-fixed` |
| Image id | `45b2fd4768d4cf6ff3d59c2e8cbf5c1ca00d0207c0628ee7fe0206186f24ccc2` |
| Build mode | **Full `dist` layer** on `rc-amd64-v110-enterprise-converge`; original `docker-entrypoint.sh` and gateway CMD preserved |
| Container | `openbot-gateway-rc` (`restart=unless-stopped`, host network, loopback :18789, `--user 0`) |
| Includes | v110 + tenant-scoped channel config controller + channels nested under enterprise system settings + legacy `/channels` rewrite + tenant-isolated cost-budget loading/status/retry fixes |
| Runtime version | `OpenBot 1.0.1 (5d73d64)` |
| Control UI | `index-BoUsqfuU.js` |
| Smoke | healthz **200**; readyz **ready:true**; public biz serves `index-BoUsqfuU.js`; bundle markers: `渠道凭证` **8**, `cost-budget-v2-settings-page` **10**; UI tests **210** total across recovery suites |
| Rollback | `openbot-gateway-rc-prev-v111-safety` / `localhost/openbot:rc-amd64-v110-enterprise-converge` |
| Hold | `/root/.openbot/CUTOVER_HOLD.txt` — `codex-v111-recovery BASELINE LOCKED` |
| Executor | `codex-v111-recovery` |

### Rollback to v110

podman rename openbot-gateway-rc-prev-v111-safety openbot-gateway-rc

## Prior cutover (2026-07-25) — v110 / enterprise converge (all ports)

| Field           | Value                                                                                                                                                                                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date            | 2026-07-25 (container live ~11:04 CST)                                                                                                                                                                                                                  |
| Decision        | Owner-approved: bring codex enterprise stack onto SoT so biz/admin/gw share tip content                                                                                                                                                                 |
| Branch          | `deploy/user-modeling-v92` @ `55973d1a86`                                                                                                                                                                                                               |
| Source revision | `55973d1a86170726598a2ee6bfcd62d357e04082`                                                                                                                                                                                                              |
| Image tag       | `openbot:rc-amd64-v110-enterprise-converge`                                                                                                                                                                                                             |
| Image id        | `bb74b13809da92c093d0d5643c000b01afbf16c7b7e80fddf862eed36479c7ce`                                                                                                                                                                                      |
| Build mode      | **Full `dist` layer** on `rc-amd64-v109-baseline-full`                                                                                                                                                                                                  |
| Container       | `openbot-gateway-rc` (`restart=unless-stopped`, host network, loopback :18789, `--user 0`)                                                                                                                                                              |
| Host            | production Plan-A (`8.217.93.71`)                                                                                                                                                                                                                       |
| Includes        | v109 + robots/groups + seat AI archive + member invite + archive IA + seat-bind + monthly usage controller                                                                                                                                              |
| Runtime version | `OpenBot 1.0.1 (55973d1)`                                                                                                                                                                                                                               |
| Control UI      | `index-OXsFurst.js`                                                                                                                                                                                                                                     |
| Smoke           | healthz **200**; readyz **ready:true**; markers: `senderIdentityLookup` **4**, `invitePending` **1**, `identity-lifecycle` **1**, `digital-ownership` **1**, `create-position-email` **2**; **biz/admin/gw/openbot.love** all serve `index-OXsFurst.js` |
| Rollback        | `openbot-gateway-rc-prev-v110-safety` / `localhost/openbot:rc-amd64-v109-baseline-full`                                                                                                                                                                 |
| Hold            | `/root/.openbot/CUTOVER_HOLD.txt` — `cursor-baseline-v110 BASELINE LOCKED`                                                                                                                                                                              |
| Executor        | `cursor-agent`                                                                                                                                                                                                                                          |

### Rollback to v109

podman rename openbot-gateway-rc-prev-v110-safety openbot-gateway-rc

## Prior cutover (2026-07-25) — v109 / baseline full-dist

| Field                       | Value                                                                                                                                                                                                                |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date                        | 2026-07-25 (container live ~10:10 CST)                                                                                                                                                                               |
| Decision                    | Owner-approved baseline converge: single SoT + tip-homologous full `dist` to escape stale `8d34b63` gateway UI-layer stack                                                                                           |
| Branch                      | `deploy/user-modeling-v92` @ `76e8dec185`                                                                                                                                                                            |
| Source revision             | `76e8dec185a313c73c4503509859de98611ab658`                                                                                                                                                                           |
| Image tag                   | `openbot:rc-amd64-v109-baseline-full`                                                                                                                                                                                |
| Image id                    | `b3d3af405f9047553e14f931c75b1737a69e96a931d6ce54543b6da52f052746`                                                                                                                                                   |
| Build mode                  | **Full `dist` layer** on `rc-amd64-v108-enterprise-nav-lag-restore` (`rm -rf /app/dist` + copy tip `pnpm build:docker` output)                                                                                       |
| Container                   | `openbot-gateway-rc` (`restart=unless-stopped`, host network, loopback :18789, `--user 0`)                                                                                                                           |
| Host                        | production Plan-A (`8.217.93.71`)                                                                                                                                                                                    |
| Includes                    | v108 nav-lag + tip gateway (import IA / multi-host auth / user-modeling / memory governance / …); subscription contract enrichment; chat checkpoint boundary placement + session message id preserve; sender avatars |
| Runtime version             | `OpenBot 1.0.1 (76e8dec)` — `dist/build-info.json` commit `76e8dec185…`                                                                                                                                              |
| Control UI                  | `index-hwRDwyou.js`                                                                                                                                                                                                  |
| Smoke                       | healthz **200**; readyz **ready:true**; single bundle; `senderIdentityLookup` **4**; public `https://biz.openbot.love/` serves `index-hwRDwyou.js`                                                                   |
| Rollback                    | `openbot-gateway-rc-prev-v109-safety` / `localhost/openbot:rc-amd64-v108-enterprise-nav-lag-restore`                                                                                                                 |
| Hold                        | `/root/.openbot/CUTOVER_HOLD.txt` — `cursor-baseline-v109 BASELINE LOCKED`                                                                                                                                           |
| Executor                    | `cursor-agent`                                                                                                                                                                                                       |
| Deferred WIP (not in image) | DeepSeek model remap; subscription reminder UI helpers (unwired)                                                                                                                                                     |

### Rollback to v108

podman rename openbot-gateway-rc-prev-v109-safety openbot-gateway-rc

## Prior cutover (2026-07-25) — v108 / enterprise nav-lag restore

| Field           | Value                                                                                                                                                                                                           |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date            | 2026-07-25 (container live ~09:57 CST)                                                                                                                                                                          |
| Decision        | Owner-approved converge: restore orphaned enterprise sidebar nav-lag fix after concurrent cutovers wiped it                                                                                                     |
| Branch          | `deploy/user-modeling-v92` @ `45ebcac47f`                                                                                                                                                                       |
| Source revision | `45ebcac47f9692c669ffd8824662f4cfc2167de3` (cherry-picks `0c5933039a` + `4174849c09`)                                                                                                                           |
| Image tag       | `openbot:rc-amd64-v108-enterprise-nav-lag-restore`                                                                                                                                                              |
| Image id        | `481ddf78ff1f316f02fa92b75e8afcff725970398fcf20bcb043ed0ba80f0519`                                                                                                                                              |
| Build mode      | Control UI layer on `rc-amd64-v106-checkpoint-boundary-placement` (**clean** `rm -rf` + copy; single `index-*.js`)                                                                                              |
| Container       | `openbot-gateway-rc` (`restart=unless-stopped`, host network, loopback :18789, `--user 0`)                                                                                                                      |
| Host            | production Plan-A (`8.217.93.71`)                                                                                                                                                                               |
| Includes        | Scoped enterprise `refreshActiveTab`; optimistic sidebar tab paint; `pushAppHistoryState`; governance refresh uses `requestOpenBotAppRerender` (no popstate re-entry); retains v106 checkpoint + sender avatars |
| Runtime version | `OpenBot 2026.7.12-rc.2 (8d34b63)` (gateway base) + UI tip `45ebcac47f`                                                                                                                                         |
| Control UI      | `index-vonOpmbe.js`                                                                                                                                                                                             |
| Smoke           | healthz **200**; readyz **ready:true**; single bundle in container; `senderIdentityLookup` **4**; public `https://biz.openbot.love/` serves `index-vonOpmbe.js`                                                 |
| Rollback        | `openbot-gateway-rc-prev-v108-safety` / `localhost/openbot:rc-amd64-v106-checkpoint-boundary-placement`                                                                                                         |
| Hold            | superseded by v109 baseline lock                                                                                                                                                                                |
| Executor        | `cursor-agent`                                                                                                                                                                                                  |
| Out of scope    | `feat/enterprise-channels-under-settings` and `codex/openbot-enterprise-channels-release` seat-bind/archive IA (diverged; separate converge)                                                                    |

### Rollback to v106

podman rename openbot-gateway-rc-prev-v108-safety openbot-gateway-rc

## Prior cutover (2026-07-25) — v104 / collaboration per-sender chat avatars

| Field           | Value                                                                                                                                         |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Date            | 2026-07-25 (UTC ~00:32 build; container live ~08:32 CST)                                                                                      |
| Decision        | Owner-approved: deploy collaboration chat avatar fix (per-sender emoji/initials)                                                              |
| Branch          | `deploy/user-modeling-v92` @ `59521d8c2a`                                                                                                     |
| Source revision | `59521d8c2a6e55f54da65132e60bc4cb9ed61c89`                                                                                                    |
| Image tag       | `openbot:rc-amd64-v104-collaboration-sender-avatars`                                                                                          |
| Image id        | `03b1dd7f0d926232c308e08e22eb9d1bb1562553c8445f0a5e4a4a0a497398d1`                                                                            |
| Build mode      | Control UI layer on `rc-amd64-v103-archive-action-ia`                                                                                         |
| Container       | `openbot-gateway-rc` (`restart=unless-stopped`, host network, loopback :18789)                                                                |
| Host            | production Plan-A (`8.217.93.71`)                                                                                                             |
| Includes        | `buildChatSenderIdentityLookup` + `participantAgents` wiring; retains v103 archive-action IA                                                  |
| Control UI      | `index-C6eNfy8u.js`                                                                                                                           |
| Smoke           | healthz **200**; readyz **ready:true**; bundle contains `senderIdentityLookup`; public `https://biz.openbot.love/` serves `index-C6eNfy8u.js` |
| Rollback        | `localhost/openbot:rc-amd64-v103-archive-action-ia` (safety: `openbot-gateway-rc-prev-v103-safety`)                                           |
| Executor        | `cursor-composer`                                                                                                                             |

### Rollback to v103

podman rename openbot-gateway-rc-prev-v103-safety openbot-gateway-rc

## Prior cutover (2026-07-25) — v99 / import IA + platform auth multi-host

| Field           | Value                                                                                                                                                    |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date            | 2026-07-25 (UTC ~08:20 build; container live ~08:22 UTC / 16:22 CST)                                                                                     |
| Decision        | Owner-approved: merge `codex/deploy-import-ia-v94` import IA into `deploy/user-modeling-v92` lineage and redeploy                                        |
| Branch          | `deploy/user-modeling-v92` @ `2a4019fb2b` (local commits; push pending rebase onto remote)                                                               |
| Source revision | `2a4019fb2bf35dc6f791a4ed915b9770380cde28`                                                                                                               |
| Image tag       | `openbot:rc-amd64-v99-import-ia-platform-auth`                                                                                                           |
| Image id        | `a3a3e78f96cd3702a09f90175ec1cace3ee4fc448f6bcff1d61df8427fd3a1e4`                                                                                       |
| Build mode      | Full `dist` layer on `rc-amd64-v98-platform-auth-multi-host`                                                                                             |
| Container       | `openbot-gateway-rc` (`restart=unless-stopped`, host network, loopback :18789)                                                                           |
| Host            | production Plan-A (`8.217.93.71`)                                                                                                                        |
| Includes        | Fullscreen `spaceImport` page (localFolder/url/note/active); gateway `knowledge.local-folder.*`; retains v98 multi-host platform auth + deliverable save |
| Runtime version | `OpenBot 1.0.1 (02039c5)`                                                                                                                                |
| Control UI      | `index-D44DPePj.js`                                                                                                                                      |
| Smoke           | healthz **200**; readyz **ready:true**; UI bundle contains `spaceImport` + `localFolder`; dist contains `local-folder-watcher-*.js`                      |
| Rollback        | `localhost/openbot:rc-amd64-v98-platform-auth-multi-host` (safety: `openbot-gateway-rc-prev-v98-safety`)                                                 |
| Executor        | `cursor-composer`                                                                                                                                        |

### Rollback to v98

podman rename openbot-gateway-rc-prev-v98-safety openbot-gateway-rc

## Prior cutover (2026-07-25) — v101 / enterprise nav lag fix

| Field           | Value                                                                                                                                                                                                    |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date            | 2026-07-25 (UTC ~00:07 build; container live ~00:11 UTC / 08:11 CST)                                                                                                                                     |
| Decision        | Owner-approved: deploy enterprise sidebar nav lag fix (scoped tab refresh + SPA history helpers)                                                                                                         |
| Branch          | `deploy/user-modeling-v92` @ `4174849c09`                                                                                                                                                                |
| Source revision | `4174849c0973cd1b3976cc8d7a287e4cb7d588ad`                                                                                                                                                               |
| Image tag       | `openbot:rc-amd64-v101-enterprise-nav-lag`                                                                                                                                                               |
| Image id        | `bd80a1b17ad5a1d6652ec4e4680c364f4a12827c151ffbccb0a6aa69da781205`                                                                                                                                       |
| Build mode      | Control UI layer on `rc-amd64-v93-enterprise-channels-user-modeling`                                                                                                                                     |
| Container       | `openbot-gateway-rc` (`restart=unless-stopped`, host network, loopback :18789)                                                                                                                           |
| Host            | production Plan-A (`8.217.93.71`)                                                                                                                                                                        |
| Env             | Keeps `OPENBOT_PUBLIC_APP_BASE_URLS`; host brand overlay cron (`apply-control-ui-brand.sh`)                                                                                                              |
| Includes        | Scoped enterprise `refreshActiveTab`; optimistic sidebar tab paint; `pushAppHistoryState` for capability/access/sidebar; governance refresh no longer re-enters popstate; OpenBot favicon `?v=20260722a` |
| Runtime version | `OpenBot 2026.7.12-rc.2 (8d34b63)` (gateway base) + UI tip `4174849c09`                                                                                                                                  |
| Control UI      | `index-Dni_9p28.js`                                                                                                                                                                                      |
| Smoke           | healthz **200**; readyz **ready**; single gateway; `https://biz.openbot.love/` serves `index-Dni_9p28.js`; favicon no lobster; biz login **401** not 403                                                 |
| Rollback        | `localhost/openbot:rc-amd64-v100-employee-robots-groups-ux` / `localhost/openbot:rc-amd64-v99-enterprise-channels-stable`                                                                                |
| Executor        | `cursor-daniel`                                                                                                                                                                                          |
| Hold            | `/root/.openbot/CUTOVER_HOLD.txt` — do not replace without coordination                                                                                                                                  |

### Rollback to v100

podman run -d --replace --name openbot-gateway-rc --restart=unless-stopped --network host --user 0 \
--env-file /root/.openbot/.env.docker \
-v /root/.openbot:/root/.openbot \
-v /var/tmp/openbot-compile-cache:/var/tmp/openbot-compile-cache \
localhost/openbot:rc-amd64-v100-employee-robots-groups-ux \
node openbot.mjs gateway --bind loopback --port 18789
/root/.openbot/bin/apply-control-ui-brand.sh

## Prior cutover (2026-07-25) — v97 / user modeling panel registration fix

| Field           | Value                                                                                                                   |
| --------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Date            | 2026-07-25 (UTC ~21:42 build; container live ~21:42 UTC / 05:42 CST)                                                    |
| Decision        | Owner-approved: fix blank learned-preferences panel (missing side-effect import for custom element registration)        |
| Branch          | `deploy/user-modeling-v92` @ `e1b9776023`                                                                               |
| Source revision | `e1b9776023edd2fef5277557072ef808f4fc63a5`                                                                              |
| Image tag       | `openbot:rc-amd64-v97-user-modeling-panel-import`                                                                       |
| Image id        | `1d1eae917c450506f0c27fa85e47b30a2bf43d23bbbdc62707be940c45b22e49`                                                      |
| Build mode      | Full `dist` layer on `rc-amd64-v96-user-modeling-ui-fix`                                                                |
| Container       | `openbot-gateway-rc` (`restart=unless-stopped`, host network, loopback :18789)                                          |
| Host            | production Plan-A (`8.217.93.71`)                                                                                       |
| Includes        | `import user-learned-preferences-panel.ts` in settings page; panel renders hint / empty state / refresh + clear buttons |
| Runtime version | `OpenBot 1.0.1 (3d4f0f8)`                                                                                               |
| Control UI      | `index-j9FKxlDV.js`                                                                                                     |
| Smoke           | healthz **200**; readyz **200**; `https://openbot.love/` **200**; UI bundle contains `user-learned-preferences-panel`   |
| Rollback        | `localhost/openbot:rc-amd64-v96-user-modeling-ui-fix`                                                                   |
| Executor        | `cursor-composer`                                                                                                       |

### Rollback to v96 (user modeling UI fix)

podman run -d --name openbot-gateway-rc --restart=unless-stopped --network host --user 0 \
--env-file /tmp/openbot-gateway-rc.env \
localhost/openbot:rc-amd64-v96-user-modeling-ui-fix \

## Prior cutover (2026-07-25) — v96 / user modeling UI fix (Light DOM + i18n + RPC errors)

| Date | 2026-07-25 (UTC ~16:07 build; container live ~16:07 UTC / 00:07 CST) |
| Decision | Owner-approved: fix learned preferences panel blank UI (Shadow DOM → Light DOM), i18n, RPC error surfacing |
| Branch | `deploy/user-modeling-v92` @ `c7212b36ce` |
| Source revision | `c7212b36ceda4e140d72c676c4506097781c01d5` |
| Image tag | `openbot:rc-amd64-v96-user-modeling-ui-fix` |
| Image id | `2890f7bf922daf5944be3779d23a88ecc5c76685f0d105a966873527dffd76d4` |
| Build mode | Full `dist` layer on `rc-amd64-v95-collaboration-deliverable-preview` |
| Container | `openbot-gateway-rc` (`restart=unless-stopped`, host network, loopback :18789) |
| Includes | `user-learned-preferences-panel` Light DOM; workbench CSS classes; `t()` i18n for settings title/subtitle; RPC `{ ok, error }` handling + client reconnect retry |
| Runtime version | `OpenBot 1.0.1 (1f4b1c9)` |
| Control UI | `index-sl0vS2sk.js` |
| Smoke | healthz **200**; readyz **200**; `https://openbot.love/` **200**; `https://admin.openbot.love/` **200**; 15 dist files contain `user-modeling.get-profile`; UI bundle contains `user-learned-preferences-panel` |
| Rollback | `localhost/openbot:rc-amd64-v95-collaboration-deliverable-preview` |
| Executor | `cursor-composer` |

### Rollback to v95 (collaboration deliverable preview)

localhost/openbot:rc-amd64-v95-collaboration-deliverable-preview \

## Prior cutover (2026-07-24) — v95 / collaboration deliverable preview

| Field           | Value                                                                                                                                                 |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date            | 2026-07-24 (UTC ~15:16 build; container live ~15:16 UTC / 23:16 CST)                                                                                  |
| Decision        | Owner-approved: land collaboration deliverable preview (group manifest read, workspace file preview, sidebar save-to-KB)                              |
| Branch          | `deploy/user-modeling-v92` @ `7be6e3a4ed`                                                                                                             |
| Source revision | `7be6e3a4ed02990c2e64edd562b5e4e598323347`                                                                                                            |
| Image tag       | `openbot:rc-amd64-v95-collaboration-deliverable-preview`                                                                                              |
| Image id        | `293d40440a00a1e8de08b5ed99c743c868ca2b9929ed0e53824f748767f5e9a6`                                                                                    |
| Build mode      | Full `dist` layer on `rc-amd64-v94-user-modeling`                                                                                                     |
| Container       | `openbot-gateway-rc` (`restart=unless-stopped`, host network, loopback :18789)                                                                        |
| Host            | production Plan-A (`8.217.93.71`)                                                                                                                     |
| Includes        | `workbench.group-manifest.read` / `workbench.group-file.read`; `knowledge.deliverables.saveAndArchive`; group deliverable sidebar preview + save chip |
| Runtime version | `OpenBot 1.0.1 (dd89c01)`                                                                                                                             |
| Control UI      | `index-OrNd80I2.js`                                                                                                                                   |
| Smoke           | healthz **200**; readyz **200**; dist contains `workbench.group-manifest.read`; UI bundle contains group deliverable preview flow                     |
| Rollback        | `localhost/openbot:rc-amd64-v94-user-modeling`                                                                                                        |
| Executor        | `cursor-composer`                                                                                                                                     |

- **L3 verified:** SSH `root@8.217.93.71` + podman inspect + `openbot.mjs --version` on **2026-07-24** (v95 cutover ~15:16 UTC / 23:16 CST).

## Latest cutover (2026-07-24) — v95 / collaboration deliverable preview

| Field           | Value                                                                                                                                                 |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date            | 2026-07-24 (UTC ~15:16 build; container live ~15:16 UTC / 23:16 CST)                                                                                  |
| Decision        | Owner-approved: land collaboration deliverable preview (group manifest read, workspace file preview, sidebar save-to-KB)                              |
| Branch          | `deploy/user-modeling-v92` @ `7be6e3a4ed`                                                                                                             |
| Source revision | `7be6e3a4ed02990c2e64edd562b5e4e598323347`                                                                                                            |
| Image tag       | `openbot:rc-amd64-v95-collaboration-deliverable-preview`                                                                                              |
| Image id        | `293d40440a00a1e8de08b5ed99c743c868ca2b9929ed0e53824f748767f5e9a6`                                                                                    |
| Build mode      | Full `dist` layer on `rc-amd64-v94-user-modeling`                                                                                                     |
| Container       | `openbot-gateway-rc` (`restart=unless-stopped`, host network, loopback :18789)                                                                        |
| Host            | production Plan-A (`8.217.93.71`)                                                                                                                     |
| Includes        | `workbench.group-manifest.read` / `workbench.group-file.read`; `knowledge.deliverables.saveAndArchive`; group deliverable sidebar preview + save chip |
| Runtime version | `OpenBot 1.0.1 (dd89c01)`                                                                                                                             |
| Control UI      | `index-OrNd80I2.js`                                                                                                                                   |
| Smoke           | healthz **200**; readyz **200**; dist contains `workbench.group-manifest.read`; UI bundle contains group deliverable preview flow                     |
| Rollback        | `localhost/openbot:rc-amd64-v94-user-modeling`                                                                                                        |
| Executor        | `cursor-composer`                                                                                                                                     |

### Rollback to v94 (user modeling)

```bash
podman stop openbot-gateway-rc && podman rm openbot-gateway-rc
podman run -d --name openbot-gateway-rc --restart=unless-stopped --network host --user 0 \
  --env-file /tmp/openbot-gateway-rc.env \
  -v /root/.openbot:/root/.openbot \
  -v /var/tmp/openbot-compile-cache:/var/tmp/openbot-compile-cache \
  localhost/openbot:rc-amd64-v94-user-modeling \
  node openbot.mjs gateway --bind loopback --port 18789
```

---

## Prior cutover (2026-07-24) — v94 / cross-session user modeling (settings panel + e2e tests)

| Field           | Value                                                                                                                                                                                           |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date            | 2026-07-24 (UTC ~15:08 build; container live ~15:09 UTC / 23:09 CST)                                                                                                                            |
| Decision        | Owner-approved: land scoped user-modeling commits + wire employee settings panel                                                                                                                |
| Branch          | `deploy/user-modeling-v92` @ `c8c494d9cf`                                                                                                                                                       |
| Source revision | `c8c494d9cf76f072829300e962fd860e33d95781`                                                                                                                                                      |
| Image tag       | `openbot:rc-amd64-v94-user-modeling`                                                                                                                                                            |
| Image id        | `233fabc4fd081c1ebbe42b1de3e7caf12bece6da53db8f1af851649b5f2df243`                                                                                                                              |
| Build mode      | Full `dist` layer on `rc-amd64-v93-ghost-bot-ownership`                                                                                                                                         |
| Container       | `openbot-gateway-rc` (`restart=unless-stopped`, host network, loopback :18789)                                                                                                                  |
| Host            | production Plan-A (`8.217.93.71`)                                                                                                                                                               |
| Includes        | `user-modeling.*` RPC; reply-path inject; `user-learned-preferences-panel` in employee settings; scoped tests (`get-reply-run.user-modeling.test.ts`)                                           |
| Runtime version | `OpenBot 1.0.1 (bea4441)`                                                                                                                                                                       |
| Control UI      | `index-RaULrPcE.js`                                                                                                                                                                             |
| Smoke           | healthz **200**; `https://openbot.love/` **200**; `https://admin.openbot.love/` **200**; 16 dist files contain `user-modeling.get-profile`; UI bundle contains `user-learned-preferences-panel` |
| Rollback        | `localhost/openbot:rc-amd64-v93-ghost-bot-ownership`                                                                                                                                            |
| Executor        | `cursor-user-modeling`                                                                                                                                                                          |
| Field           | Value                                                                                                                                                                                           |
| -------         | --------                                                                                                                                                                                        |
| Date            | 2026-07-24 (UTC ~15:08 build; container live ~15:09 UTC / 23:09 CST)                                                                                                                            |
| Decision        | Owner-approved: land scoped user-modeling commits + wire employee settings panel                                                                                                                |
| Branch          | `deploy/user-modeling-v92` @ `c8c494d9cf`                                                                                                                                                       |
| Source revision | `c8c494d9cf76f072829300e962fd860e33d95781`                                                                                                                                                      |
| Image tag       | `openbot:rc-amd64-v94-user-modeling`                                                                                                                                                            |
| Image id        | `233fabc4fd081c1ebbe42b1de3e7caf12bece6da53db8f1af851649b5f2df243`                                                                                                                              |
| Build mode      | Full `dist` layer on `rc-amd64-v93-ghost-bot-ownership`                                                                                                                                         |
| Container       | `openbot-gateway-rc` (`restart=unless-stopped`, host network, loopback :18789)                                                                                                                  |
| Host            | production Plan-A (`8.217.93.71`)                                                                                                                                                               |
| Includes        | `user-modeling.*` RPC; reply-path inject; `user-learned-preferences-panel` in employee settings; scoped tests (`get-reply-run.user-modeling.test.ts`)                                           |
| Runtime version | `OpenBot 1.0.1 (bea4441)`                                                                                                                                                                       |
| Control UI      | `index-RaULrPcE.js`                                                                                                                                                                             |
| Smoke           | healthz **200**; `https://openbot.love/` **200**; `https://admin.openbot.love/` **200**; 16 dist files contain `user-modeling.get-profile`; UI bundle contains `user-learned-preferences-panel` |
| Rollback        | `localhost/openbot:rc-amd64-v93-ghost-bot-ownership`                                                                                                                                            |
| Executor        | `cursor-user-modeling`                                                                                                                                                                          |

### Rollback to v93 (ghost-bot ownership fix)

```bash
podman stop openbot-gateway-rc && podman rm openbot-gateway-rc
podman run -d --name openbot-gateway-rc --restart=unless-stopped --network host --user 0 \
  --env-file /tmp/openbot-gateway-rc.env \
  -v /root/.openbot:/root/.openbot \
  -v /var/tmp/openbot-compile-cache:/var/tmp/openbot-compile-cache \
  localhost/openbot:rc-amd64-v93-ghost-bot-ownership \
  node openbot.mjs gateway --bind loopback --port 18789
```

---

## Prior cutover (2026-07-24) — v93 / cross-session user modeling

| Field           | Value                                                                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Date            | 2026-07-24 (UTC ~14:54 build; container live ~14:55 UTC / 22:55 CST)                                                                             |
| Decision        | Owner-approved: deploy cross-session user modeling (gateway RPC + Control UI panel) on enterprise-channels v91 lineage                           |
| Branch          | `codex/deploy-user-modeling-v92` (cherry-pick onto `codex/openbot-enterprise-channels-release`)                                                  |
| Source revision | `8d34b63bc72fe14060cbe8745ae4d87f6e4f3af0`                                                                                                       |
| Release tag     | `rc-enterprise-channels-user-modeling-2026-07-24`                                                                                                |
| Image tag       | `openbot:rc-amd64-v93-enterprise-channels-user-modeling`                                                                                         |
| Image id        | `b3309dab657032fe8c8dbf77f8ce9a7edce520074d313b642bce4421c469a091`                                                                               |
| Build mode      | Gateway + Control UI layer on `rc-amd64-v91-enterprise-channels-secretref-save`                                                                  |
| Container       | `openbot-gateway-rc` (`restart=unless-stopped`, host network, loopback :18789)                                                                   |
| Host            | production Plan-A (`8.217.93.71`)                                                                                                                |
| Includes        | Cross-session user modeling (`user-modeling.*` RPC); learned preferences panel in Control UI; signal recording on reply path                     |
| Runtime version | `OpenBot 2026.7.12-rc.2 (8d34b63)`                                                                                                               |
| Control UI      | `index-CbMS9050.js`                                                                                                                              |
| Smoke           | healthz **200**; readyz **ready:true** `failing:[]`; `https://openbot.love/healthz` **200**; gateway bundle contains `user-modeling.get-profile` |
| Rollback        | `openbot-gateway-rc-prev-v92-safety` / `localhost/openbot:rc-amd64-v92-employee-ai-archive`                                                      |
| Executor        | `cursor-deploy-user-modeling-v93`                                                                                                                |
| Field           | Value                                                                                                                                            |
| -------         | --------                                                                                                                                         |
| Date            | 2026-07-24 (UTC ~14:54 build; container live ~14:55 UTC / 22:55 CST)                                                                             |
| Decision        | Owner-approved: deploy cross-session user modeling (gateway RPC + Control UI panel) on enterprise-channels v91 lineage                           |
| Branch          | `codex/deploy-user-modeling-v92` (cherry-pick onto `codex/openbot-enterprise-channels-release`)                                                  |
| Source revision | `8d34b63bc72fe14060cbe8745ae4d87f6e4f3af0`                                                                                                       |
| Release tag     | `rc-enterprise-channels-user-modeling-2026-07-24`                                                                                                |
| Image tag       | `openbot:rc-amd64-v93-enterprise-channels-user-modeling`                                                                                         |
| Image id        | `b3309dab657032fe8c8dbf77f8ce9a7edce520074d313b642bce4421c469a091`                                                                               |
| Build mode      | Gateway + Control UI layer on `rc-amd64-v91-enterprise-channels-secretref-save`                                                                  |
| Container       | `openbot-gateway-rc` (`restart=unless-stopped`, host network, loopback :18789)                                                                   |
| Host            | production Plan-A (`8.217.93.71`)                                                                                                                |
| Includes        | Cross-session user modeling (`user-modeling.*` RPC); learned preferences panel in Control UI; signal recording on reply path                     |
| Runtime version | `OpenBot 2026.7.12-rc.2 (8d34b63)`                                                                                                               |
| Control UI      | `index-CbMS9050.js`                                                                                                                              |
| Smoke           | healthz **200**; readyz **ready:true** `failing:[]`; `https://openbot.love/healthz` **200**; gateway bundle contains `user-modeling.get-profile` |
| Rollback        | `openbot-gateway-rc-prev-v92-safety` / `localhost/openbot:rc-amd64-v92-employee-ai-archive`                                                      |
| Executor        | `cursor-deploy-user-modeling-v93`                                                                                                                |

### Rollback to v92 (employee AI archive UI)

```bash
podman rm -f openbot-gateway-rc
podman rename openbot-gateway-rc-prev-v92-safety openbot-gateway-rc
podman start openbot-gateway-rc
```

---

## Prior cutover (2026-07-24) — v92 / employee AI archive + identity binding UI

| Field             | Value                                                                                                                                                                                                                               |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date              | 2026-07-24 (image ~14:45 UTC; container live by ~14:48 UTC / 22:48 CST)                                                                                                                                                             |
| Decision          | Owner-approved: cut over Control UI layer so enterprise identity binding + overview KPI compact layout reach L3                                                                                                                     |
| Branch            | `codex/deploy-user-modeling-v92` (on top of `codex/openbot-enterprise-channels-release`)                                                                                                                                            |
| UI layer revision | `7f57000e3966fc581d5a5cb7fb6d954a74b21236`                                                                                                                                                                                          |
| Image tag         | `openbot:rc-amd64-v92-employee-ai-archive`                                                                                                                                                                                          |
| Image id          | `d37e3b19e99d0267b642a910774fc478c31a4db63f64ef91f2570647fc14ecbd`                                                                                                                                                                  |
| Build mode        | Control UI layer dig (seat-bound AI employee archive) on `rc-amd64-v91-enterprise-channels-secretref-save`                                                                                                                          |
| Container         | `openbot-gateway-rc` (`restart=unless-stopped`, host network, loopback :18789)                                                                                                                                                      |
| Host              | production Plan-A (`8.217.93.71`)                                                                                                                                                                                                   |
| Includes          | Seat-bound AI employee archive UI; enterprise identity binding summary card + employee binding overview; platform overview KPI compact row (no「版本状态」card); related gateway RPC client strings (`list-for-seat`)               |
| Runtime version   | `OpenBot 2026.7.12-rc.2 (a5c9765)`                                                                                                                                                                                                  |
| Control UI        | `index-BLfyy0q1.js`                                                                                                                                                                                                                 |
| Smoke             | healthz **200**; readyz **ready:true** `failing:[]`; `https://openbot.love/healthz` **200**; public bundle contains `员工身份绑定` / `查看绑定总览` / `员工绑定总览` / `platform-dashboard__metric-trailing`; `版本状态` KPI absent |
| Rollback          | previous safety container if present, else recreate from `localhost/openbot:rc-amd64-v91-enterprise-channels-secretref-save`                                                                                                        |
| Executor          | concurrent cutover + cursor verification                                                                                                                                                                                            |
| Field             | Value                                                                                                                                                                                                                               |
| -------           | --------                                                                                                                                                                                                                            |
| Date              | 2026-07-24 (image ~14:45 UTC; container live by ~14:48 UTC / 22:48 CST)                                                                                                                                                             |
| Decision          | Owner-approved: cut over Control UI layer so enterprise identity binding + overview KPI compact layout reach L3                                                                                                                     |
| Branch            | `codex/deploy-user-modeling-v92` (on top of `codex/openbot-enterprise-channels-release`)                                                                                                                                            |
| UI layer revision | `7f57000e3966fc581d5a5cb7fb6d954a74b21236`                                                                                                                                                                                          |
| Image tag         | `openbot:rc-amd64-v92-employee-ai-archive`                                                                                                                                                                                          |
| Image id          | `d37e3b19e99d0267b642a910774fc478c31a4db63f64ef91f2570647fc14ecbd`                                                                                                                                                                  |
| Build mode        | Control UI layer dig (seat-bound AI employee archive) on `rc-amd64-v91-enterprise-channels-secretref-save`                                                                                                                          |
| Container         | `openbot-gateway-rc` (`restart=unless-stopped`, host network, loopback :18789)                                                                                                                                                      |
| Host              | production Plan-A (`8.217.93.71`)                                                                                                                                                                                                   |
| Includes          | Seat-bound AI employee archive UI; enterprise identity binding summary card + employee binding overview; platform overview KPI compact row (no「版本状态」card); related gateway RPC client strings (`list-for-seat`)               |
| Runtime version   | `OpenBot 2026.7.12-rc.2 (a5c9765)`                                                                                                                                                                                                  |
| Control UI        | `index-BLfyy0q1.js`                                                                                                                                                                                                                 |
| Smoke             | healthz **200**; readyz **ready:true** `failing:[]`; `https://openbot.love/healthz` **200**; public bundle contains `员工身份绑定` / `查看绑定总览` / `员工绑定总览` / `platform-dashboard__metric-trailing`; `版本状态` KPI absent |
| Rollback          | previous safety container if present, else recreate from `localhost/openbot:rc-amd64-v91-enterprise-channels-secretref-save`                                                                                                        |
| Executor          | concurrent cutover + cursor verification                                                                                                                                                                                            |

### Rollback to v91

```bash
podman rm -f openbot-gateway-rc
podman run -d --name openbot-gateway-rc --restart=unless-stopped --network host \
  -v /root/.openbot:/root/.openbot \
  localhost/openbot:rc-amd64-v91-enterprise-channels-secretref-save
# Adjust volume/env flags to match the prior v91 runspec if different.
```

---

## Prior cutover (2026-07-23) — v91 / SecretRef tenant config save

| Field           | Value                                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------------------- |
| Date            | 2026-07-23 (UTC ~02:33 build; container restart ~13:55 UTC / 21:54 CST)                                 |
| Decision        | Owner-approved production hotfix (channels config save)                                                 |
| Branch          | `codex/openbot-enterprise-channels-release`                                                             |
| Source revision | `a5c9765ce73b5f04cb1e70b94cea035e82221f22`                                                              |
| Release tag     | `rc-enterprise-channels-secretref-save-2026-07-23`                                                      |
| Image tag       | `openbot:rc-amd64-v91-enterprise-channels-secretref-save`                                               |
| Image id        | `fb522dc4a488d48de3faa79654958599c412a15ab441f7929378d9f3586161f2`                                      |
| Build mode      | Control UI + gateway layer on `rc-amd64-v90-enterprise-channels-config-save`                            |
| Container       | `openbot-gateway-rc` (`restart=unless-stopped`, host network, loopback :18789)                          |
| Host            | production Plan-A (`8.217.93.71`)                                                                       |
| Includes        | SecretRef round-trip repair; restore redacted SecretRef ids on tenant channel config save               |
| Runtime version | `OpenBot 2026.7.12-rc.2 (a5c9765)`                                                                      |
| Control UI      | `index-BRcYobfj.js` (superseded on openbot.love by later layers)                                        |
| Smoke           | healthz **200**; readyz **ready:true** `failing:[]`; `https://openbot.love/healthz` **200**             |
| Rollback        | `openbot-gateway-rc-prev-v90-safety` / `localhost/openbot:rc-amd64-v90-enterprise-channels-config-save` |
| Executor        | `codex-enterprise-channels`                                                                             |
| Field           | Value                                                                                                   |
| -------         | --------                                                                                                |
| Date            | 2026-07-23 (UTC ~02:33 build; container restart ~13:55 UTC / 21:54 CST)                                 |
| Decision        | Owner-approved production hotfix (channels config save)                                                 |
| Branch          | `codex/openbot-enterprise-channels-release`                                                             |
| Source revision | `a5c9765ce73b5f04cb1e70b94cea035e82221f22`                                                              |
| Release tag     | `rc-enterprise-channels-secretref-save-2026-07-23`                                                      |
| Image tag       | `openbot:rc-amd64-v91-enterprise-channels-secretref-save`                                               |
| Image id        | `fb522dc4a488d48de3faa79654958599c412a15ab441f7929378d9f3586161f2`                                      |
| Build mode      | Control UI + gateway layer on `rc-amd64-v90-enterprise-channels-config-save`                            |
| Container       | `openbot-gateway-rc` (`restart=unless-stopped`, host network, loopback :18789)                          |
| Host            | production Plan-A (`8.217.93.71`)                                                                       |
| Includes        | SecretRef round-trip repair; restore redacted SecretRef ids on tenant channel config save               |
| Runtime version | `OpenBot 2026.7.12-rc.2 (a5c9765)`                                                                      |
| Control UI      | `index-BRcYobfj.js` (superseded on openbot.love by later layers)                                        |
| Smoke           | healthz **200**; readyz **ready:true** `failing:[]`; `https://openbot.love/healthz` **200**             |
| Rollback        | `openbot-gateway-rc-prev-v90-safety` / `localhost/openbot:rc-amd64-v90-enterprise-channels-config-save` |
| Executor        | `codex-enterprise-channels`                                                                             |

### Rollback to v90

```bash
podman rm -f openbot-gateway-rc
podman rename openbot-gateway-rc-prev-v90-safety openbot-gateway-rc
podman start openbot-gateway-rc
```

---

## Prior hotfix (2026-07-23) — v90 / tenant config save over legacy validation

| Field           | Value                                                                                                |
| --------------- | ---------------------------------------------------------------------------------------------------- |
| Source revision | `85f189c0e086dec42dc9ad7c091ce58dd1258607`                                                           |
| Image tag       | `openbot:rc-amd64-v90-enterprise-channels-config-save`                                               |
| Image id        | `44c8849d2f0ad89c8032fec2c39e05ad39c2a0aff6a0153a689729e1eede94c4`                                   |
| Includes        | Gateway allows tenant channel config edits when legacy validation issues exist                       |
| Rollback        | `openbot-gateway-rc-prev-v89-safety` / `localhost/openbot:rc-amd64-v89-enterprise-channels-recovery` |
| Field           | Value                                                                                                |
| -------         | --------                                                                                             |
| Source revision | `85f189c0e086dec42dc9ad7c091ce58dd1258607`                                                           |
| Image tag       | `openbot:rc-amd64-v90-enterprise-channels-config-save`                                               |
| Image id        | `44c8849d2f0ad89c8032fec2c39e05ad39c2a0aff6a0153a689729e1eede94c4`                                   |
| Includes        | Gateway allows tenant channel config edits when legacy validation issues exist                       |
| Rollback        | `openbot-gateway-rc-prev-v89-safety` / `localhost/openbot:rc-amd64-v89-enterprise-channels-recovery` |

---

## Prior hotfix (2026-07-23) — v89 / single-request channel error recovery

| Field           | Value                                                                                                 |
| --------------- | ----------------------------------------------------------------------------------------------------- |
| Source revision | `7e7d23d8733b637707f3130b19f3f0a6bc5ca1c9`                                                            |
| Image tag       | `openbot:rc-amd64-v89-enterprise-channels-recovery`                                                   |
| Image id        | `d331845ff9de02d57f7cddb908faab545d3ff3763b7b2cd1209e31a4f89b2de1`                                    |
| Includes        | Avoid duplicate enterprise channel recovery reloads (single-request recovery)                         |
| Rollback        | `openbot-gateway-rc-prev-v88-safety` / `localhost/openbot:rc-amd64-v88-enterprise-channels-stability` |
| Field           | Value                                                                                                 |
| -------         | --------                                                                                              |
| Source revision | `7e7d23d8733b637707f3130b19f3f0a6bc5ca1c9`                                                            |
| Image tag       | `openbot:rc-amd64-v89-enterprise-channels-recovery`                                                   |
| Image id        | `d331845ff9de02d57f7cddb908faab545d3ff3763b7b2cd1209e31a4f89b2de1`                                    |
| Includes        | Avoid duplicate enterprise channel recovery reloads (single-request recovery)                         |
| Rollback        | `openbot-gateway-rc-prev-v88-safety` / `localhost/openbot:rc-amd64-v88-enterprise-channels-stability` |

---

## Prior hotfix (2026-07-23) — v88 / navigation + legacy capability manifests

| Field           | Value                                                                                                 |
| --------------- | ----------------------------------------------------------------------------------------------------- |
| Source revision | `4248a061d65cb04b9c6071f0f059086f4366ce35`                                                            |
| Image tag       | `openbot:rc-amd64-v88-enterprise-channels-stability`                                                  |
| Image id        | `8eecf24e451d6a2a2fa839eb5f90b9fdf93fd515b68e7aa0bfb518a436c1dbb1`                                    |
| Includes        | Simplified enterprise channel navigation; tolerate legacy capability manifests                        |
| Rollback        | `openbot-gateway-rc-prev-v87-safety` / `localhost/openbot:rc-amd64-v87-enterprise-channels-lifecycle` |
| Field           | Value                                                                                                 |
| -------         | --------                                                                                              |
| Source revision | `4248a061d65cb04b9c6071f0f059086f4366ce35`                                                            |
| Image tag       | `openbot:rc-amd64-v88-enterprise-channels-stability`                                                  |
| Image id        | `8eecf24e451d6a2a2fa839eb5f90b9fdf93fd515b68e7aa0bfb518a436c1dbb1`                                    |
| Includes        | Simplified enterprise channel navigation; tolerate legacy capability manifests                        |
| Rollback        | `openbot-gateway-rc-prev-v87-safety` / `localhost/openbot:rc-amd64-v87-enterprise-channels-lifecycle` |

---

## Prior cutover (2026-07-23) — v87 / enterprise message channel lifecycle

| Field           | Value                                                                                                                                                 |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date            | 2026-07-23 (UTC ~00:50)                                                                                                                               |
| Decision        | Owner-approved production deployment                                                                                                                  |
| Branch          | `codex/openbot-enterprise-channels-release`                                                                                                           |
| Source revision | `2ce3d2c9fb103faed6a50733264675cec884e4c1`                                                                                                            |
| Release tag     | `rc-enterprise-channels-lifecycle-2026-07-23`                                                                                                         |
| Image tag       | `openbot:rc-amd64-v87-enterprise-channels-lifecycle`                                                                                                  |
| Image id        | `ba356d6977fac80c7e68fd6f1ea9a79e6751c640b630cd8acbec4654c167002a`                                                                                    |
| Build mode      | Control UI layer on `rc-amd64-v86-enterprise-channels`                                                                                                |
| Container       | `openbot-gateway-rc` (`restart=unless-stopped`, host network, loopback :18789)                                                                        |
| Host            | production Plan-A (`8.217.93.71`)                                                                                                                     |
| Includes        | Stable Gateway-client/tenant-scoped message channel UI state; no repeated initialization when parent render props change; single reload after actions |
| Control UI      | `index-BWZglK-_.js`                                                                                                                                   |
| Smoke           | healthz **200**; readyz **ready:true** `failing:[]`; five-domain HTTPS **200**                                                                        |
| Rollback        | `openbot-gateway-rc-prev-v86-safety` / `localhost/openbot:rc-amd64-v86-enterprise-channels`                                                           |
| Executor        | `codex-enterprise-channels`                                                                                                                           |
| Field           | Value                                                                                                                                                 |
| -------         | --------                                                                                                                                              |
| Date            | 2026-07-23 (UTC ~00:50)                                                                                                                               |
| Decision        | Owner-approved production deployment                                                                                                                  |
| Branch          | `codex/openbot-enterprise-channels-release`                                                                                                           |
| Source revision | `2ce3d2c9fb103faed6a50733264675cec884e4c1`                                                                                                            |
| Release tag     | `rc-enterprise-channels-lifecycle-2026-07-23`                                                                                                         |
| Image tag       | `openbot:rc-amd64-v87-enterprise-channels-lifecycle`                                                                                                  |
| Image id        | `ba356d6977fac80c7e68fd6f1ea9a79e6751c640b630cd8acbec4654c167002a`                                                                                    |
| Build mode      | Control UI layer on `rc-amd64-v86-enterprise-channels`                                                                                                |
| Container       | `openbot-gateway-rc` (`restart=unless-stopped`, host network, loopback :18789)                                                                        |
| Host            | production Plan-A (`8.217.93.71`)                                                                                                                     |
| Includes        | Stable Gateway-client/tenant-scoped message channel UI state; no repeated initialization when parent render props change; single reload after actions |
| Control UI      | `index-BWZglK-_.js`                                                                                                                                   |
| Smoke           | healthz **200**; readyz **ready:true** `failing:[]`; five-domain HTTPS **200**                                                                        |
| Rollback        | `openbot-gateway-rc-prev-v86-safety` / `localhost/openbot:rc-amd64-v86-enterprise-channels`                                                           |
| Executor        | `codex-enterprise-channels`                                                                                                                           |

### Rollback to v86

```bash
podman rm -f openbot-gateway-rc
podman rename openbot-gateway-rc-prev-v86-safety openbot-gateway-rc
podman start openbot-gateway-rc
```

---

## Prior cutover (2026-07-22) — v86 / enterprise message channels

| Field           | Value                                                                                                |
| --------------- | ---------------------------------------------------------------------------------------------------- |
| Date            | 2026-07-22 (UTC ~11:44)                                                                              |
| Decision        | Owner-approved production deployment                                                                 |
| Branch          | `codex/openbot-enterprise-channels-release`                                                          |
| Source revision | `1c4feaf61e5b78323001f589eab9e4f50e4d5ebc`                                                           |
| Release tag     | `rc-enterprise-channels-2026-07-22`                                                                  |
| Image tag       | `openbot:rc-amd64-v86-enterprise-channels`                                                           |
| Image id        | `f98e6d879d7f1b7c23528e74ce3fdfb35c62325756f45b7eb332b04e1409ce15`                                   |
| Build mode      | Control UI layer on `rc-amd64-v85`                                                                   |
| Container       | `openbot-gateway-rc` (`restart=unless-stopped`, host network, loopback :18789)                       |
| Host            | production Plan-A (`8.217.93.71`)                                                                    |
| Includes        | Enterprise message channels limited to Feishu, DingTalk, and WeCom; client-side RPC timeout recovery |
| Control UI      | `index-BMPDASnG.js`                                                                                  |
| Smoke           | healthz **200**; readyz **ready:true** `failing:[]`; five-domain HTTPS **200**                       |
| Rollback        | `openbot-gateway-rc-prev-v85-safety` / `localhost/openbot:rc-amd64-v85`                              |
| Executor        | `codex-enterprise-channels`                                                                          |
| Field           | Value                                                                                                |
| -------         | --------                                                                                             |
| Date            | 2026-07-22 (UTC ~11:44)                                                                              |
| Decision        | Owner-approved production deployment                                                                 |
| Branch          | `codex/openbot-enterprise-channels-release`                                                          |
| Source revision | `1c4feaf61e5b78323001f589eab9e4f50e4d5ebc`                                                           |
| Release tag     | `rc-enterprise-channels-2026-07-22`                                                                  |
| Image tag       | `openbot:rc-amd64-v86-enterprise-channels`                                                           |
| Image id        | `f98e6d879d7f1b7c23528e74ce3fdfb35c62325756f45b7eb332b04e1409ce15`                                   |
| Build mode      | Control UI layer on `rc-amd64-v85`                                                                   |
| Container       | `openbot-gateway-rc` (`restart=unless-stopped`, host network, loopback :18789)                       |
| Host            | production Plan-A (`8.217.93.71`)                                                                    |
| Includes        | Enterprise message channels limited to Feishu, DingTalk, and WeCom; client-side RPC timeout recovery |
| Control UI      | `index-BMPDASnG.js`                                                                                  |
| Smoke           | healthz **200**; readyz **ready:true** `failing:[]`; five-domain HTTPS **200**                       |
| Rollback        | `openbot-gateway-rc-prev-v85-safety` / `localhost/openbot:rc-amd64-v85`                              |
| Executor        | `codex-enterprise-channels`                                                                          |

### Rollback to v85

```bash
podman rm -f openbot-gateway-rc
podman rename openbot-gateway-rc-prev-v85-safety openbot-gateway-rc
podman start openbot-gateway-rc
```

---

## Prior cutover (2026-07-22) — v84 / employee roster + knowledge IA

| Field           | Value                                                                                                                        |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Date            | 2026-07-22 (UTC ~16:50)                                                                                                      |
| Decision        | Owner: dig deploy of employee agent roster filter + knowledge import IA                                                      |
| Branch          | `fix-scoped-package-templates`                                                                                               |
| Source revision | `95c075a6058c3e201c4092f574a59540f8eec423`                                                                                   |
| PR              | #83                                                                                                                          |
| Image tag       | `openbot:rc-amd64-v84`                                                                                                       |
| Image id        | `a7bbacbaac789fe22356ee98bfc440f823ab005d3acffa48f3bdb471ecc3dde8`                                                           |
| Build mode      | control-ui layer on `rc-amd64-v83` (prod host RAM precluded full rebuild)                                                    |
| Container       | `openbot-gateway-rc` (`restart=unless-stopped`, host network, loopback :18789)                                               |
| Host            | production Plan-A (`8.217.93.71`)                                                                                            |
| Includes        | Client fix: ownerless agents visible without employeeAccess snapshot; five-channel compact import; two-level knowledge cabin |
| Control UI      | `index-CjuZ-UOU.js`                                                                                                          |
| Smoke           | healthz **200**; readyz **ready:true** `failing:[]`                                                                          |
| Rollback        | `openbot-gateway-rc-prev-v83-safety` / `localhost/openbot:rc-amd64-v83`                                                      |
| Executor        | grok                                                                                                                         |
| Field           | Value                                                                                                                        |
| -------         | --------                                                                                                                     |
| Date            | 2026-07-22 (UTC ~16:50)                                                                                                      |
| Decision        | Owner: dig deploy of employee agent roster filter + knowledge import IA                                                      |
| Branch          | `fix-scoped-package-templates`                                                                                               |
| Source revision | `95c075a6058c3e201c4092f574a59540f8eec423`                                                                                   |
| PR              | #83                                                                                                                          |
| Image tag       | `openbot:rc-amd64-v84`                                                                                                       |
| Image id        | `a7bbacbaac789fe22356ee98bfc440f823ab005d3acffa48f3bdb471ecc3dde8`                                                           |
| Build mode      | control-ui layer on `rc-amd64-v83` (prod host RAM precluded full rebuild)                                                    |
| Container       | `openbot-gateway-rc` (`restart=unless-stopped`, host network, loopback :18789)                                               |
| Host            | production Plan-A (`8.217.93.71`)                                                                                            |
| Includes        | Client fix: ownerless agents visible without employeeAccess snapshot; five-channel compact import; two-level knowledge cabin |
| Control UI      | `index-CjuZ-UOU.js`                                                                                                          |
| Smoke           | healthz **200**; readyz **ready:true** `failing:[]`                                                                          |
| Rollback        | `openbot-gateway-rc-prev-v83-safety` / `localhost/openbot:rc-amd64-v83`                                                      |
| Executor        | grok                                                                                                                         |

### Rollback to v83

```bash
podman rm -f openbot-gateway-rc
podman rename openbot-gateway-rc-prev-v83-safety openbot-gateway-rc
podman start openbot-gateway-rc
```

---

## Prior cutover (2026-07-20) — v70 / GitHub alignment

| Field           | Value                                                                                                       |
| --------------- | ----------------------------------------------------------------------------------------------------------- |
| Date            | 2026-07-20 (UTC ~15:01)                                                                                     |
| Decision        | Owner: align cloud production with GitHub                                                                   |
| Git tag         | `rc-convergence-2026-07-20`                                                                                 |
| Release branch  | `release/rc-convergence-2026-07-20`                                                                         |
| Source revision | `9aceda7349da2190e00bb2fbb029175a517ecde7`                                                                  |
| Image tag       | `openbot:rc-amd64-v70`                                                                                      |
| Image id        | `79d35ef089f06f9c52e952ed66636ccf53f289141303bd7d998399cb301476f7`                                          |
| Container       | `openbot-gateway-rc` (`restart=unless-stopped`, host network, loopback :18789)                              |
| Host            | production Plan-A (`8.217.93.71`)                                                                           |
| Includes        | Convergence D0–D4 (build, forged-tenant, session promote/heal, history/checkpoint locks, localFolder K1–K6) |
| Runtime version | `OpenBot 2026.7.12-rc.2 (9aceda7)`                                                                          |
| Smoke           | edge **9/9**; admin/biz/gw healthz **200**                                                                  |
| Readiness       | `ready:false`, `failing:["wecom"]` (waiver through **2026-08-20**)                                          |
| Config backup   | `/root/.openbot/backups/cutover-v70-20260720T150123Z`                                                       |
| Rollback        | `openbot-gateway-rc-prev-v69-safety` / `localhost/openbot:rc-amd64-v69`                                     |
| Executor        | `grok-evolution-closure`                                                                                    |
| Field           | Value                                                                                                       |
| -------         | --------                                                                                                    |
| Date            | 2026-07-20 (UTC ~15:01)                                                                                     |
| Decision        | Owner: align cloud production with GitHub                                                                   |
| Git tag         | `rc-convergence-2026-07-20`                                                                                 |
| Release branch  | `release/rc-convergence-2026-07-20`                                                                         |
| Source revision | `9aceda7349da2190e00bb2fbb029175a517ecde7`                                                                  |
| Image tag       | `openbot:rc-amd64-v70`                                                                                      |
| Image id        | `79d35ef089f06f9c52e952ed66636ccf53f289141303bd7d998399cb301476f7`                                          |
| Container       | `openbot-gateway-rc` (`restart=unless-stopped`, host network, loopback :18789)                              |
| Host            | production Plan-A (`8.217.93.71`)                                                                           |
| Includes        | Convergence D0–D4 (build, forged-tenant, session promote/heal, history/checkpoint locks, localFolder K1–K6) |
| Runtime version | `OpenBot 2026.7.12-rc.2 (9aceda7)`                                                                          |
| Smoke           | edge **9/9**; admin/biz/gw healthz **200**                                                                  |
| Readiness       | `ready:false`, `failing:["wecom"]` (waiver through **2026-08-20**)                                          |
| Config backup   | `/root/.openbot/backups/cutover-v70-20260720T150123Z`                                                       |
| Rollback        | `openbot-gateway-rc-prev-v69-safety` / `localhost/openbot:rc-amd64-v69`                                     |
| Executor        | `grok-evolution-closure`                                                                                    |

### Rollback to v69

```bash
podman rm -f openbot-gateway-rc
podman rename openbot-gateway-rc-prev-v69-safety openbot-gateway-rc
podman start openbot-gateway-rc
```

---

## Prior cutover (2026-07-20) — v69

| Field           | Value                                                                                                                  |
| --------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Date            | 2026-07-20                                                                                                             |
| Branch          | `fix-scoped-package-templates`                                                                                         |
| Source revision | `85eee3e7b987b14b3f83301e3f200b3e1d797cc6`                                                                             |
| Image tag       | `openbot:rc-amd64-v69`                                                                                                 |
| Image id        | `eeeaa0ab97278db03d0b39664fb5663ffbd1bbc02f0a2ba42de17bb0ca4ad506`                                                     |
| Container       | `openbot-gateway-rc` (`restart=unless-stopped`)                                                                        |
| Includes        | Backend-only exec approval fallback and production PID 1 signal guard; v68 Control UI, qiaomu-cut, and ffmpeg retained |
| Tests           | Focused exec safety **41/41**; edge smoke **9/9**; admin/biz/gw healthz **200**                                        |
| Readiness       | **503**, `failing:["wecom"]`; reproduced unchanged on v68 before accepting v69                                         |
| Rollback        | `openbot-gateway-rc-prev-v68-safety` / `localhost/openbot:rc-amd64-v68`                                                |
| Note            | Superseded same day by v70 GitHub-aligned cutover                                                                      |
| Field           | Value                                                                                                                  |
| -------         | --------                                                                                                               |
| Date            | 2026-07-20                                                                                                             |
| Branch          | `fix-scoped-package-templates`                                                                                         |
| Source revision | `85eee3e7b987b14b3f83301e3f200b3e1d797cc6`                                                                             |
| Image tag       | `openbot:rc-amd64-v69`                                                                                                 |
| Image id        | `eeeaa0ab97278db03d0b39664fb5663ffbd1bbc02f0a2ba42de17bb0ca4ad506`                                                     |
| Container       | `openbot-gateway-rc` (`restart=unless-stopped`)                                                                        |
| Includes        | Backend-only exec approval fallback and production PID 1 signal guard; v68 Control UI, qiaomu-cut, and ffmpeg retained |
| Tests           | Focused exec safety **41/41**; edge smoke **9/9**; admin/biz/gw healthz **200**                                        |
| Readiness       | **503**, `failing:["wecom"]`; reproduced unchanged on v68 before accepting v69                                         |
| Rollback        | `openbot-gateway-rc-prev-v68-safety` / `localhost/openbot:rc-amd64-v68`                                                |
| Note            | Superseded same day by v70 GitHub-aligned cutover                                                                      |

---

## Prior cutover (2026-07-18)

| Field            | Value                                                                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date             | 2026-07-18                                                                                                                                        |
| Branch           | `fix-scoped-package-templates`                                                                                                                    |
| Git SHA          | `4fac12ee50`                                                                                                                                      |
| Image tag        | `openbot:rc-amd64-v55`                                                                                                                            |
| Image id         | `4f95eb8269b6` (`linux/amd64`, layer on v54)                                                                                                      |
| Container        | `openbot-gateway-rc`                                                                                                                              |
| Includes         | Enterprise commercial billing hardening Phases 1–5 (settlement, PAYG, seats, statement/invoice allocations, contract-normalized MRR, golden path) |
| healthz / readyz | **200** / **200**                                                                                                                                 |
| Edge smoke       | biz / admin / gw healthz / www / openbot.love                                                                                                     |
| Rollback image   | `localhost/openbot:rc-amd64-v54` (`openbot-gateway-rc-prev-v54`)                                                                                  |
| Field            | Value                                                                                                                                             |
| -------          | --------                                                                                                                                          |
| Date             | 2026-07-18                                                                                                                                        |
| Branch           | `fix-scoped-package-templates`                                                                                                                    |
| Git SHA          | `4fac12ee50`                                                                                                                                      |
| Image tag        | `openbot:rc-amd64-v55`                                                                                                                            |
| Image id         | `4f95eb8269b6` (`linux/amd64`, layer on v54)                                                                                                      |
| Container        | `openbot-gateway-rc`                                                                                                                              |
| Includes         | Enterprise commercial billing hardening Phases 1–5 (settlement, PAYG, seats, statement/invoice allocations, contract-normalized MRR, golden path) |
| healthz / readyz | **200** / **200**                                                                                                                                 |
| Edge smoke       | biz / admin / gw healthz / www / openbot.love                                                                                                     |
| Rollback image   | `localhost/openbot:rc-amd64-v54` (`openbot-gateway-rc-prev-v54`)                                                                                  |

### Rollback to v54

```bash
podman rm -f openbot-gateway-rc
podman rename openbot-gateway-rc-prev-v54 openbot-gateway-rc
podman start openbot-gateway-rc
# or re-run with localhost/openbot:rc-amd64-v54
```

---

## Prior record (2026-07-13)

| Field                            | Value                                                                                                                                    |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Date                             | 2026-07-13                                                                                                                               |
| RC branch / tag                  | `release/candidate-20260712` @ `2026.7.12-rc.2`                                                                                          |
| Git SHA                          | `5dad0b9d4b` (full monorepo FE+BE rebuild; hybrid isolation **not** included)                                                            |
| Image tag                        | `openbot:rc-amd64-v6`                                                                                                                    |
| Image id                         | `cb81f9641624` (`linux/amd64`, full Dockerfile build)                                                                                    |
| Built from clean worktree? (Y/N) | Y (RC tip after 6 stream-scoped landing commits; only local `node_modules/.bin` noise left dirty)                                        |
| Tenant tests                     | Prior green suite retained; shared MT seat-store path fix in this tip                                                                    |
| B4 tenant-context                | **Merged** PR #35; shared multitenant addressing live                                                                                    |
| Production cutover               | 2026-07-13: container `openbot-gateway-rc` → `openbot:rc-amd64-v6`, host network, loopback :18789, `--user root`, state `/root/.openbot` |
| `OPENBOT_MULTITENANT`            | **1** (shared path smoke window)                                                                                                         |
| `OPENBOT_IMAGE_INSTALL`          | **1** (skip npm-global update banners)                                                                                                   |
| `OPENBOT_BUNDLED_VERSION`        | `2026.7.12-rc.2`                                                                                                                         |
| healthz / readyz                 | **200** / **200**                                                                                                                        |
| Control UI                       | `index-Wet-oAtx.js` (full rebuild; supersedes UI-only `index-Df4e7bLI.js` layer)                                                         |
| Edge smoke                       | biz / admin / www / openbot.love / gw healthz **200**                                                                                    |
| Approved by                      |                                                                                                                                          |
| Field                            | Value                                                                                                                                    |
| -------                          | --------                                                                                                                                 |
| Date                             | 2026-07-13                                                                                                                               |
| RC branch / tag                  | `release/candidate-20260712` @ `2026.7.12-rc.2`                                                                                          |
| Git SHA                          | `5dad0b9d4b` (full monorepo FE+BE rebuild; hybrid isolation **not** included)                                                            |
| Image tag                        | `openbot:rc-amd64-v6`                                                                                                                    |
| Image id                         | `cb81f9641624` (`linux/amd64`, full Dockerfile build)                                                                                    |
| Built from clean worktree? (Y/N) | Y (RC tip after 6 stream-scoped landing commits; only local `node_modules/.bin` noise left dirty)                                        |
| Tenant tests                     | Prior green suite retained; shared MT seat-store path fix in this tip                                                                    |
| B4 tenant-context                | **Merged** PR #35; shared multitenant addressing live                                                                                    |
| Production cutover               | 2026-07-13: container `openbot-gateway-rc` → `openbot:rc-amd64-v6`, host network, loopback :18789, `--user root`, state `/root/.openbot` |
| `OPENBOT_MULTITENANT`            | **1** (shared path smoke window)                                                                                                         |
| `OPENBOT_IMAGE_INSTALL`          | **1** (skip npm-global update banners)                                                                                                   |
| `OPENBOT_BUNDLED_VERSION`        | `2026.7.12-rc.2`                                                                                                                         |
| healthz / readyz                 | **200** / **200**                                                                                                                        |
| Control UI                       | `index-Wet-oAtx.js` (full rebuild; supersedes UI-only `index-Df4e7bLI.js` layer)                                                         |
| Edge smoke                       | biz / admin / www / openbot.love / gw healthz **200**                                                                                    |
| Approved by                      |                                                                                                                                          |

## Notes

- First B4 image failed at runtime: Dockerfile copied only `openclaw.mjs` (shim imports `openbot.mjs`). Fixed in `bae6960771`.
- Dockerfile adds `RUN test -f openbot.mjs` guard; prior staging ran `openbot:rc-amd64-v2` (`46023acddeca`).
- Runtime must use `--user root` (or readable mount) when config lives at `/root/.openbot` (mode 600).
- 2026-07-13 UI incident: biz white-screen `Cannot read properties of undefined (reading 'trim')` — fixed in `0eef308fce`; shipped as image layer `rc-amd64-v5`.
- **`rc-amd64-v6` = full monorepo rebuild** from SHA `5dad0b9d4b` (not a UI-only layer). Includes: managed-only model assets UI, growth 3-step checklist, trial-sales skill, customer attributes, enterprise-data isolation, admin activation email package, tenant-scoped seat/identity HTTP save path, OCI image-install update skip.
- **Excluded (WIP)**: multi-tenant hybrid “shared + dedicated” isolation (`kiro-hybrid-isolation/hybrid-gateway-isolation` worktree / branch) — **not merged** into this RC tip.
- Dual-tenant **browser** gates remain human-owned (see smoke-checklist).

## Rollback

```bash
# previous full image (pre-v6)
podman rm -f openbot-gateway-rc
podman run -d --name openbot-gateway-rc \
  --restart=unless-stopped \
  --network host --user 0 \
  --env-file /root/.openbot/.env.docker \
  -v /root/.openbot:/root/.openbot \
  -v /var/tmp/openbot-compile-cache:/var/tmp/openbot-compile-cache \
  localhost/openbot:rc-amd64-v5 \
  node openbot.mjs gateway --bind loopback --port 18789
```
