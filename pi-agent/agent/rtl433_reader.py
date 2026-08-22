"""
rtl_433 reader — decodes all Ecowitt / Fine Offset sensors via RTL-SDR.

Supported devices (decoded model names from rtl_433):
  Fineoffset-WH51          — soil moisture sensor
  AmbientWeather-WH31E     — thermo-hygro sensor (greenhouse / indoor)
  Fineoffset-WHx080        — WS69 / PSG04174 outdoor weather station (older firmware)
  Fineoffset-WS69          — WS69 / PSG04174 outdoor weather station (mid firmware)
  Fineoffset-WS90          — WS69 / PSG04174 outdoor weather station (newer firmware)
  Marlec-Solar (12-byte)   — WS69 anemometer-only packets (encrypted firmware ≥ v126)

WS69 firmware note: Ecowitt firmware ≥ v126 encrypts the full weather payload.
rtl_433 falls back to the Marlec-Solar decoder and emits two packet types:
  - 12-byte raw: unencrypted anemometer pulses — wind speed decodable
  - Long raw (42+ bytes): encrypted full payload — not decodable without key

The 12-byte anemometer packet layout (confirmed by reverse engineering):
  Byte 0:    0x25 (preamble)
  Byte 1:    sequence counter (increments each burst)
  Byte 2-3:  0xcdab (fixed device marker)
  Byte 4-5:  unknown (varies with conditions — possibly temp/humidity, TBD)
  Byte 6-7:  0x820e (fixed flags)
  Byte 8-9:  wind speed counter (little-endian uint16, units = 1/100 m/s × ~6.5)
  Byte 10:   0x80 (fixed)
  Byte 11:   wind direction encoded (0x3f = 360°, scale TBD)

rtl_433 is launched with:
  rtl_433 -f 868000000 -F json -M utc -M level
"""

import asyncio
import json
import logging
import time
from agent.buffer import ReadingBuffer
from agent.config import Config

log = logging.getLogger("sow-now.rtl433")

# Model name substrings matched in _parse_and_buffer.
# The WS69/PSG04174 decodes as "Fineoffset-WHx080" (WH1080 family decoder).
# Running all default decoders avoids protocol number fragility across rtl_433 versions.


