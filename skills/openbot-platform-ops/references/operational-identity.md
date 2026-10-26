# Operational identity and authorization

## When

User wants to bind email sending identity, WeChat Official Account, OAuth grants, or execute publish/broadcast actions.

## Two tool layers

| Tool                        | Scope                                    |
| --------------------------- | ---------------------------------------- |
| `user_operational_identity` | Personal / employee operational identity |
| `operational_identity`      | Enterprise tenant operational identity   |

Actions: `list`, `resolve`, `execute` (provider-specific: e.g. WeChat `publish_draft`, `publish_article`, `broadcast`)

Implementation: `src/gateway/wechat-official/execute-operational-actions.ts`

## When binding is missing

If tool returns `needsBinding`:

1. Stop execution attempts.
2. Load **`user-guidance-protocol`**.
3. Lazy-load by provider:
   - **personal-email Path B** → `skills/user-guidance-protocol/references/personal-email.yaml`
   - **personal-email Path C** → `skills/user-guidance-protocol/references/personal-email-browser.yaml` (browser co-pilot for auth code; never store login password)
   - wechat-official → 用户自己点界面用 `skills/user-guidance-protocol/references/wechat-oa.yaml`；数字人扫码代写 AppID / AppSecret / IP 白名单用 `wechat-official-credential`
   - platform navigation → `skills/user-guidance-protocol/references/platform-settings.yaml` (`个人设置` → `授权` → `绑定账户`)

For personal-email denials, tool JSON may include `guidanceProtocol`, `browserGuidanceProtocol`, `pathB`, `pathC`, `browserGuide`, `continuationToken`, and `bindingRequestId`.

Never use `exec`, env-var SMTP hacks, or invented RPC.

## Personal intelligent bind (S0+S1+S2+S3+S4)

- Orchestrator (steward / 大白): `oi-orchestrate-personal-identity`
- Personal WeChat Official Account bind wrapper: `oi-bind-wechat-official` → delegates `wechat-official-credential`, `bindTarget=personal`, writeback via `user-operational-identity.credentials.bind`
- Personal email bind: `oi-bind-personal-email` (Path B/C yaml above) → `credentials.bind` (smtp); 126/163 avoid platform SMTP
- Personal GitHub OAuth bind: `oi-bind-github-personal` → `user-operational-identity.oauth.start` / callback; token only in secret store (S2 design: `docs/design/oi-intelligent-bind-s2-github-2026-10-13.md`)
- Grant owned bots: `oi-grant-owned-bots` → `grants.upsert`
- Design contract: `docs/design/oi-intelligent-bind-s0-s1-2026-10-13.md`; S2: `docs/design/oi-intelligent-bind-s2-github-2026-10-13.md`; S3: `docs/design/oi-intelligent-bind-s3-social-2026-10-13.md`; S4: `docs/design/oi-intelligent-bind-s4-wechat-personal-2026-10-13.md`
- Do **not** edit `openbot-user-operational-identity*.json` by hand; secrets never in chat/projection
- GitHub personal OAuth cloud bind: **S2 shipped** (`oi-bind-github-personal`)
- Social cloud bind skills (**S3**, all `path_unstable`): `oi-bind-xiaohongshu` / `oi-bind-douyin` / `oi-bind-weibo` / `oi-bind-bilibili` / `oi-bind-zhihu` / `oi-bind-kuaishou` / `oi-bind-x-twitter` → `credentials.bind` (social_account); design: `docs/design/oi-intelligent-bind-s3-social-2026-10-13.md`
- Personal WeChat personal-account bind (**S4**, **non_cloud_primary** / 非云电脑主路径): `oi-bind-wechat-personal` → delegates `wechat-personal-worker-setup`; writeback via `user-operational-identity.wechat-personal.*` only (status / qr.start / qr.wait / bind-existing); never credentials.bind / oauth; design: `docs/design/oi-intelligent-bind-s4-wechat-personal-2026-10-13.md`

## Content marketing vs identity

- Identity bind/execute → this playbook + `user_operational_identity`
- Content strategy / article drafting → `wechat-official-account` skill (no credential binding)
- Official Account AppID / AppSecret / IP whitelist via isolated browser → `wechat-official-credential`

## Gateway RPC (operator context)

- `user-operational-identity.create`, `.credentials.bind`, `.grants.upsert`, `.execute`, `.oauth.*`
- `enterprise-operational-identity.employee.authorize` / `revoke`
- `user-operational-identity.governance.overview`

## Confirm

- High: bind credentials, grant publish rights, broadcast messages
- Hand-off: CAPTCHA, paywall bypass, password save in browser — user must act

## Done

`resolve` shows active identity; test `execute` with draft-only action when user approves.
