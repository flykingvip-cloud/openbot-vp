# VB-4 独立复算报告（工程交付核对，非正式验收）

- 日期：2026-11-27，时区 Asia/Shanghai (CST, UTC+8)
- 范围：只读核对 `flykingvip-cloud/knowledge-sdk` 隔离分支 `feat/v21-wave0-contracts-and-adapters` 精确 commit `02bf58738986bc7e22dfeafcb2911970d14f2588`。独立运行 `validate.py`，按指定算法复算 18 个契约文件与清单自身的 SHA-256。
- **这是工程交付核对，不是 Wave-V21-0 正式验收，也不解锁 Wave-V21-1。** 不自签 Gate 3 / Gate 4。不宣称 T-01–T-27 通过。
- 未修改 knowledge-sdk 的任何文件、分支指针或远程。未联系团队 A。未推送、未开 PR。
- 复算工作树：独立目录 `/workspace/kb-sdk-align/knowledge-sdk-va1-02bf5873`（detached `02bf5873`）。既有盒子克隆 `/workspace/knowledge-sdk` 保持在 `feat/space-alignment-v1-design-proto@4bed2a1c`，本轮未 fetch、未 checkout、未改写。

## 1. Commit 与祖先关系（独立核实）

| 主张 | 独立核实结果 |
|---|---|
| Commit `02bf58738986bc7e22dfeafcb2911970d14f2588` 存在 | **成立。** GitHub MCP `get_commit` 与对 `https://github.com/flykingvip-cloud/knowledge-sdk.git` 的独立 `git fetch` 均返回该 SHA。提交信息：`fix(v21): ignore ephemeral CI evidence paths in the boundary scanner`。作者/提交时间 `2026-11-26T23:01:33Z` = **2026-11-27 07:01:33 CST**。父提交 `0046254a76af34930e82099a067fc98c2b968213`。提交未签名（`verification.verified: false`）。 |
| 该 SHA 是分支 `feat/v21-wave0-contracts-and-adapters` 的当前尖端 | **成立（核实时）。** `get_commit(ref=feat/v21-wave0-contracts-and-adapters)` 与 `git rev-parse origin/feat/v21-wave0-contracts-and-adapters` 均为 `02bf58738986bc7e22dfeafcb2911970d14f2588`。 |
| 由冻结基线 `9940818b962ccb186c0dfb0158de6bd9bd49057b` 拉出（是其后代） | **成立。** 在独立 fetch 的仓库中：`git merge-base --is-ancestor 9940818b962ccb186c0dfb0158de6bd9bd49057b 02bf58738986bc7e22dfeafcb2911970d14f2588` 为 YES。`9940818b..02bf5873` 恰好 **5** 个提交：`cb8571f` → `32e71e8` → `171dfc2` → `0046254` → `02bf587`。 |

既有 `/workspace/knowledge-sdk` 在核验开始时本地已有同名分支指向同一 SHA，但本轮不以该 clone 的旧 remote 状态为唯一证据：所有祖先与尖端结论均来自对本目录的独立 fetch + GitHub API。

## 2. `validate.py`（本机独立运行）

在独立树 detached `02bf5873` 上执行（环境无 `python` 命令，改用 `/usr/bin/python3` 3.13.5，参数与 CI 一致含 `-W error::ResourceWarning`）：

```
python3 -W error::ResourceWarning contracts/v21-reuse-v1/validate.py
```

- **退出码：0**
- stderr：空
- stdout（原文）：

```json
{
  "failed": 0,
  "formal_acceptance": false,
  "manifest_file_count": 18,
  "manifest_sha256": "6da567e0f376fee7b6b2b033e6666cbd5eba7bc3d67b93089e49e6edb759906d",
  "negative": 33,
  "positive": 18,
  "status": "DRAFT_CONTRACTS_VALIDATED_NOT_FORMAL_ACCEPTANCE",
  "vectors": 51
}
```

原始 stdout 备份：`VB4_VALIDATE_PY_STDOUT.json`。脚本自身把状态标为 **非正式验收**（`formal_acceptance: false`）。本轮未把该输出当成正式验收。

## 3. SHA-256 独立复算

