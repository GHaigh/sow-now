/**
 * Sow Now Sensor Node — Configuration
 *
 * All build-time constants live here.  Ship-time provisioning writes the
 * AES key + node ID into ATtiny85 EEPROM via a dedicated provisioning sketch
 * (see tools/provision_node/provision_node.ino).
 */

#pragma once
#include <stdint.h>

// ── Node identity (overwritten during factory provisioning) ─────────────────
// These are fallback defaults only; real values come from EEPROM at boot.
#define DEFAULT_NODE_ID   0x01        // 1-byte node identifier (0x01-0xFE)
#define DEFAULT_NODE_TYPE 0x01        // 0x01=soil, 0x02=greenhouse

// ── LoRa radio (SX1276 on SPI) ───────────────────────────────────────────────
// ATtiny85 hardware SPI: SCK=PB2, MISO=PB1, MOSI=PB0
#define LORA_CS_PIN    3              // PB3 — chip select
#define LORA_RST_PIN   4              // PB4 — reset
// DIO0 / IRQ not used (polling TX-done flag instead to save pins)

#define LORA_FREQUENCY      868100000UL   // 868.1 MHz — EU868 ch0
#define LORA_TX_POWER       14            // dBm (max 17 on SX1276 PA_BOOST)
#define LORA_SPREADING_FACTOR 8           // SF8 — ~3 km range, low power
#define LORA_BANDWIDTH      125000UL      // 125 kHz
#define LORA_CODING_RATE    5             // 4/5
#define LORA_PREAMBLE       8

// ── Sensor pins ───────────────────────────────────────────────────────────────
#define SOIL_MOISTURE_PIN  A1             // PB2 / ADC1 — capacitive sensor
#define BATT_VOLTAGE_PIN   A3             // PB3 / ADC3 — voltage divider (10k/10k)
#define DS18B20_PIN        1              // PB1 — 1-Wire data (shared with LoRa MISO!)
// NOTE: DS18B20 is read BEFORE LoRa is activated; SPI disabled during read.

// ── Sensor calibration ────────────────────────────────────────────────────────
// Capacitive sensor: 0 = dry (ADC ~700), 100 = saturated (ADC ~300)
// Calibrate per-unit during provisioning and store offsets in EEPROM
#define MOISTURE_DRY_ADC   700
#define MOISTURE_WET_ADC   300

// Voltage divider: 10k / 10k → Vmeas = Vbatt / 2
// 3.3V reference → ADC 1023 = 3.3V → Vbatt = (ADC / 1023.0) * 3.3 * 2
#define BATT_ADC_VREF      3.3f
#define BATT_DIVIDER_RATIO 2.0f

// ── Sleep / timing ────────────────────────────────────────────────────────────
// ATtiny85 WDT max single sleep = 8s.  We chain 112 × 8s ≈ 15 minutes.
#define SLEEP_CYCLES       112            // 112 × 8s ≈ 896s ≈ 14.9 min

// ── EEPROM layout ─────────────────────────────────────────────────────────────
// Total EEPROM = 512 bytes on ATtiny85
#define EEPROM_MAGIC_ADDR       0         // 2 bytes: 0xB0, 0xBE (provisioned flag)
#define EEPROM_NODE_ID_ADDR     2         // 1 byte
#define EEPROM_NODE_TYPE_ADDR   3         // 1 byte
#define EEPROM_AES_KEY_ADDR     4         // 16 bytes (128-bit AES key)
#define EEPROM_MOISTURE_DRY_ADDR 20       // 2 bytes — calibration override
#define EEPROM_MOISTURE_WET_ADDR 22       // 2 bytes — calibration override
#define EEPROM_MAGIC_BYTE0      0xB0
#define EEPROM_MAGIC_BYTE1      0xBE

// ── Packet protocol ───────────────────────────────────────────────────────────
// Plaintext payload (16 bytes, before AES-128 CBC encryption):
//   [0]     node_id        (uint8)
//   [1]     node_type      (uint8)
//   [2-3]   temperature    (int16, °C × 10)  e.g. 215 = 21.5°C
//   [4-5]   soil_moisture  (uint16, % × 10)  e.g. 650 = 65.0%
//   [6-7]   battery_mv     (uint16, mV)       e.g. 3310 = 3.31V
//   [8-9]   counter        (uint16, rollover) — replay protection
//   [10-15] reserved / zero-pad
#define PACKET_SIZE 16
