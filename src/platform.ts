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
import { TP357, TP357Context } from './platformAccessory.js'
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
  public readonly accessories: Map<string, PlatformAccessory<TP357Context>> =
    new Map()
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
      log.debug('Executed didFinishLaunching callback')
      this.discoverDevices()
    })
  }

  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to set up event handlers for characteristics and update respective values.
   */
  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName)

    // add the restored accessory to the accessories cache, so we can track if it has already been registered
    this.accessories.set(
      accessory.UUID,
      accessory as PlatformAccessory<TP357Context>,
    )
  }

  discoverDevices() {
    // EXAMPLE ONLY
    // A real plugin you would discover accessories from the local network, cloud services
    // or a user-defined array in the platform config.
    const TP357_NAME = 'TP357 (C2F4)'

    noble.on('stateChange', async (state) => {
      if (state === 'poweredOn') {
        await noble.startScanning([], false)
      }
    })

    noble.on('discover', async (peripheral) => {
      if (peripheral.advertisement.localName === TP357_NAME) {
        await noble.stopScanningAsync()
        await peripheral.connectAsync()

        const uuid = this.api.hap.uuid.generate(peripheral.id)
        const existingAccessory = this.accessories.get(uuid)

        if (existingAccessory) {
          this.log.info(
            'Restoring existing accessory from cache:',
            existingAccessory.displayName,
          )

          // if you need to update the accessory.context then you should run `api.updatePlatformAccessories`. e.g.:
          // existingAccessory.context.device = device;
          // this.api.updatePlatformAccessories([existingAccessory]);

          // create the accessory handler for the restored accessory
          // this is imported from `platformAccessory.ts`
          new TP357(this, existingAccessory)

          // it is possible to remove platform accessories at any time using `api.unregisterPlatformAccessories`, e.g.:
          // remove platform accessories when no longer present
          // this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existingAccessory]);
          // this.log.info('Removing existing accessory from cache:', existingAccessory.displayName);
        } else {
          this.log.info(
            'Adding new accessory:',
            peripheral.advertisement.localName,
          )

          const accessory = new this.api.platformAccessory<TP357Context>(
            peripheral.advertisement.localName,
            uuid,
          )
          const { characteristics } =
            await peripheral.discoverSomeServicesAndCharacteristicsAsync([], [])

          accessory.context.peripheral = peripheral
          accessory.context.characteristics = characteristics

          new TP357(this, accessory)
          this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [
            accessory,
          ])
        }

        this.discoveredCacheUUIDs.push(uuid)
      }
    })
  }
}
