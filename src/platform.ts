import noble from '@abandonware/noble'
import type {
  API,
  Characteristic,
  DynamicPlatformPlugin,
  Logging,
  PlatformAccessory,
  PlatformConfig,
  Service,
} from 'homebridge'
import { TP357 } from './platformAccessory.js'
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js'

/**
 * HomebridgePlatform
 *
 * Devices are never connected to: the TP357 broadcasts its readings in its
 * BLE advertisements, so we only listen to them (like the ThermoPro app's
 * home screen does). Keeping a GATT connection open forces the thermometer
 * to wake its radio for every connection event and drains its battery.
 */
export class HomebridgePlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service
  public readonly Characteristic: typeof Characteristic

  // this is used to track restored cached accessories
  public readonly accessories: Map<string, PlatformAccessory> = new Map()

  // devices currently handled, by accessory UUID
  private readonly devices: Map<string, TP357> = new Map()
  private readonly reportedUnconfigured: Set<string> = new Set()

  constructor(
    public readonly log: Logging,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.Service = api.hap.Service
    this.Characteristic = api.hap.Characteristic

    this.log.debug('Finished initializing platform:', this.config.name)

    this.api.on('didFinishLaunching', () => {
      this.log.debug('Executed didFinishLaunching callback')
      this.removeUnconfiguredAccessories()
      this.discoverDevices()
    })

    this.api.on('shutdown', () => {
      noble.stopScanning()
    })

    noble.on('warning', (message: string) => {
      this.log.warn(`noble warning: ${message}`)
    })
  }

  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   */
  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName)
    this.accessories.set(accessory.UUID, accessory)
  }

  private removeUnconfiguredAccessories() {
    for (const [uuid, accessory] of this.accessories) {
      if (!this.shouldDeviceBePaired(accessory.displayName)) {
        this.log.info(
          `Unregistering cached accessory ${accessory.displayName} that isn't in the config.`,
        )
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [
          accessory,
        ])
        this.accessories.delete(uuid)
      }
    }
  }

  discoverDevices() {
    this.log.debug('Discovering devices...')

    const startScanning = (state: string) => {
      if (state === 'poweredOn') {
        this.log.debug('Powered on, starting scanning...')
        // allowDuplicates: the reading is in the advertisement itself, so we
        // need every advertisement, not only the first one per device.
        noble.startScanning([], true)
        this.log.info(
          'Looking for devices with names: ',
          this.config.devices_name,
        )
      } else {
        this.log.debug(`Noble state changed to ${state}`)
      }
    }

    noble.on('stateChange', startScanning)
    // The adapter may already be powered on before we registered the listener.
    if (noble._state === 'poweredOn') {
      startScanning(noble._state)
    }

    noble.on('discover', (peripheral) => {
      const uuid = this.api.hap.uuid.generate(peripheral.id)
      const { localName: deviceName, manufacturerData } =
        peripheral.advertisement

      let device = this.devices.get(uuid)

      if (!device) {
        if (!deviceName) {
          return
        }

        if (!this.shouldDeviceBePaired(deviceName)) {
          if (
            deviceName.includes('TP357') &&
            !this.reportedUnconfigured.has(uuid)
          ) {
            this.reportedUnconfigured.add(uuid)
            this.log.info(
              `Found a TP357 device named '${deviceName}', include it in the config to pair it with the plugin.`,
            )
          }
          return
        }

        let accessory = this.accessories.get(uuid)
        if (accessory) {
          this.log.info('Restoring existing accessory from cache:', deviceName)
          device = new TP357(this, accessory, deviceName)
        } else {
          this.log.info('Adding new accessory:', deviceName)
          accessory = new this.api.platformAccessory(deviceName, uuid)
          device = new TP357(this, accessory, deviceName)
          this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [
            accessory,
          ])
          this.accessories.set(uuid, accessory)
        }
        this.devices.set(uuid, device)
      }

      device.handleAdvertisement(manufacturerData)
    })
  }

  private shouldDeviceBePaired(deviceName: string) {
    return (this.config.devices_name ?? []).includes(deviceName)
  }
}
