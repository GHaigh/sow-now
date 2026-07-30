#!/usr/bin/env python3
"""
Sow Now Pi Agent — main entry point
===================================
Raspberry Pi Zero 2W hub software for the Sow Now growing platform.

Responsibilities:
  - Read WS69 weather station data from rtl_433 JSON output (stdin/pipe)
  - Read soil moisture + greenhouse node data from LoRa (SX1262 via SPI)
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
from agent.lora_reader import LoraReader
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
    lora_reader = LoraReader(config)

    # Graceful shutdown on SIGTERM / SIGINT
    shutdown_event = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, shutdown_event.set)

    log.info("Starting sensor readers and uplink task")

    await asyncio.gather(
        rtl_reader.run(buffer, shutdown_event),
        lora_reader.run(buffer, shutdown_event),
        uplink.run(buffer, shutdown_event),
    )

    log.info("Vernal agent stopped cleanly")


if __name__ == "__main__":
    asyncio.run(main())
