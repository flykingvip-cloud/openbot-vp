# Phase D §9.2 D3 — 部署耦合证据（否定证明；未勾选）

> 证据 id：`phase_d_92_d3_deploy_coupling_evidence`。  
> 落点：`.kiro/specs/constitutional-governance-discovery/phase-d-92-d3-deploy-coupling-evidence.md`。  
> 日期：**2026-09-26**（Asia/Shanghai）  
> 基线：`main` @ `7adf7999d3b63df43bf96f104a0d08437651b895`  
> 前置：`phase-d-92-written-scope-acceptance.md` + `phase-d-92-d3-start-order.md`  
> 对应检查表项：`phase-d-product-split-proof-plan.md` **D3**  
> **本页填充 D3 证据通路；不勾选 D3；不主张 §9.2 完成或产品已拆。**

## 1. 一句话

在基线 SHA 上，三个提议产品包与 gateway / Pi 聊天热路径 **无部署耦合引用**；仓库内亦 **无** 指向它们的独立部署作业 / 镜像 / 发布流水线。据此给出 D3 允许的否定证明形态：**当前形状禁止「单独部署」叙事**，且不得把「包名存在于 workspace」写成已解耦可交付产品。

## 2. 证据对象

| 提议产品 | 包 | 边界常量 |
| --- | --- | --- |
| Registry | `@openbot/constitutional-registry` | `REGISTRY_SCAFFOLD_BOUNDARY` |
| Conformance | `@openbot/constitutional-conformance` | `CONFORMANCE_SCAFFOLD_BOUNDARY` |
| Runtime | `@openbot/constitutional-runtime` | `RUNTIME_SCAFFOLD_BOUNDARY` |

对照：`phase-d-product-split-scaffold.md`（#62）；各包 `package.json` / `README.md` / `src/boundary.ts`。

## 3. 耦合图（部署 / 引用面）

```
gateway chat / tool invoke / ACP / AOR / dispatch / gateway-hook
        │
        │  (no import of @openbot/constitutional-{registry,conformance,runtime})
        ✗
        │
@openbot/constitutional-{registry,conformance,runtime}
        │  re-export only
        ▼
@openbot/constitutional-contracts   ← 同 monorepo；无私有部署单元

独立部署作业 / 镜像 / 发布流水线：无（CI / deploy / docker / fly / render 根无包名命中）
```

### 3.1 热路径引用扫描（基线）

| 扫描面 | 结果 |
| --- | --- |
| `src/gateway` | 无 `constitutional-registry` / `constitutional-conformance` / `@openbot/constitutional-runtime` |
| `src/agents` | 同上（无） |
| `src/task-orchestration` | 同上（无） |
| 包外 `@openbot/constitutional-{registry,conformance,runtime}` 字符串 | 仅 discovery 脚手架叙述（`phase-d-product-split-scaffold.md`）；**无**运行时消费者 |

注：仓库内存在本地文件名 `constitutional-runtime-facade.*`（预检 / 编排旁路 observe 适配）；它们 **不是** `@openbot/constitutional-runtime` 包 import，不构成本 D3 的包级部署耦合。

### 3.2 部署单元 / 作业扫描（基线）

| 扫描面 | 结果 |
| --- | --- |
| `.github` / `deploy` / `docker-compose.yml` / `Dockerfile*` / `fly.toml` / `render.yaml` | 无三包名命中 |
| 各包 `package.json` | `private: true`；`version: "0.0.0"`；description 含 **Not independently deployable** |
| 各包 `*SCAFFOLD_BOUNDARY` | `independentlyDeployable: false`；`deployBoundaryProven: false` |

## 4. D3 判定（证据形态满足；勾选权未行使）

| 证明计划 D3 要求 | 本页回应 |
| --- | --- |
| 与 gateway / Pi 热路径的部署耦合已画清 | §3 图 + §3.1 扫描：无包级热路径 import |
| 允许「禁止单独部署」的否定证明 | §3.2：无独立作业；包元数据与边界常量显式 `independentlyDeployable: false` |
| 禁止把「包在 workspace」写成已解耦 | 本页明确：**code-present 脚手架 ≠ 可单独部署产品** |

**勾选状态：** proof-plan **D3 保持 ☐ 未证明**。  
理由：书面范围要求 **架构 Owner 签字** 后方可勾选；本证据页只收集材料，**不**代签。

## 5. 主张等级与非主张

| 允许 | 禁止 |
| --- | --- |
| 文档事实；导入 / 部署扫描结果 | `runtime-enabled` / `production-proven` |
| 「当前无热路径包引用；禁止单独部署叙事」 | 「产品已拆」「§9.2 已批准」「D3 已证明（☑）」 |
| 主张天花板 **`code-present`** | 改代码把 `deployBoundaryProven` 设为 true |

## 6. 明确不做（本证据页）

- 不勾选 D1 / D2 / O1–O3 / L1–L3
- 不主张失败域已分开可回滚（D2）或「必须同进程」ADR 已签字（D1）
- 不接线、不 enforce、不发版、不新建仓库
- 不把 Phase C NO-GO 改成 GO；不宣称 C10 pass

## 7. 回滚

删除本页并还原 proof-plan / written-scope 中对本页的指针即可。无运行时依赖。

## 8. 验收提示（给后续独立审阅；本 PR 不呼叫）

**PASS（证据形态）：** 耦合图与扫描可复核；否定证明写清；D3 ☐ 仍开；无「产品已拆」叙事。  
**FAIL：** 勾选 D3 却无架构 Owner 签字；或把本页写成整段 §9.2 / 发版批准。
