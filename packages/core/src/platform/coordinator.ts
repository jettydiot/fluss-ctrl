// The Coordinator port (SPEC §7.2, §18 item 12, §21.3): one coordinator per device (`dev_…`)
// serialises that device's commands and drives verification from alarms. Phase 0 builds the
// skeleton only: durable state, the alarm hook and the identity check. The command state machine
// arrives in Phase 1, inside DeviceCoordinatorCore, so it runs on any CoordinatorHost.
//
// Rule (CLAUDE.md "Commands and safety"): nothing held in memory may be needed after a deploy.
// DeviceCoordinatorCore therefore has no fields but its host and clock; every read goes to storage.
import type { Clock } from '../clock.ts'
import { isId, type Id } from '../ids.ts'

/**
 * What a coordinator runs on: durable key-value storage plus one alarm. The Cloudflare adapter maps
 * it to Durable Object storage (apps/api/src/platform); a Postgres one can follow post-launch.
 * Values must survive structured cloning.
 */
export interface CoordinatorHost {
  get<T>(key: string): Promise<T | undefined>
  put(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<boolean>
  /** The pending alarm in milliseconds since the Unix epoch, or null. */
  getAlarm(): Promise<number | null>
  /** Replaces any pending alarm. */
  setAlarm(atMs: number): Promise<void>
  deleteAlarm(): Promise<void>
}

/** Bump when the stored shape changes, and migrate in `load`; never reinterpret old records. */
export const COORDINATOR_STATE_VERSION = 1

/** The durable record, under {@link COORDINATOR_STATE_KEY}. */
export interface CoordinatorState {
  readonly version: typeof COORDINATOR_STATE_VERSION
  readonly deviceId: Id<'dev'>
  /** When this coordinator first stored state, in milliseconds since the Unix epoch. */
  readonly createdAt: number
  /** Phase 1: the in-flight command. Always null in Phase 0. */
  readonly inFlight: null
  /** When the alarm hook last ran, or null. */
  readonly lastAlarmAt: number | null
  /** How many times the alarm hook has run. */
  readonly alarmCount: number
}

export const COORDINATOR_STATE_KEY = 'coordinator'

/** What `snapshot` returns: the stored state plus the pending alarm. */
export interface CoordinatorSnapshot {
  readonly state: CoordinatorState
  readonly nextAlarmAt: number | null
}

/** A handle on one device's coordinator. Phase 1 adds command submission. */
export interface DeviceCoordinatorHandle {
  snapshot(): Promise<CoordinatorSnapshot>
}

/** The port: resolves the coordinator for a device. */
export interface Coordinator {
  device(deviceId: Id<'dev'>): DeviceCoordinatorHandle
}

/** A coordinator was addressed with a different device id from the one it stored. */
export class CoordinatorIdentityError extends Error {
  constructor () {
    super('coordinator belongs to a different device')
    this.name = 'CoordinatorIdentityError'
  }
}

/** The coordinator's logic, independent of where it runs. Construct it per call; it holds nothing. */
export class DeviceCoordinatorCore {
  readonly #host: CoordinatorHost
  readonly #clock: Clock

  constructor (host: CoordinatorHost, clock: Clock) {
    this.#host = host
    this.#clock = clock
  }

  /** The stored state for `deviceId`, created on first use. Refuses a different device's id. */
  async load (deviceId: Id<'dev'>): Promise<CoordinatorState> {
    if (!isId(deviceId, 'dev')) throw new TypeError('expected a dev_ id')
    const stored = await this.#host.get<CoordinatorState>(COORDINATOR_STATE_KEY)
    if (stored) {
      if (stored.deviceId !== deviceId) throw new CoordinatorIdentityError()
      return stored
    }
    const state: CoordinatorState = {
      version: COORDINATOR_STATE_VERSION,
      deviceId,
      createdAt: this.#clock.now(),
      inFlight: null,
      lastAlarmAt: null,
      alarmCount: 0,
    }
    await this.#host.put(COORDINATOR_STATE_KEY, state)
    return state
  }

  async snapshot (deviceId: Id<'dev'>): Promise<CoordinatorSnapshot> {
    const state = await this.load(deviceId)
    return { state, nextAlarmAt: await this.#host.getAlarm() }
  }

  /** Schedules the alarm hook. Phase 1 calls this for send timeouts and confirm windows. */
  async scheduleAlarm (deviceId: Id<'dev'>, atMs: number): Promise<void> {
    if (!Number.isFinite(atMs)) throw new RangeError('alarm time must be finite')
    await this.load(deviceId)
    await this.#host.setAlarm(atMs)
  }

  /**
   * The alarm hook. The runtime calls it with no arguments after a restart, so the device id comes
   * from storage. An alarm on a coordinator that never stored state does nothing. Phase 1 resumes
   * verification of the in-flight command here.
   */
  async onAlarm (): Promise<void> {
    const stored = await this.#host.get<CoordinatorState>(COORDINATOR_STATE_KEY)
    if (!stored) return
    await this.#host.put(COORDINATOR_STATE_KEY, {
      ...stored,
      lastAlarmAt: this.#clock.now(),
      alarmCount: stored.alarmCount + 1,
    } satisfies CoordinatorState)
  }
}