算法（按指令，并与清单内 `canonicalization` 字段一致）：POSIX 相对路径、稳定排序、**原始字节** SHA-256；清单不计入自身；排除 `node_modules/`、`ts-generated/`、`package-lock.json`、`__pycache__/`、`*.pyc` 和点文件。

扫描根为仓库根下的 `contracts/v21-reuse-v1/`。清单内路径是该目录的相对路径（如 `README.md`），哈希对象是文件原始字节（与用仓库根相对路径标识是同一组文件）。排序在同一目录下与仓库根相对路径排序一致。

排除的现存文件：`contracts/v21-reuse-v1/.gitignore`（点文件）、`contracts/v21-reuse-v1/package-lock.json`。该 commit 树上此目录无 `node_modules/`、`ts-generated/`、`__pycache__/`。

### 18 个契约文件（独立复算 = 清单记录，无分歧）

| # | 路径（相对 `contracts/v21-reuse-v1/`） | 字节数 | 独立 SHA-256 | 与清单 |
|---|---|---:|---|---|
| 1 | `README.md` | 1883 | `fa1f205290076cdfe09262ba62a8b30a422909b3b39a1cc5a139e4487bcf18d2` | 一致 |
| 2 | `ai-execution-trace.schema.json` | 2704 | `dc245d3db84c5f856a6c9396761d7bfa2e28e03145054620746fcfe5d39c118c` | 一致 |
| 3 | `ai-execution-trace.vectors.json` | 3364 | `28765d7c62767d4a311fcf09d4593a9c866bfe39c8548bffa3b662b94a794b46` | 一致 |
| 4 | `check.ts` | 8726 | `a20ef1457c940693ac3da04fdb59534468a99bddfcf96f05a528393739b9d895` | 一致 |
| 5 | `controlled-data-bridge.schema.json` | 7822 | `34cd37d7476ff9984e98234cf952ae8818a9d587c696d1d1c6cebf4e0b41c9ae` | 一致 |
| 6 | `controlled-data-bridge.vectors.json` | 9591 | `34f26575657afca025962af0abe73dcc768faca5c8d1c710b48932e57268a9c6` | 一致 |
| 7 | `dto.py` | 2403 | `e2183b640542592636eace30d4e041d5957bd0e824ab168e05a5dc540c8ac59b` | 一致 |
| 8 | `dto.ts` | 4390 | `5cb3c29e612d78e56695b89062a25a6a96d8f75727599e6f1ddc9fa6f7fe3ac3` | 一致 |
| 9 | `memory-resource-bridge.schema.json` | 5586 | `9e3040a4b8210f850470dcc4d761cde0762873a81226f7ba629873e6f7c2b54c` | 一致 |
| 10 | `memory-resource-bridge.vectors.json` | 6965 | `0951c4a7276041a45d3d66abb5b36f3e17a0a84341d970b07f9ef636301809c3` | 一致 |
| 11 | `model-adapter.schema.json` | 9233 | `0ade91232bbdbb15fae8fdecb5893cecf5216e6ac48c943547738f70d29c0ce1` | 一致 |
| 12 | `model-adapter.vectors.json` | 9272 | `34187a829a9598c70bbac7b4f78200ed8dfa1f485c0092f280ad4f4621543809` | 一致 |
| 13 | `openapi-v3-draft.vectors.json` | 2174 | `a8c8e54d637119de719e1ecbfbf1321a5ac637e93cbde6587eb01e23518fa716` | 一致 |
| 14 | `openapi-v3-draft.yaml` | 18064 | `a3f3379f4508a8296ce5d5194c62d055288c2fd36e67d26a5653a38b1d663bf5` | 一致 |
| 15 | `package.json` | 292 | `f1d503b03007788a3f42d083ed295b9f239d55aa567cb234d1a3c1d622e52e2a` | 一致 |
| 16 | `status.json` | 428 | `05301377f06be4d68e1dbbdcea294c26f97dd21f1e826a20b83b2055c90559f4` | 一致 |
| 17 | `tsconfig.json` | 354 | `6353b3138e38ead9550c2a76a43fe3dfafff35d32a0b19732a1467896fe1238c` | 一致 |
| 18 | `validate.py` | 12211 | `b550bdc250a2d3f8182650296ffcfd69667a4bb415e7d0d9f9fc98795cfa4fbe` | 一致 |

