-- Reuse existing credential audit. Never store passwords, hashes, or password fingerprints in audit JSON.
ALTER TABLE account_lifecycle_events DROP CONSTRAINT account_lifecycle_events_action_check;
ALTER TABLE account_lifecycle_events ADD CONSTRAINT account_lifecycle_events_action_check CHECK(action IN('created','password-reset','password-change'));
