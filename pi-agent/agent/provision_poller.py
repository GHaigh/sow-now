"""
Provision poller — runs after WiFi connects on first boot.

Polls GET /api/v1/provision/config every 5 seconds until the customer
scans the QR code in the app. Once the device JWT is returned:
  1. Writes /etc/sow-now/config.json with device_id, device_jwt, ingest_url
  2. Exits with code 0 — systemd then starts sow-now-agent.service

Authentication: uses the pre-burned provision token from
/etc/sow-now/provision.json (written at manufacture, never changes).

/etc/sow-now/provision.json format:
  {
    "device_id":        "dev-sn-001",
    "provision_token":  "SN-A1B2C3D4"
  }
"""

import asyncio
import json
import logging
import sys
import time
from pathlib import Path

import httpx

log = logging.getLogger("sow-now.provision")

PROVISION_JSON  = Path("/etc/sow-now/provision.json")
CONFIG_PATH     = Path("/etc/sow-now/config.json")
CONFIG_DEFAULTS = {
    "db_path":           "/var/lib/sow-now/readings.db",
    "upload_interval_s": 300,
    "rtl433_cmd":        "/usr/local/bin/rtl_433",
    "ws_frequency_hz":   868000000,
}

POLL_INTERVAL_S = 5
POLL_TIMEOUT_S  = 3600  # 1 hour — token TTL on the server


async def poll_for_config() -> None:
    if not PROVISION_JSON.exists():
        log.error("No provision.json found at %s — cannot provision", PROVISION_JSON)
        sys.exit(1)

    provision = json.loads(PROVISION_JSON.read_text())
    device_id = provision.get("device_id")
    token     = provision.get("provision_token")

    if not device_id or not token:
        log.error("provision.json missing device_id or provision_token")
        sys.exit(1)

    if CONFIG_PATH.exists() and CONFIG_PATH.stat().st_size > 0:
        cfg = json.loads(CONFIG_PATH.read_text())
        if cfg.get("device_jwt"):
            log.info("Already provisioned — skipping poll")
            return

    api_url = f"https://api.sow-now.uk/api/v1/provision/config?device_id={device_id}&token={token}"
    log.info("Waiting for customer to scan QR code (device_id=%s)…", device_id)

    deadline = time.monotonic() + POLL_TIMEOUT_S

    async with httpx.AsyncClient(timeout=15.0) as client:
        while time.monotonic() < deadline:
            try:
                resp = await client.get(api_url)

                if resp.status_code == 202:
                    # Still pending — keep polling
                    log.debug("Pending — customer hasn't scanned QR yet")
                    await asyncio.sleep(POLL_INTERVAL_S)
                    continue

                if resp.status_code == 200:
                    data = resp.json()
                    device_jwt = data.get("device_jwt")
                    ingest_url = data.get("ingest_url", "https://api.sow-now.uk/api/v1/ingest")

                    if not device_jwt:
                        log.error("Provision config response missing device_jwt")
                        sys.exit(1)

                    # Write config — merge defaults with provisioned values
                    config = {
                        **CONFIG_DEFAULTS,
                        "device_id":  device_id,
                        "device_jwt": device_jwt,
                        "ingest_url": ingest_url,
                    }
                    CONFIG_PATH.write_text(json.dumps(config, indent=2))
                    CONFIG_PATH.chmod(0o600)
                    log.info("✅ Provisioned — config written to %s", CONFIG_PATH)
                    return

                if resp.status_code in (404, 410):
                    log.error("Provision token invalid or expired (HTTP %d) — re-flash required", resp.status_code)
                    sys.exit(1)

                log.warning("Unexpected HTTP %d — retrying", resp.status_code)
                await asyncio.sleep(POLL_INTERVAL_S)

            except (httpx.ConnectError, httpx.TimeoutException) as exc:
                log.warning("Network error: %s — retrying in %ds", exc, POLL_INTERVAL_S)
                await asyncio.sleep(POLL_INTERVAL_S)

    log.error("Provision timeout after %ds — customer did not scan QR in time", POLL_TIMEOUT_S)
    sys.exit(1)


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format='{"time": "%(asctime)s", "level": "%(levelname)s", "msg": "%(message)s"}',
        datefmt='%Y-%m-%dT%H:%M:%S',
        stream=sys.stdout,
    )
    asyncio.run(poll_for_config())


if __name__ == "__main__":
    main()
