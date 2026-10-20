# verify-live-image-identity — 2026-09-11

Command: `deploy/production/scripts/verify-live-image-identity.sh`  
Exit: 0

```
=== OpenBot live image identity (R9 gate) ===
host           : root@8.217.93.71 (over ssh)
container      : openbot-gateway-rc
build-info     : 79f2d5f57b9170877e24e40b76bb8982f63e4bb1
image          : localhost/openbot:rc-amd64-provenance-79f2d5f57b
OCI revision   : 79f2d5f57b9170877e24e40b76bb8982f63e4bb1
identity       : PASS (running artifact matches the image provenance)
```

Re-read after RPC/UI probes still returned the same `build-info.commit`.