集合比较：独立扫描集合与清单 `files[]` **完全相同**（无只在一侧出现的路径，无哈希不一致）。`file_count` 均为 18。机器可读备份：`VB4_INDEPENDENT_SHA256.json`。

### 清单文件自身

- 路径：`contracts/v21-reuse-v1/v21-contract-manifest.json`（2733 字节）
- 独立 SHA-256：`6da567e0f376fee7b6b2b033e6666cbd5eba7bc3d67b93089e49e6edb759906d`
- 团队 A 声称：`6da567e0f376fee7b6b2b033e6666cbd5eba7bc3d67b93089e49e6edb759906d`
- **一致。** 亦与本机 `validate.py` stdout 中的 `manifest_sha256` 一致。
- 清单 `status`：`DRAFT_WAVE_V21_0_NOT_FROZEN`（契约未冻结）。

## 4. V21-DELTA-*

**契约字节与文件清单：无 V21-DELTA。** 未发现哈希或集合分歧，因此未登记 `V21-DELTA-HASH-*` / `V21-DELTA-SET-*`。未修改团队 A 的任何契约文件。

登记一项**源文档缺口**（不是契约哈希分歧）：

| ID | 类型 | 状态 | 说明 |
|---|---|---|---|
| `V21-DELTA-SRC-01` | 官方 10 字段源文档 | **本轮关闭为 FOUND**（文档本身尚未 Owner 签认） | 写 VB-4 报告初稿时源文档仍缺失。Owner 随后将官方《Master Architecture v2.1 — OpenBot 既有能力清单与 Knowledge SDK 边界规范》发到团队 B 对话。独立复算 SHA-256 为 `c5196ff1d050ac6477cc064390a708a4d10121cf7fe300bb24764a87a2a5b1c2`，与归档声明一致。路径见第 5 节。团队 A 交接当时标注的 `PROPOSED_PENDING_SOURCE_DOCUMENT` 与 Team B 上轮 INTERIM 模板均不得继续当作官方口径；此后以本文第七节原文为准。不把该文件当成整份基线已签认：文内 `signoff_status` 仍为 `READY_FOR_OWNER_SIGNOFF_AND_STREAM_A_E_AUDIT_CLOSURE`。本片不重写 Stream A/B 报告。 |

团队 A 交接中列出、留给 Team B / 后续切片的剩余缺口（此处只转述并与既有 Track 2 审计交叉，**不**把它们记成契约哈希分歧）：Live CogniWeave `/v1` 撤权接线（Stream D，本轮未做）；OpenBot 尚无公开 `models.embed` / `models.rerank` 代理（已在 Stream A 实码确认）；Mode A/B/C 生产解锁仍未授权（Stream B 保持 `knowledge-object-only` 关闭）；`/v3` 未挂载；Semantic Object 只读导出属 VB-3（本轮未实现）。

## 5. 官方 10 字段源文档

**FOUND**（本轮独立核实哈希；不视为整份基线已签认）。

- 标题：Enterprise AI Infrastructure Master Architecture v2.1 — OpenBot 既有能力清单与 Knowledge SDK 边界规范
- 盒子工作副本：`/workspace/kb-sdk-align/MASTER_ARCHITECTURE_V2_1_REUSE_BASELINE.md`
- 交接包副本：同目录下的 `MASTER_ARCHITECTURE_V2_1_REUSE_BASELINE.md`（字节一致）
- 独立 SHA-256：`c5196ff1d050ac6477cc064390a708a4d10121cf7fe300bb24764a87a2a5b1c2`
- 文内 `signoff_status`：`READY_FOR_OWNER_SIGNOFF_AND_STREAM_A_E_AUDIT_CLOSURE`（尚未 Owner 签认，亦未宣称 Stream A–E 审计闭环完成）
- 10 项字段原文位于 **「七、联合代码级深度审计执行任务书（Stream A–E 闭环门禁）」** 表「必交 10 项标准化审计字段」列（Stream A 行给出完整枚举；B/C/D 为「同上 10 项」加各自外加项；Stream E 不是这 10 项表）：

