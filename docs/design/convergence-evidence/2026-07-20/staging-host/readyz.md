# Readyz (blocked)

No remote `readyz` body — host URL absent.

When unblocked, capture full JSON from `$STAGING_BASE_URL/readyz` (or `$STAGING_GATEWAY_URL/readyz`) and assert failing ⊆ `{wecom}` or empty.
