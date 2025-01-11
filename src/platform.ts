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
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class HomebridgePlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service
  public readonly Characteristic: typeof Characteristic

  // this is used to track restored cached accessories
  public readonly accessories: Map<string, PlatformAccessory> = new Map()
  public readonly discoveredCacheUUIDs: string[] = []

  constructor(
    public readonly log: Logging,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.Service = api.hap.Service
    this.Characteristic = api.hap.Characteristic

    this.log.debug('Finished initializing platform:', this.config.name)

    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already. This event can also be used
    // to start discovery of new accessories.
    this.api.on('didFinishLaunching', () => {
      this.log.debug('Executed didFinishLaunching callback')
      this.discoverDevices()
    })

    noble.on('warning', (message: string) => {
      this.log.warn(`noble warning: ${message}`)
    })
  }

  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to set up event handlers for characteristics and update respective values.
   */
  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName)

    // add the restored accessory to the accessories cache, so we can track if it has already been registered
    this.accessories.set(accessory.UUID, accessory)
  }

  discoverDevices() {
    this.log.debug('Discovering devices...')
    noble.on('stateChange', (state) => {
      if (state === 'poweredOn') {
        this.log.debug('Powered on, starting scanning...')
        noble.startScanning([], false)
        this.log.info(
          'Looking for devices with names: ',
          this.config.devices_name,
        )
      } else {
        this.log.debug(`Noble state changed to ${state}`)
      }
    })

    noble.on('discover', async (peripheral) => {
      const deviceName = peripheral.advertisement.localName
      const uuid = this.api.hap.uuid.generate(peripheral.id)
      const existingAccessory = this.accessories.get(uuid)

      if (existingAccessory) {
        await peripheral.connectAsync()
        const tp357 = new TP357(this, existingAccessory, peripheral)

        if (this.shouldDeviceBePaired(deviceName)) {
          this.log.info(
            'Restoring existing accessory from cache:',
            existingAccessory.displayName,
          )
          tp357.subscribe()
        } else {
          this.log.info(
            `Unregistering cached accessory ${deviceName} that isn't in the config.`,
          )
          this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [
            existingAccessory,
          ])

          tp357.unsubscribe()
        }
      } else {
        if (!this.shouldDeviceBePaired(deviceName)) {
          if (
            deviceName &&
            deviceName.includes('TP357') &&
            !existingAccessory
          ) {
            this.log.info(
              `Found a TP357 device named '${deviceName}', include it in the config to pair it with the plugin.`,
            )
          }
          return
        }
        await peripheral.connectAsync()
        this.log.info('Adding new accessory:', deviceName)

        const accessory = new this.api.platformAccessory(deviceName, uuid)

        new TP357(this, accessory, peripheral).subscribe()

        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [
          accessory,
        ])
      }

      this.discoveredCacheUUIDs.push(uuid)
    })
  }

  private shouldDeviceBePaired(deviceName: string) {
    return this.config.devices_name.includes(deviceName)
  }
}
