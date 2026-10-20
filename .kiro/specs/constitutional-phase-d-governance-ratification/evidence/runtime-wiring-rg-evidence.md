# Runtime wiring / outside-caller retrieval evidence

capturedAt: 2026-09-27T10:42:02+08:00
mainSha: d8379ed919424c50d04c3be92cd2ef671f5e4580
cwd: /workspace/openbot-gov-ratify

## Command: rg selectLegalPath|executeLegalPath outside packages/constitutional-contracts (src + extensions + other packages)

```

```

## Command: count of selectLegalPath|executeLegalPath under packages/constitutional-contracts only

```
packages/constitutional-contracts/README.md:6
packages/constitutional-contracts/src/runtime-facade/shadow.ts:4
packages/constitutional-contracts/src/legal-path/select.test.ts:7
packages/constitutional-contracts/src/legal-path/execute.test.ts:14
packages/constitutional-contracts/src/legal-path/execute.ts:4
packages/constitutional-contracts/src/legal-path/select.ts:1
packages/constitutional-contracts/src/index.ts:2
```

## Command: imports of constitutional-contracts from src (facades)

```
src/task-orchestration/constitutional-runtime-facade.test.ts:6:} from "../../packages/constitutional-contracts/src/index.js";
src/task-orchestration/constitutional-runtime-facade.test.ts:17:    expect(dispatch).not.toContain("constitutional-contracts");
src/task-orchestration/constitutional-runtime-facade.test.ts:19:    expect(hook).not.toContain("constitutional-contracts");
src/task-orchestration/constitutional-runtime-facade.ts:13:} from "../../packages/constitutional-contracts/src/index.js";
src/agents/execution-preflight/constitutional-runtime-facade.test.ts:3:import { CONSTITUTIONAL_SHADOW_ENV } from "../../../packages/constitutional-contracts/src/index.js";
src/agents/execution-preflight/constitutional-runtime-facade.test.ts:37:      expect(source).not.toContain("constitutional-contracts");
src/agents/execution-preflight/constitutional-runtime-facade.ts:12:} from "../../../packages/constitutional-contracts/src/index.js";
```

## Hot-path barrel exclusion checks (from tests / source strings)

```
src/task-orchestration/constitutional-runtime-facade.test.ts:6:} from "../../packages/constitutional-contracts/src/index.js";
src/task-orchestration/constitutional-runtime-facade.test.ts:17:    expect(dispatch).not.toContain("constitutional-contracts");
src/task-orchestration/constitutional-runtime-facade.test.ts:19:    expect(hook).not.toContain("constitutional-contracts");
src/agents/execution-preflight/constitutional-runtime-facade.test.ts:3:import { CONSTITUTIONAL_SHADOW_ENV } from "../../../packages/constitutional-contracts/src/index.js";
src/agents/execution-preflight/constitutional-runtime-facade.test.ts:37:      expect(source).not.toContain("constitutional-contracts");
```
