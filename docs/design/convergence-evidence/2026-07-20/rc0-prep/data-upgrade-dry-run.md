# Data upgrade dry-run

**Scope:** temporary / fixture only. **No** writes to production data roots (`/root/.openbot`, live host mounts).

## 1) Export schema gate (fixture)

```bash
mkdir -p /tmp/rc0-data-dryrun
# manifest.json: {"schemaVersion":1,...}
node --input-type=module -e '
const manifest = JSON.parse(await import("fs").then(fs=>fs.promises.readFile("/tmp/rc0-data-dryrun/manifest.json","utf8")));
const supported = 1;
if (typeof manifest.schemaVersion === "number" && manifest.schemaVersion > supported) process.exit(1);
console.log("DRYRUN_OK", manifest.schemaVersion);
'
```

| Result | `DRYRUN_OK schemaVersion= 1 supported= 1` |

## 2) Automated coverage as dry-run proxies

| Proxy                               | Command / suite                           | Result this wave |
| ----------------------------------- | ----------------------------------------- | ---------------- |
| Tenant + session promote load paths | `tenant-context.test.ts`                  | 29/29 PASS       |
| localFolder ingest matrix           | `local-folder-import.golden-path.test.ts` | 6/6 PASS         |
| History / checkpoint store reads    | D3 chat suites                            | 5/5 PASS         |

These exercise load/migrate-compatible code paths on temp dirs inside Vitest — acceptable RC0-PREP substitute for full production clone upgrade.

## 3) Not run

- Full `openbot data export` / `data restore` against a production snapshot clone
- Live enterprise-data.json rewrite on a prod mirror

**Blocker for production cutover:** full restore rehearsal still required before PRODUCTION_GO (maintainer-owned). Staging may proceed with gates if fixture + unit proxies remain green.