1. 文件路径与代码入口
2. 核心对象与数据表/存储文件
3. API / RPC / Event 契约
4. 当前权威写主
5. 已实现且稳定功能
6. 仅有接口/原型/默认关闭/Fail-Closed 功能
7. 已完成的测试证据
8. 未覆盖的测试场景
9. 与另一仓库的重复点
10. 保留/扩展/迁移/废弃裁定

外加要求（官方原文，本片不据此重写 A/B 或启动 C/D）：
- Stream B：逐连接器区分生产可用驱动 vs Demo/Mock，明确解锁 `knowledge-object-only` 所需的安全门禁。
- Stream C：核实 AOR Stage 4 真实测试状态、区分确定性探针 vs LLM-as-Judge 缺口。
- Stream D：给出 OpenBot 本地知识模块向 SDK 委派收口清单，与 Space Pre-v7 B2-2 124 项实审完全对齐。
- Stream E：输出冻结版《跨系统接口契约清单》及兼容性测试矩阵，纳入双仓 CI 守门。

## 6. 交接报告与 CI（只读，不轻信数字）

交接报告已从精确 commit 只读取得：`docs/acceptance/v21-wave0/V21_WAVE0_TEAM_A_HANDOFF_REPORT.md`（GitHub blob 与独立树上的同路径文件）。报告自称「design/contract/sandbox handoff, not formal Wave-V21-0 acceptance」，且不在报告内写入最终 commit SHA / run URL（留给外部 receipt）。Team A 树内 `OWNER_WAVE_V21_0_DIRECTIVE.md` 的 SHA-256 为 `f448592cdd3f6e7ec35e1887d27775abf4418fee251bb485d98a1eef28866738`，与我们保存的指令原文一致。

本轮 **未重跑** `verify_frozen.py`、`verify_v21_boundaries.py` 或 sandbox 套件；不把仓库内已提交的 `verify_*.output.json` 当作本轮独立门禁复跑结果。本轮独立执行的是 `validate.py` 与契约 SHA-256 复算。

### CI run `45908411136`

来源：GitHub Actions API 只读（`get_workflow_run` + `GET /repos/flykingvip-cloud/knowledge-sdk/actions/runs/45908411136/jobs?per_page=100`，HTTP 200）。**不是**本机重跑 CI。

| 字段 | 独立读到的值 |
|---|---|
| URL | https://github.com/flykingvip-cloud/knowledge-sdk/actions/runs/45908411136 |
| workflow | `tests`（`.github/workflows/tests.yml`），`run_number` 50，`event` push，`run_attempt` 1 |
| `head_branch` | `feat/v21-wave0-contracts-and-adapters` |
| `head_sha` | `02bf58738986bc7e22dfeafcb2911970d14f2588` |
| run `status` / `conclusion` | `completed` / **`success`** |
| 创建 / 更新（已换算 CST） | 2026-11-27 07:01:37 CST 起，2026-11-27 07:12:59 CST 更新（API 原值为 `2026-11-26T23:01:37Z` / `2026-11-26T23:12:59Z`） |
| jobs | `total_count=37`，返回 37 条；全部 `completed` + `success`；全部 `head_sha=02bf5873` |
| 最长 job | `unit-suite (3.9, ubuntu-22.04)` **488.0s**，全部低于交接 resolver 提到的 1080s 上限 |
| 新增 job | `v21-wave0-boundaries`：`success`，18.0s |

作业级摘要见 `VB4_CI_RUN_45908411136_JOBS_SUMMARY.json`。未下载完整日志或 artifact，因此未逐步复核每一条命令的控制台输出。

## 7. 明确非结论

- 不构成 Wave-V21-0 正式验收，不解锁 Wave-V21-1。
- 契约状态仍为 `DRAFT_WAVE_V21_0_NOT_FROZEN`。
- 未实现 VB-3，未启动 Stream C/D。
- 未改 OpenBot 产品代码、宿主开关、Gateway 默认路由；未解锁 Mode A/B/C；未做 Semantic Object 双写。
