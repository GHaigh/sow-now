-- Sow Now D1 Database Schema
-- Migration 0003 — indoor zone support (WH31 channel 2+ as propagator/windowsill sensor)
-- Apply with: wrangler d1 migrations apply vernal-db --remote

-- ── sensors table ────────────────────────────────────────────────────────────
-- Extend sensor_type to include 'indoor'
-- SQLite does not support ALTER COLUMN CHECK constraints; we recreate via
-- a trigger-less approach: the CHECK is enforced at application layer,
-- and the column default/constraint is updated by recreating with the new value.
-- Because SQLite cannot DROP CONSTRAINT, we use a no-op migration note here
-- and enforce 'indoor' at the application level. The CHECK in the original
-- CREATE TABLE is advisory on SQLite (not enforced by all drivers); D1 does
-- enforce it, so we need to widen it.

-- Workaround: add a new sensors_v2 view-compatible column approach is not
-- needed — D1 supports STRICT tables but not ALTER CHECK. Instead we drop
-- and recreate the table with the wider CHECK.

-- Step 1: rename old sensors table
ALTER TABLE sensors RENAME TO sensors_old;

-- Step 2: recreate with wider sensor_type CHECK (includes 'indoor')
CREATE TABLE sensors (
  id          TEXT PRIMARY KEY,
  device_id   TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rf_id       TEXT,
  sensor_type TEXT NOT NULL CHECK (sensor_type IN ('weather_station', 'soil', 'greenhouse', 'indoor')),
  name        TEXT NOT NULL DEFAULT 'Sensor',
  battery_pct INTEGER,
  last_seen_at INTEGER,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Step 3: copy data
INSERT INTO sensors SELECT * FROM sensors_old;

-- Step 4: drop old table
DROP TABLE sensors_old;

-- Step 5: recreate indexes
CREATE INDEX IF NOT EXISTS idx_sensors_device ON sensors(device_id);
CREATE INDEX IF NOT EXISTS idx_sensors_user   ON sensors(user_id);

-- ── readings table ────────────────────────────────────────────────────────────
-- Add indoor temp/humidity columns (same pattern as greenhouse)
ALTER TABLE readings ADD COLUMN indoor_temp_c       REAL;
ALTER TABLE readings ADD COLUMN indoor_humidity_pct REAL;

-- ── gdd_daily table ───────────────────────────────────────────────────────────
-- Widen zone CHECK to include 'indoor' (same approach as sensors)
ALTER TABLE gdd_daily RENAME TO gdd_daily_old;

CREATE TABLE gdd_daily (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id   TEXT NOT NULL,
  date        TEXT NOT NULL,
  zone        TEXT NOT NULL CHECK (zone IN ('outdoor', 'greenhouse', 'indoor')),
  base_temp_c REAL NOT NULL,
  t_max_c     REAL NOT NULL,
  t_min_c     REAL NOT NULL,
  gdd         REAL NOT NULL,
  UNIQUE(user_id, device_id, date, zone, base_temp_c)
);

INSERT INTO gdd_daily SELECT * FROM gdd_daily_old;
DROP TABLE gdd_daily_old;

CREATE INDEX IF NOT EXISTS idx_gdd_daily_user_date ON gdd_daily(user_id, date DESC);

-- ── crops table ───────────────────────────────────────────────────────────────
-- Add zone column so each crop knows which zone's GDD to accumulate against.
-- Defaults to 'outdoor' for all existing crops.
ALTER TABLE crops ADD COLUMN zone TEXT NOT NULL DEFAULT 'outdoor'
  CHECK (zone IN ('outdoor', 'greenhouse', 'indoor'));
