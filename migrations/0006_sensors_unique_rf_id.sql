-- Sow Now D1 Database Schema
-- Migration 0006 — add UNIQUE(device_id, rf_id) to sensors table
--
-- The ingest route uses ON CONFLICT(device_id, rf_id) for sensor upserts,
-- but this constraint was never defined on the table, causing a D1_ERROR on
-- every ingest call. SQLite cannot ADD CONSTRAINT — recreate the table.
--
-- Apply with: wrangler d1 migrations apply vernal-db --remote

-- Step 1: rename existing table
ALTER TABLE sensors RENAME TO sensors_old;

-- Step 2: recreate with the unique constraint and all existing columns
CREATE TABLE sensors (
  id          TEXT PRIMARY KEY,
  device_id   TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  rf_id       TEXT,
  sensor_type TEXT NOT NULL CHECK (sensor_type IN ('weather_station', 'soil', 'greenhouse', 'indoor')),
  name        TEXT NOT NULL DEFAULT 'Sensor',
  battery_pct INTEGER,
  last_seen_at  INTEGER,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  -- Snapshot columns (added in migration 0004)
  snap_temp_c           REAL,
  snap_humidity_pct     REAL,
  snap_wind_avg_ms      REAL,
  snap_wind_dir_deg     INTEGER,
  snap_rain_mm          REAL,
  snap_soil_moisture_pct REAL,
  snap_soil_temp_c      REAL,
  -- Enforce uniqueness so the ingest ON CONFLICT upsert works
  UNIQUE(device_id, rf_id)
);

-- Step 3: copy all existing rows
INSERT INTO sensors SELECT * FROM sensors_old;

-- Step 4: drop old table
DROP TABLE sensors_old;

-- Step 5: recreate indexes
CREATE INDEX IF NOT EXISTS idx_sensors_device ON sensors(device_id);
CREATE INDEX IF NOT EXISTS idx_sensors_user   ON sensors(user_id);
