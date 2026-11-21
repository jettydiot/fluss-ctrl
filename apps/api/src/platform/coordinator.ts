// Coordinator port: one DeviceCoordinator Durable Object per device, keyed by its `dev_…` id
// (SPEC §7.2, §18 item 12). The object only adapts Durable Object storage and alarms to
// DeviceCoordinatorCore in packages/core; the logic lives there. Phase 0 skeleton: no command logic.
import { DurableObject } from 'cloudflare:workers'
import { DeviceCoordinatorCore, systemClock, type Clock, type Coordinator, type CoordinatorHost, type CoordinatorSnapshot, type Id } from '@flussctrl/core'

/** Durable Object storage as a CoordinatorHost. Nothing is cached in memory. */
export function durableObjectHost (storage: DurableObjectStorage): CoordinatorHost {
  return {
    get: async <T>(key: string) => await storage.get<T>(key),
    put: async (key, value) => { await storage.put(key, value) },
    delete: async (key) => await storage.delete(key),
    getAlarm: async () => await storage.getAlarm(),
    setAlarm: async (atMs) => { await storage.setAlarm(atMs) },
    deleteAlarm: async () => { await storage.deleteAlarm() },
  }
}

/**
 * The Durable Object. Its class name and its id scheme (`idFromName(dev_…)`) are its storage
 * identity and cannot be renamed later (SPEC §18 item 12). It has no fields that matter after a
 * restart: each call builds a fresh DeviceCoordinatorCore over storage.
 */
export class DeviceCoordinator extends DurableObject {
  /** Overridable in tests only; production always uses the system clock. */
  protected clock: Clock = systemClock

  protected core (): DeviceCoordinatorCore {
    return new DeviceCoordinatorCore(durableObjectHost(this.ctx.storage), this.clock)
  }

  async snapshot (deviceId: Id<'dev'>): Promise<CoordinatorSnapshot> {
    return await this.core().snapshot(deviceId)
  }

  override async alarm (): Promise<void> {
    await this.core().onAlarm()
  }
}

export function durableCoordinator (
  namespace: DurableObjectNamespace<DeviceCoordinator>,
  locationHint: DurableObjectLocationHint
): Coordinator {
  return {
    device (deviceId) {
      const stub = () => namespace.get(namespace.idFromName(deviceId), { locationHint })
      return {
        snapshot: async () => await stub().snapshot(deviceId),
      }
    },
  }
}
