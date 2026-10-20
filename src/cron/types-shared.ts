export type CronJobBase<TSchedule, TSessionTarget, TWakeMode, TPayload, TDelivery, TFailureAlert> =
  {
    id: string;
    agentId?: string;
    sessionKey?: string;
    name: string;
    description?: string;
    enabled: boolean;
    deleteAfterRun?: boolean;
    createdAtMs: number;
    updatedAtMs: number;
    schedule: TSchedule;
    sessionTarget: TSessionTarget;
    wakeMode: TWakeMode;
    payload: TPayload;
    delivery?: TDelivery;
    failureAlert?: TFailureAlert;
    /**
     * Optional ConversationTask reference (EA-B4). Cron is a Wake Trigger;
     * this field may point at an existing task. It never mints identity.
     */
    conversationTaskId?: string;
    /**
     * Tenant/owner attribution (ops-decommission task 2.6). Stamped server-side
     * at creation from the authenticated session; never accepted from clients.
     * Absent = platform-global (visible to platform only).
     */
    ownership?: { tenantId?: string; ownerId?: string };
  };
