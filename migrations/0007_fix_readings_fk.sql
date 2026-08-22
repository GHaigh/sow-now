-- Sow Now D1 Database Schema
-- Migration 0007 — fix readings FK broken by migration 0003 table rename
--
-- When migration 0003 renamed sensors → sensors_old (to widen the CHECK
-- constraint), SQLite silently updated the FK in the readings table to
-- reference sensors_old. Migration 0003 then dropped sensors_old, leaving
-- readings with a FK pointing to a non-existent table, which causes a
-- D1_ERROR at ingest time.
--
-- Fix: recreate the readings table with the FK restored to sensors.
--
-- Apply with: wrangler d1 migrations apply vernal-db --remote

-- Step 1: disable FK enforcement for the migration (D1 default is OFF anyway)
PRAGMA foreign_keys = OFF;

-- Step 2: rename old readings table
ALTER TABLE readings RENAME TO readings_old;

-- Step 3: recreate with FK pointing to sensors (not sensors_old)
CREATE TABLE readings (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  sensor_id   TEXT NOT NULL REFERENCES sensors(id) ON DELETE CASCADE,
  device_id   TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  recorded_at INTEGER NOT NULL,
  received_at INTEGER NOT NULL DEFAULT (unixepoch()),
  -- Weather station fields
  temp_c                  REAL,
  humidity_pct            REAL,
  pressure_hpa            REAL,
  wind_avg_ms             REAL,
  wind_max_ms             REAL,
  wind_dir_deg            INTEGER,
  rain_mm                 REAL,
  uv_index                REAL,
  solar_lux               REAL,
  -- Soil / greenhouse fields
  soil_moisture_pct       REAL,
  soil_temp_c             REAL,
  greenhouse_temp_c       REAL,
  greenhouse_humidity_pct REAL,
  -- Indoor fields (added in migration 0003)
  indoor_temp_c           REAL,
  indoor_humidity_pct     REAL
);

-- Step 4: copy existing data
INSERT INTO readings SELECT * FROM readings_old;

-- Step 5: drop old table
DROP TABLE readings_old;

-- Step 6: recreate indexes
CREATE INDEX IF NOT EXISTS idx_readings_sensor_time ON readings(sensor_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_readings_user_time   ON readings(user_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_readings_device_time ON readings(device_id, recorded_at DESC);

PRAGMA foreign_keys = ON;
