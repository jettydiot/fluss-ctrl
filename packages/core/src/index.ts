// Domain logic: Zod schemas, grant evaluation, command state machine, errors, HTTP client.
// The outbound HTTP client is a separate entry point: `@flussctrl/core/http`.
export const packageName = '@flussctrl/core'

export * from './clock.ts'
export { ApiError, ERROR_CODES, ERROR_DOCS_BASE, isErrorCode, problemDetails } from './errors.ts'
export type { ErrorCode, ProblemDetails, ProblemOptions } from './errors.ts'
export { createIdGenerator, ID_PREFIXES, idTimestamp, isId, newId } from './ids.ts'
export type { Id, IdGeneratorDeps, IdPrefix } from './ids.ts'
export * from './provider.ts'
export { REDACTED, redact, redactString } from './redact.ts'
export * from './platform/index.ts'
