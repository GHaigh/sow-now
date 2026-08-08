-- Sow Now D1 Database Schema
-- Migration 0004 — sensor latest-reading snapshot columns
--
-- Adds a denormalised snapshot of the most recent reading directly on the
-- sensors row. This lets the claiming candidates endpoint return live reading
-- values without a separate JOIN to the readings table.
--
-- Apply with: wrangler d1 migrations apply vernal-db --remote

ALTER TABLE sensors ADD COLUMN snap_temp_c          REAL;
ALTER TABLE sensors ADD COLUMN snap_humidity_pct     REAL;
ALTER TABLE sensors ADD COLUMN snap_wind_avg_ms      REAL;
ALTER TABLE sensors ADD COLUMN snap_wind_dir_deg     INTEGER;
ALTER TABLE sensors ADD COLUMN snap_rain_mm          REAL;
ALTER TABLE sensors ADD COLUMN snap_soil_moisture_pct REAL;
ALTER TABLE sensors ADD COLUMN snap_soil_temp_c      REAL;
