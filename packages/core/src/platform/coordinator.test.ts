import { describe, expect, it } from 'vitest'
import { manualClock } from '../clock.ts'
import { newId } from '../ids.ts'
import { COORDINATOR_STATE_KEY, CoordinatorIdentityError, DeviceCoordinatorCore, type CoordinatorHost } from './coordinator.ts'

/** Durable storage that outlives any one DeviceCoordinatorCore, as Durable Object storage does. */
function memoryHost (): CoordinatorHost & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>()
  let alarm: number | null = null
  return {
    data,
    get: async <T>(key: string) => structuredClone(data.get(key)) as T | undefined,
    put: async (key, value) => { data.set(key, structuredClone(value)) },
    delete: async (key) => data.delete(key),
    getAlarm: async () => alarm,
    setAlarm: async (at) => { alarm = at },
    deleteAlarm: async () => { alarm = null },
  }
}

describe('DeviceCoordinatorCore', () => {
  it('creates its state on first use and returns the same state after', async () => {
    const clock = manualClock()
    const host = memoryHost()
    const dev = newId('dev')
    const first = await new DeviceCoordinatorCore(host, clock).snapshot(dev)
    expect(first).toEqual({
      state: { version: 1, deviceId: dev, createdAt: clock.now(), inFlight: null, lastAlarmAt: null, alarmCount: 0 },
      nextAlarmAt: null,
    })
    clock.advance(1000)
    expect(await new DeviceCoordinatorCore(host, clock).snapshot(dev)).toEqual(first)
  })

  it('refuses another device id and anything that is not a dev_ id', async () => {
    const host = memoryHost()
    const core = new DeviceCoordinatorCore(host, manualClock())
    await core.load(newId('dev'))
    await expect(core.load(newId('dev'))).rejects.toBeInstanceOf(CoordinatorIdentityError)
    await expect(core.load(newId('ctl') as never)).rejects.toBeInstanceOf(TypeError)
  })

  it('needs nothing in memory to continue after a restart: a new instance runs the scheduled alarm', async () => {
    const clock = manualClock()
    const host = memoryHost()
    const dev = newId('dev')
    await new DeviceCoordinatorCore(host, clock).scheduleAlarm(dev, clock.now() + 10_000)
    // The object is evicted: the old instance is gone and only storage remains.
    clock.advance(10_000)
    const restarted = new DeviceCoordinatorCore(host, clock)
    expect((await restarted.snapshot(dev)).nextAlarmAt).toBe(clock.now())
    await restarted.onAlarm()
    const after = await new DeviceCoordinatorCore(host, clock).snapshot(dev)
    expect(after.state.alarmCount).toBe(1)
    expect(after.state.lastAlarmAt).toBe(clock.now())
  })

  it('ignores an alarm when it never stored state', async () => {
    const host = memoryHost()
    await new DeviceCoordinatorCore(host, manualClock()).onAlarm()
    expect(host.data.has(COORDINATOR_STATE_KEY)).toBe(false)
  })

  it('rejects a non-finite alarm time', async () => {
    await expect(new DeviceCoordinatorCore(memoryHost(), manualClock()).scheduleAlarm(newId('dev'), Number.NaN)).rejects.toBeInstanceOf(RangeError)
  })
})
