"""
rtl_433 reader — decodes Ecowitt WH51 and WH31 sensors via RTL-SDR.

Supported devices (decoded model names from rtl_433):
  Fineoffset-WH51      — soil moisture sensor
  AmbientWeather-WH31E — thermo-hygro sensor (greenhouse / indoor)

WS69 weather stations are not supported — wind and rain data are
not tracked by this platform.

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
            "-F", "json",
            "-M", "utc",
            "-M", "level",
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
                    continue
                if not raw_line:
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
        # All other models (WS69, WS90, WHx080, Marlec-Solar etc.) are ignored.

    # ── WH31 channel routing ──────────────────────────────────────────────────
    # Channel 1 = greenhouse (default placement)
    # Channel 2+ = indoor (propagator / windowsill)
    GREENHOUSE_CHANNEL = 1

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
