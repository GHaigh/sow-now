/**
 * SX1276 LoRa driver — minimal TX-only implementation
 *
 * Designed for ATtiny85 flash budget.  Supports:
 *   - Explicit header mode
 *   - Single-packet TX with polling TxDone flag (no IRQ pin required)
 *   - EU868 frequency range
 *
 * Connections (ATtiny85 hardware SPI):
 *   SCK   → PB2 (pin 7)
 *   MISO  → PB1 (pin 6)
 *   MOSI  → PB0 (pin 5)
 *   CS    → PB3 (pin 2) — configurable
 *   RESET → PB4 (pin 3) — configurable
 */

#pragma once
#include <Arduino.h>
#include <SPI.h>

// ── Register map ──────────────────────────────────────────────────────────────
#define REG_FIFO            0x00
#define REG_OP_MODE         0x01
#define REG_FRF_MSB         0x06
#define REG_FRF_MID         0x07
#define REG_FRF_LSB         0x08
#define REG_PA_CONFIG       0x09
#define REG_LNA             0x0C
#define REG_FIFO_ADDR_PTR   0x0D
#define REG_FIFO_TX_BASE    0x0E
#define REG_IRQ_FLAGS       0x12
#define REG_PAYLOAD_LENGTH  0x22
#define REG_MODEM_CONFIG1   0x1D
#define REG_MODEM_CONFIG2   0x1E
#define REG_MODEM_CONFIG3   0x26
#define REG_PREAMBLE_MSB    0x20
#define REG_PREAMBLE_LSB    0x21
#define REG_DIO_MAPPING1    0x40
#define REG_VERSION         0x42

// ── Mode constants ────────────────────────────────────────────────────────────
#define MODE_LONG_RANGE_MODE  0x80
#define MODE_SLEEP            0x00
#define MODE_STDBY            0x01
#define MODE_TX               0x03

#define IRQ_TX_DONE_MASK      0x08
#define PA_BOOST              0x80

static uint8_t _cs_pin;
static uint8_t _rst_pin;

static uint8_t spi_read(uint8_t addr) {
  digitalWrite(_cs_pin, LOW);
  SPI.transfer(addr & 0x7F);
  uint8_t val = SPI.transfer(0);
  digitalWrite(_cs_pin, HIGH);
  return val;
}

static void spi_write(uint8_t addr, uint8_t val) {
  digitalWrite(_cs_pin, LOW);
  SPI.transfer(addr | 0x80);
  SPI.transfer(val);
  digitalWrite(_cs_pin, HIGH);
}

static void spi_write_buf(uint8_t addr, const uint8_t* buf, uint8_t len) {
  digitalWrite(_cs_pin, LOW);
  SPI.transfer(addr | 0x80);
  for (uint8_t i = 0; i < len; i++) SPI.transfer(buf[i]);
  digitalWrite(_cs_pin, HIGH);
}

/**
 * Initialise SX1276 for LoRa TX.
 *
 * @param cs           CS pin
 * @param rst          Reset pin
 * @param freq_hz      Centre frequency (Hz) e.g. 868100000
 * @param tx_power_dbm TX power 2–17 dBm
 * @param sf           Spreading factor 7–12
 * @param bw_hz        Bandwidth 7800–500000 Hz
 * @param cr           Coding rate denominator 5–8 (4/5 to 4/8)
 * @param preamble     Preamble length symbols (8 typical)
 */
