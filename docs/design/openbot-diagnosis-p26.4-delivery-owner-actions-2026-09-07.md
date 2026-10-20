# OpenBot Diagnosis Platform — P26.4 delivery_ledger_owner 行动单（2026-09-07）

Date: 2026-09-07

Status: **LIVE 已是 `8b5db08ee1`。诊断正式放行绑这个 SHA。不要为了本增量再切一次，除非要把放行记录打进下一版镜像。**

Task: `openbot-diagnosis-platform`

Related: [P26.4 放行](/design/openbot-diagnosis-p26.4-2026-09-07)

`cutoverOwner=delivery`。`diagnosisOnlyCutover=false`。`nextOfficialStep=soak_internal_single_tenant`。

---

## 1. 已证明的身份

| 对象                 | 值                                         | Diagnosis 决定 |
| -------------------- | ------------------------------------------ | -------------- |
| LIVE                 | `8b5db08ee149db694a47210d4e65bd0958ffdcd3` | 正式放行绑定   |
| P26.3 hold candidate | `91d4247ee21604f60b37fb1de3cc30209443ef76` | 作废，禁止重切 |
| I2 / 账本            | #1026 仍在排队；seq 66 尚未入主干          | 不挡放行       |

容器身份仍以 `podman exec openbot-gateway-rc cat /app/dist/build-info.json` 为准。

---

## 2. delivery 现在该做的事

1. 继续等 #1026 必过门禁变绿后合入账本。不要把账本写进诊断 PR。
2. 账本合入后如需记录 seq 66，只由 delivery 写 `releases.jsonl` / `RELEASE_RECORD.md`。
3. 不必为 P26.4 再 stage。现网已经在跑被放行的 SHA。
4. 若要把本放行记录打进镜像，等 #1026 与本增量都进主干后，再按当时新鲜 `origin/main` 做下一次统一窗口。那是可选 soak 镜像，不是放行前提。
5. 不要改诊断 gate 环境变量，不要打开 live executor。

---

## 3. 明确禁止

- 用 `91d4247e` / `7d3fdf5b` / `040e714c` 当 candidate
- Diagnosis 代切、代写账本、补 provenance
- 把 P11 `DIAGNOSIS_PRODUCTION_SLO` 填成 complete
- 部署 live remediation executor 或绑 Doctor `--fix`
