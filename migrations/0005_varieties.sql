-- Migration 0005 — variety-level crop database
-- Adds a varieties table linked to crops_reference, and links crops to varieties.

-- ─────────────────────────────────────────
-- Varieties
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS varieties (
  id                    TEXT PRIMARY KEY,   -- nanoid / slug e.g. 'tomato-gardeners-delight'
  crop_key              TEXT NOT NULL REFERENCES crops_reference(crop_key) ON DELETE CASCADE,
  name                  TEXT NOT NULL,      -- e.g. 'Gardener''s Delight'
  supplier              TEXT,              -- e.g. 'DT Brown', 'Thompson & Morgan'
  -- GDD thresholds (variety-specific, override crop_reference defaults)
  gdd_to_germinate_min  INTEGER,
  gdd_to_germinate_max  INTEGER,
  gdd_to_harvest_min    INTEGER NOT NULL,
  gdd_to_harvest_max    INTEGER NOT NULL,
  -- Growing profile
  base_temp_c           REAL NOT NULL,
  days_to_harvest_min   INTEGER,           -- calendar days (for display only — GDD is used for prediction)
  days_to_harvest_max   INTEGER,
  start_indoors_weeks   INTEGER,           -- weeks before last frost to start indoors
  sow_method            TEXT NOT NULL DEFAULT 'indoor'
                        CHECK (sow_method IN ('indoor', 'direct', 'either')),
  -- Characteristics
  determinate           INTEGER,           -- 1=determinate, 0=indeterminate, NULL=N/A
  description           TEXT,
  -- Community / provenance
  verified              INTEGER NOT NULL DEFAULT 0,  -- 1 = curated/verified, 0 = community
  submitted_by          TEXT,             -- user_id if community-submitted, NULL if curated
  created_at            INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_varieties_crop ON varieties(crop_key);
CREATE INDEX IF NOT EXISTS idx_varieties_name ON varieties(crop_key, name);

-- ─────────────────────────────────────────
-- Link crops to varieties
-- ─────────────────────────────────────────
ALTER TABLE crops ADD COLUMN variety_id TEXT REFERENCES varieties(id) ON DELETE SET NULL;
