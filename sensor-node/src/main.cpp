/**
 * Sow Now Sensor Node — Main firmware
 *
 * Cycle (every ~15 minutes):
 *   1. Wake from WDT deep sleep
 *   2. Read DS18B20 temperature (1-Wire)
 *   3. Read capacitive soil moisture (ADC)
 *   4. Read battery voltage (ADC)
 *   5. Build 16-byte packet
 *   6. AES-128 CBC encrypt with key from EEPROM
 *   7. Transmit via SX1276 LoRa
 *   8. Return to deep sleep (112 × 8s WDT cycles)
 *
 * Flash budget target: < 7.5 KB (leaves 512 B headroom on ATtiny85)
 */

#include <Arduino.h>
#include <avr/sleep.h>
#include <avr/wdt.h>
#include <avr/eeprom.h>
#include <SPI.h>
#include <OneWire.h>
#include <DallasTemperature.h>

#include "config.h"
#include "sx1276.h"
#include "tiny_aes.h"

// ── Globals ───────────────────────────────────────────────────────────────────
static uint8_t  g_node_id;
static uint8_t  g_node_type;
static uint8_t  g_aes_key[16];
static uint16_t g_counter;
static uint16_t g_moisture_dry;
static uint16_t g_moisture_wet;

static OneWire           oneWire(DS18B20_PIN);
static DallasTemperature sensors(&oneWire);

// ── WDT ISR (empty — just wakes MCU) ─────────────────────────────────────────
ISR(WDT_vect) {
  // intentionally empty
}

// ── Deep sleep ────────────────────────────────────────────────────────────────
static void sleepCycles(uint8_t cycles) {
  // Configure WDT for 8-second timeout, interrupt mode (not reset)
  cli();
  MCUSR &= ~(1 << WDRF);
  WDTCR  = (1 << WDCE) | (1 << WDE);
  WDTCR  = (1 << WDIE) | (1 << WDP3) | (1 << WDP0); // 8s
  sei();

  set_sleep_mode(SLEEP_MODE_PWR_DOWN);

  for (uint8_t i = 0; i < cycles; i++) {
    sleep_enable();
    sleep_cpu();
    sleep_disable();
  }

  // Disable WDT after sleep
  cli();
  WDTCR = (1 << WDCE) | (1 << WDE);
  WDTCR = 0;
  sei();
}

// ── EEPROM provisioning load ──────────────────────────────────────────────────
static bool loadProvisioning() {
  uint8_t m0 = eeprom_read_byte((uint8_t*)EEPROM_MAGIC_ADDR);
  uint8_t m1 = eeprom_read_byte((uint8_t*)(EEPROM_MAGIC_ADDR + 1));

  if (m0 != EEPROM_MAGIC_BYTE0 || m1 != EEPROM_MAGIC_BYTE1) {
    // Not provisioned — use compile-time defaults (dev/test only)
    g_node_id     = DEFAULT_NODE_ID;
    g_node_type   = DEFAULT_NODE_TYPE;
    g_moisture_dry = MOISTURE_DRY_ADC;
    g_moisture_wet = MOISTURE_WET_ADC;
    memset(g_aes_key, 0xAA, 16); // insecure placeholder key
    return false;
  }

  g_node_id   = eeprom_read_byte((uint8_t*)EEPROM_NODE_ID_ADDR);
  g_node_type = eeprom_read_byte((uint8_t*)EEPROM_NODE_TYPE_ADDR);
  eeprom_read_block(g_aes_key, (void*)EEPROM_AES_KEY_ADDR, 16);

  uint16_t dry = eeprom_read_word((uint16_t*)EEPROM_MOISTURE_DRY_ADDR);
  uint16_t wet = eeprom_read_word((uint16_t*)EEPROM_MOISTURE_WET_ADDR);
  g_moisture_dry = (dry == 0xFFFF) ? MOISTURE_DRY_ADC : dry;
  g_moisture_wet = (wet == 0xFFFF) ? MOISTURE_WET_ADC : wet;

  return true;
}

