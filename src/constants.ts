import {EventConsumeStatus, EventPublishStatus} from '@resilientmq/core';

/** Internal status used while one publisher replica owns an outbox lease. */
export const OUTBOX_CLAIMED_STATUS = 'PUBLISHING';

/** Inbox statuses that may acquire a new lease without waiting for expiration. */
export const INBOX_RETRYABLE_STATUSES = [
    EventConsumeStatus.RECEIVED,
    EventConsumeStatus.RETRY
] as const;

/** Outbox statuses that may be published when their retry deadline has elapsed. */
export const OUTBOX_READY_STATUSES = [
    EventPublishStatus.PENDING,
    EventPublishStatus.ERROR
] as const;
