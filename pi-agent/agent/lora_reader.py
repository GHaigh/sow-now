"""
LoRa reader — receives soil moisture and greenhouse sensor node packets.

Uses the SX1262 HAT connected via SPI on the Raspberry Pi Zero 2W.
The SX1262 listens on 868.1 MHz matching the ATtiny85 sensor node firmware.

Sensor node packet format (16 bytes, AES-128-ECB encrypted):
  Byte 0:     node_id       (uint8)
  Byte 1:     node_type     (uint8) 0x01=soil, 0x02=greenhouse
  Bytes 2–3:  temperature   (int16 BE, °C × 10)  e.g. 215 = 21.5°C
  Bytes 4–5:  soil_moisture (uint16 BE, % × 10)  e.g. 650 = 65.0%
  Bytes 6–7:  battery_mv    (uint16 BE, mV)       e.g. 3310 = 3.31V
  Bytes 8–9:  counter       (uint16 BE, monotonic — replay protection)
  Bytes 10–15: reserved/zero

Decryption uses AES-128-ECB with the node's pre-shared key.
Keys are provisioned at manufacture and stored in /etc/sow-now/node_keys.json.
"""

import asyncio
import json
import logging
import struct
import time
from pathlib import Path
from typing import Any

log = logging.getLogger("sow-now.lora")

NODE_KEYS_PATH = Path("/etc/sow-now/node_keys.json")

# LoRa parameters — MUST match sensor-node firmware (config.h)
LORA_FREQUENCY   = 868_100_000   # Hz — EU868 ch0
LORA_SF          = 8             # Spreading factor
LORA_BW          = 125_000       # Bandwidth Hz
LORA_CR          = 5             # Coding rate 4/5
LORA_PREAMBLE    = 8

# Packet size — must match PACKET_SIZE in firmware config.h
PACKET_SIZE      = 16

# Sensor type bytes
SENSOR_SOIL      = 0x01
SENSOR_GREENHOUSE = 0x02


