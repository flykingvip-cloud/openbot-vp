---
name: wechat-article
description: |
  当用户要做微信公众号成稿、公众号排版、把 Markdown/Word/PDF/纯文本转成可进公众号的 HTML、
  封面生成、配图生成、排版预检、帮我发公众号草稿箱时务必使用本技能。草稿箱写入走已授权的 operational_identity
  / user_operational_identity（见 references/draft-handoff.md），不要跑遗留发布脚本，也不要改答 openbot-platform-ops。
  遇到「公众号文章入库」「归档公众号历史」时走只读归档，不要排版或发布。
  主题精排若已装 gzh-design 则先走该技能的排版段，再回到本技能做封面与配图。
  不要用于普通网页/落地页（visualize）、PPT（cyber-ppt）或正式 PDF（nano-pdf）。
  公众号运营策划走 wechat-official-account。配 AppID / AppSecret / IP 白名单走 wechat-official-credential。
  Also use when packaging a proven typesetting workflow as an enterprise asset.
metadata:
  openclaw:
    emoji: "📰"
    promptPriority: 87
---

# WeChat Article

Official Account **typeset → package → hand off to identity for draft box**, plus a separate **read-only archive** for confirmed `mp.weixin.qq.com` URLs.

Read `references/typeset-handoff.md` before generating cover. Read `references/draft-handoff.md` before writing the draft box. Read `references/archive-from-url.md` before ingesting published articles.

## Use This Bundle In Three Modes

### 0. Archive mode（公众号文章入库）

Use when the user wants existing published articles in the knowledge universe.

Do not typeset, do not call leftover publish scripts, do not scan-login. Follow `references/archive-from-url.md`.

### 1. Publication mode

Use this when the goal is a styled article and/or a WeChat draft.

Workflow:

1. Prepare source content (Markdown, HTML, or Word/PDF/plain text normalized to Markdown).
2. Typeset to a WeChat-safe HTML fragment. Follow `references/typeset-handoff.md`:
   - If skill `gzh-design` is loaded, use that engine and take its HTML as the content file.
   - Otherwise run `scripts/wrap_wechat_html.py` for a compliant unthemed wrap. Do not pretend this is a branded theme.
3. Gate the HTML:

   ```bash
   python3 skills/wechat-article/scripts/validate_wechat_html.py /abs/path/to/article.html
   ```

   ERROR must be zero before cover or draft handoff.

4. Generate the cover with `scripts/gen_cover.sh`.
5. Generate supporting images with `scripts/gen_article_imgs.py` if needed.
6. Write the draft box via operational identity. Follow `references/draft-handoff.md`. Do not run `scripts/publish_agi_axios.js`.
7. Preview manually in `mp.weixin.qq.com` before sending.

### 2. Asset-package mode

Use this when the goal is to turn a successful article workflow into an enterprise asset draft.

Read these files in order:

1. `ASSET.md`
2. `references/typeset-handoff.md`
3. `references/draft-handoff.md`
4. `references/publish-postmortem.md`
5. `references/wechat-config.md`

The asset is only complete when it includes:

- the business scenario
- required inputs and outputs
- exact execution steps
- dependency files and runtime contract
- credential handling rules (identity store, not env-file publish scripts)
- failure patterns and manual review boundary
- suggested enterprise submission fields

## Scripts

### Local typeset fallback

```bash
python3 skills/wechat-article/scripts/wrap_wechat_html.py article.md -o article.wechat.html
python3 skills/wechat-article/scripts/validate_wechat_html.py article.wechat.html
```

Use this only when `gzh-design` is not loaded, or when the user accepted an unthemed wrap.

### Cover generation

```bash
bash skills/wechat-article/scripts/gen_cover.sh "主标题" "副标题" "底部标签"
```

Default output:

- `/tmp/cover.png`

Optional override:

- `WECHAT_ARTICLE_COVER_OUT=/tmp/custom-cover.png`

### Image generation

```bash
python3 skills/wechat-article/scripts/gen_article_imgs.py
```

Outputs:

- `/tmp/article_images/cover.jpg`
- `/tmp/article_images/img1_coding.jpg`
- `/tmp/article_images/img2_jobs.jpg`
- `/tmp/article_images/img3_chart.jpg`

Prefer a public `thumbUrl` for draft handoff. Do not paste a full JPEG as `imageBase64` into the identity tool.

### Draft publication (leftover — do not use when identity is granted)

`scripts/publish_agi_axios.js` and `scripts/publish_article.py` are leftover. They read `WECHAT_APP_ID` / `WECHAT_APP_SECRET` via exec. The live write point is `operational_identity` / `user_operational_identity` `publish_draft`. See `references/draft-handoff.md`.

## Validation Rules

Do not continue if any of these fail:

- typeset HTML missing, or `validate_wechat_html.py` reports ERROR
- cover file missing or too small
- inline image missing or too small
- identity `publish_draft` does not return `executed=true` with a draft `mediaId`

## Troubleshooting

Read `references/publish-postmortem.md` whenever:

- the draft is created but images are broken
- `40007` appears
- someone suggests using `/cgi-bin/media/upload`
- a previous workflow “looked successful” but failed visually in WeChat

Read `references/typeset-handoff.md` whenever:

- the user asked for 公众号排版 but the model started a PDF, PPT, or interactive HTML
- paste-into-editor or themed layout was requested and `gzh-design` is not loaded

Read `references/draft-handoff.md` whenever:

- the model starts `exec` leftover publish scripts
- `publish_draft` fails for missing cover fields
- `IDENTITY_005` appears after `resolve` already returned `allowed=true` (treat as payload/API, not missing grant)

## Important Boundary

Publication mode stops at draft-box creation and preview readiness. Archive mode never publishes.

It should not auto-send the final mass message without an explicit human review step.

A user GO such as 「开始排版和发布」 or 「继续」 after that plan already authorizes typeset and draft-box handoff. Do not end that turn on a progress line such as 「正在收尾排版，稍等片刻」, and do not ask 「请确认」 again for that same act. A second progress sentence is still not a finished turn. Run typeset, validate, cover, and `publish_draft` before replying. Stop only for a real permission, a payment or scan, or a blocker you cannot resolve. Plan-speak about typeset or the draft box is not a shopping pause. The mass-send review above is the decision point, not typesetting itself.

Workspace Markdown, HTML, validation, and the cover are local files. In sandbox mode the `write` tool and `exec` of `wrap_wechat_html.py`, `validate_wechat_html.py`, and `gen_cover.sh` run as `docker exec` inside the account sandbox. The engine socket can start that container and still cannot replace `docker exec`. The WeChat draft box is the later `publish_draft` call, not the workspace file.

If that write or exec returns `Sandbox mode requires Docker` or `DOCKER_CLI_MISSING`:

- Stop. Tell the user the cloud computer cannot write workspace files because the gateway image has no `docker` command. The operator rebuilds with `--build-arg OPENCLAW_INSTALL_DOCKER_CLI=1`.
- Do not ask them to set `agents.defaults.sandbox.mode=off`. Managed Path B refuses sandbox off.
- Do not ask them to confirm host exec or workspace commands that skip Docker. A chat 确认 does not change `tools.exec.host`.
- Do not treat the failure as a draft-box grant check. `publish_draft` still needs the HTML and cover from this step.
- Human confirmation stays on mass send (`publish_article` / 群发) after they preview the draft in `mp.weixin.qq.com`. Creating the draft is not a second sandbox decision.

It should not copy third-party theme libraries into this repository. Themed typesetting is delegated to `gzh-design` when that skill is present.
