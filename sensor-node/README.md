# Sow Now — Sensor Node Firmware

ATtiny85-based LoRa sensor node for soil moisture, temperature and battery voltage.

## Hardware Bill of Materials (per node)

| Part | Description | Approx Cost |
|------|-------------|-------------|
| ATtiny85-20PU | 8-bit MCU, 8KB flash, 512B SRAM | £0.80 |
| HopeRF RFM95W | SX1276-based LoRa module, 868 MHz | £3.50 |
| Capacitive soil moisture sensor | 3.3V, ADC output | £1.20 |
| DS18B20 | Waterproof temperature probe | £1.50 |
| 18650 Li-ion + TP4056 charger | Battery + charge controller | £2.00 |
| 10k resistors ×2 | Battery voltage divider | £0.05 |
| 4.7k resistor | DS18B20 pull-up | £0.02 |
| PCB / stripboard + enclosure | — | £1.00 |
| **Total** | | **~£10** |

## Wiring

```
ATtiny85 DIP-8 pinout:

         ┌──────┐
  RST  1 │      │ 8  VCC (3.3V)
  PB3  2 │      │ 7  PB2 / SCK
  PB4  3 │      │ 6  PB1 / MISO   ← DS18B20 data (when SPI inactive)
  GND  4 │      │ 5  PB0 / MOSI
         └──────┘

LoRa (SX1276 / RFM95W):
  SCK  → PB2 (pin 7)
  MISO → PB1 (pin 6)
  MOSI → PB0 (pin 5)
  CS   → PB3 (pin 2)  [LORA_CS_PIN in config.h]
  RST  → PB4 (pin 3)  [LORA_RST_PIN in config.h]
  3.3V → VCC
  GND  → GND

DS18B20 (read BEFORE SPI starts each cycle):
  DATA → PB1 (pin 6) via 4.7kΩ pull-up to VCC

Capacitive moisture sensor:
  AOUT → PB2/ADC1 (pin 7) — via 100Ω series resistor

Battery voltage divider:
  Vbatt ─── 10kΩ ─── PB3/ADC3 ─── 10kΩ ─── GND
```

**Important**: DS18B20 shares PB1/MISO with the LoRa SPI bus. The firmware
disables SPI (`SPI.end()`) before each DS18B20 read, then re-enables it.

## Building

```bash
cd sensor-node
pio run -e attiny85
```

Flash with USBasp:
```bash
pio run -e attiny85 --target upload
```

Flash with Arduino as ISP:
```bash
pio run -e attiny85_isp --target upload
```

## Factory Provisioning

Each node must be provisioned before first use:

1. Generate a unique AES-128 key for this node:
   ```bash
   node scripts/gen_node_key.mjs --id 0x01 --type 0x01
   ```

2. Flash the EEPROM:
   ```bash
   avrdude -c usbasp -p t85 -U eeprom:w:scripts/output/node_0x01.eep:i
   ```

3. Register the key in the database:
   ```bash
   wrangler d1 execute vernal-db \
     --command "UPDATE devices SET lora_aes_key='<hex key>' WHERE node_id=1"
   ```

4. Flash the main firmware:
   ```bash
   cd sensor-node && pio run -e attiny85 --target upload
   ```

## Packet Format

Plaintext (16 bytes, AES-128 ECB encrypted before TX):

| Byte | Field | Type | Notes |
|------|-------|------|-------|
| 0 | node_id | uint8 | 1–254 |
| 1 | node_type | uint8 | 0x01=soil, 0x02=greenhouse |
| 2–3 | temperature | int16 BE | °C × 10 (e.g. 215 = 21.5°C) |
| 4–5 | soil_moisture | uint16 BE | % × 10 (e.g. 650 = 65.0%) |
| 6–7 | battery_mv | uint16 BE | mV (e.g. 3310 = 3.31V) |
| 8–9 | counter | uint16 BE | monotonic, replay protection |
| 10–15 | reserved | — | zero-padded |

## Sleep / Power Budget

| Phase | Current | Duration | µAh |
|-------|---------|----------|-----|
| Deep sleep (WDT) | ~6 µA | 880s | ~1.5 |
| DS18B20 read | ~1.5 mA | 750ms | ~0.3 |
| ADC reads | ~300 µA | 20ms | ~0.002 |
| LoRa TX SF8/125kHz | ~120 mA | 300ms | ~10 |
| **Total per cycle** | | ~900s | **~12 µAh** |

**Battery life estimate** (2000 mAh 18650, 70% usable):
- 1400 mAh ÷ 12 µAh/cycle × 900s/cycle ÷ 3600 ≈ **29 000 hours ≈ 3.3 years**

## Node Types

| node_type | Sensor | Recommended placement |
|-----------|--------|----------------------|
| `0x01` | Soil moisture + DS18B20 | Buried 5–10 cm in growing bed |
| `0x02` | DS18B20 air temp only | Greenhouse interior, shaded |
