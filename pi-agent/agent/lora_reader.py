"""
LoRa reader — receives soil moisture and greenhouse sensor node packets.

Uses the SX1262 HAT connected via SPI on the Raspberry Pi Zero 2W.
The SX1262 listens on 433.925 MHz (offset from WS69's 433.920 MHz to
avoid any potential interference, different modulation anyway).

Sensor node packet format (12 bytes, AES-128 encrypted):
  Byte 0:     Node ID (1 byte)
  Byte 1:     Sensor type: 0x01=soil, 0x02=greenhouse
  Bytes 2–3:  Moisture / temp raw ADC (uint16 big-endian)
  Bytes 4–5:  Secondary reading (soil temp OR greenhouse humidity, uint16)
  Bytes 6–7:  Battery mV (uint16 big-endian)
  Bytes 8–11: Message counter (uint32, replay protection)

Decryption uses AES-128-ECB with the node's pre-shared key.
Keys are provisioned at manufacture and stored in /etc/vernal/node_keys.json.
"""

import asyncio
import json
import logging
import struct
import time
from pathlib import Path
from typing import Any

log = logging.getLogger("vernal.lora")

NODE_KEYS_PATH = Path("/etc/vernal/node_keys.json")

# LoRa parameters matching the sensor node firmware
LORA_FREQUENCY   = 433_925_000   # Hz
LORA_SF          = 7             # Spreading factor
LORA_BW          = 125_000       # Bandwidth Hz
LORA_CR          = 5             # Coding rate 4/5
LORA_PREAMBLE    = 8

# Sensor type bytes
SENSOR_SOIL      = 0x01
SENSOR_GREENHOUSE = 0x02


class LoraReader:
    def __init__(self, config: Any) -> None:
        self._config = config
        self._node_keys: dict[int, bytes] = self._load_node_keys()
        self._seen_counters: dict[int, int] = {}   # replay protection

    def _load_node_keys(self) -> dict[int, bytes]:
        """Load AES-128 keys for each node ID from /etc/vernal/node_keys.json."""
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
        if len(raw) < 12:
            log.debug("Short LoRa packet (%d bytes) — discarding", len(raw))
            return

        node_id = raw[0]
        payload = self._decrypt_packet(node_id, raw[1:])
        if payload is None:
            return

        sensor_type_byte = payload[0]
        raw_a, raw_b, battery_mv, counter = struct.unpack(">HHHH", payload[1:9])

        # Replay attack protection
        last_counter = self._seen_counters.get(node_id, -1)
        if counter <= last_counter:
            log.warning("Replay detected: node=%d counter=%d (last=%d)", node_id, counter, last_counter)
            return
        self._seen_counters[node_id] = counter

        battery_pct = min(100, max(0, int((battery_mv - 2400) / (3200 - 2400) * 100)))
        sensor_rf_id = f"lora_{node_id}"

        if sensor_type_byte == SENSOR_SOIL:
            # raw_a = moisture ADC, raw_b = soil temp (raw, 0.1°C resolution)
            moisture_pct = round((raw_a / 4095) * 100, 1)
            soil_temp_c  = round((raw_b - 500) / 10.0, 1)
            reading: dict = {
                "sensor_rf_id":     sensor_rf_id,
                "sensor_type":      "soil",
                "recorded_at":      int(time.time()),
                "soil_moisture_pct": moisture_pct,
                "soil_temp_c":      soil_temp_c,
                "battery_pct":      battery_pct,
            }
            log.debug("Soil node %d: moisture=%.1f%% soil_temp=%.1f°C bat=%d%%",
                      node_id, moisture_pct, soil_temp_c, battery_pct)

        elif sensor_type_byte == SENSOR_GREENHOUSE:
            # raw_a = greenhouse temp (0.1°C), raw_b = humidity (0.1%)
            gh_temp_c   = round((raw_a - 500) / 10.0, 1)
            gh_humidity = round(raw_b / 10.0, 1)
            reading = {
                "sensor_rf_id":              sensor_rf_id,
                "sensor_type":               "greenhouse",
                "recorded_at":               int(time.time()),
                "greenhouse_temp_c":         gh_temp_c,
                "greenhouse_humidity_pct":   gh_humidity,
                "battery_pct":               battery_pct,
            }
            log.debug("Greenhouse node %d: temp=%.1f°C hum=%.1f%% bat=%d%%",
                      node_id, gh_temp_c, gh_humidity, battery_pct)
        else:
            log.warning("Unknown sensor type byte 0x%02x from node %d", sensor_type_byte, node_id)
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
