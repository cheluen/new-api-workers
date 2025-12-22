-- Seed data for development
-- Default admin user with password: 123456 (bcrypt hash)
-- Note: Change this password in production!

INSERT OR IGNORE INTO users (id, username, password_hash, display_name, email, role, status, quota)
VALUES (
    1,
    'admin',
    -- bcrypt hash of '123456' - replace in production
    '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
    'Administrator',
    'admin@localhost',
    100,
    1,
    500000
);

-- Default system options
INSERT OR IGNORE INTO options (key, value) VALUES ('system_name', 'New API');
INSERT OR IGNORE INTO options (key, value) VALUES ('quota_per_unit', '500000');
INSERT OR IGNORE INTO options (key, value) VALUES ('display_in_currency', 'true');
INSERT OR IGNORE INTO options (key, value) VALUES ('display_token_stat', 'true');
INSERT OR IGNORE INTO options (key, value) VALUES ('default_quota', '0');
INSERT OR IGNORE INTO options (key, value) VALUES ('register_enabled', 'true');
INSERT OR IGNORE INTO options (key, value) VALUES ('email_verification', 'false');
