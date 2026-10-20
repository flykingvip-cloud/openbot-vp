# Enterprise Startup Stability

- Enterprise and platform sessions without an enterprise tenant must not issue employee tenant-scoped directory requests during gateway startup.
- Employee sessions with a resolved enterprise tenant must continue loading the organization bot directory.
- A skipped preload must preserve the last successfully loaded directory.
