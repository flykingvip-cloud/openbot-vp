# 交付策略便签：统一镜像 + 分批启用(2026-08-26)

> 目的：为"当前已合入的 main vs 云端已发布版本"给出统一的发布口径,供团队对齐。一页结论 + 风险清单。
> 作者(协调,独立评审/审批方,≠ 实施 owner):`kiro-release-authority`。
> 基线快照:LIVE = `cf7ceb40a7`(releases.jsonl seq 43);main tip = `76fea1fb0669`。

## 结论(TL;DR)

**采用"统一镜像 + 运行期分批启用",不逐项发布镜像。**

- **一个镜像**:对新鲜 `origin/main` tip 做**单次 forward-only cutover**(下一次 = seq 44),而非把单个特性 cherry-pick 到生产。
- **分批启用**:未就绪能力靠 **flag / allowlist / canary 默认休眠**,在运行期按特性、按租户逐步开启;开启是运行时动作,不是重新出镜像。
- **两条版本轨分开**:云端网关版本 = `provenance/sha-*` 容器 cutover(部署 `origin/main` tip);npm CLI 安装版本 = semver(当前 `2026.7.12-rc.2`),独立演进,不随每次 gateway cutover 变。

## 为什么统一镜像(而非逐项)

依据仓库交付标准(`docs/design/openbot-dev-delivery-pipeline-standard-2026-07-20.md`):

1. **`main` 是唯一 trunk、唯一生产 cutover 源;forward-only 强制**。逐项 cherry-pick 到生产 = 从 trunk 分叉,违反 I1(forward-only)/I2(anchoring),制造 identity gap 与回滚风险。
2. **差距小、forward-only**:LIVE→main 仅 12 提交(forward-only=YES),绝大多数是 docs/治理/deploy/spec,单次 cutover 低风险。
3. **特性粒度在运行期,不在构建期**:同一镜像里用 flag/allowlist/canary 控制启用,既得一份连贯可复现的构建,又能对单个特性做逐租户灰度(如 CTR shadow)。
4. **镜像版本单一性**:任一时刻生产镜像只有一个来源 = `origin/main` tip 的 `provenance/sha-*`;避免多镜像并存的漂移。

## 风险清单：统一镜像相对 LIVE 的行为变更(逐类)

LIVE `cf7ceb40a7` → main `76fea1fb0669`,12 提交 / 13 文件 / +1281-38:

| 类别           | 内容                                                    | 默认生效行为   |
| -------------- | ------------------------------------------------------- | -------------- |
| 治理/规格 docs | `.kiro/specs/**`(p2-5 三件、item7 handoff、tasks)       | 无             |
| 交付记账       | `RELEASE_RECORD.md`、`releases.jsonl`、CSC cutover 记录 | 无(记录性)     |
| Loom           | `.loom/registry.yaml`                                   | 无             |
| 证据           | `docs/design/evidence/**`(json / test.mjs)              | 无             |
| **代码**       | `src/memory/item7-stage-d-readiness.ts`(+test)          | **无默认生效** |

**唯一 `src` 改动 `item7-stage-d-readiness.ts` — 已逐条核实安全:**

- **未被任何运行路径 import**(`src` 非测试无引用)→ gateway 运行时不加载、不执行。
- 纯**只读就绪度聚合器**:自述且代码印证 "does NOT add any new production behavior";不碰 `manager-sync-ops.ts`、不切 legacy 生产 sync、不开 cloud/BYOS;字面量钉死 `productionWrite="legacy-only"`、`stageDControlledWrite="shadow-only"`、`cloud/byosEnabled=false`;`cutoverAuthorized` 为计算值(绝不硬编码 true),即便为 true 也只报告、不执行。

**CTR P2.5 shadow(早前已在 main):** fail-closed 休眠——detection/qualification 默认 OFF(持久配置源)、租户 allowlist 默认空、HMAC env 未设即 `hmac_key_missing` 抛错不降级。三重休眠 = 随镜像上线**零观测/零写入**,启用须走独立门禁(移交件 A→B→C)。

**判定:统一镜像相对 LIVE 引入零新默认生效行为。** 两个较新能力(CTR shadow、item7 stage-D)均为休眠/未接线的只读件。

## 分批启用清单(运行期,各有独立门禁)

- **CTR P2.5 shadow**:A 发布审批(有条件 GO,已签)→ B 部署前验收(PASS,已签)→ C 运维启用(密钥→内部租户 allowlist→detection/qualification flag,附回执)。activation/projection/authorization 保持 OFF。
- **item7 stage-D**:维持 legacy-only / shadow-only,Phase E cutover 属另行独立审批。
- 通则:**启用 ≠ 部署**。镜像统一上线后,任何"打开"都要对应的独立审批 + 回执,可即时热回滚(清 allowlist + flag OFF,TTL≤3s,无需重新部署)。

## 当前执行卡点(与本策略正交)

无论统一/逐项,都需要一个可部署镜像。当前 **CI runner 停滞**:`provenance/sha-76fea1fb0669` 的 Docker Release 为 startup-failure(无 runner,3s 秒挂;近期 `main`、`provenance/sha-cf7ceb40a7c4` 同样)。→ 先修复 runner 重跑 Docker Release,或离线构建镜像 `podman load`,再走单次 forward-only cutover(seq 44)。

## 边界

`production rollout (to activation) = NOT APPROVED` 维持;activation/cutover-to-activation/P3 属另一轮独立审批。本便签为对齐口径,不含任何审批/部署/启用动作。
