-- Existing accounts and sessions remain the sole authentication source.
ALTER TABLE accounts ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0);
CREATE TABLE account_access_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
 actor_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
 before_value jsonb NOT NULL,
 after_value jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX account_access_events_account ON account_access_events(account_id,created_at DESC,id);
