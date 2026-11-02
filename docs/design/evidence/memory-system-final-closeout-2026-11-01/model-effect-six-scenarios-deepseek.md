# Model-effect six scenarios — DeepSeek (2026-11-01)

**Verdict: 限定范围通过（scoped pass）** — isolated SDK/manager + real DeepSeek answers only.  
**Not** overall model-effect layer close; **not** production acceptance.

| Field                             | Value                                                                                  |
| --------------------------------- | -------------------------------------------------------------------------------------- |
| User timezone                     | **Europe/Berlin**                                                                      |
| Asia/Shanghai clock labels        | From Mac/box machine clock during the run (kept for provenance); not the user zone     |
| UTC                               | `generatedAtUtc` / `startedAtUtc`                                                      |
| Provider                          | `api-proxy-deepseek` (`https://api.deepseek.com`)                                      |
| Model                             | `deepseek-chat`                                                                        |
| Pinned product SHA (scenario run) | `3460ef9faa8d7844367f4e2e4d28f656aeb27072`                                             |
| Product tree                      | `/Users/daniel/AI VP/openbot-closeout-accept-build-3460ef9fa`                          |
| State root                        | `/private/tmp/openbot-closeout-model-effect-3460ef9fa/` (synthetic only)               |
| Machine calls                     | **6** (1 per scenario); call-count hard-stop (40) **not hit**                          |
| Cost evidence                     | **Only** “6 calls; call-count hard-stop not hit” — **not** precise USD spend accounted |
| Gateway                           | none started; did not touch :18789/:18790/:19001                                       |
| Real `~/.openbot` memory writes   | **no** (key read-only for provider)                                                    |

## Results（限定范围通过）

| Scenario             | Status           | One-line reason                                                                      |
| -------------------- | ---------------- | ------------------------------------------------------------------------------------ |
| 保存后新会话采用     | **限定范围通过** | New-session manager recall injected fact; model quoted token                         |
| 无关内容不乱入       | **限定范围通过** | Relevant adopted; unrelated hobby token absent from answer                           |
| 更新后不沿用旧事实   | **限定范围通过** | After SDK `supersedeAtom`, only NEW in context; model adopted NEW not OLD            |
| 无权限不进上下文     | **限定范围通过** | Wrong-owner ACL empty context; model did not adopt secret                            |
| 遗忘后不用被禁用来源 | **限定范围通过** | path1 `forgetMemoryEntry` removed source; model did not use token                    |
| 未批准学习不采用     | **限定范围通过** | Candidate excluded from recall/context; model did not adopt; approve control injects |

Machine-readable: `model-effect-six-scenarios-deepseek.json`  
Driver: `model-effect-six-scenarios-deepseek.driver.ts`

## Coverage limits（#182 materials must keep）

1. **S2** (`irrelInRequest=true`): pass means **回答未采用无关内容**. It does **not** prove retrieval relevance filtering works.
2. **S3**: used SDK `supersedeAtom` directly — proves post-update query/answer use **NEW** fact. It does **not** prove the full product conflict-handling entry flow.
3. **S5**: path1 file-delete forget — does **not** replace fact-level soft forget, all-sources handling, or post-restart forget acceptance.

## Scoring / anti-lucky-guess

Unique `SYN-FACT-*` / `SYN-LESSON-*` tokens. Positive scenarios require **fragmentInRequest=true** and answer contains token. Negative scenarios require fragment absent from request and answer.

## Layer close

`overallModelEffectCloseable=true` means **only this six-scenario synthetic run** is closeable (`overallModelEffectCloseableScope` in JSON).  
Does **not** claim whole model-effect layer, production online effect, full gateway agent tool-loop E2E, merge, deploy, or precise USD accounting.
