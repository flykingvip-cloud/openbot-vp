# Phase 1B Item 7 locator grant coverage (PR A)

This packet repairs the strict locator grant model. It does **not** delete production call-sites.

| Field                     | Value                             |
| ------------------------- | --------------------------------- |
| actorUserId               | current employee                  |
| grant.subjectId           | userId / seatId / groupId by kind |
| membership SoT            | platform-auth only                |
| seatId/groupId === userId | not required                      |
| item7                     | not-met                           |
| liveWriteWatchIndex       | 36                                |
| retiredThisChange         | 1 (S04 only)                      |
| live                      | forbidden                         |

Supported owner scopes: `user_owned`, `position_owned`, `group_owned`. `employee_private` is the existing user_owned classification. `unknown` stays blocked.

## Requested review

**Item 7 Locator Grant Coverage Review only.**
