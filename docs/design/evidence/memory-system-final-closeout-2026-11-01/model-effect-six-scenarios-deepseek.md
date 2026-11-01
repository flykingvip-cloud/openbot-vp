# Model-effect six scenarios — DeepSeek (2026-11-01)

| Field | Value |
| --- | --- |
| Asia/Shanghai | 2026-11-01 ~23:23 +0800 |
| Provider | `api-proxy-deepseek` (`https://api.deepseek.com`) |
| Model | `deepseek-chat` |
| Pinned product SHA | `3460ef9faa8d7844367f4e2e4d28f656aeb27072` |
| Product tree | `/Users/daniel/AI VP/openbot-closeout-accept-build-3460ef9fa` |
| State root | `/private/tmp/openbot-closeout-model-effect-3460ef9fa/` (synthetic only) |
| Machine calls | **6** (1 per scenario); hard-stop 40 / ~$5 **not hit** |
| Gateway | none started; did not touch :18789/:18790/:19001 |
| Real `~/.openbot` memory writes | **no** (key read-only for provider) |

## Results

| Scenario | Status | One-line reason |
| --- | --- | --- |
| 保存后新会话采用 | **pass** | New-session manager recall injected fact; model quoted token |
| 无关内容不乱入 | **pass** | Relevant adopted; unrelated hobby token absent from answer |
| 更新后不沿用旧事实 | **pass** | After `supersedeAtom`, only NEW in context; model adopted NEW not OLD |
| 无权限不进上下文 | **pass** | Wrong-owner ACL empty context; model did not adopt secret |
| 遗忘后不用被禁用来源 | **pass** | path1 `forgetMemoryEntry` removed source; model did not use token |
| 未批准学习不采用 | **pass** | Candidate excluded from recall/context; model did not adopt; approve control injects |

Machine-readable: `model-effect-six-scenarios-deepseek.json`  
Driver: `model-effect-six-scenarios-deepseek.driver.ts`

## Scoring / anti-lucky-guess

Unique `SYN-FACT-*` / `SYN-LESSON-*` tokens. Positive scenarios require **fragmentInRequest=true** and answer contains token. Negative scenarios require fragment absent from request and answer.

## Layer close

`overallModelEffectCloseable=true` for this synthetic DeepSeek matrix (all six pass with real model answers).  
Does **not** claim production online effect, full gateway agent tool-loop E2E, merge, or deploy.