static void sx1276_init(uint8_t cs, uint8_t rst,
                        uint32_t freq_hz, uint8_t tx_power_dbm,
                        uint8_t sf, uint32_t bw_hz, uint8_t cr,
                        uint16_t preamble) {
  _cs_pin  = cs;
  _rst_pin = rst;

  pinMode(_cs_pin,  OUTPUT);
  pinMode(_rst_pin, OUTPUT);
  digitalWrite(_cs_pin, HIGH);

  // Hardware reset
  digitalWrite(_rst_pin, LOW);
  delay(10);
  digitalWrite(_rst_pin, HIGH);
  delay(10);

  // Enter sleep mode, enable LoRa
  spi_write(REG_OP_MODE, MODE_LONG_RANGE_MODE | MODE_SLEEP);
  delay(10);

  // Set frequency
  uint64_t frf = ((uint64_t)freq_hz << 19) / 32000000UL;
  spi_write(REG_FRF_MSB, (uint8_t)(frf >> 16));
  spi_write(REG_FRF_MID, (uint8_t)(frf >>  8));
  spi_write(REG_FRF_LSB, (uint8_t)(frf >>  0));

  // TX power — use PA_BOOST for max range (PA_BOOST pin on most modules)
  if (tx_power_dbm > 17) tx_power_dbm = 17;
  if (tx_power_dbm < 2)  tx_power_dbm = 2;
  spi_write(REG_PA_CONFIG, PA_BOOST | (uint8_t)(tx_power_dbm - 2));

  // Modem config 1: BW + CR + explicit header
  uint8_t bw_reg;
  if      (bw_hz <= 7800)   bw_reg = 0;
  else if (bw_hz <= 10400)  bw_reg = 1;
  else if (bw_hz <= 15600)  bw_reg = 2;
  else if (bw_hz <= 20800)  bw_reg = 3;
  else if (bw_hz <= 31250)  bw_reg = 4;
  else if (bw_hz <= 41700)  bw_reg = 5;
  else if (bw_hz <= 62500)  bw_reg = 6;
  else if (bw_hz <= 125000) bw_reg = 7;
  else if (bw_hz <= 250000) bw_reg = 8;
  else                      bw_reg = 9; // 500 kHz

  uint8_t cr_reg = (uint8_t)(cr - 4) & 0x07; // 1=4/5, 2=4/6, 3=4/7, 4=4/8
  spi_write(REG_MODEM_CONFIG1, (bw_reg << 4) | (cr_reg << 1)); // explicit header

  // Modem config 2: SF + single packet TX + CRC on
  spi_write(REG_MODEM_CONFIG2, (sf << 4) | 0x04); // CRC enable

  // Modem config 3: LNA gain auto for SF >= 11, else off
  spi_write(REG_MODEM_CONFIG3, (sf >= 11) ? 0x08 : 0x00);

  // Preamble
  spi_write(REG_PREAMBLE_MSB, (uint8_t)(preamble >> 8));
  spi_write(REG_PREAMBLE_LSB, (uint8_t)(preamble & 0xFF));

  // FIFO TX base at 0x00
  spi_write(REG_FIFO_TX_BASE, 0x00);

  // Standby
  spi_write(REG_OP_MODE, MODE_LONG_RANGE_MODE | MODE_STDBY);
}

/**
 * Transmit a packet.  Blocks until TxDone (typically < 500 ms at SF8/125kHz).
 * Puts radio to sleep after TX to save power.
 */
static void sx1276_transmit(const uint8_t* data, uint8_t len) {
  // Standby
  spi_write(REG_OP_MODE, MODE_LONG_RANGE_MODE | MODE_STDBY);

  // Reset FIFO pointer to TX base
  spi_write(REG_FIFO_ADDR_PTR, 0x00);

  // Write payload
  spi_write_buf(REG_FIFO, data, len);
  spi_write(REG_PAYLOAD_LENGTH, len);

  // Clear IRQ flags
  spi_write(REG_IRQ_FLAGS, 0xFF);

  // Start TX
  spi_write(REG_OP_MODE, MODE_LONG_RANGE_MODE | MODE_TX);

  // Poll TxDone — typical ~200-400ms at SF8
  uint16_t timeout = 2000; // 2s max
  while (!(spi_read(REG_IRQ_FLAGS) & IRQ_TX_DONE_MASK) && timeout > 0) {
    delay(1);
    timeout--;
  }

  // Clear IRQ, sleep radio
  spi_write(REG_IRQ_FLAGS, IRQ_TX_DONE_MASK);
  spi_write(REG_OP_MODE, MODE_LONG_RANGE_MODE | MODE_SLEEP);
}
