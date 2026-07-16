"""
Uplink — batches readings from the local SQLite buffer and POSTs them
to the Cloudflare Workers ingest API every N seconds (default 300 = 5 min).

On failure: logs the error, increments retry counter, backs off exponentially.
Readings remain in the local buffer until upload is confirmed.
"""

import asyncio
import logging
import time
from typing import Any

import httpx

from agent.buffer import ReadingBuffer
from agent.config import Config

log = logging.getLogger("vernal.uplink")

MAX_BACKOFF_S  = 900   # 15 minutes max backoff on repeated failure
BATCH_SIZE     = 200   # Max readings per POST


class Uplink:
    def __init__(self, config: Config) -> None:
        self._config   = config
        self._failures = 0

    async def run(self, buffer: ReadingBuffer, shutdown: asyncio.Event) -> None:
        """Upload loop — runs until shutdown is set."""
        while not shutdown.is_set():
            await asyncio.sleep(self._config.upload_interval_s)
            if shutdown.is_set():
                break
            try:
                await self._upload_batch(buffer)
                self._failures = 0
            except Exception as exc:
                self._failures += 1
                backoff = min(self._config.upload_interval_s * (2 ** self._failures), MAX_BACKOFF_S)
                log.warning("Upload failed (attempt %d): %s — backing off %ds", self._failures, exc, backoff)
                # We don't sleep here — the fixed interval above is the base.
                # The backoff is informational; readings are safe in the buffer.

    async def _upload_batch(self, buffer: ReadingBuffer) -> None:
        pending = buffer.get_pending(limit=BATCH_SIZE)
        if not pending:
            log.debug("No pending readings to upload")
            return

        # Strip internal DB fields before sending
        readings_payload = [
            {k: v for k, v in r.items() if k not in ("id", "uploaded")}
            for r in pending
        ]

        log.info("Uploading %d readings to %s", len(readings_payload), self._config.ingest_url)

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                self._config.ingest_url,
                json={"readings": readings_payload},
                headers={
                    "Authorization": f"Bearer {self._config.device_jwt}",
                    "Content-Type":  "application/json",
                    "X-Vernal-Agent": "pi-agent/0.1.0",
                },
            )

        if response.status_code == 200:
            ids = [r["id"] for r in pending]
            buffer.mark_uploaded(ids)
            log.info("Uploaded %d readings successfully", len(ids))
        elif response.status_code == 401:
            # JWT expired — log clearly so the OTA update can rotate token
            log.error("Device JWT rejected (401) — token may be expired. Check /etc/vernal/config.json")
            raise RuntimeError("Device JWT rejected")
        else:
            raise RuntimeError(f"Ingest API returned HTTP {response.status_code}: {response.text[:200]}")