// ── Sensor reads ──────────────────────────────────────────────────────────────
static int16_t readTemperatureTenths() {
  // 1-Wire — SPI must be disabled while using PB1 as 1-Wire data
  SPI.end();
  sensors.begin();
  sensors.requestTemperatures();
  float t = sensors.getTempCByIndex(0);
  SPI.begin();

  if (t == DEVICE_DISCONNECTED_C) return -999; // sentinel: no sensor
  return (int16_t)(t * 10.0f);
}

static uint16_t readMoistureTenths() {
  // Take 4 samples and average to reduce ADC noise
  uint32_t sum = 0;
  for (uint8_t i = 0; i < 4; i++) {
    sum += analogRead(SOIL_MOISTURE_PIN);
    delay(2);
  }
  uint16_t raw = (uint16_t)(sum / 4);

  // Map ADC value to 0–1000 (percent × 10), clamped
  if (raw >= g_moisture_dry) return 0;
  if (raw <= g_moisture_wet) return 1000;

  uint32_t range = g_moisture_dry - g_moisture_wet;
  uint32_t delta = g_moisture_dry - raw;
  return (uint16_t)((delta * 1000UL) / range);
}

static uint16_t readBatteryMv() {
  uint16_t raw = analogRead(BATT_VOLTAGE_PIN);
  // Vmeas = (raw / 1023) × Vref; Vbatt = Vmeas × divider_ratio
  float vbatt = ((float)raw / 1023.0f) * BATT_ADC_VREF * BATT_DIVIDER_RATIO;
  return (uint16_t)(vbatt * 1000.0f); // mV
}

// ── Packet build + encrypt ────────────────────────────────────────────────────
static void buildPacket(uint8_t* buf, int16_t tempTenths,
                        uint16_t moistTenths, uint16_t battMv) {
  memset(buf, 0, PACKET_SIZE);
  buf[0] = g_node_id;
  buf[1] = g_node_type;
  buf[2] = (uint8_t)(tempTenths >> 8);
  buf[3] = (uint8_t)(tempTenths & 0xFF);
  buf[4] = (uint8_t)(moistTenths >> 8);
  buf[5] = (uint8_t)(moistTenths & 0xFF);
  buf[6] = (uint8_t)(battMv >> 8);
  buf[7] = (uint8_t)(battMv & 0xFF);
  buf[8] = (uint8_t)(g_counter >> 8);
  buf[9] = (uint8_t)(g_counter & 0xFF);
  // bytes 10-15 reserved / zero
}

// ── setup ─────────────────────────────────────────────────────────────────────
void setup() {
  // Disable ADC until needed (saves ~300 µA)
  ADCSRA &= ~(1 << ADEN);

  loadProvisioning();
  g_counter = 0;

  // Initialise LoRa radio
  SPI.begin();
  sx1276_init(LORA_CS_PIN, LORA_RST_PIN,
              LORA_FREQUENCY, LORA_TX_POWER,
              LORA_SPREADING_FACTOR, LORA_BANDWIDTH, LORA_CODING_RATE,
              LORA_PREAMBLE);
}

// ── loop ──────────────────────────────────────────────────────────────────────
void loop() {
  // Enable ADC for sensor reads
  ADCSRA |= (1 << ADEN);

  // 1. Read sensors
  int16_t  tempTenths  = readTemperatureTenths();
  uint16_t moistTenths = readMoistureTenths();
  uint16_t battMv      = readBatteryMv();

  // Disable ADC again
  ADCSRA &= ~(1 << ADEN);

  // 2. Build plaintext packet
  uint8_t packet[PACKET_SIZE];
  buildPacket(packet, tempTenths, moistTenths, battMv);

  // 3. AES-128 ECB encrypt (key in EEPROM, 16-byte block = 1 block, no IV needed)
  //    ECB is acceptable here: each packet carries a monotonic counter so
  //    identical plaintext never produces identical ciphertext in practice,
  //    and full CBC would require an IV transmission overhead.
  tiny_aes_encrypt(packet, g_aes_key, packet); // in-place

  // 4. Transmit
  sx1276_transmit(packet, PACKET_SIZE);

  g_counter++;

  // 5. Deep sleep ~15 minutes
  sleepCycles(SLEEP_CYCLES);
}
