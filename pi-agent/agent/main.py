#!/usr/bin/env python3
"""
Sow Now Pi Agent — main entry point
===================================
Raspberry Pi Zero 2W hub software for the Sow Now growing platform.

Responsibilities:
  - Read all Ecowitt sensor data via RTL-SDR + rtl_433:
      WS69  — outdoor weather station (temp, humidity, wind, rain, UV)
      WH51  — soil moisture per bed
      WH31  — greenhouse temperature + humidity
  - Write all readings to local SQLite buffer
  - Batch-upload readings to Cloudflare Workers ingest API every 5 minutes
  - Handle offline periods with automatic retry on reconnect

Usage (run via systemd — see setup/sow-now-agent.service):
  python3 -m agent.main
"""

import asyncio
import logging
import signal
import sys
from agent.rtl433_reader import Rtl433Reader
from agent.buffer import ReadingBuffer
from agent.uplink import Uplink
from agent.config import load_config

# Structured logging — JSON format for easy log shipping
logging.basicConfig(
    level=logging.INFO,
    format='{"time": "%(asctime)s", "level": "%(levelname)s", "msg": "%(message)s"}',
    datefmt='%Y-%m-%dT%H:%M:%S',
    stream=sys.stdout,
)
log = logging.getLogger("sow-now.agent")


async def main() -> None:
    config = load_config()
    log.info("Vernal agent starting — device_id=%s", config.device_id)

    buffer = ReadingBuffer(config.db_path)
    uplink = Uplink(config)

    rtl_reader = Rtl433Reader(config)

    # Graceful shutdown on SIGTERM / SIGINT
    shutdown_event = asyncio.Event()
    loop = asyncio.get_running_loop()

    gather_task: asyncio.Task | None = None

    def _handle_shutdown() -> None:
        shutdown_event.set()
        # Cancel the gather immediately so tasks exit without waiting for
        # their next poll cycle — ensures rtl_433 subprocess is terminated
        # before Python exits and systemd gives up waiting.
        if gather_task is not None:
            gather_task.cancel()

    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, _handle_shutdown)

    log.info("Starting RTL-SDR reader and uplink task")

    gather_task = asyncio.ensure_future(asyncio.gather(
        rtl_reader.run(buffer, shutdown_event),
        uplink.run(buffer, shutdown_event),
        return_exceptions=True,
    ))
    try:
        await gather_task
    except asyncio.CancelledError:
        pass

    log.info("Vernal agent stopped cleanly")


if __name__ == "__main__":
    asyncio.run(main())
