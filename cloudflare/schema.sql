PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS roles (
 id TEXT PRIMARY KEY,
 name TEXT NOT NULL,
 token_hash TEXT NOT NULL,
 created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS memories (
 id TEXT PRIMARY KEY,
 role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
 kind TEXT NOT NULL DEFAULT 'memory' CHECK(kind IN ('memory','diary')),
 title TEXT NOT NULL,
 content TEXT NOT NULL,
 tags TEXT NOT NULL DEFAULT '[]',
 source TEXT NOT NULL DEFAULT '',
 fingerprint TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 UNIQUE(role_id,kind,fingerprint)
);
CREATE INDEX IF NOT EXISTS memories_role_updated ON memories(role_id,updated_at DESC);
