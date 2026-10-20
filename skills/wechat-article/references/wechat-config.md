# WeChat Official Account Config Template

Use this file as a local template only. Do not commit live credentials.

## Required

- AppID: `your-app-id`
- AppSecret: `your-app-secret`

Do not add a Token field. WeChat `access_token` is fetched at runtime. Put gateway egress IPs into the Official Account IP whitelist via `wechat-official-credential`.

## Optional

- CorpID: `optional-corp-id`
- AgentID: `optional-agent-id`

## Recommended Runtime Contract

- Live draft-box writes use the Official Account identity already bound in OpenBot (`operational_identity` / `user_operational_identity`). See `references/draft-handoff.md`.
- Do not point leftover publish scripts at `WECHAT_APP_ID` / `WECHAT_APP_SECRET` / `WECHAT_CONFIG_PATH` when that identity is granted.
- Keep any local template below untracked; never commit live secrets.

## Permanent Material API Rules

- Cover image: `material/add_material?type=thumb`
- Inline images: `material/add_material?type=image`
- Do not use `/cgi-bin/media/upload` for draft publishing.

## Limits To Recheck Before Publishing

- Title: <= 64 bytes
- Cover image: recommended `900x383`
- Inline images: recommended width `800`
