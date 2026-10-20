# Account Computer login UX

Status: local tip. This is not a production cutover.

Extends `docs/design/account-computer-browser-routing-2026-10-07.md`. The
browser still refuses to type password fields. `secure_form` is still the only
path that writes those fields.

## What the user sees

On 云电脑, after a snapshot of a login page:

| Page                                                       | First visit            | Later visits for that host            |
| ---------------------------------------------------------- | ---------------------- | ------------------------------------- |
| Already signed in, or no login                             | Continue               | Continue                              |
| Password fields only                                       | Secure Form in chat    | Secure Form, unless a login was saved |
| QR / scan only                                             | 电脑 takeover          | Same                                  |
| Password and QR                                            | One method-choice card | The choice from the first visit       |
| Captcha, slider, or passkey, and Secure Form cannot finish | 电脑 takeover          | Same                                  |

The choice card and the save card sit in the conversation thread, using the
same inline confirm-card chrome as other chat decisions. The Secure Form card
is unchanged: username and password stay in the browser process and are filled
only after the user confirms.

After the first successful typed password login, the thread asks
「是否保存该网站登录信息」. Yes stores the secret in the site-login vault and
sets the host preference to `auto`. The next visit fills through the existing
secure-form pipeline. No means the question is not asked again for that host.

## What the model sees

`account_computer_login` action `plan` takes a host and signals
`{signedIn, password, qr, captcha, passkey}` plus optional field refs. It
returns a decision. It does not accept or return usernames, passwords, or
credential ids.

- `secure_form` → call `secure_form` action `request`
- `handoff` → `secure_form` action `handoff`, then `await_return`
- `autofill` / `autofill_needs_fields` → the gateway fills from the vault
- `offer_save` → asked once after a user-typed fill, not after autofill

The system prompt tells the model not to ask for a password in chat and not
to guess a QR login when password fields are visible.

## Store

Policy is one row per tenant, user, and host:

- `preferredMethod`: `password` | `qr` | `auto`
- `rememberedCredentialId`: opaque id, only when the user opted in
- `firstChoiceRecorded`: the one-time choice (or the only method on the page)
- `saveDeclined`: set when the user says not to save

Secrets live in a separate AES-256-GCM file. The key is the existing enterprise
vault KEK (`OPENBOT_ENTERPRISE_DATA_VAULT_KEY` or `_REF`) when that is set.
A managed profile (`OPENBOT_SECURITY_PROFILE=managed_enterprise`) does not
create a local key file; save is blocked until the KEK is present. Personal
profiles may use a local key file, same pattern as the connector vault.

Domain checks stay on the secure-form fill path (`host`, `allowHosts`,
`expectedUrlPrefix`).

## Demo

1. Open 云电脑 and a login page that shows both a password form and a QR code.
2. First visit: the thread asks for a method. Choose 账号密码. The Secure Form
   card appears. Submit. The fields fill in the cloud browser.
3. After the snapshot shows a signed-in page, the thread asks
   「是否保存该网站登录信息」. Choose 保存.
4. Open the same host again. The agent calls `plan` and the gateway autofills.
   The model transcript has a filled receipt and no password.

Do not merge from this note. It does not authorize a production cutover.