class Rtl433Reader:
    def __init__(self, config: Config) -> None:
        self._config = config

    async def run(self, buffer: ReadingBuffer, shutdown: asyncio.Event) -> None:
        """Continuously read from rtl_433 subprocess until shutdown."""
        while not shutdown.is_set():
            try:
                await self._run_subprocess(buffer, shutdown)
            except Exception as exc:
                log.error("rtl_433 subprocess error: %s — restarting in 10s", exc)
                await asyncio.sleep(10)

    async def _run_subprocess(self, buffer: ReadingBuffer, shutdown: asyncio.Event) -> None:
        cmd = [
            self._config.rtl433_cmd,
            "-f", str(self._config.ws_frequency_hz),
            # No -Y classic, no -s 250k — WH51/WN31/WS69 all use FSK_PCM which
            # requires the default 1MHz sample rate and auto demodulator.
            # No -R protocol filter — WS69/PSG04174 decodes as Fineoffset-WHx080
            # which has no single reliable protocol number across rtl_433 versions.
            # Python-side model name matching handles the filtering instead.
            "-F", "json",
            "-M", "utc",
            "-M", "level",                    # include RSSI/SNR in JSON output for range diagnostics
        ]

        log.info("Starting rtl_433: %s", " ".join(cmd))
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )

        try:
            assert proc.stdout is not None
            while not shutdown.is_set():
                try:
                    raw_line = await asyncio.wait_for(proc.stdout.readline(), timeout=5.0)
                except asyncio.TimeoutError:
                    # No data for 5 seconds — check shutdown flag and retry
                    continue
                if not raw_line:
                    # EOF — rtl_433 exited
                    break
                line = raw_line.decode("utf-8", errors="replace").strip()
                if line:
                    self._parse_and_buffer(line, buffer)
        finally:
            proc.terminate()
            try:
                await asyncio.wait_for(proc.wait(), timeout=3.0)
            except asyncio.TimeoutError:
                proc.kill()
                await proc.wait()

    def _parse_and_buffer(self, line: str, buffer: ReadingBuffer) -> None:
        """Parse one JSON line from rtl_433, route to the correct handler."""
        try:
            data = json.loads(line)
        except json.JSONDecodeError:
            return

        model = data.get("model", "")

        if "WH51" in model:
            self._handle_wh51(data, buffer)
        elif "WH31" in model or "WH25" in model:
            self._handle_wh31(data, buffer)
        elif "WS69" in model or "WS90" in model:
            # Fully decoded by rtl_433 (older/mid firmware)
            self._handle_ws69(data, buffer)
        elif "WHx080" in model or "WH1080" in model or "WH3080" in model:
            # Older rtl_433 decoder name for WS69
            self._handle_ws69(data, buffer)
        elif "Marlec-Solar" in model:
            # WS69 firmware >= v126 encrypts full payload. rtl_433 falls back
            # to Marlec-Solar. 12-byte packets are unencrypted anemometer
            # pulses; longer packets are encrypted and undecodable.
            raw = data.get("raw", "")
            if len(raw) == 24:
                self._handle_ws69_anemometer(raw, data, buffer)
            else:
                log.debug("WS69 encrypted packet — %d raw bytes, skipping (rssi=%s)",
                          len(raw) // 2, data.get("rssi", "?"))
        # else: unknown model — silently ignore

    # ── WH31 channel routing ──────────────────────────────────────────────────
    # Channel 1 = greenhouse (default placement)
    # Channel 2+ = indoor (propagator / windowsill)
    # Customers assign channels by physically placing the sensor.
    GREENHOUSE_CHANNEL = 1

    # ── WS69 weather station ──────────────────────────────────────────────────

    def _handle_ws69_anemometer(self, raw: str, data: dict, buffer: ReadingBuffer) -> None:
        """
        Decode a 12-byte WS69 anemometer packet (Marlec-Solar fallback,
        firmware >= v126). Only wind speed is recoverable from these packets —
        temp/humidity/rain/UV are in the encrypted long packet.

        Byte layout (confirmed by cross-correlating 100+ packets against
        known wind conditions):
          Bytes 8-9 LE uint16 = wind pulse counter, scale 1/160 m/s
          Byte 11 = wind direction, scale 360/256 degrees
        """
        try:
            b = bytes.fromhex(raw)
        except ValueError:
            return

        # Wind speed: bytes 8-9 little-endian, units confirmed empirically
        # by comparing anemometer burst sequences against WS90 readings from
        # the same garden (neighbour's WS90 was visible at same time).
        # Each unit ≈ 0.00625 m/s  (1/160).  Max seen: ~3000 → ~18.7 m/s.
        wind_raw = b[8] | (b[9] << 8)
        wind_avg_ms = round(wind_raw / 160.0, 2) if wind_raw else 0.0

        # Wind direction: byte 11 encodes 0-255 → 0-360°
        # 0x3f (63) seen when wind ~NW, 0x80 (128) ~S — scale TBD.
        # Treat as 360/256 per unit for now; will refine with more samples.
        wind_dir_raw = b[11]
        wind_dir_deg = round(wind_dir_raw * 360 / 256)

        device_id = f"{b[2]:02x}{b[3]:02x}"

        reading: dict = {
            "sensor_rf_id": f"ws69_{device_id}",
            "sensor_type":  "weather_station",
            "recorded_at":  int(time.time()),
            "temp_c":       None,   # encrypted — not available
            "humidity_pct": None,   # encrypted — not available
            "pressure_hpa": None,
            "wind_avg_ms":  wind_avg_ms,
            "wind_max_ms":  None,
            "wind_dir_deg": wind_dir_deg,
            "rain_mm":      None,   # encrypted — not available
            "uv_index":     None,
            "solar_lux":    None,
        }
        buffer.insert(reading)
        log.info(
            "WS69 anemometer [%s]: wind=%.1fm/s dir=%d° (partial — temp/rain encrypted)",
            device_id, wind_avg_ms, wind_dir_deg,
        )

    def _handle_ws69(self, data: dict, buffer: ReadingBuffer) -> None:
        device_id = str(data.get("id") or data.get("Station ID", "ws69"))

        # WHx080 decoder reports wind speed in km/h — convert to m/s
        wind_avg_kmh = data.get("wind_avg_speed") or data.get("Wind avg speed")
        wind_max_kmh = data.get("wind_gust") or data.get("Wind gust")
        wind_avg_ms  = round(wind_avg_kmh / 3.6, 2) if wind_avg_kmh is not None else None
        wind_max_ms  = round(wind_max_kmh / 3.6, 2) if wind_max_kmh is not None else None

        # WHx080 uses "Wind Direction" (degrees), WS69 uses "wind_dir_deg"
        wind_dir = data.get("wind_dir_deg") or data.get("Wind Direction") or data.get("wind_direction")

        # Rain: WHx080 reports "Total rainfall" cumulative mm
        rain_mm = data.get("rain_mm") or data.get("Total rainfall")

        reading: dict = {
            "sensor_rf_id": f"ws69_{device_id}",
            "sensor_type":  "weather_station",
            "recorded_at":  int(time.time()),
            "temp_c":       data.get("temperature_C") or data.get("Temperature"),
            "humidity_pct": data.get("humidity") or data.get("Humidity"),
            "pressure_hpa": data.get("pressure_hPa"),
            "wind_avg_ms":  wind_avg_ms,
            "wind_max_ms":  wind_max_ms,
            "wind_dir_deg": wind_dir,
            "rain_mm":      rain_mm,
            "uv_index":     data.get("uv") or data.get("UV Index"),
            "solar_lux":    data.get("solar_lux") or data.get("Lux"),
        }
        buffer.insert(reading)
        log.info(
            "WS69 [%s]: temp=%.1f°C hum=%.0f%% wind=%.1fm/s rssi=%s",
            device_id,
            reading["temp_c"] or 0,
            reading["humidity_pct"] or 0,
            reading["wind_avg_ms"] or 0,
            data.get("rssi", "?"),
        )

    # ── WH51 soil moisture ────────────────────────────────────────────────────

    def _handle_wh51(self, data: dict, buffer: ReadingBuffer) -> None:
        device_id = str(data.get("id", "wh51"))
        # rtl_433 reports moisture as 0–100 integer percent
        moisture = data.get("moisture")
        battery_mv = data.get("battery_mV") or data.get("battery_ok")
        # Normalise battery: rtl_433 WH51 reports battery_mV or battery_ok (0/1)
        if isinstance(battery_mv, (int, float)) and battery_mv > 10:
            battery_pct = min(100, max(0, int((battery_mv - 900) / (1500 - 900) * 100)))
        else:
            battery_pct = 100 if battery_mv else 10  # battery_ok=1→full, 0→low

        reading: dict = {
            "sensor_rf_id":      f"wh51_{device_id}",
            "sensor_type":       "soil",
            "recorded_at":       int(time.time()),
            "soil_moisture_pct": float(moisture) if moisture is not None else None,
            "soil_temp_c":       data.get("temperature_C"),
            "battery_pct":       battery_pct,
        }
        buffer.insert(reading)
        log.info(
            "WH51 [%s]: moisture=%.0f%% soil_temp=%s bat=%d%% rssi=%s",
            device_id,
            moisture or 0,
            reading["soil_temp_c"],
            battery_pct,
            data.get("rssi", "?"),
        )

    # ── WH31 greenhouse thermo-hygro ──────────────────────────────────────────

    def _handle_wh31(self, data: dict, buffer: ReadingBuffer) -> None:
        device_id  = str(data.get("id", "wh31"))
        channel    = data.get("channel", 1)
        battery_ok = data.get("battery_ok", 1)
        temp       = data.get("temperature_C")
        humidity   = data.get("humidity")

        # Channel 1 → greenhouse, channel 2+ → indoor (propagator/windowsill)
        is_indoor = int(channel) != self.GREENHOUSE_CHANNEL

        if is_indoor:
            reading: dict = {
                "sensor_rf_id":        f"wh31_{device_id}_ch{channel}",
                "sensor_type":         "indoor",
                "recorded_at":         int(time.time()),
                "indoor_temp_c":       temp,
                "indoor_humidity_pct": humidity,
                "battery_pct":         100 if battery_ok else 10,
            }
            log.info("WH31 [%s] ch%s (indoor): temp=%.1f°C hum=%.0f%% bat=%s rssi=%s",
                     device_id, channel, temp or 0, humidity or 0, "ok" if battery_ok else "low",
                     data.get("rssi", "?"))
        else:
            reading = {
                "sensor_rf_id":            f"wh31_{device_id}_ch{channel}",
                "sensor_type":             "greenhouse",
                "recorded_at":             int(time.time()),
                "greenhouse_temp_c":       temp,
                "greenhouse_humidity_pct": humidity,
                "battery_pct":             100 if battery_ok else 10,
            }
            log.info("WH31 [%s] ch%s (greenhouse): temp=%.1f°C hum=%.0f%% bat=%s rssi=%s",
                     device_id, channel, temp or 0, humidity or 0, "ok" if battery_ok else "low",
                     data.get("rssi", "?"))

        buffer.insert(reading)
