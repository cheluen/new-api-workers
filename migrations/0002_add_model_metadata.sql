-- Migration: 0002_add_model_metadata.sql
-- Adds model_metadata table and updates logs table

-- Model metadata table (for model management page)
CREATE TABLE IF NOT EXISTS model_metadata (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    model_id TEXT NOT NULL UNIQUE,
    model_name TEXT NOT NULL DEFAULT '',
    vendor TEXT NOT NULL DEFAULT '',
    tags TEXT NOT NULL DEFAULT '',
    status INTEGER NOT NULL DEFAULT 1,
    input_price REAL NOT NULL DEFAULT 0,
    output_price REAL NOT NULL DEFAULT 0,
    context_size INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_model_metadata_model_id ON model_metadata(model_id);
CREATE INDEX IF NOT EXISTS idx_model_metadata_vendor ON model_metadata(vendor);
CREATE INDEX IF NOT EXISTS idx_model_metadata_status ON model_metadata(status);

-- Add model_name column to logs if using 'model' column
-- Note: SQLite doesn't support ALTER COLUMN, so we use model as model_name alias

-- Add group and sidebar_modules column to users
ALTER TABLE users ADD COLUMN "group" TEXT NOT NULL DEFAULT 'default';
ALTER TABLE users ADD COLUMN sidebar_modules TEXT;