class LoraReader:
    def __init__(self, config: Any) -> None:
        self._config = config
        self._node_keys: dict[int, bytes] = self._load_node_keys()
        self._seen_counters: dict[int, int] = {}   # replay protection

    def _load_node_keys(self) -> dict[int, bytes]:
        """Load AES-128 keys for each node ID from /etc/sow-now/node_keys.json."""
        if not NODE_KEYS_PATH.exists():
            log.warning("node_keys.json not found — LoRa decryption will fail")
            return {}
        with NODE_KEYS_PATH.open() as f:
            raw: dict[str, str] = json.load(f)
        return {int(node_id): bytes.fromhex(key_hex) for node_id, key_hex in raw.items()}

    async def run(self, buffer: Any, shutdown: asyncio.Event) -> None:
        """Continuously receive LoRa packets until shutdown."""
        try:
            from sx126x import SX126x  # type: ignore[import]  # installed on Pi only
            radio = SX126x(
                bus=self._config.lora_spi_bus,
                device=self._config.lora_spi_device,
                frequency=LORA_FREQUENCY,
                spreading_factor=LORA_SF,
                bandwidth=LORA_BW,
                coding_rate=LORA_CR,
                preamble_length=LORA_PREAMBLE,
            )
            radio.begin()
            log.info("LoRa radio initialised on SPI%d.%d @ %d MHz",
                     self._config.lora_spi_bus,
                     self._config.lora_spi_device,
                     LORA_FREQUENCY // 1_000_000)
        except ImportError:
            log.warning("sx126x module not available — running in simulation mode")
            await self._simulate(buffer, shutdown)
            return
        except Exception as exc:
            log.error("LoRa init failed: %s", exc)
            return

        while not shutdown.is_set():
            try:
                if radio.available():
                    packet = radio.receive()
                    if packet:
                        self._decode_and_buffer(packet, buffer)
                await asyncio.sleep(0.1)
            except Exception as exc:
                log.error("LoRa receive error: %s", exc)
                await asyncio.sleep(5)

    def _decrypt_packet(self, node_id: int, ciphertext: bytes) -> bytes | None:
        """AES-128-ECB decrypt. Returns None if key not found."""
        key = self._node_keys.get(node_id)
        if not key:
            log.warning("No key for node_id=%d — discarding packet", node_id)
            return None
        try:
            from Crypto.Cipher import AES  # type: ignore[import]
            cipher = AES.new(key, AES.MODE_ECB)
            return cipher.decrypt(ciphertext)
        except Exception as exc:
            log.error("Decryption failed for node %d: %s", node_id, exc)
            return None

    def _decode_and_buffer(self, raw: bytes, buffer: Any) -> None:
        """Decrypt and decode a LoRa packet, write to buffer."""
        if len(raw) != PACKET_SIZE:
            log.debug("Unexpected LoRa packet length %d (expected %d) — discarding", len(raw), PACKET_SIZE)
            return

        # The entire 16-byte packet is AES-encrypted; node_id is in byte 0 plaintext
        # but we must peek it to select the decryption key.  Because byte 0 of the
        # plaintext always encodes the node_id and AES-ECB is deterministic, the
        # first byte of ciphertext leaks nothing useful to an attacker without the key.
        # The full 16-byte block is decrypted in one pass.
        node_id_hint = raw[0]
        plaintext = self._decrypt_packet(node_id_hint, raw)
        if plaintext is None:
            return

        node_id      = plaintext[0]
        node_type    = plaintext[1]
        temp_tenths  = struct.unpack(">h", plaintext[2:4])[0]   # signed int16
        moist_tenths = struct.unpack(">H", plaintext[4:6])[0]   # unsigned int16
        battery_mv   = struct.unpack(">H", plaintext[6:8])[0]
        counter      = struct.unpack(">H", plaintext[8:10])[0]

        # Replay attack protection (counter is uint16, rolls over at 65535)
        last_counter = self._seen_counters.get(node_id, -1)
        if last_counter >= 0 and counter <= last_counter and (last_counter - counter) < 32768:
            log.warning("Replay detected: node=%d counter=%d (last=%d)", node_id, counter, last_counter)
            return
        self._seen_counters[node_id] = counter

        temp_c      = round(temp_tenths / 10.0, 1)
        moisture_pct = round(moist_tenths / 10.0, 1)
        battery_pct = min(100, max(0, int((battery_mv - 2400) / (3200 - 2400) * 100)))
        sensor_rf_id = f"lora_{node_id}"

        if node_type == SENSOR_SOIL:
            reading: dict = {
                "sensor_rf_id":      sensor_rf_id,
                "sensor_type":       "soil",
                "recorded_at":       int(time.time()),
                "soil_moisture_pct": moisture_pct,
                "soil_temp_c":       temp_c,
                "battery_pct":       battery_pct,
            }
            log.debug("Soil node %d: moisture=%.1f%% soil_temp=%.1f°C bat=%d%%",
                      node_id, moisture_pct, temp_c, battery_pct)

        elif node_type == SENSOR_GREENHOUSE:
            reading = {
                "sensor_rf_id":            sensor_rf_id,
                "sensor_type":             "greenhouse",
                "recorded_at":             int(time.time()),
                "greenhouse_temp_c":       temp_c,
                "greenhouse_humidity_pct": moisture_pct,  # byte 4-5 = humidity for GH nodes
                "battery_pct":             battery_pct,
            }
            log.debug("Greenhouse node %d: temp=%.1f°C hum=%.1f%% bat=%d%%",
                      node_id, temp_c, moisture_pct, battery_pct)
        else:
            log.warning("Unknown node_type 0x%02x from node %d", node_type, node_id)
            return

        buffer.insert(reading)

    async def _simulate(self, buffer: Any, shutdown: asyncio.Event) -> None:
        """Development simulation — emits fake LoRa readings every 30s."""
        import random
        log.info("LoRa simulation mode active")
        while not shutdown.is_set():
            buffer.insert({
                "sensor_rf_id":      "lora_1",
                "sensor_type":       "soil",
                "recorded_at":       int(time.time()),
                "soil_moisture_pct": round(random.uniform(30, 75), 1),
                "soil_temp_c":       round(random.uniform(10, 18), 1),
                "battery_pct":       85,
            })
            buffer.insert({
                "sensor_rf_id":              "lora_10",
                "sensor_type":               "greenhouse",
                "recorded_at":               int(time.time()),
                "greenhouse_temp_c":         round(random.uniform(15, 30), 1),
                "greenhouse_humidity_pct":   round(random.uniform(55, 80), 1),
                "battery_pct":               92,
            })
            await asyncio.sleep(30)
