"""
SQLite local buffer for Vernal sensor readings.

Provides a 30-day rolling window of readings with a sync queue
that tracks which rows haven't been uploaded yet.
Survives broadband outages — readings are queued and uploaded on reconnect.
"""

import sqlite3
import time
import logging
from pathlib import Path
from typing import Any

log = logging.getLogger("sow-now.buffer")

SCHEMA = """
CREATE TABLE IF NOT EXISTS readings (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    sensor_rf_id    TEXT    NOT NULL,
    sensor_type     TEXT    NOT NULL,   -- weather_station | soil | greenhouse
    recorded_at     INTEGER NOT NULL,   -- unix timestamp
    -- Weather station
    temp_c          REAL,
    humidity_pct    REAL,
    pressure_hpa    REAL,
    wind_avg_ms     REAL,
    wind_max_ms     REAL,
    wind_dir_deg    INTEGER,
    rain_mm         REAL,
    uv_index        REAL,
    solar_lux       REAL,
    -- Soil / greenhouse / indoor
    soil_moisture_pct       REAL,
    soil_temp_c             REAL,
    greenhouse_temp_c       REAL,
    greenhouse_humidity_pct REAL,
    indoor_temp_c           REAL,
    indoor_humidity_pct     REAL,
    battery_pct             INTEGER,
    -- Sync
    uploaded        INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_readings_uploaded ON readings(uploaded, id);
CREATE INDEX IF NOT EXISTS idx_readings_time     ON readings(recorded_at DESC);

-- Purge readings older than 30 days automatically via trigger
CREATE TRIGGER IF NOT EXISTS purge_old_readings
AFTER INSERT ON readings
BEGIN
    DELETE FROM readings
    WHERE recorded_at < (unixepoch() - 30 * 86400)
      AND uploaded = 1;
END;
"""


class ReadingBuffer:
    def __init__(self, db_path: Path) -> None:
        db_path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(str(db_path), check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.executescript(SCHEMA)
        self._conn.commit()
        log.info("Buffer opened at %s", db_path)

    def insert(self, reading: dict[str, Any]) -> None:
        """Insert a single reading into the local buffer."""
        self._conn.execute(
            """
            INSERT INTO readings (
                sensor_rf_id, sensor_type, recorded_at,
                temp_c, humidity_pct, pressure_hpa,
                wind_avg_ms, wind_max_ms, wind_dir_deg,
                rain_mm, uv_index, solar_lux,
                soil_moisture_pct, soil_temp_c,
                greenhouse_temp_c, greenhouse_humidity_pct,
                indoor_temp_c, indoor_humidity_pct,
                battery_pct
            ) VALUES (
                :sensor_rf_id, :sensor_type, :recorded_at,
                :temp_c, :humidity_pct, :pressure_hpa,
                :wind_avg_ms, :wind_max_ms, :wind_dir_deg,
                :rain_mm, :uv_index, :solar_lux,
                :soil_moisture_pct, :soil_temp_c,
                :greenhouse_temp_c, :greenhouse_humidity_pct,
                :indoor_temp_c, :indoor_humidity_pct,
                :battery_pct
            )
            """,
            {
                "sensor_rf_id":    reading.get("sensor_rf_id", "unknown"),
                "sensor_type":     reading.get("sensor_type", "weather_station"),
                "recorded_at":     reading.get("recorded_at", int(time.time())),
                "temp_c":          reading.get("temp_c"),
                "humidity_pct":    reading.get("humidity_pct"),
                "pressure_hpa":    reading.get("pressure_hpa"),
                "wind_avg_ms":     reading.get("wind_avg_ms"),
                "wind_max_ms":     reading.get("wind_max_ms"),
                "wind_dir_deg":    reading.get("wind_dir_deg"),
                "rain_mm":         reading.get("rain_mm"),
                "uv_index":        reading.get("uv_index"),
                "solar_lux":       reading.get("solar_lux"),
                "soil_moisture_pct":       reading.get("soil_moisture_pct"),
                "soil_temp_c":             reading.get("soil_temp_c"),
                "greenhouse_temp_c":       reading.get("greenhouse_temp_c"),
                "greenhouse_humidity_pct": reading.get("greenhouse_humidity_pct"),
                "indoor_temp_c":           reading.get("indoor_temp_c"),
                "indoor_humidity_pct":     reading.get("indoor_humidity_pct"),
                "battery_pct":             reading.get("battery_pct"),
            },
        )
        self._conn.commit()

    def get_pending(self, limit: int = 200) -> list[dict[str, Any]]:
        """Return up to `limit` readings that haven't been uploaded yet."""
        rows = self._conn.execute(
            "SELECT * FROM readings WHERE uploaded = 0 ORDER BY id ASC LIMIT ?",
            (limit,),
        ).fetchall()
        return [dict(r) for r in rows]

    def mark_uploaded(self, ids: list[int]) -> None:
        """Mark rows as uploaded after successful API call."""
        if not ids:
            return
        placeholders = ",".join("?" * len(ids))
        self._conn.execute(
            f"UPDATE readings SET uploaded = 1 WHERE id IN ({placeholders})",
            ids,
        )
        self._conn.commit()

    def close(self) -> None:
        self._conn.close()
