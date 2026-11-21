// Allowed values for the text + CHECK columns (SPEC §1–§8). Phase 0–1 only (SPEC §0): values that
// arrive with a later phase (`lock`/`unlock`, emergency states) are added by that phase's migration.

export const REGIONS = ['za', 'us'] as const
export const ORG_STATUSES = ['trial', 'active', 'overdue', 'read_only', 'suspended', 'churned'] as const
export const CLIENT_ENVS = ['live', 'sandbox'] as const
export const CLIENT_STATUSES = ['active', 'disabled'] as const
export const MEMBER_ROLES = ['owner', 'admin', 'developer', 'viewer'] as const
export const CHANNEL_ROLES = ['main', 'pedestrian', 'switch', 'other'] as const
export const DEVICE_KINDS = ['gate', 'boom', 'door', 'garage', 'turnstile', 'pedestrian_gate', 'other'] as const
export const GRANT_TYPES = ['full_access', 'permanent', 'time_window', 'recurring', 'count_limited', 'tenant_access'] as const
export const GRANT_STATUSES = ['active', 'scheduled', 'expired', 'exhausted', 'revoked'] as const
export const COMMAND_ACTIONS = ['trigger', 'open', 'close'] as const
export const COMMAND_STATES = ['queued', 'sent', 'acked', 'confirmed', 'unconfirmed', 'unverified', 'timed_out', 'rejected', 'failed'] as const
export const VERIFICATION_LEVELS = ['none', 'ack', 'status'] as const
export const EVENT_METHODS = ['api', 'app', 'pin', 'card', 'remote', 'intercom', 'plate', 'wiegand', 'manual', 'unknown'] as const
export const EVENT_RESULTS = ['ok', 'denied', 'error', 'unknown'] as const
export const WEBHOOK_ENDPOINT_STATUSES = ['active', 'disabled'] as const
export const WEBHOOK_DELIVERY_STATUSES = ['pending', 'queued', 'delivered', 'failed', 'dead'] as const
export const AUDIT_ACTOR_TYPES = ['client', 'member', 'ops', 'system'] as const
