import type { PlatformAccessory, Service } from 'homebridge'

import type { HomebridgePlatform } from './platform.js'

export interface Reading {
  temperature: number
  humidity: number
}

/**
 * Decode a reading from the manufacturer data of a TP357 advertisement.
 *
 * The TP357 broadcasts its current reading in every BLE advertisement, so
 * there is no need to open a GATT connection (which keeps the radio of the
 * thermometer awake and drains its battery quickly).
 *
 * Layout of the manufacturer data (as exposed by noble, i.e. including the
 * two "company identifier" bytes, which the TP357 uses for its payload):
 *   byte 0     : header
 *   bytes 1-2  : temperature, signed int16 little-endian, in tenths of °C
 *   byte 3     : relative humidity, in %
 */
export function parseAdvertisement(data: Buffer | undefined): Reading | null {
  if (!data || data.length < 4) {
    return null
  }

  return {
    temperature: data.readInt16LE(1) / 10.0,
    humidity: data.readUInt8(3),
  }
}

export class TP357 {
  private tempService: Service
  private humidService: Service
  private lastReading: Reading | null = null

  constructor(
    private readonly platform: HomebridgePlatform,
    private readonly accessory: PlatformAccessory,
    deviceName: string,
  ) {
    this.accessory
      .getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'ThermPro')
      .setCharacteristic(this.platform.Characteristic.Model, 'TP357')
      .setCharacteristic(
        this.platform.Characteristic.SerialNumber,
        'Default-Serial',
      )

    this.tempService =
      this.accessory.getService(this.platform.Service.TemperatureSensor) ||
      this.accessory.addService(this.platform.Service.TemperatureSensor)

    const name = deviceName.replaceAll('(', '').replaceAll(')', '')

    this.tempService.setCharacteristic(this.platform.Characteristic.Name, name)

    this.humidService =
      this.accessory.getService(this.platform.Service.HumiditySensor) ||
      this.accessory.addService(this.platform.Service.HumiditySensor)

    this.humidService.setCharacteristic(this.platform.Characteristic.Name, name)
  }

  handleAdvertisement(manufacturerData: Buffer | undefined) {
    const reading = parseAdvertisement(manufacturerData)
    if (!reading) {
      return
    }

    const { temperature, humidity } = reading
    // The TP357 measures from -20°C to 60°C and 10% to 99% RH.
    if (
      temperature < -40 ||
      temperature > 70 ||
      humidity < 0 ||
      humidity > 100
    ) {
      this.platform.log.debug(
        `Ignoring invalid data from ${this.accessory.displayName} ` +
          `(${humidity}%, ${temperature}°C, raw ${manufacturerData?.toString('hex')})`,
      )
      return
    }

    if (
      this.lastReading?.temperature === temperature &&
      this.lastReading?.humidity === humidity
    ) {
      return
    }
    this.lastReading = reading

    this.platform.log.debug(
      `${this.accessory.displayName}: ${humidity}%, ${temperature}°C ` +
        `(raw ${manufacturerData?.toString('hex')})`,
    )

    this.tempService.updateCharacteristic(
      this.platform.Characteristic.CurrentTemperature,
      temperature,
    )

    this.humidService.updateCharacteristic(
      this.platform.Characteristic.CurrentRelativeHumidity,
      humidity,
    )
  }
}
