import type { PlatformAccessory, Service } from 'homebridge'

import { Peripheral } from '@abandonware/noble'
import type { HomebridgePlatform } from './platform.js'

const REPORT_CHARACTERISTIC_UUID = '000102030405060708090a0b0c0d2b10'

export class TP357 {
  private tempService: Service
  private humidService: Service

  constructor(
    private readonly platform: HomebridgePlatform,
    private readonly accessory: PlatformAccessory,
    private readonly peripheral: Peripheral,
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

    const name = peripheral.advertisement.localName
      .replaceAll('(', '')
      .replaceAll(')', '')

    this.tempService.setCharacteristic(this.platform.Characteristic.Name, name)

    this.humidService =
      this.accessory.getService(this.platform.Service.HumiditySensor) ||
      this.accessory.addService(this.platform.Service.HumiditySensor)

    this.humidService.setCharacteristic(this.platform.Characteristic.Name, name)
  }

  async subscribe() {
    const { characteristics } =
      await this.peripheral.discoverSomeServicesAndCharacteristicsAsync(
        [],
        [REPORT_CHARACTERISTIC_UUID],
      )

    characteristics.map((c) => {
      c.on('data', (data) => {
        const temp = data.readUInt16LE(3) / 10.0
        const humid = data.readUInt8(5)
        if (temp > 50) {
          this.platform.log.warn(
            `Invalid data received from sensor (${humid}%,${temp}°C), ignoring.`,
          )
          return
        }

        this.platform.log.debug(`${humid}%,${temp}°C`)

        this.tempService.updateCharacteristic(
          this.platform.Characteristic.CurrentTemperature,
          temp,
        )

        this.humidService.updateCharacteristic(
          this.platform.Characteristic.CurrentRelativeHumidity,
          humid,
        )
      })

      c.subscribeAsync()
    })
  }

  async unsubscribe() {
    const { characteristics } =
      await this.peripheral.discoverSomeServicesAndCharacteristicsAsync(
        [],
        [REPORT_CHARACTERISTIC_UUID],
      )

    characteristics.map((c) => {
      c.unsubscribeAsync()
    })
  }
}
