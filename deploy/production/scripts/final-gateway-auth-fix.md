=== Final Nginx & Gateway Auth Fix Summary ===

**Nginx Cleanup Status**
Duplicates cleaned: openbot-subdomains.conf and openbot.love.conf moved to disabled.
Current server blocks: 5 (no more conflicting server names).

**Gateway Auth Root Cause**
Missing trusted proxy user header. The token is managed via SecretRef.
**Permanent Fix**

1. Ensure the SecretRef for gateway.auth.token is correctly set in your secret management system.
2. Run `openbot doctor --fix` and `openbot gateway restart`.
3. Test: openbot channels status --probe
