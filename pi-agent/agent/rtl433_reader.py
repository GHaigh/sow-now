"""
rtl_433 reader — decodes Ecowitt WS69 / Fine Offset weather station.

Launches rtl_433 as a subprocess, reads its JSON output line-by-line,
normalises the fields to Vernal's internal reading format, and writes
each reading to the local buffer.

rtl_433 is launched with:
  rtl_433 -f 433920000 -F json -M utc -R 0 -R 119
                                                ^^^
  -R 0 disables all decoders; -R 119 enables only Fineoffset-WS68 family
  which covers the WS69. This reduces CPU usage and avoids false matches.
"""

import asyncio
import json
import logging
import time
from agent.buffer import ReadingBuffer
from agent.config import Config

log = logging.getLogger("sow-now.rtl433")

# rtl_433 device ID for Fineoffset-WS68 / WS69 family
FINEOFFSET_PROTOCOL = 119


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
            "-f", str(self._config.lora_frequency_hz),
            "-F", "json",
            "-M", "utc",
            "-R", "0",          # disable all decoders
            "-R", str(FINEOFFSET_PROTOCOL),  # enable WS69 decoder only
        ]

        log.info("Starting rtl_433: %s", " ".join(cmd))
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )

        try:
            assert proc.stdout is not None
            async for raw_line in proc.stdout:
                if shutdown.is_set():
                    break
                line = raw_line.decode("utf-8", errors="replace").strip()
                if not line:
                    continue
                self._parse_and_buffer(line, buffer)
        finally:
            proc.terminate()
            await proc.wait()

    def _parse_and_buffer(self, line: str, buffer: ReadingBuffer) -> None:
        """Parse one JSON line from rtl_433 and write to buffer."""
        try:
            data = json.loads(line)
        except json.JSONDecodeError:
            return

        # Extract device identity
        model = data.get("model", "")
        device_id = str(data.get("id", "ws69"))
        sensor_rf_id = f"ws69_{device_id}"

        if "Fineoffset" not in model and "Fine_Offset" not in model:
            return  # Ignore non-WS69 decodes

        reading: dict = {
            "sensor_rf_id": sensor_rf_id,
            "sensor_type":  "weather_station",
            "recorded_at":  int(time.time()),
            # Map rtl_433 field names to Vernal's field names
            "temp_c":       data.get("temperature_C"),
            "humidity_pct": data.get("humidity"),
            "pressure_hpa": data.get("pressure_hPa"),
            "wind_avg_ms":  data.get("wind_avg_m_s"),
            "wind_max_ms":  data.get("wind_max_m_s"),
            "wind_dir_deg": data.get("wind_dir_deg"),
            "rain_mm":      data.get("rain_mm"),
            "uv_index":     data.get("uv"),
            "solar_lux":    data.get("solar_lux"),
        }

        buffer.insert(reading)
        log.debug(
            "WS69 reading: temp=%.1f°C hum=%.0f%% wind=%.1fm/s",
            reading["temp_c"] or 0,
            reading["humidity_pct"] or 0,
            reading["wind_avg_ms"] or 0,
        )
