// Test ids in the SPEC §1 shape (`<prefix>_<UUIDv7>`). packages/db may not import packages/core
// (dependency-cruiser), so tests build their own.
import { randomBytes } from 'node:crypto'

let lastMs = 0
let seq = 0

/** `<prefix>_<UUIDv7>` for `ms` (default now). Ids made in one process sort in creation order. */
export function testId (prefix: string, ms?: number): string {
  let at = ms ?? Date.now()
  if (ms === undefined) {
    if (at <= lastMs) at = lastMs
    seq = at === lastMs ? seq + 1 : 0
    lastMs = at
  }
  const b = randomBytes(16)
  const high = Math.floor(at / 2 ** 16)
  b[0] = (high >>> 24) & 0xff
  b[1] = (high >>> 16) & 0xff
  b[2] = (high >>> 8) & 0xff
  b[3] = high & 0xff
  b[4] = (at >>> 8) & 0xff
  b[5] = at & 0xff
  const counter = ms === undefined ? seq & 0xfff : ((b[6]! << 8) | b[7]!) & 0xfff
  b[6] = 0x70 | (counter >>> 8)
  b[7] = counter & 0xff
  b[8] = 0x80 | (b[8]! & 0x3f)
  const h = b.toString('hex')
  return `${prefix}_${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}
