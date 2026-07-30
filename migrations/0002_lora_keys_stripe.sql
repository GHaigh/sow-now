-- Sow Now D1 Database Schema
-- Migration 0002 — LoRa node key storage + Stripe fields
-- Apply with: wrangler d1 migrations apply vernal-db --remote

-- Add LoRa AES key per device node (for Pi agent decryption lookup via API)
ALTER TABLE devices ADD COLUMN lora_node_keys TEXT; -- JSON: {"1":"aabbcc...", "2":"ddeeff..."}

-- Add Stripe subscription ID for webhook reconciliation
ALTER TABLE users ADD COLUMN stripe_subscription_id TEXT;

-- Per-node replay counter cache (Pi agent also keeps in-memory, this is persistence across restarts)
CREATE TABLE IF NOT EXISTS node_counters (
  device_id   TEXT NOT NULL,
  node_id     INTEGER NOT NULL,
  last_counter INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (device_id, node_id)
);
