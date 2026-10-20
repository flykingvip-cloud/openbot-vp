# Graph-style ExecutionBackend for AOR

LangGraph-compatible **linear node pipeline** backend. Implements `ExecutionBackend` with zero OpenBot dependency.

Used to validate that AOR Orchestrator can target graph orchestrators beyond OpenBot and the Stage 3 stub.

```typescript
import { createGraphExecutionBackend } from "@openbot/aor-backend-graph";
```
