# Decision digest — Phase C（权威算法与冻结哈希）

> assessedAt: `2026-09-24T13:30:14+08:00`（Asia/Shanghai）  
> Material Owner：`constitutional-governance-phase-c-decision:grok-bot`  
> Architecture Reviewer 槽：`codex-architecture`（签收文件 pending）  
> Security：`security-reviewer:profile-ab-tenant`（unsigned）  
> Execution-chain：`conversation-task-runtime:kiro-conversation-task-runtime`（unsigned）  
> 独立终裁状态：**REVISE — awaiting Security and Execution-chain reviews**

## 权威算法（per-file digests are authoritative）

在 specs 目录执行；**逐文件** SHA-256 为权威：

```bash
cd .kiro/specs/constitutional-governance-phase-c-decision
for f in \
  failure-cases.md \
  alternatives-matrix.md \
  metrics-and-evidence.md \
  security-profile-review.md \
  decision.md
do
  shasum -a 256 "$f"
done
```

### Optional combined（must freeze command）

组合摘要**不是**权威；若使用，必须冻结下列命令（对上述 for 循环的 stdout 再做一次 SHA-256）：

```bash
cd .kiro/specs/constitutional-governance-phase-c-decision
for f in failure-cases.md alternatives-matrix.md metrics-and-evidence.md \
  security-profile-review.md decision.md
do
  shasum -a 256 "$f"
done | shasum -a 256
```

## Superseded prior combined digest

先前 combined digest `93d906c2…`（若曾引用）标为 **superseded**：`failure-cases.md` 经 `oxfmt --write` 字节变更，且 Architecture 槽更名 / `decision.md` 追加独立签收 REVISE 澄清后，组合哈希不再适用。以本节 `assessedAt` 下的输出为准。

## Actual outputs（post-oxfmt；`2026-09-24T13:30:14+08:00`）

### Per-file（authoritative）

```
55475cd9e3a4c007206f32e411d379a4f418ceb78db8f43772913ce026abb6b9  failure-cases.md
44c75c25fe4b0570adc23ea26a412913ca2d7221b97180e3b6963fbbe0ece4c5  alternatives-matrix.md
651225d3eff3d03f029dd830760231e621c0e4b8a165de582fb4879f7dcf4b60  metrics-and-evidence.md
ce86af449fc8cac1a2aba6170e64f26a0312236e14e1e9bfd72901e404596be7  security-profile-review.md
bba958653f902f519f9d902b75423e4510c1d8eb025d3732b0149f3cebfd762b  decision.md
```

### Combined（optional；frozen command above）

```
c5e527340f8d551e0569e62a956d6d615b241e92ebdee4e53d8320eae0c73a20  -
```

## Notes

- `decision-digest.md` / `tasks.md` / `requirements.md` / `design.md` / `baseline-manifest.yaml` **不在**上述权威五文件集合内。
- `architecture-review.md` / `security-review.md` / `execution-chain-review.md`：**未创建**；Grok Bot 不得伪造。Architecture 回执须 Codex 原文落盘后方可勾选签收。
