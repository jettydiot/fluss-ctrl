import { newId, type Id } from '@flussctrl/core'
import { env, evictDurableObject, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { DeviceCoordinator, durableCoordinator } from './coordinator.ts'

const stubFor = (deviceId: Id<'dev'>) => env.DEVICE_COORDINATOR.get(env.DEVICE_COORDINATOR.idFromName(deviceId))

describe('DeviceCoordinator Durable Object', () => {
  it('stores its state in Durable Object storage on first use', async () => {
    const dev = newId('dev')
    const snapshot = await durableCoordinator(env.DEVICE_COORDINATOR, 'enam').device(dev).snapshot()
    expect(snapshot.state).toMatchObject({ version: 1, deviceId: dev, inFlight: null, alarmCount: 0 })
    expect(snapshot.nextAlarmAt).toBeNull()
    await runInDurableObject(stubFor(dev), async (_instance: DeviceCoordinator, state) => {
      expect(await state.storage.get('coordinator')).toEqual(snapshot.state)
    })
  })

  it('refuses a call addressed with another device id', async () => {
    const dev = newId('dev')
    const stub = stubFor(dev)
    await stub.snapshot(dev)
    await expect((async () => await stub.snapshot(newId('dev')))()).rejects.toThrow('different device')
  })

  it('runs the alarm hook from storage alone after an eviction (restart)', async () => {
    const dev = newId('dev')
    const stub = stubFor(dev)
    const at = Date.now() + 60_000
    await runInDurableObject(stub, async (instance: DeviceCoordinator) => {
      await (instance as unknown as { core: () => { scheduleAlarm: (d: Id<'dev'>, t: number) => Promise<void> } }).core().scheduleAlarm(dev, at)
    })

    // Tear the instance down: in-memory state is gone, durable storage and the alarm remain.
    await evictDurableObject(stub)

    expect((await stub.snapshot(dev)).nextAlarmAt).toBe(at)
    expect(await runDurableObjectAlarm(stub)).toBe(true)

    await evictDurableObject(stub)
    const after = await stub.snapshot(dev)
    expect(after.state.alarmCount).toBe(1)
    expect(after.state.lastAlarmAt).not.toBeNull()
    expect(after.nextAlarmAt).toBeNull()
  })

  it('ignores an alarm on an object that never stored state', async () => {
    const stub = stubFor(newId('dev'))
    await runInDurableObject(stub, async (instance: DeviceCoordinator, state) => {
      await instance.alarm()
      expect(await state.storage.get('coordinator')).toBeUndefined()
    })
  })
})
