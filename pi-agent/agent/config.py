"""
Vernal agent configuration loader.
Reads from /etc/vernal/config.json (written at provisioning time).
Falls back to environment variables for development.
"""

import json
import os
from dataclasses import dataclass
from pathlib import Path


CONFIG_PATH = Path("/etc/vernal/config.json")
DEFAULT_DB_PATH = Path("/var/lib/vernal/readings.db")


@dataclass
class Config:
    device_id: str
    device_jwt: str          # Signed JWT — used in Authorization header
    ingest_url: str
    db_path: Path
    upload_interval_s: int   # How often to batch-upload (default 300 = 5 min)
    rtl433_cmd: str          # Full path to rtl_433 binary
    lora_spi_bus: int        # SPI bus for SX1262 HAT (usually 0)
    lora_spi_device: int     # SPI device (CS pin select, usually 0)
    lora_frequency_hz: int   # 433_920_000 for UK 433 MHz ISM band


def load_config() -> Config:
    """Load config from file, falling back to environment variables."""
    if CONFIG_PATH.exists():
        with CONFIG_PATH.open() as f:
            data = json.load(f)
    else:
        # Development fallback — use env vars
        data = {}

    def get(key: str, default: str = "") -> str:
        return data.get(key) or os.environ.get(f"VERNAL_{key.upper()}", default)

    return Config(
        device_id        = get("device_id"),
        device_jwt       = get("device_jwt"),
        ingest_url       = get("ingest_url", "https://api.sow-now.uk/api/v1/ingest"),
        db_path          = Path(get("db_path", str(DEFAULT_DB_PATH))),
        upload_interval_s= int(get("upload_interval_s", "300")),
        rtl433_cmd       = get("rtl433_cmd", "/usr/bin/rtl_433"),
        lora_spi_bus     = int(get("lora_spi_bus", "0")),
        lora_spi_device  = int(get("lora_spi_device", "0")),
        lora_frequency_hz= int(get("lora_frequency_hz", "433920000")),
    )
