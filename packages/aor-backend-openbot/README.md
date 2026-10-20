# @openbot/aor-backend-openbot

The **OpenBot** implementation of the AOR `ExecutionBackend`.

It couples to OpenBot only through its **public** contract (the
OpenAI-compatible `/v1/chat/completions` HTTP endpoint, or an injected
gateway client). It never imports OpenBot internal modules, so AOR upgrades
independently of OpenBot's runtime.

## Usage

```ts
import { OpenAiCompatGatewayClient, OpenBotBackend } from "@openbot/aor-backend-openbot";

const client = new OpenAiCompatGatewayClient({ baseUrl: "http://127.0.0.1:18789" });
const backend = new OpenBotBackend({ client });
```

Runtime model fallback/retry remains OpenBot's responsibility (its native
`runWithModelFallback`); this backend only executes the model the Selector
chose.
