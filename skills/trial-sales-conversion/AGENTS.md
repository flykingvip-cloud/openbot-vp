# trial-sales-conversion

Skill package for **trial sales conversion digital humans**.

- Load `SKILL.md` as the primary playbook when this skill is attached to a seat/agent.
- Use `references/attributes-and-cadence.md` for field maps, segment rules, and cadence tables.
- Prefer gateway RPC `enterprise.customer-attributes.get` for live attributes (schema v1).
- Do not implement platform-side ops products from this skill; execute as the assigned agent only.
