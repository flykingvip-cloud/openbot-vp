# Individual and collaboration orchestration

## Architecture decision

One runtime system with shared work-item execution, separate individual and collaboration orchestration. A scenario rule chooses an existing orchestration context; it does not grant authorization or replace the domain lifecycle. Do not build two complete runtimes or one giant mode-switched controller.

| Concern       | Individual owner                     | Collaboration owner                           | Shared boundary                                          |
| ------------- | ------------------------------------ | --------------------------------------------- | -------------------------------------------------------- |
| Goal/plan     | session task and accepted amendments | shared claim contract + owner private plan    | identity and result data contracts, not one merged table |
| Dispatch      | next allowed task action             | claim, member dependencies and confirmed plan | original work-item model/tool execution                  |
| Authorization | user and task scope                  | actor/role/claim/confirmation scope           | mandatory permission enforcement                         |
| Acceptance    | individual goal evidence             | submission, review, integration and version   | validators and artifact evidence                         |
| Stop/recovery | named task/run                       | member/item/group scope                       | cancellation primitives and stale-event guards           |
| Delivery      | user result                          | member submission then group delivery         | transport and artifact services                          |

The shared executor accepts an already-admitted work item and returns evidence, failure or wait receipt. It cannot confirm a private plan, close a group contract, or infer that a member result is final group delivery. Existing SessionTaskBoard, ClaimContract and ExecutorPrivateTodolist remain separate bounded contexts.

## First code checkpoint

Existing shouldUseCollaborationRuntimeAssembly, isCollaborationGroupRuntimeSession and resolveCollaborationGroupIdForRun moved unchanged into command/scenarios/collaboration-entry.ts, exposed by command/index. This is existing metadata routing, not a new semantic classifier. The original adapter retains workspace/profile resolution and side effects; get-reply's existing mock/consumer path remains compatible.

A collaboration round marker alone is insufficient without a nonblank group ID. Matching profile/group/space metadata selects collaboration assembly only; all actor/claim/plan ACL checks remain in their original domain. Scope DTO contains only routing fields and no credentials or mutable plan state.

## Remaining work

- Define accepted work-item execution contracts using trusted task/claim/attempt identities, with separate adapters for individual and collaboration lifecycle.
- Preserve original model-driven step generation; planning initially owns goals/acceptance/skeleton rather than a competing loop.
- Verify stop scope and member submission/acceptance before consolidating corresponding ports.
- Shared execution main entry and general task delivery are still incomplete; do not claim scenario routing extraction completes either orchestration.
