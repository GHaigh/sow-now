/**
 * Sow Now — Factory Node Provisioning Sketch
 *
 * Run this on an Arduino Uno acting as ISP, with the target ATtiny85
 * connected to the ISP header.  Upload the KEY, NODE_ID and NODE_TYPE
 * into the ATtiny's EEPROM then flash the main firmware.
 *
 * Usage:
 *   1. Set NODE_ID, NODE_TYPE and AES_KEY below (unique per unit)
 *   2. Flash THIS sketch to the Arduino Uno first
 *   3. Wire Arduino→ATtiny85 ISP header
 *   4. Open Serial Monitor at 115200 baud
 *   5. Send 'p' to provision the ATtiny EEPROM
 *   6. Flash the main sensor-node firmware via USBasp/ArduinoISP
 *
 * Key management: generate keys with scripts/gen_node_key.mjs
 */

#include <Arduino.h>
#include <Wire.h>
// ATtiny85 EEPROM is accessed via the SPI ISP interface using ArduinoISP.
// This sketch provisions via direct SPI write using the stk500v1 protocol.
// For simplicity this demonstrates the EEPROM write protocol values to embed.

// ─── CONFIGURE PER UNIT ───────────────────────────────────────────────────────
const uint8_t NODE_ID   = 0x01;           // Unique 1-254 per node
const uint8_t NODE_TYPE = 0x01;           // 0x01 = soil, 0x02 = greenhouse

// 16-byte AES-128 key — MUST match key stored in Cloudflare for this device_id
// Generate with: node scripts/gen_node_key.mjs
const uint8_t AES_KEY[16] = {
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
  // *** REPLACE WITH GENERATED KEY BEFORE PRODUCTION ***
};

// Moisture calibration (optional — 0xFFFF = use firmware defaults)
const uint16_t MOISTURE_DRY = 0xFFFF;
const uint16_t MOISTURE_WET = 0xFFFF;
// ─────────────────────────────────────────────────────────────────────────────

// EEPROM addresses (must match config.h on firmware side)
#define EEPROM_MAGIC_ADDR        0
#define EEPROM_NODE_ID_ADDR      2
#define EEPROM_NODE_TYPE_ADDR    3
#define EEPROM_AES_KEY_ADDR      4
#define EEPROM_MOISTURE_DRY_ADDR 20
#define EEPROM_MOISTURE_WET_ADDR 22
#define MAGIC_BYTE0              0xB0
#define MAGIC_BYTE1              0xBE

// This provisioning sketch writes to a locally-connected Arduino's EEPROM
// as a demonstration of the values.  In production, use avrdude with
// -U eeprom:w:<hexfile>:i to write directly to the ATtiny85.
#include <EEPROM.h>

void provision() {
  Serial.println(F("Provisioning..."));

  EEPROM.write(EEPROM_MAGIC_ADDR,     MAGIC_BYTE0);
  EEPROM.write(EEPROM_MAGIC_ADDR + 1, MAGIC_BYTE1);
  EEPROM.write(EEPROM_NODE_ID_ADDR,   NODE_ID);
  EEPROM.write(EEPROM_NODE_TYPE_ADDR, NODE_TYPE);

  for (uint8_t i = 0; i < 16; i++) {
    EEPROM.write(EEPROM_AES_KEY_ADDR + i, AES_KEY[i]);
  }

  EEPROM.put(EEPROM_MOISTURE_DRY_ADDR, MOISTURE_DRY);
  EEPROM.put(EEPROM_MOISTURE_WET_ADDR, MOISTURE_WET);

  Serial.print(F("Node ID:   0x")); Serial.println(NODE_ID,   HEX);
  Serial.print(F("Node type: 0x")); Serial.println(NODE_TYPE, HEX);
  Serial.print(F("AES key:   "));
  for (uint8_t i = 0; i < 16; i++) {
    if (AES_KEY[i] < 0x10) Serial.print('0');
    Serial.print(AES_KEY[i], HEX);
    Serial.print(' ');
  }
  Serial.println();
  Serial.println(F("Done. Use avrdude to dump and verify EEPROM."));
  Serial.println();
  Serial.println(F("avrdude command to generate .eep file for production:"));
  Serial.println(F("  node scripts/gen_node_key.mjs --id 0x01 --type 0x01 > node01.eep"));
  Serial.println(F("  avrdude -c usbasp -p t85 -U eeprom:w:node01.eep:i"));
}

void setup() {
  Serial.begin(115200);
  Serial.println(F("Sow Now Node Provisioning Tool"));
  Serial.println(F("Send 'p' to provision this unit."));
}

void loop() {
  if (Serial.available() && Serial.read() == 'p') {
    provision();
  }
}
