# Firewall and network red lines (Wave 2)

## Must

1. **Gateway port 18789** (or custom) reachable **only** from:
   - localhost on the same host as nginx, or
   - a private network CIDR that only the reverse proxy uses
2. Public internet may reach **443/80** on the proxy only.
3. Prefer `gateway.bind: "loopback"` so a missed firewall rule still does not publish the Gateway.
4. If bind must be `lan` (e.g. Gateway in another container), use:
   - docker user-defined network + no published 18789, or
   - host firewall allowing only the proxy container/host IP.

## Quick checks

```bash
# On the gateway host — should show 127.0.0.1:18789 (or docker internal only)
ss -ltnp | grep 18789 || netstat -ltnp | grep 18789

# From an external machine — must fail (timeout / connection refused)
curl -m 3 http://<public-ip>:18789/healthz
# Expect failure. Success = CRITICAL misconfiguration.

# Direct gateway call without proxy trust — must not succeed as operator
# openbot gateway call health --url ws://<public-ip>:18789
```

## Docker compose note

`deploy/production/docker-compose.prod.yml` does **not** publish 18789 by default.
Uncomment `ports: 127.0.0.1:18789:18789` only when nginx is on the same host and
needs that published loopback mapping.

## cloud / LB

| Layer                       | Allow                                       | Deny                 |
| --------------------------- | ------------------------------------------- | -------------------- |
| Public LB / CDN             | 80, 443 → nginx                             | 18789                |
| Security group (gateway VM) | 443 from internet; 18789 from nginx SG only | 18789 from 0.0.0.0/0 |
