=== Final Gateway Auth Configuration Guide ===

**Recommended Configuration**

```bash
openbot doctor --fix
openbot gateway restart
openbot channels status --probe
```

**Permanent Fix**
Ensure the SecretRef for gateway.auth.token is properly set in your secret management system (e.g., 1Password, Vault, etc.).
Once set, rerun `openbot doctor --fix`.
