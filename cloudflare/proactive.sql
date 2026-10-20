CREATE TABLE IF NOT EXISTS contact_configs (
 role_id TEXT PRIMARY KEY REFERENCES roles(id) ON DELETE CASCADE,
 enabled INTEGER NOT NULL DEFAULT 0, config TEXT NOT NULL DEFAULT '{}', sealed_key TEXT NOT NULL DEFAULT '',
 next_at INTEGER NOT NULL DEFAULT 0, attempts_day TEXT NOT NULL DEFAULT '', attempts INTEGER NOT NULL DEFAULT 0,
 schedule_day TEXT NOT NULL DEFAULT '', last_seen INTEGER NOT NULL DEFAULT 0, last_activity INTEGER NOT NULL DEFAULT 0,
 cooldown_until INTEGER NOT NULL DEFAULT 0, last_error TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS contact_events (
 id TEXT PRIMARY KEY, role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('message','call')), text TEXT NOT NULL, created INTEGER NOT NULL,
 acked INTEGER NOT NULL DEFAULT 0, notified INTEGER NOT NULL DEFAULT 0, push_attempts INTEGER NOT NULL DEFAULT 0,
 push_next INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS contact_events_role_created ON contact_events(role_id,created);
CREATE TABLE IF NOT EXISTS contact_subscriptions (
 id TEXT PRIMARY KEY, role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
 endpoint_hash TEXT NOT NULL, sealed TEXT NOT NULL, UNIQUE(role_id,endpoint_hash)
);
CREATE TABLE IF NOT EXISTS contact_daily_budget (day TEXT PRIMARY KEY, count INTEGER NOT NULL DEFAULT 0);
