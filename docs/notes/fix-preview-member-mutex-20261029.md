# fix-preview-member-mutex-20261029

Restore collaboration preview mutual exclusion (成果/电脑 vs 成员管理) and treat
owner/admin `governanceRole` as writable for invite/edit.

- Mutex: closing member governance must close any open preview sidebar including
  `sidebarSurface === "computer"` (not only artifact previewMode).
- Writable: resolve actor role from memberRoleMap `governanceRole` and
  `adminUserIds`, not only ownerUserId string match; keep #138 human: alignment.
