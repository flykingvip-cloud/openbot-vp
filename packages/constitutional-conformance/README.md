# @openbot/constitutional-conformance

Phase D §9.2 的 **Conformance 脚手架**。书面范围是 `phase_d_product_split_scaffold`（2026-09-25）。

执行方案把「拆独立产品」标成推迟。本包是用户要求的边界刀：私有 workspace 包，只重新导出 `@openbot/constitutional-contracts` 的 shadow 评估器与 P8a 路径缺口报告。它不是独立可部署产品，也没有自己的发布列车。

发现注：`.kiro/specs/constitutional-governance-discovery/phase-d-product-split-scaffold.md`。

## 指向的既有表面

| 重新导出                           | 来源        |
| ---------------------------------- | ----------- |
| `evaluateShadowConformance`        | `evaluator` |
| `reportPathGap` 与 `no_valid_path` | `path-gap`  |

评估器在调用方传入 `enforce: true` 时仍保持 `enforced: false`。路径报告可以命名缺口，输出的 `selectedPath` 仍是 `null`。本包不复制这套逻辑。

## 仍未证明（本包不主张）

部署边界、所有权、生命周期都还没有被证明需要分离。`CONFORMANCE_SCAFFOLD_BOUNDARY` 里这三项都是 `false`。

## 明确不做

- 不独立交付，不新增生产部署或发布流水线
- 不做 P8b / P8c，不涂装 Path，不收紧 Gate / Path
- 不 enforce，不 live invoke，不默认打开 Fabric
- 不接入 gateway chat、tool invoke、ACP、AOR、dispatch、gateway-hook
- 不把 Phase C 写成 GO

## 本地检查

先构建契约包，再检查本包：

```bash
pnpm --dir packages/constitutional-contracts run build
pnpm --dir packages/constitutional-conformance run typecheck
pnpm --dir packages/constitutional-conformance test
pnpm --dir packages/constitutional-conformance run build
```
