-- Sow Now D1 Database Schema
-- Migration 0001 — initial schema
-- Apply with: wrangler d1 migrations apply vernal-db --remote

-- ─────────────────────────────────────────
-- Users
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,           -- nanoid
  email       TEXT NOT NULL UNIQUE,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  -- Subscription
  tier        TEXT NOT NULL DEFAULT 'seed' CHECK (tier IN ('seed', 'grower', 'smallholder')),
  tier_expires_at INTEGER,                -- NULL = free tier, no expiry concern
  stripe_customer_id TEXT,
  -- Location (postcode prefix only — e.g. 'SW4', 'NG1')
  postcode_prefix TEXT,
  climate_zone    TEXT,                   -- e.g. 'uk-midlands', 'uk-south'
  -- Prefs
  timezone        TEXT NOT NULL DEFAULT 'Europe/London',
  push_enabled    INTEGER NOT NULL DEFAULT 0,
  push_endpoint   TEXT,
  push_p256dh     TEXT,
  push_auth       TEXT
);

-- ─────────────────────────────────────────
-- Devices (Vernal Hubs)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS devices (
  id              TEXT PRIMARY KEY,       -- nanoid, burned in at manufacture
  user_id         TEXT REFERENCES users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL DEFAULT 'My Vernal Hub',
  serial          TEXT NOT NULL UNIQUE,   -- printed on box / QR code
  firmware_version TEXT,
  last_seen_at    INTEGER,               -- unix timestamp of last uplink
  provisioned_at  INTEGER,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_id);

-- ─────────────────────────────────────────
-- Sensor nodes (weather station, soil nodes, greenhouse node)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sensors (
  id          TEXT PRIMARY KEY,           -- nanoid
  device_id   TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Identity
  rf_id       TEXT,                       -- sensor's RF device ID (from rtl_433 or LoRa payload)
  sensor_type TEXT NOT NULL CHECK (sensor_type IN ('weather_station', 'soil', 'greenhouse')),
  -- User-assigned
  name        TEXT NOT NULL DEFAULT 'Sensor',   -- e.g. "Bed 1", "Greenhouse"
  -- Status
  battery_pct INTEGER,                   -- 0–100, null if mains/solar
  last_seen_at INTEGER,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_sensors_device ON sensors(device_id);
CREATE INDEX IF NOT EXISTS idx_sensors_user   ON sensors(user_id);

-- ─────────────────────────────────────────
-- Raw sensor readings
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS readings (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  sensor_id   TEXT NOT NULL REFERENCES sensors(id) ON DELETE CASCADE,
  device_id   TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  recorded_at INTEGER NOT NULL,           -- unix timestamp (from Pi clock)
  received_at INTEGER NOT NULL DEFAULT (unixepoch()),
  -- Weather station fields (nullable — only populated for weather_station type)
  temp_c          REAL,                   -- outdoor air temperature °C
  humidity_pct    REAL,                   -- relative humidity %
  pressure_hpa    REAL,                   -- barometric pressure hPa
  wind_avg_ms     REAL,                   -- average wind speed m/s
  wind_max_ms     REAL,                   -- gust wind speed m/s
  wind_dir_deg    INTEGER,               -- wind direction 0–359°
  rain_mm         REAL,                   -- cumulative rain mm (resets at midnight)
  uv_index        REAL,
  solar_lux       REAL,
  -- Soil / greenhouse fields
  soil_moisture_pct REAL,                 -- 0–100%
  soil_temp_c       REAL,                 -- soil temperature °C (DS18B20)
  greenhouse_temp_c REAL,                 -- greenhouse air temp °C
  greenhouse_humidity_pct REAL
);

CREATE INDEX IF NOT EXISTS idx_readings_sensor_time  ON readings(sensor_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_readings_user_time    ON readings(user_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_readings_device_time  ON readings(device_id, recorded_at DESC);

-- ─────────────────────────────────────────
-- Daily GDD summaries (computed by cron Worker)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS gdd_daily (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id   TEXT NOT NULL,
  date        TEXT NOT NULL,             -- ISO date 'YYYY-MM-DD'
  zone        TEXT NOT NULL CHECK (zone IN ('outdoor', 'greenhouse')),
  base_temp_c REAL NOT NULL,             -- GDD base temp used (e.g. 10.0)
  t_max_c     REAL NOT NULL,
  t_min_c     REAL NOT NULL,
  gdd         REAL NOT NULL,             -- daily GDD contribution (>= 0)
  UNIQUE(user_id, device_id, date, zone, base_temp_c)
);

CREATE INDEX IF NOT EXISTS idx_gdd_daily_user_date ON gdd_daily(user_id, date DESC);

-- ─────────────────────────────────────────
-- Crops — user's planting plan
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crops (
  id              TEXT PRIMARY KEY,       -- nanoid
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sensor_id       TEXT REFERENCES sensors(id) ON DELETE SET NULL, -- linked soil node
  -- Crop identity
  crop_key        TEXT NOT NULL,          -- e.g. 'tomato', 'french_bean' — links to knowledge base
  variety         TEXT,                   -- user-entered variety name
  bed_name        TEXT,                   -- e.g. "Bed 1"
  -- Lifecycle dates
  sown_at         INTEGER,               -- unix timestamp
  germinated_at   INTEGER,
  transplanted_at INTEGER,
  harvested_at    INTEGER,
  -- GDD tracking (accumulated since sown_at)
  gdd_base_temp_c REAL NOT NULL DEFAULT 10.0,
  gdd_accumulated REAL NOT NULL DEFAULT 0.0,
  -- Status
  status          TEXT NOT NULL DEFAULT 'planned'
                  CHECK (status IN ('planned', 'sown', 'germinated', 'growing', 'hardening', 'transplanted', 'harvested', 'failed')),
  notes           TEXT,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_crops_user ON crops(user_id);

-- ─────────────────────────────────────────
-- Daily advice cards
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS advice (
  id          TEXT PRIMARY KEY,           -- nanoid
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date        TEXT NOT NULL,             -- 'YYYY-MM-DD' — one card per user per day
  -- Generated content
  summary     TEXT NOT NULL,             -- short headline
  actions     TEXT NOT NULL,             -- JSON array of action strings
  context     TEXT,                      -- JSON — sensor snapshot used to generate advice
  -- Metadata
  generated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  model       TEXT,                      -- AI model used
  UNIQUE(user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_advice_user_date ON advice(user_id, date DESC);

-- ─────────────────────────────────────────
-- Device provisioning tokens (one-time use)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS provision_tokens (
  token       TEXT PRIMARY KEY,          -- random 32-byte hex, encoded in QR
  device_id   TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  used        INTEGER NOT NULL DEFAULT 0,
  expires_at  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ─────────────────────────────────────────
-- Crop reference data (seeded from scripts/seed.sql)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crops_reference (
  crop_key              TEXT PRIMARY KEY,
  display_name          TEXT NOT NULL,
  base_temp_c           REAL NOT NULL,
  soil_temp_min_c       REAL,
  gdd_to_germinate_min  INTEGER,
  gdd_to_germinate_max  INTEGER,
  gdd_to_harvest_min    INTEGER,
  gdd_to_harvest_max    INTEGER,
  moisture_min_pct      INTEGER,
  moisture_max_pct      INTEGER,
  notes                 TEXT
);
