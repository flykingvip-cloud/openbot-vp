# grants.upsert

RPC：`user-operational-identity.grants.upsert`

```
identityId, agentId, agentScope ∈ {owned, shared, group}, grantMode ∈ {auto, explicit}
```

实现：`src/gateway/server-methods/user-operational-identity.ts`  
个人身份默认动作集来自 provider catalog 的 operationalActions（整包，无动作级勾选 UI）。
